import {
  parseCouncilEvent,
  type CouncilEventMessage,
} from '@naetia/assembly-protocol';

export interface CouncilEventDelivery {
  readonly cursor: number;
  readonly event: CouncilEventMessage;
}

export interface CouncilEventSourceHandlers {
  readonly onOpen: () => void;
  readonly onError: () => void;
  readonly onInvalid: (error: Error) => void;
  readonly onEvent: (delivery: CouncilEventDelivery) => void;
}

export interface CouncilEventSourceHandle {
  close(): void;
}

export function openCouncilEventSource(
  sessionId: string,
  cursor: number,
  handlers: CouncilEventSourceHandlers,
): CouncilEventSourceHandle | undefined {
  if (typeof EventSource === 'undefined') {
    return undefined;
  }

  const source = new EventSource(
    `/api/sessions/${encodeURIComponent(sessionId)}/events?after=${String(cursor)}`,
  );
  source.onopen = handlers.onOpen;
  source.onerror = handlers.onError;
  source.addEventListener('council-event', (rawEvent) => {
    try {
      const message = rawEvent as MessageEvent<string>;
      const eventCursor = parseEventCursor(message.lastEventId);
      const event = parseCouncilEvent(JSON.parse(message.data));
      if (event.sessionId !== sessionId) {
        throw new Error('Le signal appartient à une autre session.');
      }
      handlers.onEvent({ cursor: eventCursor, event });
    } catch (error) {
      source.close();
      handlers.onInvalid(
        error instanceof Error
          ? error
          : new Error('Le signal du Council est invalide.'),
      );
    }
  });

  return {
    close: () => source.close(),
  };
}

function parseEventCursor(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('Le curseur du signal est invalide.');
  }
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor)) {
    throw new Error('Le curseur du signal dépasse la plage supportée.');
  }
  return cursor;
}
