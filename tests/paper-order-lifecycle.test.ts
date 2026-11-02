import { describe, expect, it } from "vitest";
import {
  InvalidPaperTransition,
  assertFillable,
  canTransition,
  deriveLifecycle,
  isTerminal,
  nextState,
  orderKey,
} from "@/lib/trading/paper-order-lifecycle";

describe("paper order lifecycle — transições", () => {
  it("segue created → filled → settled", () => {
    expect(nextState("created", "fill")).toBe("filled");
    expect(nextState("filled", "settle")).toBe("settled");
  });

  it("permite cancelar antes de liquidar", () => {
    expect(nextState("created", "cancel")).toBe("cancelled");
    expect(nextState("filled", "cancel")).toBe("cancelled");
  });

  it("estado terminal não transiciona", () => {
    expect(isTerminal("settled")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(canTransition("settled", "settle")).toBe(false);
    expect(canTransition("cancelled", "fill")).toBe(false);
    expect(() => nextState("settled", "cancel")).toThrow(InvalidPaperTransition);
  });

  it("não aceita liquidar antes de preencher", () => {
    expect(canTransition("created", "settle")).toBe(false);
    expect(() => nextState("created", "settle")).toThrow(/invalid_transition/);
  });

  it("erro carrega origem e evento", () => {
    try {
      nextState("filled", "fill");
      throw new Error("deveria falhar");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidPaperTransition);
      const e = err as InvalidPaperTransition;
      expect(e.from).toBe("filled");
      expect(e.event).toBe("fill");
    }
  });
});

describe("paper order lifecycle — preenchimento", () => {
  it("aceita preço e quantidade positivos", () => {
    expect(() => assertFillable({ priceUsd: 208.44, qty: 1.5 })).not.toThrow();
  });

  it("recusa preço zero, negativo ou não finito", () => {
    expect(() => assertFillable({ priceUsd: 0, qty: 1 })).toThrow("invalid_fill_price");
    expect(() => assertFillable({ priceUsd: -1, qty: 1 })).toThrow("invalid_fill_price");
    expect(() => assertFillable({ priceUsd: Number.NaN, qty: 1 })).toThrow("invalid_fill_price");
  });

  it("recusa quantidade inválida", () => {
    expect(() => assertFillable({ priceUsd: 10, qty: 0 })).toThrow("invalid_fill_qty");
    expect(() => assertFillable({ priceUsd: 10, qty: Number.POSITIVE_INFINITY })).toThrow("invalid_fill_qty");
  });
});

describe("paper order lifecycle — chave e derivação", () => {
  it("chave é determinística e muda por lado", () => {
    expect(orderKey("pos-1", "buy")).toBe(orderKey("pos-1", "buy"));
    expect(orderKey("pos-1", "buy")).not.toBe(orderKey("pos-1", "sell"));
    expect(orderKey("pos-1", "buy")).toMatch(/^[a-f0-9]{24}$/);
  });

  it("posição aberta termina em filled", () => {
    const l = deriveLifecycle({ id: "p1", status: "open", entryAt: "2026-11-01T10:00:00Z" });
    expect(l.current).toBe("filled");
    expect(l.transitions.map((t) => t.state)).toEqual(["created", "filled"]);
  });

  it("posição fechada termina em settled com o motivo", () => {
    const l = deriveLifecycle({
      id: "p2",
      status: "closed",
      entryAt: "2026-11-01T10:00:00Z",
      exitAt: "2026-11-01T12:00:00Z",
      exitReason: "take_profit",
    });
    expect(l.current).toBe("settled");
    expect(l.transitions.at(-1)?.note).toContain("take_profit");
  });

  it("posição morta pelo kill switch vira cancelled", () => {
    const l = deriveLifecycle({ id: "p3", status: "killed", entryAt: "2026-11-01T10:00:00Z", exitAt: "2026-11-01T11:00:00Z" });
    expect(l.current).toBe("cancelled");
    expect(l.transitions.at(-1)?.state).toBe("cancelled");
  });
});
