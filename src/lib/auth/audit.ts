// src/lib/auth/audit.ts — Append-only audit log with hash chain (DB version of src/lib/audit/audit-log.ts)
import { createHash } from 'crypto';
import { db } from '@/lib/db';

function canonical(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return JSON.stringify(sorted);
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export async function appendAuditLog(params: {
  actorId: string;
  actorRole: string;
  action: string;
  target?: string | null;
  ip?: string | null;
}): Promise<void> {
  const last = await db.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true, hash: true } });
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? null;
  const entry = {
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: params.action,
    target: params.target ?? null,
    ip: params.ip ?? null,
    prevHash,
    seq,
    createdAt: new Date().toISOString(),
  };
  const hash = sha256(canonical(entry as unknown as Record<string, unknown>));
  await db.auditLog.create({
    data: {
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: params.action,
      target: params.target ?? null,
      ip: params.ip ?? null,
      prevHash,
      hash,
      seq,
    },
  });
}
