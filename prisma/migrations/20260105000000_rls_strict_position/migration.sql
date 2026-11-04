-- RLS STRICT — fase 4 (round 8): Position (última tabela multi-tenant).
--
-- Remove a cláusula de compatibilidade 'NULLIF(current_setting(app.user_id), "") IS NULL'
-- APENAS de Position. WalletConnection/NotificationChannel (round 6) e
-- ExchangeConnection (round 7) já estão strict. A partir desta migration TODAS
-- as tabelas com ownerId ficam fail-closed sem contexto explícito.
--
-- Consequência (role de app NON-superuser): SELECT sem GUC = 0 linhas;
-- INSERT/UPDATE/DELETE sem contexto = negado. Todos os 33 call sites de runtime
-- já usam withUserRls (rotas de usuário) ou withSystemRls (engine/jobs/backup/
-- rotas admin) desde a rodada 7 — ver scripts/audit-rls-context.mjs.
--
-- Rollback: recriar Position_rls com a cláusula permissiva da fase 1
-- (prisma/migrations/20260102000000_rls_policies/migration.sql) — nenhum
-- deploy de código é necessário.
--
-- Idempotente. Aplicar em DEV: node scripts/apply-rls-dev.mjs (todas as
-- migrations RLS em ordem). NÃO rodar migrate deploy aqui: o Lead aplica em
-- prod DEPOIS do deploy do código (rollout invertido).

ALTER TABLE "Position" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Position" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Position_rls" ON "Position";
CREATE POLICY "Position_rls" ON "Position"
  USING (
    current_setting('app.rls_bypass', true) = 'on'
    OR "ownerId" = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.rls_bypass', true) = 'on'
    OR "ownerId" = current_setting('app.user_id', true)
  );
