import { createPrismaClient } from "@/lib/db";
import { requireBypassRls } from "./lib/require-bypass-rls.mjs";
const db = createPrismaClient();
async function main() {
  // Guard: DELETE em WalletConnection (RLS strict) exige role com bypass.
  await requireBypassRls({ context: "cleanup-wallets" });
  const all = await db.walletConnection.findMany();
  console.log("Found", all.length, "test wallets leftover");
  console.log("Labels:", all.map((w) => w.label));
  if (all.length > 0) {
    await db.walletConnection.deleteMany();
    console.log("Deleted all");
  }
  await db.$disconnect();
}
main();
