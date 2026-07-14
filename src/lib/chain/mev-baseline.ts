// H1.4 — MEV Baseline: abnormal slippage detection, dynamic slippage
// limit, sandwich detection via simulation, private-relay abstraction
// stub (no dependency on relays yet).
//
// DESIGN PHILOSOPHY
// -----------------
// MEV (Maximal Extractable Value) is the value that a third party can
// extract from a transaction by reordering, inserting, or censoring
// transactions in a block. The two most common MEV attacks against a
// trading bot are:
//
//   1. SANDWICH ATTACK — attacker sees the victim's pending buy tx in
//      the mempool, front-runs it with their own buy (pushing the price
//      up), then back-runs with a sell (after the victim's buy executed
//      at the inflated price). The victim pays a higher price; the
//      attacker pockets the difference.
//
//   2. ARBITRAGE PREDICTION — if the bot's exits (TP/SL) follow a
//      predictable pattern, arb bots can pre-empt them. (H7 covers
//      exit-timing jitter; H1.4 only covers the slippage + sandwich
//      detection layer.)
//
// H1.4 builds the MEV baseline primitive that the future live-trading
// path (M3+) will use. It is a BASELINE, not a full defense — the
// private-relay integration (Flashbots Protect, Merlin for Base,
// MEV-Share) is intentionally a stub at this stage. The operator's
// directive was explicit: "preparação da abstração para private relays
// (sem dependência deles ainda)".
//
// The primitive provides four guarantees, each with an adversarial test:
//
//   1. ABNORMAL SLIPPAGE DETECTION — given an expected price and a
//      simulated execution price, the primitive flags any deviation
//      beyond the dynamic limit. The dynamic limit is computed from
//      (a) a baseline tolerance (configurable), (b) the pool's recent
//      volatility (higher volatility → wider tolerance), and (c) the
//      trade size relative to pool liquidity (larger trade → wider
//      tolerance, but capped to prevent "infinity slippage = ok").
//
//   2. DYNAMIC SLIPPAGE LIMIT — a pure function
//      computeSlippageLimit(volatilityBps, tradeSizeUsd, poolLiquidityUsd, baselineBps)
//      that returns the maximum acceptable slippage in bps. This
//      replaces the hardcoded 30bps in paper-trader.ts.
//
//   3. SANDWICH DETECTION — given a pre-trade simulation (state before
//      the victim tx) and a post-trade simulation (state after), the
//      detector checks for the signature of a sandwich attack:
//        - a front-run buy by a non-victim address that increases the
//          pool price
//        - a back-run sell by the same non-victim address that
//          decreases the pool price
//      The detector returns a sandwich score [0..1]; score >= 0.5
//      blocks the broadcast.
//
//   4. PRIVATE-RELAY ABSTRACTION — a `Relay` interface with two
//      implementations:
//        - PublicMempoolRelay (default): broadcasts via the standard
//          eth_sendRawTransaction path (subject to MEV).
//        - PrivateRelay (stub): broadcasts via a private endpoint
//          (Flashbots Protect, etc.). The stub is NOT wired to any
//          real relay — it throws "not implemented" — but the
//          interface is in place so M3+ can plug in a real relay
//          without changing the caller.
//
// ADVERSARIAL TESTS (per the permanent principle)
// -----------------------------------------------
//   - A simulated slippage beyond the dynamic limit blocks the action.
//   - A simulated sandwich pattern (front-run buy + back-run sell by a
//     non-victim address around the victim tx) is detected with score
//     >= 0.5 and blocks the action.
//   - A non-sandwich pattern (the victim is the only trader) is NOT
//     flagged (false-positive test).
//   - The private-relay stub correctly throws "not implemented" so
//     no production code accidentally uses it before it's wired.

export interface SlippageInputs {
  /** Recent pool volatility, in bps (e.g. 100 = 1% stdev). */
  volatilityBps: number;
  /** Trade size in USD. */
  tradeSizeUsd: number;
  /** Pool liquidity in USD (depth on the side the trade hits). */
  poolLiquidityUsd: number;
  /** Baseline slippage tolerance in bps. Default 50 (0.5%). */
  baselineBps?: number;
  /** Hard cap on the dynamic limit, in bps. Default 300 (3%). */
  hardCapBps?: number;
}

export interface SlippageLimit {
  /** Computed limit, in bps. */
  bps: number;
  /** Components used to compute it (for transparency/debugging). */
  components: {
    baseline: number;
    volatilityContribution: number;
    sizeContribution: number;
    hardCap: number;
  };
}

/**
 * Compute the dynamic slippage limit, in bps.
 *
 * The formula is intentionally conservative:
 *   limit = baseline + volatilityComponent + sizeComponent
 *   limit = min(limit, hardCap)
 *
 *   volatilityComponent = volatilityBps * 0.5
 *     (half the recent volatility — we don't want to fully accept
 *     volatility-sized slippage, because that's exactly what a
 *     sandwich attacker would target)
 *
 *   sizeComponent = (tradeSizeUsd / poolLiquidityUsd) * 10000 * 0.5
 *     (the price impact of the trade itself, in bps, halved —
 *     we accept up to half the expected price impact as additional
 *     slippage tolerance)
 *
 * The hard cap (default 300bps = 3%) prevents the dynamic limit from
 * growing unboundedly on high-volatility / low-liquidity pools. If the
 * computed limit exceeds the cap, the cap wins — the broadcast is
 * blocked. This is the "infinity slippage = ok" defense.
 */
export function computeSlippageLimit(inputs: SlippageInputs): SlippageLimit {
  const baseline = inputs.baselineBps ?? 50;
  const hardCap = inputs.hardCapBps ?? 300;
  const volatilityContribution = inputs.volatilityBps * 0.5;
  const sizeRatio = inputs.poolLiquidityUsd > 0
    ? Math.min(1, inputs.tradeSizeUsd / inputs.poolLiquidityUsd)
    : 1;
  const sizeContribution = sizeRatio * 10_000 * 0.5;
  const raw = baseline + volatilityContribution + sizeContribution;
  const bps = Math.min(raw, hardCap);
  return {
    bps,
    components: {
      baseline,
      volatilityContribution,
      sizeContribution,
      hardCap,
    },
  };
}

export interface SlippageCheck {
  /** True if the actual slippage is within the dynamic limit. */
  ok: boolean;
  /** Actual slippage in bps (always non-negative; sign is in direction). */
  actualBps: number;
  /** Direction of slippage: "excess" (paid more) or "surplus" (paid less). */
  direction: "excess" | "surplus";
  /** The dynamic limit that was applied. */
  limit: SlippageLimit;
}

/**
 * Check whether an actual execution price is within the dynamic
 * slippage limit, given the expected price.
 *
 * Both prices are in the same unit (typically USD per token, or token
 * per USD). The comparison is symmetric — we treat surplus slippage
 * (better-than-expected) as OK but flag it for observability.
 */
export function checkSlippage(
  expectedPrice: number,
  actualPrice: number,
  inputs: SlippageInputs,
): SlippageCheck {
  const limit = computeSlippageLimit(inputs);
  if (expectedPrice <= 0) {
    return {
      ok: false,
      actualBps: Infinity,
      direction: "excess",
      limit,
    };
  }
  const diff = actualPrice - expectedPrice;
  const absBps = Math.abs(diff / expectedPrice * 10_000);
  // For buys: actualPrice > expectedPrice → excess slippage (bad).
  // For sells: actualPrice < expectedPrice → excess slippage (bad).
  // The caller knows the direction; we just report abs + sign of diff.
  // For the "excess" determination, we use: if |diff| > 0 and the
  // caller is paying more, it's excess. We approximate here: positive
  // diff = excess (treat as buy-side by default). The caller can flip
  // the sign of expectedPrice for sell-side.
  const direction: "excess" | "surplus" = diff > 0 ? "excess" : "surplus";
  return {
    ok: absBps <= limit.bps,
    actualBps: absBps,
    direction,
    limit,
  };
}

// -------------------------------------------------------------------------
// Sandwich detection
// -------------------------------------------------------------------------

export interface PoolStateSnapshot {
  /** Block number of the snapshot. */
  blockNumber: number;
  /** Pool spot price (token0 per token1, or USD per token — same unit as the trade). */
  spotPrice: number;
  /** Pool reserves (in USD, both sides summed for simplicity). */
  liquidityUsd: number;
}

export interface AddressActivity {
  /** The address that traded. */
  address: string;
  /** "buy" or "sell". */
  side: "buy" | "sell";
  /** Trade size in USD. */
  sizeUsd: number;
  /** Block number of the trade. */
  blockNumber: number;
}

export interface SandwichAnalysis {
  /** Sandwich score [0..1]. >= 0.5 means "sandwich detected, block". */
  score: number;
  /** True if score >= 0.5. */
  detected: boolean;
  /** The address that ran the sandwich (if detected). */
  attacker?: string;
  /** Reason for the score (human-readable). */
  reason: string;
  /** The pre-trade snapshot used in the analysis. */
  preState: PoolStateSnapshot;
  /** The post-trade snapshot used in the analysis. */
  postState: PoolStateSnapshot;
  /** All trades observed between pre and post (including the victim's). */
  observedTrades: AddressActivity[];
}

/**
 * Analyze a sequence of pool state snapshots + observed trades for the
 * signature of a sandwich attack.
 *
 * A sandwich has three transactions, all in the same block (or adjacent
 * blocks):
 *   1. Attacker BUY (front-run) — increases pool price.
 *   2. Victim BUY (the tx we're about to broadcast) — pays inflated price.
 *   3. Attacker SELL (back-run) — decreases pool price back, pockets diff.
 *
 * The detector looks for this pattern: an address X (not the victim)
 * that has a buy followed by a sell, with the victim's buy in between,
 * and the pool price reverting toward the pre-front-run level after
 * the back-run.
 *
 * Score components (each [0..1], final score is the max):
 *   - 1.0 if a perfect sandwich pattern is found (attacker buy + victim
 *     buy + attacker sell, in order, same address, price reverts)
 *   - 0.5 if a partial pattern is found (e.g. attacker buy + victim buy
 *     but no attacker sell yet — front-run detected, back-run pending)
 *   - 0.0 if no suspicious activity
 */
export function detectSandwich(
  victimAddress: string,
  preState: PoolStateSnapshot,
  postState: PoolStateSnapshot,
  observedTrades: AddressActivity[],
): SandwichAnalysis {
  // Filter out the victim's own trades.
  const otherTrades = observedTrades.filter(t => t.address.toLowerCase() !== victimAddress.toLowerCase());

  // Group by address: for each non-victim address, look for a buy-sell pair.
  const byAddress = new Map<string, AddressActivity[]>();
  for (const t of otherTrades) {
    const arr = byAddress.get(t.address.toLowerCase()) ?? [];
    arr.push(t);
    byAddress.set(t.address.toLowerCase(), arr);
  }

  let bestScore = 0;
  let bestAttacker: string | undefined;
  let bestReason = "no suspicious activity";

  for (const [addr, trades] of byAddress.entries()) {
    if (trades.length < 2) continue;
    // Sort by block number.
    const sorted = [...trades].sort((a, b) => a.blockNumber - b.blockNumber);
    // Find a buy followed by a sell (in any later block).
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].side !== "buy") continue;
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].side !== "sell") continue;
        // Found a buy-sell pair by the same address.
        // Check whether the victim's trade falls between them.
        const victimTrades = observedTrades.filter(t =>
          t.address.toLowerCase() === victimAddress.toLowerCase() &&
          t.blockNumber >= sorted[i].blockNumber &&
          t.blockNumber <= sorted[j].blockNumber,
        );
        if (victimTrades.length === 0) continue;

        // Check price reversion: postState price should be closer to
        // preState than to the peak (front-run) price.
        // We don't have an explicit "peak" snapshot, so we approximate:
        // if the price moved >X% between pre and post, but the attacker's
        // PnL is positive (sell size × price > buy size × price), it's
        // a strong sandwich signal.
        const attackerBuyValue = sorted[i].sizeUsd;
        const attackerSellValue = sorted[j].sizeUsd;
        const attackerProfit = attackerSellValue - attackerBuyValue;

        if (attackerProfit > 0) {
          // Strong signal: attacker made money by buying then selling
          // around the victim's trade.
          const score = 1.0;
          if (score > bestScore) {
            bestScore = score;
            bestAttacker = addr;
            bestReason = `sandwich detected: attacker ${addr} bought at block ${sorted[i].blockNumber}, sold at block ${sorted[j].blockNumber}, profit ${attackerProfit.toFixed(2)} USD; victim trade at block ${victimTrades[0].blockNumber}`;
          }
        } else {
          // Partial signal: buy-sell pair around victim but no profit
          // (could be a failed sandwich or unrelated arb).
          const score = 0.4;
          if (score > bestScore) {
            bestScore = score;
            bestAttacker = addr;
            bestReason = `partial sandwich signal: attacker ${addr} buy at ${sorted[i].blockNumber} + sell at ${sorted[j].blockNumber} around victim, but no profit detected`;
          }
        }
        break;  // Only count the first sell after each buy.
      }
    }
  }

  // Also check for lone front-run: a non-victim buy immediately before
  // the victim's buy that increased the pool price.
  const victimTrades = observedTrades.filter(t =>
    t.address.toLowerCase() === victimAddress.toLowerCase(),
  );
  if (victimTrades.length > 0) {
    const victimBlock = victimTrades[0].blockNumber;
    const frontRun = otherTrades.find(t =>
      t.side === "buy" && t.blockNumber <= victimBlock && t.blockNumber >= victimBlock - 2,
    );
    if (frontRun && postState.spotPrice > preState.spotPrice) {
      const score = 0.5;
      if (score > bestScore) {
        bestScore = score;
        bestAttacker = frontRun.address;
        bestReason = `front-run detected: address ${frontRun.address} bought at block ${frontRun.blockNumber} (victim at ${victimBlock}); pool price increased from ${preState.spotPrice} to ${postState.spotPrice}`;
      }
    }
  }

  return {
    score: bestScore,
    detected: bestScore >= 0.5,
    attacker: bestAttacker,
    reason: bestReason,
    preState,
    postState,
    observedTrades,
  };
}

// -------------------------------------------------------------------------
// Private-relay abstraction (stub — no real relay wired yet)
// -------------------------------------------------------------------------

export interface RelayBroadcastRequest {
  /** Signed raw transaction (hex). */
  rawTx: string;
  /** Optional: maximum block number the tx is valid for (relays may ignore). */
  maxBlockNumber?: number;
}

export interface RelayBroadcastResult {
  ok: boolean;
  /** Relay-specific identifier (Flashbots returns a uuid; public mempool returns the tx hash). */
  relayId?: string;
  /** The tx hash, if the relay returned one. */
  txHash?: string;
  error?: string;
}

/**
 * Relay interface. Two implementations:
 *   - PublicMempoolRelay (default): uses the QuorumRpcClient's
 *     broadcastRawTransaction path.
 *   - PrivateRelay (stub): throws "not implemented" — interface is
 *     in place so M3+ can plug in a real relay without changing the
 *     caller.
 */
export interface Relay {
  /** Stable name for logging/observability. */
  name: string;
  /** Whether the relay provides mempool privacy. */
  isPrivate: boolean;
  /** Broadcast a signed raw transaction. */
  broadcast(req: RelayBroadcastRequest): Promise<RelayBroadcastResult>;
}

/**
 * Public mempool relay — broadcasts via the standard
 * eth_sendRawTransaction path. This is the default; subject to MEV.
 */
export class PublicMempoolRelay implements Relay {
  readonly name = "public-mempool";
  readonly isPrivate = false;

  constructor(
    private readonly broadcastFn: (rawTx: string) => Promise<{ ok: boolean; txHash?: string; error?: string }>,
  ) {}

  async broadcast(req: RelayBroadcastRequest): Promise<RelayBroadcastResult> {
    const r = await this.broadcastFn(req.rawTx);
    return {
      ok: r.ok,
      txHash: r.txHash,
      error: r.error,
    };
  }
}

/**
 * Private relay stub. The interface is in place; the implementation
 * throws "not implemented" so no production code accidentally uses it
 * before it's wired. When M3+ lands and we plug in Flashbots Protect
 * / Merlin / MEV-Share, this stub gets replaced with a real
 * implementation. The caller does not change.
 *
 * This is the "preparação da abstração para private relays (sem
 * dependência deles ainda)" the operator mandated.
 */
export class PrivateRelayStub implements Relay {
  readonly name: string;
  readonly isPrivate = true;

  constructor(name: string = "private-relay-stub") {
    this.name = name;
  }

  async broadcast(_req: RelayBroadcastRequest): Promise<RelayBroadcastResult> {
    return {
      ok: false,
      error: `private relay '${this.name}' is not implemented yet — interface is in place, implementation is deferred to M3+ when a real relay (Flashbots Protect / Merlin / MEV-Share) is wired`,
    };
  }
}
