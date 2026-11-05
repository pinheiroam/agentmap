import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { Agent, AgentStatus, Provider } from '../../daemon/src/types.ts';
import { AgentMap } from './AgentMap.tsx';
import { ApprovalCard } from './Approvals.tsx';
import { Detail } from './Detail.tsx';
import { Guild } from './Guild.tsx';
import { xpOf } from './levels.ts';
import { PROVIDERS, STATUS, ago, projectName } from './format.ts';
import { useAgentmap } from './useAgentmap.ts';

type Scope = 'active' | 'all';
type View = 'map' | 'arena' | 'guild';

// A engine 3D (Three.js) só é baixada quando a Arena é aberta.
const Arena = lazy(() => import('./arena/Arena.tsx'));

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`agentmap.${key}`);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`agentmap.${key}`, JSON.stringify(value));
  } catch {
    /* armazenamento indisponível */
  }
}

/** Inclui os ancestrais de cada agente, para a árvore não ficar quebrada. */
function withAncestors(ids: Set<string>, byId: Map<string, Agent>) {
  const out = new Set(ids);
  for (const id of ids) {
    let p = byId.get(id)?.parentId;
    while (p && byId.has(p) && !out.has(p)) {
      out.add(p);
      p = byId.get(p)?.parentId;
    }
  }
  return out;
}

export function App() {
  const { connected, agents, approvals, events, progress, subscribe, decide } = useAgentmap();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>(() => load('scope', 'active'));
  const [view, setView] = useState<View>(() => load('view', 'map'));
  const [providers, setProviders] = useState<Provider[]>(() => load('providers', ['claude', 'codex', 'cursor']));
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => save('scope', scope), [scope]);
  useEffect(() => save('view', view), [view]);
  useEffect(() => save('providers', providers), [providers]);
  useEffect(() => subscribe(selectedId), [selectedId, subscribe]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelectedId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const all = useMemo(() => [...agents.values()], [agents]);

  // Progressão: XP de cada sessão no mapa e XP acumulado de cada personagem (fornecedor + papel).
  const characterXp = useMemo(() => new Map(progress?.characters.map((c) => [c.key, c.xp]) ?? []), [progress]);
  const sessionXp = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, s] of Object.entries(progress?.sessions ?? {})) m.set(id, xpOf(s.totals));
    return m;
  }, [progress]);
  const projectXp = useMemo(() => new Map(progress?.projects.map((p) => [p.cwd, p.xp]) ?? []), [progress]);
  const characterOf = (a: Agent) =>
    progress?.sessions[a.id]?.character ?? `${a.provider}:${a.parentId ? (a.role ?? 'subagente') : 'main'}`;
  const counts = useMemo(() => {
    const c: Record<AgentStatus, number> = { working: 0, waiting: 0, idle: 0, done: 0 };
    for (const a of all) c[a.status]++;
    return c;
  }, [all]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = all.filter((a) => providers.includes(a.provider));
    let keep = new Set(
      base
        .filter((a) => scope === 'all' || a.status !== 'done' || a.id === selectedId)
        .filter((a) => !q || [a.title, a.role, a.cwd, a.lastAction, a.model].some((s) => s?.toLowerCase().includes(q)))
        .map((a) => a.id),
    );
    keep = withAncestors(keep, agents);
    return base.filter((a) => keep.has(a.id));
  }, [all, agents, providers, scope, query, selectedId]);

  const waitingNoApproval = all.filter((a) => a.status === 'waiting' && !approvals.some((ap) => ap.agentId === a.id));
  const working = all.filter((a) => a.status === 'working').sort((a, b) => b.lastActivity - a.lastActivity);
  const needsYou = approvals.length + waitingNoApproval.length;

  // Título da aba e notificações nativas do navegador quando algo precisa de você.
  useEffect(() => {
    document.title = needsYou ? `(${needsYou}) agentmap` : 'agentmap';
  }, [needsYou]);
  const notified = useRef(new Set<string>());
  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    for (const ap of approvals) {
      if (notified.current.has(ap.id)) continue;
      notified.current.add(ap.id);
      if (document.hasFocus()) continue;
      const agent = agents.get(ap.agentId);
      new Notification(`${agent?.title ?? 'Agente'} pede permissão`, { body: `${ap.tool}: ${ap.summary}`, tag: ap.id });
    }
  }, [approvals, agents]);
  const [notifPerm, setNotifPerm] = useState(typeof Notification === 'undefined' ? 'denied' : Notification.permission);

  const open = (id: string) => {
    setSelectedId(id);
    setFocusId(id);
    setTimeout(() => setFocusId(null), 50);
  };

  const selected = selectedId ? agents.get(selectedId) : undefined;

  return (
    <div className={`app${selected ? ' has-detail' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
            <g stroke="currentColor" strokeWidth="1.6" opacity=".55">
              <path d="M9 10 L16 17 L24 9M16 17 L22 24M16 17 L9 23" fill="none" />
            </g>
            <circle cx="16" cy="17" r="3.4" fill="var(--working)" />
            <circle cx="9" cy="10" r="2.2" fill="var(--claude)" />
            <circle cx="24" cy="9" r="2.2" fill="var(--cursor)" />
            <circle cx="22" cy="24" r="2.2" fill="var(--waiting)" />
            <circle cx="9" cy="23" r="2.2" fill="var(--codex)" />
          </svg>
          <span>agentmap</span>
          <span className={`conn${connected ? ' is-on' : ''}`} title={connected ? 'Conectado ao daemon' : 'Reconectando…'} />
        </div>

        <div className="counters">
          {(['waiting', 'working', 'idle', 'done'] as AgentStatus[]).map((s) => (
            <span key={s} className={`counter counter--${s}${counts[s] && s === 'waiting' ? ' is-hot' : ''}`}>
              <b>{counts[s]}</b> {STATUS[s].label.toLowerCase()}
            </span>
          ))}
        </div>

        <div className="filters">
          <div className="seg view-toggle">
            <button className={view === 'map' ? 'is-on' : ''} onClick={() => setView('map')}>
              ◇ Mapa
            </button>
            <button className={view === 'arena' ? 'is-on' : ''} onClick={() => setView('arena')}>
              ⚔ Arena
            </button>
            <button className={view === 'guild' ? 'is-on' : ''} onClick={() => setView('guild')}>
              🏰 Guilda
            </button>
          </div>
          <div className="seg">
            <button className={scope === 'active' ? 'is-on' : ''} onClick={() => setScope('active')}>
              Ativos
            </button>
            <button className={scope === 'all' ? 'is-on' : ''} onClick={() => setScope('all')}>
              Todos
            </button>
          </div>
          <div className="chips">
            {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
              <button
                key={p}
                className={`chip chip--${p}${providers.includes(p) ? ' is-on' : ''}`}
                onClick={() => setProviders((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))}
              >
                <i />
                {PROVIDERS[p].label}
              </button>
            ))}
          </div>
          <input className="search" placeholder="Buscar agente, pasta, comando…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {notifPerm === 'default' && (
            <button className="btn btn--ghost" onClick={() => Notification.requestPermission().then(setNotifPerm)}>
              🔔 Notificações
            </button>
          )}
        </div>
      </header>

      <nav className="sidebar">
        <section>
          <h3 className={needsYou ? 'is-hot' : ''}>
            Precisa de você <span>{needsYou}</span>
          </h3>
          {needsYou === 0 && <p className="empty">Nada pendente. Os agentes estão por conta própria.</p>}
          {approvals.map((ap) => (
            <ApprovalCard key={ap.id} compact approval={ap} agent={agents.get(ap.agentId)} now={now} decide={decide} onOpen={() => open(ap.agentId)} />
          ))}
          {waitingNoApproval.map((a) => (
            <button key={a.id} className="row row--waiting" onClick={() => open(a.id)}>
              <span className="dot dot--waiting" />
              <span className="row__body">
                <span className="row__title">{a.title}</span>
                <span className="row__sub">fez uma pergunta · {PROVIDERS[a.provider].label}</span>
              </span>
            </button>
          ))}
        </section>
        <section>
          <h3>
            Trabalhando agora <span>{working.length}</span>
          </h3>
          {working.length === 0 && <p className="empty">Nenhum agente em execução.</p>}
          {working.map((a) => (
            <button key={a.id} className={`row${a.id === selectedId ? ' is-selected' : ''}`} onClick={() => open(a.id)}>
              <span className={`badge badge--${a.provider} badge--sm`}>{PROVIDERS[a.provider].short}</span>
              <span className="row__body">
                <span className="row__title">{a.title}</span>
                <span className="row__sub">
                  {projectName(a)} · {ago(a.lastActivity, now)}
                </span>
                {a.lastAction && <code className="row__action">{a.lastAction}</code>}
              </span>
            </button>
          ))}
        </section>
      </nav>

      <main className="canvas">
        {view === 'guild' ? (
          <Guild progress={progress} now={now} />
        ) : view === 'arena' ? (
          <Suspense fallback={<div className="blank">Carregando a arena…</div>}>
            <Arena
              visible={visible}
              agents={agents}
              selectedId={selectedId}
              onSelect={setSelectedId}
              levelOf={(a) => characterXp.get(characterOf(a)) ?? 0}
              sessionXpOf={(id) => sessionXp.get(id) ?? 0}
              realmXpOf={(cwd) => (progress?.ready ? (projectXp.get(cwd) ?? 0) : null)}
            />
          </Suspense>
        ) : visible.length === 0 ? (
          <div className="blank">
            <div className="blank__orb" />
            <h2>{connected ? 'Nenhum agente ativo' : 'Conectando ao daemon…'}</h2>
            <p>
              {connected
                ? scope === 'active'
                  ? 'Inicie um agente (Claude Code, Codex ou Cursor) ou mude o filtro para "Todos".'
                  : 'Nenhuma sessão encontrada na janela configurada.'
                : 'Verifique se `npm start` está rodando.'}
            </p>
          </div>
        ) : (
          <ReactFlowProvider>
            <AgentMap
              agents={visible}
              approvals={approvals}
              selectedId={selectedId}
              focusId={focusId}
              now={now}
              sessionXp={sessionXp}
              onSelect={setSelectedId}
            />
          </ReactFlowProvider>
        )}
      </main>

      {selected && (
        <Detail
          key={selected.id}
          agent={selected}
          agents={agents}
          events={events}
          approvals={approvals}
          now={now}
          decide={decide}
          session={progress?.sessions[selected.id]}
          character={characterOf(selected)}
          characterXp={characterXp.get(characterOf(selected)) ?? 0}
          onSelect={open}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
