// scripts/seed-auth.ts — Seed admin@local + viewer@local
import { PrismaClient } from '@prisma/client';
import { hashPasswordSync } from '../src/lib/auth/password';

const db = new PrismaClient();

async function main() {
  const adminHash = hashPasswordSync('Admin123!');
  const viewerHash = hashPasswordSync('Viewer123!');

  const admin = await db.user.upsert({
    where: { email: 'admin@local' },
    create: { email: 'admin@local', passwordHash: adminHash, role: 'super_admin', isActive: true },
    update: { passwordHash: adminHash, role: 'super_admin', isActive: true },
  });
  console.log(`admin: ${admin.email} (${admin.role}) id=${admin.id}`);

  const viewer = await db.user.upsert({
    where: { email: 'viewer@local' },
    create: { email: 'viewer@local', passwordHash: viewerHash, role: 'viewer', isActive: true },
    update: { passwordHash: viewerHash, role: 'viewer', isActive: true },
  });
  console.log(`viewer: ${viewer.email} (${viewer.role}) id=${viewer.id}`);

  // Backfill ownerId for existing RLS rows where null -> assign to admin
  const wc = await db.walletConnection.updateMany({ where: { ownerId: null }, data: { ownerId: admin.id } });
  console.log(`backfill WalletConnection ownerId: ${wc.count}`);
  const ec = await db.exchangeConnection.updateMany({ where: { ownerId: null }, data: { ownerId: admin.id } });
  console.log(`backfill ExchangeConnection ownerId: ${ec.count}`);
  const nc = await db.notificationChannel.updateMany({ where: { ownerId: null }, data: { ownerId: admin.id } });
  console.log(`backfill NotificationChannel ownerId: ${nc.count}`);

  console.log('seed-auth done');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
