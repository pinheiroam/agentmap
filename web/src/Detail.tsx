import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Agent, AgentEvent, Approval, Decision, TokenTotals } from '../../daemon/src/types.ts';
import { ApprovalCard } from './Approvals.tsx';
import { PROVIDERS, STATUS, ago, clock, modelName, shortPath } from './format.ts';
import { XpBar } from './Guild.tsx';
import { characterClassName, characterIcon, characterName, fmtFull, fmtTokens, levelInfo, xpOf } from './levels.ts';

type Filter = 'all' | 'messages' | 'tools';

interface Props {
  agent: Agent;
  agents: Map<string, Agent>;
  events: AgentEvent[];
  approvals: Approval[];
  now: number;
  decide: (id: string, decision: Decision, message?: string) => void;
  session?: { character: string; totals: TokenTotals };
  character: string;
  characterXp: number;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function Detail({ agent, agents, events, approvals, now, decide, session, character, characterXp, onSelect, onClose }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [copied, setCopied] = useState(false);
  const children = useMemo(
    () => [...agents.values()].filter((a) => a.parentId === agent.id).sort((a, b) => b.lastActivity - a.lastActivity),
    [agents, agent.id],
  );
  const parent = agent.parentId ? agents.get(agent.parentId) : undefined;
  const mine = approvals.filter((a) => a.agentId === agent.id);
  const lastQuestion =
    agent.status === 'waiting' && mine.length === 0 ? [...events].reverse().find((e) => e.kind === 'question') : undefined;

  const shown = events.filter((e) =>
    filter === 'all' ? true : filter === 'messages' ? e.kind === 'user' || e.kind === 'assistant' || e.kind === 'question' : e.kind === 'tool' || e.kind === 'result',
  );

  // Rola para o fim quando chegam eventos, se o usuário já estava no fim.
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown.length]);
  useEffect(() => {
    stick.current = true;
  }, [agent.id, filter]);

  const copyResume = async () => {
    if (!agent.resume) return;
    const cmd = agent.cwd ? `cd ${JSON.stringify(agent.cwd)} && ${agent.resume}` : agent.resume;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard indisponível */
    }
  };

  return (
    <aside className="detail">
      <header className="detail__head">
        <div className="detail__row">
          <span className={`badge badge--${agent.provider}`}>{PROVIDERS[agent.provider].short}</span>
          <span className="detail__provider">{PROVIDERS[agent.provider].label}</span>
          <span className={`status status--${agent.status}`}>
            <i />
            {STATUS[agent.status].label}
          </span>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <h2 className="detail__title">{agent.title || '(sem título)'}</h2>
        {parent && (
          <button className="detail__parent" onClick={() => onSelect(parent.id)}>
            ↰ {parent.title}
          </button>
        )}
        <dl className="detail__meta">
          {agent.role && (
            <>
              <dt>papel</dt>
              <dd>{agent.role}</dd>
            </>
          )}
          {agent.model && (
            <>
              <dt>modelo</dt>
              <dd>{modelName(agent.model)}</dd>
            </>
          )}
          {agent.cwd && (
            <>
              <dt>pasta</dt>
              <dd title={agent.cwd}>{shortPath(agent.cwd)}</dd>
            </>
          )}
          {agent.pid && (
            <>
              <dt>pid</dt>
              <dd>{agent.pid}</dd>
            </>
          )}
          <dt>atividade</dt>
          <dd>
            há {ago(agent.lastActivity, now)} · {agent.stats.messages} msgs · {agent.stats.tools} ferramentas
            {agent.stats.errors > 0 && <span className="err"> · {agent.stats.errors} erros</span>}
          </dd>
        </dl>
        {agent.resume && (
          <button className="resume" onClick={copyResume} title="Copiar comando para retomar no terminal">
            <code>{agent.resume}</code>
            <span>{copied ? 'copiado ✓' : 'copiar'}</span>
          </button>
        )}
      </header>

      {mine.length > 0 && (
        <section className="detail__section detail__section--alert">
          {mine.map((ap) => (
            <ApprovalCard key={ap.id} approval={ap} now={now} decide={decide} />
          ))}
        </section>
      )}

      {lastQuestion && (
        <section className="detail__section detail__section--alert">
          <div className="question">
            <div className="question__head">⚑ O agente fez uma pergunta</div>
            <pre>{lastQuestion.text}</pre>
            <p className="hint">Responda no app do {PROVIDERS[agent.provider].label}. O agentmap ainda não envia respostas para essa ferramenta.</p>
          </div>
        </section>
      )}

      <section className="detail__section">
        <h3>Progresso</h3>
        <ProgressCard character={character} xp={characterXp} />
        {agent.context && (
          <div className="mana" title={`${fmtFull(agent.context.used)} de ${fmtFull(agent.context.limit)} tokens no contexto${agent.context.estimated ? ' (limite estimado pelo modelo)' : ''}`}>
            <div className="mana__top">
              <span>🔷 Mana (janela de contexto)</span>
              <span className="muted">
                {fmtTokens(agent.context.used)} / {agent.context.estimated ? '≈' : ''}
                {fmtTokens(agent.context.limit)} · {Math.round((agent.context.used / agent.context.limit) * 100)}% usado
              </span>
            </div>
            <div className="mana__track">
              <div
                className={`mana__fill${agent.context.used / agent.context.limit > 0.8 ? ' is-low' : ''}`}
                style={{ width: `${Math.max(0, 100 - (agent.context.used / agent.context.limit) * 100)}%` }}
              />
            </div>
          </div>
        )}
        {session && (
          <div className="token-grid" title="Tokens desta sessão">
            <div>
              <span>XP sessão</span>
              <b className="node__xp">{fmtTokens(xpOf(session.totals))}</b>
            </div>
            <div title={fmtFull(session.totals.output)}>
              <span>saída</span>
              <b>{fmtTokens(session.totals.output)}</b>
            </div>
            <div title={fmtFull(session.totals.input + session.totals.cacheWrite)}>
              <span>entrada nova</span>
              <b>{fmtTokens(session.totals.input + session.totals.cacheWrite)}</b>
            </div>
            <div title={`${fmtFull(session.totals.cacheRead)} (não conta XP)`}>
              <span>cache lido</span>
              <b>{fmtTokens(session.totals.cacheRead)}</b>
            </div>
          </div>
        )}
      </section>

      {children.length > 0 && (
        <section className="detail__section">
          <h3>Subagentes · {children.length}</h3>
          <ul className="children">
            {children.slice(0, 40).map((c) => (
              <li key={c.id}>
                <button onClick={() => onSelect(c.id)}>
                  <span className={`dot dot--${c.status}`} />
                  <span className="children__title">{c.title}</span>
                  <span className="children__time">{ago(c.lastActivity, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="timeline__bar">
        <h3>Linha do tempo</h3>
        <div className="seg">
          {(['all', 'messages', 'tools'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'is-on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'Tudo' : f === 'messages' ? 'Mensagens' : 'Ferramentas'}
            </button>
          ))}
        </div>
      </div>
      <div
        className="timeline"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {shown.length === 0 && <div className="empty">Nenhum evento ainda.</div>}
        {shown.map((e) => (
          <EventRow key={e.id} event={e} />
        ))}
      </div>
    </aside>
  );
}

function ProgressCard({ character, xp }: { character: string; xp: number }) {
  const info = levelInfo(xp);
  return (
    <div className="progress-card" title={`${fmtFull(xp)} XP acumulado por este personagem em todas as sessões`}>
      <div className="progress-card__lvl">
        <small>NÍVEL</small>
        {info.level}
      </div>
      <div className="progress-card__body">
        <div className="progress-card__name">
          <span>
            {characterIcon(character)} {characterName(character)}
          </span>
          <span className="muted">
            {characterClassName(character)} · {info.rank}
          </span>
        </div>
        <XpBar info={info} />
        <span className="muted">
          {fmtTokens(xp - info.from)} / {fmtTokens(info.to - info.from)} XP para o Nv {info.level + 1}
        </span>
      </div>
    </div>
  );
}

function EventRow({ event: e }: { event: AgentEvent }) {
  const [open, setOpen] = useState(false);
  const time = <time>{clock(e.ts)}</time>;
  switch (e.kind) {
    case 'user':
      return (
        <div className="ev ev--user">
          <div className="ev__meta">
            {e.label ?? 'você'} {time}
          </div>
          <div className="ev__bubble">{e.text}</div>
        </div>
      );
    case 'assistant':
      return (
        <div className="ev ev--assistant">
          <div className="ev__meta">agente {time}</div>
          <div className="ev__text">{e.text}</div>
        </div>
      );
    case 'question':
      return (
        <div className="ev ev--question">
          <div className="ev__meta">⚑ pergunta {time}</div>
          <pre>{e.text}</pre>
        </div>
      );
    case 'tool':
      return (
        <div className="ev ev--tool">
          <span className="ev__chip" title={e.label}>
            {e.label?.split('__').pop()}
          </span>
          <code className="ev__code">{e.text}</code>
          {time}
        </div>
      );
    case 'result': {
      const lines = e.text.split('\n');
      const long = lines.length > 3 || e.text.length > 240;
      return (
        <div className={`ev ev--result${e.isError ? ' is-error' : ''}`}>
          <pre onClick={() => long && setOpen(!open)} className={long && !open ? 'clamped' : ''}>
            {e.text || '(sem saída)'}
          </pre>
          {long && (
            <button className="ev__more" onClick={() => setOpen(!open)}>
              {open ? 'recolher' : `mostrar tudo (${lines.length} linhas)`}
            </button>
          )}
        </div>
      );
    }
    default:
      return (
        <div className={`ev ev--system${e.isError ? ' is-error' : ''}`}>
          — {e.text} {time} —
        </div>
      );
  }
}
