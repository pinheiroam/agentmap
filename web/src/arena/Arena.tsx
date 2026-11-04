import { useEffect, useMemo, useRef, useState } from 'react';
import * as Phaser from 'phaser';
import type { Agent } from '../../../daemon/src/types.ts';
import { CLASSES, classOf } from '../classes.ts';
import { projectName } from '../format.ts';
import { levelInfo } from '../levels.ts';
import { ArenaScene, type ArenaData, type ArenaHero } from './ArenaScene.ts';
import { biomeFor } from './biomes.ts';

const MAX_HEROES = 40;
/** http://127.0.0.1:4317/?demo coloca um herói de cada classe lutando, para ver todas as animações. */
const DEMO = new URLSearchParams(location.search).has('demo');
/** Heróis encerrados que aparecem descansando; o resto fica "na taverna". */
const MAX_RESTING = 12;

interface Props {
  /** Agentes visíveis (já filtrados pela barra superior). */
  visible: Agent[];
  /** Todos os agentes, para achar a sessão raiz de cada subagente. */
  agents: Map<string, Agent>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** XP acumulado do personagem (fornecedor + papel) do agente. */
  levelOf: (a: Agent) => number;
  /** XP de uma sessão (tokens novos). */
  sessionXpOf: (id: string) => number;
  /** XP de todo o histórico de um projeto; null enquanto o histórico carrega. */
  realmXpOf: (cwd: string) => number | null;
}

interface Realm {
  key: string;
  label: string;
  agents: Agent[];
  working: number;
  waiting: number;
}

function rootOf(a: Agent, agents: Map<string, Agent>) {
  let cur = a;
  for (let i = 0; i < 20 && cur.parentId && agents.has(cur.parentId); i++) cur = agents.get(cur.parentId)!;
  return cur;
}

function loadRealm() {
  try {
    return localStorage.getItem('agentmap.realm');
  } catch {
    return null;
  }
}

export default function Arena({ visible, agents, selectedId, onSelect, levelOf, sessionXpOf, realmXpOf }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<ArenaScene | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [chosen, setChosen] = useState<string | null>(loadRealm);

  // Cada projeto (pasta da sessão raiz) é um reino.
  const realms = useMemo(() => {
    const map = new Map<string, Realm>();
    for (const a of visible) {
      const root = rootOf(a, agents);
      const key = root.cwd ?? 'sem pasta';
      let r = map.get(key);
      if (!r) {
        r = { key, label: projectName(root), agents: [], working: 0, waiting: 0 };
        map.set(key, r);
      }
      r.agents.push(a);
      if (a.status === 'working') r.working++;
      if (a.status === 'waiting') r.waiting++;
    }
    return [...map.values()].sort((a, b) => b.waiting - a.waiting || b.working - a.working || b.agents.length - a.agents.length);
  }, [visible, agents]);

  const realm = realms.find((r) => r.key === chosen) ?? realms[0];

  // Ao selecionar um agente de outro reino (pela barra lateral), viaja até ele.
  useEffect(() => {
    if (!selectedId) return;
    const a = agents.get(selectedId);
    if (!a) return;
    const key = rootOf(a, agents).cwd ?? 'sem pasta';
    if (key !== realm?.key && realms.some((r) => r.key === key)) setChosen(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    try {
      if (chosen) localStorage.setItem('agentmap.realm', chosen);
    } catch {
      /* armazenamento indisponível */
    }
  }, [chosen]);

  useEffect(() => {
    const el = host.current!;
    const s = new ArenaScene({ onSelect: (id) => onSelectRef.current(id) });
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: el,
      pixelArt: true,
      backgroundColor: '#05070f',
      banner: false,
      audio: { noAudio: true },
      scale: { mode: Phaser.Scale.RESIZE, width: el.clientWidth, height: el.clientHeight },
      scene: s,
    });
    scene.current = s;
    // Só no modo demonstração: permite simular vitórias pelo console (window.__arena).
    if (DEMO) (window as unknown as { __arena: ArenaScene }).__arena = s;
    return () => {
      scene.current = null;
      game.destroy(true);
    };
  }, []);

  const data = useMemo<ArenaData | null>(() => {
    if (!realm) return null;
    const ids = new Set(realm.agents.map((a) => a.id));
    const rank = (a: Agent) => (a.status === 'done' ? 1 : 0);
    const sorted = [...realm.agents].sort((a, b) => rank(a) - rank(b) || b.lastActivity - a.lastActivity);
    const active = sorted.filter((a) => a.status !== 'done');
    const resting = sorted.filter((a) => a.status === 'done').slice(0, MAX_RESTING);
    const chosenAgents = [...active, ...resting].slice(0, MAX_HEROES);
    const heroes: ArenaHero[] = chosenAgents.map((a) => ({
      id: a.id,
      provider: a.provider,
      title: a.title || '(sem título)',
      role: a.role,
      status: a.status,
      tools: a.stats.tools,
      errors: a.stats.errors,
      lastTool: a.lastAction?.split(':')[0]?.slice(0, 18),
      isLeader: !a.parentId || !ids.has(a.parentId),
      cls: classOf(a.provider, a.parentId ? (a.role ?? 'subagente') : undefined),
      level: levelInfo(levelOf(a)).level,
      xp: sessionXpOf(a.id),
      mana: a.context ? 1 - a.context.used / a.context.limit : null,
    }));
    if (DEMO) {
      (Object.keys(CLASSES) as (keyof typeof CLASSES)[]).forEach((cls, i) =>
        heroes.push({
          id: `demo:${cls}`,
          provider: (['claude', 'codex', 'cursor'] as const)[i % 3],
          title: `Demo ${CLASSES[cls].name}`,
          status: 'working',
          tools: 0,
          errors: 0,
          lastTool: ['Bash', 'Edit', 'Read', 'Grep', 'exec', 'Write'][i],
          isLeader: true,
          cls,
          level: 5 + i * 7,
          xp: 0,
          mana: 1 - i / 5,
        }),
      );
    }
    return { realmKey: realm.key, realmLabel: realm.label, realmXp: realmXpOf(realm.key), heroes, selectedId };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realm, selectedId, levelOf, sessionXpOf, realmXpOf]);

  useEffect(() => {
    if (data) scene.current?.setData(data);
  }, [data]);

  const hidden = realm && data ? realm.agents.length - data.heroes.length : 0;

  return (
    <div className="arena">
      <div className="arena__stage" ref={host} />
      {realms.length > 0 && (
        <div className="arena__realms">
          {realms.map((r) => {
            const rxp = realmXpOf(r.key);
            const b = biomeFor(r.key, rxp === null ? undefined : levelInfo(rxp).level);
            return (
              <button
                key={r.key}
                className={`realm${r.key === realm?.key ? ' is-on' : ''}${r.waiting ? ' is-hot' : ''}`}
                onClick={() => setChosen(r.key)}
                title={`${b.name} · ${r.key}`}
              >
                <span className="realm__icon">{b.icon}</span>
                <span className="realm__label">{r.label}</span>
                {realmXpOf(r.key) !== null && <span className="realm__lvl">Nv {levelInfo(realmXpOf(r.key)!).level}</span>}
                {r.waiting > 0 && <span className="realm__badge realm__badge--wait">!{r.waiting}</span>}
                {r.working > 0 && <span className="realm__badge">⚔{r.working}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className="arena__legend">
        {(Object.keys(CLASSES) as (keyof typeof CLASSES)[]).map((c) => (
          <span key={c} title={CLASSES[c].role}>
            {CLASSES[c].icon} {CLASSES[c].name}
          </span>
        ))}
        <span className="arena__rings">
          anel: <i className="ring ring--claude" />
          Claude <i className="ring ring--codex" />
          Codex <i className="ring ring--cursor" />
          Cursor
        </span>
        <span className="arena__hint">clique num herói para ver o que ele está fazendo</span>
        {hidden > 0 && <span>+{hidden} na taverna</span>}
      </div>
      {!realm && (
        <div className="blank">
          <div className="blank__orb" />
          <h2>Nenhum herói em campo</h2>
          <p>Quando um agente começar a trabalhar, ele aparece aqui para enfrentar o boss.</p>
        </div>
      )}
    </div>
  );
}
