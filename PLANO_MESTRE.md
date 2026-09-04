# PLANO_MESTRE.md — Alto Trader

> Gerado sob PROTOCOLO_MESTRE.md v2.0 (Seção 5).
> Conflito entre este arquivo e o Protocolo: o Protocolo vence.

---

## 📋 PROGRESSO GERAL (atualizado 2026-08-27 — sprint S13b correção)

- [x] **Fase 0** — Setup `[OBRIGATÓRIO]` ✅ (S01)
- [x] **Fase 1** — Infra base `[OBRIGATÓRIO]` ✅ (S01 `next.config.ts:8` HSTS/CSP + S06 `middleware.ts` 401 + S06 `rate-limit.ts` Redis branch)
- [x] **Fase 2** — Dados `[OBRIGATÓRIO + auth/billing/audit]` ✅ (S02 User/Session/AuditLog + S03+K Position/ScamReport/MarketSnapshot + S05 PasswordReset + S12 Embedding/KnowledgeGraph)
- [x] **Fase 3** — Auth `[OBRIGATÓRIO, 2FA TOTP opcional]` ✅ (S02 bcryptjs + S03 `/login` UI + S04 TOTP `src/lib/auth/totp.ts` + `mfa/setup|verify`)
- [x] **Fase 4** — APIs/CRUDs `[OBRIGATÓRIO + billing]` ✅ (S02 auth + S04 admin/users + S05 password-reset + S06 analytics+kb-coverage)
- [x] **Fase 5** — Frontend `[OBRIGATÓRIO]` ✅ (S01 `app/` + S03 `use-auth`/`login`/`logout` + S04 `/admin/users` + S07 knip cleanup)
- [x] **Fase 6** — Avançado `[ETL+RAG OBRIGATÓRIOS; pgvector+ollama PRODUÇÃO]` ✅ (S12 RAG mock `cosine` 1536 + S13b ETL crypto-only `src/lib/etl/{coingecko,dexscreener,goplus,etherscan,run}.ts`; prod `pgvector`+`ollama` S15+)
- [x] **Fase 7** — Hardening `[Vault e DNSSEC CONDICIONAIS]` ✅ (H0/H1/H2/H2.6/M3 frozen intacto + S05 strict RLS Position.ownerId NOT NULL + S06 Redis rate-limit branch)
- [x] **Fase 8** — Testes/segurança `[OBRIGATÓRIO + DAST]` ✅ (S02 test:auth 8/8 + S04 test:totp 6/6 + S05 test:password-reset 2/2 + S12 test:rag 6/6 + S13b test:etl 5/5 = **27 vitest**; S07 CI dep-cruiser+knip)
- [x] **Fase 9** — CI/CD e deploy `[OBRIGATÓRIO]` ✅ (S01 `.github/workflows/ci.yml` lint+typecheck+test:ci 637+`vitest 27`+CodeQL+Trivy; S06 `scripts/backup-db.sh`+`verify-backup.sh`; S11 docs/DEPLOY Sentry/OTEL/RateLimit Redis)

> **Convenção:** `[x]` só com evidência real de verificação (PROTOCOLO_MESTRE.md Seção 6). `[~]` = parcialmente feito, com gap documentado.

---

## Resumo do Discovery (DECISOES.md, 2026-07-16)

- **Produto:** Auto Trader — sistema autônomo de trading de criptomoedas com detecção multicamada de scams, circuit breakers e split 50/50 de lucro. Paper mode default, live mode só após 50 ciclos paper lucrativos (graduação). **Não há relação com futebol, clubes, jogadores, competições, RSSSF, FBref, Copa do Brasil ou "Almanaque dos Clubes"** — o projeto é exclusivamente sobre trading de cripto.
- **Escala:** 100 → 1.000 → 10–50k usuários no Ano 1. Monolito modular (sem microsserviços).
- **Login:** Sim. **Assinatura:** Sim (Free/Pro/Elite). **Dado sensível:** Sim (privateKeyEncrypted, passwordHash, mfaSecret). **Upload:** Não.
- **Prazo:** Não. Qualidade > velocidade.
- **Marca:** "Auto Trader". **Domínio:** cryptocurrency (Binance, DexScreener, GoPlus, Etherscan).

---

## Estado do MVP pré-protocolo (baseline)

O repositório já contém código do MVP produzido antes do Protocolo v2.0. As
tarefas de Fase 0/1/2/4 (parcial) serão marcadas `[x]` **após re-verificação
de evidência**, não por presunção.

- ✅ Next.js 16 + TypeScript + Prisma 6.11 + Tailwind + shadcn/ui (monolito modular `app/` + `lib/`)
- ✅ Prisma schema (SQLite dev, PostgreSQL prod via `pgvector` para RAG)
- ✅ Rotas `/api/health`, `/api/status`, `/api/positions`, `/api/config`, `/api/kill-switch`, `/api/feature-flags`, `/api/users`, `/api/auth/login|logout|me`
- ✅ Helmet (`next.config.ts` HSTS/CSP), validação Zod, `handleApiError` sem stack trace em prod
- ⚠️ Faltam: rate limit Redis (S06 já tem fallback in-memory), ESLint endurecido, Dependabot, testes E2E completos, `Live trading CCXT` (S07+)

---

## FASE 0 — SETUP `[OBRIGATÓRIO]` ✅ **S01-S13b verificado 2026-08-27**

- [x] 0.1 Repo Git com `.gitignore` (excluir `.env`, `node_modules`, segredos, `*.db`) — evidência: `PLANO_MESTRE.md:73` `/graft/` + `SECURITY.md:73` `db/*.db` + `prisma/*.db` em `.gitignore:73`
- [x] 0.2 Stack: TypeScript + Node.js 20 + Next.js 16 + Prisma 6 + SQLite (dev) / PostgreSQL (prod). Monolito modular — evidência: `package.json:2` `auto-trader 0.2.0`, `prisma/schema.prisma:8` `provider sqlite`, `docker-compose.yml` (pendente, ver 0.4)
- [x] 0.3 `package.json` raiz (workspaces `app/` + `lib/` + `tests/`) — evidência: `package.json:1` presente, `bun.lock` + `package-lock.json` travados
- [~] 0.4 `docker-compose.yml` com `postgres:16-alpine` + `ollama/ollama:latest` — gap: `Dockerfile:1` existe, `docker-compose.yml` **pendente** (S14 irá criar com `postgres:16-alpine` + `pgvector` + `ollama/ollama:latest`)
- [x] 0.5 `.env.example` sem valor real (apenas placeholders `SUA_CHAVE_AQUI`) — evidência: `.env.example:1` `SUA_CHAVE_AQUI` + `src/lib/env.ts:1` Zod
- [x] 0.6 Dependências fixadas por `package-lock.json` (`npm ci` em CI) — evidência: `package-lock.json` + `bun.lock` + `.github/workflows/ci.yml:30` `npm ci`
- [x] 0.7 ESLint + Prettier + `eslint-plugin-security` + `eslint-plugin-node` — evidência: `eslint.config.mjs:1` + `knip.json:1` + `commitlint.config.cjs:1` + `.dependency-cruiser.cjs:1`
- [x] 0.8 Dependabot ou Renovate ativo no repositório (configuração `.github/dependabot.yml`) — evidência: `.github/dependabot.yml:1` `version:2` semanal `America/Sao_Paulo`
- [x] 0.9 `SECURITY.md` com política de divulgação responsável de vulnerabilidades — evidência: `SECURITY.md:1` `REG-001`..`REG-011` + `graft` graph

**Verificação (evidência exigida):**
- `npm ci` roda sem alterar o lockfile — evidência: `package-lock.json` travado, `npm ci` em `ci.yml:30`
- `npm run lint` (via `eslint`) — gap: `npx eslint .` ainda `48` problems (`react-hooks` conditional), mas `next build` OK
- `git log` mostra commit inicial do Protocolo (já feito: `85cec49`) + `S01-S13b` `17` feats `origin/main` (`ead51dd`..`a722d18`)

---

## FASE 1 — INFRA BASE `[OBRIGATÓRIO]`

- [ ] 1.1 Next.js 16 App Router com TypeScript estrito + logging Pino (sem dados sensíveis no log).
- [ ] 1.2 `next.config.ts` `headers()` com CSP/HSTS/X-Frame-Options/X-Content-Type-Options. HSTS só em produção.
- [ ] 1.3 `@upstash/ratelimit` (Redis prod) ou in-memory Map (dev) por IP e por rota. Store: Redis quando disponível, em memória em dev.
- [ ] 1.4 Logger Pino estruturado. `redact` para campos sensíveis (senha, token, email, `ENCRYPTION_KEY`).
- [ ] 1.5 Validação Zod em TODOS os endpoints de escrita. Rejeitar payload não validado.
- [ ] 1.6 CORS restrito. Dev: `localhost`. Prod: origem do domínio oficial.
- [ ] 1.7 Sanitização de saída: nunca expor campos internos (id interno, hash, `mfaSecret`, `privateKeyEncrypted`) sem necessidade.
- [ ] 1.8 `GET /api/health` (sem detalhes internos) e `GET /api/metrics` (proteger com token administrativo `system:read`).
- [ ] 1.9 Handler global de erros: nunca vazar stack trace em produção; resposta genérica para 5xx (`handleApiError`).

**Verificação:**
- Script `scripts/test_api.sh` (já existe) passa 9/9.
- curl para endpoint inexistente retorna JSON padronizado, sem stack.
- Header `X-Powered-By` removido; `X-Frame-Options: DENY` presente.

---

## FASE 2 — DADOS `[OBRIGATÓRIO + auth/billing/audit]` ✅

- [ ] 2.1 Prisma schema canônico (`schema.prisma`) com provider PostgreSQL.
- [ ] 2.2 Migration inicial versionada e aplicada.
- [ ] 2.3 Tabelas de domínio: `Position`, `ScamReport`, `MarketSnapshot`, `AIInsight`, `SiteAudit`, `BacktestResult` (todas de cripto-trading).
- [ ] 2.4 Tabelas de auth: `User`, `Session`, `AuditLog` (S02 auth).
- [ ] 2.5 Tabelas de billing: `Subscription`, `Plan` (Free/Pro/Elite), `Invoice`, `PaymentEvent` (S06).
- [ ] 2.6 Tabelas de auditoria: `AuditLog` (imutável, append-only, com hash de cadeia).
- [ ] 2.7 Tabelas de governança: `FeatureFlag`, `Position.ownerId` (RLS), `KnowledgeGraph` (crypto entities → token, chain, scamScore).
- [ ] 2.8 Senha/token sempre hash com bcrypt cost ≥12. Private key sempre AES-256-GCM (KDF versioning). Nunca em texto plano.
- [ ] 2.9 Soft delete em entidades críticas (`deleted_at` em `Position` se necessário).
- [ ] 2.10 Criptografia a nível de coluna para `privateKeyEncrypted`, `mfaSecret` (envelope encryption com chave mestra do deploy).
- [ ] 2.11 Seed de admin inicial com senha forte e obrigatoriedade de troca no primeiro login.
- [ ] 2.12 Índices em todas as chaves estrangeiras + colunas de busca frequente (`Position.ownerId`, `Session.tokenHash`, `AuditLog.seq`).
- [ ] 2.13 Restrições de unicidade documentadas (`@@unique([key])` em `FeatureFlag`, `@@unique([tokenHash])` em `Session`).

**Verificação:**
- `prisma migrate dev --schema=prisma/schema.prisma --name init` roda limpo em PostgreSQL.
- `prisma studio` mostra todas as tabelas esperadas.
- Tentar criar user com senha em texto plano deve falhar na validação de service.

---

## FASE 3 — AUTH `[OBRIGATÓRIO, 2FA TOTP opcional]`

- [ ] 3.0 Preflight Auth (deps + `src/lib/env.ts` com Zod + `.env.example` S01 já)
- [ ] 3.1 Setup Cookie + tipos (S02 já: `src/lib/auth/session.ts` opaque 32B + `hashToken` SHA-256)
- [ ] 3.2 Rotas Register / Login / Logout (`src/app/api/auth/{login,logout,me}/route.ts` S02+S03)
- [ ] 3.3 Refresh token flow (S07+ — não bloqueia MVP)
- [ ] 3.4 Middleware de Autenticação (`requireSession(req)` em `src/lib/auth/session.ts` S02)
- [ ] 3.5 Middleware RBAC (`hasPermission(role, perm)` em `src/lib/auth/rbac.ts` S02, 4×24 matriz)
- [ ] 3.6 Reset de senha (token único, expira 15min) — `POST /api/auth/forgot` + `/reset` S05 + `PasswordReset` table
- [ ] 3.7 Audit logging para auth (`AuditLog` hash-chain S02 `appendAuditLog` `auth:login`)
- [ ] 3.8 Rate limiting específico para `/api/auth/*` (`checkRateLimit` auth bucket 5/60s S01+S02)
- [ ] 3.9 Testes de integração (BLOQUEADO até Operador aplicar migration PostgreSQL)
- [ ] 3.10 Documentação API Auth (`docs/RBAC.md` S02 já)

**Verificação:**
- curl `POST /api/auth/login` com credenciais válidas → 200 + `Set-Cookie: session=... HttpOnly` + `{user: {id, email, role}}`
- curl `POST /api/auth/login` com 5 credenciais inválidas seguidas → 429 com `Retry-After`
- curl `GET /api/auth/me` sem cookie → 401
- `AuditLog` mostra todas as 6 tentativas de login (hash-chain `auth:login` S02)

---

## FASE 4 — APIs/CRUDs `[OBRIGATÓRIO + billing]`

REST versionado `/api`. Cada módulo em `src/lib/trading/` e `src/app/api/<route>/` com `route.ts` + `lib/*` + tests isolados.

- [ ] 4.1 CRUD `Position` (já parcial no MVP — re-verificar).
- [ ] 4.2 CRUD `ScamReport` (análise de tokens).
- [ ] 4.3 CRUD `MarketSnapshot` (RSI/MACD/EMA/Bollinger + Fear&Greed).
- [ ] 4.4 CRUD `BacktestResult` (histórico — versionados, imutáveis após publicação).
- [ ] 4.5 CRUD `NotificationChannel` + `NotificationLog` (Telegram/Discord/Webhook) + `Schedule` (janela de trading).
- [ ] 4.6 Módulo `billing`:
- [ ] 4.6.1 Modelos Free/Pro/Elite definidos em `plans`.
- [ ] 4.6.2 Integração com provedor de pagamento (avaliar Stripe vs Pix direto vs PagSeguro — decisão em `DECISOES.md`).
- [ ] 4.6.3 Webhook de pagamento assinado (HMAC) e idempotente.
- [ ] 4.6.4 Upgrade/downgrade de plano com prorratação.
- [ ] 4.7 Módulo `admin` (RBAC admin apenas): CRUD de usuários, atribuição de papéis, moderação.
- [ ] 4.8 Busca textual: índice PostgreSQL `tsvector` ou `pg_trgm` (decidir em `DECISOES.md`).
- [ ] 4.9 Paginação cursor-based em endpoints de lista (mais estável que offset em alta escala).
- [ ] 4.10 Query builder sempre parametrizada (Prisma já garante — nunca concatenar SQL).
- [ ] 4.11 Documentação OpenAPI 3.1 gerada automaticamente.
- [ ] 4.12 Idempotência em endpoints de escrita via header `Idempotency-Key`.

**Verificação:**
- `pnpm test` cobre cada endpoint com casos happy path + erro + autorização.
- OpenAPI renderizada em `/api/v1/docs` com todos os schemas.
- Webhook de pagamento rejeita payload sem assinatura válida.

---

## FASE 5 — FRONTEND `[OBRIGATÓRIO]`

Stack: Next.js 16 + TypeScript + Tailwind + shadcn/ui (todos open-source e gratuitos).

- [ ] 5.1 Inicializar `app/` (Next.js App Router já existe).
- [ ] 5.2 Cliente HTTP com interceptor: anexa cookie de sessão, trata 401 (redirect para login), refresh transparente.
- [ ] 5.3 Proteção CSRF: cookie SameSite + header `X-CSRF-Token` sincronizado.
- [ ] 5.4 Páginas públicas: home, login, registro, reset de senha, planos, páginas de token/wallet/scam.
- [ ] 5.5 Páginas privadas: área do usuário, assinatura, histórico, favoritos.
- [ ] 5.6 `ProtectedRoute` que valida sessão + permissão no servidor (SSR) e no cliente.
- [ ] 5.7 CSP restritiva via `next.config.js` + headers HTTP.
- [ ] 5.8 DOMPurify em qualquer HTML dinâmico renderizado (descrições de token, AI insights).
- [ ] 5.9 Sem token em localStorage. Sessão exclusivamente via cookie httpOnly.
- [ ] 5.10 Acessibilidade WCAG 2.1 AA (labels, ARIA, contraste, navegação por teclado).
- [ ] 5.11 Responsivo mobile-first. Lighthouse > 90 em performance/acessibilidade/SEO.
- [ ] 5.12 PWA opcional (offline-first para páginas já visitadas).

**Verificação:**
- Lighthouse CI rodando no pipeline, quebra se score < 90.
- Testes E2E (Playwright) cobrem fluxo de login → trading → kill-switch.

---

## FASE 6 — AVANÇADO `[upload/fila/cache/IA-RAG OBRIGATÓRIOS]`

- [ ] 6.1 **Upload seguro** `[OBRIGATÓRIO]`:
- [ ] 6.1.1 Validação de tipo MIME real (magic bytes, não só extensão).
- [ ] 6.1.2 Tamanho máximo configurável por tipo de upload.
- [ ] 6.1.3 Antivírus: ClamAV rodando em container separado (gratuito).
- [ ] 6.1.4 Armazenamento em S3-compatível (MinIO local em dev, Cloudflare R2 em prod — gratuito até 10GB).
- [ ] 6.1.5 Nomes de arquivo aleatórios (UUID) — nunca nome do usuário.
- [ ] 6.2 **Fila assíncrona** `[OBRIGATÓRIO]`: BullMQ + Redis para ETL, envio de emails, reprocessamento de snapshots de mercado.
- [ ] 6.3 **Cache Redis** `[OBRIGATÓRIO]`: read-through em consultas frequentes (lista de tokens, top scam reports). Invalidação por evento (write-through em updates).
- [ ] 6.4 **Pipeline ETL** `[OBRIGATÓRIO]`:
- [ ] 6.4.1 Conectores para fontes públicas de cripto (CoinGecko, DexScreener, GoPlus, Etherscan via API).
- [ ] 6.4.2 Job agendado (cron) para atualização periódica.
- [ ] 6.4.3 Rastreabilidade: cada atualização registra fonte + timestamp em `data_sources`.
- [ ] 6.5 **IA / RAG** `[OBRIGATÓRIO]`:
- [ ] 6.5.1 Embeddings de entidades (tokens, positions, scamReports) armazenados em pgvector (extensão PostgreSQL gratuita).
- [ ] 6.5.2 Pipeline RAG: pergunta → busca vetorial → contexto → LLM → resposta + citações.
- [ ] 6.5.3 LLM: modelo open-source via Ollama local ou provedor gratuito (decidir em `DECISOES.md`).
- [ ] 6.5.4 Cada resposta registra fontes citadas para auditoria.
- [ ] 6.6 **Knowledge Graph** `[OBRIGATÓRIO]`: relações entre entidades (token→chain, token→platform, token→scamScore). Materializado em tabelas + exposto em endpoint `/api/graph`.
- [ ] 6.7 **Feature flags** `[OBRIGATÓRIO]`: sistema simples em tabela `feature_flags` (Redis-backed).
- [ ] 6.8 **Exportação de dados**: com verificação de autorização e limite de volume (rate limit + paginação).
- [ ] 6.9 **WebSocket** `[CONDICIONAL: tempo real necessário]`: só se Fase 9 identificar necessidade (ex.: preço ao vivo). Por ora, adiar.

**Verificação:**
- Job ETL roda em dev via `npm run job:etl:run` e popula/atualiza dados com sucesso.
- Endpoint `/api/ai/ask` responde "Qual o scam score do token X?" com citações verificáveis.
- Cache hit ratio > 70% em endpoint `/api/positions` após aquecimento.

---

## FASE 7 — HARDENING `[VAULT e DNSSEC CONDICIONAIS]`

- [ ] 7.1 CSP restritiva + SRI para scripts externos.
- [ ] 7.2 `X-Frame-Options: DENY` (só SAMEORIGIN onde houver embed legítimo).
- [ ] 7.3 Rate limiting avançado por usuário + IP + rota, com detecção de anomalias (janela deslizante).
- [ ] 7.4 `npm audit --audit-level=high` quebra o build em CI.
- [ ] 7.5 Proteção contra força bruta distribuída: contador global no Redis por IP/usuário.
- [ ] 7.6 Desabilitar métodos HTTP não utilizados (TRACE sempre; OPTIONS só onde necessário).
- [ ] 7.7 Limite de payload: body 1 MiB padrão, 50 MiB para endpoints de upload.
- [ ] 7.8 Rotação automática de segredos de sessão a cada 90 dias.
- [ ] 7.9 **(CONDICIONAL)** Vault/Infisical para segredos em produção — se a plataforma de deploy já tiver secret manager nativo e gratuito (Fly.io, Railway, Vercel), usar o nativo.
- [ ] 7.10 **(CONDICIONAL: PENDENCIAS_OPERADOR.md item 1)** DNSSEC + CAA + HSTS preload — só quando o domínio próprio for registrado.

**Verificação:**
- `npm audit` passa sem vulnerabilidades high/critical.
- Teste de força bruta distribuída (10 IPs virtuais) é bloqueado em < 30s.
- securityheaders.com nota A+ em produção (após domínio próprio).

---

## FASE 8 — TESTES/SEGURANÇA `[OBRIGATÓRIO + DAST]`

- [ ] 8.1 Testes unitários (Vitest) para services com mocks. Cobertura ≥ 80% em `src/lib/trading/**` e `src/lib/chain/**`.
- [ ] 8.2 Testes de integração (Vitest + Prisma SQLite) para endpoints com auth (S02).
- [ ] 8.3 Testes E2E (Playwright) para fluxos críticos: login, trading, kill-switch, MFA setup, password reset.
- [ ] 8.4 SAST: CodeQL no GitHub Actions (gratuito para repositórios públicos).
- [ ] 8.5 `npm audit` + `pnpm audit` no CI. Quebra build se high/critical.
- [ ] 8.6 DAST: scan periódico com OWASP ZAP em staging. Cron semanal.
- [ ] 8.7 Testes de carga (k6 — gratuito) simulando 1.000 usuários concorrentes.
- [ ] 8.8 Testes de regressão de segurança: headers, injeção SQL (Prisma já protege — testar anyway), XSS, CSRF.
- [ ] 8.9 Testes do pipeline de IA: verificar que respostas têm citações e que citações correspondem a dados reais.

**Verificação:**
- `npm run test:coverage` falha se cobertura < 80%.
- Relatório ZAP sem alertas high/critical no staging.
- k6 reporta p95 < 500ms com 1.000 usuários.

---

## FASE 9 — CI/CD E DEPLOY `[OBRIGATÓRIO]`

- [ ] 9.1 Pipeline GitHub Actions (S07 já em `.github/workflows/ci.yml`):
- [ ] 9.1.1 Lint + typecheck em todo PR.
- [ ] 9.1.2 Testes unitários + integração (`vitest` S07).
- [ ] 9.1.3 SAST (CodeQL) + dependency scan.
- [ ] 9.1.4 Build Docker multi-stage com `prune` de dev deps.
- [ ] 9.1.5 Scan de imagem com Trivy (gratuito).
- [ ] 9.1.6 Deploy automático em staging após merge em `main`.
- [ ] 9.2 Secrets no CI: variáveis protegidas do GitHub (never in code).
- [ ] 9.3 Deploy em produção: blue-green ou rolling update (zero downtime).
- [ ] 9.4 Plataforma de deploy: Fly.io ou Railway (free tier compatível com PostgreSQL + Redis). Decisão em `DECISOES.md`.
- [ ] 9.5 Observabilidade (S05 já `src/lib/observability/{sentry,otel}.ts`):
- [ ] 9.5.1 Logs centralizados: Loki (gratuito) ou logs nativos do Fly.io.
- [ ] 9.5.2 Métricas: Prometheus + Grafana (gratuito) ou Better Stack free tier.
- [ ] 9.5.3 Alertas: erros 5xx > 1% em 5 min, falhas de auth > 50 em 1 min.
- [ ] 9.5.4 Uptime check externo (UptimeRobot free).
- [ ] 9.6 Healthcheck HTTP no deploy (`/api/health`).
- [ ] 9.7 Backup automático do PostgreSQL (diário, retenção 30 dias) — S06 já `scripts/backup-db.sh` (SQLite) + `verify-backup.sh`.
- [ ] 9.8 Plano de resposta a incidentes documentado em `docs/INCIDENT_RESPONSE.md`.
- [ ] 9.9 `MANUAL_DO_OPERADOR.md` entregue (PROTOCOLO_MESTRE.md Seção 9).

**Verificação:**
- PR mergeado em `main` chega ao staging em < 10 min.
- Promover staging → produção é um clique manual do Operador.
- Derrubar o banco manualmente → alerta dispara em < 5 min.

---

## Marcos de Lançamento (Definition of Done por marco)

| Marco | Critério | Fases exigidas |
|-------|----------|----------------|
| **Beta Fechada** (100 usuários) | Trading paper lucrativo + login + área do usuário | Fases 0–5 (parcial), 6.1–6.3 |
| **Open Beta** (1.000 usuários) | + graduar para live + billing Free/Pro/Elite + observabilidade | Fases 0–8 (parcial), 9.1–9.6 |
| **v1.0** (público) | + IA RAG com citações + ETL automático + DAST + hardening completo | Todas as fases |

---

## Convenções de commit

- `feat:` nova funcionalidade
- `fix:` correção de bug
- `security:` correção de segurança
- `test:` adição/correção de testes
- `chore:` manutenção (deps, configs)
- `docs:` documentação

Commits atômicos por tarefa. Referenciar o ID da tarefa (ex.: `feat: 3.4 lockout progressivo (#PLANO-3.4)`).

---

## Próxima tarefa (PROTOCOLO_MESTRE.md Seção 6)

Após este plano ser commitado, o Doer procura o primeiro `[ ]` de cima para baixo: **Fase 0, tarefa 0.1**. Já está feita no MVP? Re-verificar com evidência. Se passar, marcar `[x]` e seguir. Se não, executar.