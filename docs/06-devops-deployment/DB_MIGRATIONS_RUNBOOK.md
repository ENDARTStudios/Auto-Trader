# Runbook — histórico de migrations em produção (Prisma Migrate)

> Atualizado em **2026-11-04** (rodada 5). Vale para o Postgres de produção
> (Neon) e para qualquer banco que tenha nascido com `prisma db push`.
> **Nunca** rode `prisma db push` em banco com dados.

## 0. O problema (P3005)

O schema de produção foi criado ao longo do tempo com `prisma db push`, então o
banco **não tem** a tabela `_prisma_migrations`. Resultado:

- `prisma migrate status` → erro `P3005` ("The database schema is not empty");
- `prisma migrate deploy` → falha antes de aplicar qualquer coisa;
- o CI usa `migrate deploy` + gate de drift, e produção ficaria fora desse fluxo.

O `scripts/bootstrap-prod-migrations.mjs` resolve **só o histórico**: ele registra
as migrations locais como JÁ APLICADAS (o SQL delas NÃO é executado — o schema já
existe e é validado por um gate de drift).

## 1. Pré-requisitos (obrigatórios, nesta ordem)

1. **Backup atual** do banco (ver `BACKUP_DR.md`):
   `node scripts/backup-full.mjs --check` e depois sem flags.
2. `DATABASE_URL` no ambiente apontando para o banco alvo (nunca cole a URL em log).
3. Repo no commit certo: `prisma/migrations/` deve conter `20260101000000_baseline`
   e `20260102000000_rls_policies` (`node scripts/bootstrap-prod-migrations.mjs --json`
   lista o que encontrou).
4. Janela sem deploy concorrente (o script é transacional, mas evite rodar junto do app subindo).

## 2. Dry-run (sempre primeiro — não escreve nada)

```bash
node scripts/bootstrap-prod-migrations.mjs
```

Saída esperada (banco que nunca teve histórico):

```
[bootstrap-prod-migrations] banco: <host>:<porta>/<db> (credenciais omitidas)
[bootstrap-prod-migrations] migrations locais: 20260101000000_baseline, 20260102000000_rls_policies
[bootstrap-prod-migrations] tabela _prisma_migrations: AUSENTE
[bootstrap-prod-migrations] acao planejada: create
  + registrar: 20260101000000_baseline (111 statements, checksum f1735fa36de6…)
  + registrar: 20260102000000_rls_policies (16 statements, checksum a66042f49eea…)
[bootstrap-prod-migrations] gate de drift: OK (schema bate com prisma/schema.prisma)
[bootstrap-prod-migrations] DRY-RUN: nada foi escrito. Adicione --yes para gravar o historico.
```

Se aparecer **CONFLITO** (mesmo nome, checksum diferente): **pare**. Significa que o
arquivo `migration.sql` foi editado depois de aplicado. Não edite migration já
versionada — crie uma nova. O script aborta sem alterar nada.

Se o **gate de drift** abortar: o schema real diverge de `prisma/schema.prisma`.
Resolva o schema primeiro (migration nova / correção manual); registrar histórico
sobre schema divergente esconderia o problema.

## 3. Aplicar (escreve o histórico)

```bash
node scripts/bootstrap-prod-migrations.mjs --yes
```

Efeitos: cria `_prisma_migrations` (DDL idempotente) e insere uma linha por
migration, com `checksum` = sha256 hex do arquivo e `applied_steps_count` = nº de
statements. Tudo em uma transação.

Reexecutar é seguro: com a tabela já preenchida o script imprime
`idempotente: historico ja registrado, nada a fazer` e sai 0 sem escrever.

## 4. Verificação pós-bootstrap

```bash
# 1. O Prisma agora reconhece o histórico
npx prisma migrate status
#    esperado: "Database schema is up to date!" (ou lista vazia de pendentes)

# 2. Gate de drift (mesmo do CI)
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
#    esperado: exit 0 ("No difference detected")

# 3. Histórico gravado
#    (SQL via psql ou node pg)
SELECT migration_name, checksum, applied_steps_count, finished_at
FROM "_prisma_migrations" ORDER BY migration_name;
```

Esperado no `status`: 2 migrations encontradas, 2 aplicadas, nenhuma pendente.

## 5. Rollback do bootstrap

O bootstrap **não aplica DDL do schema**; portanto reverter é barato e seguro:

| Situação | Ação |
|---|---|
| Registrou a linha errada | `DELETE FROM "_prisma_migrations" WHERE migration_name = '<nome>';` e corrija |
| Precisa zerar o bootstrap | `DROP TABLE "_prisma_migrations";` (schema intacto; o app continua funcionando) |
| Schema foi alterado junto (não deveria) | restore do dump de `scripts/backup-full.mjs` (ver `BACKUP_DR.md`) |
| Migration nova falhou ao aplicar no futuro | `prisma migrate resolve --rolled-back <nome>` e corrija a migration |

Depois de qualquer rollback, rode de novo §2 (dry-run) e §4 (verificação).

## 6. Erros comuns

| Erro | Causa | Correção |
|---|---|---|
| `P3005` | `_prisma_migrations` ausente | este runbook (§2–§3) |
| `P3009` | migration anterior falhou e ficou registrada como pendente | `prisma migrate resolve --rolled-back <nome>` |
| `P3018` | migration aplicada falhou no SQL | corrigir a migration e `resolve --rolled-back` antes de reaplicar |
| CONFLITO de checksum | arquivo de migration editado | restaurar o arquivo original; mudanças vão em migration nova |
| drift ≠ 0 | schema do banco ≠ `schema.prisma` | migration nova para reconciliar (nunca `db push` em prod) |

## 7. Referências

- Scripts: `scripts/bootstrap-prod-migrations.mjs`, `scripts/verify-rls-enforcement.mjs`, `scripts/db-migrate-safe.mjs`
- CI: gate de drift em `.github/workflows/ci.yml` (`migrate diff --exit-code`)
- RLS: `docs/05-security-compliance/RLS.md` · Backup: `BACKUP_DR.md`
- Testes dos helpers: `tests/bootstrap-migrations.test.ts`

## 8. Scripts de manutenção sob RLS (rodada 8)

Produção roda com role `autotrader_app` (**NOBYPASSRLS**) e as tabelas
`Position`, `WalletConnection`, `ExchangeConnection` e `NotificationChannel` são
**STRICT**. Nesse cenário um script de manutenção com o role de app **não falha
com erro**: ele vê 0 linhas e o DELETE/UPDATE afeta 0 registros — falha silenciosa.

### 8.1 Regra

| Quem | Role que pode rodar manutenção |
|---|---|
| Script de manutenção (seed, limpeza, backfill, reset) | **owner do banco** ou role com `BYPASSRLS` |
| Runtime da aplicação (`/api/**`, engine, signer) | `autotrader_app` + `withSystemRls` (GUC `app.rls_bypass='on'`) |
| `npm run test:ci` / suítes de teste | banco **descartável** com superuser (`test:ci:local`) — não precisam de guard |

### 8.2 Guard

```bash
# verifica o role do DATABASE_URL atual (exit 0 = pode rodar; 1 = aborta)
node scripts/lib/require-bypass-rls.mjs
node scripts/lib/require-bypass-rls.mjs --json
```

Os scripts abaixo chamam o guard automaticamente antes de tocar no banco:

| Script | Toca | Guard |
|---|---|---|
| `scripts/seed-demo.ts` | Position (STRICT) | `context: seed-demo` |
| `scripts/seed-auth.ts` | WalletConnection/ExchangeConnection/NotificationChannel | `context: seed-auth` |
| `scripts/clear-demo-data.mjs` | Position | `context: clear-demo-data` |
| `scripts/cleanup-wallets.ts` | WalletConnection | `context: cleanup-wallets` |
| `scripts/cleanup-stress-wallets.js` | WalletConnection | `context: cleanup-stress-wallets` |
| `scripts/reset-db.js` | Position (+ outras) | `context: reset-db` |
| `scripts/backfill-consecutive-losses.js` | Position (leitura) | `context: backfill-consecutive-losses` |
| `scripts/backfill-paper-cycle-attempts.js` | Position (leitura) | `context: backfill-paper-cycle-attempts` |

Scripts de `test:ci` (`scripts/test-*.ts`) e `test:ci:local` rodam em banco
descartável com superuser — **de propósito não têm guard**.

### 8.3 Rodando com o owner (produção / manutenção)

```bash
# injeta a env de produção e usa o role de app -> deve ABORTAR (esperado)
railway run --service auto-trader --environment production node scripts/lib/require-bypass-rls.mjs
#
# para operar de verdade, use a connection string do OWNER do Neon:
DATABASE_URL='postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require' \
  node scripts/clear-demo-data.mjs            # dry-run primeiro
```

### 8.4 Rollback / se algo der errado

- Scripts de manutenção **não alteram schema**; rollback = desfazer os dados pelo
  caminho inverso (ou restore de `scripts/restore-full.mjs` se houve deleção ampla).
- Se o guard abortar por engano (role de operação sem bypass), conceda
  `ALTER ROLE <role> BYPASSRLS;` (com o owner) — nunca rode com o app role.
- Nunca use `SET session_replication_role = replica` como atalho: desliga triggers e
  não é o mecanismo de RLS do projeto.
