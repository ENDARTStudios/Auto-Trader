// src/lib/runtime/long-duration.ts
//
// M5.6 — Long-Duration runner.
//
// Per the operator's M5 directive:
//
//   "Do NOT use setInterval.
//    Prefer a controlled loop.
//
//    while (running) {
//        await runtime.tick();
//        await sleep(period);
//    }
//
//    This avoids accumulated temporal drift over many hours of execution."
//
// DESIGN
// ------
// LongDurationRunner is a controlled loop driver. It:
//   1. Runs `runtime.pipeline.process(req)` on each tick.
//   2. Sleeps for `periodMs` between ticks (using a Promise-based sleep
//      that respects the `running` flag — SIGINT/Ctrl+C sets
//      running=false and the loop exits cleanly).
//   3. Every `checkpointInterval` ticks, prints a checkpoint with:
//      - heap used / RSS
//      - op count + success rate
//      - lease renewals (from Registry)
//      - Registry snapshot (counters + latency percentiles)
//   4. At the end (duration reached OR stopped), prints a final summary.
//
// NO setInterval — the loop is purely `while (running) { await tick(); await sleep(); }`.
// This ensures:
//   - No timer drift (each tick is `process() + sleep`, not a fixed
//     schedule that drifts if process() is slow).
//   - Clean shutdown (set running=false, the current tick + sleep
//      completes, then the loop exits).
//   - Backpressure (if process() is slow, ticks naturally slow down
//      rather than piling up).
//
// WHAT LONG-DURATION DOES NOT DO
// ------------------------------
//   - Does NOT make decisions (the pipeline does).
//   - Does NOT alter the runtime.
//   - Does NOT persist data (the engine + Prisma own that).
//   - Does NOT broadcast to real networks (uses mock transports by
//      default; the test harness wires real transports if needed).

import type { Runtime } from "./runtime";
import type { PipelineRequest, PipelineResult } from "../chain/pipeline";
import { buildSnapshot } from "../observability/snapshot";

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export interface LongDurationConfig {
  /** Total duration to run, in milliseconds. */
  durationMs: number;
  /** Sleep between ticks, in milliseconds. Default: 100. */
  periodMs?: number;
  /** Print a checkpoint every N ticks. Default: 100. */
  checkpointInterval?: number;
  /** The request to send on each tick. */
  request: PipelineRequest;
  /** Optional: callback for each checkpoint (e.g., for tests). */
  onCheckpoint?: (cp: Checkpoint) => void;
  /** Optional: callback for each tick result. */
  onTick?: (result: PipelineResult, tickNum: number) => void;
  /** Optional: logger. Default: console.log. */
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

export interface Checkpoint {
  tickNum: number;
  elapsedMs: number;
  heapUsedMb: number;
  heapRssMb: number;
  opCount: number;
  successCount: number;
  failCount: number;
  successRate: number;
  opsPerSec: number;
  snapshot: ReturnType<typeof buildSnapshot>;
}

export interface LongDurationResult {
  totalTicks: number;
  successCount: number;
  failCount: number;
  successRate: number;
  opsPerSec: number;
  durationMs: number;
  heapDeltaMb: number;
  finalSnapshot: ReturnType<typeof buildSnapshot>;
  stopped: boolean; // true if stopped via stop(), false if duration elapsed
}

// -------------------------------------------------------------------------
// LongDurationRunner
// -------------------------------------------------------------------------

export class LongDurationRunner {
  private running = false;
  private readonly cfg: Required<Omit<LongDurationConfig, "onCheckpoint" | "onTick" | "request">> &
    Pick<LongDurationConfig, "onCheckpoint" | "onTick" | "request">;

  constructor(
    private readonly runtime: Runtime,
    cfg: LongDurationConfig,
  ) {
    this.cfg = {
      durationMs: cfg.durationMs,
      periodMs: cfg.periodMs ?? 100,
      checkpointInterval: cfg.checkpointInterval ?? 100,
      request: cfg.request,
      onCheckpoint: cfg.onCheckpoint,
      onTick: cfg.onTick,
      log: cfg.log ?? ((msg, fields) => console.log(msg, fields ? JSON.stringify(fields) : "")),
    };
  }

  /**
   * Stop the runner. The current tick + sleep completes, then the loop
   * exits. Returns immediately — await `run()` to get the final result.
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Run the loop until durationMs elapses or stop() is called.
   */
  async run(): Promise<LongDurationResult> {
    this.running = true;
    const start = Date.now();
    const startHeap = process.memoryUsage().heapUsed;
    let tickNum = 0;
    let successCount = 0;
    let failCount = 0;

    while (this.running) {
      const elapsed = Date.now() - start;
      if (elapsed >= this.cfg.durationMs) {
        break;
      }

      // Run one tick.
      const result = await this.runtime.pipeline.process(this.cfg.request);
      tickNum++;
      if (result.ok) successCount++;
      else failCount++;

      this.cfg.onTick?.(result, tickNum);

      // Checkpoint.
      if (tickNum % this.cfg.checkpointInterval === 0) {
        const cp = this.makeCheckpoint(tickNum, start, successCount, failCount);
        this.cfg.log(`[checkpoint] tick=${tickNum} ops=${successCount + failCount} rate=${cp.opsPerSec.toFixed(1)}/s heap=${cp.heapUsedMb.toFixed(1)}MB`);
        this.cfg.onCheckpoint?.(cp);
      }

      // Sleep — respects running flag.
      await this.sleep(this.cfg.periodMs);
    }

    const end = Date.now();
    const endHeap = process.memoryUsage().heapUsed;
    const durationMs = end - start;
    const totalTicks = successCount + failCount;
    const finalSnapshot = buildSnapshot(this.runtime.registry, {
      canaryPct: this.runtime.handle.getCanaryPct(),
      leaseActive: this.runtime.handle.isLeaseActive(),
      rpcHealthy: this.runtime.handle.getRpcHealthy(),
      rpcUnhealthy: this.runtime.handle.getRpcUnhealthy(),
      status: this.running ? "RUNNING" : "STOPPED",
    });

    return {
      totalTicks,
      successCount,
      failCount,
      successRate: totalTicks > 0 ? successCount / totalTicks : 0,
      opsPerSec: durationMs > 0 ? (totalTicks / durationMs) * 1000 : 0,
      durationMs,
      heapDeltaMb: (endHeap - startHeap) / (1024 * 1024),
      finalSnapshot,
      stopped: !this.running,
    };
  }

  private makeCheckpoint(
    tickNum: number,
    start: number,
    successCount: number,
    failCount: number,
  ): Checkpoint {
    const elapsedMs = Date.now() - start;
    const mem = process.memoryUsage();
    const total = successCount + failCount;
    return {
      tickNum,
      elapsedMs,
      heapUsedMb: mem.heapUsed / (1024 * 1024),
      heapRssMb: mem.rss / (1024 * 1024),
      opCount: total,
      successCount,
      failCount,
      successRate: total > 0 ? successCount / total : 0,
      opsPerSec: elapsedMs > 0 ? (total / elapsedMs) * 1000 : 0,
      snapshot: buildSnapshot(this.runtime.registry, {
        canaryPct: this.runtime.handle.getCanaryPct(),
        leaseActive: this.runtime.handle.isLeaseActive(),
        rpcHealthy: this.runtime.handle.getRpcHealthy(),
        rpcUnhealthy: this.runtime.handle.getRpcUnhealthy(),
      }),
    };
  }

  /**
   * Promise-based sleep that respects the `running` flag.
   * If stop() is called during sleep, the sleep resolves early.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (!this.running || Date.now() - start >= ms) {
          resolve();
        } else {
          // Check every 10ms (or remaining time, whichever is smaller).
          const remaining = ms - (Date.now() - start);
          setTimeout(check, Math.min(10, remaining));
        }
      };
      setTimeout(check, Math.min(10, ms));
    });
  }
}
