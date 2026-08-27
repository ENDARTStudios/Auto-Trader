import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { generateToken, hashToken } from '@/lib/auth/session';

const db = new PrismaClient();

describe('password reset', () => {
  const testEmail = `reset-test-${Date.now()}@local`;
  let userId: string;

  beforeAll(async () => {
    const hash = await hashPassword('OldPass123!');
    const user = await db.user.create({ data: { email: testEmail, passwordHash: hash, role: 'viewer' } });
    userId = user.id;
  });

  afterAll(async () => {
    await db.passwordReset.deleteMany({ where: { userId } });
    await db.session.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } }).catch(() => {});
    await db.$disconnect();
  });

  it('forgot creates token', async () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const reset = await db.passwordReset.create({ data: { userId, tokenHash, expiresAt } });
    expect(reset.tokenHash).toBe(tokenHash);
    expect(reset.used).toBe(false);
    expect(reset.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('reset with valid token succeeds and invalidates old password', async () => {
    const token = generateToken();
    const tokenHash = hashToken(token);
    await db.passwordReset.create({ data: { userId, tokenHash, expiresAt: new Date(Date.now() + 15 * 60 * 1000) } });

    // Simulate POST /api/auth/reset logic
    const found = await db.passwordReset.findUnique({ where: { tokenHash } });
    expect(found).not.toBeNull();
    expect(found!.used).toBe(false);

    const newHash = await hashPassword('NewPass123!');
    await db.$transaction([
      db.user.update({ where: { id: userId }, data: { passwordHash: newHash } }),
      db.passwordReset.update({ where: { id: found!.id }, data: { used: true } }),
    ]);

    const after = await db.passwordReset.findUnique({ where: { id: found!.id } });
    expect(after!.used).toBe(true);

    const user = await db.user.findUnique({ where: { id: userId } });
    expect(await verifyPassword(user!.passwordHash, 'NewPass123!')).toBe(true);
    expect(await verifyPassword(user!.passwordHash, 'OldPass123!')).toBe(false);
  });
});
