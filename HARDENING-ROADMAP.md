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

### H0: Complete foundational (parallel to M2.3, M3, M4)
- Finish signer isolation: M2.3 (move WalletVault) → M3 (sign RPC) → M4 (writer lease)
- This fully closes Layer 0 (Operational Key Compromise, Hot Wallet Key Management, Cryptographic Implementation Errors via zeroize-on-disconnect)
- **No new hardening work starts until H0 is done** — Layer 0 is the foundation that H1-H7 build on. Building MEV defenses on top of a non-isolated signer would be rework.

### H1: MEV defenses (Layer 1) — highest-risk on-chain gap
- Private mempool integration (Flashbots Protect for Ethereum, Merlin for Base, MEV-Share)
- Configurable slippage tolerance (replace hardcoded 30bps)
- Exit timing jitter (anti-arb)
- Acceptance criteria: 3 structural tests (private mempool path, slippage enforcement, jitter)

### H2: Contract interaction hardening (Layer 2) — highest-risk token-fraud gap
- Exact-amount approvals + auto-revoke
- Extended scam-detector (sell-simulation, on-chain LP lock verification, mint authority)
- Pre-trade simulation (fork-based)
- Acceptance criteria: 3 structural tests (exact-amount approval, honeypot rejection, simulation rejection)

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

## Sequencing Recommendation

1. **M2.3 first** (current work, already cleared) — moves WalletVault to signer, adds zeroize-on-disconnect, structural dispatcher test. This is H0 progress.
2. **M3, M4** (sign RPC + writer lease) — completes H0.
3. **H1 (MEV)** + **H2 (contract hardening)** in parallel — these are the highest-risk gaps. H1 is on-chain adversarial, H2 is token-fraud. Both are "the bot loses money to attackers" vectors.
4. **H3 (signature)** + **H4 (infra)** + **H5 (privacy)** in parallel — these are "the bot/operator gets compromised" vectors. Less frequent but higher blast radius.
5. **H6 (address)** + **H7 (logic)** — hardening polish.
6. **H8 (operational support)** — continuous, parallel to everything else.

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

## Out-of-Scope Register

The following items from the mandate are explicitly OUT OF SCOPE for app
code, with the boundary documented above (Layer 8):

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

## Relationship to existing documents

- **`SECURITY.md`** — regression inventory for already-fixed properties.
  Each hardening phase, once landed, adds a REG-NNN entry here.
- **`worklog.md`** — chronological work log. Each hardening phase gets a
  Task ID (e.g., `hardening-h1-mev`) and follows the established template.
- **This document (`HARDENING-ROADMAP.md`)** — forward-looking plan. Updated
  as phases complete (mark them done) and as new vectors are identified
  (added to the threat model).

The three documents form a closed loop: roadmap (what we will do) →
worklog (what we did) → SECURITY.md (what we must not undo).
