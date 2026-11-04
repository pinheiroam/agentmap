import { useMemo, useRef, useState } from 'react';
import type { Progress, Provider } from '../../daemon/src/types.ts';
import { PROVIDERS, ago, shortPath } from './format.ts';
import { characterClassName, characterIcon, characterName, fmtFull, fmtTokens, levelInfo, xpOf } from './levels.ts';

/** Ordem de empilhamento e legenda do gráfico (cores validadas para daltonismo em styles.css). */
const SERIES: { key: Provider; label: string }[] = [
  { key: 'codex', label: 'Codex' },
  { key: 'claude', label: 'Claude' },
  { key: 'cursor', label: 'Cursor (estimado)' },
];
const DAYS = 30;

interface Props {
  progress: Progress | null;
  now: number;
}

export function Guild({ progress, now }: Props) {
  if (!progress || !progress.ready) {
    const s = progress?.scanned;
    return (
      <div className="guild guild--loading">
        <div className="blank__orb" />
        <h2>Lendo o histórico de tokens…</h2>
        {s && s.total > 0 && (
          <p>
            {s.done} de {s.total} transcrições
          </p>
        )}
      </div>
    );
  }
  const xp = xpOf(progress.guild);
  const info = levelInfo(xp);
  const sessions = progress.characters.reduce((n, c) => n + c.sessions, 0);

  return (
    <div className="guild">
      <section className="guild__hero">
        <div className="level-orb">
          <span>Nv</span>
          <b>{info.level}</b>
        </div>
        <div className="guild__headline">
          <h1>
            Sua guilda <span className="rank">{info.rank}</span>
          </h1>
          <XpBar info={info} big />
          <p className="muted">
            Cada token novo processado pelos seus agentes vira XP. Leitura de cache não conta: é o mesmo contexto relido a cada turno.
          </p>
        </div>
        <SaveCard />
      </section>

      <section className="tiles">
        <Tile label="XP total" value={fmtTokens(xp)} title={fmtFull(xp)} accent />
        <Tile label="Saída (gerado)" value={fmtTokens(progress.guild.output)} title={fmtFull(progress.guild.output)} />
        <Tile label="Entrada nova" value={fmtTokens(progress.guild.input)} title={fmtFull(progress.guild.input)} />
        <Tile label="Cache gravado" value={fmtTokens(progress.guild.cacheWrite)} title={fmtFull(progress.guild.cacheWrite)} />
        <Tile label="Cache lido (não conta)" value={fmtTokens(progress.guild.cacheRead)} title={fmtFull(progress.guild.cacheRead)} />
        <Tile label="Sessões" value={fmtFull(sessions)} />
      </section>

      <section className="panel">
        <DailyChart days={progress.days} now={now} />
      </section>

      <div className="guild__cols">
        <section className="panel">
          <h3>Personagens</h3>
          <div className="roster">
            {progress.characters.map((c) => {
              const li = levelInfo(c.xp);
              return (
                <div key={c.key} className={`hero-card hero-card--${c.provider}`}>
                  <span className="hero-card__icon" title={characterClassName(c.key)}>
                    {characterIcon(c.key)}
                  </span>
                  <div className="hero-card__body">
                    <div className="hero-card__top">
                      <b>{characterName(c.key)}</b>
                      <span className="hero-card__lvl">Nv {li.level}</span>
                    </div>
                    <XpBar info={li} />
                    <div className="hero-card__meta">
                      {characterClassName(c.key)} · {PROVIDERS[c.provider].label} · {li.rank} · {c.estimated ? '≈ ' : ''}
                      {fmtTokens(c.xp)} XP · {c.sessions} {c.sessions === 1 ? 'sessão' : 'sessões'} · há {ago(c.last, now)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel">
          <h3>Reinos (projetos)</h3>
          <ProjectBars projects={progress.projects.slice(0, 12)} />
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, title, accent }: { label: string; value: string; title?: string; accent?: boolean }) {
  return (
    <div className={`tile${accent ? ' tile--accent' : ''}`} title={title}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function XpBar({ info, big }: { info: ReturnType<typeof levelInfo>; big?: boolean }) {
  return (
    <div className={`xpbar${big ? ' xpbar--big' : ''}`}>
      <div className="xpbar__track">
        <div className="xpbar__fill" style={{ width: `${Math.max(1.5, info.pct * 100)}%` }} />
      </div>
      {big && (
        <div className="xpbar__label">
          {fmtTokens(info.xp - info.from)} / {fmtTokens(info.to - info.from)} XP para o Nv {info.level + 1}
        </div>
      )}
    </div>
  );
}

function SaveCard() {
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const importFile = async (file: File) => {
    setMsg('Importando…');
    try {
      const res = await fetch('/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: await file.text() });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setMsg(`✓ ${body.added} sessões novas, ${body.updated} atualizadas. O que já existia não foi contado de novo.`);
    } catch (err) {
      setMsg(`Falhou: ${(err as Error).message}`);
    }
  };
  return (
    <div className="save">
      <h3>Save</h3>
      <div className="save__actions">
        <a className="btn btn--primary" href="/api/save" download>
          Exportar save
        </a>
        <button className="btn" onClick={() => input.current?.click()}>
          Importar save…
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = '';
          }}
        />
      </div>
      <p className="muted">{msg ?? 'Backup automático diário em ~/.config/agentmap/backups (14 últimos).'}</p>
    </div>
  );
}

// ---------------- gráfico de XP por dia ----------------

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

function DailyChart({ days, now }: { days: Progress['days']; now: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const rows = useMemo(() => {
    const out: { key: string; date: Date; values: Record<Provider, number>; total: number }[] = [];
    const today = new Date(now);
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const v = days[dayKey(d)] ?? { claude: 0, codex: 0, cursor: 0 };
      out.push({ key: dayKey(d), date: d, values: v, total: v.claude + v.codex + v.cursor });
    }
    return out;
  }, [days, now]);
  const sum = rows.reduce((n, r) => n + r.total, 0);
  const max = niceMax(Math.max(...rows.map((r) => r.total)));

  const W = 760;
  const H = 220;
  const pad = { l: 52, r: 8, t: 10, b: 24 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / rows.length;
  const bw = Math.max(4, slot - 6);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const fmtDay = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const h = hover !== null ? rows[hover] : null;

  return (
    <div className="chart">
      <div className="chart__head">
        <div>
          <h3>XP por dia</h3>
          <p className="muted">
            Últimos {DAYS} dias · {fmtTokens(sum)} XP
          </p>
        </div>
        <div className="chart__legend">
          {SERIES.map((s) => (
            <span key={s.key}>
              <i className={`sw sw--${s.key}`} />
              {s.label}
            </span>
          ))}
          <button className="btn btn--ghost" onClick={() => setTable(!table)}>
            {table ? 'Ver gráfico' : 'Ver tabela'}
          </button>
        </div>
      </div>

      {table ? (
        <div className="chart__table">
          <table>
            <thead>
              <tr>
                <th>Dia</th>
                {SERIES.map((s) => (
                  <th key={s.key}>{s.label}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.key}>
                  <td>{fmtDay(r.date)}</td>
                  {SERIES.map((s) => (
                    <td key={s.key}>{r.values[s.key] ? fmtFull(r.values[s.key]) : '—'}</td>
                  ))}
                  <td>
                    <b>{r.total ? fmtFull(r.total) : '—'}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart__plot">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`XP por dia nos últimos ${DAYS} dias`} onMouseLeave={() => setHover(null)}>
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f} className="grid">
                <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} />
                <text x={pad.l - 8} y={y(max * f)} dy="0.32em" textAnchor="end">
                  {fmtTokens(max * f)}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const x = pad.l + i * slot + (slot - bw) / 2;
              let base = 0;
              const present = SERIES.filter((s) => r.values[s.key] > 0);
              return (
                <g key={r.key} className={hover !== null && hover !== i ? 'dim' : ''}>
                  {present.map((s, j) => {
                    const v = r.values[s.key];
                    const y0 = y(base);
                    const y1 = y(base + v);
                    base += v;
                    const top = j === present.length - 1;
                    // 2px de superfície entre segmentos; só o topo da pilha é arredondado.
                    const hgt = Math.max(1, y0 - y1 - (top ? 0 : 2));
                    return top ? (
                      <path key={s.key} className={`bar bar--${s.key}`} d={roundTop(x, y1, bw, hgt, Math.min(4, bw / 2, hgt))} />
                    ) : (
                      <rect key={s.key} className={`bar bar--${s.key}`} x={x} y={y1 + 2} width={bw} height={hgt} />
                    );
                  })}
                  {i % 5 === (rows.length - 1) % 5 && (
                    <text className="axis" x={x + bw / 2} y={H - 6} textAnchor="middle">
                      {fmtDay(r.date)}
                    </text>
                  )}
                  <rect className="hit" x={pad.l + i * slot} y={pad.t} width={slot} height={ih} onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
            <line className="baseline" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />
          </svg>
          {h && hover !== null && (
            <div className="tooltip" style={{ left: `${((pad.l + (hover + 0.5) * slot) / W) * 100}%` }}>
              <b>{h.date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}</b>
              {SERIES.map((s) => (
                <div key={s.key}>
                  <i className={`sw sw--${s.key}`} />
                  {s.label.replace(' (estimado)', '')}
                  <span>{fmtTokens(h.values[s.key])}</span>
                </div>
              ))}
              <div className="tooltip__total">
                Total<span>{fmtTokens(h.total)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function roundTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function ProjectBars({ projects }: { projects: Progress['projects'] }) {
  const max = Math.max(1, ...projects.map((p) => p.xp));
  return (
    <ul className="pbars">
      {projects.map((p) => {
        const li = levelInfo(p.xp);
        return (
          <li key={p.cwd} title={`${p.cwd}\n${fmtFull(p.xp)} XP`}>
            <div className="pbars__top">
              <span>{shortPath(p.cwd)}</span>
              <span className="muted">
                Nv {li.level} · {fmtTokens(p.xp)}
              </span>
            </div>
            <div className="pbars__track">
              <div className="pbars__fill" style={{ width: `${(p.xp / max) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
