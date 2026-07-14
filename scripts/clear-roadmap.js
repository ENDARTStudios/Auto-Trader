const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const count = await db.strategicCapability.count();
  console.log(`Current count: ${count}`);
  if (count > 0 && count < 16) {
    await db.strategicCapability.deleteMany();
    console.log('Cleared partial seeds');
  }
  await db.$disconnect();
})();
