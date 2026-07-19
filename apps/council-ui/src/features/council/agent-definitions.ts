export type AgentId = 'architect' | 'trickster' | 'guardian';

export type AgentCardModel = {
  id: AgentId;
  name: string;
  description: string;
  accent: 'blue' | 'violet' | 'teal';
};

export const firstCouncilAgents: readonly AgentCardModel[] = [
  {
    id: 'architect',
    name: 'Architect',
    description: 'Planifie, structure et anticipe les conséquences.',
    accent: 'blue',
  },
  {
    id: 'trickster',
    name: 'Trickster',
    description: 'Conteste, détourne et révèle les angles morts.',
    accent: 'violet',
  },
  {
    id: 'guardian',
    name: 'Guardian',
    description: 'Protège, évalue les risques et garde le cap.',
    accent: 'teal',
  },
] as const;
