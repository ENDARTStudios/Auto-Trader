import { describe, it, expect } from 'vitest';
import { hasPermission } from '@/lib/auth/rbac';
import { rlsWhere } from '@/lib/auth/rls';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

describe('RBAC', () => {
  it('viewer cannot engine:kill', () => {
    expect(hasPermission('viewer', 'engine:kill')).toBe(false);
  });
  it('trader can engine:kill', () => {
    expect(hasPermission('trader', 'engine:kill')).toBe(true);
  });
  it('super_admin can reserve:manage', () => {
    expect(hasPermission('super_admin', 'reserve:manage')).toBe(true);
  });
  it('viewer cannot reserve:manage', () => {
    expect(hasPermission('viewer', 'reserve:manage')).toBe(false);
  });
  it('service can signer:call but not dashboard:read', () => {
    expect(hasPermission('service', 'signer:call')).toBe(true);
    expect(hasPermission('service', 'dashboard:read')).toBe(false);
  });
});

describe('RLS', () => {
  it('super_admin bypass', () => {
    const where = rlsWhere({ userId: '1', email: 'a@a.com', role: 'super_admin', isActive: true }, 'walletConnection');
    expect(where).toEqual({});
  });
  it('viewer filtered by ownerId', () => {
    const where = rlsWhere({ userId: 'user-123', email: 'v@local', role: 'viewer', isActive: true }, 'walletConnection');
    expect(where).toEqual({ ownerId: 'user-123' });
  });
});

describe('password', () => {
  it('hash and verify', async () => {
    const hash = await hashPassword('Admin123!');
    expect(hash.startsWith('$2b$12$')).toBe(true);
    expect(await verifyPassword(hash, 'Admin123!')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});
