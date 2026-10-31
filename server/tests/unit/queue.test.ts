import { describe, expect, it } from 'vitest';
import { JobQueueClosedError, createJobQueue } from '../../src/jobs/queue.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

describe('JobQueue sync lane', () => {
  it('dedupes per repository and runs at most three repositories in parallel', async () => {
    const queue = createJobQueue();
    const started: string[] = [];
    const gates = new Map<string, () => void>();
    const task = (repo: string) => async (): Promise<string> => {
      started.push(repo);
      await new Promise<void>((resolve) => {
        gates.set(repo, resolve);
      });
      return repo;
    };

    const repos = ['r1', 'r2', 'r3', 'r4', 'r5'];
    const handles = repos.map((repo) => queue.enqueueSync(repo, task(repo)));
    await flush();
    expect(started).toEqual(['r1', 'r2', 'r3']);

    const duplicate = queue.enqueueSync('r1', task('r1'));
    expect(duplicate).toBe(handles[0]);

    gates.get('r1')?.();
    await flush();
    expect(started).toEqual(['r1', 'r2', 'r3', 'r4']);

    gates.get('r2')?.();
    await flush();
    expect(started).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);

    for (const gate of gates.values()) gate();
    const outcomes = await Promise.all(handles.map((handle) => handle.promise));
    expect(outcomes.every((outcome) => outcome.status === 'completed')).toBe(true);
    expect(queue.size).toBe(0);
  });
});

describe('JobQueue review lane', () => {
  it('caps AI runs at two and joins the active run for the same PR', async () => {
    const queue = createJobQueue();
    const started: string[] = [];
    const gates = new Map<string, () => void>();
    const task = (pr: string) => async (): Promise<void> => {
      started.push(pr);
      await new Promise<void>((resolve) => {
        gates.set(pr, resolve);
      });
    };

    const first = queue.enqueueReview('pr1', task('pr1'), 'run-1');
    const duplicate = queue.enqueueReview('pr1', task('pr1'), 'run-2');
    expect(duplicate).toBe(first);
    expect(duplicate.id).toBe('run-1');

    queue.enqueueReview('pr2', task('pr2'));
    queue.enqueueReview('pr3', task('pr3'));
    await flush();
    expect(started).toEqual(['pr1', 'pr2']);

    gates.get('pr1')?.();
    await flush();
    expect(started).toEqual(['pr1', 'pr2', 'pr3']);

    for (const gate of gates.values()) gate();
    await queue.waitForIdle();
  });
});

describe('JobQueue publish lane', () => {
  it('allows one in-flight publish per draft but independent drafts', async () => {
    const queue = createJobQueue();
    const started: string[] = [];
    const gates = new Map<string, () => void>();
    const task = (draft: string) => async (): Promise<void> => {
      started.push(draft);
      await new Promise<void>((resolve) => {
        gates.set(draft, resolve);
      });
    };

    const first = queue.enqueuePublish('draft-1', task('draft-1'));
    const duplicate = queue.enqueuePublish('draft-1', task('draft-1'));
    expect(duplicate).toBe(first);

    queue.enqueuePublish('draft-2', task('draft-2'));
    await flush();
    expect(started).toEqual(['draft-1', 'draft-2']);

    for (const gate of gates.values()) gate();
    await queue.waitForIdle();
  });
});

describe('JobQueue cancellation', () => {
  it('drops a queued job without running it', async () => {
    const queue = createJobQueue({ syncConcurrency: 1 });
    const gate = deferred();
    const started: string[] = [];

    const running = queue.enqueueSync('r1', async () => {
      started.push('r1');
      await gate.promise;
    });
    const queued = queue.enqueueSync('r2', async () => {
      started.push('r2');
    });
    await flush();
    expect(started).toEqual(['r1']);

    expect(queued.cancel()).toBe(true);
    await expect(queued.promise).resolves.toEqual({ status: 'cancelled' });
    expect(queued.state).toBe('cancelled');

    gate.resolve();
    await running.promise;
    await flush();
    expect(started).toEqual(['r1']);
  });

  it('aborts a running job and reports cancelled even if the task resolves afterwards', async () => {
    const queue = createJobQueue();
    let observedAbort = false;

    const handle = queue.enqueueReview('pr1', async (context) => {
      await new Promise<void>((resolve) => {
        context.signal.addEventListener(
          'abort',
          () => {
            observedAbort = true;
            resolve();
          },
          { once: true },
        );
      });
      return 'partial output that must be discarded';
    });
    await flush();
    expect(handle.state).toBe('running');

    expect(handle.cancel()).toBe(true);
    expect(handle.cancelRequested).toBe(true);
    await expect(handle.promise).resolves.toEqual({ status: 'cancelled' });
    expect(observedAbort).toBe(true);
  });

  it('returns false when cancelling a finished job', async () => {
    const queue = createJobQueue();
    const handle = queue.enqueueReview('pr1', async () => 'done');
    await handle.promise;
    expect(handle.cancel()).toBe(false);
  });
});

describe('JobQueue failures and shutdown', () => {
  it('reports task failures without rejecting the handle', async () => {
    const queue = createJobQueue();
    const handle = queue.enqueueReview('pr1', async () => {
      throw new Error('boom');
    });
    const outcome = await handle.promise;
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error).toBeInstanceOf(Error);
    }
    expect(queue.size).toBe(0);
  });

  it('shutdown cancels queued work, aborts running work, and closes the queue', async () => {
    const queue = createJobQueue({ syncConcurrency: 2 });
    const started: string[] = [];
    const task =
      (repo: string) =>
      async (context: { signal: AbortSignal }): Promise<void> => {
        started.push(repo);
        await new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      };

    const first = queue.enqueueSync('r1', task('r1'));
    queue.enqueueSync('r2', task('r2'));
    const queued = queue.enqueueSync('r3', task('r3'));
    await flush();
    expect(started).toEqual(['r1', 'r2']);

    await queue.shutdown();

    await expect(first.promise).resolves.toEqual({ status: 'cancelled' });
    await expect(queued.promise).resolves.toEqual({ status: 'cancelled' });
    expect(started).toEqual(['r1', 'r2']);
    expect(() => queue.enqueueSync('r4', async () => undefined)).toThrow(JobQueueClosedError);
  });
});
