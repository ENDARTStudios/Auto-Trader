// src/lib/queue/bullmq-stub.ts — S28 T001: in-process queue stub (BullMQ-compatible API)
// BullMQ + Redis require npm install + Redis server. This stub provides the
// same API surface (Queue, Worker, Job) in-process so we can refactor runETL
// and the engine loop to use async queues without external deps. To switch
// to real BullMQ in production, replace this file with `import { Queue, Worker } from "bullmq"`.
import { logger } from "@/lib/trading/logger";

export interface Job<T = unknown> {
  id: string;
  name: string;
  data: T;
  attempts: number;
  timestamp: number;
  status: "waiting" | "active" | "completed" | "failed";
  error?: string;
}

export type JobProcessor<T> = (job: Job<T>) => Promise<void>;

interface QueueOptions {
  name: string;
  defaultJobOptions?: { attempts?: number; removeOnComplete?: boolean };
}

const queues = new Map<string, Array<Job>>();

export class Queue<T = unknown> {
  readonly name: string;
  readonly defaultJobOptions: { attempts: number; removeOnComplete: boolean };

  constructor(opts: QueueOptions) {
    this.name = opts.name;
    this.defaultJobOptions = {
      attempts: opts.defaultJobOptions?.attempts ?? 3,
      removeOnComplete: opts.defaultJobOptions?.removeOnComplete ?? true,
    };
    if (!queues.has(this.name)) {
      queues.set(this.name, []);
    }
  }

  async add(name: string, data: T): Promise<Job<T>> {
    const job: Job<T> = {
      id: `${this.name}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      name,
      data,
      attempts: 0,
      timestamp: Date.now(),
      status: "waiting",
    };
    queues.get(this.name)!.push(job);
    logger.info("queue", `Job added: ${job.id} (${name})`);
    return job;
  }

  async process(processor: JobProcessor<T>): Promise<void> {
    const items = queues.get(this.name) ?? [];
    while (items.length > 0) {
      // The stub map holds heterogeneous jobs; the queue owner guarantees T.
      const job = items.shift()! as Job<T>;
      job.status = "active";
      job.attempts++;
      try {
        await processor(job);
        job.status = "completed";
        logger.info("queue", `Job completed: ${job.id}`);
      } catch (e) {
        job.error = String(e);
        if (job.attempts < this.defaultJobOptions.attempts) {
          items.push(job);
          logger.warn("queue", `Job retry ${job.attempts}: ${job.id} (${e})`);
        } else {
          job.status = "failed";
          logger.error("queue", `Job failed after ${job.attempts} attempts: ${job.id}`, { error: String(e) });
        }
      }
    }
  }

  get size(): number {
    return queues.get(this.name)?.length ?? 0;
  }
}

export class Worker<T = unknown> {
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private readonly queue: Queue<T>,
    private readonly processor: JobProcessor<T>,
    options: { concurrency?: number; pollIntervalMs?: number } = {},
  ) {
    const { pollIntervalMs = 1000 } = options;
    this.interval = setInterval(() => {
      void this.queue.process(this.processor);
    }, pollIntervalMs);
  }

  async close(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

export async function getEtlQueue(): Promise<Queue<{ source: string }>> {
  return new Queue<{ source: string }>({ name: "etl" });
}

export function resetQueues(): void {
  queues.clear();
}
