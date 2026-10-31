// scripts/install-git-hooks.mjs — cross-platform twin of install-git-hooks.sh.
// npm `postinstall` entry (Windows cmd has no `bash`, so the .sh breaks
// `npm install` on fresh Windows clones). Same contract as the .sh:
// copies tracked scripts/git-hooks/* into .git/hooks/, executable bit,
// graceful no-op (exit 0) when .git is absent or hooks dir isn't writable.
// The .sh remains the documented manual path for Unix; behavior parity
// is intentional — keep both in sync when adding hooks.
import { cpSync, existsSync, readdirSync, statSync, chmodSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(repoRoot, "scripts", "git-hooks");
const dst = join(repoRoot, ".git", "hooks");

if (!existsSync(join(repoRoot, ".git"))) {
  console.log("[install-git-hooks] no .git directory — skipping (deploy artifact or tarball).");
  process.exit(0);
}
if (!existsSync(dst)) {
  console.error(`[install-git-hooks] ERROR: ${dst} missing despite .git present.`);
  process.exit(1);
}
try {
  // Writability probe (covers read-only containers/CI mounts).
  const probe = join(dst, ".writetest");
  writeFileSync(probe, "x");
  unlinkSync(probe);
} catch {
  console.error("[install-git-hooks] .git/hooks not writable — skipping (expected in deploy/CI).");
  process.exit(0);
}
if (!existsSync(src)) {
  console.error("[install-git-hooks] ERROR: scripts/git-hooks missing — repo layout changed?");
  process.exit(1);
}

let installed = 0;
for (const name of readdirSync(src)) {
  const from = join(src, name);
  if (!statSync(from).isFile()) continue;
  cpSync(from, join(dst, name));
  try {
    chmodSync(join(dst, name), 0o755);
  } catch {
    // Windows: chmod is a no-op — hooks run via Git's sh. Not an error.
  }
  installed++;
}
console.log(`[install-git-hooks] ${installed} hook(s) installed (pre-push active). See SECURITY.md REG-004.`);
