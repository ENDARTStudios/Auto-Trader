import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock do Prisma client: estes testes exercitam os HANDLERS de health, não o banco.
const findFirst = vi.fn();
vi.mock('@/lib/db', () => ({
  db: { featureFlag: { findFirst: (...args: unknown[]) => findFirst(...args) } },
}));

import { GET as getLive } from '@/app/api/health/live/route';
import { GET as getReady } from '@/app/api/health/ready/route';

describe('GET /api/health/live', () => {
  it('responde 200 sem tocar no banco', async () => {
    findFirst.mockReset();
    const res = await getLive();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('live');
    expect(typeof body.timestamp).toBe('string');
    expect(findFirst).not.toHaveBeenCalled();
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});

describe('GET /api/health/ready', () => {
  beforeEach(() => {
    findFirst.mockReset();
    process.env.HEALTH_READY_TIMEOUT_MS = '500';
  });
  afterEach(() => {
    delete process.env.HEALTH_READY_TIMEOUT_MS;
  });

  it('200 quando o banco responde', async () => {
    findFirst.mockResolvedValue({ id: 'flag-1' });
    const res = await getReady();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(body.db.reachable).toBe(true);
    expect(typeof body.latencyMs).toBe('number');
  });

  it('503 quando o banco lança, sem vazar a mensagem crua do driver', async () => {
    findFirst.mockRejectedValue(new Error('SASL: password authentication failed for user "admin" host=10.0.0.5'));
    const res = await getReady();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('not_ready');
    expect(body.db.reachable).toBe(false);
    // erro do driver pode conter host/usuário/senha: nunca pode ir para o cliente
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('password');
    expect(raw).not.toContain('10.0.0.5');
    expect(body.error).toBeUndefined();
  });

  it('503 quando o banco demora mais que o timeout do probe', async () => {
    findFirst.mockImplementation(() => new Promise(() => {}));
    const res = await getReady();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('not_ready');
  }, 10_000);
});
