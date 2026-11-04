# Rodada 5 — status: bootstrap de migrations + enforcement RLS (2026-11-04)

> Regra permanente: **execução live desligada/fail-closed**; nada aqui liga ordem
> real. Esta rodada é de banco/infra: histórico de migrations e enforcement de RLS.

## 1. O que foi entregue

| Entrega | Arquivo | Evidência |
|---|---|---|
| Bootstrap idempotente do histórico Prisma em banco que já tem schema (resolve `P3005` sem `db push`) | `scripts/bootstrap-prod-migrations.mjs` (novo) | dry-run executado no Postgres de dev (**não escreve**): tabela `_prisma_migrations` AUSENTE → plano `create` para `baseline` (111 statements) + `rls_policies` (16 statements), gate de drift **OK**, exit 0 |
| Verificador de enforcement RLS (role + policies + FORCE + contagens por contexto) | `scripts/verify-rls-enforcement.mjs` (novo) | execução em dev: role `autotrader` com `rolsuper=true`/`rolbypassrls=true` → **INERTE** (exit 1 com `--expect-enforced`, exit 0 informativo) |
| Runbook de migrations de produção | `docs/06-devops-deployment/DB_MIGRATIONS_RUNBOOK.md` (novo, 118 linhas) | passos dry-run → `--yes` → `migrate status` → verificação + rollback + erros P3005/P3009/P3018/checksum |
| Rollout do enforcement (role de app) | `docs/05-security-compliance/RLS.md` §9 (novo) | SQL do role `app_rls` (NOSUPERUSER NOBYPASSRLS), grants, troca de DATABASE_URL, validação, rollback, caveat Neon owner |
| Testes dos helpers puros | `tests/bootstrap-migrations.test.ts` (novo) | **12 testes passando**: checksum sha256 das migrations reais, contagem de statements (comentários/$$/aspas), plano create/insert/noop/conflict, DDL da tabela |

## 2. Estado de produção (o que já foi feito x o que depende do operador)

- Rodada 4 criou as **policies** (`20260102000000_rls_policies`) e o production DB
  recebeu o schema; porém o role `neondb_owner` tem `BYPASSRLS=true` → policies
  **inertes** (comprovado pelo verificador no dev, que reproduz o mesmo cenário:
  superuser+bypass ⇒ INERTE).
- **Bootstrap do histórico em produção NÃO foi executado por mim** (proibido: não
  rodo `migrate deploy`/escritas em prod). Caminho: runbook §2 (dry-run) → §3
  (`--yes`) → §4 (`prisma migrate status` deve dizer "up to date").
- **Troca do role do app** (criar `app_rls`, apontar `DATABASE_URL`) é do Lead/operador
  nesta rodada — não criei role nem alterei DATABASE_URL.

## 3. Como validar depois do rollout

```bash
# 1. histórico: 2 migrations aplicadas, nenhuma pendente
npx prisma migrate status
# 2. drift: exit 0
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
# 3. enforcement: precisa sair ENFORCED e exit 0
node scripts/verify-rls-enforcement.mjs --expect-enforced
```

## 4. Limitações / pendências

1. O verificador só é conclusivo com **linhas de outros usuários** nas tabelas; em banco
   vazio ele avisa que o isolamento não é distinguível por contagem.
2. O modo **sem contexto é permissivo** por design (rollout sem downtime). Enforcement
   total exige migrar os call sites para `withUserRls`/`withSystemRls` e depois
   endurecer a policy (negar sem `app.user_id`).
3. `FORCE RLS` não protege contra BYPASSRLS do owner do Neon — só a troca de role resolve.
4. Migrations aplicadas **não podem ser editadas** (checksum): mudanças vão em migration nova.
5. Baseline/RLS foram registrados via bootstrap (sem executar SQL). Se um dia o schema de
   produção divergir, o gate de drift do bootstrap aborta — não registrar por cima.
