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
      fragments: [],
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

  it('keeps a fragment, forges a sourced decision and renders the return point', async () => {
    const completedAt = '2026-07-19T12:05:00.000Z';
    const baseSnapshot: CouncilSessionSnapshot = {
      sessionId: 'session-outcome',
      quest: {
        questId: 'quest-outcome',
        title: 'Choisir un passage réversible',
        context: 'Garder une objection ouverte.',
      },
      status: 'completed',
      createdAt: '2026-07-19T12:00:00.000Z',
      eventCursor: 20,
      runs: [
        {
          runId: 'run-architect',
          sessionId: 'session-outcome',
          agentId: 'architect',
          agentDefinitionId: 'architect.v1',
          status: 'completed',
          contribution: 'Tracer un passage étroit, observable et réversible.',
          startedAt: '2026-07-19T12:00:00.000Z',
          completedAt,
        },
        {
          runId: 'run-trickster',
          sessionId: 'session-outcome',
          agentId: 'trickster',
          agentDefinitionId: 'trickster.v1',
          status: 'completed',
          contribution: 'Tester si deux voix suffiraient.',
          startedAt: '2026-07-19T12:00:00.000Z',
          completedAt,
        },
        {
          runId: 'run-guardian',
          sessionId: 'session-outcome',
          agentId: 'guardian',
          agentDefinitionId: 'guardian.v1',
          status: 'completed',
          contribution: 'Fixer une règle d’arrêt avant le test.',
          startedAt: '2026-07-19T12:00:00.000Z',
          completedAt,
        },
      ],
      fragments: [
        {
          id: 'fragment-architect',
          sessionId: 'session-outcome',
          contributionId: 'contribution-architect',
          runId: 'run-architect',
          content: 'Tracer un passage étroit, observable et réversible.',
          status: 'available',
          createdAt: completedAt,
          updatedAt: completedAt,
        },
        {
          id: 'fragment-trickster',
          sessionId: 'session-outcome',
          contributionId: 'contribution-trickster',
          runId: 'run-trickster',
          content: 'Tester si deux voix suffiraient.',
          status: 'available',
          createdAt: completedAt,
          updatedAt: completedAt,
        },
        {
          id: 'fragment-guardian',
          sessionId: 'session-outcome',
          contributionId: 'contribution-guardian',
          runId: 'run-guardian',
          content: 'Fixer une règle d’arrêt avant le test.',
          status: 'available',
          createdAt: completedAt,
          updatedAt: completedAt,
        },
      ],
      events: [],
    };
    let snapshot = baseSnapshot;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === '/api/health') {
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
        }
        if (path === '/api/sessions/session-outcome') {
          return new Response(JSON.stringify(snapshot), { status: 200 });
        }
        if (path === '/api/fragments/fragment-architect/keep') {
          snapshot = {
            ...snapshot,
            eventCursor: 21,
            fragments: snapshot.fragments.map((fragment) =>
              fragment.id === 'fragment-architect'
                ? { ...fragment, status: 'kept', updatedAt: completedAt }
                : fragment,
            ),
          };
          return new Response(JSON.stringify(snapshot), { status: 200 });
        }
        if (path === '/api/fragments/fragment-guardian/compost') {
          snapshot = {
            ...snapshot,
            eventCursor: 22,
            fragments: snapshot.fragments.map((fragment) =>
              fragment.id === 'fragment-guardian'
                ? { ...fragment, status: 'composted', updatedAt: completedAt }
                : fragment,
            ),
          };
          return new Response(JSON.stringify(snapshot), { status: 200 });
        }
        if (path === '/api/sessions/session-outcome/forge') {
          expect(JSON.parse(String(init?.body))).toMatchObject({
            fragmentIds: ['fragment-architect'],
          });
          snapshot = {
            ...snapshot,
            eventCursor: 24,
            decision: {
              id: 'decision-1',
              sessionId: 'session-outcome',
              statement: 'Ouvrir un passage réversible.',
              rationale: 'Le test réduit l’incertitude sans alourdir la quête.',
              objection: 'La fatigue peut fausser la lecture.',
              reviewCondition: 'Réviser si la confusion augmente.',
              sources: [
                {
                  fragmentId: 'fragment-architect',
                  contributionId: 'contribution-architect',
                  runId: 'run-architect',
                  agentDefinitionId: 'architect.v1',
                },
              ],
              createdAt: completedAt,
            },
            returnPoint: {
              sessionId: 'session-outcome',
              decisionId: 'decision-1',
              summary: 'Ouvrir un passage réversible.',
              openObjection: 'La fatigue peut fausser la lecture.',
              nextSmallStep: 'Tester pendant dix minutes.',
              updatedAt: completedAt,
            },
          };
          return new Response(JSON.stringify(snapshot), { status: 200 });
        }
        return new Response(null, { status: 404 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    useCouncilUiStore.setState({ activeSessionId: 'session-outcome' });

    renderApp();

    const architectLoot = await screen.findByRole('article', {
      name: 'Fragment Architect',
    });
    fireEvent.click(within(architectLoot).getByRole('button', { name: 'KEEP' }));
    await waitFor(() =>
      expect(within(architectLoot).getByText('Conservé')).toBeVisible(),
    );

    const guardianLoot = screen.getByRole('article', {
      name: 'Fragment Guardian',
    });
    fireEvent.click(within(guardianLoot).getByRole('button', { name: 'COMPOST' }));
    await waitFor(() =>
      expect(within(guardianLoot).getByText('Composté')).toBeVisible(),
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /Architect/ }));
    fireEvent.change(screen.getByLabelText('Décision'), {
      target: { value: 'Ouvrir un passage réversible.' },
    });
    fireEvent.change(screen.getByLabelText('Pourquoi maintenant ?'), {
      target: { value: 'Le test réduit l’incertitude sans alourdir la quête.' },
    });
    fireEvent.change(screen.getByLabelText('Objection conservée'), {
      target: { value: 'La fatigue peut fausser la lecture.' },
    });
    fireEvent.change(screen.getByLabelText('Condition de révision'), {
      target: { value: 'Réviser si la confusion augmente.' },
    });
    fireEvent.change(screen.getByLabelText('Prochain petit geste'), {
      target: { value: 'Tester pendant dix minutes.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Forger la décision' }));

    const returnPanel = await screen.findByRole('region', {
      name: 'Ouvrir un passage réversible.',
    });
    expect(within(returnPanel).getByText('Architect')).toBeVisible();
    expect(within(returnPanel).getByText('La fatigue peut fausser la lecture.'))
      .toBeVisible();
    expect(within(returnPanel).getByText('Tester pendant dix minutes.')).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: /Guardian/ })).not.toBeInTheDocument();
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
      fragments: [],
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
      fragments: [...runningSnapshot.fragments],
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
      fragments: [...runningSnapshot.fragments],
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
