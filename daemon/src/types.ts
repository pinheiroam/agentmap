// Modelo normalizado, igual para todos os fornecedores. A UI importa este arquivo.

export type Provider = 'claude' | 'codex' | 'cursor';

/**
 * working: executando agora
 * waiting: parado esperando você (aprovação ou pergunta)
 * idle:    sessão aberta, sem turno em andamento
 * done:    encerrada (processo morto, subagente concluído ou sessão antiga)
 */
export type AgentStatus = 'working' | 'waiting' | 'idle' | 'done';

export interface Agent {
  id: string;
  provider: Provider;
  parentId?: string;
  title: string;
  role?: string;
  cwd?: string;
  pid?: number;
  model?: string;
  status: AgentStatus;
  startedAt: number;
  lastActivity: number;
  lastAction?: string;
  stats: { messages: number; tools: number; errors: number };
  /** Comando para retomar a sessão num terminal, quando existir. */
  resume?: string;
  /** Janela de contexto: tokens em uso no último turno e limite do modelo. */
  context?: { used: number; limit: number; estimated: boolean };
}

export type EventKind = 'user' | 'assistant' | 'tool' | 'result' | 'question' | 'system';

export interface AgentEvent {
  id: string;
  ts: number;
  kind: EventKind;
  /** Nome da ferramenta ou rótulo curto. */
  label?: string;
  text: string;
  isError?: boolean;
}

export interface Approval {
  id: string;
  provider: Provider;
  agentId: string;
  tool: string;
  summary: string;
  input: unknown;
  cwd?: string;
  createdAt: number;
  canAlwaysAllow: boolean;
}

export type Decision = 'allow' | 'allow_always' | 'deny' | 'ask';

export interface TokenTotals {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/**
 * Progressão calculada a partir de todo o histórico de tokens.
 * Personagem = fornecedor + papel ("claude:main", "codex:code_reviewer"…).
 */
export interface Progress {
  ready: boolean;
  scanned: { done: number; total: number };
  guild: TokenTotals;
  characters: { key: string; provider: Provider; role: string; xp: number; sessions: number; last: number; estimated: boolean }[];
  /** XP por dia (data local AAAA-MM-DD) e fornecedor. */
  days: Record<string, Record<Provider, number>>;
  projects: { cwd: string; xp: number }[];
  /** Tokens das sessões que estão no mapa agora. */
  sessions: Record<string, { character: string; totals: TokenTotals }>;
}

/** Save portátil: leve o XP para outra máquina ou guarde depois que as transcrições somem. */
export interface SaveSession {
  agentId: string;
  provider: Provider;
  character: string;
  cwd?: string;
  totals: TokenTotals;
  byDay: Record<string, number>;
  last: number;
  /** Máquina onde a sessão rodou. */
  origin?: string;
}

export interface SaveFile {
  format: 'agentmap-save';
  version: 1;
  exportedAt: string;
  machine: string;
  sessions: SaveSession[];
}

export type ServerMessage =
  | { type: 'snapshot'; agents: Agent[]; approvals: Approval[] }
  | { type: 'agents'; agents: Agent[]; removed: string[] }
  | { type: 'events'; agentId: string; events: AgentEvent[]; reset: boolean }
  | { type: 'approval'; approval: Approval }
  | { type: 'approvalResolved'; id: string }
  | { type: 'progress'; progress: Progress };

export type ClientMessage =
  | { type: 'subscribe'; agentId: string | null }
  | { type: 'decide'; id: string; decision: Decision; message?: string };
