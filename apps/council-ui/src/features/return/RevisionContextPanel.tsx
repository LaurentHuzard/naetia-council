import type { CouncilSessionSnapshot } from '../../api/assembly';

type RevisionContextPanelProps = {
  session: CouncilSessionSnapshot | null;
  navigationLocked: boolean;
  onResume: (sessionId: string) => void;
};

export function RevisionContextPanel({
  session,
  navigationLocked,
  onResume,
}: RevisionContextPanelProps) {
  const revisionOf = session?.revisionOf;
  const previousDecision = session?.previousDecision;
  if (revisionOf === undefined || previousDecision === undefined) {
    return null;
  }

  return (
    <section
      className="journey-panel revision-context"
      aria-labelledby="revision-context-title"
    >
      <div className="section-kicker">Révision</div>
      <div className="revision-context-layout">
        <div>
          <h2 id="revision-context-title">Ce qui a changé</h2>
          <p className="revision-intent">{revisionOf.intent}</p>
        </div>
        <div className="revision-source" aria-label="Décision précédente">
          <span>Décision précédente · lecture seule</span>
          <strong>{previousDecision.decision.statement}</strong>
          <p>{previousDecision.decision.rationale}</p>
          <small>
            Prochain geste précédent ·{' '}
            {previousDecision.returnPoint.nextSmallStep}
          </small>
        </div>
      </div>
      <button
        type="button"
        className="revision-backlink"
        disabled={navigationLocked}
        onClick={() => onResume(revisionOf.sourceSessionId)}
      >
        Revoir la décision source
      </button>
    </section>
  );
}
