#!/usr/bin/env node
/**
 * validate-episodes.mjs — validador de integridade do logs/episodes.jsonl.
 *
 * Le o JSONL linha a linha, faz parse de cada linha como JSON e reporta:
 *   - contagem total de linhas
 *   - contagem de linhas validas
 *   - contagem de linhas invalidas + numeros das linhas invalidas
 *
 * Exit code: 0 = todas as linhas validas; 1 = alguma linha invalida/erro.
 * Sem rede, sem leitura de segredos, somente node builtins (Windows/PowerShell safe).
 *
 * Uso:
 *   node scripts/validate-episodes.mjs [--file logs/episodes.jsonl] [--report <path>]
 *
 * --report <path>: se o arquivo existir e contiver os marcadores
 *   <!-- episodes-validator-report --> ... <!-- /episodes-validator-report -->
 *   apenas o bloco entre marcadores e reescrito com o resultado.
 *   Se os marcadores nao existirem, falha (nao sobrescreve docs manualmente escritos).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const file = resolve(argValue("--file", "logs/episodes.jsonl"));
const reportPath = argValue("--report", null);

if (!existsSync(file)) {
  console.error(`[episodes-validator] arquivo nao encontrado: ${file}`);
  process.exit(1);
}

const raw = readFileSync(file, "utf8");
const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);

const invalid = [];
for (let i = 0; i < lines.length; i++) {
  try {
    JSON.parse(lines[i]);
  } catch (e) {
    invalid.push({ line: i + 1, error: e.message });
  }
}

const total = lines.length;
const valid = total - invalid.length;

console.log(`[episodes-validator] arquivo: ${file}`);
console.log(`[episodes-validator] linhas totais: ${total}`);
console.log(`[episodes-validator] linhas validas: ${valid}`);
console.log(`[episodes-validator] linhas invalidas: ${invalid.length}`);
for (const inv of invalid) {
  console.log(`[episodes-validator]   linha ${inv.line}: ${inv.error}`);
}

if (reportPath) {
  const rp = resolve(reportPath);
  if (!existsSync(rp)) {
    console.error(`[episodes-validator] --report: arquivo nao encontrado: ${rp}`);
    process.exit(1);
  }
  const doc = readFileSync(rp, "utf8");
  const open = "<!-- episodes-validator-report -->";
  const close = "<!-- /episodes-validator-report -->";
  const oi = doc.indexOf(open);
  const ci = doc.indexOf(close);
  if (oi < 0 || ci < 0 || ci < oi) {
    console.error(`[episodes-validator] --report: marcadores ausentes em ${rp} (nao sobrescrever)`);
    process.exit(1);
  }
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const block = [
    open,
    `- Gerado por \`scripts/validate-episodes.mjs\` em \`${stamp}\` (nao editar manualmente).`,
    `- Arquivo: \`${file}\``,
    `- Linhas totais: **${total}** | validas: **${valid}** | invalidas: **${invalid.length}**`,
    invalid.length === 0
      ? "- Resultado: **PASS** (exit 0)"
      : `- Resultado: **FAIL** (exit 1) — linhas invalidas: ${invalid.map((x) => "L" + x.line).join(", ")}`,
    close,
  ].join("\n");
  writeFileSync(rp, doc.slice(0, oi) + block + doc.slice(ci + close.length), "utf8");
  console.log(`[episodes-validator] report atualizado: ${rp}`);
}

process.exit(invalid.length === 0 ? 0 : 1);
