import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchCouncilSession } from './assembly';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Assembly snapshot boundary', () => {
  it('rejects malformed model execution metrics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            sessionId: 'session-invalid-metrics',
            quest: {
              questId: 'quest-invalid-metrics',
              title: 'Refuser une mesure impossible',
            },
            status: 'completed',
            createdAt: '2026-07-20T02:00:00.000Z',
            eventCursor: 10,
            runs: [
              {
                runId: 'run-invalid-metrics',
                sessionId: 'session-invalid-metrics',
                agentId: 'architect',
                agentDefinitionId: 'architect.v1',
                status: 'completed',
                contribution: 'Une contribution ne légitime pas une durée négative.',
                modelExecution: {
                  adapter: 'codex-cli',
                  durationMs: -1,
                },
              },
            ],
            fragments: [],
            events: [],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(fetchCouncilSession('session-invalid-metrics')).rejects.toThrow(
      'The Assembly a renvoyé un snapshot de session invalide.',
    );
  });
});
