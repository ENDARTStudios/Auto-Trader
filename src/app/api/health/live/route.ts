import { NextResponse } from 'next/server';

// GET /api/health/live — liveness probe (Docker HEALTHCHECK / k8s livenessProbe /
// Railway health check). Responde 200 enquanto o processo estiver de pé.
//
// NÃO toca no banco, na rede ou em variáveis de ambiente: um liveness probe que
// depende de dependências externas reinicia o container justamente quando o
// banco cai (o restart não conserta o banco e vira loop). Readiness (DB) fica em
// /api/health/ready.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { status: 'live', timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
