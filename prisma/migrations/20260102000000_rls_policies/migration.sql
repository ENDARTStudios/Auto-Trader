-- Round 4 — RLS NATIVO Postgres (policies + FORCE).
--
-- Tabelas com coluna "ownerId" (multi-tenant): Position, WalletConnection,
-- ExchangeConnection, NotificationChannel.
--
-- MODELO
-- ------
-- A aplicação abre UMA transação por request e injeta:
--   app.user_id   → id do usuário autenticado (GUC, transaction-local)
--   app.rls_bypass → 'on' para super_admin e jobs/engine de sistema
-- (ver src/lib/auth/rls-context.ts: withUserRls / withSystemRls).
--
-- POLÍTICA (USING + WITH CHECK):
--   - bypass ligado → vê/escreve tudo (super_admin / engine);
--   - SEM contexto (GUCs ausentes/vazios) → PERMISSIVO. É o modo
--     "legado/compatibilidade": queries que ainda não adotaram o helper
--     continuam funcionando. Importante para rollout sem downtime.
--   - COM contexto de usuário → apenas linhas com "ownerId" = app.user_id.
--
-- FORCE é essencial: o usuário de banco (e o owner das tabelas) BYPASSA RLS
-- por padrão. Sem FORCE, as policies valeriam só para roles não-owner e o
-- teste de isolamento veria tudo.
--
-- Idempotente: DROP POLICY IF EXISTS antes de CREATE; ENABLE/FORCE são
-- repetíveis. Aplicação: migração (Lead) ou scripts/apply-rls-dev.mjs (dev).
-- NÃO usar prisma migrate deploy neste ambiente de agente.

-- ─────────────────────────────────────────────────────────────────────────
-- Position
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "Position" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Position" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Position_rls" ON "Position";
CREATE POLICY "Position_rls" ON "Position"
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR NULLIF(current_setting('app.user_id', true), '') IS NULL
    OR "ownerId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR NULLIF(current_setting('app.user_id', true), '') IS NULL
    OR "ownerId" = current_setting('app.user_id', true)
  );

-- ─────────────────────────────────────────────────────────────────────────
-- WalletConnection
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "WalletConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WalletConnection" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "WalletConnection_rls" ON "WalletConnection";
CREATE POLICY "WalletConnection_rls" ON "WalletConnection"
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR NULLIF(current_setting('app.user_id', true), '') IS NULL
    OR "ownerId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR NULLIF(current_setting('app.user_id', true), '') IS NULL
    OR "ownerId" = current_setting('app.user_id', true)
  );

-- ─────────────────────────────────────────────────────────────────────────
-- ExchangeConnection
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "ExchangeConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExchangeConnection" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ExchangeConnection_rls" ON "ExchangeConnection";
CREATE POLICY "ExchangeConnection_rls" ON "ExchangeConnection"
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR NULLIF(current_setting('app.user_id', true), '') IS NULL
    OR "ownerId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR NULLIF(current_setting('app.user_id', true), '') IS NULL
    OR "ownerId" = current_setting('app.user_id', true)
  );

-- ─────────────────────────────────────────────────────────────────────────
-- NotificationChannel
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "NotificationChannel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationChannel" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "NotificationChannel_rls" ON "NotificationChannel";
CREATE POLICY "NotificationChannel_rls" ON "NotificationChannel"
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR NULLIF(current_setting('app.user_id', true), '') IS NULL
    OR "ownerId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR NULLIF(current_setting('app.user_id', true), '') IS NULL
    OR "ownerId" = current_setting('app.user_id', true)
  );
