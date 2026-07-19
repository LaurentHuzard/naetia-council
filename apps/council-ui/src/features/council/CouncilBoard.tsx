import type { AssemblyHealthQuery } from '../../queries/useAssemblyHealth';
import type { CouncilSessionController } from '../../queries/useCouncilSession';
import { AgentCard } from './AgentCard';
import { firstCouncilAgents } from './agent-definitions';
import { QuestPanel } from './QuestPanel';

type CouncilBoardProps = {
  health: AssemblyHealthQuery;
  councilSession: CouncilSessionController;
};

export function CouncilBoard({ health, councilSession }: CouncilBoardProps) {
  return (
    <div id="main-content">
      <QuestPanel health={health} councilSession={councilSession} />
      <section className="council-grid" aria-label="Membres du Council">
        {firstCouncilAgents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            run={councilSession.session?.runs.find(
              (run) => run.agentId === agent.id,
            )}
            cancelling={
              councilSession.cancellingRunId ===
              councilSession.session?.runs.find((run) => run.agentId === agent.id)
                ?.runId
            }
            onCancel={councilSession.cancelRun}
          />
        ))}
      </section>
    </div>
  );
}
