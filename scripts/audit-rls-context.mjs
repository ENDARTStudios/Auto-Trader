#!/usr/bin/env node
// scripts/audit-rls-context.mjs — auditor de contexto RLS para a tabela Position.
//
// CONTEXTO (round 7 — prep do flip strict):
//   A rodada 8 vai tornar "Position" STRICT (sem cláusula permissiva "sem
//   contexto"). Para isso, TODO acesso a db.position.* precisa estar dentro de
//   um contexto explícito:
//     - withSystemRls((tx) => tx.position...)  → engine/jobs/rotas admin
//     - withUserRls(session, (tx) => tx.position...) → input de usuário
//     - ou uma função que recebeu o tx de um desses helpers.
//
// HEURÍSTICA (documentada):
//   1. Varre src/**/*.ts (ou o diretório passado como argv[2]).
//   2. Para cada ocorrência de `db.position.<op>`, calcula se ela está dentro
//      do span de uma chamada withSystemRls(...) / withUserRls(...) — span
//      obtido por balanceamento de parênteses a partir do "(" do helper
//      (ignorando strings/comentários). Fora do span → VIOLAÇÃO.
//   3. Ocorrências de `tx.position.<op>` são aceitas quando dentro de um
//      span with*Rls; também são aceitas quando o callback está em uma função
//      cujo parâmetro é `tx` (heurística de "função que recebeu tx"):
//      procura assinatura `function nome(tx...` / `(tx) =>` / `(tx: Rls...`
//      nas 20 linhas anteriores.
//   4. Saída: relatório humano (ou --json). exit 1 se houver violação.
//
// Uso:
//   node scripts/audit-rls-context.mjs               # varre src/
//   node scripts/audit-rls-context.mjs src           # raiz explícita
//   node scripts/audit-rls-context.mjs fixtures --json
//
// Este script NÃO altera nada; é read-only.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXCLUDED_DIRS = new Set(["node_modules", ".next", ".git", "coverage", "dist", "build"]);
const DB_POSITION_RE = /\bdb\.position\.(findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|count|create|createMany|update|updateMany|upsert|delete|deleteMany|aggregate|groupBy)\b/g;
const TX_POSITION_RE = /\btx\.position\.(findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|count|create|createMany|update|updateMany|upsert|delete|deleteMany|aggregate|groupBy)\b/g;
const HELPER_RE = /\b(withSystemRls|withUserRls)\s*\(/g;

/** Percorre arquivos .ts sob root (recursivo, sem diretórios excluídos). */
export function collectTsFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        out.push(join(dir, entry.name));
      }
    }
  };
  try {
    if (statSync(root).isFile()) return [root];
  } catch {
    return [];
  }
  walk(root);
  return out.sort();
}

/**
 * Índice de spans [start, end] (inclusivo) do argumento de cada chamada
 * withSystemRls/withUserRls, por balanceamento de parênteses com skip de
 * strings/comentários/templates.
 */
export function findRlsSpans(source) {
  const spans = [];
  HELPER_RE.lastIndex = 0;
  let match;
  while ((match = HELPER_RE.exec(source)) !== null) {
    const open = source.indexOf("(", match.index + match[0].length - 1);
    if (open === -1) continue;
    let depth = 0;
    let i = open;
    let state = "code"; // code | line-comment | block-comment | single | double | template
    for (; i < source.length; i += 1) {
      const ch = source[i];
      const next = source[i + 1];
      if (state === "code") {
        if (ch === "/" && next === "/") { state = "line-comment"; i += 1; continue; }
        if (ch === "/" && next === "*") { state = "block-comment"; i += 1; continue; }
        if (ch === "'") { state = "single"; continue; }
        if (ch === '"') { state = "double"; continue; }
        if (ch === "`") { state = "template"; continue; }
        if (ch === "(") depth += 1;
        else if (ch === ")") {
          depth -= 1;
          if (depth === 0) { spans.push([open, i]); break; }
        }
      } else if (state === "line-comment") {
        if (ch === "\n") state = "code";
      } else if (state === "block-comment") {
        if (ch === "*" && next === "/") { state = "code"; i += 1; }
      } else if (state === "single" || state === "double") {
        if (ch === "\\") { i += 1; continue; }
        if ((state === "single" && ch === "'") || (state === "double" && ch === '"')) state = "code";
      } else if (state === "template") {
        if (ch === "\\") { i += 1; continue; }
        if (ch === "`") state = "code";
      }
    }
  }
  return spans;
}

function offsetToLine(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

function isInsideAny(offset, spans) {
  for (const [start, end] of spans) {
    if (offset >= start && offset <= end) return true;
  }
  return false;
}

/** Heurística: o hit está em função que recebeu tx (assinatura nas ~20 linhas antes). */
function isInTxFunction(source, offset) {
  const line = offsetToLine(source, offset);
  const lines = source.split("\n");
  const from = Math.max(0, line - 21);
  const window = lines.slice(from, line).join("\n");
  return /(function\s+\w+\s*\([^)]*\btx\b)|(\(\s*tx\s*[,:)])|(\(\s*tx\s*:\s*)/.test(window);
}

/** Audita um conjunto de arquivos; retorna { violations, migrated, scanned }. */
export function auditFiles(files, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const violations = [];
  const migrated = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const spans = findRlsSpans(source);
    for (const m of source.matchAll(DB_POSITION_RE)) {
      const offset = m.index ?? 0;
      const insideHelper = isInsideAny(offset, spans);
      const insideTxFn = isInTxFunction(source, offset);
      const hit = {
        file: relative(cwd, file).split("\\").join("/"),
        line: offsetToLine(source, offset),
        snippet: m[0],
      };
      if (insideHelper || insideTxFn) {
        // Aceito pela heurística (call site dentro do helper), mas ideal é tx.
        migrated.push({ ...hit, accepted: true });
      } else {
        violations.push(hit);
      }
    }
    for (const m of source.matchAll(TX_POSITION_RE)) {
      const offset = m.index ?? 0;
      const hit = {
        file: relative(cwd, file).split("\\").join("/"),
        line: offsetToLine(source, offset),
        snippet: m[0],
      };
      if (isInsideAny(offset, spans) || isInTxFunction(source, offset)) {
        migrated.push({ ...hit, accepted: true });
      } else {
        violations.push({ ...hit, reason: "tx.position fora de with*Rls" });
      }
    }
  }
  return { violations, migrated, scanned: files.length };
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const rootArg = args.find((a) => !a.startsWith("--")) ?? "src";
  const files = collectTsFiles(rootArg);
  if (files.length === 0) {
    console.error("[audit-rls-context] nenhum arquivo .ts encontrado em: " + rootArg);
    process.exit(2);
  }
  const { violations, migrated, scanned } = auditFiles(files);
  if (json) {
    console.log(JSON.stringify({ root: rootArg, scanned, violations, migrated }, null, 2));
  } else {
    console.log("[audit-rls-context] raiz: " + rootArg + " — arquivos: " + scanned);
    console.log("[audit-rls-context] call sites com contexto RLS: " + migrated.length);
    for (const site of migrated) console.log("  OK   " + site.file + ":" + site.line + "  " + site.snippet);
    if (violations.length === 0) {
      console.log("[audit-rls-context] OK — nenhum db.position./tx.position. fora de contexto.");
    } else {
      console.error("[audit-rls-context] VIOLAÇÕES: " + violations.length);
      for (const v of violations) {
        console.error("  FAIL " + v.file + ":" + v.line + "  " + v.snippet + (v.reason ? " (" + v.reason + ")" : ""));
      }
    }
  }
  process.exit(violations.length === 0 ? 0 : 1);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
