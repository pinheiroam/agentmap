import { EventEmitter } from 'node:events';
import { config } from './config.ts';
import type { Agent, AgentEvent, AgentStatus, Approval, Decision } from './types.ts';

/** Sinais que os coletores fornecem para derivar o status. */
export interface StatusHints {
  /** false quando sabemos que o processo morreu. */
  alive?: boolean;
  /** Status informado pela própria ferramenta (ex.: registro de sessões do Claude). */
  reported?: AgentStatus;
  /** Turno em andamento (Codex: task_started sem task_complete). */
  turnOpen?: boolean;
  /** Ferramenta pediu input do usuário e ainda não houve resposta. */
  question?: boolean;
  /** Concluído de forma definitiva (ex.: subagente cujo resultado já voltou ao pai). */
  finished?: boolean;
}

interface Entry {
  agent: Agent;
  hints: StatusHints;
  events: AgentEvent[];
}

interface PendingApproval {
  approval: Approval;
  resolve: (d: { decision: Decision; message?: string }) => void;
}

const MIN = 60_000;

export class Store extends EventEmitter {
  private entries = new Map<string, Entry>();
  private sent = new Map<string, string>();
  private newEvents = new Map<string, AgentEvent[]>();
  private approvals = new Map<string, PendingApproval>();

  has(id: string) {
    return this.entries.has(id);
  }

  get(id: string): Agent | undefined {
    return this.entries.get(id)?.agent;
  }

  upsert(id: string, patch: Partial<Agent>, hints?: StatusHints) {
    let e = this.entries.get(id);
    if (!e) {
      const now = Date.now();
      e = {
        agent: {
          id,
          provider: patch.provider ?? 'claude',
          title: '',
          status: 'idle',
          startedAt: now,
          lastActivity: 0,
          stats: { messages: 0, tools: 0, errors: 0 },
        },
        hints: {},
        events: [],
      };
      this.entries.set(id, e);
    }
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (e.agent as any)[k] = v;
    if (hints) Object.assign(e.hints, hints);
    return e.agent;
  }

  addEvents(id: string, events: AgentEvent[]) {
    const e = this.entries.get(id);
    if (!e || events.length === 0) return;
    for (const ev of events) {
      if (ev.kind === 'user' || ev.kind === 'assistant') e.agent.stats.messages++;
      if (ev.kind === 'tool') {
        e.agent.stats.tools++;
        e.agent.lastAction = ev.label ? `${shortTool(ev.label)}: ${firstLine(ev.text)}` : firstLine(ev.text);
      }
      if (ev.isError) e.agent.stats.errors++;
      if (ev.ts > e.agent.lastActivity) e.agent.lastActivity = ev.ts;
    }
    e.events.push(...events);
    if (e.events.length > config.maxEvents) e.events.splice(0, e.events.length - config.maxEvents);
    const pending = this.newEvents.get(id) ?? [];
    pending.push(...events);
    this.newEvents.set(id, pending);
  }

  events(id: string) {
    return this.entries.get(id)?.events ?? [];
  }

  remove(id: string) {
    this.entries.delete(id);
  }

  list(): Agent[] {
    return [...this.entries.values()].map((e) => e.agent);
  }

  /** Recalcula status e emite apenas o que mudou desde o último tick. */
  tick() {
    const now = Date.now();
    const waitingAgents = new Set([...this.approvals.values()].map((p) => p.approval.agentId));
    const changed: Agent[] = [];
    for (const e of this.entries.values()) {
      e.agent.status = deriveStatus(e, now, waitingAgents.has(e.agent.id));
      const json = JSON.stringify(e.agent);
      if (this.sent.get(e.agent.id) !== json) {
        this.sent.set(e.agent.id, json);
        changed.push(e.agent);
      }
    }
    const removed = [...this.sent.keys()].filter((id) => !this.entries.has(id));
    for (const id of removed) this.sent.delete(id);
    if (changed.length || removed.length) this.emit('agents', changed, removed);
    for (const [id, evs] of this.newEvents) this.emit('events', id, evs);
    this.newEvents.clear();
  }

  // ---- aprovações ----

  listApprovals(): Approval[] {
    return [...this.approvals.values()].map((p) => p.approval);
  }

  requestApproval(approval: Approval): Promise<{ decision: Decision; message?: string }> {
    return new Promise((resolve) => {
      this.approvals.set(approval.id, { approval, resolve });
      this.emit('approval', approval);
    });
  }

  resolveApproval(id: string, decision: Decision, message?: string) {
    const p = this.approvals.get(id);
    if (!p) return false;
    this.approvals.delete(id);
    p.resolve({ decision, message });
    this.emit('approvalResolved', id);
    return true;
  }
}

function deriveStatus({ agent, hints }: Entry, now: number, hasApproval: boolean): AgentStatus {
  const age = now - agent.lastActivity;
  if (hasApproval || hints.question) return 'waiting';
  if (hints.finished || hints.alive === false) return 'done';
  if (hints.reported) return hints.reported;
  if (hints.turnOpen !== undefined) {
    if (hints.turnOpen) return age < 15 * MIN ? 'working' : 'idle';
    return age < 30 * MIN ? 'idle' : 'done';
  }
  if (age < 45_000) return 'working';
  return age < 30 * MIN ? 'idle' : 'done';
}

export function firstLine(text: string, max = 140) {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

/** "mcp__servidor__ferramenta" -> "ferramenta" */
export function shortTool(name: string) {
  return name.split('__').pop() || name;
}

export function clip(text: string, max = 4000) {
  return text.length > max ? text.slice(0, max) + `\n… (+${text.length - max} caracteres)` : text;
}
