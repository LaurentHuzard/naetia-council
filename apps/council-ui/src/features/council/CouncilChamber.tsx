import { useState } from 'react';
import type { AgentRoleMessage } from '@naetia/assembly-protocol';

import type { CouncilSessionSnapshot } from '../../api/assembly';
import { councilAgents } from './agent-definitions';

type CouncilChamberProps = {
  session: CouncilSessionSnapshot | null;
  isConvening: boolean;
  error: Error | null;
  onConvene: (agentIds: readonly AgentRoleMessage[]) => void;
};

const allAgentIds = councilAgents.map(({ id }) => id);

export function CouncilChamber({
  session,
  isConvening,
  error,
  onConvene,
}: CouncilChamberProps) {
  const recommendation = session?.delegationRecommendation ?? [];
  const [selectedAgentIds, setSelectedAgentIds] = useState<AgentRoleMessage[]>(
    () => recommendation.map(({ agentId }) => agentId),
  );
  const hasRuns = (session?.runs.length ?? 0) > 0;
  const canEdit = session !== null && !hasRuns && !isConvening;
  const activeAgentIds = hasRuns
    ? session!.agentDefinitions.map(({ role }) => role)
    : selectedAgentIds;
  const activeAgentSet = new Set(activeAgentIds);
  const recommendedAgentSet = new Set(
    recommendation.map(({ agentId }) => agentId),
  );
  const recommendationReason = new Map(
    recommendation.map(({ agentId, reason }) => [agentId, reason]),
  );

  const toggleAgent = (agentId: AgentRoleMessage) => {
    if (!canEdit) return;
    setSelectedAgentIds((current) =>
      current.includes(agentId)
        ? current.filter((candidate) => candidate !== agentId)
        : [...current, agentId],
    );
  };

  return (
    <section className="council-chamber" aria-labelledby="council-chamber-title">
      <div className="chamber-heading">
        <div>
          <div className="section-kicker">The Council</div>
          <h2 id="council-chamber-title">Toute la Chambre est présente.</h2>
          <p>
            La présence constitue le Council. La convocation choisit les voix qui
            gagnent la parole pour cette quête.
          </p>
        </div>
        <div className="delegation-count" aria-live="polite">
          <strong>{activeAgentIds.length}</strong>
          <span>sur 9 membres</span>
        </div>
      </div>

      <div className="chamber-members" role="group" aria-label="Composition du Council">
        {councilAgents.map((agent) => {
          const run = session?.runs.find(({ agentId }) => agentId === agent.id);
          const selected = activeAgentSet.has(agent.id);
          const status = memberStatus({
            hasSession: session !== null,
            hasRuns,
            selected,
            recommended: recommendedAgentSet.has(agent.id),
            runStatus: run?.status,
          });
          return (
            <label
              className={`chamber-member chamber-member--${status.kind}`}
              key={agent.id}
            >
              <input
                type="checkbox"
                checked={selected}
                disabled={!canEdit}
                onChange={() => toggleAgent(agent.id)}
              />
              <span className="chamber-member-copy">
                <strong>{agent.name}</strong>
                <span>{agent.description}</span>
                {canEdit && recommendationReason.has(agent.id) ? (
                  <small>{recommendationReason.get(agent.id)}</small>
                ) : null}
              </span>
              <span className="chamber-member-status">{status.label}</span>
            </label>
          );
        })}
      </div>

      <div className="delegation-console">
        <div>
          <span className="delegation-label">
            {hasRuns ? 'Délégation convoquée' : 'Délégation active'}
          </span>
          <p>
            {activeAgentIds.length === 0
              ? 'Choisissez au moins une voix.'
              : councilAgents
                  .filter(({ id }) => activeAgentSet.has(id))
                  .map(({ name }) => name)
                  .join(' · ')}
          </p>
          {selectedAgentIds.length === 9 && !hasRuns ? (
            <small>
              Full Council : neuf runs distincts. La chorégraphie en cercles est
              le prochain cap.
            </small>
          ) : null}
        </div>
        {canEdit ? (
          <div className="delegation-actions">
            <button
              type="button"
              onClick={() =>
                setSelectedAgentIds(
                  recommendation.map(({ agentId }) => agentId),
                )
              }
            >
              Recommandation
            </button>
            <button type="button" onClick={() => setSelectedAgentIds(allAgentIds)}>
              Call the Full Council
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={selectedAgentIds.length === 0 || isConvening}
              onClick={() => onConvene(selectedAgentIds)}
            >
              {isConvening
                ? 'Convocation…'
                : `Convoquer ${selectedAgentIds.length} voix`}
            </button>
          </div>
        ) : null}
      </div>
      {session === null ? (
        <p className="chamber-note">
          Préparez une quête pour recevoir une délégation recommandée.
        </p>
      ) : null}
      {error !== null ? (
        <p className="health-error" role="alert">
          La convocation a échoué. La délégation reste visible et aucun choix
          humain n’est remplacé.
        </p>
      ) : null}
    </section>
  );
}

function memberStatus({
  hasSession,
  hasRuns,
  selected,
  recommended,
  runStatus,
}: Readonly<{
  hasSession: boolean;
  hasRuns: boolean;
  selected: boolean;
  recommended: boolean;
  runStatus: CouncilSessionSnapshot['runs'][number]['status'] | undefined;
}>): Readonly<{ kind: string; label: string }> {
  if (runStatus === 'completed') return { kind: 'contributed', label: 'Contribué' };
  if (runStatus === 'failed') return { kind: 'failed', label: 'Échec' };
  if (runStatus === 'cancelled') return { kind: 'resting', label: 'Annulé' };
  if (runStatus !== undefined) return { kind: 'thinking', label: 'En cours' };
  if (hasRuns) return { kind: 'resting', label: 'Au repos' };
  if (!hasSession) return { kind: 'available', label: 'Disponible' };
  if (selected && recommended) return { kind: 'recommended', label: 'Recommandé' };
  if (selected) return { kind: 'summoned', label: 'Sélectionné' };
  return { kind: 'available', label: 'Disponible' };
}
