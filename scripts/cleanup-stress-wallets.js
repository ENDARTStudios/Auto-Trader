const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { mkdirSync } = require('node:fs');
const p = new PrismaClient({ adapter: (function () { const u = process.env.DATABASE_URL ?? 'file:./db/custom.db'; const p = u.startsWith('file:') ? u.slice(5) : u; mkdirSync(require('node:path').dirname(p), { recursive: true }); return new PrismaBetterSqlite3({ url: u }); })() });
(async () => {
  // Delete all wallets with stress-test labels
  const labels = ['baseline-', 'lifecycle-', 'interleave-'];
  let deleted = 0;
  for (const prefix of labels) {
    const wallets = await p.walletConnection.findMany({ where: { label: { startsWith: prefix } } });
    for (const w of wallets) {
      await p.walletConnection.delete({ where: { id: w.id } });
      deleted++;
    }
  }
  console.log(`Deleted ${deleted} stress-test wallets`);
  const remaining = await p.walletConnection.count();
  console.log(`Remaining wallets: ${remaining}`);
  await p.$disconnect();
})();
