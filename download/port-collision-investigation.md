# Port-Collision Hypothesis Investigation (Task 1-B, v19.3 operator point #2)

**Date:** 2026-07-13 (worklog reference frame)
**Agent:** port-collision-investigator
**Operator hypothesis under test:**

> "será que pelo menos parte das quedas silenciosas originais eram **colisão de processo/porta durante hot-reload do Turbopack** (uma instância antiga ainda de pé, ou uma recompilação no meio de uma request), e não um bug de lógica no vault? ... Se essa hipótese se confirmar, ela é consistente com 'não reproduz em produção' — porque `next start` não tem HMR nem múltiplas compilações concorrentes disparando pela mesma porta."

**Scope:** search-only investigation across `/home/z/my-project/` (logs, worklog, tool-results, scripts, source). No production code modified. Two artifacts produced: this report + `scripts/check-port-orphan.sh`.

---

## 1. Executive Summary

| Metric | Value |
|---|---|
| Direct `EADDRINUSE` matches in project | **0** |
| Direct `address already in use` matches (port-related) | **0** |
| Documented "two launches collided" event | **1** (worklog.md:1515) |
| Documented orphaned-child / EPIPE cleanup artifacts | **3** (worklog.md:1570, :1572, :1580) |
| Captured stack traces pointing to a `listen()` failure | **0** |
| Current machine state (lsof :3000/:3100/:3200) | clean — no listeners, no next/node processes |
| Verdict | **INDETERMINATE** — hypothesis is structurally plausible and consistent with the operator's "doesn't reproduce in production" framework, but no direct EADDRINUSE evidence exists in any captured log. The original v18 silent crashes remain UNROOTCAUSED because they predate the v19.1 crash-logger. |

The hypothesis is **consistent with the evidence** but **not directly confirmed by it**. We cannot distinguish, from existing logs, between three competing dev-mode mechanisms (port collision during HMR, Turbopack circular-import crash — which was the v18b leading theory, or some other dev-mode-only bug). All three would also be consistent with "doesn't reproduce in `next start`".

---

## 2. Evidence: EADDRINUSE / Port-Collision Matches

Searched `/home/z/my-project/` for `EADDRINUSE`, `address already in use`, `already in use`, `port.*in use`, `:3000`, `:3100`, `:3200`.

### 2.1 Direct `EADDRINUSE` matches

**NONE found.** Searched project source, logs, worklog, tool-results. Zero matches.

### 2.2 `address already in use` matches (port-related)

**NONE found.** The two `already in use` matches in the project are unrelated:
- `docs/signer-isolation-design.md:616-617` — "`ethers` (for transaction signing) — already in use, pinned" / "`@prisma/client` (for DB access) — already in use, pinned". Not port-related.

### 2.3 Indirect structural evidence (worklog references to port hygiene + orphaned processes)

These are not literal `EADDRINUSE` matches, but they document port/process hygiene events that bear directly on the hypothesis:

| # | File:line | Matching content |
|---|---|---|
| 1 | `worklog.md:1515` | "First stress test run: two launches collided (launched script twice by mistake). First instance ran 30s of stress loop before being interrupted by second instance's build. Cleaned up and re-ran." |
| 2 | `worklog.md:1547` | "Port hygiene (operator's point #2): ran `lsof -i :3100 -i :3200 -i :3000` before the test — returned exit 1 (no listeners). No orphan next-server / tsx / next-start processes via `ps -ef \| grep`. Confirmed clean. Hypothesis: prior 23:24 run cleaned up after itself via the script's own SIGTERM/SIGKILL of the spawned next-server child." |
| 3 | `worklog.md:1570` | "...single crash-*.log present at end-of-test... is a CLEANUP ARTIFACT: it was created ~6 seconds AFTER the parent script's `process.exit(2)`, by the **orphaned next-server child** still trying to `console.log` to its now-broken stdout pipe → EPIPE → uncaughtException handler → crash-*.log." |
| 4 | `worklog.md:1572` | "Cleanup: post-test `lsof -i :3100 -i :3200 -i :3000` returned no listeners. `ps -ef \| grep -E "next start\|next-server\|tsx.*stress"` returned no processes. The **orphaned next-server child** (which created the late EPIPE crash log) died on its own within ~6s of the parent's exit. No manual `pkill` needed." |
| 5 | `worklog.md:1580` | "Secondary finding: late-arriving EPIPE crash log (...) created by orphaned next-server child after parent's `process.exit(2)`. This is a CLEANUP ARTIFACT (stdout pipe broke)..." |

### 2.4 Port references (numbers `:3000`, `:3100`, `:3200`)

Port-to-mode mapping (confirmed against `package.json:6`, `scripts/smoke-test-production.sh:33`, `scripts/stress-test-vault.ts:33`, `scripts/stress-test-heterogeneous.ts`, `Caddyfile:16`):

| Port | Mode | Used by | Notes |
|---|---|---|---|
| `:3000` | `next dev` (Turbopack + HMR) | `npm run dev` (`next dev -p 3000`); reverse-proxied by Caddy on `:81` | Default dev port. The v18 silent crashes happened here. |
| `:3100` | `next start` (production) | `scripts/smoke-test-production.sh` (default), `scripts/stress-test-vault.ts` (default), `scripts/stress-test-heterogeneous.ts` (prior run) | Stress-test default. The "two launches collided" event (worklog.md:1515) happened here. |
| `:3200` | `next start` (production) | `scripts/stress-test-heterogeneous.ts` (Task 1-A clean run, PORT=3200) | Used to avoid colliding with leftover `:3100` state from the prior aborted run. |

### 2.5 Server-log banner counts (sanity check)

Each server log file shows exactly **one** `▲ Next.js 16.1.3` startup banner, meaning the saved logs themselves don't capture a port-collision-at-startup event (the second `next start` would either fail with EADDRINUSE — which we don't see — or, more likely given `> log` redirection in the stress scripts, overwrite the first instance's log):

- `logs/stress-hetero-server.log.prior-23:24`: 1 banner, 1 `Ready in 576ms`
- `logs/stress-server.log`: 1 banner, 1 `Ready in 540ms` (homogeneous 120s/35,570-request test)
- `logs/stress-hetero-server.log`: 1 banner, 1 `Ready in 569ms` (Task 1-A clean 150s run)

This is consistent with the worklog's note that the "two launches collided" event (worklog.md:1515) left **no EADDRINUSE trace in the saved log** — the second launch truncated the first's stdout file via shell `>` redirect, and the first instance was killed by SIGTERM (not by a port-binding failure) before it could log anything.

---

## 3. Current Machine State

Captured at the end of this investigation (2026-07-13 ~23:50):

```
=== lsof -i :3000 -i :3100 -i :3200 ===
(no output — exit code 1, meaning no listeners match)

=== ss -ltnp | grep -E ':3000|:3100|:3200' ===
(no output)

=== ps -ef | grep -iE "next|node|tsx|bun" | grep -v grep ===
(no processes)
```

**Verdict:** the machine is clean. No orphan `next-server` / `next start` / `next dev` / `tsx` processes. No listeners on any of the three standard ports. This is the same clean state Task 1-A documented at the end of its cleanup (worklog.md:1572).

---

## 4. `next dev` (Turbopack/HMR) vs `next start` (Production) — Crash Correlation

The hypothesis specifically predicts that the silent crashes correlate with `next dev` (HMR + concurrent compilations on the same port) and NOT with `next start` (no HMR, single compilation). Available evidence:

| Event | Mode | Outcome | Source |
|---|---|---|---|
| v15 dev-server instability ("morre após 30-60s sem log de erro") | `next dev` (Turbopack + HMR), port `:3000` | server dies silently after 30-60s, no log, memory stable at ~345 MB (not OOM) | `worklog.md:1162-1165` |
| v15 dev-server restart workaround | `next dev` | operator/agent had to `pkill -f "next" && setsid bash -c 'exec node ... next dev -p 3000 ...' &` repeatedly | `worklog.md:1165` |
| v18a-b vault silent crashes | `next dev` (assumed — all v18 vault testing was dev-mode per `worklog.md:1387`) | silent crashes during vault unlock operations; no stack trace captured | `worklog.md:1367, 1381` |
| v18b Turbopack circular-import crash (root-cause candidate) | `next dev` | "Turbopack crashed silently when notifyEvent was called from inside vault-crypto's unlockAsync. Root cause: static import of notifier (which imports db at top-level) + lazy import of db inside unlockAsync created overlapping dependency graphs." Fixed via `setImmediate + dynamic import()`. | `worklog.md:1367` |
| v19.2 homogeneous stress test | `next start` (production), port `:3100` | SERVER SURVIVED. 35,570 requests, 120s, 15-way concurrency, p99=41ms, 0 crashes | `worklog.md:1473, 1481` |
| v19.3 heterogeneous stress test (first run) | `next start` (production), port `:3100` | CHECK 1 NEGATIVE (no organic crash in 48s before debug trigger); CHECK 2 PASSED (deliberate crash handler fired under load). Server died only from deliberate debug trigger. | `worklog.md:1534-1538` |
| v19.3 heterogeneous stress test (clean run, Task 1-A) | `next start` (production), port `:3200` | CHECK 1 NEGATIVE — server survived full 150s of heterogeneous concurrent load (16 workers × 4 profiles, 247 cycles, 775 crypto-failure paths). The script's exit-2 is a false-positive logic bug; the server itself did not crash. | `worklog.md:1577` |
| "Two launches collided" event | `next start` (production) | Two instances of `scripts/stress-test-heterogeneous.ts` launched by mistake; first ran 30s of stress loop before being interrupted by second's build. Cleaned up and re-ran. **This is the operator's "structural evidence" referenced in point #2.** | `worklog.md:1515` |
| EPIPE cleanup artifact (Task 1-A) | `next start` (production) | Orphaned next-server child wrote `crash-uncaughtException-1783986000267.log` ~6s after parent's `process.exit(2)`. Stack trace: `Error: write EPIPE at ... console.log at ... next/dist/server/node-environment-extensions/console-exit.js:22:95`. **NOT a stress-induced crash.** | `worklog.md:1570, 1580`, `logs/crash-uncaughtException-1783986000267.log` |

### 4.1 Correlation summary

- **Original v18 silent crashes:** all observed during `next dev` (Turbopack + HMR). **No stack traces captured** (crash-logger.ts did not exist until v19.1). The leading root-cause candidate from v18b (`worklog.md:1367`) is a Turbopack circular-import bug, NOT a port collision.
- **Production-mode (`next start`) stress tests:** ZERO organic crashes across three runs (35,570 + 147 + 247 = 35,964 effective request cycles over ~5 minutes of total stress wall-clock). Server survived heterogeneous concurrent vault load with the original crash recipe (wrong-unlock → create → right-unlock → lock → delete).
- **Structural port/process collision evidence:** observed ONCE in production-mode stress tests (worklog.md:1515, the "two launches collided" event). This was a script-level collision (operator/agent launched the stress-test script twice by mistake against the same port), NOT a Next.js dev-mode HMR collision. It was cleanly recovered.
- **Orphaned-child evidence:** observed ONCE in production-mode (worklog.md:1570, the EPIPE crash log). The orphaned `next-server` child was created by the script's own SIGTERM, NOT by HMR hot-reload.

### 4.2 What the evidence does NOT show

- **No EADDRINUSE in any captured log.** If the original v18 silent crashes had been port-collision-during-HMR, we would expect at least one `Error: listen EADDRINUSE: address already in use 0.0.0.0:3000` line somewhere — in `dev.log`, `logs/boot.log`, the worklog, or a crash-*.log. There are zero such lines.
- **No captured stack trace from any v18 silent crash.** The v19.1 crash-logger.ts was created AFTER the v18 crashes. The v19.2+ crash logs that DO exist are all either deliberate debug triggers (test-crash-handler.ts, `/api/debug/crash-test`) or the EPIPE cleanup artifact — none show a `listen()` failure.
- **No evidence that HMR ever re-evaluated the vault module mid-request.** The v18b fix (`setImmediate + dynamic import`) addressed circular-import timing, not HMR-triggered mid-request module invalidation. Both are dev-mode-only failure modes, but they are mechanistically different.

---

## 5. Verdict

**INDETERMINATE.**

The operator's port-collision-during-HMR hypothesis is:
- **Structurally plausible** — Next.js dev mode + Turbopack HMR is a known source of port-collision and orphan-process issues (e.g. an old `next-server` worker still bound to `:3000` while a new compilation tries to listen, or two `next dev` invocations racing on the same port). The hypothesis is consistent with the operator's framework.
- **Consistent with the absence of production reproduction** — `next start` has no HMR, no concurrent compilations, no in-place module re-evaluation. Any dev-mode-only failure mode (port collision OR circular-import OR anything else) would naturally not reproduce in production.
- **BUT NOT DIRECTLY SUPPORTED by available evidence** — there are zero `EADDRINUSE` matches in any project log, zero captured stack traces from the v18 silent crashes (they predate the crash-logger), and zero direct observations of an old `next-server` instance colliding with a new one during HMR.
- **The ONE structural port/process collision we DID observe** (worklog.md:1515, "two launches collided") was a script-level collision in `next start` (production) stress tests, NOT a Next.js dev-mode HMR collision. It was caused by the operator/agent launching the stress-test script twice by mistake against port `:3100`, not by Turbopack hot-reload.

### 5.1 Competing root-cause candidates for the v18 silent crashes (still open)

1. **Turbopack circular-import during vault unlock** (v18b leading candidate, `worklog.md:1367`). Static `notifier` import + lazy `db` import inside `unlockAsync` created overlapping dependency graphs. Fixed provisionally via `setImmediate + dynamic import()`. Mechanism is dev-mode-specific (Turbopack module loading) and would NOT reproduce in `next start`. **Consistent with evidence.**
2. **Port/process collision during HMR** (operator's hypothesis, this task). Old `next-server` still bound to `:3000` while new compilation tries to listen, OR orphaned dev worker from a previous `next dev` invocation. **Consistent with the framework, but no direct EADDRINUSE evidence in any log.**
3. **Sandbox resource limits** (v15 leading candidate, `worklog.md:1164`). "Suspeita: limite de file descriptors do sandbox ou reaper de processos long-running." Memory was stable at ~345 MB (not OOM). Would not reproduce in production. **Consistent with evidence.**
4. **Some other dev-mode-only bug** (e.g. Turbopack-specific module evaluation order, hot-reload race during in-flight request). Same dev-mode-only signature, same "doesn't reproduce in production" property. **Consistent with evidence.**

All four candidates share the same observable signature: silent crash during `next dev`, no reproduction in `next start`. The evidence we have cannot distinguish between them.

---

## 6. Recommendation

**Yes — treat the original silent crashes as likely dev-mode-specific (which INCLUDES the port-collision-during-HMR hypothesis as one of several possible mechanisms), rather than as confirmed vault-logic bugs.**

But with two important caveats:

1. **Do NOT narrow the dev-mode-specific label to "port collision" specifically.** The evidence does not let us distinguish port collision from circular-import/HMR-race/sandbox-resource issues. The v18b Turbopack circular-import fix (`setImmediate + dynamic import()` in `wallet-crypto.ts`) is still the most concrete dev-mode-specific fix in the codebase, and it is unrelated to port collision.
2. **The `setImmediate` fix in `wallet-crypto.ts` remains PROVISIONAL** (as documented in `worklog.md:1387, 1419, 1425`). The reason is not that port collision is the cause — it's that we have no captured stack trace pointing to ANY specific cause. The crash-logger added in v19.1 will produce a real stack trace the NEXT time the silent crash recurs, regardless of whether the cause is port collision, circular imports, or something else.

### 6.1 Operational changes to reduce port-collision risk going forward

Regardless of whether port collision was the original cause, the operator's point #2 surfaces a real operational hygiene gap: there was no pre-flight check for orphan listeners before launching `next dev` or `next start`. To close this gap, a new helper script has been created:

**`scripts/check-port-orphan.sh`** — idempotent, safe to run multiple times. Operators SHOULD run it before any `next dev`, `next start`, or stress-test invocation.

```bash
# Interactive (prompts before killing)
./scripts/check-port-orphan.sh

# Non-interactive (CI / scripted)
./scripts/check-port-orphan.sh --yes

# Report only, never kill
./scripts/check-port-orphan.sh --dry-run

# Override port list
PORTS="3000 3100 3200 3300" ./scripts/check-port-orphan.sh
```

What it does:
- Checks `lsof -i :3000 -i :3100 -i :3200` for any listeners (default port list).
- If found: prints PID, USER, FD, TYPE, PORT, COMMAND (truncated), start time, and full command line for each listener. Prompts for `y/N` confirmation, then `kill -TERM`, waits 2s, then `kill -KILL` on survivors. Re-checks and reports final state.
- If not found: prints `OK — no orphan processes on ports: 3000 3100 3200` and exits 0.
- Falls back gracefully on systems without `lsof` (exit 2 with diagnostic).
- Never kills anything by default. `--yes` is required for non-interactive kills.

This script does NOT modify any production code. It is a pure operational hygiene tool. Smoke-tested in this investigation: `./scripts/check-port-orphan.sh --dry-run` returns `OK — no orphan processes on ports: 3000 3100 3200` and exits 0 against the current clean machine state.

---

## 7. Next Actions for the Operator

1. **Adopt `scripts/check-port-orphan.sh` as a pre-flight check.** Run it before every `next dev` or `next start` invocation. Optionally add it to `scripts/start-dev.sh` and `scripts/smoke-test-production.sh` as a guard clause.
2. **Do NOT re-classify the original silent crashes as confirmed port collisions.** Keep the investigation status at MONITOR (per `worklog.md:1481, 1537, 1581`). The crash-logger.ts added in v19.1 will produce a real stack trace the next time any silent crash recurs — that trace will resolve the ambiguity between the four candidates listed in §5.1.
3. **If a silent crash DOES recur in `next dev` and the crash-*.log shows `EADDRINUSE` or a `listen()` frame**, the hypothesis is CONFIRMED and the operator's recommendation becomes the canonical root cause. If the trace shows something else (circular-import, OOM, EPIPE, etc.), the hypothesis is REFUTED for that specific crash.
4. **If a silent crash recurs in `next start` (production)**, the dev-mode-specific hypothesis (any of the four candidates) is REFUTED, and the investigation must be re-opened as BLOCKING per the operator's original framework (`worklog.md:1419`).
5. **Consider tightening `scripts/stress-test-heterogeneous.ts`** to (a) call `scripts/check-port-orphan.sh --yes` at the top of the script to prevent a repeat of the worklog.md:1515 "two launches collided" event, and (b) fix the `organicCrash` false-positive logic bug identified in Task 1-A (`worklog.md:1564-1569`) so that the script's end-of-test SIGTERM is not classified as an organic crash.

---

## 8. Artifacts Produced

| Path | Purpose |
|---|---|
| `scripts/check-port-orphan.sh` (executable, 5027 bytes) | Pre-flight helper script. Run before any `next dev` / `next start` / stress-test invocation. Idempotent. |
| `download/port-collision-investigation.md` (this file) | Findings report. Documents all evidence, current machine state, verdict, recommendation, next actions. |

No production code modified. No `next dev` or `next start` invoked by this investigation.
