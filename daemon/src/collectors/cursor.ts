import { join } from 'node:path';
import { config } from '../config.ts';
import { JsonlTail } from '../jsonl.ts';
import { clip, type Store } from '../store.ts';
import type { AgentEvent } from '../types.ts';
import { summarizeTool } from './claude.ts';
import { listDir, mtime, stringify, unflattenPath } from './util.ts';

/**
 * Cursor (agente) grava ~/.cursor/projects/<caminho-achatado>/agent-transcripts/<id>/<id>.jsonl.
 * Os registros não têm timestamp; usamos a tag <timestamp> das mensagens do usuário e o mtime do arquivo.
 */

interface FileCtx {
  tail: JsonlTail;
  agentId: string;
  seq: number;
  loaded: boolean;
  lastTs?: number;
}

export class CursorCollector {
  private files = new Map<string, FileCtx>();
  private cwdCache = new Map<string, string | undefined>();

  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  async scan() {
    const cutoff = Date.now() - config.windowHours * 3600_000;
    const root = config.paths.cursorProjects;
    for (const proj of await listDir(root)) {
      const dir = join(root, proj, 'agent-transcripts');
      for (const sid of await listDir(dir)) {
        const path = join(dir, sid, `${sid}.jsonl`);
        if (this.files.has(path)) continue;
        const m = await mtime(path);
        if (m < cutoff) continue;
        if (!this.cwdCache.has(proj)) this.cwdCache.set(proj, unflattenPath(proj));
        const agentId = `cursor:${sid}`;
        this.files.set(path, { tail: new JsonlTail(path), agentId, seq: 0, loaded: false });
        this.store.upsert(agentId, { provider: 'cursor', cwd: this.cwdCache.get(proj), title: 'Cursor agent' });
      }
    }
  }

  async read() {
    for (const ctx of this.files.values()) {
      const records = await ctx.tail.read();
      if (records.length) this.ingest(ctx, records);
    }
  }

  private ingest(ctx: FileCtx, records: any[]) {
    const id = ctx.agentId;
    const events: AgentEvent[] = [];
    const fileTime = ctx.tail.mtimeMs;
    // Na carga inicial não sabemos o horário de cada linha; depois disso, "agora" é bom o bastante.
    const now = () => (ctx.loaded ? Date.now() : (ctx.lastTs ?? fileTime));

    for (const r of records) {
      for (const b of r.message?.content ?? []) {
        if (b.type === 'text' && r.role === 'user') {
          const stamp = parseCursorTimestamp(b.text);
          if (stamp) ctx.lastTs = stamp;
          const query = b.text.match(/<user_query>([\s\S]*?)<\/user_query>/)?.[1]?.trim();
          const text = query ?? b.text.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').trim();
          if (!text) continue;
          events.push({ id: `${id}#${ctx.seq++}`, ts: now(), kind: 'user', text: clip(text) });
          if (this.store.get(id)?.title === 'Cursor agent') {
            this.store.upsert(id, { title: text.slice(0, 90), startedAt: ctx.lastTs ?? fileTime });
          }
        } else if (b.type === 'text' && b.text?.trim()) {
          events.push({ id: `${id}#${ctx.seq++}`, ts: now(), kind: 'assistant', text: clip(b.text) });
        } else if (b.type === 'tool_use') {
          const input = b.input ?? {};
          const text = input.command ?? input.path ?? input.file_path ?? (summarizeTool(b.name, input) || stringify(input, 400));
          events.push({ id: `${id}#${ctx.seq++}`, ts: now(), kind: 'tool', label: b.name, text });
        }
      }
    }
    this.store.addEvents(id, events);
    this.store.upsert(id, { lastActivity: fileTime });
    ctx.loaded = true;
  }
}

/** "Wednesday, Sep 30, 2026, 7:52 AM (UTC-4)" -> epoch ms */
function parseCursorTimestamp(text: string): number | undefined {
  const m = text.match(/<timestamp>\s*\w+,\s*(.+?)\s*\(UTC([+-]\d+)(?::(\d+))?\)\s*<\/timestamp>/);
  if (!m) return undefined;
  const sign = m[2].startsWith('-') ? '-' : '+';
  const hours = m[2].replace(/[+-]/, '').padStart(2, '0');
  const t = Date.parse(`${m[1]} GMT${sign}${hours}${(m[3] ?? '00').padStart(2, '0')}`);
  return Number.isNaN(t) ? undefined : t;
}
