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

## 8. Referências

- Migração: `prisma/migrations/20260102000000_rls_policies/migration.sql`
- Helper: `src/lib/auth/rls-context.ts` / app-layer: `src/lib/auth/rls.ts`
- Teste: `tests/rls-policies.test.ts`
- Script dev: `scripts/apply-rls-dev.mjs`
