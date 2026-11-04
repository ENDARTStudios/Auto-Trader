// tests/wallet-crypto.test.ts — AES-256-GCM roundtrip e bordas (sem segredos reais)
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});

import {
  decryptSecret,
  encryptSecret,
  maskApiKey,
  verifyPassphrase,
  type EncryptedBlob,
} from '@/lib/trading/wallet-crypto';

// Passphrases sintéticas de teste — NUNCA usar segredo real em teste.
const PASS = 'test-passphrase-sintetica-123';
const WRONG = 'outra-passphrase-errada';

let blob: string;
beforeAll(() => {
  blob = encryptSecret('api-secret-de-teste', PASS);
});

const HEAVY = 60_000; // PBKDF2 600k iters: até ~1s por operação em CI lento

describe('encryptSecret/decryptSecret', () => {
  it('roundtrip devolve o plaintext original', () => {
    expect(decryptSecret(blob, PASS)).toBe('api-secret-de-teste');
  });

  it('passphrase errada => null (sem throw)', () => {
    expect(decryptSecret(blob, WRONG)).toBeNull();
  });

  it('verifyPassphrase true só com a passphrase correta', () => {
    expect(verifyPassphrase(blob, PASS)).toBe(true);
    expect(verifyPassphrase(blob, WRONG)).toBe(false);
  }, HEAVY);

  it('blob é JSON com iv/ciphertext/tag/salt e KDF versionado', () => {
    const parsed = JSON.parse(blob) as EncryptedBlob;
    expect(Object.keys(parsed)).toEqual(expect.arrayContaining(['iv', 'ciphertext', 'tag', 'salt', 'kdfIters']));
    expect(parsed.kdfIters).toBeGreaterThan(0);
    expect(parsed.kdfAlgo).toBeTruthy();
    expect(parsed.kdfVersion).toBeGreaterThanOrEqual(1);
    expect(parsed.encAlgo).toBe('aes-256-gcm');
    expect(parsed.encVersion).toBeGreaterThanOrEqual(1);
    // base64 decodificável
    expect(Buffer.from(parsed.iv, 'base64').length).toBe(12);
    expect(Buffer.from(parsed.salt, 'base64').length).toBeGreaterThanOrEqual(16);
  }, HEAVY);

  it('IV/salt são aleatórios: dois ciphertexts do MESMO plaintext diferem', () => {
    const a = JSON.parse(encryptSecret('mesmo-texto', PASS)) as EncryptedBlob;
    const b = JSON.parse(encryptSecret('mesmo-texto', PASS)) as EncryptedBlob;
    expect(a.iv).not.toBe(b.iv);
    expect(a.salt).not.toBe(b.salt);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.tag).not.toBe(b.tag);
    // ambos decifram corretamente
    expect(decryptSecret(JSON.stringify(a), PASS)).toBe('mesmo-texto');
    expect(decryptSecret(JSON.stringify(b), PASS)).toBe('mesmo-texto');
  }, HEAVY);

  it('blob corrompido (JSON inválido) => null, não throw', () => {
    expect(() => decryptSecret('{nao-e-json', PASS)).not.toThrow();
    expect(decryptSecret('{nao-e-json', PASS)).toBeNull();
  });

  it('blob com campos faltando => null, não throw', () => {
    expect(decryptSecret(JSON.stringify({ iv: 'x' }), PASS)).toBeNull();
  });

  it('tag adulterada (wrong key) => null', () => {
    const p = JSON.parse(blob) as EncryptedBlob;
    const tampered = { ...p, tag: Buffer.alloc(16, 7).toString('base64') };
    expect(decryptSecret(JSON.stringify(tampered), PASS)).toBeNull();
  }, HEAVY);

  it('ciphertext adulterado => null (GCM integrity)', () => {
    const p = JSON.parse(blob) as EncryptedBlob;
    const raw = Buffer.from(p.ciphertext, 'base64');
    raw[0] = raw[0] ^ 0xff;
    const tampered = { ...p, ciphertext: raw.toString('base64') };
    expect(decryptSecret(JSON.stringify(tampered), PASS)).toBeNull();
  }, HEAVY);

  it('versão de encriptação desconhecida => null (fail-closed)', () => {
    const p = JSON.parse(blob) as EncryptedBlob;
    const tampered = { ...p, encVersion: 99 };
    expect(decryptSecret(JSON.stringify(tampered), PASS)).toBeNull();
  }, HEAVY);

  it('plaintexts especiais (unicode, vazio, longo) fazem roundtrip', () => {
    for (const text of ['', 'áéíõú-ç-中文字符', 'x'.repeat(4096)]) {
      const enc = encryptSecret(text, PASS);
      expect(decryptSecret(enc, PASS)).toBe(text);
    }
  }, HEAVY);
});

describe('maskApiKey', () => {
  it('chave curta (<=6) => ***', () => {
    expect(maskApiKey('abc')).toBe('***');
    expect(maskApiKey('123456')).toBe('***');
  });

  it('chave longa mostra só prefixo/sufixo', () => {
    expect(maskApiKey('abcdef1234567890')).toBe('abcdef***7890');
    expect(maskApiKey('abcdef1234567890')).not.toContain('1234567');
  });

  it('nunca devolve mais que 6 chars do meio', () => {
    const masked = maskApiKey('SECRETSECRETSECRET');
    expect(masked.length).toBeLessThan('SECRETSECRETSECRET'.length);
    expect(masked).toContain('***');
  });
});
