import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { Agent } from '../../daemon/src/types.ts';
import { PROVIDERS, STATUS, ago, modelName } from './format.ts';
import { fmtTokens } from './levels.ts';

export type AgentNodeData = { agent: Agent; now: number; children: number; approvals: number; xp: number };
export type ProjectNodeData = { label: string; path: string; active: number; total: number };

export const AgentNode = memo(function AgentNode({ data, selected }: NodeProps<Node<AgentNodeData>>) {
  const { agent, now, children, approvals, xp } = data;
  const p = PROVIDERS[agent.provider];
  return (
    <div className={`node node--${agent.status} node--${agent.provider}${selected ? ' is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node__top">
        <span className={`badge badge--${agent.provider}`} title={p.label}>
          {p.short}
        </span>
        {agent.role && <span className="node__role">{agent.role}</span>}
        <span className="node__time">{ago(agent.lastActivity, now)}</span>
      </div>
      <div className="node__title" title={agent.title}>
        {agent.title || '(sem título)'}
      </div>
      <div className="node__action" title={agent.lastAction}>
        {agent.status === 'waiting' && approvals > 0
          ? `⚑ ${approvals} aprovação${approvals > 1 ? 'ões' : ''} pendente${approvals > 1 ? 's' : ''}`
          : agent.lastAction || '—'}
      </div>
      <div className="node__foot">
        <span className={`status status--${agent.status}`}>
          <i />
          {STATUS[agent.status].label}
        </span>
        <span className="node__meta">
          {xp > 0 && (
            <span className="node__xp" title="XP (tokens novos) desta sessão">
              ⚡ {fmtTokens(xp)}
            </span>
          )}
          {!xp && modelName(agent.model) && <span>{modelName(agent.model)}</span>}
          {agent.context && (
            <span title="Janela de contexto usada" className={agent.context.used / agent.context.limit > 0.8 ? 'err' : undefined}>
              🔷 {Math.round((agent.context.used / agent.context.limit) * 100)}%
            </span>
          )}
          <span title="Ferramentas usadas">⚙ {agent.stats.tools}</span>
          {children > 0 && <span title="Subagentes">⑂ {children}</span>}
        </span>
      </div>
      {agent.status === 'working' && <div className="node__pulse" />}
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

export const ProjectNode = memo(function ProjectNode({ data }: NodeProps<Node<ProjectNodeData>>) {
  return (
    <div className="project" title={data.path}>
      <span className="project__icon">◆</span>
      <span className="project__label">{data.label}</span>
      <span className="project__count">
        {data.active > 0 && <b>{data.active}</b>}
        {data.total}
      </span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});
