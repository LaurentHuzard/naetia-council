import type {
  CouncilSessionSnapshot,
  FragmentActionInput,
} from '../../api/assembly';
import { toAgentCardModel } from '../council/agent-definitions';

type LootPanelProps = {
  session: CouncilSessionSnapshot | null;
  actingFragmentId: string | null;
  error: Error | null;
  onAction: (input: FragmentActionInput) => void;
};

const statusLabels = {
  available: 'À décider',
  kept: 'Conservé',
  challenged: 'Challengé',
  composted: 'Composté',
} as const;

export function LootPanel({
  session,
  actingFragmentId,
  error,
  onAction,
}: LootPanelProps) {
  if (session === null || session.fragments.length === 0) {
    return null;
  }
  const locked = session.decision !== undefined;

  return (
    <section className="journey-panel loot-panel" aria-labelledby="loot-title">
      <div className="section-kicker">Butin</div>
      <div className="journey-heading">
        <div>
          <h2 id="loot-title">Choisir ce qui mérite de rester</h2>
          <p>
            Chaque voix livre un fragment durable. Rien n’entre dans la Forge
            sans un KEEP explicite.
          </p>
        </div>
        <span className="journey-count">{session.fragments.length} fragments</span>
      </div>

      <div className="loot-grid">
        {session.fragments.map((fragment) => {
          const run = session.runs.find((candidate) => candidate.runId === fragment.runId);
          const definition = session.agentDefinitions.find(
            (candidate) => candidate.id === run?.agentDefinitionId,
          );
          const agent = definition === undefined ? undefined : toAgentCardModel(definition);
          const isActing = actingFragmentId === fragment.id;
          const actionsDisabled = locked || isActing || fragment.status === 'composted';

          return (
            <article
              className={`loot-card loot-card--${fragment.status} loot-card--${agent?.accent ?? 'blue'}`}
              key={fragment.id}
              aria-label={`Fragment ${agent?.name ?? 'Agent'}`}
            >
              <header>
                <span className="loot-agent">{agent?.name ?? 'Agent'}</span>
                <span className={`loot-status loot-status--${fragment.status}`}>
                  {statusLabels[fragment.status]}
                </span>
              </header>
              <p className="loot-copy">{fragment.content}</p>
              <footer className="loot-actions" aria-label={`Actions pour ${agent?.name ?? 'ce fragment'}`}>
                <FragmentActionButton
                  action="keep"
                  active={fragment.status === 'kept'}
                  disabled={actionsDisabled || fragment.status === 'kept'}
                  fragmentId={fragment.id}
                  onAction={onAction}
                />
                <FragmentActionButton
                  action="challenge"
                  active={fragment.status === 'challenged'}
                  disabled={actionsDisabled || fragment.status === 'challenged'}
                  fragmentId={fragment.id}
                  onAction={onAction}
                />
                <FragmentActionButton
                  action="compost"
                  active={fragment.status === 'composted'}
                  disabled={actionsDisabled}
                  fragmentId={fragment.id}
                  onAction={onAction}
                />
              </footer>
            </article>
          );
        })}
      </div>
      {locked ? (
        <p className="panel-note">La Forge est scellée : les sources restent désormais immuables.</p>
      ) : null}
      {error !== null ? (
        <p className="panel-error" role="alert">
          {error.message}
        </p>
      ) : null}
    </section>
  );
}

function FragmentActionButton({
  action,
  active,
  disabled,
  fragmentId,
  onAction,
}: Readonly<{
  action: FragmentActionInput['action'];
  active: boolean;
  disabled: boolean;
  fragmentId: string;
  onAction: (input: FragmentActionInput) => void;
}>) {
  const label =
    action === 'keep' ? 'KEEP' : action === 'challenge' ? 'CHALLENGE' : 'COMPOST';
  return (
    <button
      className={active ? 'loot-action loot-action--active' : 'loot-action'}
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={() => onAction({ fragmentId, action })}
    >
      {label}
    </button>
  );
}
