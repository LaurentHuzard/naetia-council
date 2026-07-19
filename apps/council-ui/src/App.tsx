import { ActivityDock } from './features/activity/ActivityDock';
import { CouncilBoard } from './features/council/CouncilBoard';
import { AppHeader } from './features/shell/AppHeader';
import { useAssemblyHealth } from './queries/useAssemblyHealth';
import { useCouncilSession } from './queries/useCouncilSession';

export function App() {
  const health = useAssemblyHealth();
  const councilSession = useCouncilSession();

  return (
    <div className="app-shell">
      <AppHeader health={health} />
      <main className="main-content">
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
