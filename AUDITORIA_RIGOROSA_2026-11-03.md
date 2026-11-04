# Auditoria Rigorosa — Auto Trader

**Data:** 2026-11-03 · **Método:** 5 auditores especializados + Lead, código + execução real (build/testes/HTTP/Playwright) + auditoria da produção ao vivo (Railway) + git/gh.
**Working tree auditado:** `D:\PROJETOS\Auto Trader\Auto Trader` em `3f8170b` — **46 commits atrás de `origin/main` (`213e3ec`)**. A produção roda o código novo (UI Meridian); os dois lados foram considerados e os deltas estão marcados.

---

## 0. Resposta direta

**Não é "só um protótipo de teste" — mas também não é o produto que a documentação descreve.**

É um **app web real e substancial** (≈52.500 linhas em 299 arquivos, Next.js 16 + Postgres + Prisma 7, auth própria, ~70 rotas de API, CI verde no GitHub, 420 testes, build OK) que está **publicado e funcionando na Railway** e que a sua conta já usa. Porém, na prática ele é hoje:

- um **simulador de paper trading** (nenhuma ordem real é possível — `liveBuy/liveSell` são stubs);
- **rodando em modo demonstração**, com **dados fabricados** por `scripts/seed-demo.ts` (posições `demo-pos-*`, rounds 9001–9005, logs falsos) e **engine parado** ("Stopped · 0 rounds started");
- com a **camada de IA morta** (LLM sem configuração/chave — 100% das chamadas falham) e **sinais de DEX fabricados** (candles por interpolação + seno);
- com a **arquitetura de 5 camadas declarada "regra geral vinculante" no AGENTS.md simplesmente não implementada** (0 ocorrências no código);
- **perigosamente exposto na internet**: login de `super_admin` com credencial padrão **funciona em produção** e um **bypass de autenticação** (cookie forjado) permite **baixar o banco** sem senha;
- sem deploy automatizado, sem migrações de schema, sem backup restaurável testado, com cobertura real de **32,6%**.

**Veredito por caso de uso:**

| Pergunta | Resposta |
|---|---|
| "Dá para demonstrar o produto?" | **Sim.** UI completa, login, dashboard com dados, gráficos, onboarding, billing, IA (fachada), engine que simula trades. |
| "É um bot de trading autônomo operando?" | **Não.** Engine parado em produção, sem execução real, sem dados de mercado confiáveis em DEX, sem IA. |
| "Dá para colocar capital real?" | **Não — em nenhuma hipótese no estado atual.** |
| "É seguro deixar no ar como está?" | **Não.** Há comprometimento trivial (credencial default + bypass). |
| "É um protótipo descartável?" | **Não.** Há engenharia real, contratos, testes e evolução de 40+ commits; é uma base aproveitável, mas com fachada acima do que funciona. |

---

## 1. O que realmente funciona (verificado)

| Item | Evidência |
|---|---|
| Build de produção | `npx next build` → exit 0 (6 warnings: `@sentry/nextjs` e `redis` ausentes, dynamic fs) |
| Typecheck / lint | `tsc --noEmit` exit 0; `eslint .` exit 0 |
| Testes unitários | 37 arquivos, **419 pass + 1 skip** (8,7s) |
| CI no GitHub | run `41708933792`: **success** (12m02s; jobs ci/e2e/codeql/e2e-meridian verdes) |
| App local | dev sobe em ~2s; `/api/health` 200 com DB real; login `viewer@local`/`admin@local` 200 + cookie; ~40 GETs autenticados retornam dados do Postgres |
| UI | dashboard renderiza (1440×1000), login funciona, onboarding, Command Palette; screenshots em `.local/audit/screens/` |
| Produção | `GET /api/health` → 200 `{"status":"ok","db":{"reachable":true}}`; `/login` e `/` → 200; UI loga e navega em Overview/Markets/Portfolio/Strategy/Backtest/Analytics/Risk/Alerts/Settings |
| Criptografia de credenciais | AES-256-GCM + PBKDF2-SHA256 600k (script KDF 9/9 PASS) — implementação real |
| Auth core | sessão opaca 256-bit hasheada no DB, bcrypt cost 12, reset single-use, refresh com rotação atômica, webhook Stripe HMAC timing-safe |
| APIs externas reais | probes 200: Etherscan V2 (WETH9, 38k source), GoPlus scanner, DexScreener, Binance klines, Fear&Greed, RSS Cointelegraph, Google Safe Browsing |
| Engine paper (via API) | roda de fato: SCOUT → ANALYZE → EXECUTE → MONITOR/EXIT; abriu e fechou 1 posição; rounds/posições gravados (com os bugs da §3.1) |

---

## 2. Nível de maturidade por dimensão

| Dimensão | Nota | Estado |
|---|---|---|
| Código/arquitetura (estrutura, tipos, módulos) | 6/10 | Real, organizado em camadas, mas com código morto e duas arquiteturas em paralelo |
| UI/UX | 7/10 | Funcional e bonita (Meridian), a11y/E2E existem, mas métricas enganosas e mutações quebradas no tree local |
| Auth & autorização | 3/10 | Núcleo de sessão bom; **autorização furada** (bypass, 0 `requirePermission`, RLS morto) |
| Segurança operacional | 2/10 | Produção com credencial default, dump de DB sem auth, branch desprotegida, CSRF forjável |
| Motor paper trading | 5/10 | Ciclo funciona, indicadores CEX corretos; bugs de ciclo de vida, fees não aplicados, sinais DEX falsos |
| Dados de mercado | 4/10 | Conectores reais existem, mas ETL é mock e não roda; CoinGecko 401; LLM morto; SourceHealth nunca escrito |
| IA (squad/analista) | 1/10 | Sem provedor configurado — 18 AIInsight com erro, "gate de IA" não veta |
| Execução live (CEX/DEX/signer) | 0/10 | Stub explícito; chain/signer são biblioteca desconectada; Docker não sobe signer |
| Testes | 4/10 | 420 testes e CI verde, mas cobertura 32,6%; engine/portfolio/scam/price-feed/wallet = 0% |
| CI/CD | 4/10 | CI bom; **CD inexistente** (workflow Railway `skipped`), Vercel obsoleta 404 |
| Banco/DR | 3/10 | 33 modelos × 1 migration; schema por DDL ad-hoc; backup parcial e restore não testado |
| Docs vs realidade | 3/10 | Volumosa e detalhada, mas superdimensiona cobertura, arquitetura, RLS e "production-ready" |
| Governança/multi-tenant | 2/10 | Repo público, `main` sem proteção, dono de recurso não é checado (IDOR), engine global |
| **Global** | **≈4/10** | **Demo/protótipo avançado; não é produto de trading nem pronto para produção** |

---

## 3. O que é simulado, stub ou está quebrado

### 3.1 Motor de trading (`src/lib/trading/`)

- **Live trading é stub explícito**: `paper-trader.ts:96-128` `liveBuy/liveSell` retornam `"não implementado"`; `src/lib/chain/live-trader.ts` devolve `orderId: mock-ccxt-...`, `filledPrice: 50000+Math.random()*1000` e `txHash` aleatório; **0 importadores**.
- **Arquitetura de 5 camadas do AGENTS.md não existe**: `perception_layer|causal_bubble_intelligence|global_state_macro_reasoner|action_policy_engine|self_evolution_feedback_core` → **0 ocorrências em `src/`**. `bootstrap.ts` tem 0 callers; engine não lê `config/risk_config.json` nem `state/mode.json`; `envelope.ts`, `challenger-loop.ts`, `sizing-fixed-point.ts`, `fee-model.ts` e `graduation.ts` são módulos isolados **sem chamador no runtime**.
- **Sinais DEX fabricados**: `market-analysis.ts:118-166` monta 50 candles por interpolação linear de `priceChange24h` + `Math.sin` ("noise"). Probe: +10% → RSI 100; −10% → RSI 0; score 40–58 "neutral" para qualquer cenário. RSI/MACD/EMA sobre série inventada.
- **Anti-scam parcialmente falso**: "honeypot" = turnover 24h/liquidez (`scam-detector.ts:287-324`); "tax" = **70 fixo** sem simular swap (`:246-276`); só o contract audit usa Etherscan real (substring frágil).
- **Fees ignorados**: `feeBps` (10) nunca aplicado na execução; só slippage hardcoded 30 bps/lado; `FeeAuditLog` nunca escrito → P&L otimista e painel de fees zerado.
- **Bugs de ciclo de vida**: round é recriado a cada tick quando nada abre (`engine.ts:444-451`, `:683-699`); round com PnL ≤ 0 **nunca** vira "completed" (`portfolio.ts:273-276`); posição sem preço nunca expira (`engine.ts:255-259`); kill switch fecha ao preço de entrada quando o feed falha (esconde perdas); `forceCloseAtEnd` inalcançável e destrutivo.
- **Multi-tenant quebrado**: engine conta/abre/fecha posições sem `ownerId` (`engine.ts:157,235`).
- **Graduação paper→live sem efeito**: `recordPaperCycleAttempt` nunca é chamado; live é stub.
- **Bug observado ao vivo no app local**: engine abriu LIT/USDT a **$3,3623** (preço do scout) e fechou 13s depois a **$0,7408** (Binance) → **−77,97% / −$1.169,53** em 13 segundos, disparando "daily loss" e bloqueando rounds seguintes. Fontes de entrada e saída divergentes.
- **Logs de decisão vazios**: `logs/episodes.jsonl` tem 45 linhas, **todas STATUS de agentes**, nenhum episódio de decisão/P_Mparam; `shadow_valid/coherence/rejected/forward_collection.jsonl` = **0 bytes**.

### 3.2 Dados externos e IA

- **ETL mock**: `etl/dexscreener.ts:24-27` (10 pares fixos) e `etl/goplus.ts:22-25` (5 audits fixos) — sem HTTP; `runETL` tem **0 callers**, mas o DB grava `status:'ok'` (rows 10/10/5/5 = tamanho exato dos mocks).
- **CoinGecko**: chave presente retorna **401 "API Key Missing"**; código só cai para API pública se a chave estiver ausente → cai no mock.
- **LLM morto**: único provedor é `z-ai-web-dev-sdk`, exige `.z-ai-config` ausente em cwd/$HOME/etc. Probe: `ZAI.create FAILED`. DB: 18 `AIInsight` com erro `"Configuration file not found"`, recommendation `investigate`, confidence 0. Engine trata `investigate` como **não-veto** → a "camada de ceticismo IA" não existe na prática.
- **SourceHealth nunca escrito** (`recordSuccess/recordError` sem callers) → UI mostra "saudável" para fonte morta; gate de fonte crítica nunca dispara.
- **Chaves fantasma**: `SOLSCAN_API_KEY`, `CARDANOSCAN_API_KEY`, `BSC_RPC_URL` só existem no schema Zod; probes: 401/401/fetch-failed. Solana, Cardano e BSC sem caminho de dados.
- **rising-tokens**: 2 de ~5 fontes retornam `[]` (no-op).

### 3.3 Chain / signer / vault

- Pipeline de 9 gates, broadcaster, MEV, writer-lease e signer-adapter são **código real e testado em scripts**, mas **desconectado do app**: nenhuma rota `src/app/api/**` importa `lib/chain/*`; `buildRuntime` só aparece em `scripts/test-m5-*`.
- **Transporte de produção ausente**: `signer-adapter.ts:198` "UnixSocketSignerTransport (to be added in M3.2)"; não há RPC HTTP de produção; Dockerfile/compose **não sobem processo signer**.
- **DB sem credenciais**: 0 wallets, 0 exchanges → nada para desbloquear/assinar.
- `live-trader.ts` e `PrivateRelayStub` lançam/retornam "not implemented".

### 3.4 Segurança — **achados críticos confirmados em produção**

**Produção:** `https://auto-trader-production-0cbc.up.railway.app` (UP, DB reachable) — e **pública**. Repo GitHub **público**, com histórico de `.env` (conteúdo antigo sem chaves válidas, mas exposto) e `main` **sem branch protection** (HTTP 404).

| ID | Sev | Achado | Evidência |
|---|---|---|---|
| SEC-01 | **CRÍTICO** | **Login `admin@local` / `Admin123!` funciona em produção como `super_admin`** — credenciais padrão são semeadas automaticamente no banco (`src/lib/db-init.ts:56-75`, `scripts/seed-auth.ts`) e estão no repo público | Probe: `POST /api/auth/login` → **200**, `user.role="super_admin"` |
| SEC-02 | **CRÍTICO** | **Bypass de autenticação por cookie forjado**: o proxy só verifica a *presença* do cookie `session` ("DB check is in handler"), e dezenas de rotas não validam sessão no handler | `src/proxy.ts:83-88`; prod: `Cookie: session=deadbeef...` → `GET /api/system/info` **200**, `GET /api/system/backup` **200 (30.429 bytes)**; sem cookie → 401 |
| SEC-03 | **CRÍTICO** | **Dump do banco sem autenticação**: `GET /api/system/backup` exporta 17 tabelas (config, posições, rounds, logs, snapshots, canais…); `POST` restaura config/saldos | `system/backup/route.ts:9-103,105-205`; teste ao vivo em prod |
| SEC-04 | **CRÍTICO** | **26/70 rotas sem validação de sessão no handler** (28/79 em `origin/main`) e **0/70 usam `requirePermission`**; inclui `positions/[id]/close` (fechar posição), `wallets/[id]` (apagar), `notifications/*`, `system/maintenance` | inventário por arquivo; `requirePermission` definido mas 0 usos |
| SEC-05 | **CRÍTICO** | **CSRF contornável**: double-submit sem segredo — atacante forja `csrf` cookie + header iguais. Provado: `DELETE /api/wallets/...` com sessão forjada + par CSRF auto-emitido chegou ao handler (500), não 403 | `proxy.ts:52-68`; `csrf.ts:18` |
| SEC-06 | **ALTO** | "RLS por ownerId" é **código morto**: sem `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY`; helpers só usados em testes; IDOR sistêmico | `src/lib/auth/rls.ts` (0 call sites) |
| SEC-07 | **ALTO** | Rate limit só em memória por processo (Redis é dead code), sem lockout de conta | `rate-limit.ts:11,109` |
| SEC-08 | **ALTO** | CSP de produção com `unsafe-inline` + `unsafe-eval` | `next.config.ts:29-33` |
| SEC-09 | ALTO | `forgot` devolve reset token na resposta quando `NODE_ENV !== 'production'` | `auth/forgot/route.ts:43-50` |
| SEC-10 | MÉDIO | TOTP reutilizável (±1 step), enumeração por timing, auditoria com hash irreprodutível, Actions por tag (não SHA), ZAP stub | vários |

**Impacto combinado:** qualquer pessoa na internet, sem senha, consegue **ler a base** (SEC-02/03) e — com o par CSRF auto-forjado — **executar mutações** (fechar posições, alterar saldos/config, resetar estado). Com a credencial default (SEC-01), ganha o painel inteiro de `super_admin`. Não há capital real hoje, mas há dados do operador e integrações; e o modelo de segurança **não serve** para quando houver.

### 3.5 Infra, banco, deploy, observabilidade

- **Sem CD**: `deploy-railway` sempre `skipped` (`RAILWAY_DEPLOY_ENABLED` ausente); `deploy-staging` é `echo`. A produção no Railway foi deploy manual. Alias Vercel antigo → **404 DEPLOYMENT_NOT_FOUND**.
- **Sem migrações**: 33 modelos × **1** migration; CI e prod usam `prisma db push`/DDL ad-hoc (`db-init.ts` só aplica se a tabela `User` não existir) → mudança de schema em banco existente **nunca** aplica.
- **Backup não restaurável**: API exporta 17/33 tabelas; restore parcial; `scripts/backup-db.sh` é `sqlite3 .dump` legado; `backup/backup.sh` (pg_dump) sem agendamento comprovado nem teste de restore.
- **Health falso**: `/api/health/live` e `/api/health/ready` **não existem** (404; sem cookie 401), mas docs/CI os citam.
- **Observabilidade stub**: `@sentry/nextjs` e `redis` não estão no `package.json` (warnings de build); log de erro cai em warn; fila é in-process (`bullmq-stub`).
- **Gates cosméticos**: dependency-cruiser validou **0 módulos**; knip e Trivy têm `continue-on-error`/`|| echo`.
- **`npm run test:ci` quebra local** no 1º de 22 scripts (adapter sqlite vs provider postgres; `DATABASE_URL` não exportado) — e, se rodado contra um DB real, `test-vault.ts` **trunca** WalletConnection/ExchangeConnection. No CI passa (763 marcas ✓ PASS; o rótulo "637 checks" é estático).
- **`npm start` e `npm run dev` não são portáveis** (bash/bun/`tee`); `next build` isolado não copia `_next/static` para o standalone → UI sem CSS/JS.
- **E2E local**: 29 passam / 23 falham no Windows (429 + 403 CSRF + webServer `tee`); no CI (Linux) passa.

### 3.6 Documentação vs realidade (amostra)

| Claim nos docs | Realidade |
|---|---|
| "CI 637 checks + coverage 80%" | 763 marcas; cobertura **32,62% lines / 40,02% funcs / 27,73% branches**; thresholds rebaixados para 30/39/27 em `vitest.config.ts:19` |
| "5 camadas obrigatórias… regra geral vinculante" | **0 ocorrências no código**; módulos da skill desconectados |
| "RLS + `requirePermission` em toda rota" | RLS **não existe**; `requirePermission` **0 usos**; `src/middleware.ts` não existe |
| "ENCRYPTION_KEY protege credenciais" | chave real deriva de passphrase; `ENCRYPTION_KEY` não é usada (política de privacidade afirma o contrário) |
| "20 repos externos analisados" | `external-systems.ts` tem **27** entradas e **0 importadores** |
| "Production-ready / Fly.io + Sentry + Redis" | deploy canônico Railway manual, CD desligado, Sentry/Redis ausentes, docs de Fly.io obsoletos |
| "Upload seguro / ZAP DAST" | upload retorna 501 (stub), ZAP aponta para `your-domain.com` e `continue-on-error` |

---

## 4. Achados consolidados (top, por severidade)

**CRÍTICOS**
1. **SEC-01** credencial `super_admin` padrão válida em produção.
2. **SEC-02/03** bypass de auth por cookie forjado + dump do banco sem auth (confirmado ao vivo em produção).
3. **SEC-04/05** autorização inexistente em 26 rotas + CSRF forjável.
4. **CR-01** arquitetura de 5 camadas (declarada vinculante) não existe; governança de risco inerte.
5. **CR-02** sinais de DEX fabricados (candles sintéticos) — decisões sobre ruído.
6. **C3 (dados)** camada de IA morta (LLM sem config) e tratada como não-veto.
7. **INF-01/02** sem CD e sem migrações — produção e schema não versionados.
8. **CSRF do tree local** impede qualquer mutação pelo UI (START/KILL/config) — corrigido em `origin/main`, não no seu checkout.

**ALTOS**
9. Live trading stub; chain/signer desconectados; Docker sem signer; 0 wallets.
10. ETL mock com proveniência falsa (`status:'ok'`); SourceHealth nunca escrito; CoinGecko 401.
11. Fees não aplicados; round lifecycle quebrado; posições sem preço eternas; preço entrada ≠ saída (trade LIT/USDT −77,97% em 13s).
12. Backup/DR não restaurável; `main` sem branch protection; repo público.
13. Cobertura 0% em engine/portfolio/scam/price-feed/wallet; `test:ci` irreproduzível e destrutivo.
14. Métricas do dashboard enganosas no demo (`equity $427` vs saldos $4,0k; exposição 842,7%; unrealized −100% por preço 0) e no local (ROI +88% com realizado −$1,17k).
15. Docs superdimensionam maturidade e segurança.

---

## 5. O que fazer (priorizado)

**P0 — hoje (segurança e exposição)**
1. **Remover/desativar as contas seed em produção** e rotacionar senhas; `db-init` não deve semear `admin@local` em prod (ou exigir `NODE_ENV!=production`/env `ALLOW_SEED_USERS`).
2. **Fechar o bypass**: validação de sessão **no handler** em todas as rotas (ou allowlist deny-by-default no proxy), `requireSession`/`requirePermission` obrigatório, e teste de contrato que dispare cada rota com cookie forjado.
3. **Bloquear/remover `/api/system/backup` e `/api/system/info`** do público; exigir `super_admin`.
4. **CSRF real** (HMAC vinculado ao session id + Origin check) ou `SameSite=Strict`+Origin.
5. Se não for usar como demo pública, **proteger a produção** (basic auth / VPN) até os itens acima.

**P1 — esta semana (produto)**
6. Sincronizar o working tree com `origin/main` (traz `/api/auth/csrf` e proxy corrigido).
7. Unificar fonte de preço entrada/saída e rejeitar desvio > X%; corrigir timeout/kill-switch sem preço.
8. Ligar de verdade (ou remover da doc) a skill de 5 camadas: `bootstrap`→engine, `risk_config/mode.json` no caminho de decisão, fee-model e sizing ponto-fixo.
9. Substituir candles DEX sintéticos por OHLCV real ou **NO_TRADE em DEX**; sinalizar honeypot/tax como não-verificados (não pontuar 70 fixo).
10. Configurar LLM (chave/config) ou desligar a feature flag `enable_ai_squad`; corrigir o gate para vetar erro.
11. Corrigir ciclo de vida de rounds/posições e as métricas do dashboard.
12. Migrações: `prisma migrate deploy` + baseline; CI de migração.

**P2 — 2–4 semanas**
13. CD de verdade (Railway token/auto-deploy) + branch protection + health `live/ready` reais + smoke de deploy (baixar 1 chunk CSS).
14. Backup restaurável testado (pg_dump + restore em ambiente limpo), `pg_dump` agendado.
15. Observabilidade real (Sentry/Redis/fila) e remoção de stubs/dead code.
16. Subir cobertura dos módulos críticos (engine, portfolio, scam, price-feed, wallet) e consertar `test:ci` local sem destruir DB.
17. Corrigir docs (cobertura, arquitetura, RLS, deploy) para não induzir auditorias futuras a erro.

---

## 6. Anexos

- Relatórios completos por área (com comandos e evidências): `.local/audit/report-engine.md`, `.local/audit/report-data-chain.md`, `.local/audit/report-security.md`, `.local/audit/report-runtime-e2e.md`, `.local/audit/report-infra-docs.md`.
- Execuções: `.local/audit/{typecheck,vitest,coverage,eslint,build,testci}.log`.
- Screenshots: `.local/audit/screens/` (dashboard local pós-trade, prod overview/markets/portfolio/strategy/backtest/analytics/risk/alerts/settings, `ui-start-click.png` com o 403).
- Limitação: auditoria do **working tree** (46 commits atrás) + **produção** (código novo). Onde o remoto difere, está marcado. Nada foi alterado no código; a única escrita em banco foi o teste do engine paper no DB local de dev (autorizado) e logins de verificação em produção.

---

## 7. Status pós-correção — Rodada 1 (2026-11-03, branch `fix/audit-round1`, commit `e560604`)

**Deploy em produção:** Railway `auto-trader-production-0cbc.up.railway.app` — deployment `ad42feeb` (Online), verificado às 19:15 -03.

### Ações imediatas aplicadas (com prova em produção)

| Ação | Antes | Agora (verificado) |
|---|---|---|
| Bypass de auth por cookie forjado | `Cookie: session=<qualquer>` → 200 em `/api/system/backup` e `/api/system/info` | **401** em backup/info/runtime/config/status com cookie forjado de 64 hex; sessão agora é `<token>.<HMAC-SHA256>` assinada e validada no proxy sem DB |
| CSRF forjável | header==cookie sem segredo; par auto-emitido passava | token `HMAC(secret, "<session-cookie>.<ts>")` + janela 1h + Origin; **mutação com par forjado → 403**, com token legítimo → 200 |
| Credencial default `admin@local/Admin123!` | login 200 `super_admin` em produção | **login 401**; senha rotacionada (credencial em `.local/audit/prod-admin-creds.txt`, fora do git); `viewer@local`/`trader@local` desativados; dono `endart.studios@gmail.com` promovido a `super_admin` |
| Sessões antigas | 29 sessões no DB | **todas deletadas** + `SESSION_SECRET` rotacionado (64 hex) |
| Rotas sem auth no handler | 28 rotas sem sessão (produção) | `requireSession`+`requirePermission` em **100%** das rotas não-públicas, com `system:admin` para backup/maintenance/initialize; teste de contrato percorre todos os `route.ts` |
| Health probes | `/api/health/ready` inexistente (404) | **`/api/health/live` 200 e `/api/health/ready` 200** (DB check), allowlisted no proxy |

### Sistemas simulados → reais (código novo, deployado)

- **ETL**: mocks `MOCK_PAIRS`/`MOCK_AUDITS`/`MOCK_TOKENS` removidos; DexScreener/GoPlus/CoinGecko via HTTP real com proveniência (status `ok` só HTTP 2xx); nova rota `/api/etl` (GET `system:read`, POST `system:admin`).
- **Sinais de DEX**: candles sintéticos (reta+seno) **removidos**; OHLCV real via GeckoTerminal por pool de maior liquidez; sem dado real → `MarketDataUnavailableError` e NO_TRADE (nunca indicador inventado).
- **IA**: sem `z-ai-config` morto; novo provider OpenAI-compatible/Ollama (`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `OLLAMA_URL`); sem config → `AIUnavailableError` + `/api/ai/ask` 503, sem `investigate` fabricado.
- **SourceHealth**: ligado em price-feed, market-analysis, goplus-scanner e /api/ai/ask.
- **Scam detector**: tax/honeypot deixam de pontuar fixo; `unverified` + peso renormalizado.
- **Motor paper**: fees/slippage reais + `FeeAuditLog`; round só criado após aprovação e **sempre finalizado**; validação de preço de entrada (mata o bug LIT/USDT −77% em 13s); timeout sem preço fecha e libera capital; `forceCloseAllIfOutsideWindow` corrigido; diversificação/graduação ligadas; engine escopado por `ownerId`.
- **Infra**: scripts cross-platform (sem tee/bun); baseline de migração Postgres (34 modelos) + `migrate deploy` no CI + gate de drift; standalone assets verificados no CI; Docker `HEALTHCHECK` em `/api/health/ready`; backup/restore scripts; `/api/health/ready` sem vazar erro cru do driver.

### Evidências de gate (branch `fix/audit-round1`)

- `npx tsc --noEmit` → exit 0
- `npx eslint .` → exit 0
- `npx vitest run` → **52 arquivos / 626 pass / 1 skip**
- `npm run build` → exit 0 (+ cópia de static/public para standalone)
- Verificação em produção: health 200/200/200; cookie forjado 401; senha default antiga 401; senha nova 200; CSRF forjado 403; backup só `super_admin` 200; UI login+overview OK com 0 erros de console.

### Ainda pendente (próximas rodadas — goal segue ativo)

1. **Live trading real** (CEX/DEX/signer/broadcaster/MEV/lease) — segue stub/desconectado; exige chaves e aprovação de envelope (S14) + serviço signer.
2. **Etherscan ETL** ainda declara `mock` (limitação de free tier) — precisa de contratos/keys acessíveis.
3. **RLS nativo no Postgres** (policies + `SET LOCAL`) — hoje é escopo de aplicação (`ownerId`).
4. **CI/CD**: `deploy-railway` continua desligado (deploy manual); branch protection ausente; Sentry/Redis stubs.
5. **Cobertura**: 32% → subir engine/portfolio/etl/ai no ratchet; `test:ci` local ainda não reprodutível no Windows.
6. **UI**: labels "Honeypot" → "Turnover (heurística)"; `/api/market` tratar `MarketDataUnavailableError`; limpar snapshots antigos possivelmente sintéticos.
7. **Docs**: claims históricos de cobertura/arquitetura (5 camadas) e Fly.io ainda desatualizados.

---

## 8. Status pós-correção — Rodada 2 (2026-11-03, branch `feat/live-execution-round2`)

**Escopo:** implementar os sistemas que ainda eram simulados (execução live, signer transport, observabilidade) e integrar gates pendentes. **Regra mantida:** execução live fica **desligada e fail-closed**; nenhuma flag/credencial foi habilitada em produção.

### Execução real (implementada, desligada por padrão)

| Item | Antes | Agora |
|---|---|---|
| CEX | `cexMarketOrder` mock com `Math.random()` | **CCXT real** (`src/lib/chain/cex-adapter.ts`): sandbox/testnet, rate limit, time sync, market/limit order, fills/fees reais, saldos reais; sem log de keys |
| DEX | txHash aleatório, router placeholder | **ethers v6 + Uniswap V3 SwapRouter02/QuoterV2** (`dex-adapter.ts`): quoter obrigatório, `amountOutMinimum` nunca 0, receipt status=1, amountOut do evento Swap, gas; endereços validados/overridable |
| Gate | stub sempre falhava | `live-gating.ts`: exige **6 condições** (mode=live, graduatedToLive, kill switch off, `LIVE_TRADING_ENABLED=true`, `S14_APPROVED=true`, feature flag); qualquer falta → `LIVE_DISABLED`; creds ausentes → `LIVE_CREDS_UNAVAILABLE` (nunca cai para paper) |
| Credenciais | stub | `live-credentials.ts`: **cofre primeiro** (`ExchangeConnection` ativa + `walletVault.getExchangeCreds`); env só com `LIVE_CREDS_ALLOW_ENV=1`; mainnet só com `LIVE_ALLOW_MAINNET=1`; DEX por signer (`DEX_USE_SIGNER=1`) ou env; status mascarado |
| Signer | transporte "to be added" | `UnixSocketSignerTransport` real (JSON-RPC 2.0 newline, timeouts, limite de frame, sem retry/fallback) + `makeSignerAdapterFromEnv` + `GET /api/signer/health` (auth `system:read`, caminho mascarado) |
| Verificação em produção | — | `LIVE_TRADING_ENABLED`, `S14_APPROVED`, `CCXT_TESTNET`, `BINANCE_*`, `DEX_*`, `ALCHEMY_RPC_URL` **ausentes** nas env vars do Railway; `/api/status` segue `mode=paper`, `graduatedToLive=false` |

**Limitações conhecidas da execução (documentadas no relatório):** approve ERC20 não é automático antes do swap; decimals do token não persistidos (sell DEX assume 18); DEX com `source=signer` ainda não assina via signer (fail-closed); signer não está rodando (serviço não implantado).

### Dados / integrações

- **Etherscan ETL sem mock em produção**: mock só em `NODE_ENV=test`; sem chave/rede → `provenance:"unavailable"`, `status:"error"`.
- **`POST /api/market`**: `MarketDataUnavailableError` → **503** `market_data_unavailable`.
- **SourceHealth escopado**: `geckoterminal` crítico DEX; `evaluateSourceHealthForScout({candidateSource})` bloqueia só o escopo afetado; **agora plugado no SCOUT do engine** (CEX continua com DEX fora, e vice-versa).
- **UI**: “Honeypot” → “Turnover (heurística)”; “Taxa” → “Taxa (não verificada)”.

### Observabilidade

- **Sentry real sem dependência**: `sentry-http.ts` envia envelope HTTP ao DSN, com scrubbing recursivo, timeout e nunca lança; `initSentry()` agora é chamado no `instrumentation.ts`.
- **Redis rate-limit real**: `redis@5`, conexão lazy com lock, fallback memória, ZSET correto; `checkRateLimitDistributed` ligado no `requireSession` (política de limites inalterada). Sem `REDIS_URL` em prod → segue memória (honesto).
- **README.md** novo (status real) + `docs/08-knowledge-management/round2-status.md` + `.env.example` com os blocos LIVE/DEX/signer/Sentry/Redis **vazios/desligados**.

### Evidências de gate (rodada 2)

- `npx tsc --noEmit` → **0** · `npx eslint .` → **0** · `npx vitest run` → **60 arquivos / 766 pass / 1 skip** (era 52/626 na rodada 1)
- `npm run build` → **OK** (ccxt marcado como `serverExternalPackages`; `.next/standalone` inclui ccxt + static + public)
- Smoke do artefato standalone: `/api/health` **200**, `/api/health/ready` **200**
- Live fail-closed coberto por testes (`live-gating`, `cex-adapter`, `dex-adapter`, `live-trader`, `live-credentials`, `signer-transport`)

### Ainda pendente (goal ativo)

1. **Signer em execução**: processo/serviço isolado (Unix socket 0600, supervisor, deploy separado) e DEX assinando via signer; approve ERC20 + decimals por token.
2. **Habilitar live de verdade** só com envelope S14: chaves testnet, modo live, graduation, flag — decisão do operador.
3. **RLS nativo Postgres**; CD automático; branch protection; Sentry/Redis/AI configurados em produção (hoje desligados por falta de DSN/URL/key).
4. **Cobertura** do runtime (engine/portfolio/etl) no ratchet; `test:ci` local Windows; demo seed data vs dados reais.
5. **Docs históricos** (skill 5 camadas, claims de cobertura, Fly.io).

---

## 9. Status pós-correção — Rodada 3 (2026-11-03, branch `feat/signer-runtime-round3`)

**Escopo:** fechar as limitações da rodada 2 (signer em execução, DEX 100% executável), reprodutibilidade local do gate e correção de claims históricos. **Live continua desligado/fail-closed.**

### Signer como processo real (desligado por padrão)
- `scripts/build-signer.mjs` (esbuild) gera **`.next/standalone/signer.js`** (93 KiB) + closure de runtime (ethers/@prisma + transitivas) em `.next/standalone/node_modules` (o trace do Next era parcial e sombreava a resolução). `npm run build` já o gera.
- `src/lib/signer-supervisor.ts`: gate `SIGNER_SPAWN=1`, socket em tmp com permissão 0600, spawn de `process.execPath signer.js`, `SIGNER_READY` validado (type/socketPath/version, timeout 10s), **restart com backoff 1s→30s**, stop/shutdown (SIGTERM→SIGKILL, remove socket), status sempre mascarado; **nunca lança**.
- `instrumentation.ts` inicia o supervisor após Sentry; `GET /api/signer/health` expõe `supervisor{enabled,spawned,ready,pid,restarts,lastError}`.
- `docs/06-devops-deployment/signer-runtime.md` (habilitar, política `SIGNER_MAX_TX_USD`/`SIGNER_MAX_WINDOW_USD`/`SIGNER_WINDOW_SEC`, rollback `SIGNER_SPAWN=0`).
- **Validação local:** bundle carrega e falha apenas no `listen` (Windows não tem Unix socket; esperado). Em produção, habilitado via `SIGNER_SPAWN=1` e verificado por `/api/signer/health`.

### DEX executável de ponta a ponta (fail-closed)
- `ensureErc20Allowance`: lê allowance, faz `approve` do valor **exato** com receipt status=1; sem approve não há swap.
- `readTokenDecimals` on-chain com cache (fim do hardcode 18 no sell) e erro tipado.
- Assinatura via **signer** (EIP-1559): envelope real (`payloadHash` SHA-256), validação de `requestId/payloadHash/signerVersion`, broadcast + receipt; `DEX_SIGNER_WALLET_ID_REQUIRED` sem walletId.
- `executeSwap`: approve → quoter → swap → receipt; `amountOutMinimum` nunca 0.

### Repositório / demo / docs
- **`npm run test:ci:local`**: cria banco descartável (`autotrader_test_<pid>`), aplica migrations, roda os **22 scripts** (22/22 PASS em ~142s no Windows), dropa o banco; não toca o DB de dev. Antes o gate local morria no 1º script e, se rodasse, truncava tabelas.
- **`npm run db:demo:clear`**: limpeza de `demo-pos-*`/snapshots/rounds/logs com dry-run default e `--yes`; teste end-to-end em banco isolado (65 linhas → 0).
- **Claims corrigidos**: `SECURITY.md` (25 permissões), `AGENT_GUIDE.md`/PLANO_MESTRE/HARDENING (cobertura 80% era aspiracional → real ~46% lines / thresholds 30/39/27; 865 checks vitest + 22 scripts), `TESTING.md` (22 scripts; `test:ci:local`), `current-state-audit.md` §D datada.
- **Cobertura**: lines 44,75% → **46,18%** (+1,43pp), funcs 51,39% → 52,58%; price-feed 3% → 100%, risk-scaling 0% → 100%, token-selector 0% → 96,5%.
- `eslint.config.mjs` ignora `.local/**`/test artifacts (antes o bundle de PoC quebrava o lint local).

### Evidências de gate (rodada 3)
- `npx tsc --noEmit` → 0 · `npx eslint .` → 0 · `npx vitest run` → **66 arquivos / 864 pass / 1 skip**
- `npm run build` → **OK** (signer.js 93 KiB + 64 pacotes de runtime + static/public)
- `npm run test:ci:local` → **22/22 PASS** em banco descartável
- Live fail-closed coberto por testes; nenhuma flag/credencial habilitada.

### Ainda pendente (goal ativo)
1. **Habilitar live de verdade** só com envelope S14 (chaves testnet, modo live, graduation, flags) — decisão do operador; signer já roda em produção se `SIGNER_SPAWN=1`, mas está **locked** (sem passphrase) e sem wallets no DB.
2. **RLS nativo Postgres** (policies + GUC por request); multi-tenant real no banco.
3. **CD automático** (workflow Railway exige `RAILWAY_TOKEN` do operador); branch protection aplicada; Sentry/Redis/AI dependem de DSN/URL/key.
4. **Cobertura** dos módulos grandes 0% (scam-detector, rising-tokens, schedule, engine/backtest); include de `src/lib/etl/**` no coverage.
5. **Docs**: Fly.io obsoleto, skill de 5 camadas continua não implementada no runtime (documentado como pendência).

---

## 10. Rodadas 4–5 (2026-11-03/04) — RLS nativo **enforçado** e migrações de produção

### 10.1 RLS nativo — policies + context + **enforcement ativo em produção**
- Migration `20260102000000_rls_policies`: **ENABLE + FORCE ROW LEVEL SECURITY** + policies `USING/WITH CHECK` por `ownerId` em `Position`, `WalletConnection`, `ExchangeConnection`, `NotificationChannel`; `rls-context.ts` (`withUserRls`/`withSystemRls`) injeta `app.user_id`/`app.rls_bypass` via `set_config(..., true)`; rotas de wallets/exchanges/notifications adotaram o contexto.
- **Role de aplicação criado no Neon**: `autotrader_app` (`rolsuper=false`, `rolbypassrls=false`) com grants de tabelas/sequences/functions + default privileges; `DATABASE_URL` de produção trocado para esse role (rollback = reverter a env para a URL antiga, guardada fora do git).
- **Verificação em produção** (após redeploy):
  - `ROLE={"current_user":"autotrader_app","rolsuper":false,"rolbypassrls":false}`; `POLICIES=4`.
  - `POSITION_COUNTS={"admin":9,"viewer":0,"none":9}` → isolamento **ativo** com contexto; sem contexto = permissivo (compatibilidade de rollout).
  - App 100% funcional: health/ready 200, login 200, wallets/exchanges/notifications/status/backup/etl 200, **signer ready** (pid 14), live paper/desligado, cookie forjado 401.
- Limitação documentada: queries ainda não migradas para `withUserRls` continuam permissivas (próximo passo: endurecer a policy depois de migrar todos os call sites).

### 10.2 Migrações de produção
- `scripts/bootstrap-prod-migrations.mjs` (dry-run default, gate de drift, idempotente): histórico do Prisma Migrate bootstrapado no Neon — `_prisma_migrations` com **baseline (111 statements)** + **rls_policies (16)**, checksums sha256, `finished_at` preenchido; schema drift **OK**. `prisma migrate deploy` futuro passa a ser aplicável.
- `scripts/verify-rls-enforcement.mjs` + `DB_MIGRATIONS_RUNBOOK.md` (rollback em 4 níveis) e `RLS.md §9`.

### 10.3 Cobertura (rodadas 4–5)
- Lines **55,79% (r4) → 62,01% (r5)**; funcs 66,10%; os módulos 0% foram cobertos: `scam-detector` ~95%, `schedule` ~97%, `rising-tokens` ~96%, `backtest` ~91%, `strategic-roadmap` 100%, `watchlist` 98,6%, `proxy-trust` 95,2%, `site-integrity` 86,7%, `position-surveillance` ~85%.
- Bug real encontrado pelos testes: `position-surveillance.ts` regex de `tax_spike` com `%\b` nunca casa findings reais; `holder_concentration` não dispara deterministicamente — registrado para correção.

### 10.4 CD / pendências do operador
- CD **pronto e desligado**: `deploy-railway.yml` endurecido + `verify-cd-config.mjs`; bloqueio = project token do Railway (a API recusou `projectTokenCreate` para o token OAuth do CLI). Passos: dashboard → `gh secret set RAILWAY_TOKEN` → `gh variable set RAILWAY_DEPLOY_ENABLED --body true`.
- Live trading segue **desligado** (sem chaves/op S14); Sentry/Redis/AI aguardam DSN/URL/key.

### 10.5 Gates finais (rodada 5)
- `tsc` 0 · `eslint` 0 · `vitest` **77 arquivos / 1050 pass / 1 skip** · build OK · CI verde nas PRs #105–#108 · `main` protegido (checks `ci`+`codeql`, sem force-push/deleção).

---

## 11. Rodada 6 (2026-11-04) — RLS **strict** fase 2 + bugs de surveillance

- **RLS strict em produção**: migration `20260103000000_rls_strict_wallet_notification` removeu a cláusula permissiva "sem contexto" de **WalletConnection** e **NotificationChannel**. Catálogo verificado em prod: essas 2 = STRICT; Position/ExchangeConnection = permissivas (fase 1). Role `autotrader_app` segue `rolbypassrls=false`.
- **Rollout invertido**: código deployado primeiro (todos os call sites com `withUserRls`/`withSystemRls`: wallet-manager, rotas wallets, `wallet-crypto.loadVault`, signer `sign-methods`, dex-adapter, live-credentials, notifier, backup/info, backfill do db-init), depois a migration foi aplicada via SQL idempotente e **registrada no histórico** (`_prisma_migrations` agora com 3 migrations; `prisma migrate status` = up to date).
- **Verificação pós-strict**: login 200; wallets/notifications/exchanges/system info/backup/etl 200; signer ready; live paper/desligado; cookie forjado 401.
- **Bugs reais corrigidos**: regex `tax_spike` (nunca casava `"25% "`) e `holder_concentration` (parsing não determinístico) — 31 testes de surveillance; `wallet-crypto` 11, `paper-trader` 14, `notifier` 31.
- **Cobertura**: lines 61,93% → **64,44%**; funcs 68,71%.
- **Gates**: tsc 0 · eslint 0 · `vitest` **81 arquivos / 1131 pass / 1 skip** · build OK (signer 96,5 KiB).
- **Pendente**: fase 2 restante (Position, ExchangeConnection) — migrar call sites e repetir rollout; operador: CD token, chaves S14 live, Sentry/Redis/AI.

---

## 12. Rodadas 7–8 (2026-11-04) — RLS **strict nas 4 tabelas** e scripts de manutenção seguros

### 12.1 RLS strict completo (fail-closed)
- Rodada 7: `ExchangeConnection` strict (manager com tx, rotas `withUserRls`, `live-credentials`/`wallet-crypto`/`db-init` system) + **33 call sites de `db.position.*` migrados** para `withSystemRls`/`withUserRls` (auditor `scripts/audit-rls-context.mjs` = 0 violações) + teste de strict simulado.
- Rodada 8: `Position` strict (última tabela) — migration `20260105000000_rls_strict_position`, testes integrais atualizados, docs RLS v5.
- **Produção após flip**: `ROLE={"current_user":"autotrader_app","rolbypassrls":false}`; catálogo **STRICT nas 4 tabelas** (WalletConnection, NotificationChannel, ExchangeConnection, Position); `_prisma_migrations` com **5 migrations**, `prisma migrate status` = up to date.
- **Verificação pós-flip em produção**: health/ready 200, login 200, `/api/status` (paths de sistema de Position) 200 com contagens, `/api/positions` (super_admin bypass) 200, analytics/history/surveillance/backup/info/etl 200, signer ready, live paper/desligado, cookie forjado 401.
- Efeito multi-tenant: viewer/trader passam a ver apenas as próprias posições/wallets/exchanges/canais; `super_admin` bypassa; engine/jobs usam `withSystemRls`.
- Rollback documentado: recriar as policies permissivas da `20260102000000_rls_policies` (sem deploy de código).

### 12.2 Scripts de manutenção sob RLS
- `scripts/lib/require-bypass-rls.mjs`: guard que **aborta** (exit 1) se o `DATABASE_URL` não tiver `BYPASSRLS`/superuser, com mensagem acionável; validado nos dois sentidos (app role em prod → ABORTA; owner local → OK).
- 8 scripts de manutenção protegidos (seed-demo, seed-auth, clear-demo-data, cleanup-wallets, cleanup-stress-wallets, reset-db, backfills); scripts de `test:ci` isentos (DB descartável superuser).
- `verify-rls-enforcement.mjs` agora classifica **as 4 tabelas** STRICT/PERMISSIVE e suporta `--expect-all-strict`.
- Correções de dívida: client Prisma CJS legado com adapter por URL (`scripts/lib/prisma-client-maintenance.cjs`) e imports quebrados nos backfills.
- Runbook: `DB_MIGRATIONS_RUNBOOK.md §8` (owner vs app role vs test:ci, tabela script→guard, rollback).

### 12.3 Gates finais (rodada 8)
- `tsc` 0 · `eslint` 0 · `vitest` **83 arquivos / 1161 pass / 1 skip** · auditor RLS exit 0 · CI verde · PR #111 e (round 8) mergeados em `main`.

---

## 13. Rodada 9 (2026-11-04) — backup/restore provado, E2E, a11y e cobertura do motor

- **Backup/restore E2E real (Docker)**: scripts/backup-restore-e2e.mjs roda pg_dump -Fc + pg_restore em containers postgres:16 contra o Postgres local (host.docker.internal), banco descartável, compara TODAS as tabelas e limpa. Resultado: **PASS — 34/34 tabelas e 2410/2410 linhas idênticas**. O teste revelou e corrigiu: restore quebrava por GRANT a roles efêmeras (dump agora --no-acl, com nota de DR) e tabelas voláteis (classificação explícita). Scripts ganharam PG_DUMP_BIN/PG_RESTORE_BIN (Windows/Docker) e BACKUP_DR.md §7.
- **E2E Playwright em banco isolado**: main **49/52** e Meridian **12/13**; 2 falhas eram **a11y real** (scrollable-region-focusable serious) e 1 flake de transporte. **Corrigido no app**: tabIndex={0} (+ role/aria onde aplicável) em 12 regiões roláveis de tabelas/painéis; spec a11y-dashboard re-executada contra o build standalone → **1 passed, axe evidence []**. Meridian 1 falha é o copilot ledger dependente de provider LLM (sem key no ambiente).
- **Fila**: o bullmq-stub era **dead code** (0 callers de produção; só um teste) e foi **removido** (stub + teste). Fila assíncrona real (BullMQ+Redis) **não implementada** — documentado em SECURITY/PLANO_MESTRE/README; não recriar stub.
- **Cobertura do motor**: +51 testes determinísticos (mocks de db/RLS, fake timers): portfolio.ts 2%→**100%**, performance-snapshot.ts 0→**100%**, engine.ts 0→15%, engine-correctness 100%. Global: lines **64,46% → 67,24%**, funcs 68,30% → **71,06%**.
- **Gates**: tsc 0 · eslint 0 · vitest **85 arquivos / 1205 pass / 1 skip** · build OK · a11y spec verde · backup E2E exit 0.
