// src/lib/demo-data.ts — detecta dados de demonstração semeados por scripts/seed-demo.ts.
//
// O seed cria posições com id "demo-pos-*" (abertas e fechadas), rounds 9001..9005,
// market snapshots 7001..7010 e performance snapshots 8001..8030. A UI usa este
// detector para rotular o dashboard como "Demo data" em vez de apresentar números
// fabricados como se fossem operação real (achado da auditoria de 2026-11-03).
import { db } from "@/lib/db";
import { withSystemRls } from "@/lib/auth/rls-context";

export const DEMO_POSITION_PREFIX = "demo-pos-";
export const DEMO_ROUND_ID_MIN = 9001;
export const DEMO_ROUND_ID_MAX = 9005;

/** Verdadeiro se o id é de uma posição semeada pelo seed-demo (puro, testável). */
export function isDemoPositionId(id: string): boolean {
  return typeof id === "string" && id.startsWith(DEMO_POSITION_PREFIX);
}

/**
 * Verdadeiro se o banco contém dados de demonstração. Lê Position com contexto
 * de sistema (RLS strict) e Round (sem RLS). Fail-open para "false" em erro de
 * banco — o pior caso é apenas não exibir o selo.
 */
export async function isDemoDataPresent(): Promise<boolean> {
  try {
    const [positions, rounds] = await Promise.all([
      withSystemRls((tx) =>
        tx.position.count({ where: { id: { startsWith: DEMO_POSITION_PREFIX } } })
      ),
      db.round.count({
        where: { id: { gte: DEMO_ROUND_ID_MIN, lte: DEMO_ROUND_ID_MAX } },
      }),
    ]);
    return positions > 0 || rounds > 0;
  } catch {
    return false;
  }
}
