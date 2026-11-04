import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent, AgentEvent, Approval, ClientMessage, Decision, Progress, ServerMessage } from '../../daemon/src/types.ts';

export interface AgentmapState {
  connected: boolean;
  agents: Map<string, Agent>;
  approvals: Approval[];
  events: AgentEvent[];
  progress: Progress | null;
  subscribe: (agentId: string | null) => void;
  decide: (id: string, decision: Decision, message?: string) => void;
}

/** Conexão WebSocket com o daemon, com reconexão automática. */
export function useAgentmap(): AgentmapState {
  const [connected, setConnected] = useState(false);
  const [agents, setAgents] = useState<Map<string, Agent>>(new Map());
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const subscribed = useRef<string | null>(null);

  const send = useCallback((msg: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.current = socket;
      socket.onopen = () => {
        retry = 0;
        setConnected(true);
        if (subscribed.current) send({ type: 'subscribe', agentId: subscribed.current });
      };
      socket.onclose = () => {
        setConnected(false);
        if (!closed) timer = setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
      };
      socket.onmessage = (e) => {
        const msg: ServerMessage = JSON.parse(e.data);
        switch (msg.type) {
          case 'snapshot':
            setAgents(new Map(msg.agents.map((a) => [a.id, a])));
            setApprovals(msg.approvals);
            break;
          case 'agents':
            setAgents((prev) => {
              const next = new Map(prev);
              for (const a of msg.agents) next.set(a.id, a);
              for (const id of msg.removed) next.delete(id);
              return next;
            });
            break;
          case 'events':
            if (msg.agentId !== subscribed.current) break;
            setEvents((prev) => (msg.reset ? msg.events : [...prev, ...msg.events].slice(-800)));
            break;
          case 'approval':
            setApprovals((prev) => [...prev.filter((a) => a.id !== msg.approval.id), msg.approval]);
            break;
          case 'approvalResolved':
            setApprovals((prev) => prev.filter((a) => a.id !== msg.id));
            break;
          case 'progress':
            setProgress(msg.progress);
            break;
        }
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws.current?.close();
    };
  }, [send]);

  const subscribe = useCallback(
    (agentId: string | null) => {
      subscribed.current = agentId;
      setEvents([]);
      send({ type: 'subscribe', agentId });
    },
    [send],
  );

  const decide = useCallback(
    (id: string, decision: Decision, message?: string) => send({ type: 'decide', id, decision, message }),
    [send],
  );

  return { connected, agents, approvals, events, progress, subscribe, decide };
}
