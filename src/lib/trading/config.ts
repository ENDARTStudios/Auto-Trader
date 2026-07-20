// Config manager — wraps Prisma Config row with typed accessors.
import { db } from "@/lib/db";

export interface EngineConfig {
  mode: "paper" | "live";
  loopIntervalSec: number;
  initialCapitalUsd: number;
  maxPositionsPerRound: number;
  capitalPctPerRound: number;
  reservePct: number;
  reinvestPct: number;
  reserveAsset: string;
  takeProfitPct: number;
  stopLossPct: number;
  maxHoldMinutes: number;
  maxDailyLossPct: number;
  maxLossPerTradePct: number;
  maxExposurePerTokenPct: number;
  maxDrawdownPct: number;
  scamScoreMin: number;
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  scanCex: boolean;
  scanDex: boolean;
  cexSymbols: string[];
  dexChains: string[];
  engineRunning: boolean;
  killSwitchActive: boolean;
  killSwitchReason: string | null;
  killSwitchAt: Date | null;
  paperCyclesRequired: number;
  paperCyclesPassed: number;
  graduatedToLive: boolean;
}

export const DEFAULT_CONFIG: EngineConfig = {
  mode: "paper",
  loopIntervalSec: 60,
  initialCapitalUsd: 1000.0,
  maxPositionsPerRound: 10,
  capitalPctPerRound: 100.0,
  reservePct: 50.0,
  reinvestPct: 50.0,
  reserveAsset: "USDC",
  takeProfitPct: 15.0,
  stopLossPct: 8.0,
  maxHoldMinutes: 180,
  maxDailyLossPct: 10.0,
  maxLossPerTradePct: 5.0,
  maxExposurePerTokenPct: 15.0,
  maxDrawdownPct: 20.0,
  scamScoreMin: 70,
  minLiquidityUsd: 100000.0,
  minVolume24hUsd: 50000.0,
  scanCex: true,
  scanDex: true,
  cexSymbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"],
  dexChains: ["base", "arbitrum", "optimism"],
  engineRunning: false,
  killSwitchActive: false,
  killSwitchReason: null,
  killSwitchAt: null,
  paperCyclesRequired: 50,
  paperCyclesPassed: 0,
  graduatedToLive: false,
};

function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export async function getConfig(): Promise<EngineConfig> {
  let row = await db.config.findUnique({ where: { id: "singleton" } });
  if (!row) {
    row = await db.config.create({ data: { id: "singleton" } });
  }
  return {
    mode: row.mode as "paper" | "live",
    loopIntervalSec: row.loopIntervalSec,
    initialCapitalUsd: row.initialCapitalUsd,
    maxPositionsPerRound: row.maxPositionsPerRound,
    capitalPctPerRound: row.capitalPctPerRound,
    reservePct: row.reservePct,
    reinvestPct: row.reinvestPct,
    reserveAsset: row.reserveAsset,
    takeProfitPct: row.takeProfitPct,
    stopLossPct: row.stopLossPct,
    maxHoldMinutes: row.maxHoldMinutes,
    maxDailyLossPct: row.maxDailyLossPct,
    maxLossPerTradePct: row.maxLossPerTradePct,
    maxExposurePerTokenPct: row.maxExposurePerTokenPct,
    maxDrawdownPct: row.maxDrawdownPct,
    scamScoreMin: row.scamScoreMin,
    minLiquidityUsd: row.minLiquidityUsd,
    minVolume24hUsd: row.minVolume24hUsd,
    scanCex: row.scanCex,
    scanDex: row.scanDex,
    cexSymbols: parseJsonArray(row.cexSymbols),
    dexChains: parseJsonArray(row.dexChains),
    engineRunning: row.engineRunning,
    killSwitchActive: row.killSwitchActive,
    killSwitchReason: row.killSwitchReason,
    killSwitchAt: row.killSwitchAt,
    paperCyclesRequired: row.paperCyclesRequired,
    paperCyclesPassed: row.paperCyclesPassed,
    graduatedToLive: row.graduatedToLive,
  };
}

export async function updateConfig(
  patch: Partial<EngineConfig>
): Promise<EngineConfig> {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === "cexSymbols" || k === "dexChains") {
      data[k] = JSON.stringify(v);
    } else {
      data[k] = v;
    }
  }
  await db.config.update({ where: { id: "singleton" }, data });
  return getConfig();
}

export async function setKillSwitch(active: boolean, reason: string | null) {
  await db.config.update({
    where: { id: "singleton" },
    data: {
      killSwitchActive: active,
      killSwitchReason: reason,
      killSwitchAt: active ? new Date() : null,
      engineRunning: active ? false : undefined,
    },
  });
}

export async function setEngineRunning(running: boolean) {
  await db.config.update({
    where: { id: "singleton" },
    data: { engineRunning: running },
  });
}
