-- RLS STRICT — fase 3 (round 7): ExchangeConnection.
--
-- Remove a cláusula de compatibilidade 'NULLIF(current_setting(app.user_id), "") IS NULL'
-- APENAS de ExchangeConnection (WalletConnection/NotificationChannel já foram
-- endurecidas no round 6; Position permanece fase 1 nesta rodada).
--
-- Consequência: com role de aplicação NON-superuser, SELECT/INSERT/UPDATE/DELETE
-- em ExchangeConnection SEM contexto explícito retorna 0 linhas / é negado.
-- Call sites de runtime: rotas /api/exchanges usam withUserRls; engine/vault/
-- live-credentials/db-init usam withSystemRls. Ver round 7.
--
-- Rollback: recriar a policy com a cláusula permissiva da fase 1 (migration
-- 20260102000000_rls_policies como base).
--
-- Idempotente. Aplicar em DEV: node scripts/apply-rls-dev.mjs (todas as
-- migrations RLS em ordem). NÃO rodar migrate deploy aqui: o Lead aplica em
-- prod DEPOIS do deploy do código.

ALTER TABLE "ExchangeConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExchangeConnection" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ExchangeConnection_rls" ON "ExchangeConnection";
CREATE POLICY "ExchangeConnection_rls" ON "ExchangeConnection"
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR "ownerId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR "ownerId" = current_setting('app.user_id', true)
  );
