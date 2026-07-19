import type { CouncilSessionSnapshot } from '../../api/assembly';
import { firstCouncilAgents } from '../council/agent-definitions';

type ReturnPanelProps = {
  session: CouncilSessionSnapshot | null;
};

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function ReturnPanel({ session }: ReturnPanelProps) {
  const decision = session?.decision;
  const returnPoint = session?.returnPoint;
  if (session === null || decision === undefined || returnPoint === undefined) {
    return null;
  }

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
    </section>
  );
}
