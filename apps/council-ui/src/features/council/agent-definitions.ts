import { COUNCIL_AGENT_DEFINITIONS } from '@naetia/agent-definitions';
import type { AgentDefinition, AgentRole } from '@naetia/assembly-domain';

export type AgentId = AgentRole;

export type AgentCardModel = {
  id: AgentId;
  definitionId: string;
  name: string;
  description: string;
  accent: 'blue' | 'violet' | 'teal';
};

const accentByRole: Readonly<Record<AgentRole, AgentCardModel['accent']>> = {
  architect: 'blue',
  builder: 'teal',
  trickster: 'violet',
  guardian: 'teal',
  archivist: 'blue',
  'game-designer': 'violet',
  'llm-genie': 'blue',
  'inner-child': 'teal',
  scout: 'violet',
};

export function toAgentCardModel(
  definition: Pick<
    AgentDefinition,
    'id' | 'role' | 'name' | 'perspective'
  >,
): AgentCardModel {
  return {
    id: definition.role,
    definitionId: definition.id,
    name: definition.name,
    description: definition.perspective,
    accent: accentByRole[definition.role],
  };
}

export const councilAgents: readonly AgentCardModel[] =
  COUNCIL_AGENT_DEFINITIONS.map(toAgentCardModel);

// Kept as a compatibility export for focused component tests.
export const firstCouncilAgents = councilAgents;
