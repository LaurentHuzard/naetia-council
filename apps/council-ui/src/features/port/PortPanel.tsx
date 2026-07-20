import type { CouncilSessionSummary } from '../../api/assembly';
import type { CouncilSessionController } from '../../queries/useCouncilSession';
import type { RecentCouncilSessionsQuery } from '../../queries/useRecentCouncilSessions';

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

type PortPanelProps = {
  recentSessions: RecentCouncilSessionsQuery;
  councilSession: CouncilSessionController;
};

export function PortPanel({ recentSessions, councilSession }: PortPanelProps) {
  const sessions = recentSessions.data ?? [];

  return (
    <section className="port-panel" aria-labelledby="port-title">
      <div className="port-heading">
        <div>
          <div className="section-kicker">Port</div>
          <h1 id="port-title">Reprendre le fil</h1>
          <p>
            Le journal de The Assembly garde les dernières quêtes. Rien ne
            redémarre avant ton choix.
          </p>
        </div>
        <button
          className="port-new-quest"
          type="button"
          disabled={
            councilSession.activeSessionId === null ||
            councilSession.isNavigationLocked
          }
          onClick={councilSession.newQuest}
        >
          {councilSession.activeSessionId === null
            ? 'Nouvelle quête ouverte'
            : 'Nouvelle quête'}
        </button>
      </div>

      {recentSessions.isPending ? (
        <p className="port-state">Lecture du journal local…</p>
      ) : null}
      {recentSessions.isError ? (
        <div className="port-state port-state--error" role="alert">
          <span>Le Port est momentanément indisponible.</span>
          <button type="button" onClick={() => void recentSessions.refetch()}>
            Réessayer
          </button>
        </div>
      ) : null}
      {recentSessions.isSuccess && sessions.length === 0 ? (
        <p className="port-state">
          Aucune ancienne quête. La première peut commencer juste dessous.
        </p>
      ) : null}
      {sessions.length > 0 ? (
        <ol className="port-list" aria-label="Sessions récentes">
          {sessions.map((session) => (
            <PortSessionItem
              key={session.sessionId}
              session={session}
              isActive={session.sessionId === councilSession.activeSessionId}
              isResuming={
                session.sessionId === councilSession.resumingSessionId
              }
              disabled={councilSession.isNavigationLocked}
              onResume={councilSession.resumeSession}
            />
          ))}
        </ol>
      ) : null}
      {councilSession.resumeError !== null ? (
        <p className="port-resume-error" role="alert">
          Cette quête n’a pas pu être reprise. Le Port reste ouvert.
        </p>
      ) : null}
    </section>
  );
}

function PortSessionItem({
  session,
  isActive,
  isResuming,
  disabled,
  onResume,
}: Readonly<{
  session: CouncilSessionSummary;
  isActive: boolean;
  isResuming: boolean;
  disabled: boolean;
  onResume: (sessionId: string) => void;
}>) {
  return (
    <li className={isActive ? 'port-item port-item--active' : 'port-item'}>
      <div className="port-item-copy">
        <div className="port-item-meta">
          <span>{phaseLabel(session)}</span>
          <time dateTime={session.lastActivityAt}>
            {dateFormatter.format(new Date(session.lastActivityAt))}
          </time>
        </div>
        <h2>{session.quest.title}</h2>
        {session.revisionOf !== undefined ? (
          <p className="port-item-revision">
            Révision · {session.revisionOf.intent}
          </p>
        ) : null}
        {session.hasDecision ? (
          <p>Prochain geste · {session.nextSmallStep}</p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={isActive || disabled}
        aria-current={isActive ? 'true' : undefined}
        onClick={() => onResume(session.sessionId)}
      >
        {isActive ? 'Ouverte' : isResuming ? 'Reprise…' : 'Reprendre'}
      </button>
    </li>
  );
}

function phaseLabel(session: CouncilSessionSummary): string {
  if (session.hasDecision) {
    return session.revisionOf === undefined
      ? 'Décision forgée'
      : 'Révision forgée';
  }
  if (session.status === 'created') {
    return session.revisionOf === undefined ? 'À convoquer' : 'Révision à convoquer';
  }
  if (session.status === 'running') return 'Council actif';
  return 'À forger';
}
