const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const wallets = await p.walletConnection.count();
  const withKeys = await p.walletConnection.count({ where: { privateKeyEncrypted: { not: null } } });
  const exchanges = await p.exchangeConnection.count();
  const withExKeys = await p.exchangeConnection.count({ where: { apiKeyEncrypted: { not: null } } });
  console.log(JSON.stringify({ wallets, withKeys, exchanges, withExKeys }, null, 2));
  await p.$disconnect();
})();
