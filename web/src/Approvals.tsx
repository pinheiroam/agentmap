import { useState } from 'react';
import type { Agent, Approval, Decision } from '../../daemon/src/types.ts';
import { ago, shortPath } from './format.ts';

interface Props {
  approval: Approval;
  agent?: Agent;
  now: number;
  compact?: boolean;
  decide: (id: string, decision: Decision, message?: string) => void;
  onOpen?: () => void;
}

export function ApprovalCard({ approval, agent, now, compact, decide, onOpen }: Props) {
  const [reason, setReason] = useState('');
  const [denying, setDenying] = useState(false);

  return (
    <div className={`approval${compact ? ' approval--compact' : ''}`}>
      <div className="approval__head">
        <span className="approval__flag">⚑</span>
        <span className="approval__tool">{approval.tool}</span>
        <span className="approval__time">{ago(approval.createdAt, now)}</span>
      </div>
      {compact && agent && (
        <button className="approval__agent" onClick={onOpen} title="Abrir agente">
          {agent.title || agent.id}
        </button>
      )}
      <pre className="approval__summary">{approval.summary || JSON.stringify(approval.input, null, 2)}</pre>
      {!compact && approval.cwd && <div className="approval__cwd">em {shortPath(approval.cwd)}</div>}
      {denying ? (
        <form
          className="approval__deny"
          onSubmit={(e) => {
            e.preventDefault();
            decide(approval.id, 'deny', reason.trim() || undefined);
          }}
        >
          <input
            autoFocus
            placeholder="Diga ao agente o que fazer em vez disso (opcional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="approval__actions">
            <button type="submit" className="btn btn--danger">
              Negar
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setDenying(false)}>
              Voltar
            </button>
          </div>
        </form>
      ) : (
        <div className="approval__actions">
          <button className="btn btn--primary" onClick={() => decide(approval.id, 'allow')}>
            Permitir
          </button>
          {approval.canAlwaysAllow && (
            <button className="btn" onClick={() => decide(approval.id, 'allow_always')} title="Salva a regra sugerida pelo Claude">
              Sempre
            </button>
          )}
          <button className="btn btn--danger-ghost" onClick={() => setDenying(true)}>
            Negar…
          </button>
          {!compact && (
            <button className="btn btn--ghost" onClick={() => decide(approval.id, 'ask')} title="Devolve a pergunta para o terminal">
              Responder no terminal
            </button>
          )}
        </div>
      )}
    </div>
  );
}
