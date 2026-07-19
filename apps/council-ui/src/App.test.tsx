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
import type { CouncilSessionSnapshot } from './api/assembly';
import { useCouncilUiStore } from './state/council-ui-store';

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  readonly #listeners = new Map<string, (event: unknown) => void>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.#listeners.set(type, listener);
  }

  emitOpen() {
    this.onopen?.();
  }

  emitError() {
    this.onerror?.();
  }

  emitCouncilEvent(data: unknown, lastEventId: string) {
    this.#listeners.get('council-event')?.({
      data: JSON.stringify(data),
      lastEventId,
    });
  }

  close() {
    this.closed = true;
  }
}

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
  FakeEventSource.instances = [];
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
      eventCursor: 8,
      runs: [
        {
          runId: 'run-architect',
          sessionId: 'session-1',
          agentId: 'architect',
          agentDefinitionId: 'architect.v1',
          status: 'running',
          pid: 4101,
          contribution: 'Je cartographie trois chemins.',
          startedAt: '2026-07-19T12:00:00.000Z',
        },
        {
          runId: 'run-trickster',
          sessionId: 'session-1',
          agentId: 'trickster',
          agentDefinitionId: 'trickster.v1',
          status: 'running',
          pid: 4102,
          contribution: '',
        },
        {
          runId: 'run-guardian',
          sessionId: 'session-1',
          agentId: 'guardian',
          agentDefinitionId: 'guardian.v1',
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

  it('opens SSE after the snapshot and ignores a repeated cursor', async () => {
    const baseRun = {
      runId: 'run-architect',
      sessionId: 'session-1',
      agentId: 'architect',
      agentDefinitionId: 'architect.v1',
      status: 'running',
      pid: 4201,
      contribution: '',
      startedAt: '2026-07-19T12:00:00.000Z',
    } as const;
    const createdSnapshot = {
      sessionId: 'session-1',
      quest: { questId: 'quest-1', title: 'Ouvrir la porte du royaume' },
      status: 'created',
      createdAt: '2026-07-19T12:00:00.000Z',
      eventCursor: 1,
      runs: [],
      events: [],
    } as const;
    const runningSnapshot = {
      ...createdSnapshot,
      status: 'running',
      eventCursor: 8,
      runs: [baseRun],
    } as const;
    const deltaEvent = {
      id: 'event-delta-1',
      type: 'contribution.delta',
      sessionId: 'session-1',
      runId: 'run-architect',
      occurredAt: '2026-07-19T12:00:01.000Z',
      payload: {
        contributionId: 'contribution-1',
        delta: 'Signal SSE reçu.',
        index: 0,
      },
    } as const;
    let serverSnapshot: CouncilSessionSnapshot = {
      ...runningSnapshot,
      runs: [...runningSnapshot.runs],
      events: [...runningSnapshot.events],
    };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === '/api/health') {
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
        }
        if (path === '/api/sessions' && init?.method === 'POST') {
          return new Response(JSON.stringify(createdSnapshot), { status: 201 });
        }
        if (path === '/api/sessions/session-1/convene') {
          return new Response(JSON.stringify(runningSnapshot), { status: 202 });
        }
        if (path === '/api/sessions/session-1') {
          return new Response(JSON.stringify(serverSnapshot), { status: 200 });
        }
        return new Response(null, { status: 404 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('EventSource', FakeEventSource);

    const rendered = renderApp();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Convoquer le Council' }),
    );

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe('/api/sessions/session-1/events?after=1');
    source.emitOpen();
    expect(await screen.findByText(/Flux direct/)).toBeVisible();
    source.emitError();
    expect(await screen.findByText(/Signal interrompu, reconnexion/)).toBeVisible();
    source.emitOpen();

    serverSnapshot = {
      ...runningSnapshot,
      eventCursor: 9,
      runs: [{ ...baseRun, contribution: 'Signal SSE reçu.' }],
      events: [deltaEvent],
    };
    source.emitCouncilEvent(deltaEvent, '9');
    expect(await screen.findByText('Signal SSE reçu.')).toBeVisible();

    const readsAfterFirstDelivery = fetchMock.mock.calls.filter(
      ([input]) => String(input) === '/api/sessions/session-1',
    ).length;
    source.emitCouncilEvent(deltaEvent, '9');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === '/api/sessions/session-1',
      ),
    ).toHaveLength(readsAfterFirstDelivery);

    rendered.unmount();
    expect(source.closed).toBe(true);
  });
});
