const fs = require('fs');
const path = require('path');
const outPath = path.join(process.cwd(), 'verify-result.txt');
const lines = [];

function log(msg) {
  lines.push(msg);
  console.log(msg);
}

async function main() {
  try {
    log('CWD: ' + process.cwd());
    log('Testing PrismaClient import...');
    const { PrismaClient } = require('@prisma/client');
    log('PrismaClient import OK');
    
    const prisma = new PrismaClient({
      datasources: { db: { url: 'file:./prisma/dev.db' } }
    });
    log('PrismaClient instantiated successfully');
    
    await prisma.$disconnect();
    log('Connection closed. All OK!');
    
    lines.push('RESULT: SUCCESS');
  } catch (err) {
    log('ERROR: ' + err.message);
    if (err.stack) log(err.stack);
    lines.push('RESULT: FAILED');
  }
  
  log('Writing output to: ' + outPath);
  try {
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    log('Output written successfully');
  } catch (writeErr) {
    log('Failed to write output: ' + writeErr.message);
  }
}

main();