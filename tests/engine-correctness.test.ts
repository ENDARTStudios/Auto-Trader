import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_ENTRY_DEVIATION_PCT,
  decideMechanicalExit,
  evaluateAiSquadOutcome,
  evaluateDataQualityGate,
  finalizeRoundPnl,
  getMaxEntryDeviationPct,
  isAiUnavailableError,
  isMarketDataUnavailableError,
  readMarketDataQuality,
  shouldCreateRound,
  validateEntryPrice,
} from '@/lib/trading/engine-correctness';

// ---------------------------------------------------------------------------
// 1. Entry price consistency (the LIT/USDT -77% in 13s bug)
// ---------------------------------------------------------------------------
describe('validateEntryPrice', () => {
  it('aceita desvio pequeno e devolve o preço fresco como entrada', () => {
    const v = validateEntryPrice(1.0, 1.01, 2.0);
    expect(v.ok).toBe(true);
    expect(v.entryPriceUsd).toBe(1.01);
    expect(v.deviationPct).toBeCloseTo(1.0, 10);
    expect(v.reason).toBeNull();
  });

  it('rejeita desvio de -77% (caso LIT/USDT)', () => {
    const v = validateEntryPrice(1.0, 0.23, 2.0);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('deviation');
    expect(v.deviationPct).toBeCloseTo(77, 10);
    expect(v.entryPriceUsd).toBe(0.23); // devolvido p/ auditoria, mas não usável
  });

  it('rejeita desvio acima do default (2%) exatamente na borda e acima dela', () => {
    expect(validateEntryPrice(100, 102, 2).ok).toBe(true); // borda inclusive
    expect(validateEntryPrice(100, 102.01, 2).ok).toBe(false);
    expect(validateEntryPrice(100, 97.99, 2).ok).toBe(false);
  });

  it('rejeita quando o feed não devolve preço (nunca abre com preço não verificado)', () => {
    const v = validateEntryPrice(1.0, 0, 2.0);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('no_price');
    expect(v.entryPriceUsd).toBe(0);
  });

  it('rejeita candidate price inválido (0 / NaN / negativo)', () => {
    expect(validateEntryPrice(0, 1, 2).reason).toBe('invalid_candidate_price');
    expect(validateEntryPrice(Number.NaN, 1, 2).reason).toBe('invalid_candidate_price');
    expect(validateEntryPrice(-5, 1, 2).reason).toBe('invalid_candidate_price');
  });
});

describe('getMaxEntryDeviationPct (env MAX_ENTRY_DEVIATION_PCT)', () => {
  it('default 2.0 quando env ausente/vazia', () => {
    expect(DEFAULT_MAX_ENTRY_DEVIATION_PCT).toBe(2.0);
    expect(getMaxEntryDeviationPct({})).toBe(2.0);
    expect(getMaxEntryDeviationPct({ MAX_ENTRY_DEVIATION_PCT: '' })).toBe(2.0);
  });

  it('aceita override válido e ignora lixo', () => {
    expect(getMaxEntryDeviationPct({ MAX_ENTRY_DEVIATION_PCT: '0.5' })).toBe(0.5);
    expect(getMaxEntryDeviationPct({ MAX_ENTRY_DEVIATION_PCT: '0' })).toBe(0);
    expect(getMaxEntryDeviationPct({ MAX_ENTRY_DEVIATION_PCT: 'abc' })).toBe(2.0);
    expect(getMaxEntryDeviationPct({ MAX_ENTRY_DEVIATION_PCT: '-3' })).toBe(2.0);
  });
});

// ---------------------------------------------------------------------------
// 2. Mechanical exits — including timeout WITHOUT price
// ---------------------------------------------------------------------------
const HOUR = 60 * 60 * 1000;
function pos(overrides: Partial<{
  entryPriceUsd: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  maxExitAt: Date;
}> = {}) {
  return {
    entryPriceUsd: 1.0,
    takeProfitPrice: 1.15,
    stopLossPrice: 0.92,
    maxExitAt: new Date(1_000_000 + 3 * HOUR),
    ...overrides,
  };
}

describe('decideMechanicalExit', () => {
  const beforeTimeout = new Date(1_000_000 + HOUR);
  const afterTimeout = new Date(1_000_000 + 4 * HOUR);

  it('TP com preço', () => {
    const d = decideMechanicalExit(pos(), 1.2, beforeTimeout);
    expect(d.action).toBe('take_profit');
    expect(d.priced).toBe(true);
    expect(d.exitPriceUsd).toBe(1.2);
  });

  it('SL com preço', () => {
    const d = decideMechanicalExit(pos(), 0.9, beforeTimeout);
    expect(d.action).toBe('stop_loss');
    expect(d.priced).toBe(true);
    expect(d.exitPriceUsd).toBe(0.9);
  });

  it('timeout com preço usa o preço de mercado', () => {
    const d = decideMechanicalExit(pos(), 1.01, afterTimeout);
    expect(d.action).toBe('timeout');
    expect(d.priced).toBe(true);
    expect(d.exitPriceUsd).toBe(1.01);
  });

  it('timeout SEM preço fecha em entryPrice e marca priced=false (não fica presa)', () => {
    const d = decideMechanicalExit(pos(), 0, afterTimeout);
    expect(d.action).toBe('timeout');
    expect(d.priced).toBe(false);
    expect(d.exitPriceUsd).toBe(1.0);
  });

  it('sem preço e antes do timeout continua aberta', () => {
    const d = decideMechanicalExit(pos(), 0, beforeTimeout);
    expect(d.action).toBe('none');
    expect(d.priced).toBe(false);
  });

  it('com preço, sem TP/SL/timeout continua aberta', () => {
    const d = decideMechanicalExit(pos(), 1.01, beforeTimeout);
    expect(d.action).toBe('none');
    expect(d.priced).toBe(true);
  });

  it('TP tem precedência sobre timeout quando ambos disparam', () => {
    const d = decideMechanicalExit(pos(), 1.2, afterTimeout);
    expect(d.action).toBe('take_profit');
  });
});

// ---------------------------------------------------------------------------
// 3. Round finalization — ALWAYS finalizes, even with PnL <= 0
// ---------------------------------------------------------------------------
describe('finalizeRoundPnl', () => {
  it('round perdedor: PnL negativo, sem split, ainda finalizável', () => {
    const f = finalizeRoundPnl([-10, -5], 50, 50);
    expect(f.roundPnlUsd).toBe(-15);
    expect(f.profitable).toBe(false);
    expect(f.reserveCutUsd).toBe(0);
    expect(f.reinvestCutUsd).toBe(0);
    expect(f.positionCount).toBe(2);
  });

  it('round de breakeven (0) não divide lucro e não é erro', () => {
    const f = finalizeRoundPnl([10, -10], 50, 50);
    expect(f.roundPnlUsd).toBe(0);
    expect(f.profitable).toBe(false);
    expect(f.reserveCutUsd).toBe(0);
    expect(f.reinvestCutUsd).toBe(0);
  });

  it('round vencedor divide reserva/reinvest', () => {
    const f = finalizeRoundPnl([100, 50], 50, 50);
    expect(f.roundPnlUsd).toBe(150);
    expect(f.profitable).toBe(true);
    expect(f.reserveCutUsd).toBeCloseTo(75, 10);
    expect(f.reinvestCutUsd).toBeCloseTo(75, 10);
  });

  it('ignora pnl null/undefined/NaN e round vazio finaliza', () => {
    const f = finalizeRoundPnl([null, undefined, Number.NaN, 20], 50, 50);
    expect(f.roundPnlUsd).toBe(20);
    expect(f.positionCount).toBe(1);
    const empty = finalizeRoundPnl([], 50, 50);
    expect(empty.roundPnlUsd).toBe(0);
    expect(empty.profitable).toBe(false);
  });

  it('clampa percentuais inválidos em vez de produzir NaN/Infinity', () => {
    const f = finalizeRoundPnl([100], Number.NaN, 150);
    expect(Number.isFinite(f.reserveCutUsd)).toBe(true);
    expect(f.reserveCutUsd).toBe(0);
    expect(f.reinvestCutUsd).toBeCloseTo(100, 10);
  });
});

describe('shouldCreateRound (round só existe quando há posição a abrir)', () => {
  it('nenhum executável → não cria round', () => {
    expect(shouldCreateRound(0)).toBe(false);
    expect(shouldCreateRound(Number.NaN)).toBe(false);
    expect(shouldCreateRound(-1)).toBe(false);
  });
  it('pelo menos um executável → cria round', () => {
    expect(shouldCreateRound(1)).toBe(true);
    expect(shouldCreateRound(5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. AI unavailable is feature-off, never a veto
// ---------------------------------------------------------------------------
describe('classificadores de erro externo', () => {
  it('detecta AIUnavailableError por name e por code', () => {
    const byName = Object.assign(new Error('no provider'), { name: 'AIUnavailableError' });
    const byCode = Object.assign(new Error('no provider'), { code: 'AI_UNAVAILABLE' });
    expect(isAiUnavailableError(byName)).toBe(true);
    expect(isAiUnavailableError(byCode)).toBe(true);
    expect(isAiUnavailableError(new Error('boom'))).toBe(false);
    expect(isAiUnavailableError('AI_UNAVAILABLE')).toBe(false);
    expect(isAiUnavailableError(null)).toBe(false);
  });

  it('detecta MarketDataUnavailableError por name e por code', () => {
    const byName = Object.assign(new Error('no candles'), { name: 'MarketDataUnavailableError' });
    const byCode = Object.assign(new Error('no candles'), { code: 'MARKET_DATA_UNAVAILABLE' });
    expect(isMarketDataUnavailableError(byName)).toBe(true);
    expect(isMarketDataUnavailableError(byCode)).toBe(true);
    expect(isMarketDataUnavailableError(new Error('boom'))).toBe(false);
  });
});

describe('evaluateAiSquadOutcome', () => {
  it('AI indisponível NÃO veta e NÃO vira investigate', () => {
    const out = evaluateAiSquadOutcome({
      ok: false,
      error: Object.assign(new Error('off'), { code: 'AI_UNAVAILABLE' }),
    });
    expect(out.aiUnavailable).toBe(true);
    expect(out.veto).toBe(false);
    expect(out.investigate).toBe(false);
    expect(out.consensus).toBeNull();
  });

  it('erro genérico de IA também não veta (prossegue sem veto)', () => {
    const out = evaluateAiSquadOutcome({ ok: false, error: new Error('timeout') });
    expect(out.aiUnavailable).toBe(false);
    expect(out.veto).toBe(false);
  });

  it('consensus avoid só veta com confiança >= 70', () => {
    expect(
      evaluateAiSquadOutcome({ ok: true, consensus: 'avoid', consensusConfidence: 70 }).veto
    ).toBe(true);
    expect(
      evaluateAiSquadOutcome({ ok: true, consensus: 'avoid', consensusConfidence: 69 }).veto
    ).toBe(false);
  });

  it('investigate não veta, só loga', () => {
    const out = evaluateAiSquadOutcome({ ok: true, consensus: 'investigate', consensusConfidence: 90 });
    expect(out.veto).toBe(false);
    expect(out.investigate).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Data-quality gate — DEX only trades on live data
// ---------------------------------------------------------------------------
describe('evaluateDataQualityGate', () => {
  it('CEX não exige dataQuality', () => {
    expect(evaluateDataQualityGate('cex', { signalLabel: 'neutral' }).skip).toBe(false);
  });

  it('DEX live passa', () => {
    const g = evaluateDataQualityGate('dex', { dataQuality: 'live' });
    expect(g.skip).toBe(false);
    expect(g.dataQuality).toBe('live');
  });

  it('DEX com dataQuality unavailable/missing é NO_TRADE (não vira neutral)', () => {
    const unavailable = evaluateDataQualityGate('dex', { dataQuality: 'unavailable' });
    expect(unavailable.skip).toBe(true);
    expect(unavailable.reason).toBe('data_quality_unavailable');

    const missing = evaluateDataQualityGate('dex', { signalLabel: 'neutral' });
    expect(missing.skip).toBe(true);
    expect(missing.reason).toBe('data_quality_missing');
    expect(missing.dataQuality).toBeNull();
  });

  it('readMarketDataQuality lê defensivamente contratos antigos/novos', () => {
    expect(readMarketDataQuality({ dataQuality: 'live' })).toBe('live');
    expect(readMarketDataQuality({ dataQuality: 42 })).toBeNull();
    expect(readMarketDataQuality(null)).toBeNull();
    expect(readMarketDataQuality('live')).toBeNull();
  });
});
