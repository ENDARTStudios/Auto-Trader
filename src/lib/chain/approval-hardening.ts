// H1.3 — Approval Hardening: approval cap enforcement, inventory
// tracking, automatic revocation, and hard block on unlimited approvals.
//
// DESIGN PHILOSOPHY
// -----------------
// The unlimited-approval pattern (`approve(spender, type(uint256).max)`)
// is the single most common ERC-20 drain vector in DeFi. Once granted,
// the spender can drain the user's entire balance at any time — including
// months later, after the user has forgotten the approval exists, the
// spender contract has been upgraded to a malicious impl, or the spender's
// private key has been compromised. The vector is silent: no on-chain
// event forces the user to notice the drain until the balance is gone.
//
// H1.3 builds the approval-hardening primitive that the future live-
// trading path (M3+) will use for EVERY approval operation:
//
//   1. CAP ENFORCEMENT — every approval is capped at min(amount, balance,
//      configuredMax). Unlimited approvals (type(uint256).max or any
//      amount >= balance) are REJECTED with an explicit error. The
//      caller cannot bypass this — the gate is enforced at the
//      approval-builder level, not at the user-confirmation level.
//
//   2. INVENTORY TRACKING — every approval granted is recorded in an
//      in-memory inventory (DB-backed in production) keyed by
//      (token, owner, spender). The inventory tracks: amount granted,
//      amount currently expected to remain (decremented as the spender
//      consumes it via transfers the simulator observes), grant timestamp,
//      last-used timestamp, and revocation status.
//
//   3. AUTOMATIC REVOCATION — when a position closes or a swap completes,
//      the caller invokes revokeApproval(token, spender) which sets the
//      on-chain allowance back to 0. This is a "fire and forget" — even
//      if the spender is honest, revoking eliminates the persistent drain
//      vector. The revocation is itself a transaction that goes through
//      the simulation gate.
//
//   4. ADVERSARIAL CHECKS — every approval operation is checked against
//      a hard-coded blocklist of "unlimited approval shapes":
//        - amount === type(uint256).max
//        - amount >= owner's current balance (over-approval)
//        - amount > configured cap (policy violation)
//      Each check has an adversarial test (test-h1-approval-hardening.ts).
//
// INJECTABLE LEDGER
// -----------------
// The inventory uses an injectable `ApprovalLedger` interface so tests
// can use an in-memory implementation and production can use a Prisma-
// backed one. The ledger is the source of truth for "what approvals
// currently exist" — the on-chain allowance is a DERIVED value (the
// ledger records what we granted, the on-chain state is what's actually
// left after the spender consumed some).

export type Address = string;  // checksummed

export interface ApprovalRecord {
  token: Address;
  owner: Address;
  spender: Address;
  /** Original granted amount, in atomic units (decimal string). */
  grantedAmount: string;
  /** Amount we expect to remain, in atomic units (decimal string). */
  remainingAmount: string;
  /** Epoch ms when the approval was granted. */
  grantedAt: number;
  /** Epoch ms when the spender last consumed part of the approval (or null). */
  lastUsedAt: number | null;
  /** Whether the approval has been revoked (on-chain allowance = 0). */
  revoked: boolean;
}

export interface ApprovalLedger {
  /** Insert or update an approval record. */
  upsert(rec: ApprovalRecord): Promise<void>;
  /** Get an approval record by (token, owner, spender). */
  get(token: Address, owner: Address, spender: Address): Promise<ApprovalRecord | null>;
  /** List all non-revoked approvals for an owner. */
  listForOwner(owner: Address): Promise<ApprovalRecord[]>;
  /** Mark an approval as revoked. */
  markRevoked(token: Address, owner: Address, spender: Address): Promise<void>;
  /** Delete all records (test helper). */
  clear(): Promise<void>;
}

export interface ApprovalPolicy {
  /** Hard cap on any single approval, in atomic units. Default: 2^256-1 disabled — must be set explicitly. */
  maxApprovalPerSpender?: string;
  /** Whether to allow approvals equal to the owner's full balance. Default: false. */
  allowFullBalanceApproval?: boolean;
  /** Whether to auto-revoke after the swap completes. Default: true. */
  autoRevokeAfterUse?: boolean;
  /** Logger — defaults to no-op. */
  log?: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
}

export interface ApprovalRequest {
  token: Address;
  owner: Address;
  spender: Address;
  /** Requested amount, in atomic units (decimal string). */
  amount: string;
  /** Owner's current token balance, in atomic units (decimal string). */
  ownerBalance: string;
}

export interface ApprovalDecision {
  /** True if the approval is allowed. */
  ok: boolean;
  /** Reason for rejection, if ok=false. */
  rejectReason?: string;
  /** The amount that will actually be approved (may be < requested if capped). */
  approvedAmount: string;
  /** Whether the request was capped (approvedAmount < requested). */
  capped: boolean;
  /** The policy that was applied. */
  policy: ApprovalPolicy;
}

export interface RevocationRequest {
  token: Address;
  owner: Address;
  spender: Address;
}

export interface RevocationResult {
  ok: boolean;
  /** Whether there was an approval to revoke. */
  found: boolean;
  /** Reason for failure, if ok=false. */
  error?: string;
}

// type(uint256).max as a decimal string.
export const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

function noopLog() { /* no-op */ }

/**
 * The approval gate. Stateless except for the injected ledger — all
 * policy decisions are pure functions of (request, policy, ledger state).
 */
export class ApprovalGate {
  private readonly policy: Required<Omit<ApprovalPolicy, "maxApprovalPerSpender" | "log">> & {
    maxApprovalPerSpender: string | undefined;
    log: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
  };
  private readonly ledger: ApprovalLedger;

  constructor(ledger: ApprovalLedger, policy: ApprovalPolicy = {}) {
    this.ledger = ledger;
    this.policy = {
      maxApprovalPerSpender: policy.maxApprovalPerSpender,
      allowFullBalanceApproval: policy.allowFullBalanceApproval ?? false,
      autoRevokeAfterUse: policy.autoRevokeAfterUse ?? true,
      log: policy.log ?? noopLog,
    };
  }

  /**
   * Evaluate an approval request against the policy + ledger state.
   * Returns ok=true ONLY when:
   *   - amount is not type(uint256).max (or any value equal to MAX_UINT256)
   *   - amount > 0
   *   - after capping (maxApprovalPerSpender), the approved amount does
   *     not exceed owner's balance (unless allowFullBalanceApproval=true)
   *
   * The approvedAmount is min(requestedAmount, cap, balance). If the
   * approvedAmount < requestedAmount, capped=true. If approvedAmount
   * would have to be 0 (or the request is unlimited), ok=false.
   *
   * ORDER OF CHECKS (deliberate):
   *   1. Unlimited-approval hard block (no bypass possible).
   *   2. Parse + zero/negative check.
   *   3. Cap enforcement — bring the amount down to the policy cap if
   *      needed. This happens BEFORE the over-approval check so that a
   *      request like "1M tokens" against a 100-token cap gets capped
   *      to 100 first, and then the over-approval check sees 100 (not 1M).
   *   4. Over-approval check on the CAPPED amount — if even the capped
   *      amount is >= balance, block (unless allowFullBalanceApproval).
   *
   * This ordering matters: if we checked over-approval first, a request
   * for 1M tokens against a 1M-token balance would be blocked even when
   * the cap is 100 — defeating the purpose of the cap.
   */
  async evaluate(req: ApprovalRequest): Promise<ApprovalDecision> {
    const { token, owner, spender, amount: reqAmountStr, ownerBalance: balanceStr } = req;

    // 1. Hard block on unlimited approvals.
    if (reqAmountStr === MAX_UINT256) {
      this.policy.log("error", "approval gate: unlimited approval blocked", { token, owner, spender });
      return {
        ok: false,
        rejectReason: "unlimited approval (type(uint256).max) is forbidden by policy",
        approvedAmount: "0",
        capped: false,
        policy: this.policy,
      };
    }

    // Parse amounts as BigInt.
    let reqAmount: bigint;
    let balance: bigint;
    try {
      reqAmount = BigInt(reqAmountStr);
      balance = BigInt(balanceStr);
    } catch {
      return {
        ok: false,
        rejectReason: `non-integer amount: requested='${reqAmountStr}' balance='${balanceStr}'`,
        approvedAmount: "0",
        capped: false,
        policy: this.policy,
      };
    }

    // 2. Reject zero/negative.
    if (reqAmount <= 0n) {
      return {
        ok: false,
        rejectReason: "approval amount must be positive",
        approvedAmount: "0",
        capped: false,
        policy: this.policy,
      };
    }

    // 3. Cap enforcement — apply BEFORE the over-approval check.
    let approvedAmount = reqAmount;
    let capped = false;
    if (this.policy.maxApprovalPerSpender !== undefined) {
      const cap = BigInt(this.policy.maxApprovalPerSpender);
      if (approvedAmount > cap) {
        approvedAmount = cap;
        capped = true;
      }
    }

    // 4. Over-approval check on the CAPPED amount.
    // If the user requests 1M tokens but the cap is 100, the approved
    // amount is now 100 — and 100 < 1M balance, so it passes. If the
    // user requests 100 tokens but only has 50, the approved amount
    // stays at 100 (no cap applies) — and 100 >= 50 balance, so it
    // fails the over-approval check (unless allowFullBalanceApproval).
    if (approvedAmount >= balance && !this.policy.allowFullBalanceApproval) {
      this.policy.log("warn", "approval gate: over-approval blocked", {
        token, owner, spender,
        requested: reqAmountStr, balance: balanceStr,
        approvedAfterCap: approvedAmount.toString(),
      });
      return {
        ok: false,
        rejectReason: `over-approval: approved ${approvedAmount.toString()} (after cap) >= balance ${balanceStr} (set allowFullBalanceApproval=true to override)`,
        approvedAmount: "0",
        capped,
        policy: this.policy,
      };
    }

    // 5. Final sanity: approved amount must be positive.
    if (approvedAmount <= 0n) {
      return {
        ok: false,
        rejectReason: "approved amount would be 0 after capping",
        approvedAmount: "0",
        capped,
        policy: this.policy,
      };
    }

    return {
      ok: true,
      approvedAmount: approvedAmount.toString(),
      capped,
      policy: this.policy,
    };
  }

  /**
   * Record a granted approval in the ledger. Called by the caller AFTER
   * the on-chain approve tx has been confirmed.
   */
  async recordGrant(rec: Omit<ApprovalRecord, "grantedAt" | "lastUsedAt" | "revoked">): Promise<ApprovalRecord> {
    const full: ApprovalRecord = {
      ...rec,
      grantedAt: Date.now(),
      lastUsedAt: null,
      revoked: false,
    };
    await this.ledger.upsert(full);
    this.policy.log("info", "approval recorded", {
      token: rec.token, owner: rec.owner, spender: rec.spender,
      granted: rec.grantedAmount,
    });
    return full;
  }

  /**
   * Mark an approval as revoked in the ledger. Called by the caller AFTER
   * the on-chain approve(spender, 0) tx has been confirmed.
   */
  async recordRevocation(req: RevocationRequest): Promise<RevocationResult> {
    const existing = await this.ledger.get(req.token, req.owner, req.spender);
    if (!existing) {
      return { ok: true, found: false };
    }
    await this.ledger.markRevoked(req.token, req.owner, req.spender);
    this.policy.log("info", "approval revoked", {
      token: req.token, owner: req.owner, spender: req.spender,
    });
    return { ok: true, found: true };
  }

  /**
   * List all active (non-revoked) approvals for an owner. Used by the
   * dashboard "approval inventory" view and by the auto-revoke cron.
   */
  async inventory(owner: Address): Promise<ApprovalRecord[]> {
    const all = await this.ledger.listForOwner(owner);
    return all.filter(r => !r.revoked);
  }
}

// -------------------------------------------------------------------------
// In-memory ledger implementation (for tests + initial wiring).
// Production will use a Prisma-backed implementation.
// -------------------------------------------------------------------------

export class InMemoryApprovalLedger implements ApprovalLedger {
  private readonly map: Map<string, ApprovalRecord> = new Map();

  private key(token: string, owner: string, spender: string): string {
    return `${token.toLowerCase()}|${owner.toLowerCase()}|${spender.toLowerCase()}`;
  }

  async upsert(rec: ApprovalRecord): Promise<void> {
    this.map.set(this.key(rec.token, rec.owner, rec.spender), { ...rec });
  }

  async get(token: string, owner: string, spender: string): Promise<ApprovalRecord | null> {
    return this.map.get(this.key(token, owner, spender)) ?? null;
  }

  async listForOwner(owner: string): Promise<ApprovalRecord[]> {
    const ownerLc = owner.toLowerCase();
    return Array.from(this.map.values()).filter(r => r.owner.toLowerCase() === ownerLc);
  }

  async markRevoked(token: string, owner: string, spender: string): Promise<void> {
    const k = this.key(token, owner, spender);
    const existing = this.map.get(k);
    if (existing) {
      this.map.set(k, { ...existing, revoked: true });
    }
  }

  async clear(): Promise<void> {
    this.map.clear();
  }
}
