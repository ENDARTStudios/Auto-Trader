// scripts/lib/prisma-client-maintenance.cjs — PrismaClient para SCRIPTS de manutenção.
//
// O repo usa Prisma 7 com driver adapter escolhido pela URL: sqlite (file:) no dev
// legado e pg (postgresql://) no dev/prod atuais. Scripts CJS antigos criavam
// better-sqlite3 fixo e quebravam com "adapter better-sqlite3 ... not compatible
// with provider postgres". Esta factory escolhe o adapter pela URL.
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

function createMaintenanceClient(databaseUrl) {
  const url = databaseUrl || process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL ausente — scripts de manutenção nunca usam default silencioso.");
  }
  const adapter = url.startsWith("file:")
    ? new PrismaBetterSqlite3({ url })
    : new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

module.exports = { createMaintenanceClient };
