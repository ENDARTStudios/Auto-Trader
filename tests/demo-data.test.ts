import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  positionCount: vi.fn(),
  roundCount: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    round: { count: (...args: unknown[]) => mocks.roundCount(...args) },
  },
}));

vi.mock("@/lib/auth/rls-context", () => ({
  withSystemRls: (fn: (tx: unknown) => unknown) =>
    fn({ position: { count: (...args: unknown[]) => mocks.positionCount(...args) } }),
}));

import { DEMO_POSITION_PREFIX, isDemoDataPresent, isDemoPositionId } from "@/lib/demo-data";

describe("demo-data", () => {
  beforeEach(() => {
    mocks.positionCount.mockReset();
    mocks.roundCount.mockReset();
  });

  it("isDemoPositionId reconhece o prefixo do seed e rejeita ids normais", () => {
    expect(isDemoPositionId(`${DEMO_POSITION_PREFIX}open-1`)).toBe(true);
    expect(isDemoPositionId("demo-pos-closed-3")).toBe(true);
    expect(isDemoPositionId("pos-123")).toBe(false);
    expect(isDemoPositionId("")).toBe(false);
  });

  it("detecta demo por posições semeadas", async () => {
    mocks.positionCount.mockResolvedValue(3);
    mocks.roundCount.mockResolvedValue(0);
    await expect(isDemoDataPresent()).resolves.toBe(true);
    expect(mocks.positionCount).toHaveBeenCalledWith({
      where: { id: { startsWith: DEMO_POSITION_PREFIX } },
    });
  });

  it("detecta demo por rounds 9001..9005", async () => {
    mocks.positionCount.mockResolvedValue(0);
    mocks.roundCount.mockResolvedValue(2);
    await expect(isDemoDataPresent()).resolves.toBe(true);
    expect(mocks.roundCount).toHaveBeenCalledWith({
      where: { id: { gte: 9001, lte: 9005 } },
    });
  });

  it("sem dados demo retorna false", async () => {
    mocks.positionCount.mockResolvedValue(0);
    mocks.roundCount.mockResolvedValue(0);
    await expect(isDemoDataPresent()).resolves.toBe(false);
  });

  it("erro de banco não derruba (fail-open para false)", async () => {
    mocks.positionCount.mockRejectedValue(new Error("db down"));
    mocks.roundCount.mockResolvedValue(0);
    await expect(isDemoDataPresent()).resolves.toBe(false);
  });
});
