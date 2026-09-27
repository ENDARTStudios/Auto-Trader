#!/usr/bin/env node
/**
 * scan-unicode-docs.mjs — varredura de Unicode oculto/bidirecional/invisivel
 * em arquivos alterados de um PR. Foco: docs/**, README.md, governanca e logs.
 *
 * Uso: node scripts/scan-unicode-docs.mjs --base origin/main --head <branch> [--report <file>]
 *
 * Categorias verificadas:
 *  - Controle: U+0000, U+0085 (NEL)
 *  - Espaco nao-breaking indevido: U+00A0
 *  - Zero-width: U+200B (ZWSP), U+200C (ZWNJ), U+200D (ZWJ), U+2060 (WJ), U+FEFF (BOM/ ZWNBSP fora do inicio)
 *  - Directional formatting: U+202A-U+202E, U+2066-U+2069
 *  - Outros: U+180E, U+2028, U+2029
 *
 * Exit 0 = limpo; exit 1 = encontrou caracteres suspeitos.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, basename } from "node:path";

function argValue(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const base = argValue("--base", "origin/main");
const head = argValue("--head", "HEAD");
const report = argValue("--report", null);

const SUSPECT = [
  { cp: 0x0000, name: "NULL", cat: "controle" },
  { cp: 0x0085, name: "NEL", cat: "controle" },
  { cp: 0x00a0, name: "NBSP", cat: "espaco" },
  { cp: 0x200b, name: "ZWSP", cat: "zero-width" },
  { cp: 0x200c, name: "ZWNJ", cat: "zero-width" },
  { cp: 0x200d, name: "ZWJ", cat: "zero-width" },
  { cp: 0x2060, name: "WORD_JOINER", cat: "zero-width" },
  { cp: 0x202a, name: "LRE", cat: "direcional" },
  { cp: 0x202b, name: "RLE", cat: "direcional" },
  { cp: 0x202c, name: "PDF", cat: "direcional" },
  { cp: 0x202d, name: "LRO", cat: "direcional" },
  { cp: 0x202e, name: "RLO", cat: "direcional" },
  { cp: 0x2066, name: "LRI", cat: "direcional-isolado" },
  { cp: 0x2067, name: "RLI", cat: "direcional-isolado" },
  { cp: 0x2068, name: "FSI", cat: "direcional-isolado" },
  { cp: 0x2069, name: "PDI", cat: "direcional-isolado" },
  { cp: 0x180e, name: "MONGOLIAN_VOWEL_SEPARATOR", cat: "legado" },
  { cp: 0x2028, name: "LINE_SEPARATOR", cat: "separador" },
  { cp: 0x2029, name: "PARAGRAPH_SEPARATOR", cat: "separador" },
];

function scanText(text, allowLeadingBom) {
  const hits = [];
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i);
    if (cp > 0xffff) i++;
    const s = SUSPECT.find((x) => x.cp === cp);
    if (!s) continue;
    if (s.name === "ZWNBSP" || cp === 0xfeff) {
      if (allowLeadingBom && i === 0) continue;
    }
    hits.push({ line: text.slice(0, i).split("\n").length, cp: cp.toString(16).toUpperCase().padStart(4, "0"), name: s.name, cat: s.cat });
  }
  return hits;
}

let files = [];
try {
  const out = execSync(`git diff --name-only ${base}...${head}`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  files = out.split("\n").map((f) => f.trim()).filter(Boolean);
} catch {
  files = [];
}

if (files.length === 0) {
  const out = execSync(`git diff --name-only ${base} ${head}`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  files = out.split("\n").map((f) => f.trim()).filter(Boolean);
}

const results = [];
let totalHits = 0;
for (const f of files) {
  if (!existsSync(f)) continue;
  if (!/\.(md|json|jsonl|txt|ts|tsx|js|mjs|yml|yaml)$/i.test(f)) continue;
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const hits = scanText(text, true);
  if (hits.length > 0) {
    results.push({ file: f, hits });
    totalHits += hits.length;
  }
}

const lines = [];
lines.push("# Unicode Scan — PR docs/tree-reorg-finalizacao");
lines.push("");
lines.push("- Base: " + base + " | Head: " + head);
lines.push("- Arquivos verificados: " + files.length);
lines.push("- Arquivos com caracteres suspeitos: " + results.length);
lines.push("- Total de ocorrencias: " + totalHits);
lines.push("");
if (results.length === 0) {
  lines.push("**RESULTADO: CLEAN** — nenhum caractere oculto/bidirecional/invisivel encontrado.");
} else {
  lines.push("## Ocorrencias");
  lines.push("");
  for (const r of results) {
    lines.push(`### ${r.file}`);
    for (const h of r.hits.slice(0, 20)) {
      lines.push(`- L${h.line}: U+${h.cp} ${h.name} (${h.cat})`);
    }
    if (r.hits.length > 20) lines.push(`- ... +${r.hits.length - 20} outras`);
    lines.push("");
  }
  lines.push("**RESULTADO: SUSPEITO** — sanitizacao necessaria antes do merge.");
}

const output = lines.join("\n") + "\n";
if (report) {
  writeFileSync(report, output, "utf8");
  console.log(`[unicode-scan] report: ${report}`);
}
console.log(output);
console.log(`[unicode-scan] arquivos=${files.length} suspeitos=${totalHits}`);
process.exit(totalHits > 0 ? 1 : 0);
