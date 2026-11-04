import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export async function mtime(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

export async function readJson<T = any>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Confere se o PID existe e (opcionalmente) se é o mesmo processo, pelo starttime de /proc. */
export async function pidAlive(pid: number, procStart?: string): Promise<boolean> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    if (!procStart) return true;
    // O campo 2 (comm) pode conter espaços; os campos seguintes começam após o último ')'.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return fields[19] === procStart;
  } catch {
    return false;
  }
}

export function ts(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return t;
  }
  return fallback;
}

/**
 * Reconstrói um caminho a partir de um nome achatado como
 * "home-arthur-pinheiro-Projetos-new-api-laravel", testando no disco
 * quais hífens são separadores de diretório.
 */
export function unflattenPath(flat: string): string | undefined {
  const parts = flat.replace(/^-/, '').split('-');
  const walk = (base: string, i: number): string | undefined => {
    if (i === parts.length) return base;
    for (let j = parts.length; j > i; j--) {
      const candidate = join(base, parts.slice(i, j).join('-'));
      if (existsSync(candidate)) {
        const found = walk(candidate, j);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk('/', 0);
}

export function stringify(value: unknown, max = 160): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
