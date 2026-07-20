import { useState, type FormEvent } from 'react';

import type {
  CouncilSessionSnapshot,
  CreateCouncilRevisionInput,
} from '../../api/assembly';
import { firstCouncilAgents } from '../council/agent-definitions';

type ReturnPanelProps = {
  session: CouncilSessionSnapshot | null;
  isPreparingRevision: boolean;
  revisionError: Error | null;
  onPrepareRevision: (input: CreateCouncilRevisionInput) => void;
};

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function ReturnPanel({
  session,
  isPreparingRevision,
  revisionError,
  onPrepareRevision,
}: ReturnPanelProps) {
  const [isPreparing, setIsPreparing] = useState(false);
  const [intent, setIntent] = useState('');
  const decision = session?.decision;
  const returnPoint = session?.returnPoint;
  if (session === null || decision === undefined || returnPoint === undefined) {
    return null;
  }

  const handleRevisionSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (intent.trim().length === 0 || isPreparingRevision) return;
    onPrepareRevision({
      decisionId: decision.id,
      intent: intent.trim(),
    });
  };

  return (
    <section className="journey-panel return-panel" aria-labelledby="return-title">
      <div className="section-kicker">Return</div>
      <div className="return-layout">
        <div className="return-decision">
          <p className="return-eyebrow">Décision vivante</p>
          <h2 id="return-title">{decision.statement}</h2>
          <p>{decision.rationale}</p>
        </div>
        <dl className="return-details">
          <div>
            <dt>Objection ouverte</dt>
            <dd>{returnPoint.openObjection ?? 'Aucune objection ouverte.'}</dd>
          </div>
          <div>
            <dt>Condition de révision</dt>
            <dd>{decision.reviewCondition ?? 'À réviser par décision humaine.'}</dd>
          </div>
          <div className="return-next-step">
            <dt>Prochain petit geste</dt>
            <dd>{returnPoint.nextSmallStep}</dd>
          </div>
        </dl>
      </div>

      <div className="return-provenance">
        <h3>Provenance</h3>
        <ul>
          {decision.sources.map((source) => {
            const run = session.runs.find((candidate) => candidate.runId === source.runId);
            const agent = firstCouncilAgents.find(
              (candidate) => candidate.id === run?.agentId,
            );
            return (
              <li key={source.fragmentId}>
                <strong>{agent?.name ?? source.agentDefinitionId}</strong>
                <span>Fragment {source.fragmentId.slice(0, 8)}</span>
              </li>
            );
          })}
        </ul>
        <p>
          Dernière activité{' '}
          <time dateTime={returnPoint.updatedAt}>
            {dateFormatter.format(new Date(returnPoint.updatedAt))}
          </time>
        </p>
      </div>

      <div className="return-revision">
        <div>
          <h3>Réviser sans écraser</h3>
          <p>
            La décision et ses sources resteront intactes. Une nouvelle session
            attendra ta convocation explicite.
          </p>
        </div>
        {isPreparing ? (
          <form className="revision-form" onSubmit={handleRevisionSubmit}>
            <label>
              <span>Ce qui a changé</span>
              <textarea
                value={intent}
                maxLength={2_000}
                rows={3}
                required
                autoFocus
                onChange={(event) => setIntent(event.target.value)}
              />
            </label>
            <div className="revision-actions">
              <button
                type="button"
                disabled={isPreparingRevision}
                onClick={() => setIsPreparing(false)}
              >
                Annuler
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={intent.trim().length === 0 || isPreparingRevision}
              >
                {isPreparingRevision
                  ? 'Préparation…'
                  : 'Créer la session de révision'}
              </button>
            </div>
            {revisionError !== null ? (
              <p className="panel-error" role="alert">
                {revisionError.message}
              </p>
            ) : null}
          </form>
        ) : (
          <button
            className="secondary-button"
            type="button"
            onClick={() => setIsPreparing(true)}
          >
            Préparer une révision
          </button>
        )}
      </div>
    </section>
  );
}
