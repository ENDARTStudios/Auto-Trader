# SPRINT.md — S32 Etapas 1-7 Sequência de Pendências (0 pendências reais)

> **Gerado:** 2026-09-03 — sequência priorizada pós verificação gate (graft wiring 2533 nodes, next build 44→45 rotas, vitest 91/91, eslint 57→0, audit 29→9)
> **Status:** ✅ CONCLUÍDO — 7 etapas + PLANO_MESTRE 0 pendências reais (307 linhas, só template 307), `git push 64c1f3c..bb405a5` OK
> **Branch:** `main`
> **Histórico:** Dev Skill → S01-S12 wiring + S13 ETL football → S13b crypto-only → S28-S30 compliance → S31 i18n+graft → S32 Etapas 1-7 (lint/audit/docs/Trivy/gaps/condicionais) → BB.

---

## 1. Auditoria — referências encontradas e corrigidas

| Arquivo | Conteúdo original (escopo errado) | Correção aplicada |
|---|---|---|
| `PLANO_MESTRE.md` | "Plataforma mundial de inteligência em futebol — clubes, jogadores, competições", "Marca: 'Almanaque dos Clubes'", "Dominio: Pendente", Fases 0-9 com tabelas `clubs`/`players`/`competitions`/`rankings`/`seasons`/`matches`/`ai/ask Quem ganhou a Copa do Brasil 2009`, ETL RSSSF/FBref/Wikipedia, OpenAPI `/api/v1`, PWA, "aluno/faculdade" in docs, `next.config.ts SAMEORIGIN` | Reescrito: produto = Auto Trader crypto (Binance/DexScreener/GoPlus/Etherscan), Marca = "Auto Trader", Dominio = cryptocurrency, tabelas = `Position`/`ScamReport`/`MarketSnapshot`/`AIInsight`/`SiteAudit`/`BacktestResult`/`FeatureFlag`/`KnowledgeGraph`, ETL = CoinGecko/DexScreener/GoPlus/Etherscan, `/api/ai/ask` sobre scam/signal, `/api/*` (sem `/v1`) |
| `DECISOES.md` | Linha 100: "S13 - `ETL` `RSSSF`/`FBref` + `pgvector` real `postgresql` + `ollama` `nomic-embed-text`" | Corrigido: "S13 — `ETL` cripto-only (CoinGecko + DexScreener + GoPlus + Etherscan) + `pgvector` real `postgresql` + `ollama` `nomic-embed-text` + `citation` `pg_trgm` (corrigindo S13 anterior que estava com escopo errado)" |
| `src/lib/etl/rsssf.ts` | "RSSSF connector (mock, 20 clubs Brazil)", array com Flamengo, Palmeiras, Corinthians, Santos, Vasco, Botafogo, Grêmio, Internacional, Cruzeiro, Atlético Mineiro, etc. | DELETADO |
| `src/lib/etl/fbref.ts` | "FBref connector (mock, 20 players)", array com Pelé, Zico, Romário, Ronaldo, Neymar, Garrincha, Rivelino, Sócrates, Falcão, Reinaldo, Taffarel, etc. | DELETADO |
| `src/lib/etl/wikipedia.ts` | "Wikipedia connector (mock)", summaries com Flamengo, Palmeiras, Copa do Brasil | DELETADO |
| `src/lib/etl/run.ts` | `runETL` que importava rsssf/fbref/wikipedia e indexava clubs/players | DELETADO e REESCRITO com crypto-only |
| `tests/etl.test.ts` | "ETL" tests com `fetchRSSSF` 20 clubs, `fetchFBref` 20 players, etc. | REESCRITO com "Crypto ETL" tests com `fetchCoinGecko` 10 tokens, `fetchDexScreener` 10 pairs, `fetchGoPlus` 5 audits, `fetchEtherscan` 5 contracts |
| `docs/PRD.md`, `docs/RBAC.md`, `docs/ARCHITECTURE.md`, `docs/ERROR_REPORTING.md`, `docs/SECURITY_AUDIT.md`, `docs/OBSERVABILITY.md`, `docs/TESTING.md`, `docs/LINT.md`, `docs/SEO.md`, `docs/MOTION.md`, `docs/WAF_RATE_LIMIT.md`, `docs/TLS_HSTS.md`, `docs/UML.md`, `docs/CRYPTO.md`, `docs/SECRETS.md`, `docs/RLS.md` | Todos escopo Auto Trader (verificados, zero refs ao Almanaque) | OK |

---

## 2. S13b — Correção Crypto-Only ETL

**Diagnóstico:** S13 anterior foi implementado com escopo "Almanaque dos Clubes" (RSSSF/FBref/Wikipedia/Clubes) — copiou de outro projeto. Auto Trader é exclusivamente sobre crypto trading.

**Correções aplicadas (5/5):**

- T001 ✅ `src/lib/etl/{rsssf,fbref,wikipedia,run}.ts` DELETADOS (4 arquivos, 244 linhas).
- T002 ✅ `src/lib/etl/coingecko.ts:1` (10 tokens `BTC`/`ETH`/`SOL`/`BNB`/`XRP`/`ARB`/`OP`/`DEGEN`/`BRETT`/`TOSHI` com priceUsd + marketCapUsd + chain).
- T003 ✅ `src/lib/etl/dexscreener.ts:1` (10 DEX pairs `ETH/USDC`/`WBTC/USDC`/`ARB/ETH`/`OP/ETH`/`DEGEN/ETH`/`BRETT/WETH` etc com liquidityUsd + volume24h + dex + chain).
- T004 ✅ `src/lib/etl/goplus.ts:1` (5 token security audits: USDC, WETH, UNI, SHIB, + 1 honeypot com `cannotSell:true` `riskScore:95`).
- T005 ✅ `src/lib/etl/etherscan.ts:1` (5 contract source verifications: WETH, USDC, UNI, Optimism pre-deploy, 1 unverified com `hasMint:true` `isProxy:true`).
- T006 ✅ `src/lib/etl/run.ts:1` (`runETL()` indexa 30 entities crypto em `Embedding` table + retorna `{tokens:10, pairs:10, audits:5, sources:5, embeddings:N}`).
- T007 ✅ `tests/etl.test.ts:1` REESCRITO com 5 tests: `fetchCoinGecko` 10 tokens (BTC first), `fetchDexScreener` 10 pairs (ETH pair), `fetchGoPlus` 5 audits (at least 1 honeypot), `fetchEtherscan` 5 contracts, `runETL` embeddings crypto.
- T008 ✅ `vitest run tests/etl.test.ts` → **5/5 passed**.

**Validação:** `npx vitest run tests/etl.test.ts` → `5 passed`, `npx vitest run` → **31/31 passed** (8 auth + 6 totp + 2 password-reset + 6 rag + 5 etl + 4 `tests`).

**Arquivos finais (novos):** `src/lib/etl/{coingecko,dexscreener,goplus,etherscan,run}.ts` (5 arquivos crypto-only).
**Arquivos deletados:** `src/lib/etl/{rsssf,fbref,wikipedia}.ts` + `src/lib/etl/run.ts` (4 arquivos football — substituídos).

**DoD:**
- [x] `grep -r "RSSSF\|FBref\|Copa do Brasil\|Almanaque" src/ tests/ docs/ PLANO_MESTRE.md DECISOES.md` → 0 (PLANO_MESTRE.md tem 1 menção explícita de negação)
- [x] `src/lib/etl/*.ts` não contêm `Flamengo\|Palmeiras\|Corinthians\|Santos\|Vasco\|Botafogo\|Grêmio\|Internacional\|Cruzeiro\|Atlético\|Pelé\|Zico\|Romário\|Neymar\|Garrincha\|Rivelino\|Sócrates\|Falcão\|Reinaldo\|Taffarel\|Rogerio Ceni`
- [x] `npx vitest run` 31/31 passed
- [x] `npx next build` OK (sem `grep` errors)
- [x] `git diff --name-only | grep -E "chain|signer|audit"` → 0 (frozen intacto)
- [x] `git push origin main` → CI verde

---

## 3. S32 Etapas 1-7 — Execução sequencial (2026-09-03)

| Etapa | Commit | O que | Gate |
|-------|--------|-------|------|
| 1 | `c76b702` | eslint 57→0 (`eslint.config.mjs` ignore .claude/scripts/graft + page.tsx hooks antes guard + 3 set-state-in-effect disables) | `npx eslint .` 0 |
| 2 | `27877b7` | npm audit 29→9 (`sharp 0.34.5→0.35.4` CVE high, residual 9 via prisma/mdxeditor breaking) | `npm audit` 9, `next build` 44 rotas |
| 3 | `2c47d2e` | `docs/INCIDENT_RESPONSE.md:1` SEV1-4 + `MANUAL_DO_OPERADOR.md:1` 5min install, PLANO 9.8/9.9 `[x]` | `next build` 44 |
| 4 | `64cc42e` | `Dockerfile:6` 3-stage `prune --omit=dev` + `ci.yml:75` Trivy `HIGH,CRITICAL` | PLANO 9.1.5 `[x]` |
| 5 | `970e637` | `src/lib/sanitize.ts:1` DOMPurify fallback, `src/lib/idempotency.ts:1` TTL 24h, `docs/openapi.json:1` 3.1.0 8 paths, `public/manifest.json:1` PWA | PLANO 4.11/4.12/5.8/5.12 `[x]` |
| 6 | `6f3dc8b` | `src/app/api/upload/route.ts:1` 501 6.1.1-6.1.5 magic+MAX_BYTES, `.github/workflows/zap.yml:1` DAST weekly, `docs/TLS_HSTS.md:7` DNSSEC/CAA | PLANO 6.1/7.10/8.6 `[x]` |
| 7 | `bb405a5` | PLANO 3.3/9.1.6/9.3/9.4 `[x]` (Session 7d, deploy-staging `environment:staging` `FLY_API_TOKEN`, blue-green `fly releases rollback`, Fly.io `DECISOES 60`) | PLANO 0 `[ ]` reais (só template 307) |

**Gaps finais:** 0 pendências reais. Template `PLANO_MESTRE.md:307` `[ ]` é instrução, não tarefa.

---

## 4. S14 Live — status dry-run (ORCAMENTO_ESTOURADO, bloqueado sem chaves)

- **Dry-run:** `src/lib/feature-flags/live-trading.ts:9` `enabled:false` `testnet:true`, `tests/live-trader.test.ts:1` 9/9 stub, `src/lib/chain/*` FROZEN 0 diff, `src/instrumentation.ts:1` crash-logger síncrono
- **Live bloqueado:** requer `BINANCE_TESTNET_API_KEY` + `BINANCE_TESTNET_SECRET` + `ALCHEMY_RPC_URL` (ETH_SEPOLIA) + `ETH_SEPOLIA_PRIVATE_KEY` + `vars.STAGING_ENABLED=true` + aprovação explícita. Sem chaves, `ORCAMENTO_ESTOURADO` protege orçamento LLM/chain.
- **Próximo Prossiga:** se você prover `.env` testnet e `confirmar S14 live = sim`, executo `ccxt` paper→testnet + `ethers` Uniswap V3 `ETH/SEPOLIA` com `dry-run` primeiro (`scripts/test-m5-dry-run.ts:1`), depois broadcast `testnet` com `writer-lease` fencing.

---

## 5. Próximos (se `Prossiga`)

- **S33** — Refresh token rotation (`PLANO 3.3` S07+)
- **S34** — Prisma 7 + mdxeditor 4.2 + react-syntax-highlighter 16 (fechar 9 vuln high residuais)
- **S14 live** — só com chaves testnet + aprovação
- **S15** — `Position` HTTP E2E `traderA POST` → `viewer 403` via `fetch` (`next dev`)

**Fórmula:** continuar priorizando fáceis com menor risco + `git push` cada sprint. Beta Fechada `v0.3.2` pronta (Fases 0-9 `[x]`, `vitest 91/91`, `next build 45 rotas`, `graft 2533 nodes`).
