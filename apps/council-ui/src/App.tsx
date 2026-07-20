import { ActivityDock } from './features/activity/ActivityDock';
import { CouncilBoard } from './features/council/CouncilBoard';
import { PortPanel } from './features/port/PortPanel';
import { AppHeader } from './features/shell/AppHeader';
import { useAssemblyHealth } from './queries/useAssemblyHealth';
import { useCouncilSession } from './queries/useCouncilSession';
import { useRecentCouncilSessions } from './queries/useRecentCouncilSessions';

export function App() {
  const health = useAssemblyHealth();
  const councilSession = useCouncilSession();
  const recentSessions = useRecentCouncilSessions();

  return (
    <div className="app-shell">
      <AppHeader health={health} />
      <main className="main-content">
        <PortPanel
          recentSessions={recentSessions}
          councilSession={councilSession}
        />
        <CouncilBoard health={health} councilSession={councilSession} />
        <ActivityDock
          health={health}
          session={councilSession.session}
          signalStatus={councilSession.signalStatus}
        />
      </main>
    </div>
  );
}
