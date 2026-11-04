// src/app/api/upload/route.ts — upload REAL em storage local (rodada 10).
//
// Contrato: POST multipart/form-data com campo "file". Validações:
//   - mime na allowlist (PNG/JPEG/PDF) e MAGIC BYTES (não confia no Content-Type);
//   - tamanho por mime (MAX_BYTES), lido de file.size antes de bufferizar;
//   - nome aleatório (UUID) + extensão derivada do MIME (nunca do filename do cliente)
//     => sem path traversal e sem sobrescrever arquivo existente;
//   - grava em UPLOAD_DIR (env) ou, por default, /data/uploads se /data for gravável
//     (volume de produção) senão .local/uploads (dev);
//   - sha256 do conteúdo no retorno.
// O arquivo NÃO é servido publicamente (não há rota de download; o volume é privado).
// ClamAV/S3 ficam para depois — ver docs/04-api-integrations/UPLOAD.md.
//
// UPLOAD_ENABLED=0 desliga o endpoint (503 documentado). Default: habilitado.
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { requirePermission } from '@/lib/auth/session';
import { handleApiError } from '@/lib/api/error-handler';

export const runtime = 'nodejs';

// 6.1.1 magic bytes allowlist (primeiros bytes, não só extensão)
export const MAGIC_ALLOW: Array<{ mime: string; magic: number[]; ext: string }> = [
  { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47], ext: '.png' },
  { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff], ext: '.jpg' },
  { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46], ext: '.pdf' },
];

// 6.1.2 tamanho máximo por tipo (default 1 MiB, imagens 5 MiB, PDF 10 MiB)
export const MAX_BYTES: Record<string, number> = {
  'image/png': 5 * 1024 * 1024,
  'image/jpeg': 5 * 1024 * 1024,
  'application/pdf': 10 * 1024 * 1024,
  default: 1 * 1024 * 1024,
};

export const ACCEPTED_MIMES = MAGIC_ALLOW.map((x) => x.mime);

export function checkMagic(buf: Uint8Array, claimed: string): boolean {
  const entry = MAGIC_ALLOW.find((x) => x.mime === claimed);
  if (!entry) return false;
  return entry.magic.every((b, i) => buf[i] === b);
}

export function maxBytesFor(mime: string): number {
  return MAX_BYTES[mime] ?? MAX_BYTES.default;
}

/** Diretório de upload: env > /data/uploads (se gravável) > .local/uploads. */
export async function resolveUploadDir(): Promise<string> {
  const override = process.env.UPLOAD_DIR;
  if (override && override.trim()) return resolve(override.trim());
  const volume = '/data';
  try {
    await access(volume, fsConstants.W_OK);
    return join(volume, 'uploads');
  } catch {
    return resolve('.local', 'uploads');
  }
}

/** Caminho mascarado para a resposta do GET (nunca vaza caminho absoluto do host). */
export function maskDir(dir: string): string {
  const rel = relative(process.cwd(), dir);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel;
  return '<externo>/' + dir.split(/[\\/]/).filter(Boolean).slice(-1)[0];
}

export function uploadEnabled(): boolean {
  return process.env.UPLOAD_ENABLED !== '0';
}

function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...(extra ?? {}) }, { status });
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission('wallets:write')(req);
  } catch (err) {
    return handleApiError(err, 'POST /api/upload');
  }
  if (!uploadEnabled()) {
    return jsonError(503, 'upload_disabled', {
      message: 'Upload desabilitado por UPLOAD_ENABLED=0. O endpoint não aceita arquivos neste ambiente.',
    });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, 'invalid_multipart', { message: 'Envie multipart/form-data com o campo "file".' });
  }

  const file = form.get('file');
  const isFileLike =
    typeof file === 'object' &&
    file !== null &&
    typeof (file as { arrayBuffer?: unknown }).arrayBuffer === 'function' &&
    typeof (file as { name?: unknown }).name === 'string';
  if (!isFileLike) {
    return jsonError(400, 'file_required', { message: 'Campo "file" obrigatório (multipart/form-data).' });
  }
  const upload = file as File;

  const mime = String(upload.type || '').toLowerCase();
  if (ACCEPTED_MIMES.indexOf(mime) < 0) {
    return jsonError(415, 'mime_not_allowed', {
      acceptedMimes: ACCEPTED_MIMES,
      message: 'Tipo de arquivo não permitido. Aceitos: ' + ACCEPTED_MIMES.join(', '),
    });
  }

  const limit = maxBytesFor(mime);
  if (typeof upload.size === 'number' && upload.size > limit) {
    return jsonError(413, 'file_too_large', { maxBytes: limit, size: upload.size });
  }

  const bytes = new Uint8Array(await upload.arrayBuffer());
  if (bytes.byteLength === 0) return jsonError(400, 'empty_file');
  if (bytes.byteLength > limit) return jsonError(413, 'file_too_large', { maxBytes: limit, size: bytes.byteLength });

  // Magic bytes: o Content-Type é do cliente; o conteúdo é a verdade.
  if (!checkMagic(bytes, mime)) {
    return jsonError(400, 'magic_bytes_mismatch', {
      message: 'O conteúdo do arquivo não corresponde ao tipo declarado.',
    });
  }

  const entry = MAGIC_ALLOW.find((x) => x.mime === mime)!;
  const id = randomUUID();
  const filename = id + entry.ext;
  const dir = await resolveUploadDir();
  const target = join(dir, filename);
  // Defesa extra: o nome é gerado por nós (UUID + ext fixa), mas garantimos que o
  // destino está DENTRO de dir mesmo assim.
  const relCheck = relative(dir, target);
  if (!relCheck || relCheck.startsWith('..') || isAbsolute(relCheck)) {
    return jsonError(400, 'invalid_target_path');
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    console.error('[upload] falha ao gravar arquivo:', (err as Error).message);
    return jsonError(500, 'storage_write_failed');
  }

  return NextResponse.json(
    { ok: true, id, filename, mime, size: bytes.byteLength, sha256 },
    { status: 201 },
  );
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission('wallets:write')(req);
  } catch (err) {
    return handleApiError(err, 'GET /api/upload');
  }
  const enabled = uploadEnabled();
  if (!enabled) {
    return NextResponse.json(
      { status: 'disabled', enabled: false, message: 'UPLOAD_ENABLED=0' },
      { status: 503 },
    );
  }
  const dir = await resolveUploadDir();
  return NextResponse.json({
    status: 'ok',
    enabled: true,
    dir: maskDir(dir),
    acceptedMimes: ACCEPTED_MIMES,
    maxBytes: MAX_BYTES,
    storage: 'local-filesystem',
    notes: 'Arquivo não é servido publicamente; sem ClamAV/S3 nesta versão (ver docs/04-api-integrations/UPLOAD.md).',
  });
}
