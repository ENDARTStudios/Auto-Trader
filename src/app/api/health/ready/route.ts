import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/health/ready — readiness probe (Docker HEALTHCHECK / k8s readinessProbe).
// 200 quando o Postgres responde a uma query barata; 503 caso contrário.
//
// O erro NUNCA volta cru para o cliente: mensagens do driver podem carregar
// host/porta/usuário da DATABASE_URL. Detalhe vai para o log do servidor.
export const dynamic = 'force-dynamic';

function readyTimeoutMs(): number {
  const raw = Number(process.env.HEALTH_READY_TIMEOUT_MS ?? 3000);
  return Number.isFinite(raw) ? Math.max(200, raw) : 3000;
}

async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
  const startedAt = Date.now();
  const timeoutMs = readyTimeoutMs();
  let timer: NodeJS.Timeout | undefined;
  try {
    const probe = db.featureFlag.findFirst({ select: { id: true } });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`db probe timeout after ${timeoutMs}ms`)), timeoutMs);
      timer.unref?.();
    });
    await Promise.race([probe, timeout]);
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - startedAt, detail: (err as Error).message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const result = await checkDatabase();
  const timestamp = new Date().toISOString();

  if (!result.ok) {
    console.error('[health/ready] banco indisponível:', result.detail);
    return NextResponse.json(
      { status: 'not_ready', timestamp, db: { reachable: false }, latencyMs: result.latencyMs },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    { status: 'ready', timestamp, db: { reachable: true }, latencyMs: result.latencyMs },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
