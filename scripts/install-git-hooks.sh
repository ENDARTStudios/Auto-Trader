#!/usr/bin/env bash
# install-git-hooks.sh — installs the project's git hooks from the tracked
# `scripts/git-hooks/` directory into the local `.git/hooks/` directory.
#
# Git hooks are NOT tracked by git (the `.git/hooks/` directory is per-clone).
# This script copies the tracked hook files into the local hooks directory
# and makes them executable, so the hooks defined in this repo actually
# fire on the operator's machine.
#
# This script is wired into `package.json` as the `postinstall` npm script,
# so `npm install` alone is sufficient to activate the hooks — no separate
# manual step. This closes the loop: `test:ci` is the gate, the pre-push
# hook guarantees the gate runs, `postinstall` guarantees the hook exists.
# Without `postinstall`, the install script would itself be "a script that
# exists but someone has to remember to run" — the exact failure mode the
# hook exists to prevent (see SECURITY.md REG-004).
#
# Re-run this script manually only when:
#   - After pulling changes that touch `scripts/git-hooks/` (npm install
#     will also re-run it, but a manual run is a fast way to refresh
#     without doing a full install).
#   - Anytime the operator is unsure whether their hooks are up to date.
#
# Currently installs:
#   - pre-push  → runs `npm run test:ci` before any `git push`
#                 (see SECURITY.md REG-004 for the rationale)
#
# Future hooks (pre-commit, commit-msg, etc.) will be added here as needed.
#
# EXIT BEHAVIOR:
#   - 0 if hooks were installed successfully, OR if .git is not present,
#     OR if .git/hooks/ exists but is not writable (graceful no-op — see
#     below).
#   - 1 only on genuine errors (hooks source missing, hooks destination
#     missing despite .git present, etc.).
#
# GRACEFUL NO-OP WHEN .git IS ABSENT:
#   `npm install` runs `postinstall` in contexts where .git does not exist:
#     - Deployed build artifacts (the .next/standalone/ output, Docker
#       images that COPY the built app without .git, etc.)
#     - Tarball installs (`npm pack` output, which strips .git)
#     - Some monorepo workspace configurations where the package is a
#       subtree of a larger repo
#   In these contexts, failing the install would break `npm install` for
#   no benefit (there's no git to push from in a deploy artifact). The
#   script therefore prints a notice and exits 0 when .git is missing,
#   rather than failing. The notice is visible so a misconfigured deploy
#   (e.g., expecting hooks but not having .git) is debuggable.
#
# GRACEFUL NO-OP WHEN .git/hooks/ IS NOT WRITABLE:
#   `npm install` also runs `postinstall` in contexts where .git exists
#   but .git/hooks/ is read-only:
#     - Read-only container images (Docker images where .git was COPYed
#       into a read-only layer, or where the entire filesystem is RO)
#     - Restricted CI runners (some CI providers mount .git read-only to
#       prevent tests from mutating the checked-out source)
#     - Build graphs that re-mount .git with different permissions than
#       the original clone
#   In these contexts, `cp` into .git/hooks/ fails with EACCES, which
#   under `set -e` would propagate as a non-zero exit and break the
#   `npm install`. The failure has nothing to do with the code being
#   installed — it's an environment constraint. The script therefore
#   treats "permission denied on .git/hooks/" exactly like ".git absent"
#   — single-line notice to stderr, exit 0. Same rationale: there's no
#   benefit to failing the install when we can't write the hooks anyway.

set -euo pipefail

# Resolve the repo root from the script location, NOT from $PWD. This
# matters because npm postinstall runs the script with $PWD set to the
# package directory, which is usually the repo root but not always
# (monorepo workspaces, tarball extracts, etc.).
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_SRC="$REPO_ROOT/scripts/git-hooks"
HOOKS_DST="$REPO_ROOT/.git/hooks"

# Graceful no-op when .git is absent — see header comment.
if [ ! -d "$REPO_ROOT/.git" ]; then
  echo "[install-git-hooks] no .git directory at $REPO_ROOT — skipping hook install (likely a deploy artifact or tarball)."
  exit 0
fi

if [ ! -d "$HOOKS_DST" ]; then
  echo "[install-git-hooks] ERROR: $HOOKS_DST does not exist despite .git being present — git repo is in an unexpected state." >&2
  exit 1
fi

# Graceful no-op when .git/hooks/ is not writable — see header comment.
# This covers read-only container images, restricted CI runners, and
# other contexts where .git exists but .git/hooks/ cannot be written to.
# Without this check, `cp` below would fail with EACCES, `set -e` would
# propagate it as exit 1, and `npm install` would break for a reason
# unrelated to the code being installed. Verified by
# scripts/test-install-git-hooks-readonly.sh.
if [ ! -w "$HOOKS_DST" ]; then
  echo "[install-git-hooks] $HOOKS_DST is not writable (read-only container, restricted CI runner, or similar) — skipping hook install. pre-push gate will not be active in this environment. This is expected in deploy/CI contexts and is not an error." >&2
  exit 0
fi

if [ ! -d "$HOOKS_SRC" ]; then
  echo "[install-git-hooks] ERROR: $HOOKS_SRC does not exist — repo layout changed?" >&2
  exit 1
fi

installed=0
skipped=0

for hook_src in "$HOOKS_SRC"/*; do
  [ -f "$hook_src" ] || continue
  hook_name="$(basename "$hook_src")"
  hook_dst="$HOOKS_DST/$hook_name"

  # If the destination already exists (e.g., from a previous install) but
  # is not writable, skip refreshing this hook with a notice rather than
  # failing the install. The directory-level check above already covers
  # the common read-only-container case; this per-file check covers the
  # rarer case where the directory is writable but an existing hook file
  # has been chmod'd read-only by some external process. Same rationale:
  # don't break `npm install` over a hooks refresh.
  if [ -e "$hook_dst" ] && [ ! -w "$hook_dst" ]; then
    echo "[install-git-hooks] $hook_dst exists but is not writable — skipping refresh of this hook (existing version will be used)." >&2
    skipped=$((skipped + 1))
    continue
  fi

  # Always overwrite — the tracked version is the source of truth. This
  # makes the script idempotent: running it via `npm install` after a
  # `git pull` that touched scripts/git-hooks/ refreshes the installed
  # hook to the new tracked version.
  cp "$hook_src" "$hook_dst"
  chmod +x "$hook_dst"
  installed=$((installed + 1))
done

if [ "$installed" -eq 0 ]; then
  if [ "$skipped" -gt 0 ]; then
    echo "[install-git-hooks] 0 hook(s) installed, $skipped skipped due to read-only existing files (existing versions retained)."
  else
    echo "[install-git-hooks] no hooks found in $HOOKS_SRC — nothing to install."
  fi
  exit 0
fi

# Quiet success message — npm install is already noisy, we don't need
# the multi-line "to verify / to skip" tutorial on every install. The
# guidance is in SECURITY.md REG-004 and in the hook's own header comment.
echo "[install-git-hooks] $installed hook(s) installed (pre-push active). See SECURITY.md REG-004."
