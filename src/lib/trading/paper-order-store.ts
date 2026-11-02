import { db } from "@/lib/db";
import { logger } from "./logger";
import {
  type LifecycleTransition,
  type PaperOrderEvent,
  type PaperOrderState,
  nextState,
  orderKey,
} from "./paper-order-lifecycle";

// Persistência do ciclo de vida de ordens em paper (Fase B).
// O estado vive na tabela PaperOrder; `deriveLifecycle` continua existindo como
// fallback para posições antigas que nunca passaram por aqui.

export interface RecordOrderInput {
  positionId: string;
  symbol: string;
  side?: "buy" | "sell";
  priceUsd: number;
  qty: number;
  amountUsd: number;
}

function parseTransitions(raw: string): LifecycleTransition[] {
  try {
    const parsed = JSON.parse(raw) as LifecycleTransition[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Cria a ordem já preenchida (paper executa à vista), idempotente pela chave. */
export async function recordPaperOrder(input: RecordOrderInput): Promise<void> {
  const key = orderKey(input.positionId, input.side ?? "buy");
  const now = new Date().toISOString();
  const transitions: LifecycleTransition[] = [
    { state: "created", at: now, note: "ordem criada pelo engine" },
    { state: "filled", at: now, note: "executada em paper no preço de entrada" },
  ];

  try {
    await db.paperOrder.upsert({
      where: { key },
      create: {
        key,
        positionId: input.positionId,
        symbol: input.symbol,
        side: input.side ?? "buy",
        state: "filled",
        priceUsd: input.priceUsd,
        qty: input.qty,
        amountUsd: input.amountUsd,
        transitions: JSON.stringify(transitions),
      },
      update: {},
    });
  } catch (err) {
    // Nunca quebrar o fluxo de execução por causa de bookkeeping.
    logger.warn("portfolio", "recordPaperOrder falhou", { message: (err as Error).message });
  }
}

/** Aplica settle/cancel na ordem ligada à posição, validando a transição. */
export async function transitionPaperOrder(positionId: string, event: PaperOrderEvent, note: string): Promise<boolean> {
  try {
    const order = await db.paperOrder.findFirst({ where: { positionId }, orderBy: { createdAt: "desc" } });
    if (!order) return false;

    const current = order.state as PaperOrderState;
    const next = nextState(current, event);

    const transitions = parseTransitions(order.transitions);
    transitions.push({ state: next, at: new Date().toISOString(), note });

    await db.paperOrder.update({
      where: { id: order.id },
      data: { state: next, transitions: JSON.stringify(transitions) },
    });
    return true;
  } catch (err) {
    logger.warn("portfolio", "transitionPaperOrder falhou", { message: (err as Error).message });
    return false;
  }
}

export async function getPaperOrderByPosition(positionId: string) {
  const order = await db.paperOrder.findFirst({ where: { positionId }, orderBy: { createdAt: "desc" } });
  if (!order) return null;
  return { ...order, transitions: parseTransitions(order.transitions) };
}

export async function listPaperOrders(limit = 20) {
  const rows = await db.paperOrder.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(limit, 100) });
  return rows.map((r) => ({ ...r, transitions: parseTransitions(r.transitions) }));
}
