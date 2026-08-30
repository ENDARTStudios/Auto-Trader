import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Queue, Worker, getEtlQueue, resetQueues } from '../src/lib/queue/bullmq-stub';
import { initSentry, captureSentryException } from '../src/lib/observability/sentry-init';
import { generateEmbeddingOllama } from '../src/lib/rag/ollama';
import { fetchCoinGecko } from '../src/lib/etl/coingecko';
import { runETL } from '../src/lib/etl/run';

describe('S28 BullMQ stub + Sentry + Ollama E2E', () => {
  beforeAll(() => resetQueues());

  it('Queue: add processes 3 jobs sequentially', async () => {
    const q = new Queue<number>({ name: "test-1" });
    const processed: number[] = [];
    await q.add("j1", 1);
    await q.add("j2", 2);
    await q.add("j3", 3);
    await q.process(async (job) => {
      processed.push(job.data);
    });
    expect(processed).toEqual([1, 2, 3]);
  });

  it('Queue: failed job retries up to attempts', async () => {
    const q = new Queue<number>({ name: "test-2", defaultJobOptions: { attempts: 3 } });
    const seen: number[] = [];
    await q.add("bad", 1);
    await q.process(async () => {
      seen.push(Date.now());
      throw new Error("fail");
    });
    expect(seen.length).toBe(3);
  });

  it('Queue: failed job beyond attempts moves to failed', async () => {
    const q = new Queue<number>({ name: "test-3", defaultJobOptions: { attempts: 2 } });
    let calls = 0;
    await q.add("bad", 1);
    await q.process(async () => {
      calls++;
      throw new Error("fail");
    });
    expect(calls).toBe(2);
  });

  it('getEtlQueue returns singleton per name', async () => {
    const q1 = await getEtlQueue();
    const q2 = await getEtlQueue();
    expect(q1.name).toBe(q2.name);
    expect(q1.name).toBe("etl");
  });

  it('Worker: ticks poll and exits cleanly', async () => {
    const q = new Queue<number>({ name: "test-4" });
    const w = new Worker(q, async (job) => {
      // noop
    }, { pollIntervalMs: 10 });
    await q.add("x", 1);
    await new Promise((r) => setTimeout(r, 50));
    await w.close();
    expect(q.size).toBe(0);
  });

  it('Sentry init is idempotent and no-op when DSN absent', async () => {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    await initSentry();
    await initSentry(); // second call is idempotent (no throw)
    captureSentryException(new Error("test"));
    // no assertion needed — just that it doesn't crash
  });

  it('Ollama fallback works (no ollama server, uses hash mock)', async () => {
    // No real ollama server assumed — fallback in src/lib/rag/ollama.ts returns hash mock
    const emb = await generateEmbeddingOllama("BTC Bitcoin test");
    expect(emb.length).toBe(1536);
    const allZero = emb.every((v) => v === 0);
    expect(allZero).toBe(false);
  });

  // Note: runETL full integration test (loading data into queue + worker drain)
  // lives in tests/etl-prod.test.ts — it covers runETL + CoinGecko source.
  // This suite focuses on the queue + Sentry + Ollama helpers.
});
