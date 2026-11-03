#!/usr/bin/env node
// scripts/copy-standalone-assets.mjs
//
// O output: "standalone" do Next.js NÃO copia .next/static nem public/ para
// .next/standalone/ — sem este passo o servidor standalone sobe e serve o HTML
// sem CSS/JS/imagens (404 em /_next/static/*). Antes isto era um one-liner
// node -e dentro do package.json; virou script para ser portável (Windows e
// Linux), testável e falhar alto quando o build saiu incompleto.
import { cpSync, existsSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const nextDir = join(root, '.next');
const standaloneDir = join(nextDir, 'standalone');

function fail(message) {
  console.error(`[copy-standalone-assets] ERRO: ${message}`);
  process.exit(1);
}

function copyDir(from, to) {
  if (!existsSync(from)) fail(`origem ausente: ${relative(root, from)}`);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

if (!existsSync(nextDir)) fail('pasta .next/ ausente — rode "next build" antes.');
if (!existsSync(standaloneDir)) {
  fail('pasta .next/standalone/ ausente — next.config.ts precisa de output: "standalone".');
}

copyDir(join(nextDir, 'static'), join(standaloneDir, '.next', 'static'));
copyDir(join(root, 'public'), join(standaloneDir, 'public'));

// Falha explícita se o artefato final não estiver completo (é isso que o CI e o
// Docker runner consomem — melhor quebrar aqui do que servir página sem assets).
const checks = [
  join(standaloneDir, 'server.js'),
  join(standaloneDir, '.next', 'static'),
  join(standaloneDir, 'public'),
];
for (const target of checks) {
  if (!existsSync(target)) fail(`artefato incompleto: ${relative(root, target)} não existe após a cópia`);
}

const serverBytes = statSync(join(standaloneDir, 'server.js')).size;
console.log(
  `[copy-standalone-assets] ok: .next/static + public copiados para .next/standalone (server.js ${serverBytes}B)`,
);
