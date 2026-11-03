#!/usr/bin/env node
// scripts/build-signer.mjs
//
// Round 3 — empacota o processo signer (src/signer/main.ts) em UM arquivo CJS
// executável pelo Node do runtime: .next/standalone/signer.js
//
// Por que um bundle separado do server.js do Next?
//   - O signer é um PROCESSO separado (trust boundary): roda com privilégios e
//     memória próprios, nunca dentro do event loop do web.
//   - O server.js do Next não tem entry para ele; empacotar via esbuild garante
//     que o artefato vai no COPY .next do Docker e pode ser spawnado por
//     process.execPath (node) sem tsx/typescript no runtime de produção.
//
// NOTAS:
//   - packages:'external' → pacotes npm (ex.: ethers, @prisma/*) NÃO entram no
//     bundle; são resolvidos do node_modules em runtime. O Docker runner copia
//     node_modules (pruned) para /app para que a resolução funcione a partir de
//     .next/standalone/signer.js (ver Dockerfile, estágio runner).
//   - alias:@ → src (o código do signer usa imports "@/lib/..." como o resto do
//     projeto).
//   - O bundle NÃO abre socket no build: a validação de runtime é "gera e o
//     processo falha só no listen" (no Windows/CI o socket Unix não abre; o
//     módulo carrega e o bind é que falha — ver smoke no relatório round3).
//
// Uso: node scripts/build-signer.mjs   (chamado por "npm run build" e "npm run build:signer")

import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const entryPoint = join(root, 'src', 'signer', 'main.ts');
const standaloneDir = join(root, '.next', 'standalone');
const outfile = join(standaloneDir, 'signer.js');

function fail(message) {
  console.error('[build-signer] ERRO: ' + message);
  process.exit(1);
}

if (!existsSync(entryPoint)) {
  fail('entrypoint ausente: ' + entryPoint);
}
if (!existsSync(join(root, '.next'))) {
  fail('.next/ ausente — rode "next build" antes de "node scripts/build-signer.mjs".');
}
mkdirSync(standaloneDir, { recursive: true });

const startedAt = Date.now();
await build({
  entryPoints: [entryPoint],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  packages: 'external',
  alias: { '@': resolve(root, 'src') },
  logLevel: 'info',
  // O signer é server-only; sem sourcemap em produção para não vazar paths.
  sourcemap: false,
});

if (!existsSync(outfile)) {
  fail('bundle não foi gerado em ' + outfile);
}
const bytes = statSync(outfile).size;
if (bytes <= 0) {
  fail('bundle gerado vazio: ' + outfile);
}

// ---------------------------------------------------------------------------
// Runtime externals: o bundle usa packages:'external', então ethers/@prisma/*
// são resolvidos do node_modules em runtime. O trace do Next para
// .next/standalone/node_modules é PARCIAL (ex.: @prisma/adapter-better-sqlite3
// sem dist/, @prisma/adapter-pg ausente, ethers ausente) — e um diretório
// parcial no node_modules mais próximo do bundle SOMBREIA a resolução, mesmo
// que /app/node_modules esteja completo. Por isso copiamos a closure de
// dependências de runtime para dentro de .next/standalone/node_modules aqui, no
// build: o artefato gerado é self-contained (Docker COPY .next já o carrega) e
// não depende de "sorte" no trace do Next.
// ---------------------------------------------------------------------------
const RUNTIME_DEP_ROOTS = [
  'ethers',
  '@prisma/client',
  '@prisma/adapter-pg',
  '@prisma/adapter-better-sqlite3',
];

const rootNodeModules = join(root, 'node_modules');
const standaloneNodeModules = join(standaloneDir, 'node_modules');

function packageDir(name) {
  return join(rootNodeModules, ...name.split('/'));
}

const dependencyClosure = new Set();
function collectDependency(name) {
  if (dependencyClosure.has(name)) return;
  if (name.startsWith('@types/')) return; // type-only, não precisa em runtime
  dependencyClosure.add(name);
  const dir = packageDir(name);
  if (!existsSync(dir)) {
    console.warn('[build-signer] WARN: dependência de runtime ausente em node_modules: ' + name);
    return;
  }
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) });
  for (const dep of deps) collectDependency(dep);
}
for (const name of RUNTIME_DEP_ROOTS) collectDependency(name);

let copiedPackages = 0;
for (const name of dependencyClosure) {
  const from = packageDir(name);
  if (!existsSync(from)) continue;
  const to = join(standaloneNodeModules, ...name.split('/'));
  mkdirSync(join(to, '..'), { recursive: true });
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  copiedPackages += 1;
}

// Prisma 7: o client gerado vive em node_modules/.prisma (não em
// @prisma/client). Copiar garante que o signer funcione mesmo sem
// /app/node_modules/.prisma no runner.
const generatedPrisma = join(rootNodeModules, '.prisma');
if (existsSync(generatedPrisma)) {
  const target = join(standaloneNodeModules, '.prisma');
  rmSync(target, { recursive: true, force: true });
  cpSync(generatedPrisma, target, { recursive: true });
} else {
  console.warn('[build-signer] WARN: node_modules/.prisma ausente — rode "npx prisma generate".');
}

const kb = (bytes / 1024).toFixed(1);
console.log(
  '[build-signer] ok: .next/standalone/signer.js gerado (' +
    kb +
    ' KiB, esbuild ' +
    (Date.now() - startedAt) +
    'ms; ' +
    copiedPackages +
    ' pacotes de runtime copiados para .next/standalone/node_modules)',
);
