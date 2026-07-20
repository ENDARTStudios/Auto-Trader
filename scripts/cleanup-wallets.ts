import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
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
