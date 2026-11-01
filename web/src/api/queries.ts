/**
 * Query keys and typed session bootstrap (T030).
 *
 * Keys are the single cache vocabulary: SSE reconnects invalidate whole key
 * groups by prefix, so any slice can append cache segments safely.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  HealthSchema,
  SessionSchema,
  type Health,
  type Session,
} from '@pr-review-dashboard/shared';
import { apiFetch, setCsrfToken } from './client.js';

export const queryKeys = {
  session: ['session'] as const,
  health: ['health'] as const,
  board: ['board'] as const,
  repositories: ['repositories'] as const,
  pullRequest: (prId: string) => ['pr', prId] as const,
  draft: (draftId: string) => ['draft', draftId] as const,
} as const;

/** Fetch the bootstrap session and remember its CSRF token for mutations. */
export async function loadSession(): Promise<Session> {
  const session = SessionSchema.parse(await apiFetch('/api/session'));
  setCsrfToken(session.csrfToken);
  return session;
}

export function useSession(): UseQueryResult<Session, Error> {
  return useQuery({ queryKey: queryKeys.session, queryFn: loadSession, staleTime: 5 * 60_000 });
}

export function useHealth(): UseQueryResult<Health, Error> {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: async () => HealthSchema.parse(await apiFetch('/api/health')),
    staleTime: 10_000,
  });
}
