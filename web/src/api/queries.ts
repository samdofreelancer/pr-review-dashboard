/**
 * Query keys and typed session bootstrap (T030).
 *
 * Keys are the single cache vocabulary: SSE reconnects invalidate whole key
 * groups by prefix, so any slice can append cache segments safely.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  BoardSchema,
  HealthSchema,
  RepositorySchema,
  SessionSchema,
  type Board,
  type Health,
  type Repository,
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

/** Fetch the five-lane board with optional repo/search/needs-my-review filters. */
export async function loadBoard(params?: {
  readonly repoId?: string | null;
  readonly q?: string | null;
  readonly needsMyReview?: boolean | null;
}): Promise<Board> {
  const search = new URLSearchParams();
  if (params?.repoId !== null && params?.repoId !== undefined)
    search.set('repoId', params.repoId);
  if (params?.q !== null && params?.q !== undefined) search.set('q', params.q);
  if (params?.needsMyReview !== null && params?.needsMyReview !== undefined)
    search.set('needsMyReview', String(params.needsMyReview));
  const path = `/api/board${search.toString() ? `?${search.toString()}` : ''}`;
  return BoardSchema.parse(await apiFetch(path));
}

export function useBoard(params?: {
  readonly repoId?: string | null;
  readonly q?: string | null;
  readonly needsMyReview?: boolean | null;
}): UseQueryResult<Board, Error> {
  return useQuery({
    queryKey: [...queryKeys.board, params ?? null],
    queryFn: () => loadBoard(params),
    staleTime: 5_000,
  });
}

/** Fetch connected repositories. */
export async function loadRepositories(): Promise<Repository[]> {
  return RepositorySchema.array().parse(await apiFetch('/api/repos'));
}

export function useRepositories(): UseQueryResult<Repository[], Error> {
  return useQuery({
    queryKey: queryKeys.repositories,
    queryFn: loadRepositories,
    staleTime: 10_000,
  });
}

/** Connect a repository (mutation). */
export async function connectRepository(body: {
  readonly owner: string;
  readonly name: string;
}): Promise<Repository> {
  return RepositorySchema.parse(
    await apiFetch('/api/repos', { method: 'POST', body }),
  );
}

/** Disconnect a repository (mutation). */
export async function disconnectRepository(repoId: string): Promise<void> {
  await apiFetch(`/api/repos/${repoId}?confirm=true`, { method: 'DELETE' });
}

/** Start a sync for a repository (mutation). */
export async function startSync(repoId: string): Promise<unknown> {
  return apiFetch(`/api/repos/${repoId}/sync`, { method: 'POST' });
}

/** Mark a pull request ready for review (mutation). */
export async function markReadyForReview(prId: string, expectedHeadSha: string): Promise<unknown> {
  return apiFetch(`/api/prs/${prId}/mark-ready`, {
    method: 'POST',
    body: { expectedHeadSha, confirmed: true },
  });
}
