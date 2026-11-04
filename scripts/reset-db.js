// scripts/reset-db.js — reset DESTRUTIVO do estado de trading (manutenção).
//
// O que faz: zera positions/rounds/scam reports/logs/risk events e devolve
// TradingBalance/Reserve/Config ao estado inicial. NÃO mexe em User/Session.
//
// Uso: node scripts/reset-db.js            (requer role com BYPASSRLS/owner)
//
// RLS (rodada 8): Position é STRICT. Com o app role (NOBYPASSRLS) os deleteMany
// apagariam 0 linhas SEM erro — por isso o guard `requireBypassRls` aborta antes.
const { createMaintenanceClient } = require("./lib/prisma-client-maintenance.cjs");

async function main(db) {
  await db.position.deleteMany({});
  await db.round.deleteMany({});
  await db.scamReport.deleteMany({});
  await db.appLog.deleteMany({});
  await db.riskEvent.deleteMany({});
  await db.tradingBalance.update({
    where: { id: "singleton" },
    data: {
      balanceUsd: 1000.0,
      peakBalanceUsd: 1000.0,
      realizedPnlUsd: 0,
      tradesOpened: 0,
      tradesClosed: 0,
      wins: 0,
      losses: 0,
    },
  });
  await db.reserve.update({
    where: { id: "singleton" },
    data: { balanceUsd: 0, totalDepositedUsd: 0, totalWithdrawnUsd: 0 },
  });
  await db.config.update({
    where: { id: "singleton" },
    data: {
      paperCyclesPassed: 0,
      graduatedToLive: false,
      killSwitchActive: false,
      killSwitchReason: null,
      killSwitchAt: null,
    },
  });
  console.log("DB reset done");
}

(async () => {
  const { requireBypassRls } = await import("./lib/require-bypass-rls.mjs");
  await requireBypassRls({ context: "reset-db" });
  const db = createMaintenanceClient();
  try {
    await main(db);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
})();
