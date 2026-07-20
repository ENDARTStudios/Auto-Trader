import { PrismaClient } from '@prisma/client';

async function main() {
  console.log('Testing PrismaClient import...');
  const prisma = new PrismaClient();
  console.log('PrismaClient instantiated successfully');
  await prisma.$disconnect();
  console.log('Connection closed. All OK!');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});