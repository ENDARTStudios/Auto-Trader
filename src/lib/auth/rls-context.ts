// src/lib/auth/rls-context.ts — contexto transacional para RLS NATIVO (round 4).
//
// O Postgres aplica as policies de prisma/migrations/20260102000000_rls_policies
// lendo dois GUCs definidos POR TRANSAÇÃO:
//   app.user_id    → id do usuário autenticado
//   app.rls_bypass → 'on' para super_admin / jobs de sistema
//
// set_config(..., is_local = true) só vale até o COMMIT/ROLLBACK — nada vaza
// entre requests do pool. As duas chamadas rodam na MESMA transação (Prisma
// interactive transaction fixa a conexão), então as queries de fn(tx) veem o
// contexto.
//
// IMPORTANTE (rollout): queries que NÃO usam estes helpers continuam
// permissivas (o GUC de usuário ausente = policy permissiva, por design, para
// compatibilidade). A adoção é incremental — ver docs/05-security-compliance/RLS.md.

import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "./session";

/** Cliente transacional do Prisma (sem importar o client em runtime). */
export type RlsTransactionClient = Prisma.TransactionClient;

/**
 * Cliente Prisma capaz de abrir transação. Em produção é o singleton `db`;
 * o parâmetro opcional existe para os testes de isolamento abrirem conexão com
 * uma role NÃO-superuser (superuser do Postgres ignora RLS por definição).
 */
export type RlsClient = Pick<PrismaClient, "$transaction">;

// Reexport dos helpers de aplicação existentes (continua single-source).
export { assertOwner, rlsWhere, withRLSWhere } from "./rls";
export type { RlsModel } from "./rls";

/**
 * Executa `fn` numa transação com o contexto RLS do usuário.
 * super_admin → bypass='on'; demais roles → user_id + bypass='off'.
 */
export async function withUserRls<T>(
  session: SessionUser,
  fn: (tx: RlsTransactionClient) => Promise<T>,
  client: RlsClient = db,
): Promise<T> {
  const bypass = session.role === "super_admin" ? "on" : "off";
  return client.$transaction(async (tx) => {
    // set_config(..., true) = transaction-local (reset no commit/rollback).
    await tx.$queryRaw`SELECT set_config('app.user_id', ${session.userId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.rls_bypass', ${bypass}, true)`;
    return fn(tx);
  });
}

/**
 * Executa `fn` numa transação com bypass de RLS (engine, jobs, rotinas
 * administrativas). NUNCA use com input de usuário sem autorização prévia.
 */
export async function withSystemRls<T>(
  fn: (tx: RlsTransactionClient) => Promise<T>,
  client: RlsClient = db,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', '', true)`;
    await tx.$queryRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    return fn(tx);
  });
}
