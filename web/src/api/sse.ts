/**
 * SSE stream consumption (T030, contracts/events.md).
 *
 * One `EventSource` per tab. The server never replays history; therefore:
 * - a fresh connection (reconnect included) invalidates every cached query
 *   except the immutable session, so all tabs converge at refetch (FR-026);
 * - terminal `*.completed` events and `board.updated`/`repo.updated` target
 *   invalidations while the tab is already online;
 * - progress events are informational: lanes only change via refetch (FR-025).
 *
 * Connection state is exposed through a tiny external store so the offline
 * banner and mutation disabling observe it without re-render storms.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SSE_NAMES } from '@pr-review-dashboard/shared';
import { queryKeys } from './queries.js';

export type ConnectionState = 'connecting' | 'online' | 'offline';

let connectionStateInternal: ConnectionState = 'connecting';
const connectionListeners = new Set<(state: ConnectionState) => void>();

function setConnectionState(state: ConnectionState): void {
  if (connectionStateInternal === state) return;
  connectionStateInternal = state;
  for (const listener of connectionListeners) listener(state);
}

export function subscribeConnection(listener: (state: ConnectionState) => void): () => void {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
}

export function getConnectionState(): ConnectionState {
  return connectionStateInternal;
}

export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(subscribeConnection, getConnectionState, () => 'connecting');
}

/** Event names that touch board-visible data (see contracts/events.md). */
const MILESTONE_EVENT_NAMES: ReadonlySet<string> = new Set<string>([
  'board.updated',
  'repo.updated',
  'sync.completed',
  'diff.completed',
  'review.completed',
  'publish.completed',
  'retention.cleanup',
]);

export function useEventStream(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const source = new EventSource('/api/events');
    let everConnected = false;

    source.addEventListener('open', () => {
      setConnectionState('online');
      if (everConnected) {
        // Reconnect implies missed frames: refetch everything known.
        void queryClient.invalidateQueries({ queryKey: queryKeys.board });
        void queryClient.invalidateQueries({ queryKey: queryKeys.repositories });
        void queryClient.invalidateQueries({ queryKey: queryKeys.health });
        void queryClient.invalidateQueries({ queryKey: ['pr'] });
        void queryClient.invalidateQueries({ queryKey: ['draft'] });
      }
      everConnected = true;
    });
    source.addEventListener('error', () => {
      setConnectionState(EventSource.CLOSED === source.readyState ? 'offline' : 'connecting');
    });

    for (const name of SSE_NAMES) {
      if (name === 'ready') continue;
      if (!MILESTONE_EVENT_NAMES.has(name)) continue;
      source.addEventListener(name, () => {
        void queryClient.invalidateQueries();
      });
    }

    return () => {
      source.close();
      setConnectionState('offline');
    };
  }, [queryClient]);
}
