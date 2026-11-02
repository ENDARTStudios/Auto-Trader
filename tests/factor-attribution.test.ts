import { describe, expect, it } from "vitest";
import {
  attribute,
  findSnapshotFor,
  momentumBucket,
  qualityBucket,
  sentimentBucket,
  trendBucket,
  volatilityBucket,
} from "@/lib/analytics/factor-attribution";

const snap = (symbol: string, analyzedAt: string, extra: Partial<Parameters<typeof trendBucket>[0] extends never ? never : Record<string, unknown>> = {}) => ({
  symbol,
  analyzedAt,
  rsi14: 50,
  ema20: 100,
  ema50: 90,
  bollPercent: 0.5,
  fearGreedClass: "Neutral",
  ...extra,
});

describe("buckets", () => {
  it("momentum separa oversold/neutral/overbought e ignora ausente", () => {
    expect(momentumBucket(25)).toBe("Oversold");
    expect(momentumBucket(50)).toBe("Neutral");
    expect(momentumBucket(75)).toBe("Overbought");
    expect(momentumBucket(null)).toBeNull();
  });

  it("trend compara EMA20 com EMA50", () => {
    expect(trendBucket(100, 90)).toBe("Above EMA50");
    expect(trendBucket(90, 100)).toBe("Below EMA50");
    expect(trendBucket(null, 100)).toBeNull();
  });

  it("volatilidade usa bandas de Bollinger", () => {
    expect(volatilityBucket(0.1)).toBe("Lower band");
    expect(volatilityBucket(0.5)).toBe("Middle band");
    expect(volatilityBucket(0.9)).toBe("Upper band");
  });

  it("sentimento e qualidade exigem dado real", () => {
    expect(sentimentBucket("Greed")).toBe("Greed");
    expect(sentimentBucket(null)).toBeNull();
    expect(qualityBucket(10)).toBe("Low scam score");
    expect(qualityBucket(40)).toBe("Medium");
    expect(qualityBucket(80)).toBe("High scam score");
    expect(qualityBucket(null)).toBeNull();
  });
});

describe("findSnapshotFor", () => {
  const position = { id: "p1", symbol: "SOLUSDT", entryAt: "2026-11-01T12:00:00Z", pnlPct: 1, pnlUsd: 1 };

  it("escolhe o snapshot mais recente antes da entrada", () => {
    const found = findSnapshotFor(position, [
      snap("SOLUSDT", "2026-11-01T10:00:00Z"),
      snap("SOLUSDT", "2026-11-01T11:00:00Z"),
      snap("SOLUSDT", "2026-11-01T13:00:00Z"),
    ]);
    expect(found?.analyzedAt).toBe("2026-11-01T11:00:00Z");
  });

  it("ignora snapshot de outro símbolo", () => {
    expect(findSnapshotFor(position, [snap("BTCUSDT", "2026-11-01T11:00:00Z")])).toBeNull();
  });

  it("ignora snapshot fora da janela de 48h", () => {
    expect(findSnapshotFor(position, [snap("SOLUSDT", "2026-10-28T11:00:00Z")])).toBeNull();
  });
});

describe("attribute", () => {
  const positions = [
    { id: "1", symbol: "SOLUSDT", entryAt: "2026-11-01T12:00:00Z", pnlPct: 8, pnlUsd: 80, scamScore: 10 },
    { id: "2", symbol: "BTCUSDT", entryAt: "2026-11-01T12:00:00Z", pnlPct: -2, pnlUsd: -20, scamScore: 45 },
    { id: "3", symbol: "ETHUSDT", entryAt: "2026-11-01T12:00:00Z", pnlPct: 3, pnlUsd: 30, scamScore: 10 },
  ];
  const snapshots = [
    snap("SOLUSDT", "2026-11-01T11:00:00Z", { rsi14: 25, ema20: 100, ema50: 90 }),
    snap("BTCUSDT", "2026-11-01T11:00:00Z", { rsi14: 75, ema20: 90, ema50: 100 }),
    // ETHUSDT sem snapshot -> sem amostra
  ];

  it("agrega por bucket de momentum e conta sem amostra", () => {
    const result = attribute("momentum", positions, snapshots);
    expect(result.totalTrades).toBe(3);
    expect(result.noSample).toBe(1);
    const oversold = result.buckets.find((b) => b.label === "Oversold");
    expect(oversold?.trades).toBe(1);
    expect(oversold?.winRate).toBe(100);
    const overbought = result.buckets.find((b) => b.label === "Overbought");
    expect(overbought?.totalPnlUsd).toBe(-20);
  });

  it("marca amostra baixa (menos de 3 trades)", () => {
    const result = attribute("momentum", positions, snapshots);
    expect(result.buckets.every((b) => b.lowSample)).toBe(true);
  });

  it("qualidade não depende de snapshot", () => {
    const result = attribute("quality", positions, []);
    expect(result.noSample).toBe(0);
    const low = result.buckets.find((b) => b.label === "Low scam score");
    expect(low?.trades).toBe(2);
    expect(low?.winRate).toBe(100);
  });

  it("sem posições devolve lista vazia", () => {
    const result = attribute("trend", [], []);
    expect(result.buckets).toHaveLength(0);
    expect(result.totalTrades).toBe(0);
  });
});
