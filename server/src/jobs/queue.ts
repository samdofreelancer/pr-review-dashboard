/**
 * In-process job queue (T024, research R14).
 *
 * One queue serves sync, AI review, and publish work with the concurrency
 * rules the spec requires:
 * - one sync per repository, at most three repositories syncing at once;
 * - at most two AI review runs globally, and one active run per PR;
 * - one publish attempt in flight per draft.
 *
 * Duplicate submissions are idempotent: an enqueue for an already queued or
 * running key returns the existing handle instead of starting a second task
 * (FR-056/086). Cancellation is cooperative through an `AbortSignal`; a
 * queued job is dropped immediately and a running job is reported as
 * `cancelled` even if its task resolves after the abort (FR-055).
 *
 * The queue owns no persistence and emits no events: callers persist state
 * before emitting SSE, as required by the design.
 */
import { randomUUID } from 'node:crypto';

export const JOB_KINDS = ['sync', 'review', 'publish'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type JobState = (typeof JOB_STATES)[number];

export const DEFAULT_SYNC_CONCURRENCY = 3;
export const DEFAULT_REVIEW_CONCURRENCY = 2;

export type JobOutcome<Result> =
  | { readonly status: 'completed'; readonly value: Result }
  | { readonly status: 'failed'; readonly error: unknown }
  | { readonly status: 'cancelled' };

export interface JobContext {
  readonly jobId: string;
  readonly kind: JobKind;
  /** Repository id, PR id, or draft id depending on the kind. */
  readonly key: string;
  readonly signal: AbortSignal;
  /** Throws the cancellation reason when cancellation was requested. */
  throwIfCancelled(): void;
}

export type JobTask<Result> = (context: JobContext) => Result | Promise<Result>;

export interface JobHandle<Result = unknown> {
  readonly id: string;
  readonly kind: JobKind;
  readonly key: string;
  readonly state: JobState;
  /** True once cancellation was requested, including while the task unwinds. */
  readonly cancelRequested: boolean;
  readonly signal: AbortSignal;
  /** Never rejects; the outcome carries success, failure, or cancellation. */
  readonly promise: Promise<JobOutcome<Result>>;
  /** Request cancellation; returns false when the job already finished. */
  cancel(): boolean;
}

export interface KindSnapshot {
  readonly queued: number;
  readonly running: number;
}

export interface QueueSnapshot {
  readonly active: number;
  readonly queued: number;
  readonly running: number;
  readonly byKind: Readonly<Record<JobKind, KindSnapshot>>;
}

export interface JobQueueOptions {
  readonly syncConcurrency?: number;
  readonly reviewConcurrency?: number;
  readonly createId?: () => string;
}

export class JobQueueClosedError extends Error {
  constructor() {
    super('The job queue is closed.');
    this.name = 'JobQueueClosedError';
  }
}

/** Abort reason used when a running job is cancelled. */
export class JobCancelledError extends Error {
  constructor(message = 'The job was cancelled.') {
    super(message);
    this.name = 'JobCancelledError';
  }
}

type ResultResolver = (outcome: JobOutcome<unknown>) => void;

interface JobRecord {
  readonly id: string;
  readonly kind: JobKind;
  readonly key: string;
  readonly task: (context: JobContext) => unknown;
  readonly controller: AbortController;
  readonly resolve: ResultResolver;
  state: JobState;
  handle: JobHandle<unknown> | null;
}

function compositeKey(kind: JobKind, key: string): string {
  return `${kind}\u0000${key}`;
}

function assertConcurrency(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer; received ${String(value)}`);
  }
}

export class JobQueue {
  private readonly concurrency: Readonly<Record<JobKind, number>>;
  private readonly createId: () => string;
  private readonly pending: Record<JobKind, JobRecord[]> = {
    sync: [],
    review: [],
    publish: [],
  };
  private readonly runningByKind: Record<JobKind, number> = {
    sync: 0,
    review: 0,
    publish: 0,
  };
  /** Active (queued or running) records by job id. */
  private readonly byId = new Map<string, JobRecord>();
  /** Active record per kind+key; enforces the one-per-repository/PR/draft rules. */
  private readonly activeByKey = new Map<string, JobRecord>();
  private readonly idleWaiters: Array<() => void> = [];
  private closed = false;

  constructor(options: JobQueueOptions = {}) {
    const syncConcurrency = options.syncConcurrency ?? DEFAULT_SYNC_CONCURRENCY;
    const reviewConcurrency = options.reviewConcurrency ?? DEFAULT_REVIEW_CONCURRENCY;
    assertConcurrency('syncConcurrency', syncConcurrency);
    assertConcurrency('reviewConcurrency', reviewConcurrency);

    this.concurrency = {
      sync: syncConcurrency,
      review: reviewConcurrency,
      // Publishing is limited per draft through `activeByKey`, not globally;
      // drafts are independent and each post is already single-flight.
      publish: Number.POSITIVE_INFINITY,
    };
    this.createId = options.createId ?? (() => randomUUID());
  }

  get size(): number {
    return this.byId.size;
  }

  /** Enqueue a sync for `repoId`; a duplicate returns the active job. */
  enqueueSync<Result>(repoId: string, task: JobTask<Result>, id?: string): JobHandle<Result> {
    return this.enqueue('sync', repoId, task, id);
  }

  /** Enqueue a review run for `prId`; a duplicate returns the active run (FR-056). */
  enqueueReview<Result>(prId: string, task: JobTask<Result>, runId?: string): JobHandle<Result> {
    return this.enqueue('review', prId, task, runId);
  }

  /** Enqueue a publish for `draftId`; a duplicate returns the in-flight post (FR-086). */
  enqueuePublish<Result>(
    draftId: string,
    task: JobTask<Result>,
    postId?: string,
  ): JobHandle<Result> {
    return this.enqueue('publish', draftId, task, postId);
  }

  /** Active handle for a kind and key, or null when idle. */
  findActive(kind: JobKind, key: string): JobHandle<unknown> | null {
    return this.activeByKey.get(compositeKey(kind, key))?.handle ?? null;
  }

  get(id: string): JobHandle<unknown> | null {
    return this.byId.get(id)?.handle ?? null;
  }

  cancel(id: string): boolean {
    const record = this.byId.get(id);
    if (record === undefined) return false;

    if (record.state === 'queued') {
      record.controller.abort(new JobCancelledError());
      this.removePending(record);
      this.settle(record, { status: 'cancelled' });
      return true;
    }

    // Running jobs unwind cooperatively; the slot stays occupied until the
    // task settles so a replacement cannot overlap it.
    if (!record.controller.signal.aborted) {
      record.controller.abort(new JobCancelledError());
    }
    return true;
  }

  /** Cancel every queued and running job (used by startup/shutdown recovery). */
  cancelAll(): void {
    for (const record of [...this.byId.values()]) {
      this.cancel(record.id);
    }
  }

  /**
   * Stop accepting work, cancel what is active, and wait for running tasks
   * to unwind. Tasks that ignore their signal will keep shutdown pending.
   */
  async shutdown(): Promise<void> {
    this.closed = true;
    this.cancelAll();
    await this.waitForIdle();
  }

  waitForIdle(): Promise<void> {
    if (this.byId.size === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  snapshot(): QueueSnapshot {
    const byKind = {} as Record<JobKind, KindSnapshot>;
    for (const kind of JOB_KINDS) {
      byKind[kind] = {
        queued: this.pending[kind].length,
        running: this.runningByKind[kind],
      };
    }
    const running = JOB_KINDS.reduce((total, kind) => total + this.runningByKind[kind], 0);
    return {
      active: this.byId.size,
      queued: this.byId.size - running,
      running,
      byKind,
    };
  }

  private enqueue<Result>(
    kind: JobKind,
    key: string,
    task: JobTask<Result>,
    externalId?: string,
  ): JobHandle<Result> {
    const existing = this.activeByKey.get(compositeKey(kind, key));
    if (existing !== undefined) {
      return existing.handle as JobHandle<Result>;
    }
    if (this.closed) throw new JobQueueClosedError();

    const id = externalId ?? this.createId();
    if (this.byId.has(id)) {
      throw new Error(`Duplicate active job id: ${id}`);
    }

    let resolveOutcome!: (outcome: JobOutcome<Result>) => void;
    const promise = new Promise<JobOutcome<Result>>((resolve) => {
      resolveOutcome = resolve;
    });
    const controller = new AbortController();

    const record: JobRecord = {
      id,
      kind,
      key,
      task: (context) => task(context),
      controller,
      resolve: (outcome) => resolveOutcome(outcome as JobOutcome<Result>),
      state: 'queued',
      handle: null,
    };

    const handle: JobHandle<Result> = {
      id,
      kind,
      key,
      get state() {
        return record.state;
      },
      get cancelRequested() {
        return record.controller.signal.aborted;
      },
      signal: record.controller.signal,
      promise,
      cancel: () => this.cancel(id),
    };
    record.handle = handle;

    this.byId.set(id, record);
    this.activeByKey.set(compositeKey(kind, key), record);
    this.pending[kind].push(record);
    this.pump(kind);
    return handle;
  }

  private pump(kind: JobKind): void {
    if (this.closed) return;
    while (this.runningByKind[kind] < this.concurrency[kind]) {
      const next = this.pending[kind].shift();
      if (next === undefined) return;
      if (next.state !== 'queued') continue;
      this.start(next);
    }
  }

  private start(record: JobRecord): void {
    record.state = 'running';
    this.runningByKind[record.kind] += 1;

    const context: JobContext = {
      jobId: record.id,
      kind: record.kind,
      key: record.key,
      signal: record.controller.signal,
      throwIfCancelled: () => record.controller.signal.throwIfAborted(),
    };

    void Promise.resolve()
      .then(() => record.task(context))
      .then(
        (value) => {
          this.settle(
            record,
            record.controller.signal.aborted
              ? { status: 'cancelled' }
              : { status: 'completed', value },
          );
        },
        (error: unknown) => {
          this.settle(
            record,
            record.controller.signal.aborted
              ? { status: 'cancelled' }
              : { status: 'failed', error },
          );
        },
      );
  }

  private settle(record: JobRecord, outcome: JobOutcome<unknown>): void {
    if (record.state === 'completed' || record.state === 'failed' || record.state === 'cancelled') {
      return;
    }
    const wasRunning = record.state === 'running';
    record.state = outcome.status;

    if (wasRunning) {
      this.runningByKind[record.kind] -= 1;
    }
    this.byId.delete(record.id);
    const composite = compositeKey(record.kind, record.key);
    if (this.activeByKey.get(composite) === record) {
      this.activeByKey.delete(composite);
    }
    record.resolve(outcome);

    if (this.byId.size === 0) {
      for (const waiter of this.idleWaiters.splice(0)) waiter();
    }
    if (wasRunning) this.pump(record.kind);
  }

  private removePending(record: JobRecord): void {
    const index = this.pending[record.kind].indexOf(record);
    if (index !== -1) this.pending[record.kind].splice(index, 1);
  }
}

export function createJobQueue(options: JobQueueOptions = {}): JobQueue {
  return new JobQueue(options);
}
