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
npm run build && npm start    # produção: next standalone (sem bun/tee)
```

## Testes e verificação

```bash
npx tsc --noEmit              # tipos
npx eslint .                  # lint
npx vitest run                # unitários (52 arquivos na última rodada)
npx vitest run tests/health-endpoints.test.ts   # arquivo específico
npx playwright test           # e2e (sobe o app sozinho)
```

## Status real

| Área | Estado |
|---|---|
| Trading paper (engine, sizing, risco, exit) | Funcional; engine parado por padrão |
| Execução live | **Implementada e desligada**. Gate: `mode=live` + `graduatedToLive` + kill switch off + `LIVE_TRADING_ENABLED=true` + `S14_APPROVED=true` + feature flag `enable_live_trading`. Credenciais hoje retornam `LIVE_CREDS_NOT_CONFIGURED` |
| Auth | Sessão assinada (HMAC) + CSRF + RBAC + RLS; cookie forjado → 401; sem `SESSION_SECRET` é fail-closed |
| Observabilidade | Sentry por envelope HTTP (sem SDK) se `SENTRY_DSN`; rate limit por processo ou distribuído com `REDIS_URL` |
| Backup | `scripts/backup-full.mjs` (pg_dump custom) + `scripts/restore-full.mjs` (ver docs/BACKUP_DR) |
| Deploy | Manual. Não há deploy automático de produção (workflow desligado) |

## Segurança (resumo)

- Segredos só em env/vault; `.env` fora do git. Nunca logamos chaves (scrubbing no Sentry).
- Rotas autenticadas: `requireSession` (sessão assinada) + `requirePermission` (RBAC) + rate limit por usuário.
- CSP/HSTS/headers de segurança no `next.config.ts`; uploads e webhooks validados.

## Limitações conhecidas

- Cobertura de testes parcial; alguns módulos críticos (engine, carteira) sem teste unitário.
- Documentação legada menciona Fly.io/Vercel e métricas antigas — `docs/06-devops-deployment/PRODUCTION_DEPLOY.md` é a referência atual de deploy manual.
- Sem `@sentry/nextjs`/`bullmq`: tracing avançado e fila durável não fazem parte desta árvore.
- Histórico do repositório já conteve `.env`; rotação de chaves é obrigatória para produção.

## Roadmap curto

1. Cobertura nos módulos críticos + ratchet de thresholds.
2. Deploy automatizado com smoke test (`/api/health/ready`).
3. Sessão/auditoria de drift de schema no CI (já existe gate de drift).
4. Live somente após envelope humano (S14) e chaves de testnet validadas.

## Documentação

`docs/` (onboarding, arquitetura, devops, segurança) — comece por
[docs/README.md](docs/README.md), [AGENT_GUIDE.md](AGENT_GUIDE.md) e
[docs/08-knowledge-management/round2-status.md](docs/08-knowledge-management/round2-status.md).
