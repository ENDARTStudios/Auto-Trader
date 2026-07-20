try {
  const { PrismaClient } = require('@prisma/client');
  console.log('PrismaClient import OK');
  
  const p = new PrismaClient();
  console.log('PrismaClient instantiated OK');
  
  p.$disconnect();
  console.log('Disconnect OK');
  
  process.exit(0);
} catch (err) {
  console.error('ERROR:', err.message);
  process.exit(1);
}