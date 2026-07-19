import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { useCouncilUiStore } from './state/council-ui-store';

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  useCouncilUiStore.setState({
    activeSessionId: null,
    followsLiveActivity: true,
  });
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('Naetia Council shell', () => {
  it('reports when The Assembly health endpoint is available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'ok', service: 'assemblyd' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    renderApp();

    await waitFor(() => {
      expect(
        screen.getByRole('status', { name: 'État de The Assembly' }),
      ).toHaveTextContent(
        'disponible',
      );
    });
    expect(screen.getByText(/prête à recevoir/i)).toBeInTheDocument();
  });

  it('keeps Architect, Trickster and Guardian in separate cards', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
      ),
    );

    renderApp();

    const council = screen.getByRole('region', { name: 'Membres du Council' });
    const cards = within(council).getAllByRole('article');

    expect(cards).toHaveLength(3);
    expect(
      within(cards[0]!).getByRole('heading', { name: 'Architect' }),
    ).toBeVisible();
    expect(
      within(cards[1]!).getByRole('heading', { name: 'Trickster' }),
    ).toBeVisible();
    expect(
      within(cards[2]!).getByRole('heading', { name: 'Guardian' }),
    ).toBeVisible();
  });

  it('convenes three runs and cancels only the selected run', async () => {
    const runningSnapshot = {
      sessionId: 'session-1',
      quest: {
        questId: 'quest-1',
        title: 'Ouvrir la porte du royaume',
      },
      status: 'running',
      createdAt: '2026-07-19T12:00:00.000Z',
      runs: [
        {
          runId: 'run-architect',
          sessionId: 'session-1',
          agentId: 'architect',
          status: 'running',
          pid: 4101,
          contribution: 'Je cartographie trois chemins.',
          startedAt: '2026-07-19T12:00:00.000Z',
        },
        {
          runId: 'run-trickster',
          sessionId: 'session-1',
          agentId: 'trickster',
          status: 'running',
          pid: 4102,
          contribution: '',
        },
        {
          runId: 'run-guardian',
          sessionId: 'session-1',
          agentId: 'guardian',
          status: 'running',
          pid: 4103,
          contribution: '',
        },
      ],
      events: [],
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);

        if (path === '/api/health') {
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
        }
        if (path === '/api/sessions' && init?.method === 'POST') {
          return new Response(
            JSON.stringify({ ...runningSnapshot, status: 'created', runs: [] }),
            { status: 200 },
          );
        }
        if (path === '/api/sessions/session-1/convene') {
          return new Response(JSON.stringify(runningSnapshot), { status: 200 });
        }
        if (path === '/api/sessions/session-1') {
          return new Response(JSON.stringify(runningSnapshot), { status: 200 });
        }
        if (path === '/api/runs/run-architect/cancel') {
          return new Response(
            JSON.stringify({
              run: { ...runningSnapshot.runs[0], status: 'cancelling' },
            }),
            { status: 200 },
          );
        }

        return new Response(null, { status: 404 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    renderApp();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Convoquer le Council' }),
    );

    const architect = await screen.findByRole('article', {
      name: 'Architect',
    });
    expect(
      await within(architect).findByText('Processus Node #4101'),
    ).toBeVisible();
    expect(
      within(architect).getByText('Je cartographie trois chemins.'),
    ).toBeVisible();

    fireEvent.click(within(architect).getByRole('button', { name: 'Annuler' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/runs/run-architect/cancel',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/runs/run-trickster/cancel',
      expect.anything(),
    );
    expect(localStorage.getItem('naetia-council-ui')).toContain('session-1');
  });
});
