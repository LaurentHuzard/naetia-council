import type { AssemblyHealthQuery } from '../../queries/useAssemblyHealth';
import { useCouncilUiStore } from '../../state/council-ui-store';

type ActivityDockProps = {
  health: AssemblyHealthQuery;
  session: CouncilSessionSnapshot | null;
};

export function ActivityDock({ health, session }: ActivityDockProps) {
  const followsLiveActivity = useCouncilUiStore(
    (state) => state.followsLiveActivity,
  );
  const toggleLiveActivity = useCouncilUiStore(
    (state) => state.toggleLiveActivity,
  );

  const latestRun = session?.runs.at(-1);
  const message = latestRun !== undefined
    ? `${latestRun.agentId} · ${latestRun.status}`
    : health.isSuccess
      ? 'The Assembly est prête à recevoir une prochaine convocation.'
    : health.isError
      ? 'Aucun signal reçu de The Assembly.'
      : 'Recherche du signal de The Assembly…';

  return (
    <aside className="activity-dock" aria-label="Activité en direct">
      <div className="live-title">
        <span className="live-dot" aria-hidden="true" />
        <span>Activité en direct</span>
      </div>
      <p aria-live="polite">{message}</p>
      <label className="follow-control">
        <span>Défilement auto</span>
        <input
          type="checkbox"
          checked={followsLiveActivity}
          onChange={toggleLiveActivity}
        />
        <span className="toggle" aria-hidden="true" />
      </label>
    </aside>
  );
}
import type { CouncilSessionSnapshot } from '../../api/assembly';
