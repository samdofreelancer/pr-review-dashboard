/**
 * Board query service (T043; FR-011/015/023, openapi `getBoard`).
 *
 * Everything the board shows is precomputed data: rows come straight from
 * the SQLite board state, lanes map 1:1 (FR-015 — never user-assigned), and
 * cards sort newest-`updatedAt`-first inside each lane. Search stays bound
 * to GitHub-derived fields (title, author, label, number) and the
 * needs-my-review filter drives both visibility and the per-card flag, with
 * indeterminate team requests displayed but never counted (FR-018).
 *
 * The service exposes the card/detail builders used by the routes and the
 * post-action refresh paths so one mapping owns the wire shape.
 */
import {
  LANES,
  needsMyReview as computeNeedsMyReview,
  type BoardCard,
  type Board,
  type LaneName,
  type PullRequestDetail,
} from '@pr-review-dashboard/shared';
import { BoardSchema, PullRequestDetailSchema } from '@pr-review-dashboard/shared';
import type { Database } from '../db/connection.js';
import type { AppConfig } from '../config/index.js';
import {
  getRepositoryById,
  listRepositories,
  getTeamMembership,
  type RepositoryRow,
} from '../db/repositoryStore.js';
import {
  getPullRequest,
  listPullRequestsByRepo,
  type PullRequestRow,
} from '../db/pullRequestStore.js';
import { listDraftsForPullRequest } from '../db/draftStore.js';
import { AppError } from '../api/errors.js';
import { toRepositoryPayload } from './repositoryService.js';

export interface BoardQueryDeps {
  readonly db: Database;
  readonly config: AppConfig;
  /** Viewer login for needs-my-review; null treats every card as not-mine. */
  readonly viewerLogin: string | null;
}

export interface BoardFilters {
  readonly repoId: string | null;
  readonly q: string | null;
  readonly needsMyReview: boolean;
}

export interface CardMembership {
  readonly needs: boolean;
  readonly hasIndeterminate: boolean;
}

/** FR-018: cached truth only; an uncached team reads as indeterminate. */
export function cardMembership(
  db: Database,
  viewerLogin: string | null,
  row: {
    readonly requestedUsers: readonly string[];
    readonly requestedTeams: ReadonlyArray<{ readonly org: string; readonly slug: string }>;
  },
): CardMembership {
  if (viewerLogin === null) {
    return { needs: false, hasIndeterminate: row.requestedTeams.length > 0 };
  }
  return computeNeedsMyReview({
    viewerLogin,
    requestedUsers: row.requestedUsers,
    requestedTeamMemberships: row.requestedTeams.map((team) => {
      const cached = getTeamMembership(db, team.org, team.slug);
      return { isMember: cached?.isMember ?? null };
    }),
  });
}

function textFilterMatches(row: PullRequestRow, query: string): boolean {
  if (row.title.toLowerCase().includes(query)) return true;
  if (row.authorLogin.toLowerCase().includes(query)) return true;
  if (String(row.number).includes(query)) return true;
  return row.labels.some((label) => label.name.toLowerCase().includes(query));
}

/**
 * Build the complete five-lane board. Done keeps its rows (data-model keeps
 * them until disconnect); the 30-day window is bounded at the sync list
 * level, so the board always renders what the last syncs retained.
 */
export function buildBoard(deps: BoardQueryDeps, filters: BoardFilters): Board {
  const repos = listRepositories(deps.db).filter(
    (repo) => filters.repoId === null || repo.id === filters.repoId,
  );

  const query = filters.q === null ? null : filters.q.trim().toLowerCase();
  const cardsByLane = new Map<LaneName, BoardCard[]>(
    LANES.map((name) => [name, [] as BoardCard[]]),
  );

  for (const repo of repos) {
    for (const row of listPullRequestsByRepo(deps.db, repo.id)) {
      const membership = cardMembership(deps.db, deps.viewerLogin, row);
      if (filters.needsMyReview && !membership.needs) continue;
      if (query !== null && !textFilterMatches(row, query)) continue;
      cardsByLane.get(row.lane)!.push(buildCard(repo, row, membership));
    }
  }

  const lanes = LANES.map((name) => {
    const cards = cardsByLane.get(name)!;
    cards.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return { name, count: cards.length, cards };
  });

  const lastSyncAt = repos.reduce<string | null>((latest, repo) => {
    if (repo.lastSuccessfulSyncAt === null) return latest;
    return latest === null || repo.lastSuccessfulSyncAt > latest
      ? repo.lastSuccessfulSyncAt
      : latest;
  }, null);

  return BoardSchema.parse({
    lanes,
    repositories: repos.map((row) =>
      toRepositoryPayload(deps.db, deps.config, {
        ...row,
        lastSyncStatus: String(row.lastSyncStatus),
      }),
    ),
    ...(lastSyncAt !== null ? { lastSyncAt } : {}),
    offline: false,
    stale: repos.length > 0 && repos.every((repo) => repo.lastSuccessfulSyncAt === null),
  });
}

/** One card's wire shape; shared by the board and any future endpoints. */
export function buildCard(
  repo: RepositoryRow,
  row: PullRequestRow,
  membership: CardMembership,
): BoardCard {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    author: row.authorLogin,
    repository: { id: repo.id, owner: repo.owner, name: repo.name },
    lane: row.lane,
    state: row.state,
    isDraft: row.isDraft,
    updatedAt: row.githubUpdatedAt,
    additions: row.additions,
    deletions: row.deletions,
    changedFiles: row.changedFiles,
    labels: row.labels.map((label) => ({
      name: label.name,
      ...(label.color !== undefined ? { color: label.color } : {}),
    })),
    checksState: row.checksState,
    mergeability: row.mergeableState,
    reviewDecision: row.reviewDecision,
    requestedReviewers: [...row.requestedUsers],
    requestedTeams: row.requestedTeams.map((team) => `${team.org}/${team.slug}`),
    needsMyReview: membership.needs,
    ...(membership.hasIndeterminate ? { teamRequestIndeterminate: true } : {}),
  };
}

/** The board's PR-detail payload (openapi `getPullRequest`). */
export function buildPullRequestDetail(
  deps: BoardQueryDeps,
  row: PullRequestRow,
): PullRequestDetail {
  const repo = getRepositoryById(deps.db, row.repoId);
  if (repo === null) {
    throw new AppError('NOT_FOUND', 'Repository is not connected.');
  }
  const membership = cardMembership(deps.db, deps.viewerLogin, row);
  return PullRequestDetailSchema.parse({
    id: row.id,
    number: row.number,
    title: row.title,
    author: row.authorLogin,
    repository: { id: repo.id, owner: repo.owner, name: repo.name },
    lane: row.lane,
    state: row.state,
    isDraft: row.isDraft,
    updatedAt: row.githubUpdatedAt,
    additions: row.additions,
    deletions: row.deletions,
    changedFiles: row.changedFiles,
    labels: row.labels.map((label) => ({
      name: label.name,
      ...(label.color !== undefined ? { color: label.color } : {}),
    })),
    checksState: row.checksState,
    mergeability: row.mergeableState,
    reviewDecision: row.reviewDecision,
    requestedReviewers: [...row.requestedUsers],
    requestedTeams: row.requestedTeams.map((team) => `${team.org}/${team.slug}`),
    needsMyReview: membership.needs,
    ...(membership.hasIndeterminate ? { teamRequestIndeterminate: true } : {}),
    body: row.body,
    baseRef: row.baseRef,
    headRef: row.headRef,
    headSha: row.headSha,
    // Filled by US2 from the prepared local copy; board-only reads stay ''.
    baseSha: '',
    requestedTeamsDetailed: row.requestedTeams.map((team) => {
      const cached = getTeamMembership(deps.db, team.org, team.slug);
      return {
        org: team.org,
        slug: team.slug,
        ...(cached === null || cached.isMember === null ? { indeterminate: true } : {}),
      };
    }),
    diffStatus: 'none',
    activeRunId: null,
    draftId: latestDraftId(deps.db, row.id),
    lastSyncedAt: row.lastSyncedAt,
  });
}

/** Most recent draft id for a pull request, or null when none exists yet. */
export function latestDraftId(db: Database, prId: string): string | null {
  const rows = listDraftsForPullRequest(db, prId);
  const latest = rows[rows.length - 1];
  return latest === undefined ? null : latest.id;
}

/** Fetch a pull request row or throw the contract NOT_FOUND problem. */
export function requirePullRequest(db: Database, prId: string): PullRequestRow {
  const row = getPullRequest(db, prId);
  if (row === null) {
    throw new AppError('NOT_FOUND', 'Pull request is not on this board.');
  }
  return row;
}

/** Same for repository rows. */
export function requireRepository(db: Database, repoId: string): RepositoryRow {
  const row = getRepositoryById(db, repoId);
  if (row === null) {
    throw new AppError('NOT_FOUND', 'Repository is not connected.');
  }
  return row;
}
