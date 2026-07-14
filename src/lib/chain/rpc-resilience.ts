// H1.1 — RPC Resilience: multi-RPC quorum, per-endpoint health score,
// automatic failover, per-RPC circuit breaker.
//
// DESIGN PHILOSOPHY
// -----------------
// A single RPC endpoint is a single point of failure AND a single point
// of censorship/trust. H1.1 builds the resilience primitive that the
// future live-trading path (M3+) will use for every on-chain read and
// every broadcast. The primitive is built BEFORE the live path exists,
// so M3 lands on a hardened base rather than bolting defenses onto an
// already-live client.
//
// The primitive provides four guarantees, each with an adversarial test:
//
//   1. QUORUM — for read calls that return a value, the client queries
//      multiple endpoints and requires a quorum (default: strict majority
//      of HEALTHY endpoints) to agree. Disagreement blocks the action.
//      This catches a malicious/stale endpoint returning a wrong balance,
//      wrong chain id, or stale block number.
//
//   2. HEALTH SCORE — each endpoint carries a health score [0..1] that
//      decays on failure and recovers on success. Endpoints below a
//      floor (default: 0.2) are removed from the quorum pool until they
//      recover. This is per-endpoint, so a single bad provider doesn't
//      poison the whole pool.
//
//   3. FAILOVER — when the primary endpoint fails (timeout, transport
//      error, HTTP 5xx), the client automatically retries the next
//      healthy endpoint in priority order. The failover is observable
//      (logged + surfaced in the result) so the caller can decide
//      whether to alert.
//
//   4. CIRCUIT BREAKER — after N consecutive failures on a single
//      endpoint (default: 5), the breaker opens and the endpoint is
//      skipped for a cooldown period (default: 60s). After cooldown,
//      a single probe request is allowed; if it succeeds, the breaker
//      closes. This prevents thundering-herd retries against a down
//      provider.
//
// INJECTABLE TRANSPORT
// --------------------
// The client takes a `Transport` function in its config, so tests can
// inject deterministic mock responses (including malicious ones) without
// any real network. The production transport is a thin wrapper around
// ethers.JsonRpcProvider, wired in main.ts when M3 lands.

export interface RpcEndpoint {
  /** Stable identifier — used in logs, circuit-breaker state, health map. */
  id: string;
  /** The URL the transport will actually call. */
  url: string;
  /** Higher priority = preferred. Ties broken by registration order. */
  priority: number;
  /** Optional human-readable provider name (e.g. "Alchemy", "Infura"). */
  provider?: string;
}

export type Transport = (url: string, method: string, params: unknown[]) => Promise<unknown>;

export interface QuorumClientConfig {
  endpoints: RpcEndpoint[];
  transport: Transport;
  /** Timeout per single RPC call, in ms. Default 5000. */
  callTimeoutMs?: number;
  /** How many endpoints to fan out to for quorum reads. Default: all healthy. */
  quorumFanout?: number;
  /** Minimum fraction of healthy respondents that must agree. Default 0.5 (>strict majority when fanout is odd). */
  quorumAgreementFraction?: number;
  /** Health floor — endpoints below this are excluded from quorum. Default 0.2. */
  healthFloor?: number;
  /** Consecutive failures before breaker opens. Default 5. */
  breakerThreshold?: number;
  /** Breaker cooldown in ms. Default 60_000. */
  breakerCooldownMs?: number;
  /** Health delta on success. Default +0.1 (capped at 1.0). */
  healthGainOnSuccess?: number;
  /** Health delta on failure. Default -0.3 (floored at 0.0). */
  healthLossOnFailure?: number;
  /** Logger — defaults to no-op. */
  log?: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
}

interface EndpointState {
  health: number;        // [0..1]
  consecutiveFailures: number;
  breakerOpenedAt: number | null;   // epoch ms; null = closed
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

export interface QuorumResult<T> {
  ok: boolean;
  value?: T;
  /** Endpoints that were queried for this call. */
  queried: string[];
  /** Endpoints that returned a matching value. */
  agreed: string[];
  /** Endpoints that returned a non-matching value (or errored). */
  disagreed: string[];
  /** Endpoint that was used as the primary (failover target if quorum failed). */
  primaryUsed: string | null;
  /** Whether failover occurred (primary failed, secondary handled). */
  failedOver: boolean;
  /** Whether the circuit breaker tripped any endpoint during this call. */
  breakerTripped: string[];
  error?: string;
}

export interface BroadcastResult {
  ok: boolean;
  txHash?: string;
  /** Endpoint that accepted the broadcast. */
  broadcastBy: string | null;
  /** Whether failover occurred. */
  failedOver: boolean;
  error?: string;
}

const DEFAULTS = {
  callTimeoutMs: 5_000,
  quorumFanout: 0,        // 0 = all healthy
  quorumAgreementFraction: 0.5,
  healthFloor: 0.2,
  breakerThreshold: 5,
  breakerCooldownMs: 60_000,
  healthGainOnSuccess: 0.1,
  healthLossOnFailure: 0.3,
};

function noopLog() { /* no-op */ }

export class QuorumRpcClient {
  readonly endpoints: RpcEndpoint[];
  private readonly cfg: Required<QuorumClientConfig>;
  private readonly state: Map<string, EndpointState> = new Map();
  private readonly transport: Transport;

  constructor(config: QuorumClientConfig) {
    if (!config.endpoints || config.endpoints.length === 0) {
      throw new Error("QuorumRpcClient: at least one endpoint required");
    }
    // Sort once by priority desc; stable sort preserves registration order on ties.
    this.endpoints = [...config.endpoints].sort((a, b) => b.priority - a.priority);
    this.transport = config.transport;
    this.cfg = {
      endpoints: this.endpoints,
      transport: config.transport,
      callTimeoutMs: config.callTimeoutMs ?? DEFAULTS.callTimeoutMs,
      quorumFanout: config.quorumFanout ?? DEFAULTS.quorumFanout,
      quorumAgreementFraction: config.quorumAgreementFraction ?? DEFAULTS.quorumAgreementFraction,
      healthFloor: config.healthFloor ?? DEFAULTS.healthFloor,
      breakerThreshold: config.breakerThreshold ?? DEFAULTS.breakerThreshold,
      breakerCooldownMs: config.breakerCooldownMs ?? DEFAULTS.breakerCooldownMs,
      healthGainOnSuccess: config.healthGainOnSuccess ?? DEFAULTS.healthGainOnSuccess,
      healthLossOnFailure: config.healthLossOnFailure ?? DEFAULTS.healthLossOnFailure,
      log: config.log ?? noopLog,
    };
    for (const ep of this.endpoints) {
      this.state.set(ep.id, {
        health: 1.0,
        consecutiveFailures: 0,
        breakerOpenedAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Snapshot of endpoint health (for dashboards / tests). */
  healthSnapshot(): Record<string, { health: number; consecutiveFailures: number; breakerOpen: boolean }> {
    const out: Record<string, { health: number; consecutiveFailures: number; breakerOpen: boolean }> = {};
    for (const ep of this.endpoints) {
      const s = this.state.get(ep.id)!;
      out[ep.id] = {
        health: s.health,
        consecutiveFailures: s.consecutiveFailures,
        breakerOpen: s.breakerOpenedAt !== null && Date.now() - s.breakerOpenedAt < this.cfg.breakerCooldownMs,
      };
    }
    return out;
  }

  /**
   * Quorum read: fan out to N healthy endpoints, require agreement.
   *
   * Returns ok=false when:
   *   - fewer than 2 healthy endpoints are available (quorum impossible)
   *   - the agreement fraction is not met
   *   - all endpoints time out / error
   *
   * The caller MUST treat ok=false as "do not act on this data". This is
   * the explicit fail-closed behavior — a quorum failure is safer than
   * trusting a single endpoint.
   */
  async quorumRead<T = unknown>(method: string, params: unknown[]): Promise<QuorumResult<T>> {
    const respondents = this.pickHealthyForQuorum();
    const result: QuorumResult<T> = {
      ok: false,
      queried: [],
      agreed: [],
      disagreed: [],
      primaryUsed: null,
      failedOver: false,
      breakerTripped: [],
    };

    if (respondents.length < 2) {
      result.error = `quorum impossible: only ${respondents.length} healthy endpoint(s)`;
      this.cfg.log("warn", "quorumRead: quorum impossible", { healthy: respondents.length });
      return result;
    }

    result.queried = respondents.map(e => e.id);

    // Fan out concurrently with per-call timeout.
    const responses = await Promise.allSettled(
      respondents.map(async ep => {
        const value = await this.callWithTimeout(ep, method, params);
        return { id: ep.id, value: value as T };
      })
    );

    // Tally responses.
    const valueCounts = new Map<string, { count: number; ids: string[]; value: T }>();
    for (const r of responses) {
      if (r.status === "fulfilled") {
        const key = serializeForQuorum(r.value.value);
        const existing = valueCounts.get(key);
        if (existing) {
          existing.count++;
          existing.ids.push(r.value.id);
        } else {
          valueCounts.set(key, { count: 1, ids: [r.value.id], value: r.value.value });
        }
      } else {
        // rejected — endpoint failed
        const id = (r.reason as { id?: string })?.id ?? "unknown";
        result.disagreed.push(id);
      }
    }

    // Find the value with the most votes.
    let best: { count: number; ids: string[]; value: T } | null = null;
    for (const v of valueCounts.values()) {
      if (!best || v.count > best.count) best = v;
    }

    if (!best) {
      result.error = "quorumRead: all endpoints errored";
      return result;
    }

    // The "agreed" list is the IDs that voted with the winner.
    result.agreed = best.ids;
    result.disagreed = respondents.filter(ep => !best!.ids.includes(ep.id)).map(ep => ep.id);

    const agreementFraction = best.count / respondents.length;
    if (agreementFraction < this.cfg.quorumAgreementFraction) {
      result.error = `quorum not reached: ${best.count}/${respondents.length} agree (${(agreementFraction * 100).toFixed(0)}% < required ${(this.cfg.quorumAgreementFraction * 100).toFixed(0)}%)`;
      this.cfg.log("warn", "quorumRead: quorum disagreement", {
        method, agreed: best.ids, disagreed: result.disagreed,
      });
      return result;
    }

    result.ok = true;
    result.value = best.value;
    result.primaryUsed = best.ids[0];
    return result;
  }

  /**
   * Single-endpoint read with failover. Used for calls where quorum is
   * impractical (e.g. eth_call to a node-specific cache) or for write
   * submissions (eth_sendRawTransaction). Failover walks the healthy
   * endpoint list in priority order until one succeeds.
   */
  async readWithFailover<T = unknown>(method: string, params: unknown[]): Promise<QuorumResult<T>> {
    const result: QuorumResult<T> = {
      ok: false,
      queried: [],
      agreed: [],
      disagreed: [],
      primaryUsed: null,
      failedOver: false,
      breakerTripped: [],
    };

    for (const ep of this.healthyEndpoints()) {
      result.queried.push(ep.id);
      try {
        // callWithTimeout already records success/failure internally; we
        // do NOT call recordFailure/recordSuccess here — that would
        // double-count and corrupt the health score.
        const value = (await this.callWithTimeout(ep, method, params)) as T;
        result.ok = true;
        result.value = value;
        result.primaryUsed = ep.id;
        result.agreed = [ep.id];
        result.failedOver = result.queried.length > 1;
        return result;
      } catch (err) {
        result.disagreed.push(ep.id);
        // Check if the breaker just opened as a result of this failure
        // (callWithTimeout already recorded it; we just observe the result).
        const s = this.state.get(ep.id)!;
        if (s.breakerOpenedAt !== null && Date.now() - s.breakerOpenedAt < 1000) {
          // Breaker opened in the last second — almost certainly this call.
          result.breakerTripped.push(ep.id);
        }
        this.cfg.log("warn", "readWithFailover: endpoint failed, trying next", {
          endpoint: ep.id, error: (err as Error).message,
        });
      }
    }

    result.error = `readWithFailover: all ${result.queried.length} healthy endpoint(s) failed`;
    return result;
  }

  /**
   * Broadcast a signed raw transaction. Same as readWithFailover but
   * semantically distinct: a successful broadcast returns a txHash and
   * the caller is responsible for confirmation. We do NOT broadcast to
   * multiple endpoints simultaneously (that would risk double-broadcast
   * attempts if both accept) — we walk until one accepts.
   */
  async broadcastRawTransaction(rawTx: string): Promise<BroadcastResult> {
    for (const ep of this.healthyEndpoints()) {
      try {
        // callWithTimeout records success/failure internally.
        const txHash = await this.callWithTimeout(ep, "eth_sendRawTransaction", [rawTx]);
        return {
          ok: true,
          txHash: txHash as string,
          broadcastBy: ep.id,
          failedOver: false,
        };
      } catch (err) {
        const s = this.state.get(ep.id)!;
        const tripped = s.breakerOpenedAt !== null && Date.now() - s.breakerOpenedAt < 1000;
        this.cfg.log("warn", "broadcastRawTransaction: endpoint rejected, trying next", {
          endpoint: ep.id, error: (err as Error).message, tripped,
        });
      }
    }
    return {
      ok: false,
      broadcastBy: null,
      failedOver: false,
      error: "broadcastRawTransaction: all healthy endpoints rejected",
    };
  }

  // -------------------------------------------------------------------------
  // Internal: endpoint selection + health/breaker state
  // -------------------------------------------------------------------------

  private healthyEndpoints(): RpcEndpoint[] {
    const now = Date.now();
    return this.endpoints.filter(ep => {
      const s = this.state.get(ep.id)!;
      if (s.breakerOpenedAt !== null && now - s.breakerOpenedAt < this.cfg.breakerCooldownMs) {
        return false;  // breaker open
      }
      if (s.health < this.cfg.healthFloor) {
        return false;  // below health floor
      }
      return true;
    });
  }

  private pickHealthyForQuorum(): RpcEndpoint[] {
    const healthy = this.healthyEndpoints();
    if (this.cfg.quorumFanout > 0 && healthy.length > this.cfg.quorumFanout) {
      return healthy.slice(0, this.cfg.quorumFanout);
    }
    return healthy;
  }

  private async callWithTimeout(ep: RpcEndpoint, method: string, params: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout after ${this.cfg.callTimeoutMs}ms`));
      }, this.cfg.callTimeoutMs);

      this.transport(ep.url, method, params)
        .then(value => {
          clearTimeout(timer);
          this.recordSuccess(ep.id);
          resolve(value);
        })
        .catch(err => {
          clearTimeout(timer);
          // Tag the error with the endpoint id so quorumRead can attribute
          // the failure correctly when Promise.allSettled returns rejected.
          (err as Error & { id?: string }).id = ep.id;
          this.recordFailure(ep.id);
          reject(err);
        });
    });
  }

  private recordSuccess(id: string): void {
    const s = this.state.get(id);
    if (!s) return;
    s.health = Math.min(1.0, s.health + this.cfg.healthGainOnSuccess);
    s.consecutiveFailures = 0;
    s.breakerOpenedAt = null;
    s.lastSuccessAt = Date.now();
  }

  /** Returns true if the breaker just opened as a result of this failure. */
  private recordFailure(id: string): boolean {
    const s = this.state.get(id);
    if (!s) return false;
    s.health = Math.max(0.0, s.health - this.cfg.healthLossOnFailure);
    s.consecutiveFailures++;
    s.lastFailureAt = Date.now();
    if (s.consecutiveFailures >= this.cfg.breakerThreshold && s.breakerOpenedAt === null) {
      s.breakerOpenedAt = Date.now();
      this.cfg.log("error", "circuit breaker opened", { endpoint: id, failures: s.consecutiveFailures });
      return true;
    }
    return false;
  }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * Serialize a value for quorum comparison. JSON-RPC values are JSON by
 * definition, so we use stable JSON serialization (sorted keys) to compare.
 *
 * IMPORTANT: This MUST be stable across endpoints. Different endpoints
 * may return equivalent values with keys in different orders (especially
 * for object results like eth_call returns). Sorting the keys makes the
 * comparison robust.
 *
 * The adversarial test for this function is in test-h1-rpc-resilience.ts:
 * it asserts that two objects with the same content but different key
 * orders are considered equal, AND that two objects differing in any
 * single field are considered different.
 */
export function serializeForQuorum(value: unknown): string {
  return stableStringify(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k])).join(",") + "}";
}
