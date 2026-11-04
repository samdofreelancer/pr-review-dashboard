/**
 * Per-head checks adapter (T040, research R16; FR-010/024).
 *
 * Reads both checks systems for one commit — check runs and commit
 * statuses — and feeds them into the shared aggregate (T037). REST
 * conclusions arrive UPPERCASE; the aggregate input is lowercase, so this
 * is the single normalization point. Unknown conclusions are treated as
 * an unproven commit (`failure`), never as passing.
 */
import {
  aggregateChecks,
  type CheckRunConclusion,
  type ChecksState,
  type CommitStatusState,
} from '@pr-review-dashboard/shared';
import { mapGitHubError, type GitHubOctokit } from './client.js';

export interface HeadChecks {
  readonly state: ChecksState;
  readonly total: number;
}

const KNOWN_CONCLUSIONS: readonly string[] = [
  'success',
  'failure',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'startup_failure',
];

const KNOWN_STATUS_STATES: readonly string[] = [
  'expected',
  'error',
  'failure',
  'pending',
  'success',
];

function normalizeConclusion(value: string | null | undefined): CheckRunConclusion {
  if (value === null || value === undefined) return null;
  const text = value.toLowerCase();
  // Defensive: unrecognized conclusions are still unproven commits.
  return (KNOWN_CONCLUSIONS.includes(text) ? text : 'failure') as CheckRunConclusion;
}

function normalizeStatusState(value: string): CommitStatusState {
  const text = value.toLowerCase();
  return (KNOWN_STATUS_STATES.includes(text) ? text : 'pending') as CommitStatusState;
}

export async function fetchChecksForHead(
  octokit: GitHubOctokit,
  input: {
    readonly owner: string;
    /** REST parameter name; callers pass the repository name. */
    readonly repo: string;
    readonly sha: string;
  },
): Promise<HeadChecks> {
  try {
    const [checkRuns, combined] = await Promise.all([
      octokit.rest.checks.listForRef({
        owner: input.owner,
        repo: input.repo,
        ref: input.sha,
        filter: 'latest',
        per_page: 100,
      }),
      octokit.rest.repos.getCombinedStatusForRef({
        owner: input.owner,
        repo: input.repo,
        ref: input.sha,
      }),
    ]);

    const mappedRuns = checkRuns.data.check_runs.map((run) => ({
      name: run.name ?? 'check-run',
      conclusion: normalizeConclusion(run.conclusion),
    }));
    const mappedStatuses = combined.data.statuses.map((status) => ({
      context: status.context,
      state: normalizeStatusState(status.state),
    }));

    return {
      state: aggregateChecks({ checkRuns: mappedRuns, commitStatuses: mappedStatuses }),
      total: checkRuns.data.total_count + combined.data.statuses.length,
    };
  } catch (error) {
    throw mapGitHubError(error);
  }
}
