/**
 * Checks aggregate (T037, data-model "Checks aggregate"; FR-024).
 *
 * Pure reducer over GitHub check runs and commit statuses — no required-check
 * filtering, single aggregate per head (FR-024). Precedence is exactly:
 *   failing → pending → passing → neutral → none
 * (`CHECKS_STATES` order doubles as the precedence ranking).
 */
import type { ChecksState } from '../types/domain.js';

/** GitHub `checkRun.conclusion`; null while the run is still executing. */
export type CheckRunConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'startup_failure'
  | null;

/** GitHub commit status `state` (legacy statuses API). */
export type CommitStatusState = 'expected' | 'error' | 'failure' | 'pending' | 'success';

export interface ChecksAggregateInput {
  readonly checkRuns?: ReadonlyArray<{ conclusion: CheckRunConclusion }>;
  readonly commitStatuses?: ReadonlyArray<{ state: CommitStatusState }>;
}

function mapCheckRunConclusion(conclusion: CheckRunConclusion): ChecksState {
  if (conclusion === null) return 'pending';
  switch (conclusion) {
    case 'success':
      return 'passing';
    case 'failure':
    case 'cancelled':
    case 'timed_out':
    case 'action_required':
    case 'startup_failure':
      // Any of these means the commit did not prove healthy (FR-024).
      return 'failing';
    case 'neutral':
    case 'skipped':
      return 'neutral';
  }
}

function mapCommitStatusState(state: CommitStatusState): ChecksState {
  switch (state) {
    case 'success':
      return 'passing';
    case 'failure':
    case 'error':
      return 'failing';
    case 'expected':
    case 'pending':
      // `expected` has not reported yet — behaves like pending.
      return 'pending';
  }
}

export function aggregateChecks(input: ChecksAggregateInput): ChecksState {
  const mapped: ChecksState[] = [];
  for (const run of input.checkRuns ?? []) mapped.push(mapCheckRunConclusion(run.conclusion));
  for (const status of input.commitStatuses ?? []) mapped.push(mapCommitStatusState(status.state));

  if (mapped.length === 0) return 'none';
  if (mapped.includes('failing')) return 'failing';
  if (mapped.includes('pending')) return 'pending';
  if (mapped.includes('passing')) return 'passing';
  return 'neutral'; // Exist but every one of them is neutral/skipped.
}
