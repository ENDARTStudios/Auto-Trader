// tests/market-route.test.ts — POST /api/market trata MarketDataUnavailableError (503)
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Handler testado de ponta a ponta com dependências de borda mockadas:
// auth/RBAC/rate-limit, analyzeMarket e Prisma. Nenhum dado sintético é usado.
vi.mock('@/lib/db', () => ({
  db: {
    marketSnapshot: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('@/lib/auth/session', () => ({
  requireSession: async () => ({ userId: 'u1', email: 'op@example.com', role: 'ADMIN', isActive: true }),
  requirePermission: () => async () => ({ userId: 'u1', email: 'op@example.com', role: 'ADMIN', isActive: true }),
}));

vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: () => true,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ allowed: true }),
}));

vi.mock('@/lib/trading/config', () => ({
  getConfig: async () => ({}),
}));

vi.mock('@/lib/trading/token-selector', () => ({
  selectCandidates: async () => [],
}));

vi.mock('@/lib/trading/market-analysis', () => {
  class MarketDataUnavailableError extends Error {
    readonly code = 'MARKET_DATA_UNAVAILABLE';
    constructor(message = 'sem OHLCV real') {
      super(message);
      this.name = 'MarketDataUnavailableError';
    }
  }
  return {
    MarketDataUnavailableError,
    analyzeMarket: vi.fn(),
    getFearGreedIndex: vi.fn(async () => null),
    getTrendingTokens: vi.fn(async () => []),
  };
});

import { GET, POST } from '@/app/api/market/route';
import { analyzeMarket, MarketDataUnavailableError } from '@/lib/trading/market-analysis';

const mockedAnalyze = vi.mocked(analyzeMarket);

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/market', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const CEX_BODY = { symbol: 'BTC/USDT', source: 'cex' as const, priceUsd: 50000 };

beforeEach(() => {
  mockedAnalyze.mockReset();
});

describe('POST /api/market', () => {
  it('200 com o sinal quando há OHLCV real', async () => {
    mockedAnalyze.mockResolvedValue({ symbol: 'BTC/USDT', signalScore: 66, dataQuality: 'live' } as never);

    const res = await POST(postRequest(CEX_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.symbol).toBe('BTC/USDT');
    expect(body.dataQuality).toBe('live');
    expect(mockedAnalyze).toHaveBeenCalledTimes(1);
  });

  it('503 {error:market_data_unavailable, code:MARKET_DATA_UNAVAILABLE} quando analyzeMarket lança', async () => {
    mockedAnalyze.mockRejectedValue(new MarketDataUnavailableError('Binance sem candles'));

    const res = await POST(postRequest(CEX_BODY));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('market_data_unavailable');
    expect(body.code).toBe('MARKET_DATA_UNAVAILABLE');
    expect(body.symbol).toBe('BTC/USDT');
    expect(body.source).toBe('cex');
    expect(String(body.message)).toContain('Binance');
  });

  it('reconhece o erro pelo code mesmo se a classe mudar de identidade', async () => {
    const foreign = Object.assign(new Error('sem pool'), { code: 'MARKET_DATA_UNAVAILABLE' });
    mockedAnalyze.mockRejectedValue(foreign);

    const res = await POST(postRequest(CEX_BODY));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('MARKET_DATA_UNAVAILABLE');
  });

  it('erro genérico continua indo para handleApiError (500)', async () => {
    mockedAnalyze.mockRejectedValue(new Error('boom inesperado'));

    const res = await POST(postRequest(CEX_BODY));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('internal_error');
  });

  it('400 em body inválido (sem chamar analyzeMarket)', async () => {
    const res = await POST(postRequest({ symbol: '', source: 'nope' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation_error');
    expect(mockedAnalyze).not.toHaveBeenCalled();
  });
});

describe('GET /api/market (inalterado)', () => {
  it('200 devolvendo snapshots + sentimento (vazio quando não há dado)', async () => {
    const res = await GET(new Request('http://localhost/api/market?limit=5'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.snapshots)).toBe(true);
    expect(body.fearGreed).toBeNull();
    expect(Array.isArray(body.trending)).toBe(true);
  });
});
