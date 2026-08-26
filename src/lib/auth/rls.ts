// src/lib/auth/rls.ts — Row Level Security helper (app-layer, see docs/RLS.md)
import { db } from '@/lib/db';
import type { SessionUser } from './session';

type RlsModel = 'walletConnection' | 'exchangeConnection' | 'notificationChannel';

// Returns a where clause that enforces owner isolation
export function rlsWhere(session: SessionUser, _model: RlsModel): Record<string, unknown> {
  if (session.role === 'super_admin') {
    // Bypass but log — super_admin sees all
    // console.log(`[RLS] super_admin bypass ${model} by ${session.userId}`);
    return {};
  }
  return { ownerId: session.userId };
}

// Throws if session does not own the row
export async function assertOwner(
  session: SessionUser,
  model: RlsModel,
  id: string,
): Promise<void> {
  const delegate = (db as unknown as Record<string, { findUnique: (args: unknown) => Promise<{ ownerId: string | null } | null> }>)[model];
  const row = await delegate.findUnique({ where: { id }, select: { ownerId: true } });
  if (!row) {
    const { ForbiddenError } = await import('./errors');
    throw new ForbiddenError(`Not found: ${model}:${id}`);
  }
  if (session.role !== 'super_admin' && row.ownerId !== session.userId) {
    const { ForbiddenError } = await import('./errors');
    throw new ForbiddenError(`Not owner of ${model}:${id}`);
  }
}

// Helper to wrap a query with RLS where injection
export function withRLSWhere<T extends Record<string, unknown>>(
  session: SessionUser,
  model: RlsModel,
  where: T | undefined,
): T & Record<string, unknown> {
  const rls = rlsWhere(session, model);
  if (Object.keys(rls).length === 0) return (where ?? {}) as T & Record<string, unknown>;
  return { ...(where ?? {}), ...rls } as T & Record<string, unknown>;
}
