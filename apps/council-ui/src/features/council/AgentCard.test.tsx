import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentCard } from './AgentCard';
import { firstCouncilAgents } from './agent-definitions';

describe('AgentCard model execution', () => {
  it('states honestly when Codex CLI provides no usage counters', () => {
    render(
      <AgentCard
        agent={firstCouncilAgents[0]!}
        run={{
          runId: 'run-without-usage',
          sessionId: 'session-without-usage',
          agentId: 'architect',
          agentDefinitionId: 'architect.v1',
          status: 'completed',
          contribution: 'Une contribution complète.',
          modelExecution: {
            adapter: 'codex-cli',
            durationMs: 850,
          },
        }}
        cancelling={false}
        onCancel={vi.fn()}
      />,
    );

    const metrics = screen.getByRole('region', {
      name: 'Mesures du modèle',
    });
    expect(within(metrics).getByText('850 ms')).toBeVisible();
    expect(within(metrics).getByText('Usage non fourni par Codex CLI.'))
      .toBeVisible();
    expect(within(metrics).queryByText('Entrée')).not.toBeInTheDocument();
  });

  it('identifies an OpenAI-compatible local provider without inventing usage', () => {
    render(
      <AgentCard
        agent={firstCouncilAgents[0]!}
        run={{
          runId: 'run-local-provider',
          sessionId: 'session-local-provider',
          agentId: 'architect',
          agentDefinitionId: 'architect.v1',
          status: 'completed',
          contribution: 'Une contribution locale.',
          modelExecution: {
            adapter: 'openai-compatible',
            model: 'local-council-model',
            durationMs: 1_250,
          },
        }}
        cancelling={false}
        onCancel={vi.fn()}
      />,
    );

    const metrics = screen.getByRole('region', {
      name: 'Mesures du modèle',
    });
    expect(within(metrics).getByText('Provider local · local-council-model'))
      .toBeVisible();
    expect(within(metrics).getByText('Usage non fourni par le provider local.'))
      .toBeVisible();
  });
});
