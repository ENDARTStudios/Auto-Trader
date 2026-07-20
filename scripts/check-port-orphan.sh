#!/usr/bin/env bash
# check-port-orphan.sh — pre-flight check for orphan next/node processes
# listening on the standard dev / stress-test ports.
#
# Created by Task 1-B (port-collision hypothesis investigation, v19.3 point #2).
# Operators SHOULD run this BEFORE any `next dev`, `next start`, or stress-test
# invocation. It is idempotent and safe to run multiple times.
#
# What it does:
#   1. Checks `lsof -i :3000 -i :3100 -i :3200` for any listeners
#   2. If listeners found: prints PID, command, user, FD, and start time
#      for each, then prompts for confirmation before killing them
#   3. If no listeners: prints "OK — no orphan processes" and exits 0
#
# Exit codes:
#   0 = no listeners found (clean), OR listener(s) found and killed cleanly
#   1 = listener(s) found and operator declined to kill them
#   2 = lsof not available / system error
#
# Usage:
#   ./scripts/check-port-orphan.sh              # interactive (prompt before kill)
#   ./scripts/check-port-orphan.sh --yes        # kill without prompting (CI / scripted)
#   ./scripts/check-port-orphan.sh --dry-run    # report only, never kill
#   PORTS="3000 3100 3200" ./scripts/check-port-orphan.sh   # override port list
#
# Notes:
#   - The default ports cover: 3000 (npm run dev / next dev -p 3000),
#     3100 (smoke-test-production.sh + stress-test-vault.ts default),
#     3200 (stress-test-heterogeneous.ts default for the clean CHECK-1 run).
#   - The script never kills anything by default. Use --yes to bypass the prompt.
#   - The script uses `lsof -ti` to extract PIDs, then `kill -TERM` first
#     (graceful), waits 2s, then `kill -KILL` (forceful) if still alive.

set -euo pipefail

PORTS="${PORTS:-3000 3100 3200}"
AUTO_YES=0
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --yes|-y) AUTO_YES=1 ;;
    --dry-run|-n) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if ! command -v lsof >/dev/null 2>&1; then
  echo "ERROR: lsof not found in PATH. Install lsof or use ss/netstat as a fallback." >&2
  exit 2
fi

# Build lsof args: -i :3000 -i :3100 -i :3200
LSOF_ARGS=()
for p in $PORTS; do
  LSOF_ARGS+=( -i ":${p}" )
done

# `lsof` exits 1 if no listeners match — that's the clean state.
LISTENERS="$(lsof "${LSOF_ARGS[@]}" 2>/dev/null || true)"

if [ -z "$LISTENERS" ]; then
  echo "OK — no orphan processes on ports: ${PORTS}"
  exit 0
fi

echo "=== Listeners found on ports: ${PORTS} ==="
echo
# Header
printf '%-8s %-8s %-8s %-8s %-12s %s\n' "PID" "USER" "FD" "TYPE" "PORT" "COMMAND (truncated)"
printf '%-8s %-8s %-8s %-8s %-12s %s\n' "---" "---" "---" "---" "---" "---"
# lsof default output columns: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
# We re-parse and pretty-print. The NAME column looks like "*:3000 (LISTEN)".
echo "$LISTENERS" | tail -n +2 | while IFS= read -r line; do
  # shellcheck disable=SC2086
  set -- $line
  CMD="$1"; PID="$2"; USER="$3"; FD="$4"; TYPE="$5"; NAME="${10:-}"
  # Truncate command to 40 chars for readability
  CMD_TRUNC="$(printf '%.40s' "$CMD")"
  printf '%-8s %-8s %-8s %-8s %-12s %s\n' "$PID" "$USER" "$FD" "$TYPE" "$NAME" "$CMD_TRUNC"

  # Try to get the start time of the process (best-effort; not all systems have ps -o lstart)
  if [ -n "${PID:-}" ] && [ "$PID" != "PID" ]; then
    START_TIME="$(ps -p "$PID" -o lstart= 2>/dev/null || echo '?')"
    echo "         start: $START_TIME"
    FULL_CMD="$(ps -p "$PID" -o args= 2>/dev/null || echo '?')"
    echo "         full cmd: $FULL_CMD"
  fi
done
echo

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] Not killing anything. Re-run without --dry-run to clean up."
  exit 1
fi

if [ "$AUTO_YES" -ne 1 ]; then
  # Read single char y/n
  read -r -p "Kill these process(es)? [y/N] " ANSWER
  case "$ANSWER" in
    y|Y) ;;
    *)
      echo "Declined. Listeners left in place. Exiting with code 1."
      exit 1
      ;;
  esac
fi

# Extract unique PIDs from the listener output and SIGTERM them.
PIDS="$(echo "$LISTENERS" | tail -n +2 | awk '{print $2}' | sort -u)"
echo
echo "Sending SIGTERM to PIDs: $(echo "$PIDS" | tr '\n' ' ')"
for pid in $PIDS; do
  kill -TERM "$pid" 2>/dev/null || true
done

# Wait up to 2 seconds for graceful shutdown
sleep 2

# Force-kill any survivors
SURVIVORS=""
for pid in $PIDS; do
  if kill -0 "$pid" 2>/dev/null; then
    SURVIVORS="$SURVIVORS $pid"
  fi
done
if [ -n "$SURVIVORS" ]; then
  echo "SIGKILL on survivors:$SURVIVORS"
  for pid in $SURVIVORS; do
    kill -KILL "$pid" 2>/dev/null || true
  done
  sleep 1
fi

# Re-check: any listeners left?
RECHECK="$(lsof "${LSOF_ARGS[@]}" 2>/dev/null || true)"
if [ -z "$RECHECK" ]; then
  echo "OK — all listeners cleaned up. Ports ${PORTS} are now free."
  exit 0
else
  echo "WARNING: listeners STILL present after kill attempt:"
  echo "$RECHECK"
  echo
  echo "Manual intervention required. Try:"
  echo "  pkill -9 -f 'next dev'"
  echo "  pkill -9 -f 'next start'"
  echo "  pkill -9 -f 'next-server'"
  exit 1
fi
