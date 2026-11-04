import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Auth é o único ponto que exige sessão/DB: mock total.
vi.mock('@/lib/auth/session', () => ({
  requirePermission: () => async () => ({ userId: 'u-teste', role: 'super_admin' }),
}));

import { POST, GET, ACCEPTED_MIMES } from '@/app/api/upload/route';

const PNG_OK = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const PDF_OK = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

let dir = '';
const ORIGINAL = { ...process.env };

function reqWithFile(bytes: Uint8Array, name: string, type: string) {
  const form = new FormData();
  // File espera BlobPart; copiamos para um ArrayBuffer concreto (tipagem do TS 5.9).
  const part = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.append('file', new File([part], name, { type }));
  return new Request('http://localhost/api/upload', { method: 'POST', body: form });
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'upload-test-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  process.env.UPLOAD_DIR = dir;
  delete process.env.UPLOAD_ENABLED;
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('POST /api/upload — storage local real', () => {
  it('grava PNG válido e retorna id/filename/mime/size/sha256 (201)', async () => {
    const res = await POST(reqWithFile(PNG_OK, 'foto.png', 'image/png') as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mime).toBe('image/png');
    expect(body.size).toBe(PNG_OK.byteLength);
    expect(body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.filename).toBe(body.id + '.png');
    const stored = join(dir, body.filename);
    expect(existsSync(stored)).toBe(true);
    expect(new Uint8Array(readFileSync(stored))).toEqual(PNG_OK);
  });

  it('aceita PDF pelo magic bytes (extensão derivada do mime, não do nome)', async () => {
    const res = await POST(reqWithFile(PDF_OK, 'contrato.exe', 'application/pdf') as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.filename.endsWith('.pdf')).toBe(true);
  });

  it('recusa mime fora da allowlist (415)', async () => {
    const res = await POST(reqWithFile(new TextEncoder().encode('oi'), 'a.txt', 'text/plain') as never);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toBe('mime_not_allowed');
    expect(body.acceptedMimes).toEqual(ACCEPTED_MIMES);
  });

  it('recusa magic bytes divergentes mesmo com mime declarado válido', async () => {
    const res = await POST(reqWithFile(new TextEncoder().encode('nao sou png'), 'falso.png', 'image/png') as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('magic_bytes_mismatch');
  });

  it('recusa arquivo acima do limite do mime (413)', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 8);
    big.set(PNG_OK.slice(0, 4), 0);
    const res = await POST(reqWithFile(big, 'grande.png', 'image/png') as never);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('file_too_large');
  });

  it('não usa o nome do cliente no storage (sem path traversal)', async () => {
    const res = await POST(reqWithFile(PNG_OK, '../../evil.sh', 'image/png') as never);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.filename).not.toContain('evil');
    expect(body.filename).not.toContain('/');
    expect(existsSync(join(dir, '..', 'evil.sh'))).toBe(false);
    expect(readdirSync(dir).every((f) => !f.includes('evil'))).toBe(true);
  });

  it('UPLOAD_ENABLED=0 desliga com 503 documentado', async () => {
    process.env.UPLOAD_ENABLED = '0';
    const res = await POST(reqWithFile(PNG_OK, 'a.png', 'image/png') as never);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('upload_disabled');
  });

  it('multipart sem o campo file -> 400', async () => {
    const form = new FormData();
    form.append('outro', 'x');
    const req = new Request('http://localhost/api/upload', { method: 'POST', body: form });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('file_required');
  });
});

describe('GET /api/upload — status real', () => {
  it('expõe enabled/dir mascarado/acceptedMimes/maxBytes', async () => {
    const res = await GET(new Request('http://localhost/api/upload') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.enabled).toBe(true);
    expect(body.storage).toBe('local-filesystem');
    expect(body.acceptedMimes).toEqual(ACCEPTED_MIMES);
    expect(body.maxBytes['image/png']).toBe(5 * 1024 * 1024);
    // não vaza caminho absoluto do host
    expect(String(body.dir).startsWith('/')).toBe(false);
    expect(String(body.dir)).not.toBe(dir);
    expect(String(body.dir)).toContain('upload-test-');
  });

  it('UPLOAD_ENABLED=0 -> 503', async () => {
    process.env.UPLOAD_ENABLED = '0';
    const res = await GET(new Request('http://localhost/api/upload') as never);
    expect(res.status).toBe(503);
    expect((await res.json()).enabled).toBe(false);
  });
});
