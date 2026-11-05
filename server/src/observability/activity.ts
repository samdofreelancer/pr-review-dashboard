/**
 * App-recorded activity + SSE fan-out (T046, contracts/events.md).
 *
 * One sink owns both side effects so callers stay symmetric: every domain
 * transition that changes board-visible data writes one redacted activity
 * row (FR-085/095 — no tokens, no file content, no raw model output) and
 * broadcasts the corresponding SSE frames. Everything is fire-and-forget:
 * a hub collapse or a database hiccup must never fail the business flow.
 */
import type {
  ActivityType,
  BoardUpdateReason,
  SseName,
  SyncSsePhase,
} from '@pr-review-dashboard/shared';
import { insertActivityEvent } from '../db/activityStore.js';
import type { Database } from '../db/connection.js';
import { redactValue } from './logger.js';

export interface SyncStartedFrame {
  readonly repoId: string;
  readonly syncRunId: string;
  readonly startedAt: string;
}

export interface SyncProgressFrame {
  readonly repoId: string;
  readonly syncRunId: string;
  readonly phase: SyncSsePhase;
  readonly fetched: number;
  readonly total: number | null;
}

export interface SyncCompletedFrame {
  readonly repoId: string;
  readonly syncRunId: string;
  readonly status: 'succeeded' | 'partial' | 'failed';
  readonly finishedAt: string;
  readonly openSeen: number;
  readonly closedSeen: number;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly rateLimitResetAt: string | null;
}

export interface RepoUpdatedFrame {
  readonly repoId: string;
  readonly lastSyncStatus: string;
  readonly lastSuccessfulSyncAt: string | null;
  readonly rateLimitResetAt: string | null;
}

export interface BoardUpdatedFrame {
  readonly reason: BoardUpdateReason;
  readonly repoId: string;
  readonly prId: string | null;
}

export interface ActivityRecordInput {
  readonly repoId: string;
  readonly prId?: string | null;
  /** Redacted summary values only; callers never pass tokens or content. */
  readonly data?: Record<string, unknown>;
}

/** The hub surface this module needs; keeps the sink testable without streams. */
export interface SseBroadcastTarget {
  broadcast(event: SseName, data: Record<string, unknown>): void;
}

/**
 * The narrow surface sync/action call sites depend on; a null hub keeps the
 * business flows runnable wherever no stream is attached.
 */
export interface ActivitySink {
  syncStarted(frame: SyncStartedFrame): void;
  syncProgress(frame: SyncProgressFrame): void;
  /** Terminal frame; `record` also banks the activity row + board.updated. */
  syncCompleted(frame: SyncCompletedFrame, options: { readonly record: boolean }): void;
  repoUpdated(frame: RepoUpdatedFrame): void;
  boardUpdated(frame: BoardUpdatedFrame): void;
  /** Persist one app-recorded activity row, redacted and never throwing. */
  recordActivity(type: ActivityType, input: ActivityRecordInput): void;
}

function safeBroadcast(target: SseBroadcastTarget | null, event: SseName, data: Record<string, unknown>): void {
  if (target === null) return;
  try {
    target.broadcast(event, redactValue(data) as Record<string, unknown>);
  } catch {
    // A failed write detaches its client inside the hub; the flow outlives the stream.
  }
}

export function createActivitySink(
  db: Database,
  target: SseBroadcastTarget | null,
): ActivitySink {
  return {
    syncStarted(frame) {
      safeBroadcast(target, 'sync.started', { ...frame });
    },
    syncProgress(frame) {
      safeBroadcast(target, 'sync.progress', { ...frame });
    },
    syncCompleted(frame, options) {
      safeBroadcast(target, 'sync.completed', { ...frame });
      safeBroadcast(target, 'repo.updated', {
        repoId: frame.repoId,
        lastSyncStatus: frame.status,
        lastSuccessfulSyncAt: frame.status === 'failed' ? null : frame.finishedAt,
        rateLimitResetAt: frame.rateLimitResetAt,
      });
      if (options.record) {
        this.recordActivity('sync_completed', {
          repoId: frame.repoId,
          data: {
            status: frame.status,
            openSeen: frame.openSeen,
            closedSeen: frame.closedSeen,
            ...(frame.error !== null ? { errorCode: frame.error.code } : {}),
          },
        });
        // Board data only changed when the run kept or refreshed good rows.
        if (frame.status !== 'failed') {
          safeBroadcast(target, 'board.updated', {
            reason: 'sync_completed',
            repoId: frame.repoId,
            prId: null,
          });
        }
      }
    },
    repoUpdated(frame) {
      safeBroadcast(target, 'repo.updated', { ...frame });
    },
    boardUpdated(frame) {
      safeBroadcast(target, 'board.updated', { ...frame });
    },
    recordActivity(type, input) {
      try {
        insertActivityEvent(db, {
          id: crypto.randomUUID(),
          repoId: input.repoId,
          prId: input.prId ?? null,
          type,
          occurredAt: new Date().toISOString(),
          data: redactValue(input.data ?? {}) as Record<string, unknown>,
        });
      } catch {
        // Losing an audit row must never fail the user flow (FR-092 sibling).
      }
    },
  };
}
