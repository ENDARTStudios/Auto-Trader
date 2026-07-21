# PLANO_MESTRE.md — Alto Trader

> Gerado sob PROTOCOLO_MESTRE.md v2.0 (Seção 5).
> Conflito entre este arquivo e o Protocolo: o Protocolo vence.

---

## 📋 PROGRESSO GERAL (CHECKLIST RESUMIDA)

- [ ] Fase 0 – Setup `[OBRIGATÓRIO]`
- [ ] Fase 1 – Infra base `[OBRIGATÓRIO]`
- [ ] Fase 2 – Dados `[OBRIGATÓRIO + auth/billing/audit]` ✅ (2026-07-20)
- [ ] Fase 3 – Auth `[OBRIGATÓRIO, 2FA TOTP opcional]`
- [ ] Fase 4 – APIs/CRUDs `[OBRIGATÓRIO + billing]`
- [ ] Fase 5 – Frontend `[OBRIGATÓRIO]`
- [ ] Fase 6 – Avançado `[upload/fila/cache/IA-RAG OBRIGATÓRIOS; WebSocket CONDICIONAL]`
- [ ] Fase 7 – Hardening `[Vault e DNSSEC CONDICIONAIS]`
- [ ] Fase 8 – Testes/segurança `[OBRIGATÓRIO + DAST]`
- [ ] Fase 9 – CI/CD e deploy `[OBRIGATÓRIO]`

> **Convenção:** `[x]` só com evidência real de verificação (PROTOCOLO_MESTRE.md Seção 6). `[~]` = parcialmente feito, com gap documentado.

---

## Resumo do Discovery (DECISOES.md, 2026-07-16)

- **Produto:** Plataforma mundial de inteligência em futebol — clubes, jogadores, competições, rankings auditáveis, IA RAG com citações, Knowledge Graph.
- **Escala:** 100 → 1.000 → 10–50k usuários no Ano 1. Monolito modular (sem microsserviços).
- **Login:** Sim. **Assinatura:** Sim (Free/Pro/Elite). **Dado sensível:** Não. **Upload:** Sim (admin/CSV).
- **Prazo:** Não. Qualidade > velocidade.
- **Marca:** "Almanaque dos Clubes". **Domínio:** Pendente (PENDENCIAS_OPERADOR.md item 1).

---

## Estado do MVP pré-protocolo (baseline)

O repositório já contém código do MVP produzido antes do Protocolo v2.0. As
tarefas de Fase 0/1/2/4 (parcial) serão marcadas `[x]` **após re-verificação
de evidência**, não por presunção.

- ✅ Monorepo pnpm (apps/api + packages/domain)
- ✅ Fastify 5 + Prisma 5.22 + TypeScript estrito
- ✅ Prisma schema (PostgreSQL canônico + SQLite sandbox)
- ✅ Rotas `/api/v1/health`, `POST /clubs`, `GET /clubs`, `GET /clubs/:id`
- ✅ Helmet, CORS, validação Zod, tratamento de erros sem stack trace
- ⚠️ Faltam: rate limit, ESLint de segurança, Dependabot, testes automatizados

---

## FASE 0 — SETUP `[OBRIGATÓRIO]`

- [ ] 0.1 Repo Git com `.gitignore` (excluir `.env`, `node_modules`, segredos, `*.db`).
- [ ] 0.2 Stack: TypeScript + Node.js + Fastify + Prisma + PostgreSQL. Monolito modular.
- [ ] 0.3 `package.json` raiz + `apps/api` + `packages/domain` (workspace pnpm).
- [ ] 0.4 `docker-compose.yml` com `postgres:16-alpine` (backend/frontend no compose virão na Fase 9).
- [ ] 0.5 `.env.example` sem valor real (apenas placeholders).
- [ ] 0.6 Dependências fixadas por `pnpm-lock.yaml` (`pnpm install --frozen-lockfile` em CI).
- [ ] 0.7 ESLint + Prettier + `eslint-plugin-security` + `eslint-plugin-node`.
- [ ] 0.8 Dependabot ou Renovate ativo no repositório (configuração `.github/dependabot.yml`).
- [ ] 0.9 `SECURITY.md` com política de divulgação responsável de vulnerabilidades.

**Verificação (evidência exigida):**
- `pnpm install --frozen-lockfile` roda sem alterar o lockfile.
- `pnpm lint` passa sem erro.
- `git log` mostra commit inicial do Protocolo (já feito: `85cec49`).

---

## FASE 1 — INFRA BASE `[OBRIGATÓRIO]`

- [ ] 1.1 Fastify com TypeScript estrito + logging Pino (sem dados sensíveis no log).
- [ ] 1.2 `@fastify/helmet` com CSP/HSTS/X-Frame-Options/X-Content-Type-Options. HSTS só em produção.
- [ ] 1.3 `@fastify/rate-limit` por IP e por rota. Store: Redis quando disponível, em memória em dev.
- [ ] 1.4 Logger Pino estruturado. `redact` para campos sensíveis (senha, token, email).
- [ ] 1.5 Validação Zod em TODOS os endpoints de escrita. Rejeitar payload não validado.
- [ ] 1.6 CORS restrito. Dev: `localhost`. Prod: origem do domínio oficial (PENDENCIAS_OPERADOR.md item 1).
- [ ] 1.7 Sanitização de saída: nunca expor campos internos (id interno, hash, etc.) sem necessidade.
- [ ] 1.8 `GET /api/v1/health` (sem detalhes internos) e `GET /api/v1/metrics` (proteger com token administrativo).
- [ ] 1.9 Handler global de erros: nunca vazar stack trace em produção; resposta genérica para 5xx.

**Verificação:**
- Script `scripts/test_api.sh` (já existe) passa 9/9.
- curl para endpoint inexistente retorna JSON padronizado, sem stack.
- Header `X-Powered-By` removido; `X-Frame-Options: SAMEORIGIN` presente.

---

## FASE 2 — DADOS `[OBRIGATÓRIO + auth/billing/audit]` ✅

- [ ] 2.1 Prisma schema canônico (`schema.prisma`) com provider PostgreSQL.
- [ ] 2.2 Migration inicial versionada e aplicada.
- [ ] 2.3 Tabelas de domínio: `clubs`, `players`, `competitions`, `rankings`, `matches`, `seasons`.
- [ ] 2.4 Tabelas de auth: `users`, `roles`, `permissions`, `user_roles`, `sessions`.
- [ ] 2.5 Tabelas de billing: `subscriptions`, `plans` (Free/Pro/Elite), `invoices`, `payment_events`.
- [ ] 2.6 Tabelas de auditoria: `audit_logs` (imutável, append-only, com hash de cadeia).
- [ ] 2.7 Tabelas de governança: `data_sources` (procedência), `entity_revisions` (versionamento).
- [ ] 2.8 Senha/token sempre hash com argon2id (custo ≥ 12). Nunca em texto plano.
- [ ] 2.9 Soft delete em entidades críticas (`deleted_at` em `clubs`, `players`, `users`).
- [ ] 2.10 Criptografia a nível de coluna para email e telefone (envelope encryption com chave mestra do deploy).
- [ ] 2.11 Seed de admin inicial com senha forte e obrigatoriedade de troca no primeiro login.
- [ ] 2.12 Índices em todas as chaves estrangeiras + colunas de busca frequente.
- [ ] 2.13 Restrições de unicidade documentadas (`@@unique([name, country])`, etc.).

**Verificação:**
- `prisma migrate dev --schema=prisma/schema.prisma --name init` roda limpo em PostgreSQL.
- `prisma studio` mostra todas as tabelas esperadas.
- Tentar criar user com senha em texto plano deve falhar na validação de service.

---

## FASE 3 — AUTH `[OBRIGATÓRIO, 2FA TOTP opcional]`

- [ ] 3.0 Preflight Auth (deps + env.ts com Zod + .env.example)
- [ ] 3.1 Setup JWT + Cookie + tipos Fastify
- [ ] 3.2 Rotas Register / Login / Logout
- [ ] 3.3 Refresh token flow (incluído em 3.2)
- [ ] 3.4 Middleware de Autenticação (`authenticate` preHandler)
- [ ] 3.5 Middleware RBAC (`requirePermission`, `requireRole`)
- [ ] 3.6 Reset de senha (token único, expira 15min, enviado por email mock)
- [ ] 3.7 Audit logging para auth (parcialmente em auth.service)
- [ ] 3.8 Rate limiting específico para /auth/*
- [ ] 3.9 Testes de integração (BLOQUEADO até Operador aplicar migration PostgreSQL)
- [ ] 3.10 Documentação API Auth (`docs/api/auth.md`)

**Verificação:**
- curl `POST /api/v1/auth/login` com credenciais válidas → 200 + cookie de sessão.
- curl `POST /api/v1/auth/login` com 5 credenciais inválidas seguidas → 429 com mensagem de lockout.
- curl `GET /api/v1/me` sem cookie → 401.
- `audit_logs` mostra todas as 6 tentativas de login.

---

## FASE 4 — APIs/CRUDs `[OBRIGATÓRIO + billing]`

REST versionado `/api/v1`. Cada módulo em `apps/api/src/modules/<nome>/` com `routes/service/repository`.

- [ ] 4.1 CRUD `clubs` (já parcial no MVP — re-verificar).
- [ ] 4.2 CRUD `players` (jogadores).
- [ ] 4.3 CRUD `competitions` (competições).
- [ ] 4.4 CRUD `rankings` (rankings históricos — versionados, imutáveis após publicação).
- [ ] 4.5 CRUD `matches` (partidas) + `seasons` (temporadas).
- [ ] 4.6 Módulo `billing`:
- [ ] 4.6.1 Modelos Free/Pro/Elite definidos em `plans`.
- [ ] 4.6.2 Integração com provedor de pagamento (avaliar Stripe vs Pix direto vs PagSeguro — decisão em `DECISOES.md`).
- [ ] 4.6.3 Webhook de pagamento assinado (HMAC) e idempotente.
- [ ] 4.6.4 Upgrade/downgrade de plano com prorratação.
- [ ] 4.7 Módulo `admin` (RBAC admin apenas): CRUD de usuários, atribuição de papéis, moderação.
- [ ] 4.8 Busca textual: índice PostgreSQL `tsvector` ou `pg_trgm` (decidir em `DECISOES.md`).
- [ ] 4.9 Paginação cursor-based em endpoints de lista (mais estável que offset em alta escala).
- [ ] 4.10 Query builder sempre parametrizada (Prisma já garante — nunca concatenar SQL).
- [ ] 4.11 Documentação OpenAPI 3.1 gerada automaticamente (`@fastify/swagger`).
- [ ] 4.12 Idempotência em endpoints de escrita via header `Idempotency-Key`.

**Verificação:**
- `pnpm test` cobre cada endpoint com casos happy path + erro + autorização.
- OpenAPI renderizada em `/api/v1/docs` com todos os schemas.
- Webhook de pagamento rejeita payload sem assinatura válida.

---

## FASE 5 — FRONTEND `[OBRIGATÓRIO]`

Stack: Next.js 16 + TypeScript + Tailwind + shadcn/ui (todos open-source e gratuitos).

- [ ] 5.1 Inicializar `apps/web` no monorepo (Next.js App Router).
- [ ] 5.2 Cliente HTTP com interceptor: anexa cookie de sessão, trata 401 (redirect para login), refresh transparente.
- [ ] 5.3 Proteção CSRF: cookie SameSite + header `X-CSRF-Token` sincronizado.
- [ ] 5.4 Páginas públicas: home, login, registro, reset de senha, planos, página de clube/jogador/competição.
- [ ] 5.5 Páginas privadas: área do usuário, assinatura, histórico, favoritos.
- [ ] 5.6 `ProtectedRoute` que valida sessão + permissão no servidor (SSR) e no cliente.
- [ ] 5.7 CSP restritiva via `next.config.js` + headers HTTP.
- [ ] 5.8 DOMPurify em qualquer HTML dinâmico renderizado (descrições de clube, biografias).
- [ ] 5.9 Sem token em localStorage. Sessão exclusivamente via cookie httpOnly.
- [ ] 5.10 Acessibilidade WCAG 2.1 AA (labels, ARIA, contraste, navegação por teclado).
- [ ] 5.11 Responsivo mobile-first. Lighthouse > 90 em performance/acessibilidade/SEO.
- [ ] 5.12 PWA opcional (offline-first para páginas já visitadas).

**Verificação:**
- Lighthouse CI rodando no pipeline, quebra se score < 90.
- Testes E2E (Playwright) cobrem fluxo de login → pesquisar clube → ver detalhes.

---

## FASE 6 — AVANÇADO `[upload/fila/cache/IA-RAG OBRIGATÓRIOS]`

- [ ] 6.1 **Upload seguro** `[OBRIGATÓRIO]`:
- [ ] 6.1.1 Validação de tipo MIME real (magic bytes, não só extensão).
- [ ] 6.1.2 Tamanho máximo configurável por tipo de upload.
- [ ] 6.1.3 Antivírus: ClamAV rodando em container separado (gratuito).
- [ ] 6.1.4 Armazenamento em S3-compatível (MinIO local em dev, Cloudflare R2 em prod — gratuito até 10GB).
- [ ] 6.1.5 Nomes de arquivo aleatórios (UUID) — nunca nome do usuário.
- [ ] 6.2 **Fila assíncrona** `[OBRIGATÓRIO]`: BullMQ + Redis para ETL, envio de emails, processamento de imagem, reprocessamento de rankings.
- [ ] 6.3 **Cache Redis** `[OBRIGATÓRIO]`: read-through em consultas frequentes (lista de clubes, top rankings). Invalidação por evento (write-through em updates).
- [ ] 6.4 **Pipeline ETL** `[OBRIGATÓRIO]`:
- [ ] 6.4.1 Conectores para fontes públicas (RSSSF, FBref, Wikipedia via API).
- [ ] 6.4.2 Job agendado (cron) para atualização periódica.
- [ ] 6.4.3 Rastreabilidade: cada atualização registra fonte + timestamp em `data_sources`.
- [ ] 6.5 **IA / RAG** `[OBRIGATÓRIO]`:
- [ ] 6.5.1 Embeddings de entidades (clubs, players, competições) armazenados em pgvector (extensão PostgreSQL gratuita).
- [ ] 6.5.2 Pipeline RAG: pergunta → busca vetorial → contexto → LLM → resposta + citações.
- [ ] 6.5.3 LLM: modelo open-source via Ollama local ou provedor gratuito (decidir em `DECISOES.md`).
- [ ] 6.5.4 Cada resposta registra fontes citadas para auditoria.
- [ ] 6.6 **Knowledge Graph** `[OBRIGATÓRIO]`: relações entre entidades (jogador→clube→competição→título). Materializado em tabelas + exposto em endpoint `/api/v1/graph`.
- [ ] 6.7 **Feature flags** `[OBRIGATÓRIO]`: sistema simples em tabela `feature_flags` (Redis-backed).
- [ ] 6.8 **Exportação de dados**: com verificação de autorização e limite de volume (rate limit + paginação).
- [ ] 6.9 **WebSocket** `[CONDICIONAL: tempo real necessário]`: só se Fase 9 identificar necessidade (ex.: placar ao vivo). Por ora, adiar.

**Verificação:**
- Job ETL roda em dev via `pnpm job:etl:run` e popula/atualiza dados com sucesso.
- Endpoint `/api/v1/ai/ask` responde "Quem ganhou a Copa do Brasil de 2009?" com citações verificáveis.
- Cache hit ratio > 70% em endpoint `/api/v1/clubs` após aquecimento.

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

- [ ] 8.1 Testes unitários (Vitest) para services com mocks. Cobertura ≥ 80% em `apps/api/src/modules/**`.
- [ ] 8.2 Testes de integração (Supertest/Fastify inject) para endpoints com auth.
- [ ] 8.3 Testes E2E (Playwright) para fluxos críticos: login, busca, IA, assinatura.
- [ ] 8.4 SAST: CodeQL no GitHub Actions (gratuito para repositórios públicos).
- [ ] 8.5 `npm audit` + `pnpm audit` no CI. Quebra build se high/critical.
- [ ] 8.6 DAST: scan periódico com OWASP ZAP em staging. Cron semanal.
- [ ] 8.7 Testes de carga (k6 — gratuito) simulando 1.000 usuários concorrentes.
- [ ] 8.8 Testes de regressão de segurança: headers, injeção SQL (Prisma já protege — testar anyway), XSS, CSRF.
- [ ] 8.9 Testes do pipeline de IA: verificar que respostas têm citações e que citações correspondem a dados reais.

**Verificação:**
- `pnpm test:ci` falha se cobertura < 80%.
- Relatório ZAP sem alertas high/critical no staging.
- k6 reporta p95 < 500ms com 1.000 usuários.

---

## FASE 9 — CI/CD E DEPLOY `[OBRIGATÓRIO]`

- [ ] 9.1 Pipeline GitHub Actions:
- [ ] 9.1.1 Lint + typecheck em todo PR.
- [ ] 9.1.2 Testes unitários + integração.
- [ ] 9.1.3 SAST (CodeQL) + dependency scan.
- [ ] 9.1.4 Build Docker multi-stage com `prune` de dev deps.
- [ ] 9.1.5 Scan de imagem com Trivy (gratuito).
- [ ] 9.1.6 Deploy automático em staging após merge em `main`.
- [ ] 9.2 Secrets no CI: variáveis protegidas do GitHub (never in code).
- [ ] 9.3 Deploy em produção: blue-green ou rolling update (zero downtime).
- [ ] 9.4 Plataforma de deploy: Fly.io ou Railway (free tier compatível com PostgreSQL + Redis). Decisão em `DECISOES.md`.
- [ ] 9.5 Observabilidade:
- [ ] 9.5.1 Logs centralizados: Loki (gratuito) ou logs nativos do Fly.io.
- [ ] 9.5.2 Métricas: Prometheus + Grafana (gratuito) ou Better Stack free tier.
- [ ] 9.5.3 Alertas: erros 5xx > 1% em 5 min, falhas de auth > 50 em 1 min.
- [ ] 9.5.4 Uptime check externo (UptimeRobot free).
- [ ] 9.6 Healthcheck HTTP no deploy (`/api/v1/health`).
- [ ] 9.7 Backup automático do PostgreSQL (diário, retenção 30 dias).
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
| **Beta Fechada** (100 usuários) | Pesquisa de clubes/jogadores funcionando + login + área do usuário | Fases 0–5 (parcial), 6.1–6.3 |
| **Open Beta** (1.000 usuários) | + rankings + linha do tempo + billing Free/Pro/Elite + observabilidade | Fases 0–8 (parcial), 9.1–9.6 |
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