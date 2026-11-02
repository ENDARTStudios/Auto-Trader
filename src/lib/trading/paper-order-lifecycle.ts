// Ciclo de vida explícito de uma ordem em paper (Fase B do roadmap de
// sistemas externos). Implementação própria, sem código de terceiros.
//
// Estados: created → filled → settled | cancelled
// Invariantes:
//  - estado terminal não transiciona
//  - cancelar só antes de liquidar
//  - preço/quantidade precisam ser positivos para "filled"
//  - a chave de idempotência é determinística (replay não duplica ordem)

import { createHash } from "crypto";

export type PaperOrderState = "created" | "filled" | "settled" | "cancelled";

export type PaperOrderEvent = "fill" | "settle" | "cancel";

const TRANSITIONS: Record<PaperOrderState, Partial<Record<PaperOrderEvent, PaperOrderState>>> = {
  created: { fill: "filled", cancel: "cancelled" },
  filled: { settle: "settled", cancel: "cancelled" },
  settled: {},
  cancelled: {},
};

export const TERMINAL_STATES: PaperOrderState[] = ["settled", "cancelled"];

export class InvalidPaperTransition extends Error {
  constructor(
    readonly from: PaperOrderState,
    readonly event: PaperOrderEvent
  ) {
    super(`invalid_transition: ${from} -/-> ${event}`);
    this.name = "InvalidPaperTransition";
  }
}

export function isTerminal(state: PaperOrderState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function nextState(current: PaperOrderState, event: PaperOrderEvent): PaperOrderState {
  const next = TRANSITIONS[current][event];
  if (!next) throw new InvalidPaperTransition(current, event);
  return next;
}

export function canTransition(current: PaperOrderState, event: PaperOrderEvent): boolean {
  return Boolean(TRANSITIONS[current][event]);
}

export interface FillInput {
  priceUsd: number;
  qty: number;
}

/** Uma ordem só pode ser preenchida com preço e quantidade positivos e finitos. */
export function assertFillable(input: FillInput): void {
  if (!Number.isFinite(input.priceUsd) || input.priceUsd <= 0) {
    throw new Error("invalid_fill_price");
  }
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    throw new Error("invalid_fill_qty");
  }
}

/** Chave determinística por posição+lado: o mesmo replay gera a mesma chave. */
export function orderKey(positionId: string, side: "buy" | "sell"): string {
  return createHash("sha256").update(`${positionId}:${side}`).digest("hex").slice(0, 24);
}

export interface LifecycleTransition {
  state: PaperOrderState;
  at: string;
  note: string;
}

export interface PositionLike {
  id: string;
  status: string;
  entryAt: string | Date;
  exitAt?: string | Date | null;
  exitReason?: string | null;
}

export interface Lifecycle {
  key: string;
  current: PaperOrderState;
  transitions: LifecycleTransition[];
}

/**
 * Deriva o ciclo de vida a partir da posição persistida — sem inventar etapas:
 * a ordem nasce "created" no entryAt, vira "filled" no mesmo instante (paper
 * executa à vista) e termina em "settled" (saída normal) ou "cancelled"
 * (kill switch / posição morta antes de liquidar).
 */
export function deriveLifecycle(position: PositionLike): Lifecycle {
  const at = (v: string | Date) => new Date(v).toISOString();
  const transitions: LifecycleTransition[] = [
    { state: "created", at: at(position.entryAt), note: "ordem criada pelo engine" },
    { state: "filled", at: at(position.entryAt), note: "executada em paper no preço de entrada" },
  ];

  if (position.status === "killed") {
    transitions.push({ state: "cancelled", at: at(position.exitAt ?? position.entryAt), note: "kill switch / encerrada sem liquidação" });
    return { key: orderKey(position.id, "buy"), current: "cancelled", transitions };
  }

  if (position.exitAt) {
    transitions.push({
      state: "settled",
      at: at(position.exitAt),
      note: position.exitReason ? `saída: ${position.exitReason}` : "posição liquidada",
    });
    return { key: orderKey(position.id, "buy"), current: "settled", transitions };
  }

  return { key: orderKey(position.id, "buy"), current: "filled", transitions };
}
