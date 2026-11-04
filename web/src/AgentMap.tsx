import { useEffect, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import type { Agent, Approval } from '../../daemon/src/types.ts';
import { AgentNode, ProjectNode, type AgentNodeData, type ProjectNodeData } from './AgentNode.tsx';
import { projectName, shortPath } from './format.ts';

const NODE_W = 272;
const NODE_H = 118;
const PROJ_W = 220;
const PROJ_H = 40;

const nodeTypes = { agent: AgentNode, project: ProjectNode };

interface Props {
  agents: Agent[];
  approvals: Approval[];
  selectedId: string | null;
  focusId: string | null;
  now: number;
  sessionXp: Map<string, number>;
  onSelect: (id: string | null) => void;
}

/** Estrutura do grafo: só muda quando entram/saem agentes ou muda a hierarquia. */
function buildStructure(agents: Agent[]) {
  const ids = new Set(agents.map((a) => a.id));
  const projects = new Map<string, Agent[]>();
  const edges: { source: string; target: string }[] = [];
  for (const a of agents) {
    if (a.parentId && ids.has(a.parentId)) {
      edges.push({ source: a.parentId, target: a.id });
    } else {
      const key = `proj:${a.cwd ?? '?'}`;
      if (!projects.has(key)) projects.set(key, []);
      projects.get(key)!.push(a);
      edges.push({ source: key, target: a.id });
    }
  }
  return { projects, edges };
}

const GAP_X = 72; // entre níveis
const GAP_Y = 16; // entre irmãos
const GRID_GAP_X = 20; // entre colunas da grade de folhas
const GRID_ROWS = 6; // folhas por coluna

/**
 * Árvore da esquerda para a direita. Filhos com subárvore são empilhados;
 * filhos-folha são arrumados numa grade de colunas, para um orquestrador com
 * 100 subagentes não virar uma coluna infinita.
 */
function layout(agents: Agent[], structure: ReturnType<typeof buildStructure>) {
  const startedAt = new Map(agents.map((a) => [a.id, a.startedAt]));
  const kids = new Map<string, string[]>();
  for (const e of structure.edges) {
    if (!kids.has(e.source)) kids.set(e.source, []);
    kids.get(e.source)!.push(e.target);
  }
  for (const list of kids.values()) list.sort((a, b) => (startedAt.get(a) ?? 0) - (startedAt.get(b) ?? 0));

  const dims = (id: string) => (id.startsWith('proj:') ? { w: PROJ_W, h: PROJ_H } : { w: NODE_W, h: NODE_H });
  const sizes = new Map<string, { w: number; h: number }>();

  const split = (id: string) => {
    const list = kids.get(id) ?? [];
    return { trees: list.filter((k) => kids.has(k)), leaves: list.filter((k) => !kids.has(k)) };
  };
  const gridSize = (n: number) => {
    if (n === 0) return { w: 0, h: 0 };
    const rows = Math.min(n, GRID_ROWS);
    const cols = Math.ceil(n / GRID_ROWS);
    return { w: cols * NODE_W + (cols - 1) * GRID_GAP_X, h: rows * NODE_H + (rows - 1) * GAP_Y };
  };
  const measure = (id: string): { w: number; h: number } => {
    const self = dims(id);
    const { trees, leaves } = split(id);
    const blocks = [...trees.map(measure), gridSize(leaves.length)].filter((b) => b.h > 0);
    if (blocks.length === 0) return sizes.set(id, self).get(id)!;
    const kidsW = Math.max(...blocks.map((b) => b.w));
    const kidsH = blocks.reduce((s, b) => s + b.h, 0) + (blocks.length - 1) * GAP_Y;
    return sizes.set(id, { w: self.w + GAP_X + kidsW, h: Math.max(self.h, kidsH) }).get(id)!;
  };

  const pos = new Map<string, { x: number; y: number }>();
  const place = (id: string, x: number, y: number) => {
    const self = dims(id);
    const total = sizes.get(id)!;
    pos.set(id, { x, y: y + (total.h - self.h) / 2 });
    const { trees, leaves } = split(id);
    const kidX = x + self.w + GAP_X;
    const grid = gridSize(leaves.length);
    const kidsH = trees.reduce((s, t) => s + sizes.get(t)!.h + GAP_Y, 0) + grid.h - (grid.h ? 0 : GAP_Y);
    let cy = y + Math.max(0, (total.h - kidsH) / 2);
    for (const t of trees) {
      place(t, kidX, cy);
      cy += sizes.get(t)!.h + GAP_Y;
    }
    leaves.forEach((leaf, i) => {
      const col = Math.floor(i / GRID_ROWS);
      const row = i % GRID_ROWS;
      pos.set(leaf, { x: kidX + col * (NODE_W + GRID_GAP_X), y: cy + row * (NODE_H + GAP_Y) });
    });
  };

  let y = 0;
  for (const key of structure.projects.keys()) {
    const s = measure(key);
    place(key, 0, y);
    y += s.h + GAP_Y * 3;
  }
  return pos;
}

export function AgentMap({ agents, approvals, selectedId, focusId, now, sessionXp, onSelect }: Props) {
  const flow = useReactFlow();
  const structureKey = agents
    .map((a) => `${a.id}<${a.parentId ?? ''}@${a.cwd ?? ''}`)
    .sort()
    .join('|');

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const structure = useMemo(() => buildStructure(agents), [structureKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const positions = useMemo(() => layout(agents, structure), [structure]);

  const nodes = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a]));
    const childCount = new Map<string, number>();
    for (const a of agents) if (a.parentId) childCount.set(a.parentId, (childCount.get(a.parentId) ?? 0) + 1);
    const approvalCount = new Map<string, number>();
    for (const ap of approvals) approvalCount.set(ap.agentId, (approvalCount.get(ap.agentId) ?? 0) + 1);

    const out: Node[] = [];
    for (const [key, roots] of structure.projects) {
      const first = byId.get(roots[0].id) ?? roots[0];
      out.push({
        id: key,
        type: 'project',
        position: positions.get(key) ?? { x: 0, y: 0 },
        width: PROJ_W,
        height: PROJ_H,
        selectable: false,
        data: {
          label: projectName(first),
          path: shortPath(first.cwd),
          active: roots.filter((r) => byId.get(r.id)?.status !== 'done').length,
          total: roots.length,
        } satisfies ProjectNodeData,
      });
    }
    for (const a of agents) {
      out.push({
        id: a.id,
        type: 'agent',
        position: positions.get(a.id) ?? { x: 0, y: 0 },
        width: NODE_W,
        height: NODE_H,
        selected: a.id === selectedId,
        data: {
          agent: a,
          now,
          children: childCount.get(a.id) ?? 0,
          approvals: approvalCount.get(a.id) ?? 0,
          xp: sessionXp.get(a.id) ?? 0,
        } satisfies AgentNodeData,
      });
    }
    return out;
  }, [agents, approvals, structure, positions, selectedId, now, sessionXp]);

  const edges = useMemo<Edge[]>(() => {
    const byId = new Map(agents.map((a) => [a.id, a]));
    return structure.edges.map((e) => {
      const target = byId.get(e.target);
      const fromProject = e.source.startsWith('proj:');
      return {
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        animated: target?.status === 'working' || target?.status === 'waiting',
        className: `edge edge--${target?.status ?? 'idle'}${fromProject ? ' edge--project' : ''}`,
      };
    });
  }, [agents, structure]);

  // Reenquadra quando a estrutura muda, até o usuário mexer no mapa por conta própria.
  const userMoved = useRef(false);
  useEffect(() => {
    if (agents.length === 0 || userMoved.current) return;
    requestAnimationFrame(() => flow.fitView({ padding: 0.15, duration: 400, maxZoom: 1 }));
  }, [structureKey, agents.length, flow]);

  // Foca um nó escolhido fora do mapa (caixa de entrada, lista).
  useEffect(() => {
    if (!focusId) return;
    const p = positions.get(focusId);
    if (p) flow.setCenter(p.x + NODE_W / 2, p.y + NODE_H / 2, { zoom: Math.max(flow.getZoom(), 0.9), duration: 500 });
  }, [focusId, positions, flow]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => node.type === 'agent' && onSelect(node.id)}
      onPaneClick={() => onSelect(null)}
      onMoveStart={(event) => {
        if (event) userMoved.current = true;
      }}
      nodesConnectable={false}
      nodesDraggable={false}
      minZoom={0.1}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      colorMode="system"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
      <MiniMap
        pannable
        zoomable
        className="minimap"
        nodeClassName={(n) => (n.type === 'agent' ? `mm mm--${(n.data as AgentNodeData).agent.status}` : 'mm mm--project')}
      />
      <Controls
        showInteractive={false}
        fitViewOptions={{ padding: 0.15, duration: 400, maxZoom: 1 }}
        onFitView={() => (userMoved.current = false)}
      />
    </ReactFlow>
  );
}
