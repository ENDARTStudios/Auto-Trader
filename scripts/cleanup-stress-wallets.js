const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
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
