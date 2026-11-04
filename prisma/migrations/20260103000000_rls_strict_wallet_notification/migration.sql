-- RLS STRICT — fase 2 (round 6): WalletConnection + NotificationChannel.
--
-- Remove a cláusula de compatibilidade 'NULLIF(current_setting(app.user_id), "") IS NULL'
-- (que tornava a policy permissiva quando não havia contexto) APENAS destas duas
-- tabelas. Position/ExchangeConnection permanecem na fase 1 (permissivas sem
-- contexto) até que todos os seus call sites sejam migrados.
--
-- Consequência: com role de aplicação NON-superuser, qualquer SELECT/INSERT/
-- UPDATE/DELETE em WalletConnection/NotificationChannel SEM contexto explícito
-- retorna 0 linhas / é negado. Todo call site precisa de withUserRls (rotas de
-- usuário) ou withSystemRls (engine/jobs/signer/boot) — ver round-6.
--
-- Rollback: recriar as policies com a cláusula permissiva (fase 1) usando a
-- migration 20260102000000_rls_policies como base.
--
-- Idempotente: DROP POLICY IF EXISTS antes de CREATE; ENABLE/FORCE repetíveis.
-- Aplicar em DEV: node scripts/apply-rls-dev.mjs (todas as migrations RLS em ordem).
-- NUNCA rodar migrate deploy neste ambiente de agente: o Lead aplica em prod
-- DEPOIS do deploy do código (rollout invertido: código primeiro, policy depois).

-- ─────────────────────────────────────────────────────────────────────────
-- WalletConnection (STRICT)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "WalletConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WalletConnection" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "WalletConnection_rls" ON "WalletConnection";
CREATE POLICY "WalletConnection_rls" ON "WalletConnection"
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR "ownerId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR "ownerId" = current_setting('app.user_id', true)
  );

-- ─────────────────────────────────────────────────────────────────────────
-- NotificationChannel (STRICT)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "NotificationChannel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationChannel" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "NotificationChannel_rls" ON "NotificationChannel";
CREATE POLICY "NotificationChannel_rls" ON "NotificationChannel"
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR "ownerId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR "ownerId" = current_setting('app.user_id', true)
  );
