# Auto Trader

Aplicação web de trading (paper-first) com engine de ciclos, backtest, análise por IA,
dashboard em tempo real e billing. **Execução LIVE existe no código, mas está
DESLIGADA e é fail-closed**: exige seis condições explícitas (abaixo) e não há
chaves no repositório.

## Arquitetura (5 linhas)

1. **Next.js 16 (App Router) + React 19** — UI/dashboard e ~80 rotas `/api`.
2. **Engine em ciclos** (`src/lib/trading`) — coleta → análise/IA → sizing → execução → registro; paper por padrão.
3. **Prisma 7 + PostgreSQL** — 34 modelos; schema versionado em `prisma/migrations`.
4. **Cadeia/execução** (`src/lib/chain`) atrás de `live-gating.ts`; signer local via Unix socket (Linux).
5. **Observabilidade** — logs em DB/arquivo, métricas, Sentry por envelope HTTP e rate limit em memória ou Redis.

## Stack

- TypeScript 5.9, Next 16, React 19, Tailwind/shadcn, TanStack Query
- Prisma 7 (`@prisma/adapter-pg`), PostgreSQL 16 (pgvector no compose)
- Vitest (unit), Playwright (e2e), ESLint 9
- Stripe (billing), CCXT + ethers (só atrás do gate de live)

## Como rodar

```bash
npm ci
cp .env.example .env          # preencha DATABASE_URL e SESSION_SECRET/ENCRYPTION_KEY

# banco novo (aplica as migrations versionadas)
npx prisma migrate deploy
# banco que JÁ tem tabelas mas nunca teve histórico de migrations
node scripts/db-migrate-safe.mjs --dry-run   # vê o plano, não escreve
node scripts/db-migrate-safe.mjs             # aplica com segurança

npm run dev                   # http://localhost:3000
npm run build                 # next build + bundle do signer + assets do standalone
npm start                     # produção: node .next/standalone/server.js (sem bun/tee)
npm run build:signer          # só reempacota .next/standalone/signer.js (esbuild)

# dados de demonstração (dashboard populado) — dry-run por padrão p/ limpar
npx tsx scripts/seed-demo.ts          # cria/atualiza
npm run db:demo:clear                 # mostra o que seria apagado (dry-run)
npm run db:demo:clear -- --yes        # apaga de verdade
```

## DB / Migrações

- Schema **versionado** em `prisma/migrations` (baseline + RLS). Em banco novo:
  `npx prisma migrate deploy`.
- Banco que **já tem tabelas** mas nunca teve histórico (caso da produção): use
  `node scripts/bootstrap-prod-migrations.mjs` — **dry-run por padrão**, só grava com
  `--yes`, valida drift antes, e nunca aplica o SQL das migrations. Runbook:
  [docs/06-devops-deployment/DB_MIGRATIONS_RUNBOOK.md](docs/06-devops-deployment/DB_MIGRATIONS_RUNBOOK.md).
- Banco populado sem drift e sem histórico (bootstrap assistido):
  `node scripts/db-migrate-safe.mjs --dry-run` → sem flag.
- **RLS**: policies nas tabelas multi-tenant (`Position`, `WalletConnection`,
  `ExchangeConnection`, `NotificationChannel`). Enforcement só vale se o role do app
  NÃO for superuser nem tiver `BYPASSRLS` — verifique com
  `node scripts/verify-rls-enforcement.mjs --expect-enforced` (exit 1 = inerte).
  Rollout/rollback do role em [docs/05-security-compliance/RLS.md](docs/05-security-compliance/RLS.md) §9.
- **Scripts de manutenção** (seed, limpeza, backfill, reset) chamam
  `scripts/lib/require-bypass-rls.mjs` e **abortam** se o `DATABASE_URL` for do app role
  (`NOBYPASSRLS`) — com RLS strict eles veriam 0 linhas e falhariam em silêncio. Use a
  connection string do **owner** para manutenção; no runtime use `withSystemRls`.
  Detalhes: [runbook §8](docs/06-devops-deployment/DB_MIGRATIONS_RUNBOOK.md).

## Testes e verificação

```bash
npx tsc --noEmit              # tipos
npx eslint .                  # lint
npx vitest run                # unitários (60 arquivos / 766 testes na última rodada)
npx vitest run tests/demo-cleanup.test.ts       # arquivo específico
npx playwright test           # e2e (sobe o app sozinho)

# gate legado de 22 scripts (vault/signer/H0-H2/M3) SEM tocar no banco de dev:
npm run test:ci:local                          # cria autotrader_test_<pid>, aplica migrations,
                                               # roda os 22 scripts nesse banco e dropa no fim
npm run test:ci:local -- --only test-vault     # subconjunto (substring do nome do arquivo)
npm run test:ci:local -- --keep                # mantém o banco para inspeção
```

> `npm run test:ci` (o do CI) roda contra o `DATABASE_URL` atual e é destrutivo — use-o
> só contra um banco descartável. Para a máquina de dev, use `test:ci:local`.

## Status real

| Área | Estado |
|---|---|
| Trading paper (engine, sizing, risco, exit) | Funcional; engine parado por padrão |
| Execução live | **Implementada e desligada**. Gate: `mode=live` + `graduatedToLive` + kill switch off + `LIVE_TRADING_ENABLED=true` + `S14_APPROVED=true` + feature flag `enable_live_trading`. Credenciais hoje retornam `LIVE_CREDS_NOT_CONFIGURED` |
| Auth | Sessão assinada (HMAC) + CSRF + RBAC + RLS; cookie forjado → 401; sem `SESSION_SECRET` é fail-closed |
| Observabilidade | Sentry por envelope HTTP (sem SDK) se `SENTRY_DSN`; rate limit por processo ou distribuído com `REDIS_URL` |
| Backup | `scripts/backup-full.mjs` (pg_dump custom) + `scripts/restore-full.mjs` (ver docs/BACKUP_DR) |
| Deploy | **Railway** é o host canônico; deploy **manual** (`railway up`). CD automático existe (`deploy-railway.yml`) mas está **desligado** até o operador criar `RAILWAY_TOKEN` + `RAILWAY_DEPLOY_ENABLED=true` — cheque com `node scripts/verify-cd-config.mjs` |
| Signer (processo separado) | Empacotado por `scripts/build-signer.mjs` em `.next/standalone/signer.js`. **Default desligado**: só sobe com `SIGNER_SPAWN=1`; status em produção hoje é `configured=false` |
| Demo data | `scripts/seed-demo.ts` (ids fixos) + `npm run db:demo:clear` (dry-run por padrão, `--yes` para apagar) |

## Deploy (Railway)

Fly.io é **histórico**; o host canônico é o Railway (app + engine + Postgres).

- **Hoje (manual):** `railway up --service auto-trader --environment production` e valide
  `curl -fsS https://<host>/api/health/ready` (200).
- **CD automático:** pronto e **desligado**. `.github/workflows/deploy-railway.yml` tem gate
  `if: vars.RAILWAY_DEPLOY_ENABLED == 'true'`, `concurrency` (nunca cancela deploy em
  andamento), sanity `node scripts/verify-cd-config.mjs` antes de tocar no Railway e
  smoke de `/api/health/ready` após subir.
- **Habilitar (operador, 3 passos):** 1) Railway → Project auto-trader → Settings → Tokens →
  *Create Project Token*; 2) `gh secret set RAILWAY_TOKEN`; 3)
  `gh variable set RAILWAY_DEPLOY_ENABLED --body true`. Antes: `node scripts/verify-cd-config.mjs`
  (exit 0 = READY; exit 1 = BLOQUEADO com o que falta).
- **Por que não foi automatizado até aqui:** a API do Railway respondeu `Not Authorized` ao
  tentar criar project token com o token OAuth do CLI — criação de token é ação humana.
- **Rollback:** Railway → Deployments → deploy anterior → *Redeploy*; ou
  `git revert <commit> && git push origin main`; parar o CD:
  `gh variable set RAILWAY_DEPLOY_ENABLED --body false`.

Detalhes: [docs/06-devops-deployment/CI_CD_PIPELINE.md](docs/06-devops-deployment/CI_CD_PIPELINE.md) e
[docs/06-devops-deployment/PRODUCTION_DEPLOY.md](docs/06-devops-deployment/PRODUCTION_DEPLOY.md).

## Segurança (resumo)

- Segredos só em env/vault; `.env` fora do git. Nunca logamos chaves (scrubbing no Sentry).
- Rotas autenticadas: `requireSession` (sessão assinada) + `requirePermission` (RBAC) + rate limit por usuário.
- CSP/HSTS/headers de segurança no `next.config.ts`; uploads e webhooks validados.

## Limitações conhecidas

- Cobertura de testes parcial; alguns módulos críticos (engine, carteira) sem teste unitário.
- Documentação legada de Fly.io está **marcada como HISTÓRICO** em `docs/06-devops-deployment/PRODUCTION_DEPLOY.md` (banner no topo); a referência atual é Railway + `CI_CD_PIPELINE.md`.
- Sem `@sentry/nextjs`/`bullmq`: tracing avançado e fila durável não fazem parte desta árvore.
- Histórico do repositório já conteve `.env`; rotação de chaves é obrigatória para produção.
- Signer NÃO roda em produção (sem `SIGNER_SPAWN=1`); `configured/reachable` ficam falsos por design até o deploy com a flag.
- `test:ci` (o script do CI) exige banco descartável; `test:ci:local` é o caminho seguro na dev.

## Roadmap curto

1. Cobertura nos módulos críticos + ratchet de thresholds.
2. Habilitar o CD do Railway (depende do project token do operador) — workflow e smoke de `/api/health/ready` já prontos.
3. Sessão/auditoria de drift de schema no CI (já existe gate de drift).
4. Live somente após envelope humano (S14) e chaves de testnet validadas.

## Documentação

`docs/` (onboarding, arquitetura, devops, segurança) — comece por
[docs/README.md](docs/README.md), [AGENT_GUIDE.md](AGENT_GUIDE.md) e
[docs/08-knowledge-management/round3-status.md](docs/08-knowledge-management/round3-status.md).
