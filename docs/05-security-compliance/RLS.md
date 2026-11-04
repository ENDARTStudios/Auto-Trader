# RLS — Row Level Security (nativo Postgres)

> **Versão:** 5.0 — round 8 (2026-11-03) — fases 2, 3 e 4 STRICT: **todas** as
> tabelas com `ownerId` (WalletConnection, NotificationChannel, ExchangeConnection,
> Position) são fail-closed sem contexto explícito.
> **Status:** policies Postgres implementadas e testadas (`tests/rls-strict.test.ts`,
> `tests/rls-policies.test.ts`, `tests/position-rls-context.test.ts`).
> **Princípio:** nenhuma query deve ler/escrever linha de outro usuário, mesmo se
> o RBAC/aplicação falhar. RLS é a segunda barreira.

## 1. Camadas

| Camada | O que faz | Onde |
|---|---|---|
| RBAC | decide **se** a rota pode ser chamada | `src/lib/auth/rbac.ts` |
| App-layer | injeta `where ownerId` / `assertOwner` (IDOR) | `src/lib/auth/rls.ts` |
| **Postgres RLS** | decide **quais linhas** existem para a transação | `prisma/migrations/20260102000000_rls_policies/migration.sql` |
| Contexto por request | GUCs `app.user_id` / `app.rls_bypass` na transação | `src/lib/auth/rls-context.ts` |

As camadas são independentes e complementares (defesa em profundidade).

## 2. Policies (migração)

Tabelas com `ownerId`: **Position**, **WalletConnection**, **ExchangeConnection**,
**NotificationChannel**. Cada uma recebe:

```sql
ALTER TABLE "Tabela" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tabela" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tabela_rls" ON "Tabela";
CREATE POLICY "Tabela_rls" ON "Tabela"
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR NULLIF(current_setting('app.user_id', true), '') IS NULL
    OR "ownerId" = current_setting('app.user_id', true)
  )
  WITH CHECK (<mesma expressão>);
```

Leitura da condição:
- `app.rls_bypass='on'` → vê/escreve tudo (super_admin, engine, jobs).
- GUC de usuário **ausente/vazio** → **permissivo** (modo compatibilidade do
  rollout: queries que ainda não adotaram o helper continuam funcionando).
- GUC de usuário presente → só linhas com `ownerId` do usuário.

`WITH CHECK` bloqueia INSERT/UPDATE com `ownerId` de outro usuário (testado).

### Fase 2 (round 6): STRICT em WalletConnection + NotificationChannel

`prisma/migrations/20260103000000_rls_strict_wallet_notification/migration.sql`
recria as policies dessas duas tabelas **sem** a cláusula
`NULLIF(current_setting('app.user_id', true), '') IS NULL`:

```sql
USING (
  current_setting('app.rls_bypass', true) = 'on'
  OR "ownerId" = current_setting('app.user_id', true)
)
WITH CHECK (<mesma expressão>)
```

Consequência: com role de aplicação NÃO-superuser, **sem contexto explícito**
SELECT retorna 0 linhas e INSERT/UPDATE/DELETE são negados nessas duas tabelas.
Todo call site precisa de:

- **rotas de usuário** → `withUserRls(session, fn)` (super_admin vira bypass);
- **engine / jobs / signer / boot / rotas admin** → `withSystemRls(fn)`.

Call sites migrados no round 6: `api/wallets` (GET/POST + `[id]`), `wallet-manager`
(parâmetro opcional `client: Prisma.TransactionClient`), `wallet-crypto.loadVault`,
`signer/sign-methods`, `chain/dex-adapter`, `live-credentials`, `notifier`,
`api/system/backup|info`, `db-init` (backfill).

### Fase 3 (round 7): STRICT em ExchangeConnection

`prisma/migrations/20260104000000_rls_strict_exchange/migration.sql` recria a
policy de ExchangeConnection sem a cláusula permissiva (mesmo padrão da fase 2:
`bypass = 'on' OR "ownerId" = app.user_id`, em USING e WITH CHECK).

Call sites migrados no round 7:

- `wallet-manager` exchange CRUD (`listExchanges`/`createExchange`/
  `setExchangeActive`/`deleteExchange`) ganhou `client?: Prisma.TransactionClient`;
  `createExchange` também aceita `ownerId` (obrigatório sob contexto de usuário,
  senão o WITH CHECK rejeita ownerId NULL);
- `api/exchanges` GET/POST e `api/exchanges/[id]` usam `withUserRls` (super_admin
  = bypass; demais só o próprio);
- `live-credentials` (lookup da ExchangeConnection ativa), `wallet-crypto.loadVault`
  e `db-init` (backfill) já rodavam em `withSystemRls` desde o round 6 — confirmados.

### Fase 4 (round 8): STRICT em Position (última tabela)

`prisma/migrations/20260105000000_rls_strict_position/migration.sql` recria
`Position_rls` sem a cláusula permissiva (mesmo padrão das fases 2/3).

Os 33 call sites de `Position` já estavam com contexto desde a rodada 7
(deployada): rotas de usuário via `withUserRls`; engine/portfolio/risk/schedule/
backtest/analytics/backup/info via `withSystemRls` (ou `tx` recebido de um
helper). O auditor `node scripts/audit-rls-context.mjs` valida isso
automaticamente (0 violações, exit 0).

Com a fase 4, **todas as tabelas multi-tenant estão STRICT**:

| Tabela | Fase | Sem contexto (role app non-superuser) |
|---|---|---|
| WalletConnection | 2 (round 6) | SELECT 0 / escrita negada |
| NotificationChannel | 2 (round 6) | SELECT 0 / escrita negada |
| ExchangeConnection | 3 (round 7) | SELECT 0 / escrita negada |
| Position | 4 (round 8) | SELECT 0 / escrita negada |

### O que isso significa por papel

- **viewer**: `positions:read`/logs continuam permitidos, mas só vê as posições
  do próprio `ownerId`. Como o seed cria o viewer sem posições, o dashboard do
  viewer aparece vazio (comportamento esperado do multi-tenant; super_admin/
  trader dono veem as suas).
- **trader**: vê/opera apenas as posições do próprio `ownerId`; INSERT/UPDATE
  com `ownerId` de outro usuário é rejeitado pelo WITH CHECK.
- **super_admin**: `app.rls_bypass='on'` no contexto → vê e escreve todas.
- **engine/jobs/signer/boot** (sem usuário HTTP): `withSystemRls` (bypass
  explícito) — único caminho autorizado para operações globais.
- Qualquer query fora dos helpers → 0 linhas/negada (fail-closed).

### Como adicionar a próxima tabela ao strict

1. `grep` por todos os acessos à tabela (`db.<model>` / delegates Prisma).
2. Migrar cada call site: `withUserRls` (input de usuário) ou `withSystemRls`
   (sistema). NUNCA usar `withSystemRls` para input de usuário sem autorização.
3. Nova migration `*_rls_strict_<tabela>/migration.sql` idempotente recriando a
   policy sem a cláusula permissiva (DROP POLICY IF EXISTS + CREATE).
4. Rodar `node scripts/apply-rls-dev.mjs` (aplica TODAS as migrations RLS em
   ordem) e adicionar/extender o teste de negação sem contexto.
5. **Rollout invertido**: deploy do código primeiro; só depois aplicar a
   migration em produção (o Lead).

### Rollback do strict

Recriar as policies com a cláusula permissiva (fase 1) para as tabelas afetadas:
```sql
DROP POLICY IF EXISTS "WalletConnection_rls" ON "WalletConnection";
CREATE POLICY "WalletConnection_rls" ON "WalletConnection"
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR NULLIF(current_setting('app.user_id', true), '') IS NULL
    OR "ownerId" = current_setting('app.user_id', true)
  )
  WITH CHECK (<mesma expressão>);
```
(idem para `NotificationChannel`, `ExchangeConnection` e `Position`). Nenhuma
mudança de código é necessária — os helpers já funcionam nas duas fases.

### Runbook de verificação pós-flip (produção)

1. Logar como super_admin → dashboard: posições aparecem (bypass).
2. Logar como trader dono das posições do engine (owner = super_admin do seed):
   se o trader não for o owner, verá 0 posições — comportamento correto do
   multi-tenant (não é bug de UI).
3. `GET /api/status`, `GET /api/positions`, `GET /api/history`,
   `GET /api/analytics` e `GET /api/system/info` respondem 200 (as rotas usam
   contexto; `/api/system/*` usa `withSystemRls`).
4. `GET /api/audit`/backup admin (`/api/system/backup`) funcionam (system).
5. Não deve haver 500 nem listas inesperadamente vazias para o owner real; se
   houver 0 linhas para todos, verificar se a migration foi aplicada DEPOIS do
   deploy do código e se o `DATABASE_URL` usa `autotrader_app` (não superuser).

### FORCE ROW LEVEL SECURITY (essencial)
O usuário de banco que **é dono das tabelas** bypassa RLS por padrão. `FORCE`
remove esse bypass. Sem FORCE as policies valeriam apenas para roles não-owner.
O teste verifica `relrowsecurity` + `relforcerowsecurity` no catálogo e o
isolamento comportamental.

## 3. ⚠️ SUPERUSER ignora RLS (caveat de produção)

Superuser é sempre `BYPASSRLS` — nem FORCE se aplica. Consequências:
- **Dev**: o usuário do Postgres local é superuser; o teste de isolamento cria e
  usa uma role **NÃO-superuser** (`autotrader_rls_test`, via startup option
  `-c role=...`) para provar as policies de verdade.
- **Produção**: para RLS valer, o `DATABASE_URL` da aplicação precisa apontar
  para uma role **não-superuser** (owner ou não; FORCE cobre o owner). Se o app
  conectar como `postgres`/superuser, as policies são inócuas. DDL/migrações
  podem seguir em job administrativo separado.

## 4. Contexto por transação

`src/lib/auth/rls-context.ts`:

```ts
// request autenticado: app.user_id = sessão; super_admin → bypass on
await withUserRls(session, (tx) => tx.walletConnection.delete({ where: { id } }));

// engine/jobs/rotinas administrativas: bypass explícito
await withSystemRls((tx) => tx.position.findMany({ where: { status: 'open' } }));
```

`set_config('app.user_id', ..., true)` é **transaction-local**: no COMMIT/ROLLBACK
o GUC desaparece e nada vaza para a próxima query do pool (testado). O helper
resolve a conexão numa transação Prisma interativa única.

O 3º parâmetro opcional `client` permite aos testes conectarem com role
não-superuser; em produção o default é o singleton `db`.

## 5. Rollout

1. Migração: Lead aplica no deploy; em dev `node scripts/apply-rls-dev.mjs`
   (idempotente, lê a migration). Como a policy é permissiva sem GUC, nenhuma
   query existente quebra.
2. Rotas adotadas (round 4):
   - `PATCH/DELETE /api/wallets/[id]` — via `withUserRls` (mantém `assertOwner`);
   - `PATCH/DELETE /api/exchanges/[id]` — via `withUserRls`;
   - `GET/POST /api/notifications/channels` e `PATCH/DELETE /api/notifications/channels/[id]`
     — via `withUserRls` (mantém `rlsWhere`/`assertOwner`).
3. Ainda fora: `wallets`/`exchanges` GET/POST usam `wallet-manager.ts` (db
   global sem contexto) — protegidos só pelo `ownerId` de aplicação. Tornar os
   managers tx-aware é o próximo passo.
4. `engine`/`portfolio` continuam sem contexto (permissivo por design); ao
   escreverem em nome de usuário devem usar `withSystemRls`/`withUserRls`.

## 6. Limitações / próximos passos

- **Todas as 4 tabelas são STRICT (fases 2/3/4)**: qualquer acesso fora dos
  helpers retorna 0 linhas/é negado com role de app non-superuser — inclusive
  Position. Não existe mais cláusula permissiva "sem contexto" em nenhuma policy.
- Queries fora dos helpers nas tabelas de fase 1 seguem permissivas. O passo final é migrar TODOS os
  acessos às 4 tabelas e então endurecer a policy (negar quando `app.user_id`
  ausente) — só depois de todos os call sites adotarem.
- `WalletConnection.ownerId`/`ExchangeConnection.ownerId`/`NotificationChannel.ownerId`
  são nullable no schema (backfill legado). Linhas órfãs (ownerId NULL) ficam
  invisíveis sob contexto de usuário e visíveis no modo permissivo.
- Outras tabelas multi-tenant (`WatchlistToken` sem `ownerId`; `User`) ficam
  para a próxima rodada.
- Role de aplicação em produção precisa ser não-superuser (ver §3).

## 7. Operação

```bash
# DEV (idempotente): aplica TODAS as migrations de RLS em ordem
# (fase 1 permissiva → fase 2 strict). Opcional: passar o nome de uma migration.
node scripts/apply-rls-dev.mjs
# Fase 1 (permissiva sem contexto) + fases 2/3 (strict wallet/notification/exchange)
npx vitest run tests/rls-policies.test.ts tests/rls-strict.test.ts
```

## 9. Rollout do enforcement — role de app sem BYPASSRLS (rodada 5, 2026-11-04)

> **Caveat descoberto em produção:** o role `neondb_owner` do Neon tem
> `rolbypassrls = true` (e é owner das tabelas). RLS **não** se aplica a ele, então
> as policies criadas na rodada 4 estavam **inertes** — medido por
> `node scripts/verify-rls-enforcement.mjs` (**INERTE**, exit 1 com
> `--expect-enforced`). `FORCE ROW LEVEL SECURITY` não resolve isso: FORCE só
> alcança o **owner**; BYPASSRLS ignora RLS por completo.

### 9.1 Criar/ajustar o role de aplicação (operador)

```sql
-- role de app: login, SEM superuser, SEM bypassrls
CREATE ROLE app_rls LOGIN PASSWORD '<senha forte>' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE <db> TO app_rls;
GRANT USAGE ON SCHEMA public TO app_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rls;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rls;
-- e para tabelas/sequências futuras criadas pelo owner:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rls;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_rls;
```

Conferir (deve retornar `false, false`):

```sql
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_rls';
```

### 9.2 Trocar o DATABASE_URL (sem mudar schema)

1. Crie o role acima (as tabelas continuam pertencendo ao owner; FORCE RLS já está ligado).
2. Atualize `DATABASE_URL` no provedor (Railway/Neon) para o novo role — **nunca** no git.
3. Redeploy/reinício do app.
4. Valide (deve sair **ENFORCED**, exit 0):

```bash
node scripts/verify-rls-enforcement.mjs --expect-enforced
```

> Se o Neon usar pooler (pgbouncer, transaction mode), `SET LOCAL`/`set_config(..., true)
> continua funcionando porque o helper abre transação por request
> (`src/lib/auth/rls-context.ts`). Evite `SET` de sessão em pooler transaction.

### 9.3 Rollback

Reverter é **só reverter o `DATABASE_URL`** para o role anterior e reiniciar — não
há mudança de schema. Se o novo role não tiver grant suficiente, o app falha com
permissão negada em tabela específica: conceda o grant (acima) em vez de voltar o role.
Para desligar o enforcement como último recurso: voltar `DATABASE_URL` ao owner
(volta a ser inerte — registrar decisão em `DECISOES.md`).

### 9.4 Caveats

- **Owner do Neon tem BYPASSRLS por definição** — não é configurável pelo usuário;
  por isso o app não deve usar o owner.
- O modo **sem contexto é permissivo** (compatibilidade de rollout). Enforcement total
  passa a valer quando os call sites que consultam as 4 tabelas usarem
  `withUserRls`/`withSystemRls`; até lá, o isolamento é o do app-layer (`withRLS`).
- Verificação de enforcement precisa de linhas de **outros** usuários para ser
  conclusiva; em banco vazio o script avisa "isolamento não distinguível".

## 8. Referências

- Migração: `prisma/migrations/20260102000000_rls_policies/migration.sql`
- Helper: `src/lib/auth/rls-context.ts` / app-layer: `src/lib/auth/rls.ts`
- Teste: `tests/rls-policies.test.ts`
- Script dev: `scripts/apply-rls-dev.mjs`
