# RLS — Row Level Security

> **Versão:** 1.0 — 2026-08-26
> **Status:** Design + implementação app-layer (SQLite) / policy PostgreSQL (prod)
> **Princípio:** Nenhuma query lê/escreve linha de outro usuário, mesmo se RBAC falhar.

---

## 1. Por que RLS se já temos RBAC?

RBAC decide **se** você pode chamar a rota. RLS decide **quais linhas** você vê dentro da rota.

Sem RLS: `GET /api/wallets` com `where: {}` retorna wallets de todos. Um bug no handler (esquecer `where: {ownerId}`) vaza tudo. RLS é a segunda barreira.

---

## 2. Estratégia por Ambiente

| Ambiente | Engine | Mecanismo RLS | Onde vive |
|---|---|---|---|
| **Dev** | SQLite (`file:./prisma/dev.db`) | App-layer guard (`withRLS()` helper) — injeta `where` em toda query Prisma | `src/lib/auth/rls.ts` |
| **Prod** | PostgreSQL | Nativo `CREATE POLICY` + `SET ROLE` + `current_setting('app.current_user_id')` | `prisma/migrations/*_rls_policies/migration.sql` |

App-layer é o fallback portável; Postgres policies são a defesa nativa quando o provider suporta.

---

## 3. Modelos com RLS (Prisma)

```prisma
// SPRINT: adicionar ownerId + RLS a modelos sensíveis

model WalletConnection {
  id                  String   @id @default(cuid())
  ownerId             String   // ← RLS key
  label               String
  address             String
  privateKeyEncrypted String?
  isActive            Boolean  @default(false)
  readOnly            Boolean  @default(false)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  owner               User     @relation(fields: [ownerId], references: [id])
  @@index([ownerId])
  @@index([address])
}

model ExchangeConnection {
  id                    String   @id @default(cuid())
  ownerId               String   // ← RLS key
  label                 String
  exchange              String
  apiKeyEncrypted       String?
  apiSecretEncrypted    String?
  isActive              Boolean  @default(false)
  owner                 User     @relation(fields: [ownerId], references: [id])
  @@index([ownerId])
}

model Position {
  id              String   @id @default(cuid())
  ownerId         String?  // ← nullable para migração; NOT NULL após backfill
  symbol          String
  status          String   @default("open")
  entryPriceUsd   Float
  entryAmountUsd  Float
  roundId         Int
  // ... resto igual
  owner           User?    @relation(fields: [ownerId], references: [id])
  @@index([ownerId])
  @@index([status])
}

model NotificationChannel {
  id        String   @id @default(cuid())
  ownerId   String
  name      String
  type      String
  config    String   // encrypted
  events    String
  owner     User     @relation(fields: [ownerId], references: [id])
  @@index([ownerId])
}

// Modelos SINGLETON (Config, Reserve, TradingBalance, TradingSchedule)
// NÃO têm ownerId — são globais do sistema e protegidos por RBAC `super_admin`/`trader`.
// RLS não se aplica a singletons; o guard é o middleware RBAC.

// Modelos AUDIT / LOG (ScamReport, MarketSnapshot, AIInsight, SiteAudit, PositionAlert, BacktestResult, RiskEvent, AppLog, Round, PerformanceSnapshot)
// São append-only e visíveis a qualquer papel com `logs:read` ou `audit:read`.
// RLS: filtrar por `ownerId` quando a linha tem owner; caso contrário, RBAC decide visibilidade.
// Para MVP single-operator, esses modelos permanecem sem RLS — SPRINT multi-tenant adiciona ownerId.
```

---

## 4. App-Layer Guard (`src/lib/auth/rls.ts`)

```ts
// src/lib/auth/rls.ts — SPRINT implementa

import { db } from '@/lib/db';
import type { Session } from '@/lib/auth/session';

type RlsModel = 'walletConnection' | 'exchangeConnection' | 'position' | 'notificationChannel';

/**
 * Envolve uma query Prisma injetando `where.ownerId = session.userId`
 * quando o modelo é RLS-protected. Super admin bypassa (vê tudo) mas
 * ainda loga o acesso em AuditLog.
 *
 * Uso:
 *   const wallets = await withRLS(session, 'walletConnection', (tx) =>
 *     tx.walletConnection.findMany({ where: { isActive: true } })
 *   );
 * // Se session.role !== 'super_admin', a query final é:
 * //   findMany({ where: { isActive: true, ownerId: session.userId } })
 */
export async function withRLS<T>(
  session: Session,
  model: RlsModel,
  fn: (tx: typeof db) => Promise<T>
): Promise<T> {
  if (session.role === 'super_admin') {
    // Bypass mas audita — super_admin vendo dados de outro é sensível
    // logger.info('rls', `super_admin bypass RLS on ${model}`, { actorId: session.userId });
    return fn(db);
  }
  // Para modelos RLS, o caller DEVE passar ownerId; se esquecer, withRLS injeta.
  // Implementação real: usa Prisma middleware ($use) ou helper que mergeia `where`.
  // Simplificação: exige que fn use `rlsDb(session)` proxy em vez de `db` direto.
  return fn(rlsDb(session));
}

function rlsDb(session: Session): typeof db {
  // Proxy que intercepta `db.walletConnection.findMany` etc e injeta ownerId.
  // Ver implementação completa em SPRINT — aqui o contrato.
  return new Proxy(db, {
    get(target, prop) {
      // Se prop é um modelo RLS, retorna proxy do delegate com where injetado
      // Caso contrário, retorna delegate normal
      return (target as any)[prop];
    },
  }) as typeof db;
}

// Helper para rotas que precisam verificar ownership de um ID específico:
export async function assertOwner(
  session: Session,
  model: RlsModel,
  id: string
): Promise<void> {
  const row = await (db as any)[model].findUnique({ where: { id }, select: { ownerId: true } });
  if (!row) throw new NotFoundError(model, id);
  if (session.role !== 'super_admin' && row.ownerId !== session.userId) {
    throw new ForbiddenError(`Not owner of ${model}:${id}`);
  }
}
```

**Regra de ouro:** toda rota que acessa modelo RLS **DEVE** passar por `withRLS` ou `assertOwner`. Lint custom (`eslint-plugin-rls`) pode forçar — ver `docs/LINT.md`.

---

## 5. PostgreSQL Native Policies (Prod)

```sql
-- prisma/migrations/20260826_rls_policies/migration.sql
-- Executado SÓ quando DATABASE_URL é postgres. SQLite ignora.

-- 1. Habilitar RLS nas tabelas
ALTER TABLE "WalletConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExchangeConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Position" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationChannel" ENABLE ROW LEVEL SECURITY;

-- 2. Policy: usuário vê só suas linhas; super_admin vê tudo via BYPASSRLS role
-- O app faz: SET LOCAL app.current_user_id = '<session.userId>';
--            SET LOCAL app.current_role = '<session.role>';

CREATE POLICY wallet_owner_isolation ON "WalletConnection"
  USING (
    "ownerId" = current_setting('app.current_user_id', true)
    OR current_setting('app.current_role', true) = 'super_admin'
  )
  WITH CHECK (
    "ownerId" = current_setting('app.current_user_id', true)
    OR current_setting('app.current_role', true) = 'super_admin'
  );

CREATE POLICY exchange_owner_isolation ON "ExchangeConnection"
  USING (
    "ownerId" = current_setting('app.current_user_id', true)
    OR current_setting('app.current_role', true) = 'super_admin'
  )
  WITH CHECK (
    "ownerId" = current_setting('app.current_user_id', true)
    OR current_setting('app.current_role', true) = 'super_admin'
  );

-- 3. Prisma deve SETAR as vars a cada request (middleware):
-- await db.$executeRaw`SELECT set_config('app.current_user_id', ${session.userId}, true)`;
-- await db.$executeRaw`SELECT set_config('app.current_role', ${session.role}, true)`;

-- 4. Service role (engine/signer) usa BYPASSRLS — mas só via Unix socket, nunca via HTTP
-- CREATE ROLE service_bypass BYPASSRLS; -- SPRINT: criar role separado com mínimo
```

---

## 6. Checklist de Queries — Onde RLS se Aplica

| Rota / Handler | Modelo | RLS? | Como |
|---|---|---|---|
| `GET /api/wallets` | WalletConnection | ✅ | `withRLS(session, 'walletConnection', ...)` |
| `POST /api/wallets` | WalletConnection | ✅ | `data: { ownerId: session.userId, ... }` |
| `GET /api/exchanges` | ExchangeConnection | ✅ | `withRLS` |
| `GET /api/positions` | Position | ✅ | `withRLS` (futuro multi-tenant) |
| `GET /api/notifications` | NotificationChannel | ✅ | `withRLS` |
| `GET /api/config` | Config | ❌ | Singleton — RBAC `config:read` |
| `POST /api/kill-switch` | Config | ❌ | RBAC `engine:kill` |
| `GET /api/logs` | AppLog | ⚠️ | RBAC `logs:read` hoje; ownerId futuro |
| `POST /api/backtest` | BacktestResult | ⚠️ | RBAC `backtest:run`; ownerId futuro |

---

## 7. Testes de RLS (a implementar — SPRINT)

```ts
// tests/rls.test.ts (Vitest)
test('user A cannot read wallet of user B', async () => {
  const walletB = await createWalletAs(userB, { label: 'B wallet' });
  await expect(listWalletsAs(userA)).resolves.not.toContain(walletB);
  await expect(getWalletAs(userA, walletB.id)).rejects.toThrow(/Not owner|Not found/);
});

test('super_admin can read all wallets', async () => {
  const walletA = await createWalletAs(userA, { label: 'A' });
  const walletB = await createWalletAs(userB, { label: 'B' });
  const all = await listWalletsAs(superAdmin);
  expect(all.map(w => w.id)).toEqual(expect.arrayContaining([walletA.id, walletB.id]));
});

test('direct DB query without withRLS is blocked by Postgres policy', async () => {
  await db.$executeRaw`SET LOCAL app.current_user_id = ${userA.id}`;
  const rows = await db.$queryRaw`SELECT * FROM "WalletConnection" WHERE id = ${walletB.id}`;
  expect(rows).toHaveLength(0); // policy filtra
});
```

---

## 8. Pergunta de Backup (do critério)

> Se eu precisar restaurar tudo amanhã, existe backup?

| Item | Resposta |
|---|---|
| **SQLite dev** | `db/custom.db` ignorado no git (REG-008), mas sem backup automático. SPRINT: `scripts/backup-db.sh` + cron diário + retenção 30d. |
| **PostgreSQL prod** | `pg_dump` diário + WAL archiving + retenção 30d (ver `docs/DEPLOY.md`). Teste de restore mensal. |
| **Migrations** | `prisma/migrations/` versionadas no git — `prisma migrate deploy` recria schema idêntico em fresh clone. |
| **Audit hash-chain** | File `logs/audit-*.log` — não está no DB; backup do volume `logs/` junto com DB. `verify()` detecta truncamento. |
| **Prisma schema** | Fonte única; `prisma generate` + `db push` para dev, `migrate deploy` para prod. |
