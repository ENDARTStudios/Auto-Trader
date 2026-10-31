const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { mkdirSync } = require('node:fs');
const db = new PrismaClient({ adapter: (function () { const u = process.env.DATABASE_URL ?? 'file:./db/custom.db'; const p = u.startsWith('file:') ? u.slice(5) : u; mkdirSync(require('node:path').dirname(p), { recursive: true }); return new PrismaBetterSqlite3({ url: u }); })() });
(async () => {
  const count = await db.strategicCapability.count();
  console.log(`Current count: ${count}`);
  if (count > 0 && count < 16) {
    await db.strategicCapability.deleteMany();
    console.log('Cleared partial seeds');
  }
  await db.$disconnect();
})();
