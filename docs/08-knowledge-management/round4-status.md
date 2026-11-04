# Rodada 4 — status (2026-11-04)

> Escopo desta nota: estado real ao fim da rodada 4. Regra permanente: **execução
> live continua DESLIGADA/fail-closed**; nada aqui habilita ordem real.

## 1. CI/CD

| Item | Estado |
|---|---|
| CI (`.github/workflows/ci.yml`) | Verde. Jobs: ci (lint, tsc, Gitleaks, migrations + drift gate, audit, test:ci, vitest+coverage, build, standalone check, dep-cruiser, knip, docker+Trivy), codeql, e2e condicional |
| CD (`.github/workflows/deploy-railway.yml`) | **Pronto e DESLIGADO**. Gate `vars.RAILWAY_DEPLOY_ENABLED == 'true'`; hoje a variable não existe → job `skipped` |
| Prontidão verificável | `node scripts/verify-cd-config.mjs` → **BLOQUEADO (exit 1)**: `RAILWAY_TOKEN` ausente e `RAILWAY_DEPLOY_ENABLED` ausente (`gh secret list`/`gh variable list` retornam `[]`) |
| Deploy canônico hoje | **Manual**: operador roda `railway up --service auto-trader --environment production` e valida `/api/health/ready` |
| Rollback | Railway → Deployments → anterior → Redeploy; ou `git revert` + push; ou desligar via `gh variable set RAILWAY_DEPLOY_ENABLED --body false` |

**Bloqueio conhecido:** a API do Railway respondeu `Not Authorized` em
`projectTokenCreate` (token OAuth do CLI não pode mintar project token). Portanto a
criação do token é **humana** — 3 passos documentados em
`docs/06-devops-deployment/CI_CD_PIPELINE.md`, no topo de
`docs/06-devops-deployment/PRODUCTION_DEPLOY.md` e na seção *Deploy (Railway)* do README.
**Nada foi habilitado nesta rodada** (nenhum secret/variable criado).

## 2. Docs de deploy

- `PRODUCTION_DEPLOY.md`: banner canônico Railway no topo; seções Fly.io marcadas
  como **HISTÓRICO** (arquitetura, secrets, setup, custos, rollback por releases).
- `CI_CD_PIPELINE.md`: deixou de ser esqueleto — jobs/gates do `ci.yml`,
  gates não-bloqueantes (dep-cruiser/knip/Trivy), estrutura do CD, 3 passos do
  operador, rollback.
- `README.md`: seção **Deploy (Railway)** + tabela de status e roadmap.
- `current-state-audit.md`: §E (2026-11-04) com o que mudou e o que permanece.

## 3. RLS nativo (rollout)

- Migration nova `prisma/migrations/20260102000000_rls_policies` (ENABLE/FORCE ROW LEVEL
  SECURITY em `Position`, `WalletConnection`, `ExchangeConnection`,
  `NotificationChannel` + policies) e `scripts/apply-rls-dev.mjs` para aplicar/atualizar
  em dev (DDL idempotente).
- Estado: **em rollout em dev**; aplicação em produção **não verificada** nesta rodada
  (depende de `prisma migrate deploy` no deploy). Enquanto produção não tiver a migration,
  o guard de aplicação (`withRLS`) continua sendo a proteção efetiva.

## 4. Qualidade / cobertura

- Baseline da rodada: `npx tsc --noEmit` 0, `npx eslint .` 0, `npx vitest run`
  **66 arquivos / 864 testes pass**, `npm run build` OK.
- Thresholds do Vitest seguem em **30% lines / 39% funcs / 27% branches** (ratchet
  histórico; o claim de "cobertura 80%" era aspiracional — ver
  `current-state-audit.md` §D.2).
- `test:ci` legado (22 scripts) agora tem caminho seguro para dev:
  `npm run test:ci:local` (banco descartável, dropado no fim).

## 5. Signer / live

- Signer empacotado (`.next/standalone/signer.js`) e **rodando em produção** conforme
  operação atual; no código só sobe com `SIGNER_SPAWN=1` (default desligado).
- Execução live segue **desligada** e fail-closed (live-gating exige 6 condições;
  `LIVE_TRADING_ENABLED`/`S14_APPROVED` ausentes no ambiente de produção).

## 6. Pendências

1. **Token do Railway** (operador) para ligar o CD — único bloqueio do deploy automático.
2. **Branch protection em `main`** (hoje HTTP 404) — CI verde não é obrigatório.
3. Aplicar a migration de RLS em produção + validar policies com um usuário não-superuser.
4. Rastrear a divergência entre "637/716 checks" (docs antigos) e o gate real — histórico
   já marcado em `HARDENING-ROADMAP.md`; falta limpar menções residuais.
