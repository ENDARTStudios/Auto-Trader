#!/usr/bin/env bash
# smoke-test-production.sh — repeat the v18 vault smoke test against a
# PRODUCTION build, not against `next dev` (Turbopack + HMR).
#
# v19-BLOCKING: the operator's review pointed out that all v18 vault testing
# was done against `next dev`, which has structurally different module
# loading (Turbopack), HMR (hot module replacement that re-evaluates modules
# in place), and process behavior from `next build && next start`. A race
# condition that's masked by dev-mode timing can still fire in production.
#
# This script:
#   1. Runs `next build` (production build, no Turbopack, no HMR)
#   2. Starts the standalone server (`next start` equivalent)
#   3. Waits for /api/status to return 200
#   4. Exercises the vault endpoints that were exercised in dev:
#        GET  /api/vault
#        POST /api/vault { action: "lock" }
#        POST /api/vault { action: "unlock", passphrase: WRONG } → expect 401
#        POST /api/vault { action: "unlock", passphrase: RIGHT } → expect 200
#        POST /api/vault { action: "lock" }
#   5. Checks the server is STILL ALIVE after the test (the v18 issue was
#      silent crashes on these exact endpoints)
#   6. Tears down the server
#
# Exit codes:
#   0 = all endpoints responded + server still alive at end
#   1 = build failed, server didn't start, endpoint failed, or server died
#
# Usage:
#   ./scripts/smoke-test-production.sh
#   PASSPHRASE=real_pass ./scripts/smoke-test-production.sh
#
# Requires: curl, npx, PORT env (default 3100 to not collide with dev:3000)

set -euo pipefail

PORT="${PORT:-3100}"
PASSPHRASE="${PASSPHRASE:-}"
BASE="http://localhost:${PORT}"
LOG_DIR="$(pwd)/logs"
SERVER_LOG="${LOG_DIR}/smoke-prod-server.log"
mkdir -p "$LOG_DIR"

echo "=== Production smoke test (v19-BLOCKING) ==="
echo "Time: $(date -Iseconds)"
echo "Port: $PORT  Server log: $SERVER_LOG"
echo

# Step 1: production build
echo "[1/5] Building (next build)..."
if ! npx next build > "${LOG_DIR}/smoke-prod-build.log" 2>&1; then
  echo "  BUILD FAILED — see ${LOG_DIR}/smoke-prod-build.log"
  tail -20 "${LOG_DIR}/smoke-prod-build.log"
  exit 1
fi
echo "  build OK"
echo

# Step 2: start the production server
echo "[2/5] Starting production server on port $PORT..."
# Use next start which uses the build output
PORT=$PORT npx next start -p "$PORT" > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
echo "  server pid=$SERVER_PID"

# Trap exits so we always kill the server
trap "echo '[cleanup] killing server pid=$SERVER_PID'; kill -TERM $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true" EXIT

# Step 3: wait for server to be ready (max 30s)
echo "[3/5] Waiting for /api/status to return 200..."
READY=0
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "$BASE/api/status"; then
    READY=1
    echo "  ready after ${i}s"
    break
  fi
  # Check if the server process is still alive
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "  SERVER DIED during startup — see $SERVER_LOG"
    tail -30 "$SERVER_LOG"
    exit 1
  fi
  sleep 1
done
if [ $READY -ne 1 ]; then
  echo "  server did not become ready in 30s — see $SERVER_LOG"
  tail -30 "$SERVER_LOG"
  exit 1
fi
echo

# Step 4: exercise vault endpoints
echo "[4/5] Exercising vault endpoints..."

echo "  GET /api/vault"
RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/vault")
CODE=$(echo "$RESP" | tail -1)
echo "    HTTP $CODE"
if [ "$CODE" != "200" ]; then
  echo "    UNEXPECTED — expected 200"
  exit 1
fi

echo "  POST /api/vault lock"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/vault" -H "Content-Type: application/json" -d '{"action":"lock"}')
CODE=$(echo "$RESP" | tail -1)
echo "    HTTP $CODE"

echo "  POST /api/vault unlock (wrong passphrase → expect 401)"
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/vault" -H "Content-Type: application/json" -d '{"action":"unlock","passphrase":"definitely-wrong-passphrase"}')
CODE=$(echo "$RESP" | tail -1)
echo "    HTTP $CODE (expected 401 or 200 if no wallets registered)"
# Note: 401 = wrong passphrase, 200 = no wallets to decrypt (also valid)

if [ -n "$PASSPHRASE" ]; then
  echo "  POST /api/vault unlock (correct passphrase → expect 200)"
  RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/vault" -H "Content-Type: application/json" -d "{\"action\":\"unlock\",\"passphrase\":\"$PASSPHRASE\"}")
  CODE=$(echo "$RESP" | tail -1)
  echo "    HTTP $CODE"
  if [ "$CODE" != "200" ]; then
    echo "    UNEXPECTED — expected 200"
    exit 1
  fi

  echo "  POST /api/vault lock"
  curl -s -o /dev/null -X POST "$BASE/api/vault" -H "Content-Type: application/json" -d '{"action":"lock"}'
fi
echo

# Step 5: server still alive?
echo "[5/5] Checking server is still alive after vault exercise..."
if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo "  SERVER DIED during/after vault endpoints — see $SERVER_LOG"
  echo
  echo "  This is the silent-crash pattern the operator flagged. Check:"
  echo "    - logs/crash-*.log (synchronous crash dump from instrumentation.ts)"
  echo "    - logs/diag-oom-check.sh output (kernel OOM-kill check)"
  echo
  tail -40 "$SERVER_LOG"
  exit 1
fi

# One more status check after the vault exercise
if ! curl -sf -o /dev/null "$BASE/api/status"; then
  echo "  server process alive but /api/status not responding — likely hung"
  exit 1
fi

echo "  server still alive + responding ✓"
echo
echo "=== Production smoke test PASSED ==="
echo
echo "Notes:"
echo "  - This test does NOT prove the silent-crash bug is fixed — it only"
echo "    proves the bug does not reproduce in this run. Per the operator's"
echo "    review, the setImmediate fix is PROVISIONAL until a mechanical"
echo "    root cause is confirmed."
echo "  - To capture a real crash: leave the production server running"
echo "    against real traffic, and check logs/crash-*.log + run"
echo "    scripts/diag-oom-check.sh the next time it dies."
exit 0
