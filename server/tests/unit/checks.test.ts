import { describe, expect, it } from 'vitest';
import { aggregateChecks } from '@pr-review-dashboard/shared';

describe('aggregateChecks (data-model "Checks aggregate")', () => {
  it('returns none when nothing exists', () => {
    expect(aggregateChecks({})).toBe('none');
    expect(aggregateChecks({ checkRuns: [], commitStatuses: [] })).toBe('none');
  });

  it('failing outranks everything', () => {
    expect(
      aggregateChecks({
        checkRuns: [{ conclusion: 'success' }],
        commitStatuses: [{ state: 'failure' }],
      }),
    ).toBe('failing');
    expect(
      aggregateChecks({
        checkRuns: [{ conclusion: null }, { conclusion: 'success' }],
      }),
    ).toBe('pending');
  });

  it('pending/expected outranks passing', () => {
    expect(
      aggregateChecks({
        checkRuns: [{ conclusion: 'success' }, { conclusion: null }],
        commitStatuses: [{ state: 'expected' }],
      }),
    ).toBe('pending');
  });

  it('passing outranks neutral', () => {
    expect(
      aggregateChecks({
        checkRuns: [{ conclusion: 'neutral' }, { conclusion: 'skipped' }],
        commitStatuses: [{ state: 'success' }],
      }),
    ).toBe('passing');
  });

  it('all neutral/skipped with no passing/pending/failing is neutral', () => {
    expect(
      aggregateChecks({ checkRuns: [{ conclusion: 'neutral' }, { conclusion: 'skipped' }] }),
    ).toBe('neutral');
  });

  it('maps failed-like check conclusions to failing', () => {
    for (const conclusion of [
      'failure',
      'cancelled',
      'timed_out',
      'action_required',
      'startup_failure',
    ] as const) {
      expect(aggregateChecks({ checkRuns: [{ conclusion }] })).toBe('failing');
    }
  });

  it('treats a running check-run (null conclusion) as pending', () => {
    expect(aggregateChecks({ checkRuns: [{ conclusion: null }] })).toBe('pending');
  });

  it('maps commit status states per the legacy statuses API', () => {
    expect(aggregateChecks({ commitStatuses: [{ state: 'expected' }] })).toBe('pending');
    expect(aggregateChecks({ commitStatuses: [{ state: 'pending' }] })).toBe('pending');
    expect(aggregateChecks({ commitStatuses: [{ state: 'success' }] })).toBe('passing');
    expect(aggregateChecks({ commitStatuses: [{ state: 'failure' }] })).toBe('failing');
    expect(aggregateChecks({ commitStatuses: [{ state: 'error' }] })).toBe('failing');
  });

  it('mixed real-world head: failing status wins over passing run', () => {
    expect(
      aggregateChecks({
        checkRuns: [
          { conclusion: 'success' },
          { conclusion: 'success' },
          { conclusion: 'skipped' },
        ],
        commitStatuses: [{ state: 'success' }, { state: 'error' }],
      }),
    ).toBe('failing');
  });
});
