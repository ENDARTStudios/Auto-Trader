// scripts/cleanup-stress-wallets.js — remove wallets criadas por stress tests.
//
// Uso: node scripts/cleanup-stress-wallets.js   (requer role com BYPASSRLS/owner)
//
// RLS (rodada 8): WalletConnection é STRICT — com o app role (NOBYPASSRLS) o
// findMany veria 0 e o script "não encontraria nada" silenciosamente. O guard
// aborta antes para o operador saber que precisa de um role de manutenção.
const { createMaintenanceClient } = require("./lib/prisma-client-maintenance.cjs");

async function main(db) {
  const labels = ["baseline-", "lifecycle-", "interleave-"];
  let deleted = 0;
  for (const prefix of labels) {
    const wallets = await db.walletConnection.findMany({ where: { label: { startsWith: prefix } } });
    for (const w of wallets) {
      await db.walletConnection.delete({ where: { id: w.id } });
      deleted++;
    }
  }
  console.log(`Deleted ${deleted} stress-test wallets`);
  const remaining = await db.walletConnection.count();
  console.log(`Remaining wallets: ${remaining}`);
}

(async () => {
  const { requireBypassRls } = await import("./lib/require-bypass-rls.mjs");
  await requireBypassRls({ context: "cleanup-stress-wallets" });
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
