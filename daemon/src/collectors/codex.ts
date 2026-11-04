import { basename, join } from 'node:path';
import { config } from '../config.ts';
import { JsonlTail } from '../jsonl.ts';
import { clip, type Store } from '../store.ts';
import type { AgentEvent } from '../types.ts';
import { listDir, mtime, stringify, ts } from './util.ts';

/**
 * Codex grava cada thread em ~/.codex/sessions/AAAA/MM/DD/rollout-<data>-<id>.jsonl.
 * Subagentes têm seu próprio rollout, com `parent_thread_id` no session_meta.
 * Nomes das threads ficam em ~/.codex/session_index.jsonl.
 */

/** Chamadas de orquestração que só geram ruído na timeline. */
const NOISE = new Set(['wait_agent', 'wait', 'list_agents']);

interface FileCtx {
  tail: JsonlTail;
  agentId: string;
  threadId: string;
  seq: number;
  isSubagent: boolean;
  firstPrompt?: string;
  subagentTitle?: string;
  pendingQuestion?: string;
  noiseCalls: Set<string>;
  metaSeen?: boolean;
}

export class CodexCollector {
  private files = new Map<string, FileCtx>();
  private names = new Map<string, string>();
  private indexMtime = 0;

  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  async scan() {
    await this.readIndex();
    const cutoff = Date.now() - config.windowHours * 3600_000;
    // Só percorre as pastas de dia dentro da janela (+1 dia de folga por fuso).
    const days = Math.ceil(config.windowHours / 24) + 1;
    for (let i = 0; i <= days; i++) {
      const d = new Date(Date.now() - i * 86_400_000);
      const dir = join(
        config.paths.codexSessions,
        String(d.getFullYear()),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
      );
      for (const name of await listDir(dir)) {
        if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
        const path = join(dir, name);
        if (this.files.has(path) || (await mtime(path)) < cutoff) continue;
        const threadId = basename(name, '.jsonl').slice(-36);
        const agentId = `codex:${threadId}`;
        this.files.set(path, { tail: new JsonlTail(path), agentId, threadId, seq: 0, isSubagent: false, noiseCalls: new Set() });
        this.store.upsert(agentId, { provider: 'codex', title: this.names.get(threadId) });
      }
    }
  }

  private async readIndex() {
    const m = await mtime(config.paths.codexIndex);
    if (m === this.indexMtime) return;
    this.indexMtime = m;
    const tail = new JsonlTail(config.paths.codexIndex);
    for (const r of (await tail.read()) as any[]) if (r?.id && r.thread_name) this.names.set(r.id, r.thread_name);
    for (const ctx of this.files.values()) this.applyTitle(ctx);
  }

  async read() {
    for (const ctx of this.files.values()) {
      const records = await ctx.tail.read();
      if (records.length) this.ingest(ctx, records);
    }
  }

  private applyTitle(ctx: FileCtx) {
    const title = this.names.get(ctx.threadId) ?? ctx.subagentTitle ?? ctx.firstPrompt;
    if (title) this.store.upsert(ctx.agentId, { title });
  }

  private ingest(ctx: FileCtx, records: any[]) {
    const id = ctx.agentId;
    const events: AgentEvent[] = [];
    const ev = (e: Omit<AgentEvent, 'id'>) => events.push({ id: `${id}#${ctx.seq++}`, ...e });

    for (const r of records) {
      const p = r.payload ?? {};
      const t = ts(r.timestamp);

      if (r.type === 'session_meta') {
        // Subagentes copiam o cabeçalho da thread pai mais adiante no arquivo: vale só o primeiro.
        if (ctx.metaSeen) continue;
        ctx.metaSeen = true;
        const parent = p.parent_thread_id as string | undefined;
        ctx.isSubagent = !!parent;
        if (parent) {
          const path = String(p.agent_path ?? '').split('/').filter(Boolean).pop();
          ctx.subagentTitle = [path, p.agent_nickname && `(${p.agent_nickname})`].filter(Boolean).join(' ') || undefined;
        }
        this.store.upsert(id, {
          provider: 'codex',
          cwd: p.cwd,
          startedAt: ts(p.timestamp, t),
          parentId: parent ? `codex:${parent}` : undefined,
          role: p.agent_role,
          resume: parent ? undefined : `codex resume ${ctx.threadId}`,
        });
        this.applyTitle(ctx);
        continue;
      }

      if (r.type === 'compacted') ev({ ts: t, kind: 'system', text: 'Contexto compactado' });

      if (r.type === 'event_msg') {
        if (p.type === 'task_started') this.store.upsert(id, {}, { turnOpen: true });
        else if (p.type === 'task_complete') this.store.upsert(id, {}, { turnOpen: false, question: false });
        else if (p.type === 'turn_aborted') {
          this.store.upsert(id, {}, { turnOpen: false, question: false });
          ev({ ts: t, kind: 'system', text: `Turno interrompido (${p.reason ?? '?'})`, isError: true });
        } else if (p.type === 'token_count' && p.info?.last_token_usage && p.info.model_context_window) {
          // Codex grava o tamanho do último pedido e o limite da janela do modelo.
          const last = p.info.last_token_usage;
          this.store.upsert(id, {
            context: { used: (last.input_tokens ?? 0) + (last.output_tokens ?? 0), limit: p.info.model_context_window, estimated: false },
          });
        } else if (p.type === 'thread_settings_applied' && p.thread_settings?.model) {
          this.store.upsert(id, { model: p.thread_settings.model });
        }
        continue;
      }

      if (r.type !== 'response_item') continue;

      switch (p.type) {
        case 'message': {
          const text = (p.content ?? [])
            .filter((c: any) => c.type === 'input_text' || c.type === 'output_text')
            .map((c: any) => c.text as string)
            .filter((s: string) => !/^\s*(<|# AGENTS\.md)/.test(s))
            .join('\n')
            .trim();
          if (!text) break;
          if (p.role === 'user') {
            ev({ ts: t, kind: 'user', text: clip(text) });
            if (!ctx.firstPrompt) {
              ctx.firstPrompt = text.slice(0, 90);
              this.applyTitle(ctx);
            }
          } else if (p.role === 'assistant') ev({ ts: t, kind: 'assistant', text: clip(text) });
          break;
        }
        case 'function_call': {
          if (NOISE.has(p.name)) {
            ctx.noiseCalls.add(p.call_id);
            this.store.upsert(id, { lastActivity: t });
            break;
          }
          const args = parseArgs(p.arguments);
          if (p.name === 'request_user_input') {
            ctx.pendingQuestion = p.call_id;
            this.store.upsert(id, {}, { question: true });
            ev({ ts: t, kind: 'question', label: 'request_user_input', text: questionText(args) });
          } else {
            ev({ ts: t, kind: 'tool', label: p.name, text: summarizeArgs(p.name, args) });
          }
          break;
        }
        case 'custom_tool_call':
          ev({ ts: t, kind: 'tool', label: p.name, text: summarizeExec(p.input ?? '') });
          break;
        case 'function_call_output':
        case 'custom_tool_call_output': {
          if (ctx.noiseCalls.delete(p.call_id)) break;
          const out = outputText(p.output);
          if (p.call_id && p.call_id === ctx.pendingQuestion) {
            ctx.pendingQuestion = undefined;
            this.store.upsert(id, {}, { question: false });
            ev({ ts: t, kind: 'user', label: 'resposta', text: clip(out, 2000) });
          } else if (out) {
            ev({ ts: t, kind: 'result', text: clip(out, 2000), isError: /exit code: [1-9]|error/i.test(out.slice(0, 200)) });
          }
          break;
        }
      }
    }
    this.store.addEvents(id, events);
  }
}

function parseArgs(raw: unknown): any {
  if (typeof raw !== 'string') return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Remove campos criptografados (gAAAA…) que o Codex guarda no lugar do texto. */
function dropEncrypted(v: any): any {
  if (typeof v === 'string') return v.startsWith('gAAAA') ? '[criptografado]' : v;
  if (Array.isArray(v)) return v.map(dropEncrypted);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dropEncrypted(x)]));
  return v;
}

function summarizeArgs(name: string, args: any): string {
  if (name === 'spawn_agent') return `${args.task_name ?? ''}${args.agent_type ? ` [${args.agent_type}]` : ''}`;
  if (name === 'send_message' || name === 'followup_task') return `→ ${args.target ?? ''}`;
  if (name === 'exec_command' || name === 'shell') return [args.cmd ?? args.command].flat().join(' ');
  if (name === 'js' && args.title) return args.title;
  return stringify(dropEncrypted(args), 400);
}

function summarizeExec(input: string): string {
  const cmds = [...input.matchAll(/cmd\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => {
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch {
      return m[1];
    }
  });
  return cmds.length ? cmds.join('\n') : clip(input.trim(), 600);
}

function outputText(out: unknown): string {
  if (typeof out === 'string') return out;
  if (Array.isArray(out)) return out.map((o: any) => o.text ?? '').join('\n');
  return '';
}

function questionText(args: any) {
  const qs = args?.questions ?? [];
  return qs
    .map((q: any) => `${q.question}\n${(q.options ?? []).map((o: any) => `  • ${o.label}`).join('\n')}`)
    .join('\n\n');
}
