// tests/source-health.test.ts — SourceHealth: crítico, degradado/down e ESCOPO (cex/dex)
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '@/lib/db';
import {
  evaluateSourceHealthForScout,
  getSourceHealth,
  resetSourceHealthCounters,
  isCritical,
  isDexScopedSource,
  sourceScope,
  type SourceName,
} from '@/lib/trading/source-health';

interface Seed {
  success: number;
  errors: number;
  rateLimited?: boolean;
  rateLimitUntil?: Date;
}

async function seed(source: SourceName, seed: Seed): Promise<void> {
  const now = new Date();
  const data = {
    windowStartedAt: now,
    windowSuccessCount: seed.success,
    windowErrorCount: seed.errors,
    rateLimited: seed.rateLimited ?? false,
    rateLimitUntil: seed.rateLimitUntil ?? null,
  };
  await db.sourceHealth.upsert({
    where: { source },
    create: { id: source, source, ...data },
    update: data,
  });
}

beforeEach(async () => {
  // Garante que todas as fontes conhecidas existem e zera a janela (isolamento).
  await getSourceHealth();
  await db.sourceHealth.updateMany({
    data: {
      windowStartedAt: new Date(),
      windowSuccessCount: 0,
      windowErrorCount: 0,
      rateLimited: false,
      rateLimitUntil: null,
    },
  });
});

afterAll(async () => {
  await resetSourceHealthCounters();
});

describe('classificação de fontes', () => {
  it('geckoterminal agora é crítica e tem escopo DEX', async () => {
    const rows = await getSourceHealth();
    const gt = rows.find((r) => r.source === 'geckoterminal');
    expect(gt).toBeDefined();
    expect(gt?.isCritical).toBe(true);
    expect(isCritical('geckoterminal')).toBe(true);
    expect(sourceScope('geckoterminal')).toBe('dex');
    expect(isDexScopedSource('geckoterminal')).toBe(true);
  });

  it('escopos: binance=cex, goplus/dexscreener=dex, zai=all', () => {
    expect(sourceScope('binance')).toBe('cex');
    expect(sourceScope('dexscreener')).toBe('dex');
    expect(sourceScope('goplus')).toBe('dex');
    expect(sourceScope('zai')).toBe('all');
    expect(isDexScopedSource('binance')).toBe(false);
  });
});

describe('evaluateSourceHealthForScout', () => {
  it('healthy: proceed true em todos os escopos', async () => {
    const plain = await evaluateSourceHealthForScout();
    expect(plain.proceed).toBe(true);
    expect(plain.reasons).toEqual([]);
    expect(plain.blockedScopes).toEqual({ cex: false, dex: false });

    expect((await evaluateSourceHealthForScout({ candidateSource: 'cex' })).proceed).toBe(true);
    expect((await evaluateSourceHealthForScout({ candidateSource: 'dex' })).proceed).toBe(true);
  });

  it('degraded DEX (geckoterminal) bloqueia DEX mas NÃO CEX', async () => {
    await seed('geckoterminal', { success: 0, errors: 10 });

    const dex = await evaluateSourceHealthForScout({ candidateSource: 'dex' });
    expect(dex.proceed).toBe(false);
    expect(dex.degradedSources).toContain('geckoterminal');
    expect(dex.reasons.some((r) => r.includes('geckoterminal'))).toBe(true);
    expect(dex.blockedScopes).toEqual({ cex: false, dex: true });
    expect(dex.globalBlocked).toBe(false);

    const cex = await evaluateSourceHealthForScout({ candidateSource: 'cex' });
    expect(cex.proceed).toBe(true);
    expect(cex.reasons).toEqual([]);
    expect(cex.degradedSources).toEqual([]);
  });

  it('degraded DEX (dexscreener) também bloqueia só DEX', async () => {
    await seed('dexscreener', { success: 2, errors: 8 });
    expect((await evaluateSourceHealthForScout({ candidateSource: 'dex' })).proceed).toBe(false);
    expect((await evaluateSourceHealthForScout({ candidateSource: 'cex' })).proceed).toBe(true);
  });

  it('degraded CEX (binance) bloqueia só CEX', async () => {
    await seed('binance', { success: 0, errors: 10 });
    expect((await evaluateSourceHealthForScout({ candidateSource: 'cex' })).proceed).toBe(false);
    expect((await evaluateSourceHealthForScout({ candidateSource: 'dex' })).proceed).toBe(true);
  });

  it('fonte GLOBAL (zai) degradada bloqueia CEX e DEX', async () => {
    await seed('zai', { success: 0, errors: 10 });
    const cex = await evaluateSourceHealthForScout({ candidateSource: 'cex' });
    const dex = await evaluateSourceHealthForScout({ candidateSource: 'dex' });
    expect(cex.proceed).toBe(false);
    expect(dex.proceed).toBe(false);
    expect(cex.globalBlocked).toBe(true);
    expect(cex.blockedScopes).toEqual({ cex: true, dex: true });
  });

  it('DOWN (rate-limited) bloqueia o escopo mesmo sem amostras suficientes', async () => {
    await seed('binance', {
      success: 1,
      errors: 0,
      rateLimited: true,
      rateLimitUntil: new Date(Date.now() + 60 * 60 * 1000),
    });
    const cex = await evaluateSourceHealthForScout({ candidateSource: 'cex' });
    expect(cex.proceed).toBe(false);
    expect(cex.reasons.some((r) => r.includes('DOWN'))).toBe(true);
    expect((await evaluateSourceHealthForScout({ candidateSource: 'dex' })).proceed).toBe(true);
  });

  it('sem candidateSource: comportamento conservador (qualquer bloqueio => proceed false)', async () => {
    await seed('geckoterminal', { success: 0, errors: 10 });
    const plain = await evaluateSourceHealthForScout();
    expect(plain.proceed).toBe(false);
    expect(plain.blockedScopes).toEqual({ cex: false, dex: true });
    expect(plain.reasons.some((r) => r.includes('geckoterminal'))).toBe(true);
  });

  it('amostra pequena (<5) não condena a fonte', async () => {
    await seed('geckoterminal', { success: 0, errors: 2 });
    const dex = await evaluateSourceHealthForScout({ candidateSource: 'dex' });
    expect(dex.proceed).toBe(true);
  });
});
