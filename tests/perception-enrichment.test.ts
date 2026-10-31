import { describe, it, expect } from 'vitest';
import {
  enrichPerception,
  type TAAnalystReport,
} from '@/lib/trading/perception-enrichment';

const AS_OF = 1_700_000_000_000;
const PRIMARY = {
  lastPrice: 100,
  lastVolume: 1_000_000,
  liquidity: 'neutral',
  macro: { liquidityState: 'neutral', ratesDirection: 'flat', geopoliticRisk: 0.2 },
  dataQualityPrimary: 0.9,
};

function goldenReports(): TAAnalystReport[] {
  return [
    { kind: 'technical', asOf: AS_OF - 60_000, payload: { price: 100.5, volume: 900_000 }, rawConfidence: 0.9 },
    { kind: 'fundamental', asOf: AS_OF - 3_600_000, payload: { valuationZ: 1.2 }, rawConfidence: 0.8 },
    { kind: 'sentiment', asOf: AS_OF - 600_000, payload: { narrativeHeat: 0.7, retailInflowZ: 1.5, mediaLeadLag: 0.4 }, rawConfidence: 0.85 },
    { kind: 'macro', asOf: AS_OF - 3_600_000, payload: { liquidityState: 'drain', ratesDirection: 'up', geopoliticRisk: 0.6 }, rawConfidence: 0.75 },
  ];
}

describe('Fase 1 — perception enrichment (skill §1/§2.2/§4.4d)', () => {
  it('1. golden: 4 analysts válidos → quality>0.7, N/R/M não-zero, stale=false', () => {
    const s = enrichPerception(goldenReports(), PRIMARY, 'PETR4.SA', AS_OF);
    expect(s.perception.enrichmentQuality).toBeGreaterThan(0.7);
    expect(s.perception.narrativePower).toBeGreaterThan(0);
    expect(s.perception.retailInflowLate).toBeGreaterThan(0);
    expect(s.perception.reflexivityMedia).toBeGreaterThan(0);
    expect(s.stale).toBe(false);
    // primário vence: preço do snapshot é do broker
    expect(s.snapshot.assets[0].price).toBe(100);
    expect(s.snapshot.data_quality_score).toBe(0.9);
  });

  it('2. stale TA: analyst expirado é descartado, coverage cai, mas stale=false', () => {
    const reports = goldenReports().map((r) =>
      r.kind === 'technical' ? { ...r, asOf: AS_OF - 60 * 60_000 } : r,
    );
    const s = enrichPerception(reports, PRIMARY, 'PETR4.SA', AS_OF);
    expect(s.perception.coverage).toBeLessThan(1);
    expect(s.perception.enrichmentQuality).toBeLessThan(0.9);
    // TA é opcional: abort só do primário
    expect(s.stale).toBe(false);
  });

  it('3. divergência de preço: TA 10% acima → quality penalizado, snapshot ainda broker', () => {
    const base = goldenReports();
    const diverging = base.map((r) =>
      r.kind === 'technical' ? { ...r, payload: { ...r.payload, price: 110 } } : r,
    );
    const clean = enrichPerception(base, PRIMARY, 'PETR4.SA', AS_OF);
    const bad = enrichPerception(diverging, PRIMARY, 'PETR4.SA', AS_OF);
    expect(bad.perception.enrichmentQuality).toBeLessThan(clean.perception.enrichmentQuality);
    expect(bad.snapshot.assets[0].price).toBe(100);
  });

  it('4. TA ausente: reports=[] → coverage=0, quality=0, snapshot válido, não trava', () => {
    const s = enrichPerception([], PRIMARY, 'PETR4.SA', AS_OF);
    expect(s.perception.coverage).toBe(0);
    expect(s.perception.enrichmentQuality).toBe(0);
    expect(s.snapshot.assets[0].price).toBe(100);
    expect(s.stale).toBe(false);
  });

  it('5. guardrail de tipo: superfície não expõe trader/risk/decision', () => {
    const s = enrichPerception(goldenReports(), PRIMARY, 'PETR4.SA', AS_OF);
    const anyS = s as unknown as Record<string, unknown>;
    expect(anyS['trader']).toBeUndefined();
    expect(anyS['risk']).toBeUndefined();
    expect(anyS['placeOrder']).toBeUndefined();
    expect(anyS['probability']).toBeUndefined();
    expect(anyS['decision']).toBeUndefined();
    expect((s.snapshot as unknown as Record<string, unknown>)['decision']).toBeUndefined();
  });

  it('6. determinismo: mesma entrada → mesma saída', () => {
    const a = enrichPerception(goldenReports(), PRIMARY, 'PETR4.SA', AS_OF);
    const b = enrichPerception(goldenReports(), PRIMARY, 'PETR4.SA', AS_OF);
    expect(a).toEqual(b);
  });
});
