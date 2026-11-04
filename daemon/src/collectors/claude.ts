import { basename, join } from 'node:path';
import { config } from '../config.ts';
import { JsonlTail } from '../jsonl.ts';
import { clip, type Store } from '../store.ts';
import type { AgentEvent } from '../types.ts';
import { listDir, mtime, pidAlive, readJson, stringify, ts } from './util.ts';

/**
 * Claude Code grava:
 *  - ~/.claude/sessions/<pid>.json             registro das sessões vivas (status busy/idle)
 *  - ~/.claude/projects/<proj>/<sessão>.jsonl  transcrição
 *  - ~/.claude/projects/<proj>/<sessão>/subagents/agent-<id>.jsonl (+ .meta.json)
 */

interface FileCtx {
  tail: JsonlTail;
  agentId: string;
  sessionId: string;
  isSubagent: boolean;
  seq: number;
}

interface SubagentMeta {
  agentType?: string;
  description?: string;
  toolUseId?: string;
  requestShape?: string;
}

export function claudeAgentId(sessionId: string) {
  return `claude:${sessionId}`;
}

export class ClaudeCollector {
  private files = new Map<string, FileCtx>();
  private titles = new Map<string, { custom?: string; firstPrompt?: string }>();
  /** tool_use id -> agente que fez a chamada (para achar o pai de subagentes aninhados). */
  private toolOwner = new Map<string, string>();
  private completedTools = new Set<string>();
  private subagentMeta = new Map<string, SubagentMeta>();
  private registered = new Set<string>();

  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  async scan() {
    const cutoff = Date.now() - config.windowHours * 3600_000;
    const root = config.paths.claudeProjects;
    for (const proj of await listDir(root)) {
      const projDir = join(root, proj);
      for (const name of await listDir(projDir)) {
        if (name.endsWith('.jsonl')) {
          const path = join(projDir, name);
          const sessionId = name.slice(0, -6);
          if (!this.files.has(path) && ((await mtime(path)) > cutoff || this.registered.has(sessionId))) {
            this.track(path, sessionId, claudeAgentId(sessionId), false);
          }
        }
        const subDir = join(projDir, name, 'subagents');
        if (!this.files.has(join(projDir, name + '.jsonl'))) continue;
        for (const sub of await listDir(subDir)) {
          if (!sub.endsWith('.jsonl')) continue;
          const path = join(subDir, sub);
          if (this.files.has(path) || (await mtime(path)) < cutoff) continue;
          const subId = basename(sub, '.jsonl').replace(/^agent-/, '');
          const agentId = `${claudeAgentId(name)}/${subId}`;
          const meta = (await readJson<SubagentMeta>(join(subDir, `agent-${subId}.meta.json`))) ?? {};
          this.subagentMeta.set(agentId, meta);
          this.track(path, name, agentId, true);
          this.store.upsert(agentId, {
            provider: 'claude',
            title: meta.description || `Subagente ${subId.slice(0, 6)}`,
            role: meta.agentType,
          });
        }
      }
    }
  }

  private track(path: string, sessionId: string, agentId: string, isSubagent: boolean) {
    this.files.set(path, { tail: new JsonlTail(path), agentId, sessionId, isSubagent, seq: 0 });
    if (!isSubagent) {
      this.store.upsert(agentId, { provider: 'claude', resume: `claude --resume ${sessionId}` });
    }
  }

  async read() {
    for (const ctx of this.files.values()) {
      const records = await ctx.tail.read();
      if (records.length) this.ingest(ctx, records);
    }
    this.linkSubagents();
  }

  /** Lê ~/.claude/sessions para saber quais sessões estão vivas e o status delas. */
  async readRegistry() {
    const dir = config.paths.claudeSessions;
    const seen = new Set<string>();
    for (const name of await listDir(dir)) {
      if (!/^\d+\.json$/.test(name)) continue;
      const reg = await readJson<any>(join(dir, name));
      if (!reg?.sessionId || !reg.pid) continue;
      if (!(await pidAlive(reg.pid, reg.procStart))) continue;
      seen.add(reg.sessionId);
      const id = claudeAgentId(reg.sessionId);
      const status = String(reg.status ?? '');
      this.store.upsert(
        id,
        {
          provider: 'claude',
          pid: reg.pid,
          cwd: reg.cwd,
          startedAt: reg.startedAt,
          lastActivity: Math.max(this.store.get(id)?.lastActivity ?? 0, reg.statusUpdatedAt ?? 0),
        },
        {
          alive: true,
          reported: status === 'busy' ? 'working' : /wait|permission|input|action/.test(status) ? 'waiting' : 'idle',
        },
      );
      if (reg.name) this.title(id, { custom: reg.name });
    }
    for (const sessionId of this.registered) {
      if (!seen.has(sessionId)) this.store.upsert(claudeAgentId(sessionId), {}, { alive: false, reported: undefined });
    }
    this.registered = seen;
  }

  private title(id: string, patch: { custom?: string; firstPrompt?: string }) {
    const t = { ...this.titles.get(id) };
    if (patch.custom) t.custom = patch.custom;
    if (patch.firstPrompt && !t.firstPrompt) t.firstPrompt = patch.firstPrompt;
    this.titles.set(id, t);
    const title = t.custom || t.firstPrompt;
    if (title) this.store.upsert(id, { title });
  }

  private ingest(ctx: FileCtx, records: any[]) {
    const id = ctx.agentId;
    const events: AgentEvent[] = [];
    const ev = (e: Omit<AgentEvent, 'id'>) => events.push({ id: `${id}#${ctx.seq++}`, ...e });

    for (const r of records) {
      if (!ctx.isSubagent) {
        if (r.type === 'custom-title' && r.customTitle) this.title(id, { custom: r.customTitle });
        if (r.type === 'agent-name' && r.agentName) this.title(id, { custom: r.agentName });
      }
      if (r.type !== 'user' && r.type !== 'assistant') continue;
      if (r.isMeta || r.isCompactSummary) continue;
      const t = ts(r.timestamp);
      const patch: Record<string, unknown> = {};
      // Mantém a pasta onde a sessão começou; o agente pode dar `cd` depois.
      if (r.cwd && !this.store.get(id)?.cwd) patch.cwd = r.cwd;
      if (r.message?.model && !r.message.model.startsWith('<')) patch.model = r.message.model;
      const u = r.type === 'assistant' ? r.message?.usage : undefined;
      if (u) patch.context = claudeContext(u, this.store.get(id)?.context);
      if (!this.store.get(id)?.lastActivity) patch.startedAt = t;
      this.store.upsert(id, patch);

      const content = r.message?.content;
      if (r.type === 'user') {
        if (typeof content === 'string') {
          const text = cleanUserText(content);
          if (text) {
            ev({ ts: t, kind: 'user', text: clip(text) });
            if (!ctx.isSubagent) this.title(id, { firstPrompt: text.slice(0, 90) });
          }
          continue;
        }
        for (const b of content ?? []) {
          if (b.type === 'text') {
            const text = cleanUserText(b.text ?? '');
            if (text) ev({ ts: t, kind: 'user', text: clip(text) });
          } else if (b.type === 'tool_result') {
            this.completedTools.add(b.tool_use_id);
            ev({ ts: t, kind: 'result', text: clip(resultText(b.content), 2000), isError: !!b.is_error });
          }
        }
      } else {
        for (const b of content ?? []) {
          if (b.type === 'text' && b.text?.trim()) ev({ ts: t, kind: 'assistant', text: clip(b.text) });
          else if (b.type === 'tool_use') {
            this.toolOwner.set(b.id, id);
            const question = b.name === 'AskUserQuestion';
            ev({
              ts: t,
              kind: question ? 'question' : 'tool',
              label: b.name,
              text: question ? questionText(b.input) : summarizeTool(b.name, b.input),
            });
          }
        }
      }
    }
    this.store.addEvents(id, events);
  }

  private linkSubagents() {
    for (const [agentId, meta] of this.subagentMeta) {
      const session = agentId.split('/')[0];
      const owner = meta.toolUseId ? this.toolOwner.get(meta.toolUseId) : undefined;
      const finished =
        meta.requestShape !== 'background' && !!meta.toolUseId && this.completedTools.has(meta.toolUseId);
      const parent = this.store.get(session);
      this.store.upsert(
        agentId,
        { parentId: owner && owner !== agentId ? owner : session, cwd: parent?.cwd },
        { finished, alive: parent && parent.status === 'done' ? false : undefined },
      );
    }
  }
}

/**
 * Contexto em uso = tudo que o modelo leu neste turno + o que escreveu.
 * O Claude não grava o limite da janela: assume 200 mil e sobe para 1 mi se já passou disso.
 */
function claudeContext(u: any, prev?: { limit: number }) {
  const used = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
  const limit = Math.max(prev?.limit ?? 0, used > 200_000 ? 1_000_000 : 200_000);
  return { used, limit, estimated: true };
}

function cleanUserText(text: string) {
  if (/^<(local-command-stdout|local-command-caveat|bash-stdout|bash-stderr)/.test(text)) return '';
  const cmd = text.match(/<command-name>(.*?)<\/command-name>/);
  if (cmd) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
    return `${cmd[1]}${args ? ' ' + args : ''}`;
  }
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (c.type === 'text' ? c.text : c.type === 'image' ? '[imagem]' : ''))
      .join('\n');
  }
  return '';
}

function questionText(input: any) {
  const qs = input?.questions ?? [];
  return qs
    .map((q: any) => `${q.question}\n${(q.options ?? []).map((o: any) => `  • ${o.label}`).join('\n')}`)
    .join('\n\n');
}

export function summarizeTool(name: string, input: any): string {
  if (!input || typeof input !== 'object') return stringify(input);
  switch (name) {
    case 'Bash':
      return input.command ?? '';
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return input.file_path ?? input.notebook_path ?? '';
    case 'Grep':
      return `${input.pattern}${input.path ? `  em ${input.path}` : ''}`;
    case 'Glob':
      return input.pattern ?? '';
    case 'Task':
    case 'Agent':
      return `${input.subagent_type ? `[${input.subagent_type}] ` : ''}${input.description ?? ''}`;
    case 'WebFetch':
      return input.url ?? '';
    case 'WebSearch':
      return input.query ?? '';
    case 'TodoWrite':
      return (input.todos ?? []).map((t: any) => `${t.status === 'completed' ? '✓' : '·'} ${t.content}`).join('\n');
    default:
      return stringify(input, 400);
  }
}
