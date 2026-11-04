// scripts/seed-demo.ts — dados de demonstração versionados e idempotentes.
//
// Uso:
//   npx tsx scripts/seed-demo.ts          # cria/atualiza
//   npx tsx scripts/seed-demo.ts --clean  # remove os registros demo
//
// IDs fixos (prefixos/faixas) tornam o seed repetível sem duplicar nada:
//   posições  demo-pos-*      ordens  demo-order-*
//   market    7001..7010      curva   8001..8030
//   rounds    9001..9005      logs    6001..6006
//
// Requer o usuário admin@local (scripts/seed-auth.ts) e um DATABASE_URL válido.

import "dotenv/config";
import { createPrismaClient } from "@/lib/db";
import { orderKey } from "../src/lib/trading/paper-order-lifecycle";
import { requireBypassRls } from "./lib/require-bypass-rls.mjs";

const db = createPrismaClient();
const clean = process.argv.includes("--clean");

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();

const OPEN = [
  { symbol: "SOLUSDT", entry: 196.2, amount: 1500, qty: 7.64, daysAgo: 1 },
  { symbol: "BTCUSDT", entry: 94180, amount: 1200, qty: 0.0127, daysAgo: 2 },
  { symbol: "ETHUSDT", entry: 3418.72, amount: 900, qty: 0.263, daysAgo: 3 },
];

const CLOSED = [
  { symbol: "SOLUSDT", entry: 180.4, exit: 196.2, amount: 1200, qty: 6.65, pnlPct: 8.76, daysAgo: 6, reason: "take_profit", scam: 8, rsi: 27, trendUp: true, boll: 0.2 },
  { symbol: "BTCUSDT", entry: 96420, exit: 94010, amount: 1500, qty: 0.0156, pnlPct: -2.5, daysAgo: 9, reason: "stop_loss", scam: 12, rsi: 74, trendUp: false, boll: 0.82 },
  { symbol: "ETHUSDT", entry: 3300, exit: 3438, amount: 1000, qty: 0.303, pnlPct: 4.18, daysAgo: 12, reason: "take_profit", scam: 15, rsi: 55, trendUp: true, boll: 0.55 },
  { symbol: "TIAUSDT", entry: 5.6, exit: 5.32, amount: 800, qty: 142.8, pnlPct: -5.0, daysAgo: 15, reason: "stop_loss", scam: 42, rsi: 68, trendUp: false, boll: 0.78 },
  { symbol: "ARBUSDT", entry: 0.92, exit: 0.978, amount: 700, qty: 760.9, pnlPct: 6.3, daysAgo: 18, reason: "take_profit", scam: 20, rsi: 44, trendUp: true, boll: 0.48 },
  { symbol: "BNBUSDT", entry: 655, exit: 662.9, amount: 600, qty: 0.916, pnlPct: 1.2, daysAgo: 21, reason: "timeout", scam: 10, rsi: 51, trendUp: true, boll: 0.6 },
];

async function main() {
  // Guard: o seed escreve/limpa Position (RLS strict); com app role veria 0 linhas
  // e "funcionaria" pela metade. Exige role com bypass (owner/operação).
  await requireBypassRls({ context: "seed-demo" });
  const admin = await db.user.findUnique({ where: { email: "admin@local" } });
  if (!admin) {
    throw new Error("admin@local não existe — rode `npx tsx scripts/seed-auth.ts` primeiro.");
  }

  if (clean) {
    const removed = await Promise.all([
      db.paperOrder.deleteMany({ where: { positionId: { startsWith: "demo-pos-" } } }),
      db.position.deleteMany({ where: { id: { startsWith: "demo-pos-" } } }),
      db.marketSnapshot.deleteMany({ where: { id: { gte: 7001, lte: 7010 } } }),
      db.performanceSnapshot.deleteMany({ where: { id: { gte: 8001, lte: 8030 } } }),
      db.round.deleteMany({ where: { id: { gte: 9001, lte: 9005 } } }),
      db.appLog.deleteMany({ where: { id: { gte: 6001, lte: 6006 } } }),
    ]);
    console.log("demo removido:", removed.map((r) => r.count).join(", "));
    return;
  }

  await db.config.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", mode: "paper", engineRunning: false, killSwitchActive: false },
    update: {},
  });

  await db.tradingBalance.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", balanceUsd: 3601.39, peakBalanceUsd: 11018.8 },
    update: { balanceUsd: 3601.39 },
  });
  await db.reserve.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", balanceUsd: 420 },
    update: { balanceUsd: 420 },
  });

  // --- posições -----------------------------------------------------------
  for (const [i, p] of OPEN.entries()) {
    const id = `demo-pos-open-${i + 1}`;
    await db.position.upsert({
      where: { id },
      create: {
        id,
        ownerId: admin.id,
        symbol: p.symbol,
        source: "cex",
        chain: "bsc",
        status: "open",
        entryPriceUsd: p.entry,
        entryAmountUsd: p.amount,
        entryQty: p.qty,
        entryAt: new Date(now.getTime() - p.daysAgo * DAY),
        maxExitAt: new Date(now.getTime() + 2 * DAY),
        takeProfitPrice: p.entry * 1.15,
        stopLossPrice: p.entry * 0.95,
        scamScore: 10,
        strategy: "day",
        roundId: 9001,
      },
      update: {},
    });
  }

  // ordens persistidas das posições abertas (estado filled)
  for (const [i, p] of OPEN.entries()) {
    const id = `demo-pos-open-${i + 1}`;
    const key = orderKey(id, "buy");
    const at = new Date(now.getTime() - p.daysAgo * DAY).toISOString();
    await db.paperOrder.upsert({
      where: { key },
      create: {
        key,
        positionId: id,
        symbol: p.symbol,
        side: "buy",
        state: "filled",
        priceUsd: p.entry,
        qty: p.qty,
        amountUsd: p.amount,
        transitions: JSON.stringify([
          { state: "created", at, note: "ordem criada pelo engine" },
          { state: "filled", at, note: "executada em paper no preço de entrada" },
        ]),
      },
      update: {},
    });
  }

  for (const [i, p] of CLOSED.entries()) {
    const id = `demo-pos-closed-${i + 1}`;
    const exitAt = new Date(now.getTime() - p.daysAgo * DAY);
    const entryAt = new Date(exitAt.getTime() - 6 * 60 * 60 * 1000);
    await db.position.upsert({
      where: { id },
      create: {
        id,
        ownerId: admin.id,
        symbol: p.symbol,
        source: "cex",
        chain: "bsc",
        status: p.pnlPct < 0 ? "liquidated" : "closed",
        entryPriceUsd: p.entry,
        entryAmountUsd: p.amount,
        entryQty: p.qty,
        entryAt,
        exitPriceUsd: p.exit,
        exitAmountUsd: p.amount * (1 + p.pnlPct / 100),
        exitAt,
        exitReason: p.reason,
        pnlUsd: p.amount * (p.pnlPct / 100),
        pnlPct: p.pnlPct,
        takeProfitPrice: p.entry * 1.15,
        stopLossPrice: p.entry * 0.95,
        maxExitAt: new Date(entryAt.getTime() + 2 * DAY),
        scamScore: p.scam,
        strategy: "day",
        roundId: 9002 + i,
      },
      update: { pnlPct: p.pnlPct },
    });

    // ordem persistida correspondente
    const key = orderKey(id, "buy");
    const at = exitAt.toISOString();
    await db.paperOrder.upsert({
      where: { key },
      create: {
        key,
        positionId: id,
        symbol: p.symbol,
        side: "buy",
        state: "settled",
        priceUsd: p.entry,
        qty: p.qty,
        amountUsd: p.amount,
        transitions: JSON.stringify([
          { state: "created", at: entryAt.toISOString(), note: "ordem criada pelo engine" },
          { state: "filled", at: entryAt.toISOString(), note: "executada em paper no preço de entrada" },
          { state: "settled", at, note: "saída: " + p.reason },
        ]),
      },
      update: {},
    });
  }

  // --- snapshots de mercado (7001..7010) ---------------------------------
  for (const [i, p] of CLOSED.entries()) {
    const id = 7001 + i;
    const analyzedAt = new Date(new Date(now.getTime() - p.daysAgo * DAY).getTime() - 7 * 60 * 60 * 1000);
    await db.marketSnapshot.upsert({
      where: { id },
      create: {
        id,
        symbol: p.symbol,
        source: "cex",
        chain: "bsc",
        priceUsd: p.entry,
        rsi14: p.rsi,
        macdHist: p.pnlPct > 0 ? 0.2 : -0.15,
        ema20: p.trendUp ? p.entry * 1.02 : p.entry * 0.98,
        ema50: p.entry,
        bollPercent: p.boll,
        fearGreedIndex: 55,
        fearGreedClass: p.rsi > 65 ? "Greed" : p.rsi < 35 ? "Fear" : "Neutral",
        trendingRank: i + 1,
        signalScore: Math.round(50 + p.pnlPct),
        signalLabel: p.pnlPct > 0 ? "buy" : "neutral",
        analyzedAt,
      },
      update: {},
    });
  }

  // --- curva de equity (8001..8030) --------------------------------------
  const base = 10045.02;
  for (let d = 0; d < 30; d++) {
    const id = 8001 + d;
    const equity = base + (d / 29) * 973.78 + Math.sin(d / 3) * 40;
    await db.performanceSnapshot.upsert({
      where: { id },
      create: {
        id,
        timestamp: new Date(now.getTime() - (29 - d) * DAY),
        tradingBalanceUsd: equity * 0.7,
        reserveBalanceUsd: equity * 0.3,
        peakBalanceUsd: equity,
        realizedPnlUsd: equity - base,
        unrealizedPnlUsd: 0,
        totalEquityUsd: Number(equity.toFixed(2)),
        openPositionsCount: 0,
        drawdownPct: 0,
      },
      update: { totalEquityUsd: Number(equity.toFixed(2)) },
    });
  }

  // --- rounds (9001..9005) ------------------------------------------------
  for (let r = 0; r < 5; r++) {
    const id = 9001 + r;
    await db.round.upsert({
      where: { id },
      create: {
        id,
        startedAt: new Date(now.getTime() - (r + 1) * 60 * 60 * 1000),
        endedAt: new Date(now.getTime() - r * 60 * 60 * 1000),
        tradingBalanceUsd: 3601.39,
        reserveBalanceUsd: 420,
        tokensScanned: 8,
        tokensPassedFilter: 3,
        tokensRejectedScam: 2,
        positionsOpened: 1,
        positionsClosed: r % 2,
        roundPnlUsd: r === 0 ? 525.4 : r === 1 ? 412.6 : r === 2 ? -69.4 : 0,
      },
      update: {},
    });
  }

  // --- eventos de atividade (6001..6006) ---------------------------------
  const events = [
    { level: "info", source: "engine", message: "Round concluído: 8 pares analisados" },
    { level: "info", source: "portfolio", message: "SOLUSDT aberta em paper a $196.20" },
    { level: "warn", source: "risk", message: "Exposição acima do piso de caixa — tamanho reduzido" },
    { level: "info", source: "engine", message: "Scout selecionou 3 candidatos" },
    { level: "error", source: "risk", message: "Kill switch testado e limpo" },
    { level: "info", source: "portfolio", message: "BTCUSDT fechada em take profit" },
  ];
  for (const [i, e] of events.entries()) {
    await db.appLog.upsert({
      where: { id: 6001 + i },
      create: { id: 6001 + i, ...e, context: JSON.stringify({ demo: true }), createdAt: new Date(now.getTime() - (i + 1) * 45 * 60 * 1000) },
      update: { message: e.message },
    });
  }

  const counts = {
    positions: await db.position.count({ where: { id: { startsWith: "demo-pos-" } } }),
    orders: await db.paperOrder.count({ where: { positionId: { startsWith: "demo-pos-" } } }),
    market: await db.marketSnapshot.count({ where: { id: { gte: 7001, lte: 7010 } } }),
    curve: await db.performanceSnapshot.count({ where: { id: { gte: 8001, lte: 8030 } } }),
    rounds: await db.round.count({ where: { id: { gte: 9001, lte: 9005 } } }),
    logs: await db.appLog.count({ where: { id: { gte: 6001, lte: 6006 } } }),
  };
  console.log("demo semeado:", counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
