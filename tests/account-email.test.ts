import { describe, it, expect } from 'vitest';
import { zAccountEmail } from '@/lib/auth/email';

// Regressão CI e2e #34782794854: z.email() rejeita contas locais seedadas
// (admin@local → 400 em todo login). zAccountEmail aceita local@domínio.
describe('zAccountEmail — contas locais de primeira classe', () => {
  it('aceita contas seedadas (@local, sem ponto no domínio)', () => {
    for (const e of ['admin@local', 'viewer@local', 'trader@local']) {
      expect(zAccountEmail.safeParse(e).success).toBe(true);
    }
  });

  it('aceita emails RFC normais', () => {
    for (const e of ['a@b.co', 'test@example.com', 'user+tag@sub.domain.org']) {
      expect(zAccountEmail.safeParse(e).success).toBe(true);
    }
  });

  it('rejeita sem @, vazio e com espaços', () => {
    for (const e of ['', 'sem-arroba', 'a @b.co', 'a@ b.co', '@sem-local', 'sem-dominio@']) {
      expect(zAccountEmail.safeParse(e).success).toBe(false);
    }
  });
});
