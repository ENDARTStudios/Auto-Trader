# SPRINT.md — S13 Crypto ETL Correção (escopo corrigido para Auto Trader)

> **Gerado:** 2026-08-27 — pós correção: remover todas as referências ao "Almanaque dos Clubes", RSSSF, FBref, Wikipedia, futebol, clubes, jogadores, Copa do Brasil do projeto Auto Trader.
> **Status:** ✅ CONCLUÍDO — correções em `PLANO_MESTRE.md`, `DECISOES.md`, `src/lib/etl/*`, `tests/etl.test.ts` aplicando escopo 100% crypto-only.
> **Branch:** `main`
> **Histórico:** Dev Skill → S01-S12 wiring + S13 ETL com escopo errado (football) → S13b correção (crypto).

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

## 3. Próximos (se `Prossiga`)

- **S14** — `Live CCXT` testnet + `ethers` Uniswap V3 (alto risco, `ORCAMENTO_ESTOURADO`)
- **S15** — `Position` HTTP E2E `traderA POST` → `viewer 403` full via `fetch` (precisa `next dev`)
- **S16** — `Observabilidade` `Sentry` `prod` `OTEL` `metrics` `Prometheus` (S05 já tem wiring)
- **S17** — `Billing Plans` `Stripe` `Free/Pro/Elite` + webhook HMAC

**Fórmula:** continuar priorizando fáceis com menor risco + `git push` cada sprint. Auto Trader é exclusivo crypto (PLANO_MESTRE + DECISOES + ETL + tests corrigidos).
