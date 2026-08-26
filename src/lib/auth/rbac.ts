// src/lib/auth/rbac.ts — 4 roles × 24 permissions (see docs/RBAC.md)
export type Role = 'super_admin' | 'trader' | 'viewer' | 'service';
export type Permission =
  | 'dashboard:read'
  | 'positions:read'
  | 'positions:write'
  | 'logs:read'
  | 'config:read'
  | 'config:write'
  | 'engine:control'
  | 'engine:kill'
  | 'reserve:manage'
  | 'backtest:run'
  | 'watchlist:manage'
  | 'notifications:manage'
  | 'wallets:read'
  | 'wallets:write'
  | 'exchanges:manage'
  | 'users:manage'
  | 'audit:read'
  | 'flags:manage'
  | 'schedule:manage'
  | 'signer:call'
  | 'chain:broadcast'
  | 'data:export'
  | 'system:read'
  | 'deploy:promote';

export const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  super_admin: new Set<Permission>([
    'dashboard:read',
    'positions:read',
    'positions:write',
    'logs:read',
    'config:read',
    'config:write',
    'engine:control',
    'engine:kill',
    'reserve:manage',
    'backtest:run',
    'watchlist:manage',
    'notifications:manage',
    'wallets:read',
    'wallets:write',
    'exchanges:manage',
    'users:manage',
    'audit:read',
    'flags:manage',
    'schedule:manage',
    'signer:call',
    'chain:broadcast',
    'data:export',
    'system:read',
    'deploy:promote',
  ]),
  trader: new Set<Permission>([
    'dashboard:read',
    'positions:read',
    'positions:write',
    'logs:read',
    'config:read',
    'config:write',
    'engine:control',
    'engine:kill',
    'backtest:run',
    'watchlist:manage',
    'notifications:manage',
    'wallets:read',
    'audit:read',
    'schedule:manage',
    'data:export',
    'system:read',
  ]),
  viewer: new Set<Permission>([
    'dashboard:read',
    'positions:read',
    'logs:read',
    'config:read',
    'audit:read',
    'system:read',
  ]),
  service: new Set<Permission>([
    'positions:read',
    'positions:write',
    'config:read',
    'engine:control',
    'signer:call',
    'chain:broadcast',
  ]),
};

export function hasPermission(role: string, perm: Permission): boolean {
  const set = ROLE_PERMISSIONS[role as Role];
  if (!set) return false;
  return set.has(perm);
}

export function requirePermission(perm: Permission) {
  // Returns a guard function that can be used in routes:
  //   const session = await requirePermission('engine:kill')(req)
  return async (req: Request) => {
    const { requireSession } = await import('./session');
    const session = await requireSession(req);
    if (!hasPermission(session.role, perm)) {
      const { ForbiddenError } = await import('./errors');
      throw new ForbiddenError(perm);
    }
    return session;
  };
}
