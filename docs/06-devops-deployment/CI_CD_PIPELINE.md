# Pipeline de CI/CD (GitHub Actions) — canônico Railway

> Atualizado em **2026-11-04** (rodada 4). Antes era um esqueleto (F16/T088).
> Host canônico de produção: **Railway**. Fly.io está **histórico** (ver
> `PRODUCTION_DEPLOY.md`, topo).

## 1. Visão geral

```
push/PR → ci.yml (ci + codeql + e2e*)  ─┐
                                       ├─ gates obrigatórios para merge (ver §5)
push main ─→ deploy-railway.yml ───────┘  (DESLIGADO: gate por variable)
```

* e2e roda em push para `main` ou em PR com label `e2e`.

## 2. `ci.yml` — jobs, ordem e o que cada gate prova

| # | Job | Steps (ordem) | Prova |
|---|---|---|---|
| 1 | **ci** (`ubuntu-24.04`, timeout 20min) | `npm ci` → `prisma generate` → lint → `tsc --noEmit` → Gitleaks → `prisma migrate deploy` (Postgres de service) → **gate de drift** (`migrate diff --from-config-datasource --to-schema --exit-code`) → `npm audit --audit-level=high` → `npm run test:ci` (22 scripts) → `vitest run --coverage` → Codecov → `npm run build` → verificação do standalone (`.next/standalone/{server.js,.next/static,public}`) → dependency-cruiser → knip → `docker build` → Trivy | Repo compila, tipos batem, schema bate com migrations, testes unitários + gate legado verdes, artefato standalone completo |
| 2 | **codeql** (timeout 15min) | CodeQL init/autobuild/analyze + gate delta | Finding novo em arquivo da PR falha o job |
| 3 | **e2e** (condicional) | `migrate deploy` → seed → Playwright | Fluxos de UI reais contra Postgres efêmero |
| 4 | **deploy-staging** (skipped) | stub `echo` | Nada — staging não existe (Fly.io obsoleto) |

Gates **não** bloqueantes (por design, ver `docs/LINT.md`): dependency-cruiser
(`|| echo warning`), knip (`--no-exit-code`), Trivy (`continue-on-error: true`).
Eles informam; não impedem merge.

## 3. CD — `deploy-railway.yml`

**Estado: PRONTO porém DESLIGADO.** O job só roda quando `vars.RAILWAY_DEPLOY_ENABLED == 'true'`;
hoje essa variable não existe → todo push em `main` faz o workflow aparecer como
`skipped` (7s). Nenhum deploy automático acontece.

Estrutura do workflow:

1. gate `if: vars.RAILWAY_DEPLOY_ENABLED == 'true'`;
2. `concurrency: { group: deploy-railway, cancel-in-progress: false }` — um deploy por
   vez, nunca cancela um deploy em andamento;
3. `timeout-minutes: 25` + `environment: production` (trilha de auditoria);
4. **sanity gate** `node scripts/verify-cd-config.mjs` (falha antes de tocar no Railway
   se a variable estiver ligada mas o secret faltar; nunca imprime valor);
5. instala `@railway/cli`;
6. `railway link --project $RAILWAY_PROJECT_ID` (opcional, `if: vars.RAILWAY_PROJECT_ID != ''`);
7. `railway up --service auto-trader --environment production --ci`;
8. **smoke** `curl /api/health/ready` (opcional, `if: vars.RAILWAY_PUBLIC_URL != ''`),
   10 tentativas × 6s.

### Habilitar (operador — 3 passos)

```bash
# 1. Railway -> Project auto-trader -> Settings -> Tokens -> Create Project Token
#    (escopo do projeto; copie o token na hora da criação)
# 2. no GitHub (uma das opções):
gh secret set RAILWAY_TOKEN          # cola o token quando pedir
# 3. ligar o gatilho:
gh variable set RAILWAY_DEPLOY_ENABLED --body true
```

Antes de habilitar, valide localmente: `node scripts/verify-cd-config.mjs`
(exit 0 = **READY**, exit 1 = **BLOQUEADO** com a lista do que falta).

> **Por que não foi criado por automação (rodada 4):** `mutation projectTokenCreate`
> da API do Railway retornou **`Not Authorized`** com o token OAuth do CLI —
> esse token não tem permissão de mintar project token. Não é bug do workflow;
> é escopo do token.
>
> **Alternativa sem token:** conectar o serviço ao repositório no dashboard do
> Railway (deploy no push acontece fora do GitHub Actions, sem status check).

### Rollback

| Cenário | Ação |
|---|---|
| Deploy ruim (mais rápido) | Railway → Deployments → deploy anterior → **Redeploy** |
| Reverter código | `git revert <commit> && git push origin main` (CD roda de novo) |
| Parar todo o CD | `gh variable set RAILWAY_DEPLOY_ENABLED --body false` |
| Regressão de DB | `scripts/restore-full.mjs` (ver `BACKUP_DR.md`) |

## 4. Deploy manual (estado atual)

Enquanto o CD estiver bloqueado, o caminho canônico é o operador rodar:

```bash
railway up --service auto-trader --environment production
curl -fsS https://<host-publico>/api/health/ready   # 200 = pronto
```

## 5. Gates que impedem merge (recomendado)

Hoje `main` **não tem branch protection** (ver `docs/branch-protection-policy.md`);
o CI é verde mas não é obrigatório. Recomendado habilitar PR obrigatório com
`ci`/`codeql` verdes + Gitleaks antes de qualquer fluxo com mais de um operador.

## Referências

- `.github/workflows/ci.yml`, `.github/workflows/deploy-railway.yml`
- `scripts/verify-cd-config.mjs` — readiness do CD (READY/BLOQUEADO)
- [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md) — deploy canônico + histórico Fly.io
- [BACKUP_DR.md](./BACKUP_DR.md) · [signer-runtime.md](./signer-runtime.md)
