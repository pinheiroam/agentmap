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
import { AgentNode, ProjectNode, WorktreeNode, type AgentNodeData, type ProjectNodeData, type WorktreeNodeData } from './AgentNode.tsx';
import { projectName, shortPath } from './format.ts';

const NODE_W = 272;
const NODE_H = 118;
const PROJ_W = 220;
const PROJ_H = 40;

const nodeTypes = { agent: AgentNode, project: ProjectNode, worktree: WorktreeNode };

const baseName = (p: string) => p.split('/').filter(Boolean).pop() ?? p;
/** Matiz estável por repositório: worktrees do mesmo repo compartilham a cor. */
function hueOf(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export type MapMode = 'tree' | 'worktrees';

interface Props {
  agents: Agent[];
  approvals: Approval[];
  selectedId: string | null;
  focusId: string | null;
  now: number;
  sessionXp: Map<string, number>;
  mode: MapMode;
  onSelect: (id: string | null) => void;
}

/** Grupo do agente: projeto (pasta inicial) na árvore, worktree git na visão por worktrees. */
const groupOf = (a: Agent, mode: MapMode) =>
  mode === 'tree' ? `proj:${a.cwd ?? '?'}` : `wt:${a.worktree?.root ?? a.cwd ?? '?'}`;

/** Estrutura do grafo: só muda quando entram/saem agentes ou muda a hierarquia. */
function buildStructure(agents: Agent[], mode: MapMode) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const projects = new Map<string, Agent[]>();
  const edges: { source: string; target: string }[] = [];
  /** Pai e filho em worktrees diferentes: ligados por uma linha tracejada entre quadrantes. */
  const cross: { source: string; target: string }[] = [];
  for (const a of agents) {
    const parent = a.parentId ? byId.get(a.parentId) : undefined;
    if (parent && (mode === 'tree' || groupOf(parent, mode) === groupOf(a, mode))) {
      edges.push({ source: parent.id, target: a.id });
    } else {
      const key = groupOf(a, mode);
      if (!projects.has(key)) projects.set(key, []);
      projects.get(key)!.push(a);
      edges.push({ source: key, target: a.id });
      if (parent) cross.push({ source: parent.id, target: a.id });
    }
  }
  if (mode === 'worktrees') {
    // Worktrees do mesmo repositório lado a lado; a principal antes das ligadas.
    const wt = (key: string) => projects.get(key)![0].worktree;
    const sorted = [...projects.keys()].sort((a, b) => {
      const x = wt(a);
      const y = wt(b);
      return (
        Number(!x?.git) - Number(!y?.git) ||
        (x?.repo ?? a).localeCompare(y?.repo ?? b) ||
        Number(x?.linked) - Number(y?.linked) ||
        a.localeCompare(b)
      );
    });
    return { projects: new Map(sorted.map((k) => [k, projects.get(k)!])), edges, cross };
  }
  return { projects, edges, cross };
}

const GAP_X = 72; // entre níveis
const GAP_Y = 16; // entre irmãos
const GRID_GAP_X = 20; // entre colunas da grade de folhas
const GRID_ROWS = 6; // folhas por coluna
const PANEL_PAD = 24; // margem interna do quadrante
const PANEL_HEAD = 76; // cabeçalho do quadrante
const PANEL_GAP = 40; // entre quadrantes
const PANEL_MIN_W = NODE_W + PANEL_PAD * 2 + 120;

/**
 * Árvore da esquerda para a direita. Filhos com subárvore são empilhados;
 * filhos-folha são arrumados numa grade de colunas, para um orquestrador com
 * 100 subagentes não virar uma coluna infinita.
 *
 * Na visão por worktrees, cada grupo vira um quadrante de uma grade, com a
 * árvore dos seus agentes dentro.
 */
function layout(agents: Agent[], structure: ReturnType<typeof buildStructure>, mode: MapMode) {
  const startedAt = new Map(agents.map((a) => [a.id, a.startedAt]));
  const kids = new Map<string, string[]>();
  for (const e of structure.edges) {
    if (!kids.has(e.source)) kids.set(e.source, []);
    kids.get(e.source)!.push(e.target);
  }
  for (const list of kids.values()) list.sort((a, b) => (startedAt.get(a) ?? 0) - (startedAt.get(b) ?? 0));

  // A raiz de um quadrante é invisível (o cabeçalho do quadrante faz esse papel).
  const dims = (id: string) =>
    id.startsWith('wt:') ? { w: 0, h: 0 } : id.startsWith('proj:') ? { w: PROJ_W, h: PROJ_H } : { w: NODE_W, h: NODE_H };
  const gapAfter = (id: string) => (dims(id).w ? GAP_X : 0);
  const sizes = new Map<string, { w: number; h: number }>();

  const split = (id: string) => {
    const list = kids.get(id) ?? [];
    return { trees: list.filter((k) => kids.has(k)), leaves: list.filter((k) => !kids.has(k)) };
  };
  // Nos quadrantes, as folhas formam uma grade mais quadrada (6 folhas: 3×2 em vez de 6×1).
  const rowsFor = (n: number) => (mode === 'tree' ? GRID_ROWS : Math.min(GRID_ROWS, Math.max(2, Math.ceil(Math.sqrt(n)))));
  const gridSize = (n: number) => {
    if (n === 0) return { w: 0, h: 0 };
    const rows = Math.min(n, rowsFor(n));
    const cols = Math.ceil(n / rows);
    return { w: cols * NODE_W + (cols - 1) * GRID_GAP_X, h: rows * NODE_H + (rows - 1) * GAP_Y };
  };
  const measure = (id: string): { w: number; h: number } => {
    const self = dims(id);
    const { trees, leaves } = split(id);
    const blocks = [...trees.map(measure), gridSize(leaves.length)].filter((b) => b.h > 0);
    if (blocks.length === 0) return sizes.set(id, self).get(id)!;
    const kidsW = Math.max(...blocks.map((b) => b.w));
    const kidsH = blocks.reduce((s, b) => s + b.h, 0) + (blocks.length - 1) * GAP_Y;
    return sizes.set(id, { w: self.w + gapAfter(id) + kidsW, h: Math.max(self.h, kidsH) }).get(id)!;
  };

  const pos = new Map<string, { x: number; y: number }>();
  const place = (id: string, x: number, y: number) => {
    const self = dims(id);
    const total = sizes.get(id)!;
    pos.set(id, { x, y: y + (total.h - self.h) / 2 });
    const { trees, leaves } = split(id);
    const kidX = x + self.w + gapAfter(id);
    const grid = gridSize(leaves.length);
    const kidsH = trees.reduce((s, t) => s + sizes.get(t)!.h + GAP_Y, 0) + grid.h - (grid.h ? 0 : GAP_Y);
    let cy = y + Math.max(0, (total.h - kidsH) / 2);
    for (const t of trees) {
      place(t, kidX, cy);
      cy += sizes.get(t)!.h + GAP_Y;
    }
    const rows = rowsFor(leaves.length);
    leaves.forEach((leaf, i) => {
      const col = Math.floor(i / rows);
      const row = i % rows;
      pos.set(leaf, { x: kidX + col * (NODE_W + GRID_GAP_X), y: cy + row * (NODE_H + GAP_Y) });
    });
  };

  const panels = new Map<string, { x: number; y: number; w: number; h: number }>();
  const keys = [...structure.projects.keys()];
  if (mode === 'tree') {
    let y = 0;
    for (const key of keys) {
      const s = measure(key);
      place(key, 0, y);
      y += s.h + GAP_Y * 3;
    }
    return { pos, panels };
  }

  // Grade de quadrantes: cada coluna tem a largura do seu maior quadrante, cada linha a altura do maior.
  const inner = keys.map((k) => measure(k));
  const cols = Math.max(1, Math.min(keys.length, Math.round(Math.sqrt(keys.length * 1.6))));
  const colW: number[] = [];
  const rowH: number[] = [];
  inner.forEach((s, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c] ?? 0, PANEL_MIN_W, s.w + PANEL_PAD * 2);
    rowH[r] = Math.max(rowH[r] ?? 0, PANEL_HEAD + s.h + PANEL_PAD);
  });
  keys.forEach((key, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = colW.slice(0, c).reduce((s, w) => s + w + PANEL_GAP, 0);
    const y = rowH.slice(0, r).reduce((s, h) => s + h + PANEL_GAP, 0);
    panels.set(key, { x, y, w: colW[c], h: rowH[r] });
    place(key, x + PANEL_PAD, y + PANEL_HEAD);
  });
  return { pos, panels };
}

export function AgentMap({ agents, approvals, selectedId, focusId, now, sessionXp, mode, onSelect }: Props) {
  const flow = useReactFlow();
  const structureKey = agents
    .map((a) => `${a.id}<${a.parentId ?? ''}@${mode === 'tree' ? (a.cwd ?? '') : (a.worktree?.root ?? a.cwd ?? '')}`)
    .sort()
    .join('|')
    .concat(`#${mode}`);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const structure = useMemo(() => buildStructure(agents, mode), [structureKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { pos: positions, panels } = useMemo(() => layout(agents, structure, mode), [structure]);

  const nodes = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a]));
    const childCount = new Map<string, number>();
    for (const a of agents) if (a.parentId) childCount.set(a.parentId, (childCount.get(a.parentId) ?? 0) + 1);
    const approvalCount = new Map<string, number>();
    for (const ap of approvals) approvalCount.set(ap.agentId, (approvalCount.get(ap.agentId) ?? 0) + 1);

    const out: Node[] = [];
    if (mode === 'worktrees') {
      const members = new Map<string, Agent[]>();
      for (const a of agents) {
        const k = groupOf(a, mode);
        if (!members.has(k)) members.set(k, []);
        members.get(k)!.push(a);
      }
      for (const [key, box] of panels) {
        const list = members.get(key) ?? [];
        const first = list[0];
        const wt = first?.worktree;
        const root = wt?.root ?? first?.cwd ?? '?';
        out.push({
          id: key,
          type: 'worktree',
          position: { x: box.x, y: box.y },
          width: box.w,
          height: box.h,
          style: { width: box.w, height: box.h },
          zIndex: -1,
          selectable: false,
          focusable: false,
          data: {
            name: baseName(wt?.git ? wt.repo : root),
            worktree: wt?.linked ? baseName(root) : undefined,
            branch: wt?.branch,
            path: shortPath(root),
            git: wt?.git ?? false,
            hue: hueOf(wt?.repo ?? root),
            counts: {
              working: list.filter((a) => a.status === 'working').length,
              waiting: list.filter((a) => a.status === 'waiting').length,
              total: list.length,
            },
          } satisfies WorktreeNodeData,
        });
      }
    }
    for (const [key, roots] of structure.projects) {
      if (mode === 'worktrees') break;
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
  }, [agents, approvals, structure, positions, panels, mode, selectedId, now, sessionXp]);

  const edges = useMemo<Edge[]>(() => {
    const byId = new Map(agents.map((a) => [a.id, a]));
    const tree = structure.edges
      .filter((e) => !e.source.startsWith('wt:'))
      .map((e) => {
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
    const cross = mode === 'worktrees'
      ? structure.cross.map((e) => ({
          id: `${e.source}~>${e.target}`,
          source: e.source,
          target: e.target,
          type: 'default',
          className: 'edge edge--cross',
        }))
      : [];
    return [...tree, ...cross];
  }, [agents, structure, mode]);

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
        nodeClassName={(n) => (n.type === 'agent' ? `mm mm--${(n.data as AgentNodeData).agent.status}` : `mm mm--${n.type}`)}
      />
      <Controls
        showInteractive={false}
        fitViewOptions={{ padding: 0.15, duration: 400, maxZoom: 1 }}
        onFitView={() => (userMoved.current = false)}
      />
    </ReactFlow>
  );
}
