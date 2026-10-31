// scripts/validate-docker-static-t076.mjs — T076 container UI/static proof.
// Usage: node scripts/validate-docker-static-t076.mjs --base-url http://localhost:3100 [--out tmp/t076-report.json]
// Pure Node stdlib, read-only HTTP GETs, short timeouts, no secrets.
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
function flag(name, def = null) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}
const baseUrl = (flag("--base-url") || "").replace(/\/$/, "");
const outPath = flag("--out", null);
if (!baseUrl) {
  console.error("missing --base-url (e.g. http://localhost:3100)");
  process.exit(2);
}

const report = { baseUrl, checks: [], ok: true };
function check(name, cond, detail = "") {
  report.checks.push({ name, pass: Boolean(cond), detail: String(detail).slice(0, 300) });
  if (!cond) report.ok = false;
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${String(detail).slice(0, 160)}` : ""}`);
}

async function get(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(baseUrl + path, { signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  } finally {
    clearTimeout(t);
  }
}

// 1. health
const health = await get("/api/health");
check("health-200", health.status === 200, `status=${health.status}`);

// 2. login HTML with Next root/script
const login = await get("/login");
const hasNext =
  login.status === 200 &&
  (login.text.includes("__next") ||
    login.text.includes("__NEXT_DATA__") ||
    /<div id="__next"|id="root"/.test(login.text) ||
    login.text.includes("<title"));
check("login-html", hasNext, `status=${login.status} bytes=${login.text.length}`);

// 3. first /_next/static asset -> 200 + sane content-type
const assets = [
  ...login.text.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g),
].map((m) => m[1]);
const asset = assets.find((a) => /\.(js|css)(\?|$)/.test(a)) ?? assets[0] ?? null;
if (!asset) {
  check("static-asset", false, "no /_next/static asset found in /login HTML");
} else {
  const r = await get(asset);
  const ct = r.headers.get("content-type") ?? "";
  const okCt = /javascript|css/.test(ct);
  check("static-asset", r.status === 200 && okCt, `${asset} status=${r.status} ct=${ct}`);
}

// 4. public asset (/robots.txt known in repo public/)
const robots = await get("/robots.txt");
check(
  "public-asset",
  robots.status === 200 && /user-agent/i.test(robots.text),
  `status=${robots.status} bytes=${robots.text.length}`,
);

if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
