# RLS — Row Level Security (nativo Postgres)

> **Versão:** 2.0 — round 4 (2026-11-03) — substitui o design v1.0 app-layer.
> **Status:** policies Postgres implementadas e testadas (`tests/rls-policies.test.ts`).
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

- Queries fora dos helpers seguem permissivas. O passo final é migrar TODOS os
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
# DEV (idempotente): aplica as policies no Postgres local
node scripts/apply-rls-dev.mjs
# Prova de isolamento (role não-superuser dedicada, cleanup automático)
npx vitest run tests/rls-policies.test.ts
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
