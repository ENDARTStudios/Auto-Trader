# Security Regression Inventory

This file names the regression tests whose purpose is not obvious from the
test name alone — specifically, tests that exist to pin behavior that a
future maintainer might "simplify" back into a known-broken shape. Each
entry explains **what the test pins**, **why it exists**, and **what
breaks if the test is removed or weakened**.

The pattern this inventory exists to prevent has recurred multiple times
in this project's history: a subtle bug is fixed, a test is added, the
test passes, months pass, a future maintainer reads the test, doesn't
see why the assertions are so specific, "simplifies" the code back to
the broken shape, and the test is either weakened or removed because it
no longer matches the simplified code. The bug returns silently.

If you are touching code covered by an entry below and the corresponding
test fails, **do not weaken the test to make it pass**. Read the entry,
understand the regression it pins, and either (a) keep the structural
property the test pins, or (b) explicitly document in a design doc why
the structural property is no longer required AND update this file to
remove the entry. Option (b) should be rare and reviewed by the operator.

---

## REG-001: `enteredHandler` sentinel in `request-peer-capture.ts`

**Test:** `scripts/test-request-peer-integration.ts` → Test 4
("STRUCTURAL: sync exception in downstream 'request' listener PROPAGATES
through patchedEmit — NOT swallowed by IP-capture try/catch")

**Code under test:** `src/lib/request-peer-capture.ts`, the
`patchedEmit` function — specifically the second try/catch block (the
one around `runWithPeerAddress(peerAddress, () => originalEmit.apply(...))`).

**What the test pins (three assertions):**

1. A sync exception thrown by a downstream 'request' listener (i.e., a
   real bug in Next.js's request pipeline or in a route handler — NOT in
   the IP-capture code) **propagates out of `server.emit('request', ...)`**.
   It is NOT swallowed by the try/catch in `patchedEmit`.
2. The propagated exception is the **SAME exception** the downstream
   handler threw — not a re-dispatch artifact, not a wrapped error.
3. The downstream handler is invoked **EXACTLY ONCE** — not twice.

**Why this test exists (the regression it guards against):**

The `patchedEmit` function monkey-patches `http.Server.prototype.emit`
to capture `req.socket.remoteAddress` into an `AsyncLocalStorage` before
dispatching the original emit. The capture path is wrapped in try/catch
per the operator's directive: any error in the capture must degrade to
the `"unidentifiable-socket"` bucket, never propagate the exception
through `emit()`.

The subtle trap is that `AsyncLocalStorage.run(store, callback)` does
**NOT** catch exceptions thrown inside `callback` — they propagate out
of `.run()` just like any other synchronous exception. So a single
try/catch around `runWithPeerAddress(peerAddress, () => originalEmit.apply(...))`
catches **two structurally different cases**:

- **Case (a) — ALS setup failed:** `runWithPeerAddress` threw before
  invoking the callback. This IS our code, IS recoverable, and IS what
  the operator's directive covers (degrade to `"unidentifiable-socket"`).
- **Case (b) — downstream handler threw:** `originalEmit.apply()` fired
  the 'request' listeners, one of which threw synchronously. This is
  NOT our code, is NOT recoverable by us, and MUST propagate to Node's
  `uncaughtException` handler so `crash-logger.ts` writes the trace and
  the process exits + restarts.

If a single try/catch is used (the "simplified" shape), case (b) is
caught and — depending on what the catch block does — one of three
regressions occurs:

- The catch re-dispatches `originalEmit.apply()` → the downstream
  handler runs **TWICE** with duplicate side effects (duplicate DB
  writes, duplicate state mutations). Assertion 3 catches this.
- The catch re-dispatches and the second invocation also throws → the
  original exception is **masked** by the second one, misdirecting the
  investigation. Assertion 2 catches this.
- The catch re-dispatches and the second invocation happens to succeed
  (state mutated by first run took a different code path) → the
  original exception is **SILENTLY SWALLOWED**, no crash log, no stack
  trace, the request hangs without a response. This is exactly the
  "silent failure without log" pattern that the silent-crash
  investigation (see `docs/signer-isolation-design.md` §12, `MONITOR`
  status) exists to catch. Assertion 1 catches this.

**The correct structure (do not simplify away):**

```typescript
let enteredHandler = false;
try {
  return runWithPeerAddress(peerAddress, () => {
    enteredHandler = true;  // flips ONLY if the callback was actually invoked
    return originalEmit.apply(this, [event, ...args]);
  });
} catch (err) {
  if (enteredHandler) {
    // Case (b): exception came from INSIDE the callback — i.e., from
    // originalEmit / downstream handler. NOT our exception to catch.
    // Re-throw so crash-logger.ts + Node's uncaughtException behave
    // exactly as they would without the monkey-patch. Do NOT re-dispatch.
    throw err;
  }
  // Case (a): ALS setup itself threw BEFORE the callback ran. This is
  // the only case the operator's directive covers. Dispatch WITHOUT
  // the ALS context — downstream sees null via getRequestPeerAddress()
  // (which maps to "unidentifiable-socket").
  return originalEmit.apply(this, [event, ...args]);
}
```

The sentinel `enteredHandler` flips to `true` as the **first line**
inside the callback. Because `AsyncLocalStorage.run()` invokes the
callback synchronously, the sentinel reliably indicates whether the
callback was entered. If the catch fires AND `enteredHandler === true`,
the exception came from inside the callback (downstream handler) and
must be re-thrown. If the catch fires AND `enteredHandler === false`,
ALS setup itself threw and the recovery path (dispatch without ALS
context) is correct.

**If you are tempted to "simplify" this to a single try/catch:**

Don't. Read assertion 3 of Test 4. The single-try/catch shape re-dispatches
`originalEmit.apply()` on any catch, which runs the downstream handler
twice. The "simplification" is the exact regression this test exists to
catch. If you have a structural reason to change the capture mechanism
(e.g., migrating off `http.Server.prototype.emit` — see the
`COUPLING TO http.Server` comment in `request-peer-capture.ts`), the
sentinel pattern no longer applies and this test can be updated — but
that is a migration, not a simplification, and should be reviewed by the
operator.

**History:** v19.3.2 draft-6 had the single-try/catch shape. The
operator's structural review caught it before it shipped. Draft-7
introduced the `enteredHandler` sentinel + Test 4. The test was written
before the operator explicitly asked for a test in this format — which
is the discipline pattern this inventory exists to preserve.

---

## REG-002: per-IP rate limiter fallback is `req.socket.remoteAddress`, never a fixed sentinel

**Tests:** `scripts/test-vault.ts` scenarios 18 + 19;
`scripts/test-request-peer-integration.ts` Test 1.

**Code under test:** `src/lib/trading/proxy-trust.ts`
(`resolveTrustedClientIp` pure function + `extractTrustedClientIp`
production wrapper); `src/lib/trading/wallet-crypto.ts` (per-IP rate
limiter).

**What the tests pin:** when no proxy shared secret is configured (the
actual deployment topology of this project — bind `127.0.0.1` since
v18, no reverse proxy), the per-IP rate-limit key is the **TCP socket
peer address**, NOT a fixed sentinel string. Two distinct source IPs
get distinct rate-limit buckets. A forged `x-forwarded-for` header is
ignored (XFF is trusted only when a proxy shared secret is configured
AND present in the request).

**Why this test exists (the regression it guards against):**

The original v18 rate limiter used a single global `Date[]` array of
failure timestamps — an attacker from one IP could fill the counter and
block the legitimate operator from another IP (self-inflicted DoS). The
v19.3.1 hotfix fixed this by moving to a per-IP `Map`, but the fallback
for direct connections (no proxy configured) was a fixed sentinel string
`"direct-untrusted"` — which was a single shared bucket, recreating the
exact same self-DoS shape as the original bug, just renamed. For the
deployment this project actually runs, every real connection to the
vault fell into the shared sentinel bucket — the hotfix did not fix the
bug for the actual topology.

The v19.3.2 fix replaces the sentinel with the actual TCP socket peer
address (`req.socket.remoteAddress`), captured via the
`http.Server.prototype.emit` monkey-patch (see REG-001) +
`AsyncLocalStorage`. Two distinct source IPs now get distinct
rate-limit buckets for the actual deployment.

**If you are tempted to "simplify" the fallback to a sentinel:**

Don't. Read scenario 18 of `test-vault.ts` — it asserts that two
distinct `peerAddress` values resolve to DISTINCT strings. A fixed
sentinel would make them collapse to the same string, failing the
assertion. The sentinel shape is the exact bug the operator caught in
the v19.3.1 hotfix review. If the deployment moves behind a reverse
proxy, set `SIGNER_PROXY_SHARED_SECRET` and the trusted-proxy path
takes over — but the direct-connection fallback must remain the peer
address, not a sentinel.

**History:** v19.3.1 used `"direct-untrusted"` as the fallback. The
operator caught it: "a correção do bug de auto-DoS deve sair do escopo
da Fase 1 do signer e virar hotfix imediato e independente" — and then
in the next review round, "o fallback `"direct-untrusted"` recria o bug
original para a topologia que realmente roda". v19.3.2 replaced it with
`req.socket.remoteAddress`. Scenarios 18/19 + Test 1 pin the behavior.

---

## REG-003: test suite self-cleanup via `hardCleanupBeforeSuite`, not manual DB intervention

**Test:** `scripts/test-vault.ts` — the `hardCleanupBeforeSuite()`
function called at the start of `main()`, before any test scenario runs.

**Code under test:** the test suite itself (not production code).

**What the test pins:** the suite truncates `WalletConnection` +
`ExchangeConnection` tables at suite start, so it works on a dirty DB
without manual intervention. The suite is idempotent — three consecutive
runs produce 20/20 PASS, 20/20 PASS, 20/20 PASS, with no operator
intervention between runs.

**Why this test exists (the regression it guards against):**

Throughout this thread, the pattern "test fails → operator cleans DB
manually → rerun → passes" recurred **three times**. Each occurrence
masked a real bug: the test was failing because of the bug, the manual
cleanup hid the failure, and the bug shipped. The self-cleanup at suite
start (rather than per-test) was chosen deliberately — per-test cleanup
would slow the suite and create ordering dependencies; suite-start
cleanup is fast, deterministic, and proves the suite is self-contained.

**If you are tempted to "speed up" the suite by removing
`hardCleanupBeforeSuite()`:**

Don't. The function exists because manual DB cleanup masked three real
bugs in this thread's history. If you remove it, the suite will pass on
a clean DB and fail on a dirty DB — which means CI passes (clean DB
every run) but the operator's local dev loop fails intermittently (dirty
DB from prior runs), and the operator has to manually clean the DB to
rerun — which is exactly the pattern that masked the bugs. If the
truncation is too slow, profile it — but the self-cleanup property must
be preserved.

**History:** v19.3.2 added `hardCleanupBeforeSuite()`. The operator's
review explicitly called out the three-occurrence pattern and approved
the suite-start cleanup as the correct fix.

---

## REG-004: pre-push git hook runs `test:ci` before any push

**Test:** the `pre-push` git hook itself, installed by
`scripts/install-git-hooks.sh` from the tracked source at
`scripts/git-hooks/pre-push`.

**Code under test:** the project's full CI gate (`npm run test:ci`),
which runs three suites in sequence:
`scripts/test-vault.ts` (20 scenarios) →
`scripts/test-request-peer-integration.ts` (4 scenarios) →
`scripts/test-signer-process.ts` (5 scenarios).

**What the hook pins:** no `git push` proceeds unless all 29 tests across
the three suites pass. A failing test aborts the push. The operator must
either fix the code (if the test is right) or fix the test in a separate
commit with a SECURITY.md update (if the test is wrong).

**Why this hook exists (the pattern it guards against):**

Throughout the v19.3 signer-isolation review thread, the pattern
"a test script exists, nobody runs it systematically, a regression ships"
recurred multiple times. The most concrete instance was the
v19.3.2-draft-6 structural bug: the test suite existed and passed, but
the integration test for the IP-capture monkey-patch (which would have
caught the silent-exception-swallowing bug) did not exist yet — and the
unit tests that did exist tested the pure decision function downstream of
the capture, not the capture itself. The pattern was not "tests fail and
we ship anyway" — it was "the right test does not exist, and the tests
that do exist create a false sense of coverage."

`npm run test:ci` (the gate the hook enforces) was added during draft-7
specifically to consolidate the three test files into a single command
that exits non-zero on any failure. But the operator's final sign-off
noted: "`test:ci` is a well-named script, but nothing in this thread
indicates a pipeline of CI of truth running automatically before
merge/deploy — it's just a command that still depends on someone
remembering to run it." The hook closes that gap: the gate now fires
automatically on every push, with an explicit escape hatch
(`SIGNER_SKIP_PRE_PUSH_HOOK=1`) that is documented as WIP-backup-only,
never routine.

**If you are tempted to "speed up" pushes by removing the hook or
bypassing it with `--no-verify`:**

Don't. The hook exists because manual test runs were forgotten, and
regressions shipped. If the suite is too slow for routine pushes, profile
it — but the gate property must be preserved. If you must bypass for a
WIP backup push, use `SIGNER_SKIP_PRE_PUSH_HOOK=1 git push ...` (which
prints the loud banner documented below to stderr) rather than
`--no-verify` (which is silent). The visible banner keeps the bypass
auditable in shell history and terminal scrollback.

**Installation (automatic via `npm install`):**

The hook is installed automatically by npm's `postinstall` script —
`package.json` has `"postinstall": "bash scripts/install-git-hooks.sh"`,
which copies the tracked hook files from `scripts/git-hooks/` into
`.git/hooks/` and makes them executable. A fresh clone followed by
`npm install` is sufficient to activate the hooks — no separate manual
step.

Git hooks are not tracked by git (the `.git/hooks/` directory is
per-clone), which is why the install script exists. Wiring it into
`postinstall` closes the loop: `test:ci` is the gate → the pre-push
hook guarantees the gate runs → `postinstall` guarantees the hook
exists. Without `postinstall`, the install script would itself be
"another script that exists but someone has to remember to run" — the
exact failure mode the hook exists to prevent.

The install script gracefully no-ops when `.git` is absent (e.g.,
deployed build artifacts, tarball installs) so `npm install` does not
fail in those contexts. CI environments that run tests on push events
don't need this hook (CI runs the tests itself) — the hook is for the
operator's local dev loop, where the absence of CI makes the manual
gate easy to forget.

The install script ALSO gracefully no-ops when `.git` exists but
`.git/hooks/` is not writable. This covers read-only container images
(Docker images where `.git` is COPYed into a read-only layer),
restricted CI runners (some providers mount `.git` read-only to prevent
tests from mutating the checked-out source), and other contexts where
`.git` is visible but not modifiable. Without this graceful path, `cp`
into `.git/hooks/` fails with EACCES, `set -e` propagates it as
exit 1, and `npm install` breaks for a reason that has nothing to do
with the code being installed. The script treats "permission denied
on `.git/hooks/`" exactly like ".git absent" — single-line notice to
stderr, exit 0. Verified by `scripts/test-install-git-hooks-readonly.sh`.

The same graceful-skip pattern is applied per-hook when the destination
file already exists but is not writable (the rarer case where the
directory is writable but a specific hook file has been chmod'd
read-only by some external process). Per-hook skips print a notice and
continue with the existing version, rather than failing the install.

**Visible escape hatch (do not silence):**

The hook can be skipped by setting `SIGNER_SKIP_PRE_PUSH_HOOK=1` —
this is an escape hatch for WIP backup pushes only, never routine work.
When the variable is set, the hook prints a LOUD multi-line banner to
stderr before letting the push proceed:

```
╔══════════════════════════════════════════════════════════════════════╗
║  AVISO: pre-push hook PULADO via SIGNER_SKIP_PRE_PUSH_HOOK=1         ║
║  test:ci NÃO rodou — a porta de proteção está DESLIGADA para este   ║
║  push. Se isto é um push de rotina, há um problema: a variável deve  ║
║  estar setada só para pushes de WIP/backup, nunca como workflow de  ║
║  rotina. Verifique seu ~/.bashrc / ~/.zshrc / perfil do shell.       ║
╚══════════════════════════════════════════════════════════════════════╝
```

The banner is intentionally noisy. A single-line skip message is too
easy to tune out after a few pushes — someone who accidentally leaves
the variable set in their shell profile would stop noticing it within
a day. The multi-line banner ensures the protection being off is
visible every single time. DO NOT "quiet down" this banner as a cosmetic
cleanup — the noise is the feature. If you are tempted to silence it,
the right fix is to unset the environment variable, not to make the
banner smaller.

Prefer the visible `SIGNER_SKIP_PRE_PUSH_HOOK=1` escape hatch over
git's silent `--no-verify` flag — the visible skip keeps the bypass
auditable in shell history and in the terminal scrollback, while
`--no-verify` leaves no trace.

**History:** v19.3.2 draft-7 final sign-off — operator's non-blocking
Note 2: "I would add a `pre-push` git hook or, at minimum, an explicit
mandatory step in the runbook before any deploy that touches
`wallet-crypto.ts`, `request-peer-capture.ts`, or the signer code. This
doesn't need to happen before starting Phase 1 — it can enter as an item
of the implementation work itself." Implemented during Phase 1
implementation as the first item, since it is small, concrete, and
closes the exact "manual step gets forgotten" pattern that recurred
throughout the review thread.

---

## Future entries

As Phase 1 implementation proceeds, the following regression tests are
expected to be added to this inventory:

- **Hash chain anti-truncation checkpoint** (§7.3.4): the
  `verify-signer-audit.ts` CI script that cross-checks the monotonic
  `seq` counter against the periodic checkpoint file. Pins the
  anti-truncation property — if the script is removed or weakened, a
  truncated audit log would go undetected.
- **Writer lease TTL + immediate release** (§9.4): the test that pins
  `writer_lease_released` (clean disconnect) vs `writer_lease_expired`
  (TTL backstop) as distinct audit-log events. Pins the operator's
  ability to distinguish "writer closed cleanly" from "writer died" in
  post-incident review.
- **Price feed URL fixed at boot** (§7.3.1): the test that pins the
  `sign` RPC rejecting `priceFeedUrl` / `price` parameters with
  `-32602`. Pins the tamper-resistance property — if the test is
  removed, a future change could re-allow runtime price-feed
  overriding, recreating the tamper vector.

Each entry should follow the same shape: what the test pins, why it
exists, what breaks if it's removed, the correct structure, and the
history of the bug it guards against.

---

## REG-005: commit discipline — no milestone stays working-tree-only

**Test:** the git history itself. Every milestone (M1, M2.1, M2.2, M2.3,
M3, M4, H0-H15) MUST produce a commit. No approved milestone stays as
uncommitted working-tree changes.

**What this pins:** the project's recoverability. If the container
rootfs regresses (as it did on Jul 14 2026 — see History below), the
maximum loss is the work since the last commit, NOT an entire phase.

**Why this rule exists (the regression it guards against):**

On Jul 14 2026, the container rootfs at `/home/z/my-project` regressed
to git commit `66edfd6` (enhancement-v11, Jul 13). The entire signer-
isolation work (Phase 1, M1, M2.1, M2.2, the pre-push hook, the
postinstall wiring, the readonly-container fix, SECURITY.md, the three
test files, the signer process code, the WalletVault class — 67 files,
~30000 lines) was working-tree-only and would have been LOST.

Recovery was possible only because a PolarFS persistent mount at
`/tmp/my-project` had synced copies of the source files. Without that
snapshot, the entire Phase 1 would have been unrecoverable — the git
history had no record of it.

The root cause was a process failure, not a technical failure: milestones
were approved and implemented but never committed. The operator's
directive after the incident: "nenhum marco (M1, M2.1, M2.2, M2.3...)
permanece sem commit; todo marco aprovado gera um commit; commits
intermediários pequenos são preferíveis a centenas de arquivos não
versionados; antes de alterações grandes, criar uma branch dedicada."

**The correct discipline (do not relax):**

1. **Every approved milestone produces a commit.** "Approved" means the
   operator reviewed and accepted the work. The commit happens immediately
   after approval, not "later" or "when I have time." The Jul 14 incident
   proved that "later" can become "never" if the container restarts.

2. **Small intermediate commits are preferred over large batch commits.**
   A 67-file commit (like the recovery commit `d4dc0c0`) is acceptable
   for recovery, but NOT for normal workflow. Normal workflow commits
   should be scoped to a single milestone or sub-milestone (e.g., M2.1
   = one commit, M2.2 = one commit, not M2.1+M2.2+hooks in one commit).

3. **Before large changes, create a dedicated branch.** The signer-
   isolation work should have been on a `phase1-signer-isolation` branch,
   not on `main`. A branch would have made the work visible in `git
   branch` output and would have survived the rootfs regression (branches
   are stored in `.git/refs/`, which is part of the git database, not
   the working tree).

4. **The pre-push hook is NOT a substitute for committing.** The hook
   runs `test:ci` before a push, but a push requires a commit first.
   If the work is uncommitted, the hook never fires, and the work is
   invisible to git. Commit FIRST, then push.

5. **After each step in a multi-step milestone: implement → test → fix →
   commit.** Not "implement everything → test → commit at the end." The
   intermediate commits create recovery points. If step 3 breaks
   something, you can `git diff` against step 2's commit to find the
   regression — you can't do that against uncommitted working-tree
   changes that got lost.

**If you are tempted to "commit later" or "commit when the phase is
done":**

Don't. The Jul 14 incident proved that "later" can mean "lost." If the
work is approved, commit it NOW. If the work is not yet approved, commit
it on a feature branch with a `WIP:` prefix — a WIP commit is infinitely
better than no commit, because it's recoverable.

**History:** Jul 14 2026 — container rootfs regressed to the last git
commit (66edfd6). All signer-isolation work was working-tree-only. 67
files / ~30000 lines would have been lost. Recovered from PolarFS
snapshot at `/tmp/my-project` (a persistent `fuse.pfs` mount that had
synced copies of the source files). The recovery commit is `d4dc0c0`.
The operator's directive established this rule as REG-005 to prevent
recurrence.

---

## REG-006: schema reconstruction MUST be validated against the CRUD layer, not just the direct-DB test path

**Test:** `npm run test:wallet-crud` — 11 structural tests that exercise
the REAL `src/lib/trading/wallet-manager.ts` CRUD functions
(`createWallet`, `listWallets`, `setWalletActive`, `deleteWallet`,
`createExchange`, `listExchanges`, `setExchangeActive`,
`deleteExchange`) against the real SQLite DB. Every reconstructed field
must round-trip (write → read back → assert value matches). If a field
is missing from the schema, the Prisma client rejects the write and the
test fails. This test runs as part of `test:ci`.

**What this pins:** the contract between the Prisma schema and the
application code that consumes it. The reconstruction of
`WalletConnection` and `ExchangeConnection` from the PolarFS snapshot
dropped 8 fields (3 from Wallet, 5 from Exchange) that
`wallet-manager.ts` reads and writes. The fields were referenced in the
CRUD layer but NOT in the direct-DB test path used by `test-vault.ts`,
so 29/29 CI tests passed while `POST /api/wallets` and
`POST /api/exchanges` would have thrown Prisma validation errors at
runtime.

**Why this rule exists (the regression it guards against):**

On Jul 14 2026, during the PolarFS snapshot recovery, the Prisma schema
was reconstructed from the field usage in `test-vault.ts` and
`wallet-crypto.ts`. Both of those files use `db.walletConnection.*` and
`db.exchangeConnection.*` directly with a minimal `select` clause
(id, label, privateKeyEncrypted, readOnly for wallets; id, label,
exchange, apiKeyEncrypted, apiSecretEncrypted, apiPassphraseEncrypted
for exchanges). The reconstruction used exactly those fields and
omitted:

  - `WalletConnection`: `chain`, `publicKey`, `lastUsedAt`
  - `ExchangeConnection`: `apiKeyPublicPrefix`, `permissions`,
    `testnet`, `ipWhitelistConfigured`, `lastUsedAt`

The `wallet-manager.ts` CRUD layer (the layer the API routes call)
reads and writes ALL of those fields. `toWalletRow` accesses `r.chain`,
`r.publicKey`, `r.lastUsedAt`; `createWallet` writes `chain`,
`publicKey`; `setWalletActive` writes `lastUsedAt`. The exchange
equivalents do the same for the 5 missing Exchange fields.

The bug was caught by the operator's review of the recovery, NOT by the
test suite. The operator's exact observation: "os modelos
`WalletConnection` e `ExchangeConnection` foram reconstruídos manualmente
no schema Prisma. Antes de considerar a recuperação definitiva, confirme
que esses modelos pertencem à evolução pretendida do banco e não apenas
aos testes. Como os testes passaram, a implementação está coerente, mas
vale registrar essa alteração no histórico de migrações
(`prisma/migrations`) para evitar divergência entre um banco novo e um
banco existente."

**The two-layer rule (load-bearing from REG-006):**

  1. A schema reconstruction is NOT validated by the test suite unless
     the test suite exercises the SAME code path as the application.
     `test-vault.ts` writes via `db.walletConnection.create()` directly;
     the application writes via `walletManager.createWallet()` which
     wraps `db.walletConnection.create()` with additional fields. The
     test path was a SUBSET of the application path, so tests passed
     while the application was broken.

  2. Every model that has a CRUD layer (`createX` / `listX` /
     `setXActive` / `deleteX` functions in `*-manager.ts`) MUST have a
     structural test that exercises those functions end-to-end, not
     just direct-DB writes.

**The migration discipline (also load-bearing from REG-006):**

  1. The project MUST have a `prisma/migrations/` directory with a
     `migration_lock.toml`. `prisma db push` is acceptable for dev
     iteration but the schema state MUST be captured in a versioned
     migration before any commit that touches `prisma/schema.prisma`.

  2. The baseline migration `20260714000001_wallet_exchange_recon_fix`
     captures the full 19-model schema at the post-recovery state. It
     is NOT intended to be re-applied to the existing dev DB (already
     in sync via `db push`). It exists so a fresh clone running
     `prisma migrate deploy` produces a byte-identical schema.

  3. Future schema changes go through `prisma migrate dev --name <desc>`,
     producing a new numbered migration. Direct `db push` after this
     point is FORBIDDEN outside of dev-only iteration (and the
     resulting schema state must be captured in a migration before
     commit).

**History:** Jul 14 2026 — operator's review of the PolarFS recovery
flagged the divergence risk. Audit of `wallet-manager.ts` against
`prisma/schema.prisma` found 8 missing fields. Fixed in schema, ran
`prisma generate` + `prisma db push` to sync, created baseline
migration, added `test:wallet-crud` (11 structural tests, all passing)
to the `test:ci` gate. The bug would have manifested at runtime as
`PrismaClientValidationError: Unknown argument 'chain'` (or similar) on
any POST to `/api/wallets` or `/api/exchanges`.

---

## REG-007: dispatcher LAYER 2 discipline — handler exceptions propagate, never swallowed

**Test:** `npm run test:signer-structural` — 2 tests (5-assertion
structural + complementary). The structural test verifies that when a
handler THROWS (instead of returning `{ ok: false, ... }`), the
exception propagates to `uncaughtException`, crash-logger.ts writes a
crash-*.log file, the process exits with code 1, and NO -32603 Internal
Error response is sent on the socket. Runs as part of `test:ci`.

**What this pins:** the LAYER 1 vs LAYER 2 distinction in
`src/signer/main.ts` `dispatchRpc`:

  - LAYER 1 (allowlist check + method routing): OUR code. Failures
    here (method not in allowlist, no handler registered) are
    recoverable application-level errors. Return `{ ok: false,
    code: -32601, ... }` — the caller gets a clean RPC error
    response, no crash.

  - LAYER 2 (handler invocation): DOWNSTREAM code. The handler may
    throw for two reasons: (a) a handler bug (handlers are
    contractually required to return error objects, see
    `MethodHandler` in signer-protocol.ts), or (b) a genuine
    unexpected exception (TypeError, OOM, DB connection lost). In
    BOTH cases, the exception MUST propagate out of `dispatchRpc`
    → out of the readline 'line' listener → to Node's
    `uncaughtException` handler → `crash-logger.ts` writes the
    stack trace → the process exits + restarts.

  - The dispatcher MUST NOT wrap `handler(params)` in a try/catch
    that converts the exception to -32603 Internal Error. Doing so
    would silently swallow bugs in the handler, which is exactly
    the "silent failure without log" pattern this project's crash
    investigation exists to eliminate.

**The 5-assertion pattern (load-bearing from REG-007):**

  1. PROPAGATION — the handler exception reaches `uncaughtException`
     (observed via the process exiting with non-zero code, which
     only happens if crash-logger.ts fired).
  2. NO-SWALLOW — no -32603 Internal Error response is sent on the
     socket (the socket closes without any response line).
  3. NO-RERUN — the handler is invoked exactly once (verified by
     counting crash event FILES containing the unique marker, NOT
     string occurrences — the marker appears multiple times within
     one crash entry: message line + stack trace).
  4. CRASH-LOG CAPTURE — a `crash-uncaughtException-*.log` file was
     created in CRASH_LOG_DIR, AND its contents include the exact
     marker string from the thrown Error (proving it's the same
     exception object).
  5. REAL-MECHANISM — live process + real Unix socket, not a unit
     test of `dispatchRpc()`.

**Test hook infrastructure (load-bearing from REG-007):**

The structural test uses `__test_throw` and `__test_inspect_vault`
test hooks. These are ONLY registered when `SIGNER_TEST_HOOKS=1` is
set at boot time. The `TEST_HOOKS_ENABLED` constant is captured at
module load — a compromised web process cannot enable test hooks at
runtime. The operator's review of M2.3 must verify:

  - `SIGNER_TEST_HOOKS` is NOT set in any production deployment
    script (start scripts, Dockerfiles, systemd units, etc.).
  - The test runner (`test:ci`) sets it ONLY for the structural
    test and the vault integration test.
  - `isTestHookMethod()` is a pure env-var check captured at boot,
    not a runtime-configurable flag.

**History:** Jul 14 2026 — M2.3 implemented. The LAYER 1 / LAYER 2
discipline was originally documented as a 75-line comment block in
M2.2 (when the dispatcher had no handlers, the distinction was moot).
M2.3 added wallet handlers that actually touch the DB and CAN throw,
making the discipline load-bearing. The structural test was built to
verify the discipline holds end-to-end, following the Test 4 pattern
from `test-request-peer-integration.ts` (3 assertions) extended to 5
to cover the crash-logger capture dimension (which the request-peer
test does not exercise, since the request-peer ALS wrapper doesn't
write to a crash log file).

**Related:** REG-001 (enteredHandler sentinel — the same LAYER 1 vs
LAYER 2 pattern applied to the request-peer ALS wrapper). The
pattern is universal: any code that wraps a try/catch around a call
that dispatches to downstream code MUST distinguish "our setup logic
failed" from "the thing we were wrapping failed". The mental test:
"if the handler I am calling fails, is my catch catching THAT error,
or only the error of my own setup logic around it?"

## REG-008: dev SQLite DB must not be tracked in git

**Class:** repository hygiene / secret hygiene

**Discovered:** Jul 14 2026, during Phase 1 closure review (operator's
checklist item: "confirme que `db/custom.db` não faz parte dos commits
destinados ao repositório").

**Defect:** `db/custom.db` (the dev SQLite database) was committed to
the repo and tracked by git. Every test run that touched the DB
(test-vault.ts, test-wallet-crud.ts, test-signer-vault-integration.ts)
mutated the committed binary, producing noise in `git diff` and
risking accidental inclusion of dev-only secrets (encrypted wallet
keys, exchange API key prefixes) in future commits. A fresh clone
would inherit the dev DB instead of running `prisma migrate deploy`
to build a clean one, masking schema/CRUD divergence bugs like
REG-006.

**Fix:**

1. Added `db/*.db`, `db/*.db-journal`, `db/*.db-wal`, `db/*.db-shm`
   to `.gitignore`.
2. `git rm --cached db/custom.db` — untracked the file without
   deleting the local dev copy.
3. The schema remains fully captured by the Prisma migration baseline
   (`prisma/migrations/20260714000001_wallet_exchange_recon_fix/`),
   so a fresh clone runs `prisma migrate deploy` and gets a
   byte-identical schema.

**Acceptance:**

- `git check-ignore -v db/custom.db` returns the `.gitignore` rule.
- `git ls-files db/` returns empty (no tracked DB artifacts).
- `git status` is clean after running the full test suite (the dev
  DB is mutated locally but no longer shows up as a tracked change).
- The full `test:ci` suite still passes (45 checks across 6 files +
  3 readonly checks = 48 total) after untracking.

**History:** Jul 14 2026 — flagged by the operator's Phase 1 closure
review. The DB had been tracked since the project's earliest commits
(pre-dating the signer isolation work). The PolarFS snapshot recovery
re-committed it as part of the restoration, perpetuating the issue.
Fixed and committed as the final Phase 1 closure action before
freezing Phase 1 and proceeding to H0.

**Related:** REG-006 (the schema/CRUD divergence bug that the migration
baseline documents). REG-008 closes the corollary: not only must the
schema be in migration history, the dev DB artifact must NOT be in
git history — otherwise the migration baseline is undermined by a
stale committed DB that masks future drift.

---

## H0 — Foundational Hardening (cryptographic guarantees)

**Status:** H0.1–H0.4 implemented + tested. H0.5 is the review document
at `docs/CRYPTO.md`.

**Scope:** KDF versioning (H0.1), encryption scheme versioning + key
zeroization (H0.2), audit log hash-chain (H0.3), key rotation + versioning
(H0.4), cryptographic guarantees review (H0.5).

**Why this is a regression sentinel:** Before H0, the KDF was hardcoded
(PBKDF2-SHA256, 600k iters) with no algorithm field — migrating to
argon2id would break existing blobs. The audit log was plain JSON lines
with no integrity protection — an attacker with file access could modify
entries undetected. There was no key rotation mechanism — changing the
passphrase required manual re-encryption of every blob. H0 closes all
three gaps.

**H0.1 — KDF + derivation parameters:**
- New module `src/lib/trading/kdf.ts` centralizes KDF algorithm identifiers
  (`KDF_ALGO_PBKDF2_SHA256`), versions (`CURRENT_KDF_VERSION=1`), and the
  `deriveKey()` dispatch function. Architecture ready for future argon2id.
- `EncryptedBlob` gains optional `kdfAlgo`/`kdfVersion` fields. Pre-H0
  blobs default to `pbkdf2-sha256` v1 via `resolveKdfAlgo()`.

**H0.2 — Secret storage:**
- `EncryptedBlob` gains optional `encAlgo`/`encVersion` fields.
- `encryptSecret` emits version fields + zeroizes the derived key in `finally`.
- `decryptSecret` validates `encAlgo`/`encVersion`, dispatches via
  `deriveKey()`, zeroizes the key in `finally`. Unsupported algo → null.
- `zeroizeKeyBuffer(key)` fills the derived key Buffer with zeros after use.

**H0.3 — Audit log hash-chain:**
- New module `src/lib/audit/audit-log.ts` implements an append-only log
  where each entry's `hash` = SHA-256(canonical JSON excluding `hash`),
  and the next entry's `prevHash` references it.
- `AuditLog.verify(path)` detects modification, deletion, insertion.
- Signer initializes the audit log at boot, verifies chain integrity
  (logs loudly if broken, does NOT block boot).
- All wallet handlers write hash-chained audit entries:
  `vault_unlocked`, `vault_unlock_rate_limited`, `vault_unlock_empty`,
  `vault_unlock_failed`, `vault_locked`, `vault_zeroized_on_disconnect`.
- **CRITICAL BUG CAUGHT BY TESTING:** `JSON.stringify(entry, sortedKeysArray)`
  uses the replacer array form, which filters keys at ALL levels — dropping
  nested payload keys and making the hash independent of payload content.
  Fixed by building a sorted-key object and serializing normally. The H0.3
  tamper detection test caught this — without the test, the hash chain
  would have been security theater.

**H0.4 — Key rotation + versioning:**
- New module `src/lib/trading/key-rotation.ts` provides pure functions:
  `rotatePassphrase(blobs, oldPass, newPass)`,
  `rotateKdfParams(blobs, pass)`, `auditBlobVersions(blobs)`.
- `isBlobCurrent()` checks RAW blob fields (not resolved defaults) —
  ensures legacy blobs without explicit version fields are detected as
  stale and rotated to add the fields.
- Rotation is pure (no DB access) — caller responsible for atomicity.

**H0.5 — Cryptographic guarantees review:**
- Full review document at `docs/CRYPTO.md` covering:
  - Primitives in use (PBKDF2-SHA256, AES-256-GCM, SHA-256 hash chain).
  - Guarantees provided (confidentiality, integrity, KDF strength, forward migration).
  - Guarantees NOT provided (no forward secrecy, no key escrow, no HSM, no
    constant-time API-level comparison, tamper DETECTION not PREVENTION).
  - Key rotation procedures (change passphrase, bump KDF params, migrate algorithm).
  - Test coverage summary.
  - Future work (argon2id, HSM, audit log mirroring, AppLog hash chain).

**Test coverage:** 36 new assertions across 3 test files
(`test-h0-kdf-versioning.ts` 9, `test-h0-audit-hashchain.ts` 10,
`test-h0-key-rotation.ts` 14) + the integration test updated to verify
the hash chain end-to-end. CI gate is now 9 files / 78 checks.

**History:** Jul 14 2026 — H0 implemented after Phase 1 (signer isolation)
freeze. The operator's directed sequence was H0 → H1/H2 → M3/M4 (NOT
M3/M4 first), to consolidate the cryptographic foundation before expanding
the signer's functional surface. Each H0 subphase followed:
implement → test → fix → document → commit.

---

## H1 — Transaction lifecycle hardening (Jul 15 2026)

H1 hardens the entire transaction lifecycle: from RPC fan-out, through
pre-broadcast simulation, to approval hygiene and MEV baseline. H1
deliberately collapses what the original roadmap had as separate H1
(MEV), H2 (simulation + approvals), and H4 (RPC failover) into a
single hardening pass — the rationale is to keep the entire on-chain
communication + execution layer hardened as one perimeter before any
new signer feature (M3/M4) lands on top of it. The hardened primitives
exist alongside the paper-trading path; they will be WIRED into the
live-trading path when M3 lands, not before.

**Permanent principle added to HARDENING-ROADMAP.md before H1 began:**
> Every new cryptographic implementation must ship with at least one
> test that explicitly attempts to break the promised security property.

This principle was added after H0.3 revealed that `JSON.stringify(entry,
sortedKeysArray)` was silently dropping payload keys from the hash. The
H1 subphases each ship with explicit adversarial tests (per the
principle's table of examples).

### H1 subphases

**H1.1 — RPC Resilience (`src/lib/chain/rpc-resilience.ts`):**
- New module `QuorumRpcClient` providing four guarantees:
  - QUORUM — fan out to N healthy endpoints, require agreement fraction
    (default 0.5). Disagreement blocks the action.
  - HEALTH SCORE — per-endpoint [0..1] score; decays on failure,
    recovers on success. Endpoints below `healthFloor` (default 0.2)
    excluded from quorum.
  - FAILOVER — `readWithFailover` walks the healthy endpoint list in
    priority order until one succeeds; failover is observable
    (`failedOver` flag in the result).
  - CIRCUIT BREAKER — after N consecutive failures (default 5), the
    breaker opens for `breakerCooldownMs` (default 60s). After cooldown,
    a successful probe call closes the breaker.
- Injectable `Transport` function — tests use scripted mocks (including
  malicious endpoints returning wrong chain id, stale block, wrong
  balance); production wraps ethers' JsonRpcProvider (wired in M3).
- `serializeForQuorum(value)` — stable JSON serialization (sorted keys)
  so quorum comparison is robust to key-order variation across
  endpoints; sensitive to single-field changes; arrays preserve order.
- **CRITICAL BUG CAUGHT DURING H1.1 TESTING:** `recordFailure` was
  being called BOTH inside `callWithTimeout` AND in the caller's catch
  block, double-counting every failure and corrupting the health score.
  Fixed by consolidating to single recording inside `callWithTimeout`.

**H1.2 — Transaction Simulation (`src/lib/chain/simulation-gate.ts`):**
- New module `SimulationGate` providing the pre-broadcast gate:
  - Caller provides an `ExpectedDiff` (list of expected state changes +
    optional `maxGas` + optional `expectRevert`).
  - Gate calls an injectable `Simulator` function (production wraps
    `eth_call` with state override or `eth_simulateV1` when available).
  - Gate computes a diff between expected and simulated state changes.
    Returns `ok=false` (block broadcast) when:
      (a) simulation reverted (and caller didn't expect revert),
      (b) simulation produced state changes not in expected,
      (c) expected state changes missing from simulation,
      (d) amount mismatch beyond `amountToleranceBps` (default 50 = 0.5%),
      (e) gas used > `maxGas`.
- `compareAmounts(expected, simulated, toleranceBps)` — pure function
  using BigInt for safe comparison of atomic-unit amounts; symmetric
  tolerance; descriptive reason for any mismatch ("excess: ...",
  "deficit: ...", "non-integer: ...").

**H1.3 — Approval Hardening (`src/lib/chain/approval-hardening.ts`):**
- New module `ApprovalGate` enforcing four guarantees:
  - CAP ENFORCEMENT — every approval capped at min(requested, cap, balance).
    `maxApprovalPerSpender` is a per-spender hard cap.
  - UNLIMITED APPROVAL HARD BLOCK — `type(uint256).max` (and any
    numerically-equal value) is REJECTED regardless of policy. This
    cannot be bypassed by `allowFullBalanceApproval=true`.
  - OVER-APPROVAL BLOCK — if the CAPPED amount >= owner's balance
    (and `allowFullBalanceApproval=false`), rejected. Cap is applied
    FIRST so a 1M-token request against a 100-token cap gets capped to
    100 first, then over-approval sees 100 (not 1M).
  - LEDGER + REVOCATION — `ApprovalLedger` interface (in-memory impl
    for tests; Prisma-backed impl for production in M3) tracks every
    grant; `recordRevocation` marks revoked; `inventory(owner)` lists
    active (non-revoked) approvals.
- `MAX_UINT256` exported as a decimal string for comparison use.

**H1.4 — MEV Baseline (`src/lib/chain/mev-baseline.ts`):**
- New module providing:
  - `computeSlippageLimit(inputs)` — dynamic slippage limit in bps.
    Formula: baseline + volatilityBps*0.5 + (tradeSize/poolLiquidity)*10000*0.5,
    capped at `hardCapBps` (default 300 = 3%). The hard cap is the
    "infinity slippage = ok" defense.
  - `checkSlippage(expected, actual, inputs)` — applies the dynamic
    limit to an actual execution price; returns ok=true iff within
    tolerance.
  - `detectSandwich(victim, preState, postState, trades)` — analyzes
    observed pool activity for the sandwich signature (attacker BUY
    before victim BUY, attacker SELL after, with profit). Returns a
    score [0..1]; score >= 0.5 blocks the action. Score 1.0 =
    perfect sandwich (profit > 0); 0.5 = lone front-run (buy before
    victim, no profit yet); 0.4 = buy+sell pair around victim with no
    profit; 0.0 = no suspicious activity.
  - `Relay` interface + `PublicMempoolRelay` (default, uses standard
    `eth_sendRawTransaction`) + `PrivateRelayStub` (interface in place,
    throws "not implemented" — to be replaced with Flashbots Protect /
    Merlin / MEV-Share when M3+ lands). The stub explicitly forbids
    production use before it's wired.

### Adversarial tests (per the permanent principle)

Each H1 subphase ships with explicit adversarial tests that attempt to
break the property the primitive promises:

- **H1.1:** malicious endpoint returning wrong chain id is detected by
  quorum; stale block number detected; wrong balance detected.
- **H1.2:** honeypot sell (simulates as revert) is blocked; MAX_UINT
  approval (caller expected capped) is blocked; reentrancy gas drain
  is blocked; transfer to wrong recipient is blocked.
- **H1.3:** MAX_UINT cannot bypass even with `allowFullBalanceApproval=true`;
  over-approval cannot bypass via a cap higher than balance; cap boundary
  is exact (one wei above is capped); re-grant after revocation creates
  a new non-revoked record; inventory filter correctly excludes revoked.
- **H1.4:** 5% slippage on low-vol pool is blocked (dynamic limit ~50bps);
  sandwich with attacker profit of $0.01 is still detected (profit > 0,
  not > threshold); slow sandwich (sell in block N+2) is still detected;
  private-relay stub returns "not implemented" (no accidental production use).

**Test coverage:** 175 new assertions across 4 test files
(`test-h1-rpc-resilience.ts` 46,
`test-h1-simulation-gate.ts` 46,
`test-h1-approval-hardening.ts` 36,
`test-h1-mev-baseline.ts` 47). CI gate is now **13 files / 253 checks**
(was 9 files / 78 checks at H0 close).

**History:** Jul 15 2026 — H1 implemented immediately after H0 closure,
following the operator's mandated sequence H0 → H1 → H2 → M3 → M4. The
operator's directive was explicit: "Sem inserir novas funcionalidades
entre H1 e H2. Isso mantém a superfície de ataque mínima até que toda a
camada de comunicação e execução esteja endurecida." Each H1 subphase
followed: implement → test → fix → document → commit. Two real bugs
were caught during testing (the `recordFailure` double-count in H1.1,
and the cap-vs-overapproval ordering in H1.3) — both would have been
security-affecting in production and neither was caught by happy-path
tests.

## H2 — Contract interaction hardening (Jul 15 2026)

H2 hardens the on-chain read path that runs BEFORE any transaction is
built. Every contract the bot is about to interact with must be
verified (H2.1), every liquidity pool must be checked structurally
(H2.2), every token's authority model must be inspected (H2.3), and
every buy must be paired with a sell simulation (H2.4). The
operator's criterion is the load-bearing property:

> nenhum contrato desconhecido entra no pipeline.

H2 deliberately does NOT introduce real broadcast, real signing,
Flashbots, MEV Blocker, SUAVE, bundles, or private mempool — those
belong to M3/M4 when a real execution path exists. H2 keeps the
operational surface minimal while each contract-interaction defense
is validated independently.

### H2.1 — Contract Verification (`src/lib/chain/contract-verification.ts`)

`ContractVerifier` enforces 5 checks before any contract enters the
pipeline:

1. **Bytecode hash** — keccak256 of deployed bytecode must match
   `expectedBytecodeHash`. Refuses unknown bytecode by default;
   `allowBytecodeDrift` is the explicit opt-out (security smell,
   used only during initial onboarding).
2. **Selector allowlist** — every 4-byte selector extracted from
   the bytecode (via the `PUSH4 <sel> EQ` pattern) must be a subset
   of `expectedSelectors`. An extra `sweep()` / `setFee()` /
   `mint()` introduced by an upgrade is rejected.
3. **Owner/admin allowlist** — `owner()` return value must be in
   `allowedOwners`. `owner()=0x0` on a contract that exposes the
   `owner()` selector is treated as fake renounce (the contract
   kept privileged functions but reports no owner).
4. **Proxy detection** — EIP-1967 (transparent + minimal + beacon),
   EIP-1822 (UUPS), Diamond, custom. Proxy rejected unless
   `allowProxy=true`; when allowed, the IMPLEMENTATION contract is
   verified recursively with its own manifest (`maxProxyDepth`
   default 3).
5. **Upgradeability detection** — `upgradeTo` /
   `upgradeToAndCall` / `upgradeBeaconToAndCall` selectors, or
   proxy-with-non-zero-admin. Rejected unless `allowUpgradeable=true`.

Injectable `ChainReader` (getCode / getStorageAt / call) so tests
use deterministic mocks; production wraps `ethers.Provider` in M3.

Adversarial tests (per the permanent principle):
- D4: proxy impl swapped between two verifications (impl slot
  repointed; manifest pins impl address; second verify fails).
- D5: extra `sweep()` selector introduced post-upgrade (both the
  bytecode-hash gate AND the selector gate fire independently).
- D6: fake renounce with privileged selectors present (`mint` /
  `pause` / `setFee` + `owner()=0x0`).
- D7: caller-dependent owner (verifier-as-0x0 sees real owner and
  accepts; flipped contract returns 0x0 to verifier → fake-renounce
  detection fires).
- D8: beacon proxy with `upgradeBeaconToAndCall` selector rejected
  even with `allowProxy=true` (because `allowUpgradeable=false` by
  default).

### H2.2 — Liquidity Verification (`src/lib/chain/liquidity-verification.ts`)

`LiquidityVerifier` verifies liquidity STRUCTURALLY from on-chain
state (not from third-party APIs like DexScreener, which can lag or
be deceived). Five checks per pool:

1. **LP lock** — LP tokens held by a trusted lock contract (allowlist).
2. **Lock duration** — `unlockEpoch >= minLockEndEpoch` (default
   now + 7 days).
3. **Locked percentage** — `lockedAmount / lpTotalSupply >=
   minLockedFractionBps` (default 9500 = 95%).
4. **Multi-pool consistency** — every pool containing the token is
   verified; extra pools on-chain not in the manifest are rejected
   (strict by default; `allowExtraPools` is the opt-out).
5. **Removable liquidity** — unlocked LP tokens must be held by
   allowlisted addresses; the "locked 95%, unknown address holding
   the other 5%" pattern is rejected.

Adversarial tests:
- D1: "permanent lock that isn't" — `unlockTime=type(uint256).max`
  but `withdraw()` permissionless. The duration check alone is
  insufficient; the `withdrawPermissioned` check fires independently.
- D2: look-alike lock contract (off-by-one hex) rejected by exact
  match.
- D3: boundary test — 95.00% accepted, 94.99% rejected.
- D4: "rug between blocks" — verifier never caches state; first
  verify passes, deployer transfers LP to unknown address, second
  verify fails.

### H2.3 — Token Authority Verification (`src/lib/chain/token-authority.ts`)

`TokenAuthorityVerifier` checks every authority surface the contract
exposes — not just `owner()`. Per operator directive:

1. **Mint authority** — `mint(address,uint256)` selector present.
   Blocked unless `allowMintIfAllowlisted=true` AND access control
   recognized (`hasRole` selector) AND current owner in allowlist.
2. **Freeze authority** — `freeze(address)` / `freezeAccount(address)`.
3. **Blacklist authority** — `blacklist(address)` / `blockAccount(address)`.
4. **Pausability** — `pause()` / `setPaused(bool)`. Currently-paused
   contracts fail regardless of allowlist.
5. **Ownership transfer** — `transferOwnership(address)`. Live
   unless owner is allowlisted (trusted to manage ownership) or
   real-renounced (dead code).
6. **Real renounce** — verified via `OwnershipTransferred(_,0x0)`
   event AND current `owner()=0x0`. Either alone is insufficient
   (fake renounce).

Adversarial tests:
- D1: hidden mint (no `hasRole` selector, custom role system) →
  fail-closed by default.
- D2: two-step renounce trick — real renounce of Ownable but mint
  gated by separate role kept by deployer. Real renounce of Ownable
  ≠ real renounce of all authority.
- D3: paused renounce — real renounce + `pause()` present +
  unpaused. Fails by default; pause authority is independent of
  Ownable.
- D4: blacklist escape — `blacklist()` present, currently empty.
  Verifier rejects on selector presence alone; doesn't wait for
  the bot's address to actually be blacklisted.
- D5: caller-dependent owner — documented limitation; production
  source must `eth_call` with `from: <actual caller>`.

Implementation bugs caught + fixed during testing:
- `ownerIsZero` was initialized `true`, applying the renounce logic
  to contracts with NO `owner()` selector at all (would have
  blocked vanilla ERC-20s). Fixed by tracking `hasOwnerSelector`
  explicitly.
- `transferOwnership` "live" verdict was blocking when owner was
  allowlisted. Fixed: allowlisted owner is trusted to manage
  ownership.
- `mint()` with unrecognizable access control was only blocked via
  `failClosedOnHidden`; `allowMintIfAllowlisted=false` (default)
  wasn't independently blocking. Refactored: mint policy is now
  "block unless explicitly opted in" regardless of hidden flag.

### H2.4 — Sell Simulation (`src/lib/chain/sell-simulation.ts`)

`SellSimVerifier` closes the honeypot gap that H1.2 alone cannot:
H1.2 catches any single tx that reverts, but a honeypot lets the
BUY succeed (so the buy-side simulation passes) and reverts only
the SELL. H2.4 runs a PAIRED simulation: simulate the buy, then
simulate the sell from the post-buy state.

Five properties enforced:
1. Buy succeeds (does not revert).
2. Sell succeeds (does not revert) — the canonical honeypot catch.
3. Taxes match — observed buy/sell tax within `taxToleranceBps` of
   expected.
4. Exit possible — sell output >= `minExitAmount` (catches the
   "sell succeeds but returns 0" honeypot variant).
5. Slippage acceptable — measured AFTER expected tax; uses H1.4's
   `computeSlippageLimit` / `checkSlippage` primitives.

Adversarial tests:
- D1: classic honeypot (buy ok, sell reverts).
- D2: tax bait (buy tax 0%, sell tax 100%; sell "succeeds" but
  returns 0). Caught by BOTH tax-deviation AND exit-amount checks.
- D3: tax shift (first sell sim 5% tax, second 50% tax). Verifier
  never caches across calls; second `verify()` fails.
- D4: front-loaded exit (sell succeeds for 1 wei, reverts for the
  full position). Manifest's SellSpec uses the full position so the
  simulation reverts. Documents that dust-amount sell simulation
  can't substitute for full-position simulation.
- D5: slippage trap (sell at 50% below expected price). The dynamic
  slippage limit (hard cap 300 bps) catches it.
- D6: caller-dependent sell (sell succeeds for caller=0x0, reverts
  for caller=buyer). Verifier's simulator must use the seller from
  the manifest; caller-blind simulation is a vuln.

Implementation bug caught + fixed during testing:
- Slippage was measured against raw `expectedAmountOut`, not
  expected-after-tax. A caller expecting 5% tax would be flagged
  for 500 bps slippage even when the actual tax matched exactly.
  Fixed: slippage is now measured against
  `(expectedAmountOut * (1 - expectedTaxBps/10000))`, separating
  tax-tolerance from slippage-tolerance.

### H2.5 — Cross-cutting adversarial scenarios (`scripts/test-h2-adversarial.ts`)

Enumerates the six adversarial scenarios the operator mandated for
H2, maps each to the specific test(s) that cover it within H2.1-H2.4,
and adds the one scenario not previously covered:

1. LP removida entre blocos → h2.2 D4 + this file §1.
2. Owner muda durante execução → this file §2 (NEW).
3. Proxy muda implementação → h2.1 D4 + this file §3.
4. Sell passa 1a sim, falha 2a → h2.4 D3 + this file §4.
5. Taxas mudam após buy → h2.4 D3 + this file §5.
6. Contrato muda comportamento caller → h2.1 D7, h2.3 D5, h2.4 D6 + §6.

NEW scenario — "owner muda durante execução":
A contract that returns `OWNER_REAL` on the first `owner()` call and
`OWNER_OTHER` on subsequent calls. The H2.3 verifier calls `owner()`
ONCE per `verify()` flow and uses that single observation throughout
(test asserts `ownerCallCount === 1`). The verifier is internally
consistent but the test documents the residual vulnerability: a
malicious contract that knows the verifier calls `owner()` at time T
can be allowlisted at T and switch to a malicious owner at T+1 —
between `verify()` returning and the actual broadcast landing
on-chain. Mitigation is operator-side: bound the verify-to-broadcast
gap to one block + re-verify immediately before broadcast (the
pre-broadcast simulation gate from H1.2 + this verifier run together
at broadcast time).

### Test coverage

H2 added **205 new assertions** across **5 new test files**:

| File | Scenarios | Assertions |
|---|---|---|
| `test-h2-contract-verification.ts` | 18 | 59 |
| `test-h2-liquidity-verification.ts` | 16 | 46 |
| `test-h2-token-authority.ts` | 16 | 41 |
| `test-h2-sell-simulation.ts` | 16 | 42 |
| `test-h2-adversarial.ts` | 6 (cross-cutting) | 17 |
| **total** | **72** | **205** |

CI gate is now **18 files / 458 checks** (was 13 files / 253 checks
at H1 close — H2 added 5 files and 205 checks).

Three real bugs were caught during H2 testing:
1. H2.3 — `ownerIsZero` initialization applying renounce logic to
   contracts with no `owner()` selector (would have blocked vanilla
   ERC-20s).
2. H2.3 — `transferOwnership` "live" verdict blocking allowlisted
   owners.
3. H2.4 — slippage measured against raw expected instead of
   expected-after-tax, breaking the separation between tax-tolerance
   and slippage-tolerance.

All three would have been security-affecting in production. None
were caught by happy-path tests — each was caught by adversarial
tests that explicitly tried to break the property the verifier
promised, validating the permanent principle.

**History:** Jul 15 2026 — H2 implemented immediately after H1
closure, following the operator's mandated sequence H0 → H1 → H2 →
M3 → M4. The operator's directive was explicit: "Eu manteria H2
restrito ao endurecimento da interação on-chain, sem introduzir
envio real de transações." Each H2 subphase followed the same
discipline as H1: implement → test → fix → document → commit. The
hardened primitives in `src/lib/chain/` (now 9 files: 4 from H1, 5
from H2) are NOT yet wired into any production code path — they
wait for M3 to consume them, ensuring the live-trading path is born
hardened rather than retrofitted.

## H2.6 — Integration Gate (Jul 15 2026)

### Scope

H1 and H2 each validated hardened primitives in isolation: RPC
resilience, simulation, contract verification, liquidity, authority,
sell simulation, approval, MEV baseline. Each primitive has its own
unit + adversarial tests. What H2.6 proves is that the **composition**
of all primitives — when chained in the operator-mandated order —
preserves six load-bearing properties:

1. **ORDER** — gates run in the fixed sequence: RPC → Simulation →
   Contract → Liquidity → Authority → Sell-Sim → Approval → MEV →
   Signer. No reordering, no skipping.
2. **SHORT-CIRCUIT** — the first gate that fails stops the pipeline.
   Subsequent gates are NEVER invoked.
3. **ORIGINAL REASON PRESERVATION** — the failing gate's reason is
   propagated verbatim — not normalized, not truncated, not rewritten.
4. **AUDIT EXACTLY-ONCE** — every `process()` call writes exactly one
   audit entry. Success writes one entry; failure writes one entry;
   exception writes one entry. There is no path that writes zero
   entries, and no path that writes more than one.
5. **SIGNER GATING** — the signer is invoked iff every gate passes.
   Any gate failure → signer is not called.
6. **NO BYPASS** — there is no `skipGate` / `ignoreFailure` /
   `bypassOrder` option on `PipelineConfig`. The composer always runs
   every gate in fixed order.

H2.6 adds **no new functionality**. It only composes existing
primitives. The `Pipeline` class in `src/lib/chain/pipeline.ts` is the
integration layer that M3 will call; the `SignerSink` interface is the
placeholder for M3's real signer process (in H2.6 tests it is a mock).

### Implementation

- **`src/lib/chain/pipeline.ts`** — the `Pipeline` composer class.
  Takes a `PipelineConfig` holding all 8 gate instances + audit sink +
  signer sink. Exposes a single `process(req)` method that runs gates
  in fixed order, short-circuits on first failure, writes exactly one
  audit entry per call, and invokes the signer iff every gate passes.
  Each gate call is wrapped in try/catch so that a thrown exception
  (not just `ok=false`) is converted into a failed `PipelineResult`
  with `failedGate` set + `originalReason` prefixed with `exception:`.
  The `GATE_ORDER` constant is exported so tests can verify the
  canonical sequence.
- **`scripts/test-h2-integration-gate.ts`** — 119 assertions across 17
  scenarios (1 happy path + 9 per-gate failures + 7 adversarial).

### Adversarial tests

Per the permanent principle, H2.6 ships with adversarial tests that
explicitly try to break each promised property:

- **C.1 — No bypass option exists on PipelineConfig (static check)**:
  Inspects the `PipelineConfig` type to confirm there is no
  `skipGate` / `ignoreFailure` / `bypassOrder` / `disabledGates` key.
  An attacker who controls the request cannot make the composer skip
  a gate because the composer doesn't expose that capability.
- **C.2 — Double simultaneous failure (first-failure-wins)**:
  Configures TWO gates to fail simultaneously (contract bytecode
  mismatch + liquidity lock percentage too low). The pipeline must
  report the FIRST failure (contract) and never reach the liquidity
  gate. The liquidity failure reason must NOT appear in
  `originalReason`.
- **C.3 — Corrupted state between gates (no shared mutation)**:
  Mutates the `contractManifest.expectedBytecodeHash` AFTER the first
  `process()` call succeeds. The second `process()` must fail at the
  contract gate — proving the pipeline does not cache the manifest
  from the first call. Each gate receives its own slice of the
  request; there is no shared mutable state between gates.
- **C.4 — Audit exactly-once on exception path**:
  Makes the `SignerSink.submit()` throw (not just return `ok=false`).
  The pipeline catches the exception, writes exactly one
  `pipeline.failure` audit entry, and returns a failed result with
  `failedGate="signer"` + `originalReason` prefixed with `exception:`.
  This catches the bug class where a thrown exception bypasses the
  audit-write path.
- **C.5 — executedGates always forms a prefix of GATE_ORDER**:
  Runs 9 scenarios (happy path + 8 per-gate failures) and verifies
  that `executedGates` is always a prefix of `GATE_ORDER` — i.e.,
  the executed gates are always the first N gates of the canonical
  sequence, for some N. This catches any reordering or skipping.
- **C.6 — Signer receives the full SignerRequest**:
  Verifies that the signer receives the full `SignerRequest` — the
  tx, the expectedDiff, the approved amount (post-cap), the slippage
  limit, and the sandwich score. Catches the bug where the composer
  strips context before calling the signer.
- **C.7 — originalReason is byte-identical to the gate's raw reason**:
  Runs the contract verifier in isolation to get its raw
  `reasons.join("; ")`, then runs the full pipeline with the same
  configuration, and asserts `pipeline.originalReason ===
  rawResult.reasons.join("; ")`. Catches any normalization or
  rewriting of the reason string.

### Test coverage

H2.6 added **119 new assertions** across **1 new test file**:

| File | Scenarios | Assertions |
|---|---|---|
| `test-h2-integration-gate.ts` | 17 (1 happy + 9 per-gate + 7 adversarial) | 119 |
| **total** | **17** | **119** |

CI gate is now **19 files / 577 checks** (was 18 files / 458 checks
at H2 close — H2.6 added 1 file and 119 checks).

### Bugs caught

**Zero bugs caught during H2.6 testing.** This is the expected
outcome for a composition layer: the individual gates were already
well-tested in H1/H2 (which found 6 bugs total), and the composition
itself is straightforward (fixed-order iteration + short-circuit +
audit-write). The H2.6 test suite's value is **regression guard** —
it ensures future changes to the pipeline don't break the six
load-bearing properties. If a future maintainer adds a `skipGate`
option, reorders the gates, forgets to write the audit entry on the
success path, or normalizes the reason string, the H2.6 test will
catch it.

The fact that H2.6 found zero bugs does NOT weaken the permanent
principle — it validates that the principle was correctly applied
during H1 and H2. The composition layer is correct BECAUSE each
primitive was hardened under adversarial testing. H2.6 proves the
hardening composes.

**History:** Jul 15 2026 — H2.6 implemented immediately after H2
closure, following the operator's directive: "Criaria um H2.6. Não
adiciona funcionalidades. Apenas integração." The operator's
rationale was that H1 and H2 validated primitives in isolation, but
the composition (ordering, error propagation, fail-closed, audit
uniqueness, no-bypass) had not been demonstrated. H2.6 closes that
gap. M3 can now begin as pure orchestration of an already-validated
pipeline.

## M3 Readiness Review (Jul 15 2026) — ✓ PASSED

A review (NOT implementation) performed before opening M3, against the
operator's seven-point freeze checklist. The base layers (H0, H1, H2,
H2.6) were inspected for invariants that M3 will rely on but cannot
re-verify in isolation:

| # | Property | Evidence | Status |
|---|---|---|---|
| 1 | `Pipeline` is the only authorized path to the signer | `src/signer/main.ts` SIGNER_METHOD_ALLOWLIST = `health_check` + wallet methods only; no `sign`/`signTypedData`/`signMessage` exposed yet. `Pipeline.cfg.signer.submit()` is the only authorized sink. | ✓ PASS |
| 2 | No direct signer call outside the pipeline | `grep signer.submit` in `src/` returns only `pipeline.ts:643`. The web-process signer client (`src/lib/trading/signer-client.ts`) does not yet exist — M3 will create it as the sole consumer of the signer Unix socket. | ✓ PASS |
| 3 | No alternative broadcast path | `QuorumRpcClient.broadcastRawTransaction` is defined (`rpc-resilience.ts:332`) but `grep .broadcastRawTransaction(` returns 0 callers in production code. M4 will introduce the broadcaster downstream of the signer, never beside it. | ✓ PASS |
| 4 | No bypass flag in production builds | `grep process.env` in `src/lib/chain/` returns 0 matches — the chain layer does not read env vars at all. `PipelineConfig` has no `skipGate`/`ignoreFailure`/`bypassOrder`/`disabledGates` field (proven by H2.6 adversarial test C.1). Only `DISABLE_CRASH_HANDLERS` (test isolation) and `SIGNER_TEST_HOOKS` (boot-gated + second-layer `isTestHookMethod()` check; documented as NEVER set in production) — neither security-affecting. | ✓ PASS |
| 5 | Audit log covers success, failure, and exception exactly once | `Pipeline.cfg.audit.append()` is called ONLY inside `fail()` (pipeline.ts:314) and `succeed()` (pipeline.ts:341). Every gate is wrapped in try/catch so a thrown exception still routes through `fail()`. Proven by H2.6 adversarial test C.4 (exception path) + 9 per-gate failure scenarios + happy path. | ✓ PASS |
| 6 | All error returns preserve the original reason | `fail()` passes the raw gate reason verbatim. Proven byte-identical by H2.6 adversarial test C.7; no-leakage from non-executed gates proven by C.2. | ✓ PASS |
| 7 | The pipeline is deterministic for the same input | Security decisions (ok/reject) are pure functions of `PipelineRequest`. No `Math.random()` in `src/lib/chain/`. `Date.now()` is used ONLY for: (a) RPC circuit breaker state — stateful by design; (b) `grantedAt` metadata — not in the decision path; (c) `minLockEndEpoch` fallback — only when caller omits it; (d) audit timestamps — observability. | ✓ PASS-WITH-CAVEAT |

**Caveat on point 7:** callers SHOULD pin `minLockEndEpoch` explicitly
in `LiquidityManifest` to keep the liquidity gate fully reproducible.
The fallback (`Math.floor(Date.now()/1000) + 7*86400`) is a convenience
default, not a contract.

**Outcome:** All 7 properties hold. H0, H1, H2, H2.6 are declared
**FROZEN**. Any change to these layers during M3/M4 MUST be documented
as a regression correction (see REG-009 below).

---

## REG-009: H0/H1/H2/H2.6 freeze — M3 changes are regression-only

**Pin date:** Jul 15 2026 (M3 Readiness Review).

**Frozen files:**
- H0: `src/lib/audit/audit-log.ts`, `src/lib/trading/wallet-crypto.ts`,
  `src/lib/trading/kdf.ts`, `src/lib/trading/key-rotation.ts`
- H1: `src/lib/chain/rpc-resilience.ts`, `simulation-gate.ts`,
  `approval-hardening.ts`, `mev-baseline.ts`
- H2: `src/lib/chain/contract-verification.ts`,
  `liquidity-verification.ts`, `token-authority.ts`,
  `sell-simulation.ts`
- H2.6: `src/lib/chain/pipeline.ts`

**Rule:** During M3 and M4, any commit that modifies a frozen file
MUST:

1. Reference the original Hx.x stage in the commit message
   (e.g., `regression(H2.4): fix tax-bps off-by-one in sell-sim`).
2. Be accompanied by a regression test that demonstrates the bug +
   the fix (per the permanent adversarial-first principle).
3. Re-run the H2.6 adversarial suite (C.1–C.7) and confirm all 119
   assertions still pass — this guards the six composition properties.

**Rationale:** M3 is the execution layer (SignerAdapter → Signer RPC →
Broadcaster). It is a CONSUMER of the pipeline, not a peer. Allowing
M3 commits to evolve frozen layers would reintroduce the exact risk
the H1→H2→H2.6 sequence was designed to eliminate: bolting execution
logic onto primitives that have already been hardened under
adversarial testing. The freeze enforces the three-layer separation:

```
Layer 3 — Execution (M3, M4)         ← can change freely
Layer 2 — Composition (H2.6)         ← FROZEN
Layer 1 — Primitives (H0, H1, H2)    ← FROZEN
```

If M3 discovers a missing primitive, the correct response is to OPEN
A NEW HARDENING PHASE (e.g., H2.7), not to slip the primitive into
the execution layer.

**Why this is a regression entry, not a roadmap note:** Future
maintainers WILL be tempted to "refactor" the pipeline during M3 —
e.g., to share a helper between the SignerAdapter and the pipeline,
or to add a convenience flag to `PipelineConfig`. This entry exists
so that the next maintainer who reads SECURITY.md before making such
a change sees the freeze documented as a regression guard, not as a
stylistic preference. The discipline is the same as REG-001 through
REG-008: the rule is here so that the temptation to "simplify" it
back is met with a documented objection.

---

## M3.1 — SignerAdapter (Jul 15 2026)

### Scope

M3.1 introduces the `SignerAdapter` (`src/lib/chain/signer-adapter.ts`),
the first execution-layer component. It implements the `SignerSink`
interface defined in frozen `pipeline.ts` — replacing the mock that
H2.6 used with a real adapter that forwards sign requests over a Unix
socket to the signer process.

The adapter has exactly three responsibilities per the operator's M3.1
directive:

1. **Mapping** — translate `SignerRequest` (application-level, from
   frozen pipeline.ts) → `SignerWireRequest` (wire-level envelope:
   `{ protocolVersion, requestId, operation, payload, payloadHash }`).
   The payload is forwarded byte-identical. The `payloadHash` is
   SHA-256 of the canonical JSON, so the signer can verify integrity.

2. **Protocol validation** — TWO-POINT validation:
   - **Adapter-side** (pre-flight `health_check` probe; cached).
   - **Signer-side** (per-request `validateProtocolVersion` in
     `src/signer/main.ts`'s `dispatchRpc`).

3. **RPC serialization** — JSON-RPC 2.0 envelope, timeout, response
   parsing, structural validation, `requestId` echo check,
   `receivedPayloadHash` echo check.

The adapter does NOT do: broadcast, nonce management, writer lease,
multi-signer, key rotation, real signing, async queue, persistence,
retry, fallback, reconnection. Those belong to M3.2 / M3.3 / M4.

### Implementation

- **`src/lib/chain/signer-adapter.ts`** — `SignerAdapter` class.
  Implements `SignerSink.submit(req: SignerRequest): Promise<SignerResult>`.
  Uses an injected `SignerTransport` (interface) so tests can inject a
  mock; production will use a real Unix-socket transport (added in M3.2).
  Exposes 7 error codes via the `SignerAdapterError` enum: `PROTOCOL_MISMATCH`,
  `UNAVAILABLE`, `TIMEOUT`, `INVALID_RESPONSE`, `INVALID_REQUEST`,
  `PAYLOAD_CORRUPTED`, `RPC_ERROR`. The adapter NEVER throws — all errors
  are converted into `SignerResult` with `ok: false` and a descriptive
  `error` string prefixed with one of these codes.

- **`src/lib/signer-protocol.ts`** — added:
  - `SIGNER_PROTOCOL_MISMATCH_CODE = "SIGNER_PROTOCOL_MISMATCH"` — the
    string the dispatcher includes in the POLICY_VIOLATION message when
    the rejection is a version mismatch. The adapter recognizes this
    string and surfaces the error as `PROTOCOL_MISMATCH` (not a generic
    RPC error).
  - `validateProtocolVersion(params: unknown): string | null` —
    backward-compatible helper. Returns `null` if `params` has no
    `protocolVersion` field (existing wallet methods pass trivially)
    OR if the field matches `SIGNER_PROTOCOL_VERSION`. Returns a
    human-readable error string (prefixed with `SIGNER_PROTOCOL_MISMATCH:`)
    if the field is present but doesn't match.

- **`src/signer/main.ts`** — added per-request protocol validation
  in `dispatchRpc`, between the allowlist check and the handler
  dispatch. This is LAYER 1 code (OUR setup logic), not LAYER 2
  (downstream handler invocation) — so the Note 1 discipline (don't
  catch downstream exceptions) does not apply. A validation failure
  returns `POLICY_VIOLATION (-32006)` cleanly, no crash.

- **`scripts/test-m3-signer-adapter.ts`** — 60 assertions across 13
  scenarios: 4 contract + 4 transport + 3 security + 2 integration
  (real signer process).

### REG-010: Two-point protocol version validation

**Pin date:** Jul 15 2026 (M3.1).

**Rule:** Protocol version validation MUST occur at BOTH points:

1. **Adapter-side** (pre-flight) — `SignerAdapter.verifyProtocol()`
   sends a `health_check` RPC on first `submit()` call and compares
   the signer's reported `version` against `expectedProtocolVersion`.
   If mismatch, the adapter returns `SIGNER_PROTOCOL_MISMATCH` WITHOUT
   sending the sign request. This protects the internal system from
   sending requests to an incompatible signer.

2. **Signer-side** (per-request) — `dispatchRpc` in `src/signer/main.ts`
   calls `validateProtocolVersion(params)` before dispatching to any
   handler. If `params.protocolVersion` is present and doesn't match
   `SIGNER_PROTOCOL_VERSION`, returns `POLICY_VIOLATION (-32006)` with
   the `SIGNER_PROTOCOL_MISMATCH:` prefix. This protects the trust
   boundary — even a non-adapter client cannot bypass the version check.

**Why both:** The adapter's pre-flight catches mismatch early (before
constructing the sign request). The signer's per-request check catches
the case where the signer was upgraded between the adapter's pre-flight
and the actual sign request (e.g., the signer process was restarted
with a new version while the adapter's cached verification was still
valid). Removing either check reopens a gap:

- Removing the adapter pre-flight → the adapter constructs and sends
  a full sign request before discovering the mismatch, wasting work
  and leaking payload structure to an incompatible signer.
- Removing the signer per-request check → a non-adapter client (or a
  future adapter that bypasses the pre-flight) could send requests
  with an arbitrary version field, and the signer would dispatch them
  without validation.

**Regression test:** M3.1 test suite, scenarios A.2 (adapter pre-flight
blocks), B.4 (signer per-request rejects), D.1 (real signer process +
adapter with wrong expected version → mismatch detected end-to-end).

**Why this is a regression entry:** A future maintainer might be
tempted to "simplify" by removing one of the two checks ("it's
redundant, the other check catches it"). This entry documents that
both checks are load-bearing and serve different purposes. Removing
either one reopens a specific gap that M3.1 was designed to close.

### Test coverage

M3.1 added **60 new assertions** across **1 new test file**:

| File | Scenarios | Assertions |
|---|---|---|
| `test-m3-signer-adapter.ts` | 13 (4 contract + 4 transport + 3 security + 2 integration) | 60 |
| **total** | **13** | **60** |

CI gate is now **20 files / 637 checks** (was 19 files / 577 checks
at H2.6 close — M3.1 added 1 file and 60 checks). The frozen base
is untouched: H0/H1/H2/H2.6 all still pass their full suites.

### Bugs caught

**Zero bugs caught during M3.1 testing.** The adapter is a thin
translation layer over the `SignerSink` contract that H2.6 already
proven (via 9 per-gate failure tests using a mock SignerSink). M3.1
replaces the mock with a real adapter and confirms the contract still
holds.

Two test-fix iterations were needed during development (both in the
adapter, not in frozen code):

1. `verifyProtocol()` initially classified all transport-thrown errors
   as `UNAVAILABLE`, missing the `TIMEOUT` classification that `submit()`
   had. Fixed by extracting `classifyTransportError()` as a shared
   helper used by both methods.

2. The `METHOD_NOT_FOUND` special case in `submit()` didn't include the
   numeric error code in the returned string, breaking the D.2
   integration test assertion. Fixed by removing the special case and
   letting it fall through to the generic `RPC_ERROR` handler (which
   includes `${errCode}`).

Neither fix touched frozen code. Both were caught by the M3.1 test
suite itself — exactly the regression-guard purpose the permanent
principle mandates.

**History:** Jul 15 2026 — M3.1 implemented immediately after the M3
Readiness Review passed, following the operator's directive: "O
próximo passo deve ser M3.1 — SignerAdapter, mantendo o escopo mínimo
definido. Não alterar H0/H1/H2/H2.6." The frozen base was respected:
`grep` confirms zero modifications to the 10 frozen files listed in
REG-009. The only signer-side changes are to `src/lib/signer-protocol.ts`
and `src/signer/main.ts`, neither of which is in the frozen list.

---

## M3.2 — Signer RPC handlers (Jul 15 2026)

### Scope

M3.2 adds the three sign RPC handlers (`signTransaction`,
`signTypedData`, `signMessage`) to the signer process via a new module
`src/signer/sign-methods.ts`. Each handler implements exactly 5 steps
per the operator's M3.2 directive:

1. **Validate protocol** — done by `dispatchRpc`'s per-request
   `validateProtocolVersion` (added in M3.1).
2. **Verify vault is unlocked** — returns `SIGNER_VAULT_LOCKED` if not.
3. **Validate preconditions** — writer lease is an M4 SEAM (currently
   no-op via `checkWriterLease()`); the structure is in place so M4
   can replace the function without touching handler bodies.
4. **Sign with the wallet key** — ethers v6 `Wallet.signTransaction` /
   `signTypedData` / `signMessage`.
5. **Return the result** with echo fields (`requestId`,
   `receivedPayloadHash`, `signerVersion`) so the adapter can detect
   response confusion + payload corruption.

The handlers do NOT do: broadcast, nonce management, RPC submission,
retries, queues, failover, execution logic. Those belong to M3.3 / M4.

### Implementation

- **`src/signer/sign-methods.ts`** (NEW) — handler implementations +
  shared 5-step guard (`runSignGuard`) + DB-backed wallet-by-address
  lookup (`findSignableWalletForAddress`) + payload hash re-verification
  (`sha256Canonical`) + writer-lease M4 SEAM (`checkWriterLease`).
  Exposes 5 error code prefixes via `SignHandlerError`: `PAYLOAD_CORRUPTED`,
  `UNAUTHORIZED`, `INVALID_PARAMS`, `PRECONDITION_FAILED`, `SIGN_FAILED`.
  Handlers return application errors as `{ ok: false, ... }` with the
  echo fields populated; unexpected exceptions propagate (LAYER 2
  discipline — same as wallet-methods.ts).

- **`src/lib/signer-protocol.ts`** (NOT frozen) — added:
  - `signTransaction`, `signTypedData`, `signMessage` to
    `SIGNER_METHOD_ALLOWLIST` + `SignerMethodName` union.
  - `SignHandlerParams` (wire envelope — mirrors M3.1's
    `SignerWireRequest`), `SignPayload` (frozen adapter fields +
    forward-compatible extensions: `typedData`, `message`, `chainId`,
    `nonce`, `gasLimit`, `maxFeePerGas`, `maxPriorityFeePerGas`, `type`),
    `SignHandlerResultSuccess` / `SignHandlerResultFailure` /
    `SignHandlerResult`.
  - Protocol version NOT bumped (still `1.1.0-m2`) — the wire format
    is unchanged; M3.2 adds handlers, not envelope changes.

- **`src/signer/main.ts`** (NOT frozen) — wired `handleSignMethod` into
  `dispatchRpc` after `isWalletMethod`, before test hooks. LAYER 2
  discipline preserved: `return handleSignMethod(method, _params);` —
  no `.then()` / `.catch()` chain, no try/catch wrapping.

- **`scripts/test-m3-signer-handlers.ts`** (NEW) — 80 assertions
  across 7 categories: 3 functional baseline + 8 adversarial + 3
  integrity + 1 defense-in-depth protocol + 1 readOnly rejection + 1
  chainId override + 1 audit log verification. Uses REAL signer process
  + REAL Unix socket + REAL DB-seeded wallet (ethers
  `Wallet.createRandom` + `encryptSecret` + `db.walletConnection.create`).

### REG-011: Signer-side payload integrity re-verification

**Pin date:** Jul 15 2026 (M3.2).

**Rule:** The signer MUST recompute `payloadHash = SHA-256(canonical
JSON of payload)` from the received payload and reject on mismatch with
the envelope's `payloadHash` field. This is DEFENSE IN DEPTH on top of
the M3.1 adapter's hash computation.

**Why both:** The adapter computes the hash on its side (so it can
detect response confusion / payload corruption in the response). The
signer recomputes on receipt because the trust boundary is at the
signer, not the adapter. A payload that arrives at the signer with a
mismatched hash could mean:

- A transport bug corrupted the payload in transit.
- The adapter has a bug (sent the wrong hash).
- A man-in-the-middle modified the payload (unlikely on a Unix socket
  with 0600 permissions, but the check is cheap and the failure mode
  is catastrophic — signing the wrong payload).

Without the signer-side re-verification, the signer would sign whatever
payload arrived, regardless of whether it matched the hash the adapter
computed. The hash field would become advisory rather than enforced.

**Regression test:** M3.2 test suite, scenario B.2 (payload altered —
payloadHash mismatch → `SIGNER_PAYLOAD_CORRUPTED`, requestId still
echoed, receivedPayloadHash differs from envelope's because the signer
recomputed).

**Why this is a regression entry:** A future maintainer might be
tempted to "trust the adapter's hash" and skip the recomputation ("the
adapter already verified it, why duplicate the work?"). This entry
documents that the signer-side re-verification is load-bearing — it
defends against corruption that occurs AFTER the adapter computes the
hash (in the transport, or due to a signer-side bug that mangles the
parsed params).

### REG-012: Wallet-by-address lookup must verify key-derived address

**Pin date:** Jul 15 2026 (M3.2).

**Rule:** When the signer looks up a wallet by `tx.from` address, it
MUST verify that the decrypted private key actually derives the
expected address (via `new Wallet(key).address === tx.from`). This
check is in addition to the DB query that matches `address = tx.from`.

**Why both:** The frozen `wallet-crypto.ts` WalletVault stores keys in
a `Map<walletId, privateKey>` keyed by walletId, NOT by address. The
signer must look up the walletId via a DB query on
`WalletConnection.address`. However, a DB row could claim
`address=0xABC` but actually contain a key for `0xDEF` (corrupted data,
a compromised DB, or a botched wallet-import flow). Without the
key-derived address verification, the signer would sign with whatever
key the DB row pointed to — potentially signing with an attacker's key
for a victim's claimed address.

The key-derived address verification is a one-way assertion: the
decrypted key's address MUST match the DB's claimed address. If they
diverge, the signer refuses to sign (`SIGNER_UNAUTHORIZED` — the same
error as "no wallet matches", by design, to avoid leaking which
mismatch occurred).

**Regression test:** M3.2 test suite, scenario B.5 (random address →
`SIGNER_UNAUTHORIZED`) and E.1 (readOnly wallet → `SIGNER_UNAUTHORIZED`).
The key-derived verification is structurally present in
`findSignableWalletForAddress` — a future regression that removes the
`new Wallet(key).address` comparison would be caught by code review
against this REG entry.

**Why this is a regression entry:** A future maintainer might be
tempted to "trust the DB's address field" and skip the key-derived
verification ("the DB is the source of truth, why re-derive?"). This
entry documents that the DB is NOT the source of truth for which key
signs which address — the KEY is the source of truth, and the DB is
merely an index. The verification is what makes the index trustworthy.

### REG-013: Writer lease is a hard precondition (M4 SEAM)

**Pin date:** Jul 15 2026 (M3.2).

**Rule:** When M4 implements the writer lease, the lease check in
`checkWriterLease()` (src/signer/sign-methods.ts) MUST be a hard
precondition — there is no "soft" mode where signing proceeds without
the lease. The whole point of the writer lease is to serialize sign
access so a stale signer process can't race a fresh one.

**Current state (M3.2):** `checkWriterLease()` returns `null`
(precondition OK) for all calls. This is a documented SEAM — M3.2
doesn't have a writer lease yet, so the check is a no-op. The
function's structure (single function, returns `string | null`) is
designed so M4 can replace the body without touching any handler.

**Why this is a regression entry:** When M4 lands, there will be
pressure to add a "soft" mode (e.g., "if the lease check fails, log a
warning but proceed anyway, so we don't block trading during a lease
flap"). This entry documents that soft mode is FORBIDDEN — the lease
check is binary (held or not held), and "not held" means "refuse to
sign". The whole point of decoupling signing from broadcast (M3.2 from
M3.3) is that the signer can refuse without causing a half-broadcast
state. Soft mode would defeat this.

**Regression test:** M3.2 test suite, scenario B.7 (LAYER 2 discipline
structural check) confirms the precondition check IS invoked in the
5-step guard. When M4 implements the real check, a new test scenario
will verify that a missing lease → `PRECONDITION_FAILED` and NO signing
occurs.

### REG-014: Post-signature immutability (M3.3 — implemented Jul 15 2026)

**Pin date:** Jul 15 2026 (M3.3 architectural decision — recorded BEFORE
implementation, per the operator's directive).

**Implemented:** Jul 15 2026 — `src/lib/chain/broadcaster.ts`
`broadcastSignedTransaction()` method computes `expectedHash =
keccak256(rawSignedTx)` locally (via `@noble/hashes/sha3.js`) BEFORE
calling `QuorumRpcClient.broadcastRawTransaction`, then verifies
`broadcastResult.txHash === expectedHash`. Also verifies
`signerReportedHash === expectedHash` as a sanity check (the signer's
locally-computed hash should match our recomputation since both are
keccak256 of the same bytes). On any divergence, the Broadcaster fails
closed with `BROADCAST_IMMUTABILITY_VIOLATION` and does NOT report a
successful broadcast, even if the RPC claims success.

**Rule:** Once a transaction has been signed by the signer, the signed
bytes (`rawSignedTx`) MUST be treated as immutable by the Broadcaster.
The Broadcaster MUST compute `expectedHash = keccak256(rawSignedTx)`
locally BEFORE invoking `broadcastRawTransaction`, and MUST verify that
the broadcast-accepted hash matches `expectedHash`. Any divergence is a
critical integrity failure — the Broadcaster MUST fail closed and NOT
report a successful broadcast.

**Why this is load-bearing:** The whole point of the M3.2/M3.3
decoupling is that the signature covers EXACTLY the bytes that will be
transmitted. If the Broadcaster were allowed to modify the signed bytes
between signing and broadcast (e.g., "patch the nonce", "bump gas",
"adjust calldata"), the signature would no longer cover the actual
transmitted bytes — defeating the REG-011 signer-side payload
reverification and creating a trust gap between what the signer signed
and what the chain received.

**Relationship to REG-011:** REG-011 protects the payload BEFORE
signing (the signer recomputes `payloadHash` and rejects on mismatch).
REG-014 protects the signed bytes BEFORE broadcast (the broadcaster
recomputes `keccak256(rawSignedTx)` and rejects on mismatch with the
broadcast-returned hash). Together they form a closed integrity loop:

```
build payload → hash(payload) → sign(payload)         [REG-011 guards this]
                                     ↓
                          rawSignedTx (immutable)
                                     ↓
                  hash(rawSignedTx) → broadcast → verify hash   [REG-014 guards this]
```

**What this rule forbids:**

- Re-signing after nonce/gas resolution (Option B — rejected by the
  operator in the M3.3 architectural decision).
- Mutating `rawSignedTx` between signing and broadcast (any field).
- Trusting the RPC's returned hash without local recomputation.
- "Patching" a signed transaction to fix a stale nonce or insufficient
  gas — instead, the Broadcaster MUST fail closed and let M4's retry
  logic (when it lands) build a fresh transaction from scratch.

**Regression test:** M3.3 test suite (`scripts/test-m3-broadcaster.ts`):
- Scenario B.4 — RPC returns a hash different from the locally-computed
  `expectedHash` → Broadcaster fails closed with
  `BROADCAST_IMMUTABILITY_VIOLATION`. The error message includes both
  the RPC-returned hash and the locally-computed hash for diagnostics.
- Scenario B.8 — raw transaction altered after signature (simulated by
  having the broadcast handler tamper with the raw bytes and compute
  the hash of the tampered bytes) → Broadcaster fails closed with
  `BROADCAST_IMMUTABILITY_VIOLATION` because the signer-produced
  `rawSignedTx` and the tampered bytes hash differently.
- Scenario C.1 — structural immutability test verifies the closed loop:
  `buildTransaction → sign → hashBefore → broadcast → hashAfter ==
  hashBefore`. Confirms the broadcaster received EXACTLY the bytes the
  signer produced (byte-identical comparison) AND the returned txHash
  equals `keccak256(rawSignedTx)`.
- Scenario B.7 — malformed RPC response (non-hex txHash) → fails the
  immutability check because the malformed string does not match the
  locally-computed keccak256.

**Why this is a regression entry:** A future maintainer might be
tempted to "optimize" by skipping the local hash recomputation ("the
RPC already returns the hash, why compute it twice?") or to "fix" a
stale-nonce broadcast by patching the signed transaction ("just bump
the nonce in the signed bytes and re-broadcast"). Both patterns would
violate the immutability guarantee and create a trust gap. This entry
documents that the local hash recomputation is load-bearing — it is
the only thing that proves the bytes broadcast are the bytes signed.

### M3.3 Test coverage

M3.3 added **47 new assertions** across **1 new test file** +
**0 modifications to existing test files** (the M3.1 adapter test still
passes 59/59 unchanged because `submit()`'s contract is preserved):

| File | Scenarios | Assertions |
|---|---|---|
| `test-m3-broadcaster.ts` | 14 (3 functional + 8 adversarial + 1 structural immutability + 2 adapter integration) | 47 |
| **total** | **14** | **47** |

The M3.1 adapter was EXTENDED (not modified) with `signAndReturnRaw()`.
The existing `submit()` method + its 59-assertion test suite are
unchanged — backward compatibility is preserved by sharing the internal
`executeSign(req, requireRaw)` helper between the two public methods.

CI gate is now **22 files / 763 checks** (was 21 files / 716 checks at
M3.2 close — M3.3 added 1 file and 47 checks). The frozen base is
untouched: H0/H1/H2/H2.6/M3.1/M3.2 all still pass their full suites.

### Test coverage (M3.2 — historical)

M3.2 added **80 new assertions** across **1 new test file**:

| File | Scenarios | Assertions |
|---|---|---|
| `test-m3-signer-handlers.ts` | 17 (3 functional + 8 adversarial + 3 integrity + 1 defense-in-depth + 1 readOnly + 1 chainId + 1 audit) | 80 |
| **total** | **17** | **80** |

The M3.1 test file (`test-m3-signer-adapter.ts`) was updated: D.2
assertion changed from "signTransaction returns -32601" to "signTransaction
returns VAULT_LOCKED" (post-M3.2 behavior). The adapter CODE is
unchanged — only the test expectation. M3.1 assertion count: 60 → 59.

CI gate is now **21 files / 716 checks** (was 20 files / 637 checks at
M3.1 close — M3.2 added 1 file and 80 checks, minus 1 assertion removed
from M3.1's D.2 = net +79). The frozen base is untouched: H0/H1/H2/H2.6
all still pass their full suites.

### Bugs caught

**Zero bugs caught in signer-side code during M3.2 testing.** The
handlers delegate to ethers v6's well-tested signing primitives
(`Wallet.signTransaction` / `signTypedData` / `signMessage`), and the
5-step guard's structure was designed adversarially first (the test
matrix was defined before the handler bodies were written).

Three bugs were caught in the TEST FILE during iteration (all fixed,
none in production code):

1. B.7's regex `isSignMethod\(method\)[\s\S]*?\.catch\s*\(` was too
   greedy — matched a `.catch(` in a comment later in `main.ts`. Fixed
   by extracting the `dispatchRpc` function body first, then checking
   only within that body. Also added a positive assertion that the call
   shape is `return handleSignMethod(method, _params);` (no
   `.then`/`.catch` chain).

2. E.1 re-seeded the DB with a NEW wallet (different address), causing
   F.1 to fail (F.1 used the original `wallet.address` variable captured
   at the top of `main()`). Fixed by saving + restoring the original
   wallet's address + privateKey at the end of E.1.

3. F.1 used `assertEqual(parsed.chainId, 1, ...)` but ethers v6 returns
   `chainId` as `bigint`. `JSON.stringify(bigint)` throws "Do not know
   how to serialize a BigInt". Fixed with `Number(parsed.chainId)`.

None of these touched frozen code. All were caught by the M3.2 test
suite itself — exactly the regression-guard purpose the permanent
adversarial-first principle mandates.

**History:** Jul 15 2026 — M3.2 implemented immediately after the
operator approved M3.1 and closed M3.2 scope: "Implementar apenas os
handlers de assinatura: signTransaction, signTypedData, signMessage.
Todos devem: validar protocolo; verificar que o vault está desbloqueado;
validar pré-condições exigidas; assinar; retornar o resultado. Não
incluir ainda: broadcast; gerenciamento de nonce; envio para RPC;
retries; filas; failover; lógica de execução. Critério de aceite: o
adapter permanece inalterado; o pipeline permanece inalterado; apenas o
signer ganha capacidade de produzir assinaturas." The frozen base was
respected: `grep` confirms zero modifications to the 10 frozen files
listed in REG-009. The M3.1 adapter (`src/lib/chain/signer-adapter.ts`)
is also unchanged — only the M3.1 TEST FILE had its D.2 assertion
updated to reflect post-M3.2 behavior.

---

## REG-009: auth guard + RBAC + RLS — every protected route must verify session and permission, and RLS must filter by ownerId

**Test:** `tests/auth.test.ts` (8 assertions) + `scripts/test-auth-rbac.ts` (11 assertions) + manual `curl` checks (`POST /api/auth/login` → `Set-Cookie`, `GET /api/positions` without cookie → `401`, `viewer POST /api/kill-switch` → `403`, `viewer POST /api/reserve` → `403`).

**Code under test:** `src/lib/auth/session.ts` (`requireSession`), `src/lib/auth/rbac.ts` (`hasPermission`, `ROLE_PERMISSIONS`), `src/lib/auth/rls.ts` (`rlsWhere`, `assertOwner`), and every route handler that now calls `requireSession` + `hasPermission` (e.g., `src/app/api/status/route.ts:18`, `src/app/api/positions/route.ts:18`, `src/app/api/config/route.ts:18`, `src/app/api/kill-switch/route.ts:20`, `src/app/api/reserve/route.ts:18`, `src/app/api/wallets/route.ts:12`).

**What the test pins:** 
1. `viewer` cannot `engine:kill` or `reserve:manage` (matrix correctness).
2. `super_admin` bypasses RLS (returns `{}`), `viewer` gets `{ownerId: userId}`.
3. `assertOwner(viewer, walletOfAdmin)` throws `Forbidden`, `assertOwner(super_admin, walletOfAdmin)` passes.
4. `GET /api/positions` without `session` cookie → `401` (via `requireSession`), `GET /api/health` without cookie → `200` (public allowlist).
5. `viewer` session with valid cookie but `POST /api/kill-switch` → `403` (RBAC).

**Why this test exists (the regression it guards against):**
Before S02, every route was public — `GET /api/status` etc had no `requireSession` check. A future maintainer might "simplify" a route by removing the 2-line guard (`requireSession` + `hasPermission`) thinking it's boilerplate, or add a new route and forget the guard. RLS (`ownerId`) is also easy to forget — a new `findMany` without `where: {ownerId}` would leak cross-user data. The tests pin that the guards exist and that the matrix is correct.

**The correct structure (do not simplify away):**
```ts
// In every protected route handler:
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/positions");
    if (!rl.allowed) return NextResponse.json(..., {status:429});
    const session = await requireSession(req); // 401 if no/invalid cookie
    if (!hasPermission(session.role, "positions:read")) throw new ForbiddenError("positions:read"); // 403
    // ... RLS where: rlsWhere(session, 'walletConnection')
    const rows = await db.walletConnection.findMany({ where: rlsWhere(session, 'walletConnection') });
  } catch (err) { return handleApiError(err, "GET /api/positions"); }
}
```
The 3-layer defense is load-bearing: `checkRateLimit` (WAF), `requireSession` (auth), `hasPermission` (RBAC), `rlsWhere` (row-level). Removing any one reopens a gap. The permanent principle from HARDENING-ROADMAP applies: every new route must ship with at least one test that attempts to access it without auth and with wrong role.

**If you are tempted to "simplify" by removing the guard from a route:**
Don't. Read `tests/auth.test.ts` — it asserts `hasPermission('viewer','engine:kill')===false`. A route without the guard would allow viewer to kill. If you have a structural reason to make a route public, add it to the explicit public allowlist in `middleware.ts` and in the route's own comment, and update this REG entry.

**History:** Aug 27 2026 — S02 implemented after S01 foundation wiring. Operator's directive: close OWASP A01/A07 (public routes) before adding new features. S01 had 5 routes with rate-limit only; S02 adds auth+RBAC to 5 critical routes + wallets RLS. The auth helpers are pure and tested via `tests/auth.test.ts` (8 tests) + `scripts/test-auth-rbac.ts` (11 checks). No frozen `chain`/`signer`/`audit` files were touched (verified via `git diff --name-only`).
