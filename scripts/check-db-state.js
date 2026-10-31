const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { mkdirSync } = require('node:fs');
const p = new PrismaClient({ adapter: (function () { const u = process.env.DATABASE_URL ?? 'file:./db/custom.db'; const p = u.startsWith('file:') ? u.slice(5) : u; mkdirSync(require('node:path').dirname(p), { recursive: true }); return new PrismaBetterSqlite3({ url: u }); })() });
(async () => {
  const wallets = await p.walletConnection.count();
  const withKeys = await p.walletConnection.count({ where: { privateKeyEncrypted: { not: null } } });
  const exchanges = await p.exchangeConnection.count();
  const withExKeys = await p.exchangeConnection.count({ where: { apiKeyEncrypted: { not: null } } });
  console.log(JSON.stringify({ wallets, withKeys, exchanges, withExKeys }, null, 2));
  await p.$disconnect();
})();
