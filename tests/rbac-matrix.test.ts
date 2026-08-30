import { describe, it, expect } from 'vitest';
import { hasPermission, ROLE_PERMISSIONS, type Permission, type Role } from '../src/lib/auth/rbac';

describe('RBAC matrix 4x24', () => {
  const roles: Role[] = ['super_admin', 'trader', 'viewer', 'service'];
  const allPerms: Permission[] = [
    'dashboard:read', 'positions:read', 'positions:write', 'logs:read',
    'config:read', 'config:write', 'engine:control', 'engine:kill',
    'reserve:manage', 'backtest:run', 'watchlist:manage', 'notifications:manage',
    'wallets:read', 'wallets:write', 'exchanges:manage', 'users:manage',
    'audit:read', 'flags:manage', 'schedule:manage', 'signer:call',
    'chain:broadcast', 'data:export', 'system:read', 'deploy:promote',
  ];

  it('ROLE_PERMISSIONS has exactly 4 roles', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(['service', 'super_admin', 'trader', 'viewer']);
  });

  it('all 24 permissions are covered by at least one role', () => {
    const all = new Set<Permission>();
    for (const role of roles) {
      for (const p of ROLE_PERMISSIONS[role]) all.add(p);
    }
    for (const p of allPerms) {
      expect(all.has(p), `permission ${p} missing from all roles`).toBe(true);
    }
  });

  it('super_admin has all 24 permissions', () => {
    for (const p of allPerms) {
      expect(hasPermission('super_admin', p), `super_admin missing ${p}`).toBe(true);
    }
  });

  it('viewer can read but not write or manage', () => {
    expect(hasPermission('viewer', 'dashboard:read')).toBe(true);
    expect(hasPermission('viewer', 'logs:read')).toBe(true);
    expect(hasPermission('viewer', 'positions:read')).toBe(true);
    expect(hasPermission('viewer', 'engine:kill')).toBe(false);
    expect(hasPermission('viewer', 'reserve:manage')).toBe(false);
    expect(hasPermission('viewer', 'users:manage')).toBe(false);
    expect(hasPermission('viewer', 'wallets:write')).toBe(false);
  });

  it('trader can trade and configure but not admin or kill', () => {
    expect(hasPermission('trader', 'engine:control')).toBe(true);
    expect(hasPermission('trader', 'positions:write')).toBe(true);
    expect(hasPermission('trader', 'config:write')).toBe(true);
    expect(hasPermission('trader', 'engine:kill')).toBe(true);
    expect(hasPermission('trader', 'reserve:manage')).toBe(false);
    expect(hasPermission('trader', 'users:manage')).toBe(false);
    expect(hasPermission('trader', 'wallets:write')).toBe(false);
  });

  it('service is machine-to-machine: signer + broadcast only, no UI', () => {
    expect(hasPermission('service', 'signer:call')).toBe(true);
    expect(hasPermission('service', 'chain:broadcast')).toBe(true);
    expect(hasPermission('service', 'positions:read')).toBe(true);
    expect(hasPermission('service', 'engine:control')).toBe(true);
    expect(hasPermission('service', 'dashboard:read')).toBe(false);
    expect(hasPermission('service', 'logs:read')).toBe(false);
    expect(hasPermission('service', 'users:manage')).toBe(false);
  });

  it('hasPermission returns false for unknown role', () => {
    expect(hasPermission('hacker' as Role, 'dashboard:read')).toBe(false);
  });

  it('service can write positions but not wallets or config', () => {
    expect(hasPermission('service', 'positions:write')).toBe(true);
    expect(hasPermission('service', 'wallets:write')).toBe(false);
    expect(hasPermission('service', 'config:write')).toBe(false);
  });

  it('only super_admin can write wallets', () => {
    for (const role of roles) {
      const expected = role === 'super_admin';
      expect(hasPermission(role, 'wallets:write'), `${role} wallets:write`).toBe(expected);
    }
  });

  it('only super_admin can manage users and deploy', () => {
    const superOnly: Permission[] = ['users:manage', 'deploy:promote'];
    for (const p of superOnly) {
      expect(hasPermission('viewer', p)).toBe(false);
      expect(hasPermission('trader', p)).toBe(false);
      expect(hasPermission('service', p)).toBe(false);
      expect(hasPermission('super_admin', p)).toBe(true);
    }
  });
});
