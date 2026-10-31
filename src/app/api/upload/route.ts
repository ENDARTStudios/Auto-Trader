// src/app/api/upload/route.ts — Fase 6.1 Upload seguro stub (S32 Etapa 6)
// MVP não tem upload de arquivo (paper trading não precisa). Este stub documenta o contrato
// e implementa validações 6.1.1-6.1.5 para quando o recurso for habilitado.
// Status: 501 Not Implemented — habilitado apenas se FeatureFlag upload_enabled=true (futura).

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// 6.1.1 magic bytes allowlist (primeiros bytes, não só extensão)
const MAGIC_ALLOW: Array<{ mime: string; magic: number[] }> = [
  { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] },
];

// 6.1.2 tamanho máximo por tipo (default 1 MiB, imagens 5 MiB)
const MAX_BYTES: Record<string, number> = {
  'image/png': 5 * 1024 * 1024,
  'image/jpeg': 5 * 1024 * 1024,
  'application/pdf': 10 * 1024 * 1024,
  default: 1 * 1024 * 1024,
};

function checkMagic(buf: Uint8Array, claimed: string): boolean {
  const entry = MAGIC_ALLOW.find((x) => x.mime === claimed);
  if (!entry) return false;
  return entry.magic.every((b, i) => buf[i] === b);
}

export async function POST(req: NextRequest) {
  // 6.1 — upload desabilitado no MVP Beta (sem caso de uso)
  return NextResponse.json(
    {
      error: 'upload_not_enabled',
      message: 'Upload seguro desabilitado no MVP Beta (Fase 6.1 adiado). Contrato: 6.1.1 magic bytes, 6.1.2 size limit, 6.1.3 ClamAV, 6.1.4 S3 MinIO/R2, 6.1.5 UUID filename. Habilitar requer FeatureFlag upload_enabled + MinIO + ClamAV container.',
      contract: {
        '6.1.1': 'magic bytes validation (PNG/JPEG/PDF)',
        '6.1.2': 'MAX_BYTES per mime (1-10 MiB)',
        '6.1.3': 'ClamAV container (future)',
        '6.1.4': 'S3 MinIO local / R2 prod (future)',
        '6.1.5': 'UUID filename (future)',
        helpers: { checkMagic: 'src/app/api/upload/route.ts:checkMagic', MAX_BYTES: 'src/app/api/upload/route.ts:MAX_BYTES' },
      },
    },
    { status: 501 }
  );
}

export async function GET() {
  return NextResponse.json({ status: 'upload_stub', enabled: false, fase: '6.1 adiado MVP — sem upload no paper trading' });
}
