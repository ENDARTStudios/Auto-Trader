// Reset DB to clean state for testing.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function main() {
  await db.position.deleteMany({});
  await db.round.deleteMany({});
  await db.scamReport.deleteMany({});
  await db.appLog.deleteMany({});
  await db.riskEvent.deleteMany({});
  await db.tradingBalance.update({
    where: { id: 'singleton' },
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
    where: { id: 'singleton' },
    data: { balanceUsd: 0, totalDepositedUsd: 0, totalWithdrawnUsd: 0 },
  });
  await db.config.update({
    where: { id: 'singleton' },
    data: {
      paperCyclesPassed: 0,
      graduatedToLive: false,
      killSwitchActive: false,
      killSwitchReason: null,
      killSwitchAt: null,
    },
  });
  console.log('DB reset done');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
