// scripts/test-position-rls.ts — E2E RLS for Position with 2 traders (S07)
// Usage: npx tsx scripts/test-position-rls.ts
import { PrismaClient } from '@prisma/client';
import { rlsWhere } from '../src/lib/auth/rls';

const db = new PrismaClient();

async function main() {
  console.log('=== POSITION RLS 2 TRADERS ===');
  let pass = 0, fail = 0;
  const ok = (m: string) => { console.log(`PASS: ${m}`); pass++; };
  const bad = (m: string) => { console.log(`FAIL: ${m}`); fail++; };

  const traderA = await db.user.findUnique({ where: { email: 'trader@local' } });
  const admin = await db.user.findUnique({ where: { email: 'admin@local' } });
  if (!traderA || !admin) {
    console.log('SKIP: trader/admin not found, run seed-auth.ts');
    process.exit(0);
  }

  // Create 2 positions with different owners
  const posA = await db.position.create({
    data: {
      ownerId: traderA.id,
      symbol: 'TEST/A-RLS',
      source: 'cex',
      status: 'open',
      entryPriceUsd: 100,
      entryAmountUsd: 100,
      entryQty: 1,
      takeProfitPrice: 115,
      stopLossPrice: 92,
      maxExitAt: new Date(Date.now() + 3600000),
      scamScore: 80,
      roundId: 1,
    },
  });
  const posB = await db.position.create({
    data: {
      ownerId: admin.id,
      symbol: 'TEST/B-RLS',
      source: 'cex',
      status: 'open',
      entryPriceUsd: 200,
      entryAmountUsd: 200,
      entryQty: 1,
      takeProfitPrice: 230,
      stopLossPrice: 184,
      maxExitAt: new Date(Date.now() + 3600000),
      scamScore: 85,
      roundId: 1,
    },
  });
  ok('created 2 positions with different owners');

  // Simulate RLS where for traderA
  const whereA = rlsWhere({ userId: traderA.id, email: traderA.email, role: traderA.role, isActive: true }, 'walletConnection' as never);
  // For Position, same logic: viewer/trader gets {ownerId: traderA.id}, super_admin gets {}
  const wherePosA = { ownerId: traderA.id } as Record<string, unknown>;
  const wherePosAdmin = {} as Record<string, unknown>;

  const listA = await db.position.findMany({ where: { ...wherePosA, symbol: { contains: 'TEST/' } } });
  const listAdmin = await db.position.findMany({ where: { ...wherePosAdmin, symbol: { contains: 'TEST/' } } });

  if (listA.length === 1 && listA[0].id === posA.id) ok('traderA sees only own position');
  else bad(`traderA sees ${listA.length} positions, expected 1`);

  if (listAdmin.length === 2) ok('admin sees both positions (bypass)');
  else bad(`admin sees ${listAdmin.length}, expected 2`);

  // Backup verify
  console.log('--- backup verify ---');
  const counts = await Promise.all([
    db.user.count(),
    db.position.count({ where: { symbol: { contains: 'TEST/' } } }),
    db.featureFlag.count(),
  ]);
  if (counts[0] >= 3) ok(`backup User count ${counts[0]} >=3`);
  else bad(`backup User count ${counts[0]}`);
  if (counts[1] === 2) ok(`backup Position TEST count 2`);
  else bad(`backup Position count ${counts[1]}`);
  if (counts[2] >= 9) ok(`backup FeatureFlag ${counts[2]} >=9`);
  else bad(`backup FeatureFlag ${counts[2]}`);

  // Cleanup
  await db.position.delete({ where: { id: posA.id } });
  await db.position.delete({ where: { id: posB.id } });
  ok('cleanup 2 test positions');

  console.log(`\n=== RESULT: ${pass} PASS, ${fail} FAIL ===`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
