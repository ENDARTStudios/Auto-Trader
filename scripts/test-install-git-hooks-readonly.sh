#!/usr/bin/env bash
# test-install-git-hooks-readonly.sh — verifies install-git-hooks.sh
# gracefully no-ops (exit 0, single stderr notice) when .git exists
# but .git/hooks/ is not writable. This is the read-only-container /
# restricted-CI-runner scenario the operator flagged before clearing M2.3.
#
# Not part of `test:ci` — it builds a synthetic repo and uses chmod tricks
# that don't belong in the gate. Run manually whenever install-git-hooks.sh
# is modified, to confirm the graceful-no-op property still holds.
#
# Why this test exists: install-git-hooks.sh is wired into npm's
# `postinstall` script. If `npm install` runs in a read-only container
# image or a restricted CI runner where `.git/` exists but `.git/hooks/`
# is not writable, a non-graceful failure would break `npm install` for a
# reason unrelated to the code being installed. The script must treat
# "permission denied writing to .git/hooks/" exactly like ".git absent"
# — single-line notice, exit 0.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_SCRIPT="$PROJECT_ROOT/scripts/install-git-hooks.sh"

PASS=0
FAIL=0

# ----------------------------------------------------------------------------
# Test 1: .git absent — baseline for the graceful-no-op contract.
# Already documented in the script header, but verify here so the read-only
# test below can be compared apples-to-apples.
# ----------------------------------------------------------------------------
echo "=== Test 1: .git absent (baseline — graceful no-op expected) ==="
TMPDIR1="$(mktemp -d)"
trap 'rm -rf "$TMPDIR1"' EXIT
mkdir -p "$TMPDIR1/scripts/git-hooks"
mkdir -p "$TMPDIR1/scripts"
cp "$PROJECT_ROOT/scripts/git-hooks/pre-push" "$TMPDIR1/scripts/git-hooks/"
cp "$INSTALL_SCRIPT" "$TMPDIR1/scripts/"

cd "$TMPDIR1"
set +e
output="$(bash scripts/install-git-hooks.sh 2>&1)"
exit_code=$?
set -e
cd - > /dev/null

echo "  exit_code=$exit_code"
echo "  output: $output"
if [ "$exit_code" -eq 0 ]; then
  echo "  PASS"
  PASS=$((PASS + 1))
else
  echo "  FAIL: expected exit 0"
  FAIL=$((FAIL + 1))
fi
rm -rf "$TMPDIR1"
echo

# ----------------------------------------------------------------------------
# Test 2: .git exists but .git/hooks/ is read-only — the operator's concern.
# A non-graceful failure here breaks `npm install` in read-only containers
# and restricted CI runners. Must exit 0 with a single-line notice.
# ----------------------------------------------------------------------------
echo "=== Test 2: .git exists, .git/hooks/ read-only (operator's concern) ==="
TMPDIR2="$(mktemp -d)"
mkdir -p "$TMPDIR2/scripts/git-hooks"
mkdir -p "$TMPDIR2/.git/hooks"
cp "$PROJECT_ROOT/scripts/git-hooks/pre-push" "$TMPDIR2/scripts/git-hooks/"
cp "$INSTALL_SCRIPT" "$TMPDIR2/scripts/"
# 555 = read+execute, no write — simulates read-only container mount or
# restricted CI runner permissions. The directory is visible and listable,
# but creating/modifying files inside it fails with EACCES.
chmod 555 "$TMPDIR2/.git/hooks"

cd "$TMPDIR2"
set +e
output="$(bash scripts/install-git-hooks.sh 2>&1)"
exit_code=$?
set -e
cd - > /dev/null

echo "  exit_code=$exit_code"
echo "  output: $output"
chmod 755 "$TMPDIR2/.git/hooks"  # restore so rm -rf works
if [ "$exit_code" -eq 0 ]; then
  # Verify the output is a single NOTICE (not multi-line noise, not silent).
  line_count=$(printf '%s\n' "$output" | grep -c . || true)
  if [ "$line_count" -ge 1 ] && [ "$line_count" -le 3 ]; then
    echo "  PASS (graceful no-op, $line_count line(s) of notice)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: exit 0 but output is $line_count lines (expected 1-3 notice lines)"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  FAIL: install script exited non-zero ($exit_code) when .git/hooks was read-only."
  echo "  This breaks npm install in read-only containers / restricted CI runners."
  FAIL=$((FAIL + 1))
fi
rm -rf "$TMPDIR2"
echo

# ----------------------------------------------------------------------------
# Test 3: .git exists and .git/hooks/ writable — happy path. Verifies the
# graceful no-op didn't accidentally swallow the real install.
# ----------------------------------------------------------------------------
echo "=== Test 3: .git exists, .git/hooks/ writable (happy path baseline) ==="
TMPDIR3="$(mktemp -d)"
mkdir -p "$TMPDIR3/scripts/git-hooks"
mkdir -p "$TMPDIR3/.git/hooks"
cp "$PROJECT_ROOT/scripts/git-hooks/pre-push" "$TMPDIR3/scripts/git-hooks/"
cp "$INSTALL_SCRIPT" "$TMPDIR3/scripts/"

cd "$TMPDIR3"
set +e
output="$(bash scripts/install-git-hooks.sh 2>&1)"
exit_code=$?
set -e
cd - > /dev/null

echo "  exit_code=$exit_code"
echo "  output: $output"
if [ "$exit_code" -eq 0 ] && [ -x "$TMPDIR3/.git/hooks/pre-push" ]; then
  echo "  PASS (hook installed and executable)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: happy path broken (exit=$exit_code, hook executable=$([ -x "$TMPDIR3/.git/hooks/pre-push" ] && echo yes || echo no))"
  FAIL=$((FAIL + 1))
fi
rm -rf "$TMPDIR3"
echo

echo "=== Summary: $PASS passed, $FAIL failed ==="
exit "$FAIL"
