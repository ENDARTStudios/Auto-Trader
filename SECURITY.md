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
