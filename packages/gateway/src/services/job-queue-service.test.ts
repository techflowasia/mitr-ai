import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the jobs repository ──
// claimJob hands out unique jobs until `available` is exhausted, then null.

let available = 0;
let claimed = 0;

const mockRepo = {
  claimJob: vi.fn(async (queue: string) => {
    if (available <= 0) return null;
    available--;
    claimed++;
    return {
      id: `job-${claimed}`,
      name: 'test',
      queue,
      priority: 0,
      payload: {},
      attempts: 0,
      maxAttempts: 3,
      status: 'active',
    };
  }),
  complete: vi.fn(async () => {}),
  fail: vi.fn(async () => {}),
  create: vi.fn(),
  getStats: vi.fn(),
};

vi.mock('../db/repositories/jobs.js', () => ({
  getJobsRepository: () => mockRepo,
}));

const { JobQueueService } = await import('./job-queue-service.js');

// ── Concurrency tracking handler ──

let currentConcurrent = 0;
let maxConcurrent = 0;
let gates: Array<() => void> = [];

const blockingHandler = async () => {
  currentConcurrent++;
  maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
  await new Promise<void>((resolve) => gates.push(resolve));
  currentConcurrent--;
  return {};
};

beforeEach(() => {
  vi.clearAllMocks();
  available = 0;
  claimed = 0;
  currentConcurrent = 0;
  maxConcurrent = 0;
  gates = [];
});

describe('JobQueueService pollWorker concurrency', () => {
  it('never exceeds the worker concurrency cap when polls overlap', async () => {
    // Plenty of jobs waiting — enough that an unguarded race could claim well
    // past the cap (2×concurrency or more).
    available = 50;

    const service = new JobQueueService();
    const worker = {
      id: 'w1',
      queue: 'workflow_nodes',
      concurrency: 4,
      handler: blockingHandler,
      activeJobs: new Set<string>(),
      stopped: false,
      polling: false,
    };

    // Three overlapping pollWorker invocations reproduce the real race: the
    // 1 Hz pollAll tick, the immediate start poll, and a finally re-poll can
    // all run against the same worker while claimJob is mid-await.
    await Promise.all([
      (service as unknown as { pollWorker: (w: typeof worker) => Promise<void> }).pollWorker(
        worker
      ),
      (service as unknown as { pollWorker: (w: typeof worker) => Promise<void> }).pollWorker(
        worker
      ),
      (service as unknown as { pollWorker: (w: typeof worker) => Promise<void> }).pollWorker(
        worker
      ),
    ]);

    // Flush the executeJob microtasks so every started handler has incremented.
    await new Promise((r) => setTimeout(r, 20));

    // The worker must hold no more than `concurrency` jobs in flight.
    expect(maxConcurrent).toBeLessThanOrEqual(4);
    expect(worker.activeJobs.size).toBeLessThanOrEqual(4);

    // Cleanup: stop and release the blocked handlers.
    worker.stopped = true;
    gates.forEach((g) => g());
    await new Promise((r) => setTimeout(r, 0));
  });

  it('claims exactly up to concurrency from a single poll', async () => {
    available = 50;

    const service = new JobQueueService();
    const worker = {
      id: 'w2',
      queue: 'q',
      concurrency: 3,
      handler: blockingHandler,
      activeJobs: new Set<string>(),
      stopped: false,
      polling: false,
    };

    await (service as unknown as { pollWorker: (w: typeof worker) => Promise<void> }).pollWorker(
      worker
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(worker.activeJobs.size).toBe(3);
    expect(maxConcurrent).toBe(3);

    worker.stopped = true;
    gates.forEach((g) => g());
    await new Promise((r) => setTimeout(r, 0));
  });
});
