import type { CouncilSessionSnapshot } from '../../api/assembly';
import type { AssemblyHealthQuery } from '../../queries/useAssemblyHealth';
import type { CouncilSignalStatus } from '../../queries/useCouncilEventStream';
import { useCouncilUiStore } from '../../state/council-ui-store';

type ActivityDockProps = {
  health: AssemblyHealthQuery;
  session: CouncilSessionSnapshot | null;
  signalStatus: CouncilSignalStatus;
};

export function ActivityDock({
  health,
  session,
  signalStatus,
}: ActivityDockProps) {
  const followsLiveActivity = useCouncilUiStore(
    (state) => state.followsLiveActivity,
  );
  const toggleLiveActivity = useCouncilUiStore(
    (state) => state.toggleLiveActivity,
  );

  const latestEvent = session?.events.at(-1);
  const message = getSignalMessage(signalStatus, latestEvent?.type, health);

  return (
    <aside className="activity-dock" aria-label="Activité en direct">
      <div className="live-title">
        <span
          className={`live-dot live-dot--${signalStatus}`}
          aria-hidden="true"
        />
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

function getSignalMessage(
  status: CouncilSignalStatus,
  latestEventType: string | undefined,
  health: AssemblyHealthQuery,
): string {
  if (status === 'live') {
    return latestEventType === undefined
      ? 'Flux direct connecté au journal.'
      : `Flux direct · ${latestEventType}`;
  }
  if (status === 'connecting') {
    return 'Connexion au journal…';
  }
  if (status === 'reconnecting') {
    return 'Signal interrompu, reconnexion…';
  }
  if (status === 'polling') {
    return 'Flux indisponible · lecture périodique';
  }
  if (health.isSuccess) {
    return 'The Assembly est prête à recevoir une prochaine convocation.';
  }
  return health.isError
    ? 'Aucun signal reçu de The Assembly.'
    : 'Recherche du signal de The Assembly…';
}
