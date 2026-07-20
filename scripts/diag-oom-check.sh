#!/usr/bin/env bash
# diag-oom-check.sh — kernel-side OOM-kill diagnostic.
#
# v19-BLOCKING: the operator's review identified that "server died silently"
# crashes during v18 testing were never root-caused, and that an OOM-kill by
# the kernel would NOT appear in AppLog or in Next's stdout — it only appears
# in the kernel ring buffer (dmesg) and in systemd's journal (journalctl -k).
#
# Run this script the next time the dev server or production server dies
# silently. It prints any kernel-side kill events (OOM-kill, segfault, etc.)
# for the Node process. If the output is non-empty, the silent crash was an
# OOM-kill — meaning the `setImmediate` fix is unrelated and the real fix is
# memory pressure management (heap caps, swap, fewer concurrent compilations).
#
# If the output is EMPTY, the crash was NOT a kernel kill — that points back
# to a Node-level race (unhandledRejection, circular import, native segfault)
# and the crash handlers registered in src/instrumentation.ts should produce
# a file under logs/crash-*.log with a stack trace.
#
# Usage:
#   ./scripts/diag-oom-check.sh           # check since last boot
#   ./scripts/diag-oom-check.sh --since "1 hour ago"
#   ./scripts/diag-oom-check.sh --follow  # tail -f the kernel log

set -uo pipefail

SINCE="${1:-}"
LOG_DIR="${LOG_DIR:-$(pwd)/logs}"

echo "=== OOM / kernel-kill diagnostic ==="
echo "Time: $(date -Iseconds)"
echo "Host: $(hostname)  Kernel: $(uname -r)"
echo

# --- dmesg ------------------------------------------------------------------
if command -v dmesg >/dev/null 2>&1; then
  echo "--- dmesg (filtered: killed process / oom / node) ---"
  if [ "${1:-}" = "--follow" ]; then
    echo "(following — Ctrl-C to stop)"
    dmesg -wT 2>/dev/null | grep -iE 'killed process|out of memory|oom|node|next-server' || true
  else
    # -T = human timestamps; some systems need sudo for dmesg
    dmesg -T 2>/dev/null | grep -iE 'killed process|out of memory|oom|node|next-server' | tail -50 || true
    if [ $? -ne 0 ]; then
      echo "  (dmesg requires root on this host — try: sudo $0 $*)"
    fi
  fi
else
  echo "  dmesg not available"
fi
echo

# --- journalctl -------------------------------------------------------------
if command -v journalctl >/dev/null 2>&1; then
  echo "--- journalctl -k (kernel log, filtered: oom / kill / memory) ---"
  local_since="${SINCE:-1 hour ago}"
  if [ "$local_since" = "--follow" ]; then
    journalctl -k -f 2>/dev/null | grep -iE 'oom|killed|memory|node' || true
  else
    journalctl -k --since "$local_since" 2>/dev/null | grep -iE 'oom|killed|memory|node' | tail -50 || true
    if [ $? -ne 0 ]; then
      echo "  (journalctl may require root or systemd not running)"
    fi
  fi
else
  echo "  journalctl not available"
fi
echo

# --- crash dumps from our handler ------------------------------------------
echo "--- crash dumps under ${LOG_DIR}/ ---"
if [ -d "$LOG_DIR" ]; then
  ls -lh "$LOG_DIR"/crash-*.log 2>/dev/null | tail -10 || echo "  (no crash-*.log files — good or untested)"
  if [ -f "$LOG_DIR/crash.log" ]; then
    echo
    echo "--- tail of $LOG_DIR/crash.log ---"
    tail -30 "$LOG_DIR/crash.log"
  fi
else
  echo "  $LOG_DIR does not exist yet — crash handler has not written anything"
fi
echo

# --- recent boot marker -----------------------------------------------------
if [ -f "$LOG_DIR/boot.log" ]; then
  echo "--- last 5 boots ---"
  tail -5 "$LOG_DIR/boot.log"
fi
echo

echo "=== end diagnostic ==="
echo
echo "Interpretation:"
echo "  - If dmesg/journalctl show 'Killed process ... node' → OOM-kill confirmed."
echo "    The setImmediate fix is unrelated. Real fix: heap/cap management."
echo "  - If logs/crash-*.log has a fresh entry → Node-level crash captured."
echo "    Read the stack trace to find the actual failing code path."
echo "  - If neither → the crash may have been an external signal (SIGKILL"
echo "    from systemd, container OOM-killer, etc.). Check 'systemctl status'"
echo "    or 'docker inspect' if applicable."
