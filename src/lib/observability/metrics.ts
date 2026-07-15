// src/lib/observability/metrics.ts
//
// M5.5 — Observability primitives.
//
// Three primitive metric types:
//   - Counter   : monotonic, only increments
//   - Gauge     : arbitrary value (can go up or down)
//   - Histogram : latency distribution, fixed bucket boundaries
//
// Design principles (per operator's M5 directive):
//   1. Single Registry — all metrics live in one Registry, exposed
//      via /api/runtime/status. No scattered metrics collection.
//   2. No business logic — these are PURE data structures.
//   3. Thread-safe under JS single-threaded event loop (atomic reads
//      and writes within one tick).
//   4. Snapshot-able — any moment, you can call .snapshot() to get
//      a serializable view.
//   5. Zero dependencies — no prom-client, no OpenTelemetry SDK.
//      The Registry is self-contained; the exporter serializes to
//      plain JSON.
//
// Why not prom-client?
//   - prom-client is great for Prometheus scraping, but the operator
//     asked for a single read-only HTTP endpoint (/api/runtime/status)
//     that returns a structured JSON snapshot. prom-client's exposition
//     format is text/plain Prometheus, not JSON.
//   - The Registry's snapshot() returns JSON; the exporter can later
//     be adapted to Prometheus format if scraping is needed.
//   - Keeping it dependency-free means the chain stack's test surface
//     stays small (no transitive deps to audit).
//
// Histogram bucket strategy:
//   - Latency histograms use exponential bucket boundaries
//     (1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000 ms).
//   - This covers sub-millisecond (mock transports) to multi-second
//     (real RPC + slow networks) without excessive bucket count.
//   - +Inf bucket always present for overflow.
//
// All metric types are FROZEN after M5.5 closeout — no API changes.

// -------------------------------------------------------------------------
// Counter — monotonic increment.
// -------------------------------------------------------------------------

/**
 * A counter that only goes up. Use for: op counts, error counts,
 * event counts. Never use for values that can decrease (use Gauge).
 *
 * Thread-safe: increment() is atomic under the JS event loop.
 *
 * Implementation note: uses `number` (float64) rather than bigint
 * because the project's tsconfig targets ES2017 (no bigint literals).
 * Float64 has exact integer precision up to 2^53 (~9 * 10^15),
 * which is far beyond any realistic counter value.
 */
export class Counter {
  private value = 0;

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(by: number = 1): void {
    if (by < 0) {
      throw new Error(`Counter(${this.name}).inc: counter cannot decrease (got ${by})`);
    }
    this.value += by;
  }

  get(): number {
    return this.value;
  }

  snapshot(): { name: string; help: string; value: number } {
    return { name: this.name, help: this.help, value: this.value };
  }

  reset(): void {
    this.value = 0;
  }
}

// -------------------------------------------------------------------------
// Gauge — arbitrary value (can go up or down).
// -------------------------------------------------------------------------

/**
 * A gauge that holds any numeric value. Use for: current lease owner
 * (encoded as 1 if held, 0 if not), uptime seconds, active connections,
 * queue depth.
 *
 * set() replaces the value; inc()/dec() adjust it.
 */
export class Gauge {
  private value = 0;

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  set(v: number): void { this.value = v; }
  inc(by: number = 1): void { this.value += by; }
  dec(by: number = 1): void { this.value -= by; }
  get(): number { return this.value; }

  snapshot(): { name: string; help: string; value: number } {
    return { name: this.name, help: this.help, value: this.value };
  }

  reset(): void { this.value = 0; }
}

// -------------------------------------------------------------------------
// Histogram — latency distribution.
// -------------------------------------------------------------------------

/**
 * Default bucket boundaries for latency histograms (in ms).
 * Covers 1ms (mock) → 10s (slow RPC timeout).
 */
export const DEFAULT_LATENCY_BUCKETS_MS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000,
] as const;

/**
 * A histogram for latency distributions. Records each observation,
 * maintains bucket counts, and computes p50/p95/p99 from the bucket
 * structure (no per-observation storage — bounded memory).
 *
 * For exact percentile computation (needed in tests), the histogram
 * also keeps a running sum + count, and optionally a sorted-array
 * reservoir (enabled via `keepReservoir: true` — used by tests +
 * the long-duration runner for accurate p99).
 */
export class Histogram {
  private readonly buckets: readonly number[];
  private readonly bucketCounts: number[];
  private sum = 0;
  private count = 0;
  private min = Number.POSITIVE_INFINITY;
  private max = 0;
  // Optional reservoir for exact percentile computation (tests only).
  private reservoir: number[] | null;
  private readonly reservoirSize: number;

  constructor(
    readonly name: string,
    readonly help: string,
    opts?: {
      buckets?: readonly number[];
      keepReservoir?: boolean;
      reservoirSize?: number;
    },
  ) {
    this.buckets = opts?.buckets ?? DEFAULT_LATENCY_BUCKETS_MS;
    this.bucketCounts = new Array(this.buckets.length + 1).fill(0); // +1 for +Inf
    this.reservoirSize = opts?.reservoirSize ?? 10_000;
    this.reservoir = opts?.keepReservoir ? [] : null;
  }

  /**
   * Record a latency observation (in milliseconds).
   */
  observe(valueMs: number): void {
    if (valueMs < 0) {
      throw new Error(`Histogram(${this.name}).observe: negative latency ${valueMs}`);
    }
    this.sum += valueMs;
    this.count++;
    if (valueMs < this.min) this.min = valueMs;
    if (valueMs > this.max) this.max = valueMs;

    // Find the bucket — first boundary >= valueMs.
    let placed = false;
    for (let i = 0; i < this.buckets.length; i++) {
      if (valueMs <= this.buckets[i]!) {
        this.bucketCounts[i]++;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // +Inf bucket.
      this.bucketCounts[this.bucketCounts.length - 1]++;
    }

    // Optional reservoir (bounded ring buffer).
    if (this.reservoir !== null) {
      if (this.reservoir.length < this.reservoirSize) {
        this.reservoir.push(valueMs);
      } else {
        // Replace a random slot (reservoir sampling).
        const idx = Math.floor(Math.random() * this.count);
        if (idx < this.reservoirSize) {
          this.reservoir[idx] = valueMs;
        }
      }
    }
  }

  /**
   * Compute percentile from the reservoir (if kept) or bucket structure.
   *
   * Without a reservoir, percentiles are APPROXIMATIONS based on bucket
   * boundaries (e.g., p95 = the boundary of the bucket containing the
   * 95th percentile). With a reservoir, percentiles are exact (sorted
   * array lookup).
   */
  percentile(p: number): number {
    if (this.count === 0) return 0;
    if (p < 0 || p > 1) throw new Error(`percentile must be in [0, 1], got ${p}`);

    // If we have a reservoir, use it for exact percentiles.
    if (this.reservoir !== null && this.reservoir.length > 0) {
      const sorted = [...this.reservoir].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
      return sorted[idx]!;
    }

    // Otherwise, approximate from buckets.
    const target = Math.ceil(this.count * p);
    let cumulative = 0;
    for (let i = 0; i < this.bucketCounts.length; i++) {
      cumulative += this.bucketCounts[i]!;
      if (cumulative >= target) {
        if (i < this.buckets.length) {
          return this.buckets[i]!;
        }
        return this.max; // +Inf bucket
      }
    }
    return this.max;
  }

  p50(): number { return this.percentile(0.5); }
  p95(): number { return this.percentile(0.95); }
  p99(): number { return this.percentile(0.99); }

  mean(): number {
    return this.count === 0 ? 0 : this.sum / this.count;
  }

  snapshot(): {
    name: string;
    help: string;
    count: number;
    sum: number;
    min: number;
    max: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    buckets: { le: number; count: number }[];
  } {
    return {
      name: this.name,
      help: this.help,
      count: this.count,
      sum: this.sum,
      min: this.count === 0 ? 0 : this.min,
      max: this.max,
      mean: this.mean(),
      p50: this.p50(),
      p95: this.p95(),
      p99: this.p99(),
      buckets: this.buckets.map((le, i) => ({ le, count: this.bucketCounts[i]! })),
    };
  }

  reset(): void {
    this.bucketCounts.fill(0);
    this.sum = 0;
    this.count = 0;
    this.min = Number.POSITIVE_INFINITY;
    this.max = 0;
    if (this.reservoir !== null) this.reservoir.length = 0;
  }
}

// -------------------------------------------------------------------------
// Tests / self-validation
// -------------------------------------------------------------------------

/**
 * Internal self-check — verifies Counter/Histogram/Gauge behave
 * correctly. Called by the registry on first metric registration.
 * Not exported — internal sanity check only.
 */
export function _selfTest(): boolean {
  const c = new Counter("test", "test");
  c.inc(); c.inc(5);
  if (c.get() !== 6) return false;

  const g = new Gauge("test", "test");
  g.set(10); g.inc(5); g.dec(3);
  if (g.get() !== 12) return false;

  const h = new Histogram("test", "test", { keepReservoir: true });
  h.observe(5); h.observe(10); h.observe(15); h.observe(20);
  if (h.snapshot().count !== 4) return false;
  if (h.mean() !== 12.5) return false;

  return true;
}
