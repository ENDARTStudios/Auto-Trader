// tests/live-gating.test.ts — matriz FAIL-CLOSED do gate de execução live.
import { describe, it, expect, vi } from 'vitest';
import {
  checkLiveGate,
  evaluateLiveGate,
  LiveExecutionDisabledError,
  LIVE_TRADING_FLAG_KEY,
  type LiveGateConfig,
} from '@/lib/trading/live-gating';

const LIVE_CFG: LiveGateConfig = {
  mode: 'live',
  graduatedToLive: true,
  killSwitchActive: false,
};

const LIVE_ENV = {
  LIVE_TRADING_ENABLED: 'true',
  S14_APPROVED: 'true',
};

describe('evaluateLiveGate — matriz fail-closed', () => {
  it('allowed SOMENTE com todas as 6 condições', () => {
    expect(evaluateLiveGate(LIVE_CFG, LIVE_ENV, true)).toEqual({ allowed: true });
  });

  it('mode paper → negado', () => {
    const r = evaluateLiveGate({ ...LIVE_CFG, mode: 'paper' }, LIVE_ENV, true);
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.code).toBe('LIVE_DISABLED');
    expect(r.reason).toContain("mode='paper'");
  });

  it('graduatedToLive=false → negado', () => {
    const r = evaluateLiveGate({ ...LIVE_CFG, graduatedToLive: false }, LIVE_ENV, true);
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toContain('graduatedToLive');
  });

  it('kill switch ativo → negado', () => {
    const r = evaluateLiveGate({ ...LIVE_CFG, killSwitchActive: true }, LIVE_ENV, true);
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toContain('killSwitchActive');
  });

  it('LIVE_TRADING_ENABLED ausente/errado → negado', () => {
    for (const value of [undefined, '', '1', 'TRUE', 'yes']) {
      const r = evaluateLiveGate(LIVE_CFG, { ...LIVE_ENV, LIVE_TRADING_ENABLED: value }, true);
      expect(r.allowed).toBe(false);
      if (r.allowed) return;
      expect(r.reason).toContain('LIVE_TRADING_ENABLED');
    }
  });

  it('S14_APPROVED ausente/errado → negado', () => {
    for (const value of [undefined, '', '1', 'TRUE']) {
      const r = evaluateLiveGate(LIVE_CFG, { ...LIVE_ENV, S14_APPROVED: value }, true);
      expect(r.allowed).toBe(false);
      if (r.allowed) return;
      expect(r.reason).toContain('S14_APPROVED');
    }
  });

  it('feature flag desligada → negado', () => {
    const r = evaluateLiveGate(LIVE_CFG, LIVE_ENV, false);
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toContain(LIVE_TRADING_FLAG_KEY);
  });

  it('env default do processo nunca habilita (sem as flags)', () => {
    // O .env do repo não define LIVE_TRADING_ENABLED/S14_APPROVED.
    const env = { ...process.env, LIVE_TRADING_ENABLED: undefined, S14_APPROVED: undefined };
    const r = evaluateLiveGate(LIVE_CFG, env, false);
    expect(r.allowed).toBe(false);
  });
});

describe('checkLiveGate — resolução assíncrona', () => {
  it('não consulta a flag quando um pré-requisito já falhou', async () => {
    const isFlagEnabled = vi.fn(async () => true);
    const r = await checkLiveGate(
      { mode: 'paper', graduatedToLive: true, killSwitchActive: false },
      { env: LIVE_ENV, isFlagEnabled }
    );
    expect(r.allowed).toBe(false);
    expect(isFlagEnabled).not.toHaveBeenCalled();
  });

  it('flag desligada (default do sistema) → negado', async () => {
    const r = await checkLiveGate(LIVE_CFG, {
      env: LIVE_ENV,
      isFlagEnabled: async () => false,
    });
    expect(r.allowed).toBe(false);
  });

  it('flag store lança erro → fail-closed', async () => {
    const r = await checkLiveGate(LIVE_CFG, {
      env: LIVE_ENV,
      isFlagEnabled: async () => {
        throw new Error('db down');
      },
    });
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.code).toBe('LIVE_DISABLED');
  });

  it('todas as condições via deps → allowed', async () => {
    const r = await checkLiveGate(LIVE_CFG, {
      env: LIVE_ENV,
      isFlagEnabled: async (key: string) => key === LIVE_TRADING_FLAG_KEY,
    });
    expect(r).toEqual({ allowed: true });
  });

  it('consulta exatamente a flag enable_live_trading', async () => {
    const isFlagEnabled = vi.fn(async () => true);
    await checkLiveGate(LIVE_CFG, { env: LIVE_ENV, isFlagEnabled });
    expect(isFlagEnabled).toHaveBeenCalledWith('enable_live_trading');
  });
});

describe('LiveExecutionDisabledError', () => {
  it('carrega code LIVE_DISABLED e reason', () => {
    const err = new LiveExecutionDisabledError('mode paper');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('LIVE_DISABLED');
    expect(err.reason).toBe('mode paper');
    expect(err.message).toContain('LIVE_DISABLED');
  });
});
