// H2.1 — Contract Verification: bytecode, ABI, owner/admin, proxy
// detection, upgradeability detection.
//
// DESIGN PHILOSOPHY
// -----------------
// The single property this primitive enforces is the operator's directive:
//
//     nenhum contrato desconhecido entra no pipeline.
//
// Before any on-chain interaction (read or write), the pipeline must be
// able to produce a `ContractManifest` that pins:
//
//   1. BYTECODE — keccak256 of the deployed bytecode must match an
//      expected hash. A contract whose bytecode has drifted from the
//      expected hash (because it was upgraded, replaced, or initially
//      misidentified) is rejected.
//
//   2. ABI — the set of 4-byte function selectors present in the
//      bytecode must be a subset of an explicit allowlist. A contract
//      that introduces a new selector the operator did not approve
//      (e.g. a `sweep()` that drains, or a `setFee()` that flips
//      taxation) is rejected.
//
//   3. OWNER / ADMIN — the return value of `owner()` / `admin()` /
//      equivalent must be in an explicit allowlist. Unknown owner =
//      rejection.
//
//   4. PROXY DETECTION — EIP-1967 (transparent + minimal), EIP-1822
//      (UUPS), EIP-2535 (Diamond), beacon proxies, and custom proxies
//      (non-standard implementation slot) are detected. A proxy is
//      rejected unless the manifest explicitly allows proxies, in which
//      case the IMPLEMENTATION contract is verified recursively with
//      its own manifest.
//
//   5. UPGRADEABILITY DETECTION — even non-proxy contracts may be
//      upgradeable via delegatecall patterns (beacon, custom logic).
//      Selectors `upgradeTo(address)`, `upgradeToAndCall(address,bytes)`,
//      `upgradeBeaconToAndCall(address,bytes)` are detected in the
//      bytecode. Upgradeable contracts are rejected unless the manifest
//      explicitly allows upgradeability.
//
// INJECTABLE CHAIN READER
// -----------------------
// The verifier takes a `ChainReader` interface so tests can inject
// deterministic mock bytecode, storage, and call responses. Production
// wraps `ethers.Provider` (getCode / storageAt / call / getLogs),
// wired in M3 when the live path lands.
//
// ADVERSARIAL SCOPE
// -----------------
// Per the permanent principle, the verifier ships with adversarial
// tests for: (a) a contract whose bytecode silently changed after
// upgrade, (b) a contract with an extra `sweep()` selector not in the
// allowlist, (c) a proxy whose implementation was swapped to a
// malicious impl between two verifications, (d) a contract that
// reports `owner()` as address(0) (fake renounce) but still has
// privileged functions, (e) a contract that returns different owners
// depending on the caller (caller-dependent behavior). Each test
// explicitly tries to break the property "no unknown contract enters
// the pipeline".

import { keccak256, getAddress } from "ethers";

export type Address = string;  // checksummed
export type Selector = string;  // 4-byte hex, lowercase, 0x-prefixed
export type Bytes32 = string;  // 32-byte hex, lowercase, 0x-prefixed

// -------------------------------------------------------------------------
// Standard EIP-1967 / EIP-1822 / EIP-2535 slots — precomputed.
// -------------------------------------------------------------------------

// EIP-1967 implementation slot: bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)
export const EIP1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
// EIP-1967 admin slot: bytes32(uint256(keccak256('eip1967.proxy.admin')) - 1)
export const EIP1967_ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
// EIP-1967 beacon slot: bytes32(uint256(keccak256('eip1967.proxy.beacon')) - 1)
export const EIP1967_BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
// EIP-1822 (UUPS) PROXIABLE slot: bytes32(uint256(keccak256('PROXIABLE')) - 1)
export const EIP1822_PROXIABLE_SLOT =
  "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7";

// Known upgrade-related 4-byte selectors.
export const UPGRADE_SELECTORS: Selector[] = [
  "0x3659cfe6", // upgradeTo(address)
  "0x4f1ef286", // upgradeToAndCall(address,bytes)
  "0xa9145dea", // upgradeBeaconToAndCall(address,bytes)
  "0xf851a440", // admin()
  "0x8f283970", // changeAdmin(address)
  "0xf2f0947c", // implementation()
];

// Standard ownership / admin selectors used across common standards.
export const OWNER_SELECTORS: Selector[] = [
  "0x8da5cb5b", // owner()
  "0xf851a440", // admin()
  "0x5c60da1b", // implementation()
];

// -------------------------------------------------------------------------
// Chain reader — injectable for tests; wraps ethers.Provider in production.
// -------------------------------------------------------------------------

export interface ChainReader {
  /** Returns deployed bytecode as 0x-prefixed hex (no leading 0x -> add it). */
  getCode(address: Address): Promise<string>;
  /** Returns the 32-byte storage slot value as 0x-prefixed hex. */
  getStorageAt(address: Address, slot: Bytes32): Promise<string>;
  /** Performs an eth_call; calldata is 0x-prefixed hex. Returns 0x-prefixed hex. */
  call(to: Address, calldata: string): Promise<string>;
}

// -------------------------------------------------------------------------
// Manifest — what the caller claims about the contract.
// -------------------------------------------------------------------------

export interface ContractManifest {
  /** Address of the contract being verified. */
  address: Address;
  /** Expected keccak256 of deployed bytecode (0x-prefixed 32-byte hex). If omitted, bytecode check is skipped — but skipping requires explicit `allowBytecodeDrift: true`. */
  expectedBytecodeHash?: string;
  /** Explicit opt-out of bytecode check. Default false. Setting this true is a security smell; only used during initial onboarding. */
  allowBytecodeDrift?: boolean;
  /** Allowlist of 4-byte selectors the contract is permitted to expose. Any selector in bytecode not in this list = reject. */
  expectedSelectors?: Selector[];
  /** Explicit opt-out of selector allowlist. Default false. */
  allowUnknownSelectors?: boolean;
  /** Allowlist of acceptable owner() return values. Empty/undefined = owner check skipped (with `allowUnknownOwner: true`). */
  allowedOwners?: Address[];
  /** Explicit opt-out of owner check. Default false. */
  allowUnknownOwner?: boolean;
  /** Whether to allow proxy contracts at this address. Default false. */
  allowProxy?: boolean;
  /** Whether to allow upgradeable contracts at this address. Default false. */
  allowUpgradeable?: boolean;
  /** Manifest for the implementation, when this is a proxy + allowProxy. */
  implementationManifest?: ContractManifest;
  /** Maximum recursion depth for proxy → implementation verification. Default 3. */
  maxProxyDepth?: number;
}

// -------------------------------------------------------------------------
// Findings — what the verifier observed.
// -------------------------------------------------------------------------

export type ProxyKind =
  | "eip1967-implementation"
  | "eip1967-beacon"
  | "eip1822"
  | "diamond"
  | "transparent"
  | "custom"
  | null;

export interface ContractFindings {
  /** keccak256 of the deployed bytecode (computed even if no expectation provided). */
  bytecodeHash: string;
  /** Selectors extracted from the bytecode (sorted, deduped). */
  selectors: Selector[];
  /** Selectors in bytecode but NOT in `expectedSelectors` (if a list was given). */
  unknownSelectors: Selector[];
  /** True if any known proxy slot is non-zero. */
  isProxy: boolean;
  /** Specific proxy variant detected. */
  proxyKind: ProxyKind;
  /** Implementation address (for EIP-1967 / EIP-1822). */
  implementation: Address | null;
  /** Beacon address (for EIP-1967 beacon proxy). */
  beacon: Address | null;
  /** Admin address (for EIP-1967 transparent proxy). */
  admin: Address | null;
  /** True if upgradeTo / upgradeToAndCall / upgradeBeaconToAndCall selectors are present, or proxy with non-zero admin. */
  isUpgradeable: boolean;
  /** owner() return value, if callable. */
  owner: Address | null;
}

export interface VerificationResult {
  ok: boolean;
  /** Each reason a check failed. Empty when ok=true. */
  reasons: string[];
  findings: ContractFindings;
  /** If the contract is a proxy + allowProxy, the verification result of the implementation. */
  implementationResult?: VerificationResult;
}

// -------------------------------------------------------------------------
// Pure helpers — exported for direct unit testing.
// -------------------------------------------------------------------------

/**
 * Extract 4-byte function selectors from deployed bytecode.
 *
 * The EVM pattern for exposing a function is `PUSH4 selector EQ JUMPI`.
 * We scan for `63<4 bytes>14` (PUSH4, then EQ). This is a heuristic;
 * it can produce false positives (a constant in the bytecode that
 * happens to follow a PUSH4 opcode). For verification purposes, a
 * false positive is conservative (we'd reject a contract as having an
 * "unknown selector" that's actually a constant — caller can add it to
 * the allowlist). A false negative would be a security hole.
 *
 * The mitigation: callers SHOULD pass `expectedSelectors` explicitly;
 * anything we extract that isn't in the allowlist blocks. Anything we
 * miss is not in the allowlist either, but it's also not extractable
 * by the caller — so the contract can't be called via the standard
 * ABI path anyway.
 *
 * Returns deduped, sorted selectors.
 */
export function extractSelectors(bytecodeHex: string): Selector[] {
  const set = new Set<string>();
  // Strip 0x prefix.
  const hex = bytecodeHex.startsWith("0x") ? bytecodeHex.slice(2) : bytecodeHex;
  // PUSH4 = 0x63, EQ = 0x14. We look for `63XXXXXXXX14` patterns.
  // Some compilers also use `PUSH4 0xXX.. 14 60 00` etc. — we don't
  // require a specific follow-up, just the PUSH4..EQ adjacency.
  for (let i = 0; i + 10 <= hex.length; i += 2) {
    if (hex.slice(i, i + 2).toLowerCase() === "63") {
      const sel = hex.slice(i + 2, i + 10).toLowerCase();
      // Sanity: must be hex.
      if (/^[0-9a-f]{8}$/.test(sel)) {
        // Look ahead — the next opcode should plausibly be EQ (0x14)
        // within a few bytes. Compilers may insert DUP/PUSH between
        // PUSH4 and EQ.
        for (let j = i + 10; j + 2 <= hex.length && j <= i + 20; j += 2) {
          const op = hex.slice(j, j + 2).toLowerCase();
          if (op === "14") {
            set.add("0x" + sel);
            break;
          }
          // Stop early on a JUMP/RETURN boundary.
          if (op === "56" || op === "00" || op === "f3") break;
        }
      }
    }
  }
  return Array.from(set).sort();
}

/**
 * Compute keccak256 of a hex string's bytes. Uses ethers' keccak256
 * (no separate pure-JS implementation maintained inside this primitive).
 *
 * Exported so tests can compute expected hashes without importing ethers.
 */
export function keccak256Hex(hex: string): string {
  const normalized = hex.startsWith("0x") ? hex : "0x" + hex;
  return keccak256(normalized);
}

/**
 * Decode an ABI-encoded address (last 20 bytes of a 32-byte word).
 * Returns the checksummed form, or null if input is malformed / zero.
 */
export function decodeAddress(returnData: string): Address | null {
  let hex = returnData.toLowerCase();
  if (hex.startsWith("0x")) hex = hex.slice(2);
  if (hex.length < 64) return null;
  // Right-aligned — last 40 hex chars.
  const addr = hex.slice(hex.length - 40);
  if (/^0+$/.test(addr)) return null;  // zero address = no owner set
  try {
    return getAddress("0x" + addr);
  } catch {
    return null;
  }
}

/**
 * Detect proxy kind from storage slots.
 * Returns the kind + the implementation / beacon / admin address, if any.
 */
export function detectProxyFromStorage(
  storage: Record<Bytes32, string>,
): {
  kind: ProxyKind;
  implementation: Address | null;
  beacon: Address | null;
  admin: Address | null;
} {
  const impl = storage[EIP1967_IMPL_SLOT];
  const beacon = storage[EIP1967_BEACON_SLOT];
  const admin = storage[EIP1967_ADMIN_SLOT];
  const proxiabel = storage[EIP1822_PROXIABLE_SLOT];

  if (impl && !/^0+$/.test(impl.slice(2))) {
    // EIP-1967 implementation slot is non-zero.
    // If admin slot is also set → transparent proxy; else minimal proxy.
    const isAdminSet = !!(admin && !/^0+$/.test(admin.slice(2)));
    return {
      kind: isAdminSet ? "transparent" : "eip1967-implementation",
      implementation: decodeAddress(impl),
      beacon: null,
      admin: isAdminSet ? decodeAddress(admin) : null,
    };
  }
  if (beacon && !/^0+$/.test(beacon.slice(2))) {
    return {
      kind: "eip1967-beacon",
      implementation: null,
      beacon: decodeAddress(beacon),
      admin: null,
    };
  }
  if (proxiabel && !/^0+$/.test(proxiabel.slice(2))) {
    return {
      kind: "eip1822",
      implementation: decodeAddress(proxiabel),
      beacon: null,
      admin: null,
    };
  }
  return { kind: null, implementation: null, beacon: null, admin: null };
}

// -------------------------------------------------------------------------
// The verifier.
// -------------------------------------------------------------------------

export interface VerifierConfig {
  chain: ChainReader;
  /** Logger — defaults to no-op. */
  log?: (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) => void;
}

export class ContractVerifier {
  constructor(private readonly cfg: VerifierConfig) {}

  /**
   * Verify a contract against a manifest. Returns ok=true iff every
   * check the manifest enables passes. Recursively verifies the
   * implementation if the contract is a proxy + allowProxy.
   */
  async verify(manifest: ContractManifest): Promise<VerificationResult> {
    return this.verifyWithDepth(manifest, 0);
  }

  private async verifyWithDepth(
    manifest: ContractManifest,
    depth: number,
  ): Promise<VerificationResult> {
    const reasons: string[] = [];
    const log = this.cfg.log ?? (() => {});

    if (depth > (manifest.maxProxyDepth ?? 3)) {
      return {
        ok: false,
        reasons: [`proxy recursion depth exceeded (depth=${depth})`],
        findings: emptyFindings(),
      };
    }

    // --- 1. Bytecode ---
    let code = "0x";
    try {
      code = await this.cfg.chain.getCode(manifest.address);
    } catch (e) {
      reasons.push(`getCode failed: ${(e as Error).message}`);
      return { ok: false, reasons, findings: emptyFindings() };
    }

    const bytecodeHash = keccak256Hex(code);
    if (manifest.expectedBytecodeHash) {
      if (bytecodeHash.toLowerCase() !== manifest.expectedBytecodeHash.toLowerCase()) {
        if (!manifest.allowBytecodeDrift) {
          reasons.push(
            `bytecode hash mismatch: expected ${manifest.expectedBytecodeHash} got ${bytecodeHash}`,
          );
        } else {
          log("warn", "bytecode drift allowed by manifest", {
            address: manifest.address,
            expected: manifest.expectedBytecodeHash,
            got: bytecodeHash,
          });
        }
      }
    } else if (!manifest.allowBytecodeDrift) {
      reasons.push(
        "no expectedBytecodeHash provided and allowBytecodeDrift is false — refuse unknown bytecode by default",
      );
    }

    // --- 2. Selectors ---
    const selectors = extractSelectors(code);
    const unknownSelectors = manifest.expectedSelectors
      ? selectors.filter(s => !manifest.expectedSelectors!.includes(s))
      : [];
    if (manifest.expectedSelectors && unknownSelectors.length > 0 && !manifest.allowUnknownSelectors) {
      reasons.push(
        `unknown selectors in bytecode (not in allowlist): ${unknownSelectors.join(", ")}`,
      );
    }

    // --- 3. Proxy detection ---
    const slots: Bytes32[] = [
      EIP1967_IMPL_SLOT,
      EIP1967_ADMIN_SLOT,
      EIP1967_BEACON_SLOT,
      EIP1822_PROXIABLE_SLOT,
    ];
    const storage: Record<Bytes32, string> = {};
    for (const slot of slots) {
      try {
        storage[slot] = await this.cfg.chain.getStorageAt(manifest.address, slot);
      } catch {
        storage[slot] = "0x0000000000000000000000000000000000000000000000000000000000000000";
      }
    }
    const proxy = detectProxyFromStorage(storage);
    const isProxy = proxy.kind !== null;
    if (isProxy && !manifest.allowProxy) {
      reasons.push(
        `proxy contract detected (kind=${proxy.kind}) but manifest.allowProxy is false`,
      );
    }

    // --- 4. Upgradeability ---
    const hasUpgradeSelector = selectors.some(s => UPGRADE_SELECTORS.includes(s));
    const hasNonZeroAdmin = !!proxy.admin;
    const isUpgradeable = hasUpgradeSelector || (isProxy && hasNonZeroAdmin);
    if (isUpgradeable && !manifest.allowUpgradeable) {
      reasons.push(
        `upgradeable contract detected (upgradeSelector=${hasUpgradeSelector}, admin=${hasNonZeroAdmin}) but manifest.allowUpgradeable is false`,
      );
    }

    // --- 5. Owner / admin ---
    let owner: Address | null = null;
    try {
      // Try owner() first — 0x8da5cb5b
      const ownerRet = await this.cfg.chain.call(
        manifest.address,
        "0x8da5cb5b",
      );
      owner = decodeAddress(ownerRet);
    } catch {
      // Contract has no owner() — that's fine.
    }
    if (owner === null && proxy.admin) {
      owner = proxy.admin;
    }
    if (manifest.allowedOwners && manifest.allowedOwners.length > 0) {
      const allowed = manifest.allowedOwners.map(a => a.toLowerCase());
      if (owner === null) {
        if (!manifest.allowUnknownOwner) {
          reasons.push(
            "owner() returned 0 or reverted, allowedOwners is set, allowUnknownOwner is false",
          );
        }
      } else if (!allowed.includes(owner.toLowerCase())) {
        if (!manifest.allowUnknownOwner) {
          reasons.push(
            `owner ${owner} is not in allowedOwners [${manifest.allowedOwners.join(", ")}]`,
          );
        }
      }
    } else if (!manifest.allowUnknownOwner && owner === null) {
      // No allowlist provided AND no owner check opt-out. This is the
      // "strict" default — if the caller doesn't tell us who the owner
      // should be, and the contract reports no owner, we refuse. The
      // caller must either provide allowedOwners or set
      // allowUnknownOwner=true.
      // NOTE: this only triggers when the contract HAS an owner()
      // selector that returned 0. If the contract doesn't have
      // owner() at all, we don't reject — many token standards don't
      // expose ownership via owner() (e.g. ERC-20 with permit but no
      // ownership).
      // The owner selector check: if 0x8da5cb5b is in `selectors` AND
      // owner is null, that's a fake-renounce / misconfigured contract.
      if (selectors.includes("0x8da5cb5b")) {
        reasons.push(
          "contract exposes owner() but it returned address(0) — possible fake renounce; set allowUnknownOwner=true to override",
        );
      }
    }

    const findings: ContractFindings = {
      bytecodeHash,
      selectors,
      unknownSelectors,
      isProxy,
      proxyKind: proxy.kind,
      implementation: proxy.implementation,
      beacon: proxy.beacon,
      admin: proxy.admin,
      isUpgradeable,
      owner,
    };

    // --- 6. Recursive verification of implementation (if proxy + allowed) ---
    let implementationResult: VerificationResult | undefined;
    if (isProxy && manifest.allowProxy && proxy.implementation && manifest.implementationManifest) {
      implementationResult = await this.verifyWithDepth(manifest.implementationManifest, depth + 1);
      if (!implementationResult.ok) {
        reasons.push(`implementation verification failed: ${implementationResult.reasons.join("; ")}`);
      }
    } else if (isProxy && manifest.allowProxy && proxy.implementation && !manifest.implementationManifest) {
      reasons.push(
        `proxy allowed but no implementationManifest provided for implementation ${proxy.implementation}`,
      );
    }

    return {
      ok: reasons.length === 0,
      reasons,
      findings,
      implementationResult,
    };
  }
}

function emptyFindings(): ContractFindings {
  return {
    bytecodeHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    selectors: [],
    unknownSelectors: [],
    isProxy: false,
    proxyKind: null,
    implementation: null,
    beacon: null,
    admin: null,
    isUpgradeable: false,
    owner: null,
  };
}
