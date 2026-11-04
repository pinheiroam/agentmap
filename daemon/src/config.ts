import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const home = homedir();

export const config = {
  host: '127.0.0.1',
  port: Number(process.env.AGENTMAP_PORT ?? 4317),
  /** Só carrega sessões com atividade nessa janela (sessões vivas sempre entram). */
  windowHours: Number(process.env.AGENTMAP_WINDOW_HOURS ?? 24),
  /** Quantos eventos manter por agente em memória. */
  maxEvents: 500,
  /** Arquivos maiores que isso são lidos só a partir do final. */
  maxInitialRead: 8 * 1024 * 1024,
  paths: {
    claudeProjects: join(home, '.claude', 'projects'),
    claudeSessions: join(home, '.claude', 'sessions'),
    codexSessions: join(home, '.codex', 'sessions'),
    codexIndex: join(home, '.codex', 'session_index.jsonl'),
    cursorProjects: join(home, '.cursor', 'projects'),
  },
  stateDir: join(home, '.config', 'agentmap'),
};

/** Token compartilhado com o hook do Claude. Fica em ~/.config/agentmap/token (0600). */
export function loadToken(): string {
  const file = join(config.stateDir, 'token');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  const token = randomBytes(24).toString('hex');
  writeFileSync(file, token + '\n', { mode: 0o600 });
  return token;
}
