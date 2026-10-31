import { createPrismaClient } from '@/lib/db';

async function main() {
  console.log('Testing PrismaClient import...');
  const prisma = createPrismaClient();
  console.log('PrismaClient instantiated successfully');
  await prisma.$disconnect();
  console.log('Connection closed. All OK!');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});