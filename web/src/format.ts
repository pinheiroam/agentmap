import type { Agent, AgentStatus, Provider } from '../../daemon/src/types.ts';

export const PROVIDERS: Record<Provider, { label: string; short: string }> = {
  claude: { label: 'Claude Code', short: 'CL' },
  codex: { label: 'Codex', short: 'CX' },
  cursor: { label: 'Cursor', short: 'CU' },
};

export const STATUS: Record<AgentStatus, { label: string; order: number }> = {
  waiting: { label: 'Esperando você', order: 0 },
  working: { label: 'Trabalhando', order: 1 },
  idle: { label: 'Ocioso', order: 2 },
  done: { label: 'Encerrado', order: 3 },
};

export function ago(ts: number, now = Date.now()) {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return 'agora';
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export function clock(ts: number) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function shortPath(path?: string) {
  if (!path) return '';
  return path.replace(/^\/home\/[^/]+/, '~');
}

export function projectName(agent: Agent) {
  if (!agent.cwd) return 'sem pasta';
  const parts = shortPath(agent.cwd).split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

export function modelName(model?: string) {
  return model?.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}
