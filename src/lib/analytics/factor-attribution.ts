// Atribuição por fator (Fase D) — implementação própria, restrita ao que o
// Auto Trader já armazena. Regra: sem snapshot na janela → "sem amostra";
// amostra pequena é sinalizada, nunca preenchida com zero.

export type FactorKey = "momentum" | "trend" | "volatility" | "sentiment" | "quality";

export interface AttributionPosition {
  id: string;
  symbol: string;
  entryAt: string | Date;
  pnlPct: number | null;
  pnlUsd: number | null;
  scamScore?: number | null;
}

export interface AttributionSnapshot {
  symbol: string;
  analyzedAt: string | Date;
  rsi14?: number | null;
  macdHist?: number | null;
  ema20?: number | null;
  ema50?: number | null;
  bollPercent?: number | null;
  fearGreedClass?: string | null;
}

export interface Bucket {
  label: string;
  trades: number;
  wins: number;
  winRate: number | null;
  totalPnlUsd: number;
  avgPnlPct: number | null;
  lowSample: boolean;
}

export interface FactorAttribution {
  key: FactorKey;
  buckets: Bucket[];
  noSample: number;
  totalTrades: number;
}

export const MIN_SAMPLE = 3;
export const SNAPSHOT_WINDOW_MS = 48 * 60 * 60 * 1000;

const asDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));

/** Snapshot mais recente do símbolo, até a entrada e dentro da janela. */
export function findSnapshotFor(
  position: AttributionPosition,
  snapshots: AttributionSnapshot[]
): AttributionSnapshot | null {
  const entry = asDate(position.entryAt).getTime();
  let best: AttributionSnapshot | null = null;
  for (const s of snapshots) {
    if (s.symbol !== position.symbol) continue;
    const at = asDate(s.analyzedAt).getTime();
    if (at > entry || entry - at > SNAPSHOT_WINDOW_MS) continue;
    if (!best || at > asDate(best.analyzedAt).getTime()) best = s;
  }
  return best;
}

export function momentumBucket(rsi: number | null | undefined): string | null {
  if (rsi === null || rsi === undefined || !Number.isFinite(rsi)) return null;
  if (rsi < 30) return "Oversold";
  if (rsi > 70) return "Overbought";
  return "Neutral";
}

export function trendBucket(ema20: number | null | undefined, ema50: number | null | undefined): string | null {
  if (ema20 == null || ema50 == null || !Number.isFinite(ema20) || !Number.isFinite(ema50)) return null;
  return ema20 > ema50 ? "Above EMA50" : "Below EMA50";
}

export function volatilityBucket(bollPercent: number | null | undefined): string | null {
  if (bollPercent == null || !Number.isFinite(bollPercent)) return null;
  if (bollPercent < 0.33) return "Lower band";
  if (bollPercent > 0.66) return "Upper band";
  return "Middle band";
}

export function sentimentBucket(cls: string | null | undefined): string | null {
  if (!cls) return null;
  const normalized = cls.trim();
  if (!normalized) return null;
  return normalized;
}

export function qualityBucket(scamScore: number | null | undefined): string | null {
  if (scamScore == null || !Number.isFinite(scamScore)) return null;
  return scamScore <= 20 ? "Low scam score" : scamScore <= 50 ? "Medium" : "High scam score";
}

function bucketOf(key: FactorKey, position: AttributionPosition, snapshot: AttributionSnapshot | null): string | null {
  if (key === "quality") return qualityBucket(position.scamScore);
  if (!snapshot) return null;
  switch (key) {
    case "momentum":
      return momentumBucket(snapshot.rsi14 ?? null);
    case "trend":
      return trendBucket(snapshot.ema20 ?? null, snapshot.ema50 ?? null);
    case "volatility":
      return volatilityBucket(snapshot.bollPercent ?? null);
    case "sentiment":
      return sentimentBucket(snapshot.fearGreedClass ?? null);
  }
}

export function attribute(
  key: FactorKey,
  positions: AttributionPosition[],
  snapshots: AttributionSnapshot[]
): FactorAttribution {
  const map = new Map<string, { trades: number; wins: number; pnl: number; pctSum: number; pctCount: number }>();
  let noSample = 0;

  for (const position of positions) {
    const snapshot = findSnapshotFor(position, snapshots);
    const label = bucketOf(key, position, snapshot);
    if (!label) {
      noSample += 1;
      continue;
    }
    const entry = map.get(label) ?? { trades: 0, wins: 0, pnl: 0, pctSum: 0, pctCount: 0 };
    entry.trades += 1;
    entry.pnl += position.pnlUsd ?? 0;
    if ((position.pnlUsd ?? 0) > 0) entry.wins += 1;
    if (position.pnlPct !== null && Number.isFinite(position.pnlPct)) {
      entry.pctSum += position.pnlPct;
      entry.pctCount += 1;
    }
    map.set(label, entry);
  }

  const buckets: Bucket[] = [...map.entries()]
    .map(([label, v]) => ({
      label,
      trades: v.trades,
      wins: v.wins,
      winRate: v.trades > 0 ? (v.wins / v.trades) * 100 : null,
      totalPnlUsd: Number(v.pnl.toFixed(2)),
      avgPnlPct: v.pctCount > 0 ? Number((v.pctSum / v.pctCount).toFixed(2)) : null,
      lowSample: v.trades < MIN_SAMPLE,
    }))
    .sort((a, b) => b.trades - a.trades || b.totalPnlUsd - a.totalPnlUsd);

  return { key, buckets, noSample, totalTrades: positions.length };
}
