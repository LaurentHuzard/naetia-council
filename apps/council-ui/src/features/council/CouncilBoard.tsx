import type { AssemblyHealthQuery } from '../../queries/useAssemblyHealth';
import type { CouncilSessionController } from '../../queries/useCouncilSession';
import { ForgePanel } from '../forge/ForgePanel';
import { LootPanel } from '../loot/LootPanel';
import { ReturnPanel } from '../return/ReturnPanel';
import { RevisionContextPanel } from '../return/RevisionContextPanel';
import { AgentCard } from './AgentCard';
import { toAgentCardModel } from './agent-definitions';
import { CouncilChamber } from './CouncilChamber';
import { QuestPanel } from './QuestPanel';

type CouncilBoardProps = {
  health: AssemblyHealthQuery;
  councilSession: CouncilSessionController;
};

export function CouncilBoard({ health, councilSession }: CouncilBoardProps) {
  return (
    <div id="main-content">
      <QuestPanel
        key={`quest:${councilSession.activeSessionId ?? 'new'}`}
        health={health}
        councilSession={councilSession}
      />
      <RevisionContextPanel
        session={councilSession.session}
        navigationLocked={councilSession.isNavigationLocked}
        onResume={councilSession.resumeSession}
      />
      <CouncilChamber
        key={`chamber:${councilSession.session?.sessionId ?? 'new'}`}
        session={councilSession.session}
        isConvening={councilSession.isConvening}
        error={councilSession.conveneError}
        onConvene={councilSession.convene}
      />
      {(councilSession.session?.agentDefinitions.length ?? 0) === 0 ? null : (
        <section className="council-grid" aria-label="Voix convoquées">
          {councilSession.session?.agentDefinitions.map((definition) => (
            <AgentCardSlot
              key={definition.id}
              agent={toAgentCardModel(definition)}
              councilSession={councilSession}
            />
          ))}
        </section>
      )}
      <LootPanel
        session={councilSession.session}
        actingFragmentId={councilSession.actingFragmentId}
        error={councilSession.fragmentError}
        onAction={councilSession.actOnFragment}
      />
      <ForgePanel
        key={`forge:${councilSession.session?.sessionId ?? 'none'}`}
        session={councilSession.session}
        isForging={councilSession.isForging}
        error={councilSession.forgeError}
        onForge={councilSession.forgeDecision}
      />
      <ReturnPanel
        key={`return:${councilSession.session?.decision?.id ?? 'none'}`}
        session={councilSession.session}
        isPreparingRevision={councilSession.isPreparingRevision}
        revisionError={councilSession.revisionError}
        onPrepareRevision={councilSession.prepareRevision}
      />
    </div>
  );
}

function AgentCardSlot({
  agent,
  councilSession,
}: Readonly<{
  agent: ReturnType<typeof toAgentCardModel>;
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
