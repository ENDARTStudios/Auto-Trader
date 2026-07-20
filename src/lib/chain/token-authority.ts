// H2.3 — Token Authority Verification: mint authority, freeze
// authority, blacklist authority, pausability, ownership transfer,
// real renounce.
//
// DESIGN PHILOSOPHY
// -----------------
// The "owner set to address(0)" pattern is the canonical fake-renounce
// trick: the contract's `owner()` returns 0x0, the deployer posts in a
// Telegram channel "ownership renounced", but the contract still has a
// `mint(address,uint256)` selector that's callable by a separate
// `minter` role that the deployer kept. The supply can be inflated at
// will; the "renounce" was theatrical.
//
// H2.3 verifies every authority surface the contract exposes — not
// just `owner()`. The primitive takes a `TokenAuthoritySource` (an
// injectable reader) and produces an `AuthorityReport` that names
// every authority surface and whether it's:
//
//   - HELD — by a specific address (and whether that address is in
//     the caller's allowlist)
//   - RENOUNCED — actually set to address(0) via the canonical
//     Ownable.renounceOwnership() flow (verified via event log +
//     current owner == 0)
//   - OPEN — callable by anyone (the most dangerous state)
//   - HIDDEN — a selector like `mint()` exists in the bytecode but
//     the verifier can't identify the access-control pattern (the
//     contract uses a custom role system, not the standard
//     `onlyOwner` modifier). HIDDEN is treated as fail-closed: the
//     caller must explicitly allow it.
//
// AUTHORITY SURFACES CHECKED
// --------------------------
// Per the operator's directive:
//
//   1. MINT AUTHORITY — `mint(address,uint256)` selector present.
//      Who can call it? (owner, minter role, anyone, hidden.)
//   2. FREEZE AUTHORITY — `freeze(address)` / `freezeAccount(address)`
//      selectors. Can an authority freeze the bot's balance?
//   3. BLACKLIST AUTHORITY — `blacklist(address)` / `blockAccount(address)`
//      selectors. Same question.
//   4. PAUSABILITY — `pause()` / `setPaused(bool)` selectors. Can an
//      authority halt all transfers?
//   5. OWNERSHIP TRANSFER — `transferOwnership(address)` selector
//      present. If yes, the current owner can hand ownership to any
//      address — including the deployer's second wallet. Even if the
//      current owner is renounced, this selector being present means
//      the renounce is reversible IF the renounce was faked (which
//      H2.1 already catches). If the renounce was real, this selector
//      is dead code.
//   6. REAL RENOUNCE — verification that an `OwnershipRenounced`
//      event was emitted AND the current `owner()` is 0x0. Both
//      conditions must hold. Either alone is insufficient.
//
// INJECTABLE SOURCE
// -----------------
// The verifier takes a `TokenAuthoritySource` so tests inject
// deterministic mock state. Production wraps the same ChainReader
// used by H2.1 plus the standard ERC-20 ABI + a small set of role-
// based ABIs (AccessControl, Ownable2Step, custom).
//
// ADVERSARIAL SCOPE
// -----------------
// Per the permanent principle, the verifier ships with adversarial
// tests for: (a) the canonical fake renounce — owner()=0x0 but
// `mint()` callable by minter role kept by deployer, (b) the "two-
// step renounce" — owner()=0x0 but transferOwnership() was last
// called by a non-zero owner, (c) the "paused renounce" — owner()=0x0
// AND pause() exists AND unpaused — the contract is rigged to pause
// the moment the bot buys, (d) the "blacklist escape" — blacklist()
// exists, currently empty, but the bot's address is added after the
// buy so the bot can't sell (this connects to H2.4 sell simulation),
// (e) the "hidden mint" — `mint()` selector exists but the
// access-control pattern isn't recognized (custom role) — fail-closed.

import { decodeAddress } from "./contract-verification";
import type { Address } from "./contract-verification";
export type { Address };

// -------------------------------------------------------------------------
// Standard 4-byte selectors the verifier probes.
// -------------------------------------------------------------------------

export const SEL = {
  // Ownership.
  owner: "0x8da5cb5b",
  transferOwnership: "0xf2fde38b",
  renounceOwnership: "0x715018a6",
  // Mint / burn.
  mint: "0x40c10f19",
  burn: "0x9dc29fac",
  // Pause.
  pause: "0x8456cb59",
  unpause: "0x5c975abb",
  paused: "0x5c975abb",
  setPaused: "0x70a58c5b",
  // Freeze.
  freeze: "0x62c1e8a4",
  freezeAccount: "0x429b06f5",
  unfreeze: "0x3f5b6a8a",
  isFrozen: "0xb0bcb9c3",
  // Blacklist.
  blacklist: "0x0ec1551d",
  blockAccount: "0x2b14cab5",
  unblacklist: "0x5e353336",
  isBlacklisted: "0xfe575a87",
  // Access control.
  hasRole: "0x91d14854",
  getRoleAdmin: "0x91ca9118",
} as const;

// Topic0 of OwnershipTransferred(address,address) — keccak256 of the
// canonical OpenZeppelin event signature.
export const OWNERSHIP_TRANSFERRED_TOPIC =
  "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0";
// Topic0 of RoleGranted(bytes32,address,address).
export const ROLE_GRANTED_TOPIC =
  "0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d";

// -------------------------------------------------------------------------
// Authority source — injectable reader.
// -------------------------------------------------------------------------

export interface TokenAuthoritySource {
  /** Returns deployed bytecode as 0x-prefixed hex. */
  getCode(token: Address): Promise<string>;
  /** eth_call — calldata is 0x-prefixed hex. Returns 0x-prefixed hex. */
  call(token: Address, calldata: string): Promise<string>;
  /** Get logs from-block to latest, filtered by topic0 (and optional topic1). */
  getLogs(token: Address, topic0: string, fromBlock?: number | "earliest"): Promise<AuthorityLog[]>;
}

export interface AuthorityLog {
  /** Log emitter — should equal `token` for direct events; some proxies emit via impl. */
  address: Address;
  topics: string[];
  data: string;
  blockNumber: number;
  /** Transaction index within block. */
  txIndex: number;
  /** Log index within block. */
  logIndex: number;
}

// -------------------------------------------------------------------------
// Manifest — what the caller allows.
// -------------------------------------------------------------------------

export interface TokenAuthorityManifest {
  /** The token address. */
  token: Address;
  /** Addresses permitted to hold any authority surface (owner, minter, pauser, etc.). Empty list = no authority may be held by anyone except address(0) (real renounce). */
  allowedAuthorityHolders: Address[];
  /** Required: real renounce means an OwnershipTransferred event to 0x0 was emitted AND current owner()=0x0. Default true. */
  requireRealRenounce?: boolean;
  /** If true, treat hidden authority (selector exists but access-control pattern unrecognized) as fail-closed. Default true. */
  failClosedOnHidden?: boolean;
  /** If true, allow mint() to exist if mint authority is in allowedAuthorityHolders. Default false — most trading strategies want NO mint authority at all, even allowlisted. */
  allowMintIfAllowlisted?: boolean;
  /** If true, allow pause() to exist if pause authority is in allowedAuthorityHolders. Default false. */
  allowPauseIfAllowlisted?: boolean;
  /** If true, allow freeze/blacklist to exist if authority is in allowedAuthorityHolders. Default false. */
  allowFreezeBlacklistIfAllowlisted?: boolean;
  /** Logger. */
  log?: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
}

// -------------------------------------------------------------------------
// Findings — what the verifier observed.
// -------------------------------------------------------------------------

export type AuthorityState =
  | "not-present"          // selector doesn't exist in bytecode
  | "open"                 // anyone can call (no access-control pattern detected)
  | "held-allowlisted"     // held by an address in allowedAuthorityHolders
  | "held-unknown"         // held by an address NOT in allowedAuthorityHolders
  | "renounced"            // owner()=0x0 AND OwnershipTransferred event emitted
  | "hidden"               // selector exists but access-control pattern unrecognized
  | "paused-currently"     // for pause: contract is currently paused (worse than just being pausable)
  | "unpaused-currently";  // for pause: contract is not currently paused but pausable

export interface AuthorityFinding {
  /** Which surface (mint, freeze, blacklist, pause, ownership-transfer). */
  surface: AuthoritySurface;
  /** Selector(s) detected. */
  selectors: string[];
  /** State of this surface. */
  state: AuthorityState;
  /** Holder address (for held-* states). */
  holder: Address | null;
  /** Detail message. */
  detail: string;
}

export type AuthoritySurface =
  | "mint"
  | "freeze"
  | "blacklist"
  | "pause"
  | "ownership-transfer"
  | "ownership-current";

export interface AuthorityReport {
  ok: boolean;
  reasons: string[];
  findings: AuthorityFinding[];
  /** True if owner() returned 0x0. */
  ownerIsZero: boolean;
  /** True if OwnershipTransferred(to=0x0) event was found. */
  renounceEventFound: boolean;
  /** True if the contract appears to truly have renounced (both conditions). */
  realRenounce: boolean;
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * Check if a 4-byte selector is present in the bytecode. Uses the same
 * PUSH4..EQ heuristic as contract-verification.extractSelectors but
 * returns a single boolean (for a specific selector).
 */
export function selectorPresent(bytecodeHex: string, selector: string): boolean {
  const hex = bytecodeHex.startsWith("0x") ? bytecodeHex.slice(2) : bytecodeHex;
  const sel = selector.startsWith("0x") ? selector.slice(2) : selector;
  const needle = "63" + sel.toLowerCase() + "14";  // PUSH4 sel EQ
  return hex.toLowerCase().includes(needle);
}

/**
 * Decode an ABI-encoded address (last 20 bytes of 32-byte word).
 * Returns null for zero address or malformed input. Re-exports the
 * H2.1 implementation to avoid duplication.
 */
export const decodeAddressWord = decodeAddress;

function decodeBool(returnData: string): boolean | null {
  let hex = returnData.toLowerCase();
  if (hex.startsWith("0x")) hex = hex.slice(2);
  if (hex.length < 64) return null;
  // The first byte's last hex char is the boolean.
  return hex[63] === "1";
}

// -------------------------------------------------------------------------
// The verifier.
// -------------------------------------------------------------------------

export class TokenAuthorityVerifier {
  constructor(private readonly src: TokenAuthoritySource) {}

  async verify(manifest: TokenAuthorityManifest): Promise<AuthorityReport> {
    const log = manifest.log ?? (() => {});
    const reasons: string[] = [];
    const findings: AuthorityFinding[] = [];
    const allowed = new Set(manifest.allowedAuthorityHolders.map(a => a.toLowerCase()));

    let code = "0x";
    try {
      code = await this.src.getCode(manifest.token);
    } catch (e) {
      return {
        ok: false,
        reasons: [`getCode failed: ${(e as Error).message}`],
        findings: [],
        ownerIsZero: false,
        renounceEventFound: false,
        realRenounce: false,
      };
    }

    // --- 1. Current owner ---
    // ownerIsZero is only meaningful when the contract actually has
    // an owner() selector. We track `hasOwnerSelector` separately so
    // the renounce logic doesn't apply to contracts that don't expose
    // ownership at all (e.g. plain ERC-20 with no Ownable).
    const hasOwnerSelector = selectorPresent(code, SEL.owner);
    let ownerIsZero = false;
    let ownerCallReverted = false;
    let currentOwner: Address | null = null;
    if (hasOwnerSelector) {
      try {
        const ret = await this.src.call(manifest.token, SEL.owner);
        currentOwner = decodeAddress(ret);
        ownerIsZero = currentOwner === null;
      } catch {
        // owner() reverted — treat as hidden ownership.
        ownerCallReverted = true;
        findings.push({
          surface: "ownership-current",
          selectors: [SEL.owner],
          state: "hidden",
          holder: null,
          detail: "owner() selector exists but call reverted",
        });
        reasons.push("ownership-current: hidden (owner() reverted)");
      }
    }

    // --- 2. Real renounce check ---
    let renounceEventFound = false;
    try {
      const logs = await this.src.getLogs(manifest.token, OWNERSHIP_TRANSFERRED_TOPIC, "earliest");
      // Look for ANY OwnershipTransferred(_, 0x0) — the second topic (indexed previousOwner)
      // and the data (non-indexed newOwner) — in OZ's event, both are indexed: topic1=previousOwner, topic2=newOwner.
      // We need topic2 === 0x000...000.
      for (const l of logs) {
        if (l.topics.length >= 3) {
          if (/^0x0+$/.test(l.topics[2])) {
            renounceEventFound = true;
            break;
          }
        }
      }
    } catch (e) {
      log("warn", "getLogs for OwnershipTransferred failed", { err: (e as Error).message });
    }
    const realRenounce = ownerIsZero && renounceEventFound;

    if (manifest.requireRealRenounce !== false && hasOwnerSelector && !ownerCallReverted) {
      // Real renounce is required — but only for contracts that
      // actually expose owner(). If a contract has no owner()
      // selector at all, the renounce check doesn't apply (there's
      // nothing to renounce).
      if (!ownerIsZero && currentOwner) {
        if (!allowed.has(currentOwner.toLowerCase())) {
          findings.push({
            surface: "ownership-current",
            selectors: [SEL.owner],
            state: "held-unknown",
            holder: currentOwner,
            detail: `owner is ${currentOwner}, not in allowedAuthorityHolders`,
          });
          reasons.push(`ownership-current: held by unknown address ${currentOwner}`);
        } else {
          findings.push({
            surface: "ownership-current",
            selectors: [SEL.owner],
            state: "held-allowlisted",
            holder: currentOwner,
            detail: `owner is ${currentOwner}, in allowlist`,
          });
        }
      } else if (ownerIsZero && !renounceEventFound) {
        // owner=0x0 but no renounce event — fake renounce.
        findings.push({
          surface: "ownership-current",
          selectors: [SEL.owner],
          state: "held-unknown",
          holder: null,
          detail: "owner()=0x0 but no OwnershipTransferred(_,0x0) event — fake renounce",
        });
        reasons.push("ownership-current: fake renounce (owner=0x0 without event)");
      } else if (ownerIsZero && renounceEventFound) {
        findings.push({
          surface: "ownership-current",
          selectors: [SEL.owner],
          state: "renounced",
          holder: null,
          detail: "owner()=0x0 AND OwnershipTransferred(_,0x0) event found",
        });
      }
    }

    // --- 3. ownership-transfer selector ---
    if (selectorPresent(code, SEL.transferOwnership)) {
      // transferOwnership is a live threat only if the current owner
      // is NOT allowlisted AND NOT real-renounced. If the owner is in
      // the allowlist, the caller trusts them to manage ownership
      // (including handing it to another allowlisted address). If
      // real-renounced, transferOwnership is dead code (only callable
      // by owner=0x0).
      const ownerAllowlisted = !!currentOwner && allowed.has(currentOwner.toLowerCase());
      if (!realRenounce && !ownerAllowlisted) {
        findings.push({
          surface: "ownership-transfer",
          selectors: [SEL.transferOwnership],
          state: "held-unknown",
          holder: currentOwner,
          detail: "transferOwnership() present, owner not allowlisted and not real-renounced — ownership can be moved",
        });
        reasons.push("ownership-transfer: live (no real renounce, owner not allowlisted)");
      } else if (realRenounce) {
        findings.push({
          surface: "ownership-transfer",
          selectors: [SEL.transferOwnership],
          state: "renounced",
          holder: null,
          detail: "transferOwnership() present but ownership truly renounced — dead code",
        });
      } else {
        // owner allowlisted — acceptable.
        findings.push({
          surface: "ownership-transfer",
          selectors: [SEL.transferOwnership],
          state: "held-allowlisted",
          holder: currentOwner,
          detail: "transferOwnership() present, owner allowlisted — caller trusts them with ownership management",
        });
      }
    }

    // --- 4. Mint ---
    if (selectorPresent(code, SEL.mint)) {
      // The mint policy is: block UNLESS allowMintIfAllowlisted=true
      // AND access control is recognizable (hasRole selector) AND
      // current owner is in the allowlist. Any other condition blocks.
      //
      // failClosedOnHidden is a separate flag for TRULY hidden
      // selectors where we can't recognize access control at all.
      // But mint() has a recognizable selector — so when access
      // control is unrecognizable AND allowMintIfAllowlisted=false,
      // the block comes from allowMintIfAllowlisted (the default
      // "no mint allowed" policy), not from failClosedOnHidden.
      const hasAccessControl = selectorPresent(code, SEL.hasRole);
      const ownerAllowlisted = !!currentOwner && allowed.has(currentOwner.toLowerCase());

      if (manifest.allowMintIfAllowlisted && hasAccessControl && ownerAllowlisted) {
        // Explicitly allowed.
        findings.push({
          surface: "mint",
          selectors: [SEL.mint],
          state: "held-allowlisted",
          holder: currentOwner,
          detail: "mint() present, access control via hasRole, owner allowlisted, allowMintIfAllowlisted=true",
        });
      } else {
        // Block. The reason depends on which condition failed.
        let detail: string;
        let state: AuthorityState;
        if (!manifest.allowMintIfAllowlisted) {
          detail = "mint() present but allowMintIfAllowlisted=false (default policy: no mint allowed)";
          state = hasAccessControl ? "held-unknown" : "hidden";
        } else if (!hasAccessControl) {
          detail = "mint() present and allowMintIfAllowlisted=true, but access-control pattern not recognized (no hasRole selector) — can't confirm mint is allowlisted";
          state = "hidden";
        } else {
          // owner not allowlisted
          detail = `mint() present, access control recognized, but owner ${currentOwner ?? "0x0"} not in allowlist`;
          state = "held-unknown";
        }
        findings.push({
          surface: "mint",
          selectors: [SEL.mint],
          state,
          holder: currentOwner,
          detail,
        });
        // Block reason is added UNLESS the caller explicitly opted
        // out of fail-closed AND the only issue is hidden access
        // control (i.e., allowMintIfAllowlisted=true but access
        // control unrecognizable). In that narrow case, the caller
        // has accepted the risk.
        const isNarrowHiddenOptOut =
          manifest.failClosedOnHidden === false &&
          manifest.allowMintIfAllowlisted === true &&
          !hasAccessControl;
        if (!isNarrowHiddenOptOut) {
          reasons.push(`mint: ${detail}`);
        }
      }
    }

    // --- 5. Pause ---
    if (selectorPresent(code, SEL.pause) || selectorPresent(code, SEL.setPaused)) {
      // Check if contract is currently paused.
      let isPaused = false;
      try {
        const ret = await this.src.call(manifest.token, SEL.paused);
        const b = decodeBool(ret);
        if (b !== null) isPaused = b;
      } catch {
        // paused() not callable — treat as not-paused but pausable.
      }
      const state: AuthorityState = isPaused ? "paused-currently" : "unpaused-currently";
      if (isPaused) {
        findings.push({
          surface: "pause",
          selectors: [SEL.pause],
          state,
          holder: currentOwner,
          detail: "contract is CURRENTLY PAUSED",
        });
        reasons.push("pause: contract is currently paused");
      } else {
        if (manifest.allowPauseIfAllowlisted && currentOwner && allowed.has(currentOwner.toLowerCase())) {
          findings.push({
            surface: "pause",
            selectors: [SEL.pause],
            state: "held-allowlisted",
            holder: currentOwner,
            detail: "pause() present, not currently paused, owner allowlisted",
          });
        } else {
          findings.push({
            surface: "pause",
            selectors: [SEL.pause],
            state: "unpaused-currently",
            holder: currentOwner,
            detail: "pause() present, not currently paused, but allowPauseIfAllowlisted=false",
          });
          reasons.push("pause: present (not currently paused) but allowPauseIfAllowlisted=false");
        }
      }
    }

    // --- 6. Freeze / blacklist ---
    const freezeSelectors = [SEL.freeze, SEL.freezeAccount].filter(s => selectorPresent(code, s));
    const blacklistSelectors = [SEL.blacklist, SEL.blockAccount].filter(s => selectorPresent(code, s));

    if (freezeSelectors.length > 0) {
      if (manifest.allowFreezeBlacklistIfAllowlisted && currentOwner && allowed.has(currentOwner.toLowerCase())) {
        findings.push({
          surface: "freeze",
          selectors: freezeSelectors,
          state: "held-allowlisted",
          holder: currentOwner,
          detail: "freeze() present, owner allowlisted",
        });
      } else {
        findings.push({
          surface: "freeze",
          selectors: freezeSelectors,
          state: "held-unknown",
          holder: currentOwner,
          detail: "freeze() present, allowFreezeBlacklistIfAllowlisted=false or owner not allowlisted",
        });
        reasons.push("freeze: present but not allowlisted");
      }
    }

    if (blacklistSelectors.length > 0) {
      if (manifest.allowFreezeBlacklistIfAllowlisted && currentOwner && allowed.has(currentOwner.toLowerCase())) {
        findings.push({
          surface: "blacklist",
          selectors: blacklistSelectors,
          state: "held-allowlisted",
          holder: currentOwner,
          detail: "blacklist() present, owner allowlisted",
        });
      } else {
        findings.push({
          surface: "blacklist",
          selectors: blacklistSelectors,
          state: "held-unknown",
          holder: currentOwner,
          detail: "blacklist() present, allowFreezeBlacklistIfAllowlisted=false or owner not allowlisted",
        });
        reasons.push("blacklist: present but not allowlisted");
      }
    }

    return {
      ok: reasons.length === 0,
      reasons,
      findings,
      ownerIsZero,
      renounceEventFound,
      realRenounce,
    };
  }
}
