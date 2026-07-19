import type { AssemblyHealthQuery } from '../../queries/useAssemblyHealth';
import type { CouncilSessionController } from '../../queries/useCouncilSession';
import { ForgePanel } from '../forge/ForgePanel';
import { LootPanel } from '../loot/LootPanel';
import { ReturnPanel } from '../return/ReturnPanel';
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
          <AgentCardSlot
            key={agent.id}
            agent={agent}
            councilSession={councilSession}
          />
        ))}
      </section>
      <LootPanel
        session={councilSession.session}
        actingFragmentId={councilSession.actingFragmentId}
        error={councilSession.fragmentError}
        onAction={councilSession.actOnFragment}
      />
      <ForgePanel
        session={councilSession.session}
        isForging={councilSession.isForging}
        error={councilSession.forgeError}
        onForge={councilSession.forgeDecision}
      />
      <ReturnPanel session={councilSession.session} />
    </div>
  );
}

function AgentCardSlot({
  agent,
  councilSession,
}: Readonly<{
  agent: (typeof firstCouncilAgents)[number];
  councilSession: CouncilSessionController;
}>) {
  const run = councilSession.session?.runs.find(
    (candidate) => candidate.agentId === agent.id,
  );
  return (
    <AgentCard
      agent={agent}
      run={run}
      cancelling={councilSession.cancellingRunId === run?.runId}
      onCancel={councilSession.cancelRun}
    />
  );
}
