import { EventEmitter } from 'node:events';
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { config } from './config.ts';
import type { Progress, Provider, SaveFile, SaveSession, TokenTotals } from './types.ts';

/**
 * Livro-razão de tokens: lê TODO o histórico de transcrições (não só a janela
 * de 24 h) e guarda, por arquivo, quanto já foi contado e até onde foi lido.
 * O resultado fica em ~/.config/agentmap/ledger.json; depois da primeira
 * leitura, só as linhas novas de cada arquivo são processadas.
 */

/** XP = tokens novos. Leitura de cache é o mesmo contexto relido a cada turno e não conta. */
export function xpOf(t: Pick<TokenTotals, 'input' | 'output' | 'cacheWrite'>) {
  return t.input + t.output + t.cacheWrite;
}

interface Entry {
  size: number;
  mtimeMs: number;
  /** Fim da última linha completa já processada. */
  offset: number;
  provider: Provider;
  agentId: string;
  character: string;
  cwd?: string;
  totals: TokenTotals;
  byDay: Record<string, number>;
  last: number;
  // estado para continuar a leitura incremental
  seenIds?: string[];
  codexPrev?: { input: number; cached: number; output: number };
  metaSeen?: boolean;
  archived?: boolean;
  /** Veio de um save importado (outra máquina ou transcrição já apagada). */
  imported?: string;
}

const VERSION = 3;
const MARKERS: Record<Provider, string[]> = {
  claude: ['"usage"', '"cwd"'],
  codex: ['"token_count"', '"session_meta"'],
  cursor: ['"role"'],
};

export class Ledger extends EventEmitter {
  private entries = new Map<string, Entry>();
  private file = join(config.stateDir, 'ledger.json');
  private dirty = false;
  private scanning = false;
  ready = false;
  progress = { done: 0, total: 0 };

  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (data.version === VERSION) for (const [k, v] of Object.entries(data.files)) this.entries.set(k, v as Entry);
    } catch {
      /* primeira execução */
    }
  }

  async save() {
    if (!this.dirty) return;
    this.dirty = false;
    const tmp = this.file + '.tmp';
    await writeFile(tmp, JSON.stringify({ version: VERSION, files: Object.fromEntries(this.entries) }));
    await rename(tmp, this.file);
  }

  /** Percorre todos os arquivos conhecidos e processa o que mudou. */
  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const files = await this.listFiles();
      this.progress = { done: 0, total: files.length };
      let changed = false;
      for (const f of files) {
        if (await this.update(f.path, f.provider, f.archived)) changed = true;
        this.progress.done++;
        if (!this.ready && this.progress.done % 25 === 0) this.emit('progress');
      }
      if (changed || !this.ready) {
        this.ready = true;
        this.dirty = true;
        this.emit('change');
      }
      await this.save();
    } finally {
      this.scanning = false;
    }
  }

  private async listFiles() {
    const out: { path: string; provider: Provider; archived?: boolean }[] = [];
    const { claudeProjects, codexSessions, cursorProjects } = config.paths;
    for (const proj of await ls(claudeProjects)) {
      const dir = join(claudeProjects, proj);
      for (const name of await ls(dir)) {
        if (name.endsWith('.jsonl')) out.push({ path: join(dir, name), provider: 'claude' });
        for (const sub of await ls(join(dir, name, 'subagents'))) {
          if (sub.endsWith('.jsonl')) out.push({ path: join(dir, name, 'subagents', sub), provider: 'claude' });
        }
      }
    }
    const walk = async (dir: string, depth: number) => {
      for (const name of await ls(dir)) {
        const p = join(dir, name);
        if (depth < 3) await walk(p, depth + 1);
        else if (name.startsWith('rollout-') && name.endsWith('.jsonl')) out.push({ path: p, provider: 'codex' });
      }
    };
    await walk(codexSessions, 0);
    const archived = join(dirname(codexSessions), 'archived_sessions');
    for (const name of await ls(archived)) {
      if (name.startsWith('rollout-') && /\.jsonl(\.zst)?$/.test(name)) out.push({ path: join(archived, name), provider: 'codex', archived: true });
    }
    for (const proj of await ls(cursorProjects)) {
      const dir = join(cursorProjects, proj, 'agent-transcripts');
      for (const sid of await ls(dir)) out.push({ path: join(dir, sid, `${sid}.jsonl`), provider: 'cursor' });
    }
    return out;
  }

  private async update(path: string, provider: Provider, archived?: boolean): Promise<boolean> {
    let st;
    try {
      st = await stat(path);
    } catch {
      return false;
    }
    let e = this.entries.get(path);
    if (e && e.size === st.size && e.mtimeMs === st.mtimeMs) return false;
    // Arquivo reescrito (encolheu) ou compactado: recomeça do zero.
    if (e && (st.size < e.offset || archived)) e = undefined;
    if (!e) {
      e = newEntry(path, provider);
      if (provider === 'claude') await claudeMeta(path, e);
    }
    e.archived = archived;

    let text: string;
    if (path.endsWith('.zst')) {
      text = zstdDecompressSync(await readFile(path)).toString('utf8');
    } else {
      const fh = await open(path, 'r');
      try {
        const buf = Buffer.alloc(st.size - e.offset);
        await fh.read(buf, 0, buf.length, e.offset);
        text = buf.toString('utf8');
      } finally {
        await fh.close();
      }
    }
    const end = path.endsWith('.zst') ? text.length : text.lastIndexOf('\n') + 1;
    const markers = MARKERS[provider];
    let pos = 0;
    while (pos < end) {
      let nl = text.indexOf('\n', pos);
      if (nl < 0 || nl >= end) nl = end;
      const line = text.slice(pos, nl);
      pos = nl + 1;
      if (!markers.some((m) => line.includes(m))) continue;
      let r: any;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      if (provider === 'claude') ingestClaude(e, r);
      else if (provider === 'codex') ingestCodex(e, r);
      else ingestCursor(e, r, st.mtimeMs);
    }
    // Avança só até a última linha completa (Buffer conta bytes; a string, caracteres).
    e.offset = path.endsWith('.zst') ? st.size : e.offset + Buffer.byteLength(text.slice(0, end), 'utf8');
    e.size = st.size;
    e.mtimeMs = st.mtimeMs;
    if (provider === 'cursor') e.last = st.mtimeMs;
    this.entries.set(path, e);
    this.dirty = true;
    return true;
  }

  /**
   * Uma entrada por agente. A mesma sessão pode aparecer duas vezes (Codex
   * arquivado + ativo, ou save importado + arquivo local): fica a mais completa.
   */
  private bestByAgent(): Entry[] {
    const best = new Map<string, Entry>();
    for (const e of this.entries.values()) {
      const cur = best.get(e.agentId);
      if (!cur || xpOf(e.totals) + e.totals.cacheRead > xpOf(cur.totals) + cur.totals.cacheRead) best.set(e.agentId, e);
    }
    return [...best.values()];
  }

  // ---------------- save portátil ----------------

  exportSave(): SaveFile {
    const sessions: SaveSession[] = this.bestByAgent()
      .filter((e) => xpOf(e.totals) + e.totals.cacheRead > 0)
      .map((e) => ({
        agentId: e.agentId,
        provider: e.provider,
        character: e.character,
        cwd: e.cwd,
        totals: e.totals,
        byDay: e.byDay,
        last: e.last,
        origin: e.imported ?? hostname(),
      }));
    return { format: 'agentmap-save', version: 1, exportedAt: new Date().toISOString(), machine: hostname(), sessions };
  }

  /** Mescla um save. Sessões já conhecidas não são contadas de novo. */
  async importSave(save: SaveFile) {
    if (save?.format !== 'agentmap-save' || !Array.isArray(save.sessions)) throw new Error('arquivo não é um save do agentmap');
    let added = 0;
    let updated = 0;
    for (const s of save.sessions) {
      if (!s?.agentId || !s.totals) continue;
      const key = `import:${s.agentId}`;
      const prev = this.entries.get(key);
      if (prev && xpOf(prev.totals) >= xpOf(s.totals)) continue;
      prev ? updated++ : added++;
      this.entries.set(key, {
        size: 0,
        mtimeMs: 0,
        offset: 0,
        provider: s.provider,
        agentId: s.agentId,
        character: s.character,
        cwd: s.cwd,
        totals: { ...emptyTotals(), ...s.totals },
        byDay: s.byDay ?? {},
        last: s.last ?? 0,
        imported: s.origin ?? save.machine ?? 'importado',
      });
    }
    this.dirty = true;
    await this.save();
    this.emit('change');
    return { added, updated, total: save.sessions.length };
  }

  /** Backup diário automático em ~/.config/agentmap/backups (mantém os 14 mais recentes). */
  async backup() {
    if (!this.ready) return;
    const dir = join(config.stateDir, 'backups');
    await mkdir(dir, { recursive: true });
    const d = new Date();
    const name = `agentmap-save-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    await writeFile(join(dir, name), JSON.stringify(this.exportSave()));
    const old = (await ls(dir)).filter((n) => n.startsWith('agentmap-save-')).sort().slice(0, -14);
    for (const n of old) await unlink(join(dir, n)).catch(() => {});
  }

  summary(liveIds: Set<string>): Progress {
    const guild: TokenTotals = emptyTotals();
    const characters = new Map<string, Progress['characters'][number]>();
    const days: Record<string, Record<Provider, number>> = {};
    const projects = new Map<string, number>();
    const sessions: Progress['sessions'] = {};
    const seenAgents = new Set<string>();

    for (const e of this.bestByAgent()) {
      const xp = xpOf(e.totals);
      if (xp === 0 && e.totals.cacheRead === 0) continue;
      addTotals(guild, e.totals);
      let c = characters.get(e.character);
      if (!c) {
        const [provider, role] = e.character.split(':') as [Provider, string];
        c = { key: e.character, provider, role, xp: 0, sessions: 0, last: 0, estimated: provider === 'cursor' };
        characters.set(e.character, c);
      }
      c.xp += xp;
      if (!seenAgents.has(e.agentId)) c.sessions++;
      seenAgents.add(e.agentId);
      c.last = Math.max(c.last, e.last);
      for (const [d, v] of Object.entries(e.byDay)) {
        days[d] ??= { claude: 0, codex: 0, cursor: 0 };
        days[d][e.provider] += v;
      }
      if (e.cwd) projects.set(e.cwd, (projects.get(e.cwd) ?? 0) + xp);
      if (liveIds.has(e.agentId)) {
        const s = (sessions[e.agentId] ??= { character: e.character, totals: emptyTotals() });
        addTotals(s.totals, e.totals);
      }
    }
    return {
      ready: this.ready,
      scanned: this.progress,
      guild,
      characters: [...characters.values()].sort((a, b) => b.xp - a.xp),
      days,
      projects: [...projects].map(([cwd, xp]) => ({ cwd, xp })).sort((a, b) => b.xp - a.xp),
      sessions,
    };
  }
}

// ---------------- leitura por fornecedor ----------------

function ingestClaude(e: Entry, r: any) {
  if (!e.cwd && r.cwd) e.cwd = r.cwd;
  const u = r.type === 'assistant' ? r.message?.usage : undefined;
  if (!u) return;
  // O Claude grava uma linha por bloco de conteúdo, todas com o mesmo usage: conta uma vez por mensagem.
  const id = r.message?.id ?? r.requestId;
  e.seenIds ??= [];
  if (id && e.seenIds.includes(id)) return;
  if (id) {
    e.seenIds.push(id);
    if (e.seenIds.length > 40) e.seenIds.shift();
  }
  const t = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 };
  addTotals(e.totals, t);
  addDay(e, Date.parse(r.timestamp), xpOf(t));
}

function ingestCodex(e: Entry, r: any) {
  const p = r.payload ?? {};
  if (r.type === 'session_meta') {
    // Subagentes copiam o cabeçalho da thread pai mais adiante no arquivo: vale só o primeiro.
    // O id da sessão já vem do nome do arquivo.
    if (e.metaSeen) return;
    e.metaSeen = true;
    e.cwd = p.cwd;
    e.character = `codex:${p.agent_role ?? (p.parent_thread_id ? 'subagente' : 'main')}`;
    return;
  }
  const total = p.type === 'token_count' ? p.info?.total_token_usage : undefined;
  if (!total) return;
  // total_token_usage é acumulado na thread: soma só a diferença desde o último evento.
  const cur = { input: total.input_tokens ?? 0, cached: total.cached_input_tokens ?? 0, output: total.output_tokens ?? 0 };
  const prev = e.codexPrev ?? { input: 0, cached: 0, output: 0 };
  const reset = cur.input < prev.input || cur.output < prev.output;
  const base = reset ? { input: 0, cached: 0, output: 0 } : prev;
  const dIn = cur.input - base.input;
  const dCached = cur.cached - base.cached;
  const t = { input: Math.max(0, dIn - dCached), cacheRead: Math.max(0, dCached), output: Math.max(0, cur.output - base.output), cacheWrite: 0 };
  e.codexPrev = cur;
  addTotals(e.totals, t);
  addDay(e, Date.parse(r.timestamp), xpOf(t));
}

/** O Cursor não grava tokens: estimamos ~4 caracteres por token. */
function ingestCursor(e: Entry, r: any, mtime: number) {
  let chars = 0;
  for (const b of r.message?.content ?? []) chars += JSON.stringify(b.text ?? b.input ?? '').length;
  const tokens = Math.round(chars / 4);
  if (r.role === 'assistant') e.totals.output += tokens;
  else e.totals.input += tokens;
  addDay(e, mtime, tokens);
}

async function claudeMeta(path: string, e: Entry) {
  const parts = path.split('/');
  const i = parts.indexOf('subagents');
  if (i < 0) {
    e.agentId = `claude:${basename(path, '.jsonl')}`;
    e.character = 'claude:main';
    return;
  }
  const session = parts[i - 1];
  const sub = basename(path, '.jsonl').replace(/^agent-/, '');
  e.agentId = `claude:${session}/${sub}`;
  let role = 'subagente';
  try {
    const meta = JSON.parse(await readFile(path.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
    if (meta.agentType) role = meta.agentType;
  } catch {
    /* sem meta */
  }
  e.character = `claude:${role}`;
}

// ---------------- utilitários ----------------

function newEntry(path: string, provider: Provider): Entry {
  const id = basename(path).replace(/\.jsonl(\.zst)?$/, '');
  return {
    size: 0,
    mtimeMs: 0,
    offset: 0,
    provider,
    agentId: provider === 'codex' ? `codex:${id.slice(-36)}` : `${provider}:${id}`,
    character: `${provider}:main`,
    totals: emptyTotals(),
    byDay: {},
    last: 0,
  };
}

function emptyTotals(): TokenTotals {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

function addTotals(a: TokenTotals, b: TokenTotals) {
  a.input += b.input;
  a.output += b.output;
  a.cacheWrite += b.cacheWrite;
  a.cacheRead += b.cacheRead;
}

function addDay(e: Entry, t: number, xp: number) {
  if (!Number.isFinite(t) || xp <= 0) return;
  const d = new Date(t);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  e.byDay[key] = (e.byDay[key] ?? 0) + xp;
  e.last = Math.max(e.last, t);
}

async function ls(dir: string) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
