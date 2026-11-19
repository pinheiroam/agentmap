import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { Worktree } from './types.ts';

/**
 * Descobre em qual worktree git cada agente trabalha.
 *
 * A pasta inicial da sessão nem sempre basta: um agente aberto em ~/Projetos
 * costuma trabalhar dentro de repositórios aninhados ou de worktrees
 * (`git worktree add`, ~/.codex/worktrees…). Por isso também olhamos as pastas
 * que as ferramentas tocam: `workdir` do Codex, `file_path` e `cd …` do Claude.
 */

/** Extrai caminhos absolutos da entrada de uma ferramenta (objeto ou código). */
export function pathsFromInput(input: unknown): string[] {
  const text = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  const out = new Set<string>();
  for (const m of text.matchAll(/["']?(?:workdir|cwd|file_path|notebook_path|path)["']?\s*:\s*["'](\/[^"'\n]+)["']/g)) out.add(m[1]);
  for (const m of text.matchAll(/(?:^|[\s;&|(])cd\s+["']?(\/[^\s"'&;|)]+)/g)) out.add(m[1]);
  for (const m of text.matchAll(/git\s+-C\s+["']?(\/[^\s"'&;|)]+)/g)) out.add(m[1]);
  return [...out].slice(0, 8);
}

const rootCache = new Map<string, string | null>();
const infoCache = new Map<string, { at: number; wt: Worktree }>();
const BRANCH_TTL = 10_000;

/** Pasta raiz (que contém `.git`) mais próxima de um caminho, ou null fora de um repositório. */
export function gitRoot(path: string): string | null {
  if (!isAbsolute(path)) return null;
  let dir = resolve(path);
  const seen: string[] = [];
  let found: string | null = null;
  for (;;) {
    const cached = rootCache.get(dir);
    if (cached !== undefined) {
      found = cached;
      break;
    }
    seen.push(dir);
    if (isRepo(dir)) {
      found = dir;
      break;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  for (const d of seen) rootCache.set(d, found);
  if (rootCache.size > 20_000) rootCache.clear();
  return found;
}

/** `.git` de verdade: arquivo de worktree ligada ou pasta com HEAD (ignora `.git` vazios em /tmp etc.). */
function isRepo(dir: string) {
  try {
    const st = statSync(`${dir}/.git`);
    return st.isFile() || existsSync(`${dir}/.git/HEAD`);
  } catch {
    return false;
  }
}

/** Repositório, branch e tipo (principal ou worktree ligada) de uma raiz git. */
export function worktreeInfo(root: string): Worktree {
  const hit = infoCache.get(root);
  if (hit && Date.now() - hit.at < BRANCH_TTL) return hit.wt;
  let gitDir = `${root}/.git`;
  let linked = false;
  let repo = root;
  try {
    if (statSync(gitDir).isFile()) {
      // worktree ligada: ".git" é um arquivo "gitdir: <repo>/.git/worktrees/<nome>"
      const m = /gitdir:\s*(.+)/.exec(readFileSync(gitDir, 'utf8'));
      if (m) {
        gitDir = resolve(root, m[1].trim());
        linked = true;
        const common = existsSync(`${gitDir}/commondir`) ? resolve(gitDir, readFileSync(`${gitDir}/commondir`, 'utf8').trim()) : dirname(dirname(gitDir));
        repo = dirname(common);
      }
    }
  } catch {
    /* sem acesso: trata como repositório simples */
  }
  let branch: string | undefined;
  try {
    const head = readFileSync(`${gitDir}/HEAD`, 'utf8').trim();
    branch = head.startsWith('ref:') ? head.replace(/^ref:\s*refs\/heads\//, '') : head.slice(0, 8);
  } catch {
    /* HEAD ilegível */
  }
  const wt: Worktree = { root, repo, branch, linked, git: true };
  infoCache.set(root, { at: Date.now(), wt });
  return wt;
}

/**
 * Escolhe a worktree de um agente: a raiz git mais frequente entre as últimas
 * pastas tocadas (empate: a mais recente); sem nada tocado, a da pasta inicial.
 */
export function pickWorktree(recentRoots: string[], cwd?: string): Worktree | undefined {
  const last = recentRoots.slice(-12);
  if (last.length) {
    const count = new Map<string, number>();
    for (const r of last) count.set(r, (count.get(r) ?? 0) + 1);
    let best = last[last.length - 1];
    for (let i = last.length - 1; i >= 0; i--) if (count.get(last[i])! > count.get(best)!) best = last[i];
    return worktreeInfo(best);
  }
  if (!cwd) return undefined;
  const root = gitRoot(cwd);
  return root ? worktreeInfo(root) : { root: cwd, repo: cwd, linked: false, git: false };
}
