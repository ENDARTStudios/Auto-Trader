# Hardening Roadmap — Defense-in-Depth Against 30 Attack Vectors

This document maps the operator's "blindagem" mandate (30 attack vectors) to
a phased hardening plan. It is the structural counterpart to `SECURITY.md`:
where `SECURITY.md` inventories regression tests that pin already-fixed
properties, this document inventories attack vectors that are not yet
defended and proposes how to close each gap.

The discipline is the same one this thread consolidated:

1. **Diagnose before fixing** — for each gap, demonstrate the failure mode
   empirically (a test that fails against the current code) before
   implementing the defense.
2. **Structural tests as acceptance criteria** — not best-effort. Each
   hardening phase has explicit test assertions that must pass before the
   phase is marked complete.
3. **`SECURITY.md` for regressions** — once a defense lands, add a REG-NNN
   entry so a future maintainer cannot "simplify" it back into the
   vulnerable shape.
4. **Real-mechanism tests** — live process, real socket, real RPC, not
   pure-function simulations of the defense logic.

### Permanent principle — adversarial cryptographic tests

> **Every new cryptographic implementation must ship with at least one
> test that explicitly attempts to break the promised security property.**

This principle was added after H0.3 (audit log hash-chain) revealed that
`JSON.stringify(entry, sortedKeysArray)` (the replacer-array form) was
silently dropping nested keys inside `payload` from the hash. An attacker
could modify the payload without breaking the chain. The bug was caught
only by the tamper-detection test — not by code inspection, not by the
happy-path tests, not by the chain-linkage tests. Only by the test that
**deliberately tried to break the property the hash chain was supposed to
guarantee**.

The pattern is now mandatory for every cryptographic primitive. Examples:

| Primitive | Adversarial test must demonstrate |
|---|---|
| hash-chain | tampering with a record's payload (including nested fields) breaks verification; deleting a record breaks verification; reordering records breaks verification |
| KDF / encryption | a legacy blob (without version fields) still decrypts only with the correct passphrase; a blob with a manipulated ciphertext fails to decrypt; a blob with a wrong auth tag is rejected |
| key rotation | rotation with the wrong old passphrase fails for ALL blobs (no partial rotation); rotated blobs decrypt with the new passphrase and NOT with the old one; idempotency holds |
| signature | modifying any byte of the signed payload invalidates the signature; signing under a different domain separator does not verify under the expected domain |
| audit log | insertion of a forged entry at any position is detected; removal of the genesis entry is detected; replay of an old entry under a new seq is detected |
| transaction simulation | a simulated revert blocks broadcast; a simulated state diff that diverges from the expected diff blocks broadcast |
| approval cap | an unlimited approval (`type(uint256).max`) is rejected; an approval that exceeds the configured cap is rejected; an approval that exceeds the on-chain balance is rejected |
| RPC quorum | a malicious endpoint returning a wrong chain id, a stale block number, or a wrong balance is detected and quarantined; quorum disagreement blocks the action |

A cryptographic primitive that ships without an adversarial test is
**incomplete by definition** — it has not been proven to actually defend
the property it claims to defend. The hash-chain bug is the canonical
example: the code looked correct, the happy-path tests passed, the
structural tests passed, and the chain was still security theater until
the adversarial test was written.

## Scope — what the app can and cannot defend against

The 30 vectors span three concentric perimeters. The app code can only
defend the innermost two; the outermost requires operational policy,
endpoint hardening, and human controls that no amount of app code can
replace. Conflating the three leads to security theater — defenses that
look like they cover the vector but don't, because the vector operates
outside the app's perimeter.

| Perimeter | What lives here | Defense mechanism | In scope for app code? |
|---|---|---|---|
| **App-internal** | Trade execution, signing, RPC dispatch, contract interaction, portfolio math | Code + tests + regression inventory | **Yes** — fully in scope |
| **App-edge** | HTTP responses, browser embedding, RPC endpoints the app talks to | Headers, CSP, RPC failover, address book | **Yes** — partially in scope |
| **Operational / endpoint** | Operator's machine, CI/CD pipeline, human workflows, contractor access | Policy, hardware keys, procedures, endpoint hardening | **No** — app can SUPPORT (audit logs, address book UI) but cannot DEFEND |

The third perimeter is explicitly out of scope for code, but each vector
in it lists what the app CAN do to support the operational defense. This
is not a dodge — it is a precise boundary. Pretending the app can defend
against deepfakes or clipboard hijackers would be the exact pattern this
thread has rejected: "documenting the intention is not the same as
proving the code respects the intention." The app cannot prove anything
about the operator's clipboard; only the endpoint can.

---

## Threat Model — 30 Vectors in 8 Layers

### Layer 0: Foundational — key management & crypto (IN FLIGHT via Phase 1)

| Vector | Existing mitigation | Gap | Defense |
|---|---|---|---|
| **Comprometimento de Chaves Operacionais** | Signer isolation (Phase 1: M1 done, M2.x in progress) — keys live in a separate process, not in the Next.js process | M2.3+ not yet complete; keys still touched by in-process `WalletVault` until M2.3 moves it | Complete M2.3 (move `WalletVault` to signer process) + M3 (sign RPC) + M4 (writer lease) |
| **Gestão de Chaves em Hot Wallets** | 50/50 cold reserve split (profit → 50% USDC cold reserve, 50% reinvested); signer isolation limits hot-key exposure to the signer process | Cold reserve is a DB row, not an actual cold wallet; no HSM integration | H0-future: actual cold-storage workflow (manual withdrawal to hardware wallet); document that "cold reserve" = "not auto-traded", not "air-gapped" |
| **Erros de Implementação Criptográfica** | Uses `ethers` v6 (audited lib); no custom crypto; AES-GCM via Node `crypto` for vault encryption | Constant-time comparison not used for passphrase verification; key zeroization incomplete until M2.3 | M2.3 adds zeroize-on-disconnect; H7 adds property tests for crypto paths |

### Layer 1: MEV / On-chain adversarial (GAP — no defense exists)

| Vector | Existing mitigation | Gap | Defense |
|---|---|---|---|
| **Front-Running Bots** | None — slippage hardcoded at 30bps in paper-trader.ts for paper mode; live DEX path has no MEV protection | No private mempool, no commit-reveal, no slippage tolerance configuration | H1: integrate Flashbots Protect (or chain-equivalent: Merlin for Base, MEV-Share); configurable slippage; order splitting |
| **Sandwich Bots** | None — same gap as front-running | No private mempool, no mempool privacy | H1: private mempool submission (same as front-running); sandwich-resistant routing (split across blocks); slippage tight enough to make sandwich unprofitable |
| **Sniper Bots** | None — the bot IS a sniper-style scanner (rising-tokens.ts), but has no defense AGAINST being sniped by faster bots when it buys | No priority fee strategy, no private mempool | H1: private mempool for entries; configurable priority fee; "wait N blocks" confirmation before treating a new token as tradeable |
| **Arbitrage Bots** | None — the bot's own exits (TP/SL) are visible on-chain if using limit orders; marketable limit orders can be front-run by arb bots | No defense against arb bots extracting value from the bot's own predictable exits | H1: randomize exit timing (jitter); use TWAP for exits; avoid predictable TP/SL that arb bots can target |

**H1 acceptance criteria (structural):**
- A test that simulates a sandwich attack (buy → victim buy → sell) against
  the bot's order flow, and asserts the bot's order was submitted via the
  private mempool path (not the public mempool), OR the slippage tolerance
  rejected the sandwiched execution.
- A test that asserts slippage tolerance is configurable and enforced (a
  fill beyond tolerance is reverted, not silently accepted).
- A test that asserts exit timing has jitter (not deterministic), so arb
  bots cannot predictably target the bot's exits.

### Layer 2: Token / Contract fraud (PARTIAL — scam-detector covers some)

| Vector | Existing mitigation | Gap | Defense |
|---|---|---|---|
| **Honeypot** | scam-detector sub-scorer (turnover + liquidity check) — scores 0-100, blocks below threshold | Only checks buy-side liquidity; doesn't simulate sell (the actual honeypot test) | H2: integrate GoPlus/honeypot-is API for sell-simulation; extend scam-detector with a "can actually sell" sub-scorer |
| **Rug Pull** | scam-detector sub-scorers (liquidity lock via DexScreener, holder concentration, dev wallet %) | Doesn't verify mint authority, doesn't check if LP is actually locked (only DexScreener's reported lock) | H2: on-chain LP lock verification (call the lock contract); mint authority check; transfer-owner check |
| **Smart Contract Exploits** | scam-detector contract sub-scorer (verified source, mint function, owner privileges) | No pre-trade simulation; no function-selector allowlist for the swap router | H2: pre-trade simulation via fork (tenderly or local fork); allowlist of permitted router function selectors; reject unknown selectors |
| **Unlimited Approval Drain** | None — no approval management code exists (paper mode only currently) | When live DEX trading lands, the default ERC-20 `approve(max)` pattern is a known drain vector | H2: exact-amount approvals (approve only the swap amount); auto-revoke after swap completes; approval tracking + expiry |
| **Liquidity Mining Frauds** | None — no staking/farming code exists | If staking is ever added, reward-token legitimacy + staking contract audit needed | H2-future: if staking is added, require staking contract audit + reward token legitimacy (is the reward token itself a scam?) |
| **Ataques de "First Depositor"** | None — no vault share code exists | If the bot ever deposits into yield vaults, first-depositor inflation attack applies | H2-future: if vault deposits are added, check vault share/totalSupply ratio; prefer vaults with virtual shares (ERC-4626 with dead shares) |

**H2 acceptance criteria:**
- A test that asserts approvals are exact-amount (not `type(uint256).max`),
  with an auto-revoke confirmation after the swap.
- A test that asserts a known-honeypot token (synthetic fixture: a contract
  that buys succeed but sells revert) is rejected by the extended
  scam-detector before the order is placed.
- A test that asserts pre-trade simulation rejects orders that would revert
  on-chain (catches logic errors + reentrancy traps before they cost gas).

### Layer 3: Signature / Approval hygiene (GAP — no signing UX exists yet)

| Vector | Existing mitigation | Gap | Defense |
|---|---|---|---|
| **Signature Phishing** | None — no signing UX exists (signer isolation handles the signing, but the operator approves what to sign via the dashboard) | When the operator approves a sign request, a phishing payload (e.g., `permit` signature that grants unlimited allowance) looks identical to a legitimate swap | H3: EIP-712 typed-data display (human-readable signing payloads); reject raw `personal_sign` / `eth_sign`; domain separation; warning on `permit`-shaped payloads |
| **Revogação Inconsistente de Permissões** | None — no approval tracking | Approvals granted and forgotten are a persistent drain vector | H3: approval registry (DB table tracking every active approval); auto-revoke cron; dashboard view of open approvals |

**H3 acceptance criteria:**
- A test that asserts the signing path rejects `personal_sign` and
  `eth_sign` (only EIP-712 typed data is permitted).
- A test that asserts a `permit`-shaped payload triggers an explicit
  warning in the approval UI (not a silent accept).
- A test that asserts the approval registry tracks every approval and the
  auto-revoke cron revokes expired ones.

### Layer 4: Infrastructure (GAP — single RPC, no oracle aggregation)

| Vector | Existing mitigation | Gap | Defense |
|---|---|---|---|
| **Dependência de RPC Centralizados** | None — single RPC endpoint per chain (configured in config.ts) | Single RPC = single point of failure + single point of censorship | H4: multi-RPC failover (primary + secondary + tertiary); health-checked; automatic failover; RPC diversity score (different providers, not just different endpoints of same provider) |
| **Manipulação de Oráculos** | None — uses DexScreener spot price (already a form of spot oracle, not TWAP) | Spot price is manipulable via flash loans; no deviation check between sources | H4: TWAP for price decisions (not spot); multi-source aggregation (DexScreener + on-chain pool + CEX price for cross-listed); circuit breaker on deviation > X% |
| **Comprometimento de CI/CD** | Partial — pre-push hook runs `test:ci` (REG-004); branch protection status unknown | No signed commits; no SLSA provenance; no reproducible build verification | H4: GPG/Sigstore-signed commits; SLSA Level 2+ provenance; reproducible build check in CI |
| **Supply Chain Attacks** | Partial — `package-lock.json` exists; npm audit possible | No dependency pinning enforcement; no SBOM; no integrity check on postinstall scripts (ironic, given the hook itself runs on postinstall) | H4: `npm ci` enforcement (no `npm install` in CI); pinned dependencies with integrity hashes; SBOM generation; `npm audit` as gate |

**H4 acceptance criteria:**
- A test that asserts RPC failover works: when the primary RPC is
  unreachable, the secondary is used within N seconds, with a logged notice.
- A test that asserts a price deviation > X% between sources triggers the
  circuit breaker (trade is not placed).
- A test that asserts `npm ci` (not `npm install`) is the install command
  in CI, and that the lockfile integrity is verified.

### Layer 5: Privacy / Browser (GAP — no CSP, no frame protection)

| Vector | Existing mitigation | Gap | Defense |
|---|---|---|---|
| **Vazamento de Privacidade via RPC** | Partial — per-IP rate limiting (REG-002) limits abuse, but RPC payloads themselves can leak the operator's positions/strategy to the RPC provider | RPC provider sees every call (balances, pending txs) | H5: prefer private RPCs (Infura with privacy, Alchemy with privacy); batch requests to reduce signal; avoid polling patterns that reveal strategy |
| **Injeção de Provider em Iframes** | None — no CSP, no X-Frame-Options, no frame-ancestors | Dashboard can be iframed by a malicious page, which can then postMessage-inject a fake provider | H5: `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'` in Next.js middleware; reject `window.opener` access; `Cross-Origin-Opener-Policy: same-origin` |

**H5 acceptance criteria:**
- A test that asserts the dashboard response includes `X-Frame-Options: DENY`
  and `Content-Security-Policy: frame-ancestors 'none'` headers.
- A test that asserts a cross-origin `window.open` to the dashboard cannot
  access `window.opener` (COOP header present).

### Layer 6: Address hygiene (GAP — no address book)

| Vector | Existing mitigation | Gap | Defense |
|---|---|---|---|
| **Address Poisoning** | None — no address book; operator types/pastes addresses | Attacker sends a dust transaction from an address that looks similar to a known counterparty; operator later pastes the wrong address from transaction history | H6: address book with verified entries (checksummed, ENS-resolved, manually confirmed); new-address warning (any send to an address not in the book requires explicit confirmation); clipboard re-display (pasted addresses are re-shown for confirmation before submission) |

**H6 acceptance criteria:**
- A test that asserts a send to an address NOT in the address book triggers
  the new-address confirmation flow (not a silent send).
- A test that asserts a pasted address is re-displayed for confirmation
  (not submitted directly from clipboard).

### Layer 7: Logic correctness (PARTIAL — risk-manager limits blast radius)

| Vector | Existing mitigation | Gap | Defense |
|---|---|---|---|
| **Reentrância** | N/A — the bot doesn't deploy its own contracts; reentrancy is a concern for the contracts it INTERACTS with | No reentrancy check on the swap router side (but this is the router's problem, not ours) | H7: pre-trade simulation (H2) catches reentrancy traps; no custom contracts to protect |
| **Erros de Lógica** | Risk-manager (5 circuit breakers limit blast radius); test-vault.ts (20 scenarios) | No property tests / invariant tests for portfolio math (profit split, reserve cut, drawdown calc) | H7: property-based tests for portfolio math (fast-check); invariant tests (e.g., "sum of all positions + balance + reserve = initialCapital + realizedPnl" must always hold) |

**H7 acceptance criteria:**
- A property test that runs 1000 randomized trade sequences and asserts
  the portfolio invariant (sum of positions + balance + reserve = initial +
  realizedPnl) holds after every operation.
- A property test that asserts the 50/50 split is exact (no rounding loss).

### Layer 8: Operational / endpoint (OUT OF SCOPE for app code)

These vectors operate outside the app's perimeter. The app cannot defend
against them — only the operator's endpoint, CI/CD pipeline, and human
workflows can. Listing them here to be explicit about the boundary.

| Vector | Why it's out of scope | What the app CAN do to support |
|---|---|---|
| **Fake Support** | Attacker impersonates support via email/Discord/Telegram. The app cannot verify who is messaging the operator. | Dashboard prominently displays the official support channel; "verify you are talking to us" notice |
| **Airdrop Scams** | Attacker sends fake airdrop; operator connects wallet to claim; wallet drained. The app doesn't claim airdrops. | Airdrop-claim is not a feature; if ever added, require address allowlist + contract audit |
| **Clipboard Hijackers** | Malware on operator's machine replaces copied addresses. The app cannot see the clipboard before paste. | H6 clipboard re-display (pasted addresses re-shown for confirmation) catches this AT THE APP BOUNDARY — the malware replaced the clipboard, but the app shows the operator what was actually pasted before submitting |
| **Infostealers** | Malware steals cookies, session tokens, wallet files from the operator's machine. The app cannot detect malware. | Short session TTL; re-auth for sensitive actions; hardware key support (FIDO2) for dashboard auth |
| **Deepfakes e Áudio Sintético** | Attacker uses deepfake audio/video to impersonate the operator or a colleague, authorizing a transfer. The app cannot verify the identity of someone speaking. | Out of scope. Operational policy: no authorization via voice/video; all authorizations go through the dashboard with MFA |
| **Phishing Hiper-personalizado** | Attacker uses OSINT to craft a targeted phishing message. The app cannot filter the operator's inbox. | Out of scope. Operational policy: security awareness training; hardware keys; dashboard MFA |
| **Ameaças Internas e Contratados** | A contractor with legitimate access goes rogue. The app cannot detect intent. | Audit logs (every action logged with actor + timestamp); least-privilege roles; access revocation workflow; offboarding checklist |

**The boundary is load-bearing.** If a future maintainer tries to "defend
against deepfakes" inside the app code, they will produce security theater
— code that looks defensive but cannot actually detect a deepfake. The
honest answer is operational policy + hardware keys + MFA, none of which
live in this repo. The app's job is to SUPPORT those controls (audit logs,
MFA, short sessions) not to REPLACE them.

---

## Phased Roadmap

### H0: Complete foundational (parallel to M2.3, M3, M4) — ✓ COMPLETE
- Finish signer isolation: M2.3 (move WalletVault) → M3 (sign RPC) → M4 (writer lease)
- This fully closes Layer 0 (Operational Key Compromise, Hot Wallet Key Management, Cryptographic Implementation Errors via zeroize-on-disconnect)
- **No new hardening work starts until H0 is done** — Layer 0 is the foundation that H1-H7 build on. Building MEV defenses on top of a non-isolated signer would be rework.
- **STATUS**: H0.1 (KDF + derivation parameters audit), H0.2 (secret storage audit), H0.3 (audit log hash-chain), H0.4 (key rotation / versioning), H0.5 (cryptographic guarantees review) — all complete. CI gate: 9 files / 78 checks. Critical hash-chain bug (JSON.stringify replacer-array dropping payload keys) caught + fixed during H0.3 testing. docs/CRYPTO.md and SECURITY.md H0 section written.

### H1: Transaction lifecycle hardening (Layers 1+2+4) — ✓ COMPLETE
After H0 closed the foundational crypto base, H1 hardens the entire
transaction lifecycle: from RPC fan-out, through pre-broadcast
simulation, to approval hygiene and MEV baseline. H1 deliberately
collapses what the original roadmap had as separate H1 (MEV), H2
(simulation + approvals), and H4 (RPC failover) into a single
hardening pass — the rationale is to keep the entire on-chain
communication + execution layer hardened as one perimeter before any
new signer feature (M3/M4) lands on top of it.

**STATUS** (Jul 15 2026): all four subphases complete.
- H1.1 RPC Resilience — `src/lib/chain/rpc-resilience.ts` —
  `QuorumRpcClient` with quorum, health score, failover, circuit
  breaker. 46 assertions across 16 scenarios. Bug caught: double-
  counting in `recordFailure`.
- H1.2 Transaction Simulation — `src/lib/chain/simulation-gate.ts` —
  `SimulationGate` with revert detection, state-diff comparison,
  tolerance-bounded amount checks, gas cap. 46 assertions across 14
  scenarios.
- H1.3 Approval Hardening — `src/lib/chain/approval-hardening.ts` —
  `ApprovalGate` with cap enforcement, unlimited-approval hard block,
  over-approval block, ledger + revocation. 36 assertions across 15
  scenarios. Bug caught: cap-vs-overapproval ordering.
- H1.4 MEV Baseline — `src/lib/chain/mev-baseline.ts` —
  `computeSlippageLimit`, `checkSlippage`, `detectSandwich`,
  `Relay` interface + `PublicMempoolRelay` + `PrivateRelayStub`.
  47 assertions across 16 scenarios.

CI gate: **13 files / 253 checks** (was 9 files / 78 checks at H0 close).
Each subphase ships with adversarial tests per the permanent principle.
The hardened primitives are NOT yet wired into any production code path
— they wait for M3 to consume them, ensuring the live-trading path is
born hardened rather than retrofitted.

H1 subphases (per operator mandate):
- **H1.1 — RPC Resilience**: multi-RPC with quorum; per-endpoint health
  score; automatic failover; per-RPC circuit breaker.
- **H1.2 — Transaction Simulation**: mandatory simulation before any
  broadcast; comparison between expected and simulated state diff;
  automatic block on divergence.
- **H1.3 — Approval Hardening**: approval inventory; maximum approval
  cap; automatic revocation when possible; hard block on unlimited
  approvals (`type(uint256).max`).
- **H1.4 — MEV Baseline**: abnormal slippage detection; dynamic
  slippage limit; sandwich detection via simulation; abstraction
  prepared for private relays (Flashbots / Merlin / MEV-Share) WITHOUT
  depending on them yet.

Acceptance criteria (structural + adversarial, per the permanent
principle above):
- RPC quorum test: a malicious endpoint returning wrong chain id /
  stale block / wrong balance is detected and quarantined; quorum
  disagreement blocks the action.
- Simulation test: a simulated revert blocks broadcast; a state-diff
  divergence blocks broadcast.
- Approval test: an unlimited approval is rejected; an approval
  exceeding the cap is rejected; an approval exceeding the on-chain
  balance is rejected.
- MEV test: a sandwich pattern (front-run + back-run around the
  victim tx) is detected from simulation; abnormal slippage blocks
  broadcast.
- Each subphase ships with at least one adversarial test per the
  permanent principle.

### H2: Contract interaction hardening (Layer 2) — ✓ COMPLETE
After H1 hardened the transaction lifecycle (RPC, simulation, approvals,
MEV baseline) as pure primitives, H2 hardens the **on-chain read path**
that runs BEFORE any transaction is built: every contract the bot is
about to interact with must be verified, every liquidity pool must be
checked structurally, every token's authority model must be inspected,
and every buy must be paired with a sell simulation. The criterion is
the operator's:

> nenhum contrato desconhecido entra no pipeline.

H2 deliberately does NOT introduce real broadcast, real signing,
Flashbots, MEV Blocker, SUAVE, bundles, or private mempool — those
belong to M3/M4 when a real execution path exists. H2 keeps the
operational surface minimal while each contract-interaction defense is
validated independently.

**STATUS** (Jul 15 2026): all five subphases complete.
- H2.1 Contract Verification — `src/lib/chain/contract-verification.ts`
  — `ContractVerifier` with bytecode hash, selector allowlist,
  owner/admin allowlist, proxy detection (EIP-1967/1822/beacon),
  upgradeability detection. 59 assertions across 18 scenarios.
- H2.2 Liquidity Verification — `src/lib/chain/liquidity-verification.ts`
  — `LiquidityVerifier` with LP lock, lock duration, locked %,
  multi-pool consistency, removable-liquidity detection. 46 assertions
  across 16 scenarios.
- H2.3 Token Authority Verification — `src/lib/chain/token-authority.ts`
  — `TokenAuthorityVerifier` with mint/freeze/blacklist/pause authority,
  ownership-transfer liveness, real-renounce verification. 41 assertions
  across 16 scenarios. Bugs caught: `ownerIsZero` initialization;
  `transferOwnership` blocking allowlisted owners; mint policy not
  independently blocking when access control hidden.
- H2.4 Sell Simulation — `src/lib/chain/sell-simulation.ts` —
  `SellSimVerifier` runs paired buy+sell simulations, enforces buy
  succeeds + sell succeeds + tax match + exit non-zero + slippage
  acceptable. 42 assertions across 16 scenarios. Bug caught: slippage
  measured against raw expected instead of expected-after-tax.
- H2.5 Cross-cutting adversarial — `scripts/test-h2-adversarial.ts` —
  enumerates the 6 operator-mandated scenarios with cross-references;
  adds the missing "owner muda durante execução" scenario. 17
  assertions across 6 scenarios.
- H2.6 Integration Gate — `src/lib/chain/pipeline.ts` + `scripts/test-h2-integration-gate.ts`
  — `Pipeline` composer class chaining all 8 gates in the mandated
  order (RPC → Simulation → Contract → Liquidity → Authority →
  Sell-Sim → Approval → MEV → Signer). Proves six composition
  properties: order, short-circuit, original-reason-preservation,
  audit-exactly-once, signer-gating, no-bypass. 119 assertions across
  17 scenarios (1 happy + 9 per-gate + 7 adversarial). Zero bugs
  caught — expected for a composition layer; the test suite's value is
  regression guard for future changes.

CI gate: **19 files / 577 checks** (was 18 files / 458 checks at H2
close — H2.6 added 1 file and 119 checks). Each subphase ships with
adversarial tests per the permanent principle. Three real bugs caught
during testing — all would have been security-affecting in production
and none were caught by happy-path tests. The hardened primitives are
NOT yet wired into any production code path — they wait for M3 to
consume them, ensuring the live-trading path is born hardened rather
than retrofitted.

H2 subphases (per operator mandate):
- **H2.1 — Contract Verification**: bytecode expected; ABI expected;
  owner/admin known; proxy detection; upgradeability detection. No
  unknown contract enters the pipeline.
- **H2.2 — Liquidity Verification**: LP locked; lock duration; locked
  percentage; multiple pools; liquidity removable.
- **H2.3 — Token Authority Verification**: mint authority; freeze
  authority; blacklist; pausability; ownership transfer; renounce real.
- **H2.4 — Sell Simulation**: buy succeeds; sell succeeds; taxes
  expected vs. observed; exit possible; slippage acceptable. Covers
  most modern honeypots.
- **H2.5 — Adversarial Tests** (per permanent principle): LP removed
  between blocks; owner changes during execution; proxy changes
  implementation; sell passes on first simulation and fails on the
  second; taxes change after buy; contract changes behavior per caller.
- **H2.6 — Integration Gate** (operator-directed): prove that all H1+H2
  gates compose correctly when chained in the mandated order. Adds NO
  new functionality — only integration. Pipeline order: RPC →
  Simulation → Contract Verification → Liquidity Verification →
  Authority Verification → Sell Simulation → Approval Gate → MEV Gate
  → Signer. Each gate failure short-circuits; the failing gate's
  original reason is preserved verbatim; exactly one audit event is
  written per `process()` call; the signer is invoked iff every gate
  passes. Adversarial: bypass attempt (no `skipGate` option exists);
  double simultaneous failure (first-failure-wins); corrupted state
  between gates (each gate receives its own manifest, no shared
  mutation); audit exactly-once on both success and exception paths.

Acceptance criteria (structural + adversarial, per permanent principle):
- Contract verification: an unknown bytecode / unknown ABI / unknown
  owner / proxy / upgradeable contract is rejected before any
  interaction.
- Liquidity verification: a pool with unlocked LP, LP locked for < min
  duration, LP removable by an unknown account, or duplicated shallow
  pools is rejected.
- Token authority verification: a token with active mint / freeze /
  blacklist / pause authority, fake renounce (owner set to address(0)
  via custom logic, not real Ownable.renounceOwnership), or ownership
  transferable to an arbitrary address is rejected.
- Sell simulation: a token where buy succeeds but sell reverts, taxes
  differ from expected, exit is blocked, or slippage exceeds the
  dynamic limit is rejected.
- Each subphase ships with at least one adversarial test per the
  permanent principle; H2.5 enumerates the cross-cutting adversarial
  scenarios that span multiple subphases (proxy swap affects both H2.1
  and H2.4; owner change affects both H2.2 and H2.3; etc.).

### H3: Signature hygiene (Layer 3)
- EIP-712 typed-data display
- Approval registry + auto-revoke cron
- Acceptance criteria: 3 structural tests (personal_sign rejection, permit warning, auto-revoke)

### H4: Infrastructure hardening (Layer 4)
- Multi-RPC failover
- TWAP + multi-source price aggregation
- Signed commits + SLSA provenance
- `npm ci` enforcement + SBOM
- Acceptance criteria: 3 structural tests (RPC failover, deviation circuit breaker, lockfile integrity)

### H5: Privacy / Browser (Layer 5)
- CSP + X-Frame-Options + COOP headers
- Private RPC preference
- Acceptance criteria: 2 structural tests (frame-ancestors header, COOP header)

### H6: Address hygiene (Layer 6)
- Address book with verified entries
- New-address confirmation flow
- Clipboard re-display
- Acceptance criteria: 2 structural tests (new-address gate, clipboard re-display)

### H7: Logic correctness (Layer 7)
- Property-based tests for portfolio math
- Invariant tests
- Acceptance criteria: 2 property tests (portfolio invariant, split exactness)

### H8: Operational support (Layer 8) — app-side support only
- Audit log enhancement (actor + timestamp on every action)
- MFA for dashboard
- Short session TTL
- Hardware key support (FIDO2)
- Offboarding checklist (documentation, not code)
- **No acceptance criteria in the structural-test sense** — these are features, not regressions. The "test" is that the operational policy exists and is followed.

---

## Sequencing Recommendation (operator-directed, post-H0)

1. **H0 ✓** — Foundational hardening complete (KDF, secret storage, audit hash-chain, key rotation, crypto guarantees).
2. **H1 ✓** — Transaction lifecycle hardening (RPC resilience, simulation, approvals, MEV baseline). **NO new signer features between H1 and H2** — keep the surface minimal while the entire on-chain communication + execution perimeter is hardened.
3. **H2 ✓** — Contract interaction hardening (contract verification, liquidity verification, token authority, sell simulation, cross-cutting adversarial).
4. **H2.6** — Integration Gate (operator-directed): prove the H1+H2 primitives compose correctly when chained in the mandated order. No new functionality — only integration. **M3 cannot start until H2.6 is green**; M3 then becomes pure orchestration of an already-validated pipeline.
5. **M3** — Sign RPC (now lands on a hardened + integration-validated base).
6. **M4** — Writer lease.
7. **H3-H8** — Subsequent hardening phases (signature hygiene, infra, privacy, address hygiene, logic, operational support).

The previous recommendation (M2.3 → M3 → M4 → H1+H2 in parallel) is
superseded. The operator's directive after H0 closed is explicit:
**harden H1 → H2 first, then M3/M4 land on a hardened base**. This
avoids the rework of bolting MEV defenses onto a live trading path
that already exists.

Each phase produces:
- Code (the defense)
- Tests (structural, real-mechanism, with the 5-assertion pattern where applicable)
- `SECURITY.md` REG-NNN entry (pinning the defense against future simplification)
- `worklog.md` entry (following the established template)

The full roadmap is ~8 phases over an extended period. Each phase is
self-contained and can be reviewed + approved independently, matching the
increment discipline this thread has used for Phase 1 (M1 → M2.1 → M2.2 →
M2.3 → M3 → M4).

---

## Out-of-Scope Register (List 1 — original 30 vectors)

The following items from the first mandate are explicitly OUT OF SCOPE
for app code, with the boundary documented above (Layer 8):

- Fake Support (operational policy + dashboard notice)
- Airdrop Scams (not a feature; if added, require allowlist)
- Infostealers (endpoint security + short sessions + hardware keys)
- Deepfakes and Synthetic Audio (operational policy: no voice/video authorization)
- Hyper-personalized Phishing (operational policy + security awareness)
- Insider Threats and Contractors (operational policy + audit logs + least privilege)

This is not a refusal to address them — it is a precise statement that
these vectors require controls outside this repo. The app will SUPPORT
them (audit logs, MFA, hardware key support in H8) but cannot DEFEND
against them alone. Conflating the two would be the exact "documenting
the intention is not the same as proving the code respects the intention"
pattern this thread has rejected.

---

## Extended Threat Model — List 2 (traditional cybersecurity + AI vectors)

The operator issued a second mandate with ~46 additional vectors. After
deduplication (several items were listed 2-3 times within the list) and
cross-referencing against List 1 (Supply Chain, Falhas Criptográficas,
Deepfakes, Pipeline de Build, Recrutamento de Insider already appear in
Layers 4, 0, 8 above), ~30 genuinely new vectors remain. They fall into
6 new layers:

### Layer 9: Web application security (OWASP Top 10:2025) — IN SCOPE

| Vector | Existing mitigation | Gap | Defense |
|---|---|---|---|
| **Broken Access Control** | NextAuth session check on API routes (partial) | No RBAC; no object-level authorization (IDOR); admin vs operator not distinguished | H9: RBAC (admin / operator / viewer roles); object-level authz on every DB query (not just route-level); deny by default |
| **SQL Injection** | Prisma parameterized queries (mitigates by construction) | Raw queries if any exist need audit; no SQL injection in Prisma path | H9: audit for `$queryRaw` / `$executeRaw` usage; ban raw SQL unless reviewed; structural test that asserts parameterization |
| **XSS** | React auto-escaping in JSX (mitigates by construction) | `dangerouslySetInnerHTML` if used anywhere; user-generated content (scam reports, log messages) rendered unsafely | H9: audit for `dangerouslySetInnerHTML`; CSP with `script-src 'self' 'nonce-...'`; sanitize user content before storage |
| **Security Misconfiguration** | Partial — `.env` for secrets, `NODE_ENV` check | No security headers audit; no CORS policy; default credentials check; debug mode in prod | H9: Next.js middleware for security headers (HSTS, X-Content-Type-Options, Referrer-Policy); CORS allowlist; production config audit |
| **OWASP Top 10:2025 (broad)** | (encompasses all above + below) | No systematic OWASP compliance review | H9: run OWASP ZAP / Burp scan against the dashboard; remediate findings |

**H9 acceptance criteria:**
- A test that asserts every API route checks authorization (not just authentication) — no IDOR (object-level access control).
- A test that asserts no `$queryRaw` / `$executeRaw` exists without parameterization (grep-based gate).
- A test that asserts security headers are present on every response (HSTS, X-Content-Type-Options, CSP, Referrer-Policy).
- A test that asserts `dangerouslySetInnerHTML` is not used without explicit sanitization.

### Layer 10: Identity & Account security — IN SCOPE (dashboard auth)

| Vector | Existing mitigation | Gap | Defense |
|---|---|---|---|
| **Identity Takeover / ATO** | NextAuth with credentials provider | No MFA; no session device binding; no anomaly detection on login | H10: MFA (TOTP or FIDO2); session device fingerprinting; login anomaly alerts (new geo, new device, impossible travel) |
| **Credential Stuffing** | NextAuth rate limiting (if configured) | No breach-password check (HIBP API); no lockout after N failures | H10: rate limit login per IP + per account; lockout after 5 failures; HIBP API check on password set/change |
| **Identidade Digital Falsa / Identidades Sintéticas** | None | No identity verification for dashboard access (single-operator assumption) | H10: if multi-operator ever added, require identity proofing; for single-operator, document the assumption + enforce hardware key |

**H10 acceptance criteria:**
- A test that asserts login rate limiting works (N failures → lockout).
- A test that asserts MFA is enforced (no session without second factor).
- A test that asserts session device fingerprinting rejects a session from a new device without re-auth.

### Layer 11: Availability / DDoS — PARTIALLY IN SCOPE

| Vector | Existing mitigation | Gap | Defense |
|---|---|---|---|
| **DDoS volumétrico** | None (single host, Caddy reverse proxy) | No CDN/WAF in front; single host = single point of failure | Out of scope for app code. Infra: CDN (Cloudflare) in front, geographic rate limiting. App-side: graceful degradation under load (shed non-critical requests) |
| **DDoS de aplicação** | Per-IP rate limiting (REG-002) on vault endpoints | No rate limiting on other API routes; no request complexity budget | H11: rate limit ALL API routes (not just vault); request complexity budget; slow-loris protection (request timeout) |
| **Monocultura da Internet** | Next.js + Node (common stack) | Dependency monoculture (all Node) is an industry-level concern, not app-level | Out of scope. Operational: diversify critical infra across providers |

**H11 acceptance criteria (app-side only):**
- A test that asserts every API route has a rate limit configured.
- A test that asserts request timeout is enforced (no slow-loris hang).
- A test that asserts the app degrades gracefully under load (returns 503, not crash).

### Layer 12: Ransomware & Extortion — OUT OF SCOPE (endpoint/operational)

| Vector | Why out of scope | App-side support |
|---|---|---|
| **Ransomware e Extorsão Digital** | Endpoint threat; app cannot detect or prevent ransomware | Backups (DB export exists in system/backup route); immutable audit logs (signer audit log is append-only) |
| **RaaS com DDoS** | Ransomware-as-a-Service + DDoS is a combined extortion tactic; DDoS is infra, ransomware is endpoint | Same as above |
| **Extorsão Multifacetada** | Multi-vector extortion (encrypt + leak + DDoS) | App-side: ensure audit logs cannot be deleted (append-only + hash chain from §7.3.4, pending implementation); ensure DB backups are offsite |
| **Recrutamento de Insider** | Social engineering of insiders; app cannot detect intent | Audit logs (every action attributed to actor); least privilege; access revocation workflow (H8) |
| **Prejuízo por Incidente** | This is an impact metric, not a vector; the app's contribution is blast-radius limiting | Risk-manager circuit breakers (5 breakers) limit financial prejuízo per incident |

**The app's contribution to ransomware defense is limited to:** (a) append-only
audit logs that cannot be tampered with (so the operator can verify what
happened after an incident), (b) DB backups that can be restored, (c)
financial circuit breakers that limit prejuízo. The actual ransomware
defense (endpoint protection, EDR, immutable backups, IR plan) is
operational and outside this repo.

### Layer 13: APT / Espionage — OUT OF SCOPE (nation-state, operational)

| Vector | Why out of scope | App-side support |
|---|---|---|
| **Espionagem Digital e APTs** | Advanced Persistent Threats are nation-state actors with months-long campaigns; defense requires threat hunting, network segmentation, EDR | Audit logs (detect anomalous access patterns); network isolation of signer process (already designed: signer communicates only via Unix socket) |
| **Espionagem Baseada em IA** | AI-augmented espionage (automated recon, targeted phishing) — same as APT with better tooling | Same as above |
| **Comprometimento de Longo Prazo** | Long-dwell attackers that establish persistence; app cannot detect | Audit log anomaly detection (future); file integrity monitoring (operational) |

**The signer isolation design (Phase 1) is itself an APT mitigation:**
keys live in a separate process with no network access (Unix socket
only), so even if the Next.js process is compromised, the keys are not
directly accessible. This is the app's strongest contribution to APT
defense. Completing M2.3/M3/M4 (the signer isolation phases) is the
highest-leverage APT mitigation available in app code.

### Layer 14: AI-driven threats — PARTIALLY IN SCOPE

| Vector | Existing mitigation | Gap | Defense |
|---|---|---|---|
| **Prompt Injection** | None — if `z-ai-web-dev-sdk` is used for AI features (ai-agent.ts exists) | LLM calls that take user input (scam analysis, token descriptions) are vulnerable to prompt injection | H14: input sanitization before LLM calls; output validation; separate privileged vs unprivileged LLM contexts; refuse tool-use from untrusted input |
| **Shadow AI** | None | Operators using unsanctioned AI tools (external ChatGPT for trading decisions) — operational, not app-level | Out of scope. Operational policy: sanctioned AI tools only |
| **Bots de Escala** | Per-IP rate limiting (partial) | Automated botnets scaling credential stuffing or API abuse | H10 (rate limiting) + H11 (DDoS) address this; no separate defense needed |
| **Ataques Autônomos** | None | AI-driven autonomous attack tools (automated vulnerability scanning, automated social engineering) | Same as Layer 9 (web app hardening) — the defense doesn't change because the attacker is AI-driven |
| **Phishing Hiper-realista / Deepfakes** | None | AI-generated phishing that bypasses traditional detection | Out of scope (Layer 8). Operational: security awareness; hardware keys resist phishing |

**H14 acceptance criteria (if AI features are used):**
- A test that asserts user input is sanitized before LLM calls (no raw user text in system prompt).
- A test that asserts LLM output is validated before being used in trading decisions.
- A test that asserts tool-use (function calling) is refused from untrusted input.

### Layer 15: E-commerce fraud — OUT OF SCOPE (not an e-commerce platform)

| Vector | Why out of scope |
|---|---|
| **Fraude de Triangulação** | The app is not a marketplace; no buyer-seller-mediation flow |
| **Golpe da Falsa Entrega (QR Code)** | The app does not process deliveries or QR codes |
| **Lojas Falsas e Ofertas Irreais** | The app is not a storefront; it trades on exchanges/DEXs |
| **Phishing de Falso Suporte e Cancelamento** | Overlaps with Layer 8 Fake Support; same operational boundary |

These vectors apply to e-commerce platforms. The auto-trader does not
have customers, does not process orders, does not have a storefront.
Including them would be scope creep into a different problem domain. If
the app ever adds marketplace features (unlikely), these would become
relevant — until then, they are explicitly out of scope.

---

## Updated Phased Roadmap (combined Lists 1 + 2)

| Phase | Layer(s) | Vectors | Scope | Depends on |
|---|---|---|---|---|
| H0 | 0 | Operational Key Compromise, Hot Wallet Key Mgmt, Crypto Errors | In scope | (current: M2.3 blocked by data loss) |
| H1 | 1 | Front-Running, Sandwich, Sniper, Arbitrage | In scope | H0 |
| H2 | 2 | Honeypot, Rug Pull, Contract Exploits, Unlimited Approval, Liquidity Mining, First Depositor | In scope | H0 |
| H3 | 3 | Signature Phishing, Inconsistent Revocation | In scope | H0 |
| H4 | 4 | Centralized RPC, Oracle Manipulation, CI/CD Compromise, Supply Chain, Dependency Compromise, Pipeline de Build | In scope | (partially overlaps H9) |
| H5 | 5 | RPC Privacy, Provider Injection | In scope | H0 |
| H6 | 6 | Address Poisoning | In scope | — |
| H7 | 7 | Reentrancy, Logic Errors | In scope | — |
| H8 | 8 | Fake Support, Airdrop Scams, Infostealers, Deepfakes, Hyper-personalized Phishing, Insider Threats, Clipboard Hijackers | Out of scope (operational support only) | — |
| H9 | 9 | OWASP Top 10, Broken Access Control, SQL Injection, XSS, Security Misconfiguration | In scope | — |
| H10 | 10 | Identity Takeover, ATO, Credential Stuffing, Synthetic Identities | In scope | H9 |
| H11 | 11 | Application-layer DDoS | Partially in scope (app-side rate limiting + degradation) | H9 |
| H12 | 12 | Ransomware, RaaS+DDoS, Extortion, Insider Recruitment | Out of scope (operational: backups, EDR, IR) | — |
| H13 | 13 | APTs, AI Espionage, Long-dwell Compromise | Out of scope (operational: threat hunting, network segmentation) | — |
| H14 | 14 | Prompt Injection, Autonomous Attacks | Partially in scope (if AI features used) | H9 |
| H15 | 15 | Triangulation Fraud, Fake Delivery QR, Fake Stores | Out of scope (not an e-commerce platform) | — |

**Total unique vectors across both lists: ~65.**
- In scope for app code: ~35 (Layers 0-7, 9-11, 14)
- Out of scope (operational/endpoint/infra): ~25 (Layers 8, 12-13, 15)
- Partially in scope: ~5 (Layers 11, 14)

---

## Out-of-Scope Register (List 2 — additional vectors)

In addition to the Layer 8 register from List 1, the following vectors
from List 2 are explicitly OUT OF SCOPE for app code:

- Ransomware e Extorsão Digital (endpoint: EDR, backups, IR plan)
- RaaS com DDoS (same as above + infra DDoS)
- Extorsão Multifacetada (same as above; app contributes append-only audit logs)
- Recrutamento de Insider (operational: audit logs, least privilege — app supports via H8)
- Espionagem Digital e APTs (operational: threat hunting, network segmentation)
- Espionagem Baseada em IA (same as above)
- Comprometimento de Longo Prazo (operational: file integrity monitoring, IR)
- Shadow AI (operational policy: sanctioned AI tools only)
- Phishing Hiper-realista / Deepfakes (operational: security awareness, hardware keys)
- DDoS Volumétrico (infra: CDN, geographic rate limiting)
- Monocultura da Internet (industry-level concern, not app-level)
- Fraude de Triangulação (not an e-commerce platform)
- Golpe da Falsa Entrega QR Code (not an e-commerce platform)
- Lojas Falsas e Ofertas Irreais (not an e-commerce platform)
- Phishing de Falso Suporte (overlaps Layer 8 — operational)
- Prejuízo por Incidente (impact metric, not a vector — app contributes via circuit breakers)
- Identidade Digital Falsa / Identidades Sintéticas (single-operator assumption; if multi-operator, requires identity proofing)

The boundary is the same: the app SUPPORTS operational defenses (audit
logs, MFA, circuit breakers, append-only logs) but cannot DEFEND alone
against vectors that operate outside its perimeter. Conflating the two
produces security theater.

---

## Relationship to existing documents

- **`SECURITY.md`** — regression inventory for already-fixed properties.
  Each hardening phase, once landed, adds a REG-NNN entry here.
  **STATUS: LOST in the filesystem regression — needs reconstruction
  before any hardening phase can land (each phase's REG entry references
  the inventory format).**
- **`worklog.md`** — chronological work log. Each hardening phase gets a
  Task ID (e.g., `hardening-h1-mev`) and follows the established template.
  **STATUS: truncated to enhancement-v11 + hardening-mandate entries.
  Signer-isolation work log entries (§7.3.7, M1-M2.2, pre-corrections,
  readonly-fix) are LOST.**
- **This document (`HARDENING-ROADMAP.md`)** — forward-looking plan. Updated
  as phases complete (mark them done) and as new vectors are identified
  (added to the threat model). **STATUS: intact (created after the
  filesystem regression, in this session).**

The three documents form a closed loop: roadmap (what we will do) →
worklog (what we did) → SECURITY.md (what we must not undo). **The loop
is currently broken** — SECURITY.md and the signer-isolation worklog
entries are missing. The loop must be restored before hardening phases
can begin.

---

## BLOCKING ISSUE: Data Loss

The filesystem regressed to git commit `66edfd6` (enhancement-v11, Jul 13).
All signer-isolation work (Phase 1, M1, M2.1, M2.2, the pre-push hook,
the postinstall wiring, the readonly-container fix, SECURITY.md, the
three test files, the signer process code, the wallet-crypto class) was
working-tree-only and is LOST. The git history has no record of it.

**No hardening phase (H0-H15) can begin until this is resolved.** H0
depends on the signer isolation that was lost. H1-H7 build on H0. H9-H14
are independent of the signer but depend on the dashboard/API code
being stable (which it is — the trading code survived; only the signer
isolation layer was lost).

**Recovery options (awaiting operator direction):**
- **(a)** Restore from container/volume backup (byte-identical recovery)
- **(b)** Reconstruct from conversation context (structural reconstruction;
  SECURITY.md content is in the conversation context; test structures are
  described; signer code would be rebuilt from the documented design intent)
- **(c)** Reassess scope (re-do signer isolation from scratch with the
  benefit of the review thread's lessons learned)
