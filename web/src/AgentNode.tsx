import { memo, type CSSProperties } from 'react';
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

export type WorktreeNodeData = {
  /** Repositório (ou pasta, sem git). */
  name: string;
  /** Nome da worktree ligada (`git worktree add`); ausente na worktree principal. */
  worktree?: string;
  branch?: string;
  path: string;
  git: boolean;
  hue: number;
  counts: { working: number; waiting: number; total: number };
};

/** Quadrante da visão por worktrees: moldura com cabeçalho; os agentes ficam por cima. */
export const WorktreeNode = memo(function WorktreeNode({ data }: NodeProps<Node<WorktreeNodeData>>) {
  const { counts } = data;
  return (
    <div className={`wt${data.git ? '' : ' wt--nogit'}`} style={{ '--wt-hue': data.hue } as CSSProperties}>
      <header className="wt__head" title={data.path}>
        <div className="wt__title">
          <span className="wt__repo">{data.git ? '⎇' : '📁'} {data.name}</span>
          {data.worktree ? <span className="wt__tag">worktree · {data.worktree}</span> : data.git && <span className="wt__tag wt__tag--main">principal</span>}
          {!data.git && <span className="wt__tag">sem git</span>}
          <span className="wt__counts">
            {counts.waiting > 0 && <span className="wt__n wt__n--waiting">{counts.waiting} esperando</span>}
            {counts.working > 0 && <span className="wt__n wt__n--working">{counts.working} trabalhando</span>}
            <span className="wt__n">{counts.total} agente{counts.total === 1 ? '' : 's'}</span>
          </span>
        </div>
        <div className="wt__sub">
          {data.branch && <code className="wt__branch">{data.branch}</code>}
          <span className="wt__path">{data.path}</span>
        </div>
      </header>
    </div>
  );
});
