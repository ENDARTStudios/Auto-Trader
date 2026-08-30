import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { assertOwner } from '@/lib/auth/rls';

const db = new PrismaClient();

describe('Position RLS E2E (Direct DB)', () => {
  let admin: { id: string; email: string; role: string };
  let traderA: { id: string; email: string; role: string };
  let traderB: { id: string; email: string; role: string };
  let posA: { id: string; symbol: string };
  let posB: { id: string; symbol: string };

  beforeAll(async () => {
    // Clean up
    await db.position.deleteMany({ where: { symbol: { startsWith: 'E2E-RLS-' } } });
    await db.user.deleteMany({ where: { email: { in: ['e2e-admin@local', 'e2e-traderA@local', 'e2e-traderB@local'] } } });

    const fakeHash = '$2b$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTU';
    admin = (await db.user.create({ data: { email: 'e2e-admin@local', passwordHash: fakeHash, role: 'super_admin', isActive: true } })) as typeof admin;
    traderA = (await db.user.create({ data: { email: 'e2e-traderA@local', passwordHash: fakeHash, role: 'trader', isActive: true } })) as typeof traderA;
    traderB = (await db.user.create({ data: { email: 'e2e-traderB@local', passwordHash: fakeHash, role: 'trader', isActive: true } })) as typeof traderB;

    posA = (await db.position.create({
      data: {
        ownerId: traderA.id,
        symbol: 'E2E-RLS-A',
        source: 'cex', status: 'open', entryPriceUsd: 100, entryAmountUsd: 100, entryQty: 1,
        takeProfitPrice: 115, stopLossPrice: 92, maxExitAt: new Date(Date.now() + 3600000), scamScore: 80, roundId: 1,
      },
    })) as typeof posA;
    posB = (await db.position.create({
      data: {
        ownerId: traderB.id,
        symbol: 'E2E-RLS-B',
        source: 'cex', status: 'open', entryPriceUsd: 200, entryAmountUsd: 200, entryQty: 1,
        takeProfitPrice: 230, stopLossPrice: 184, maxExitAt: new Date(Date.now() + 3600000), scamScore: 85, roundId: 1,
      },
    })) as typeof posB;
  });

  afterAll(async () => {
    await db.position.delete({ where: { id: posA.id } });
    await db.position.delete({ where: { id: posB.id } });
    await db.user.delete({ where: { id: admin.id } });
    await db.user.delete({ where: { id: traderA.id } });
    await db.user.delete({ where: { id: traderB.id } });
    await db.$disconnect();
  });

  it('traderA sees own position only', async () => {
    const positions = await db.position.findMany({ where: { ownerId: traderA.id, symbol: { startsWith: 'E2E-RLS-' } } });
    expect(positions.length).toBe(1);
    expect(positions[0].id).toBe(posA.id);
  });

  it('traderB sees own position only', async () => {
    const positions = await db.position.findMany({ where: { ownerId: traderB.id, symbol: { startsWith: 'E2E-RLS-' } } });
    expect(positions.length).toBe(1);
    expect(positions[0].id).toBe(posB.id);
  });

  it('admin (super_admin) sees all 2 positions', async () => {
    const positions = await db.position.findMany({ where: { symbol: { startsWith: 'E2E-RLS-' } } });
    expect(positions.length).toBe(2);
  });

  it('IDOR: traderA cannot access traderB wallet via assertOwner', async () => {
    const w = await db.walletConnection.create({
      data: { ownerId: traderB.id, label: 'B Wallet', type: 'evm', address: '0xB' },
    });
    try {
      await expect(
        assertOwner(
          { userId: traderA.id, email: traderA.email, role: traderA.role, isActive: true },
          'walletConnection',
          w.id,
        ),
      ).rejects.toThrow(/Not owner/);
    } finally {
      await db.walletConnection.delete({ where: { id: w.id } });
    }
  });

  it('admin (super_admin) bypass — can access any wallet', async () => {
    const w = await db.walletConnection.create({
      data: { ownerId: traderA.id, label: 'A Wallet 2', type: 'evm', address: '0xA2' },
    });
    try {
      await expect(
        assertOwner(
          { userId: admin.id, email: admin.email, role: admin.role, isActive: true },
          'walletConnection',
          w.id,
        ),
      ).resolves.toBeUndefined();
    } finally {
      await db.walletConnection.delete({ where: { id: w.id } });
    }
  });
});
