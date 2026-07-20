import { useState, type FormEvent } from 'react';

import type {
  CouncilSessionSnapshot,
  ForgeCouncilDecisionInput,
} from '../../api/assembly';
import { toAgentCardModel } from '../council/agent-definitions';

type ForgePanelProps = {
  session: CouncilSessionSnapshot | null;
  isForging: boolean;
  error: Error | null;
  onForge: (input: ForgeCouncilDecisionInput) => void;
};

export function ForgePanel({ session, isForging, error, onForge }: ForgePanelProps) {
  const [selectedFragmentIds, setSelectedFragmentIds] = useState<string[]>([]);
  const [statement, setStatement] = useState('');
  const [rationale, setRationale] = useState('');
  const [objection, setObjection] = useState('');
  const [reviewCondition, setReviewCondition] = useState('');
  const [nextSmallStep, setNextSmallStep] = useState('');

  if (session === null || session.fragments.length === 0 || session.decision !== undefined) {
    return null;
  }
  const keptFragments = session.fragments.filter((fragment) => fragment.status === 'kept');
  const keptIds = new Set(keptFragments.map((fragment) => fragment.id));
  const validSelection = selectedFragmentIds.filter((fragmentId) => keptIds.has(fragmentId));
  const canForge =
    validSelection.length > 0 &&
    statement.trim().length > 0 &&
    rationale.trim().length > 0 &&
    nextSmallStep.trim().length > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canForge) return;
    onForge({
      fragmentIds: validSelection,
      statement: statement.trim(),
      rationale: rationale.trim(),
      ...(objection.trim().length === 0 ? {} : { objection: objection.trim() }),
      ...(reviewCondition.trim().length === 0
        ? {}
        : { reviewCondition: reviewCondition.trim() }),
      nextSmallStep: nextSmallStep.trim(),
    });
  };

  return (
    <section className="journey-panel forge-panel" aria-labelledby="forge-title">
      <div className="section-kicker">Forge</div>
      <div className="journey-heading">
        <div>
          <h2 id="forge-title">Transformer le butin en décision</h2>
          <p>Sélectionne les sources. Le Council conseille ; tu gouvernes.</p>
        </div>
      </div>

      {keptFragments.length === 0 ? (
        <div className="forge-empty">
          Un KEEP au moins est nécessaire avant d’allumer la Forge.
        </div>
      ) : (
        <form className="forge-form" onSubmit={handleSubmit}>
          <fieldset className="forge-sources">
            <legend>Fragments sources</legend>
            {keptFragments.map((fragment) => {
              const run = session.runs.find((candidate) => candidate.runId === fragment.runId);
              const definition = session.agentDefinitions.find(
                (candidate) => candidate.id === run?.agentDefinitionId,
              );
              const agent =
                definition === undefined ? undefined : toAgentCardModel(definition);
              return (
                <label key={fragment.id}>
                  <input
                    type="checkbox"
                    checked={validSelection.includes(fragment.id)}
                    onChange={(event) =>
                      setSelectedFragmentIds((current) =>
                        event.target.checked
                          ? [...current, fragment.id]
                          : current.filter((candidate) => candidate !== fragment.id),
                      )
                    }
                  />
                  <span>
                    <strong>{agent?.name ?? 'Agent'}</strong>
                    {fragment.content.slice(0, 150)}
                    {fragment.content.length > 150 ? '…' : ''}
                  </span>
                </label>
              );
            })}
          </fieldset>

          <div className="forge-fields">
            <label>
              <span>Décision</span>
              <textarea
                value={statement}
                maxLength={500}
                rows={3}
                required
                onChange={(event) => setStatement(event.target.value)}
              />
            </label>
            <label>
              <span>Pourquoi maintenant ?</span>
              <textarea
                value={rationale}
                maxLength={5_000}
                rows={4}
                required
                onChange={(event) => setRationale(event.target.value)}
              />
            </label>
            <label>
              <span>Objection conservée</span>
              <textarea
                value={objection}
                maxLength={5_000}
                rows={3}
                onChange={(event) => setObjection(event.target.value)}
              />
            </label>
            <label>
              <span>Condition de révision</span>
              <textarea
                value={reviewCondition}
                maxLength={2_000}
                rows={3}
                onChange={(event) => setReviewCondition(event.target.value)}
              />
            </label>
            <label className="forge-next-step">
              <span>Prochain petit geste</span>
              <input
                value={nextSmallStep}
                maxLength={1_000}
                required
                onChange={(event) => setNextSmallStep(event.target.value)}
              />
            </label>
          </div>

          <button className="primary-button forge-submit" type="submit" disabled={!canForge || isForging}>
            {isForging ? 'Forge en cours…' : 'Forger la décision'}
          </button>
          {error !== null ? (
            <p className="panel-error" role="alert">
              {error.message}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}
