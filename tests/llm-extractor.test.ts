import { describe, it, expect } from 'vitest';
import {
  ProsaToReportExtractor,
  mockProvider,
  routeProsaToBlocks,
} from '@/lib/trading/llm-extractor';
import { UnparseableThesis } from '@/lib/trading/tradingagents-adapter';

const AS_OF = 1_700_000_000_000;
const PROSA = {
  market_report:
    'O ativo BTC rompeu resistência com price em 67000 e volume em 900000000, momentum técnico forte nas últimas semanas de negociação intensa no mercado cripto global.',
  fundamentals_report:
    'O múltiplo EV/EBITDA está 2 desvios acima da média histórica, valuationZ em 2.1, margem comprimida e fluxo de caixa livre em queda no último trimestre fiscal.',
  social_media_report:
    'Ubiquidade da tese nas redes: todo influenciador fala do ativo, buscas em alta recorde, downloads de corretoras explodindo entre investidores novatos eufóricos.',
  news_report:
    'Bancos centrais sinalizam aperto monetário, liquidez global secando, risco geopolítico elevado com tensões comerciais e sanções afetando cadeias de suprimento.',
};

describe('Fase 2.1 — llm-extractor (skill §2.7/§0.5/§4.4d/§5.12)', () => {
  it('1. extrator mock: JSON válido com Buy → reports + winner=bull via adaptador', async () => {
    const provider = mockProvider(() => ({
      reports: [
        { kind: 'technical', payload: { price: 67000, volume: 9e8 }, extraction_confidence: 0.9 },
        { kind: 'sentiment', payload: { narrativeHeat: 0.8, retailInflowZ: 1.5 }, extraction_confidence: 0.7 },
      ],
      forward: null,
    }));
    const ex = new ProsaToReportExtractor(provider);
    const reports = await ex.extractProsaToReports(
      { market_report: PROSA.market_report, social_media_report: PROSA.social_media_report },
      AS_OF,
    );
    expect(reports.length).toBe(2);
    // rawConfidence vem DO EXTRACTOR, nunca prob de EV
    expect(reports[0].rawConfidence).toBe(0.9);
    expect((reports[0] as unknown as Record<string, unknown>)['probability']).toBeUndefined();
  });

  it('2. JSON malformado → UnparseableThesis (não trava, vai p/ fallback)', async () => {
    const provider = mockProvider(() => {
      throw new Error('LLM 500');
    });
    const ex = new ProsaToReportExtractor(provider);
    await expect(
      ex.extractProsaToReports({ market_report: PROSA.market_report }, AS_OF),
    ).rejects.toBeInstanceOf(UnparseableThesis);
  });

  it('2b. resposta não-objeto / reports vazio → UnparseableThesis', async () => {
    const bad = mockProvider(() => ({ reports: [] }));
    const ex = new ProsaToReportExtractor(bad);
    await expect(
      ex.extractProsaToReports({ market_report: PROSA.market_report }, AS_OF),
    ).rejects.toBeInstanceOf(UnparseableThesis);
  });

  it('3. kind fora do roteamento (crypto) → descartado; todos descartados → UnparseableThesis', async () => {
    const provider = mockProvider(() => ({
      reports: [{ kind: 'crypto', payload: { price: 1 }, extraction_confidence: 0.9 }],
      forward: null,
    }));
    const ex = new ProsaToReportExtractor(provider);
    await expect(
      ex.extractProsaToReports({ market_report: PROSA.market_report }, AS_OF),
    ).rejects.toBeInstanceOf(UnparseableThesis);
  });

  it('4. extraction_confidence ausente → 0.2 (penaliza enrichmentQuality)', async () => {
    const provider = mockProvider(() => ({
      reports: [{ kind: 'technical', payload: { price: 67000 } }],
      forward: null,
    }));
    const ex = new ProsaToReportExtractor(provider);
    const reports = await ex.extractProsaToReports({ market_report: PROSA.market_report }, AS_OF);
    expect(reports[0].rawConfidence).toBe(0.2);
  });

  it('5. forward real vs stub: com alvo → preenche; sem alvo → null (stub do adaptador vale)', async () => {
    const withTarget = mockProvider(() => ({
      reports: [{ kind: 'technical', payload: { price: 67000 }, extraction_confidence: 0.8 }],
      forward: { event: 'close > 41.5 em <=15d', deadline_days: 15 },
    }));
    const ex1 = new ProsaToReportExtractor(withTarget);
    await ex1.extractProsaToReports({ market_report: PROSA.market_report }, AS_OF);
    expect(await ex1.extractForward()).toEqual({ event: 'close > 41.5 em <=15d', deadline_days: 15 });

    const noTarget = mockProvider(() => ({
      reports: [{ kind: 'technical', payload: { price: 67000 }, extraction_confidence: 0.8 }],
      forward: null,
    }));
    const ex2 = new ProsaToReportExtractor(noTarget);
    await ex2.extractProsaToReports({ market_report: PROSA.market_report }, AS_OF);
    expect(await ex2.extractForward()).toBeNull();
  });

  it('5b. PATCH 2.1: adaptador delega forward real ao extractor', async () => {
    const { TradingAgentsAdapter } = await import('@/lib/trading/tradingagents-adapter');
    const provider = mockProvider(() => ({
      reports: [{ kind: 'sentiment', payload: { narrativeHeat: 0.6 }, extraction_confidence: 0.8 }],
      forward: { event: 'close > 41.5 em <=15d', deadline_days: 15 },
    }));
    const ex = new ProsaToReportExtractor(provider);
    const graph = {
      async ainvoke() {
        return {
          social_media_report: PROSA.social_media_report,
          final_trade_decision: 'We recommend Buy with high conviction this week',
        };
      },
    };
    const adapter = new TradingAgentsAdapter(
      graph, ex,
      () => ({ pass: true }),
      async () => ({
        bull_conviction: 0.3, bear_conviction: 0.3, winner: 'none' as const,
        thesis_causal: [], forward_prediction: null, veto: false,
        source: 'internal_fallback', regime_ctx_hash: 'fb', raw_confidence: 0.3,
      }),
    );
    const aux = await adapter.runDebate('PETR4.SA', {
      regime: 'reflation', regime_confidence: 0.72, p_transition_20d: 0.32,
      p_unknown_transition: 0.08, bubble_phase: 'awareness', bubble_risk: 38,
      drift_flag: false, as_of_date: '2026-09-05T12:00Z', as_of_ms: AS_OF,
    });
    expect(aux.winner).toBe('bull');
    expect(aux.forward_prediction?.needs_fill).toBeUndefined();
    expect(aux.forward_prediction?.event).toContain('41.5');
  });

  it('roteamento determinístico (descriptor): macro derivado do news_report; prosa trivial ignorada', () => {
    const blocks = routeProsaToBlocks({
      market_report: PROSA.market_report,
      news_report: PROSA.news_report,
      social_media_report: 'ok',
    });
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toContain('technical');
    expect(kinds).toContain('macro'); // derivado do news (default ALTA)
    expect(kinds).not.toContain('fundamental'); // ausente
    // sentiment = social_media_report single-key; 'ok' trivial (<40) → ausente
    expect(kinds).not.toContain('sentiment');
  });

  it('roteamento descriptor-driven: social real → sentiment; key null → ignorada', () => {
    const blocks = routeProsaToBlocks({
      social_media_report: PROSA.social_media_report,
      news_report: PROSA.news_report,
    });
    expect(blocks.map((b) => b.kind)).toEqual(expect.arrayContaining(['sentiment', 'macro']));

    // override: technical via key customizada; null ignora com segurança
    const custom = routeProsaToBlocks(
      { custom_tech: PROSA.market_report } as unknown as Parameters<typeof routeProsaToBlocks>[0],
      {
        graph_entry_keys: ['company_name', 'trade_date'],
        prosa_keys: { technical: 'custom_tech', fundamental: null, sentiment: null, macro: null },
        debate_keys: { bull: null, bear: null, judge: null },
        decision_keys: { trader: null, final: null },
        risk_keys_ignored: null,
        nodes_detected: [],
        json_mode_detected: false,
      },
    );
    expect(custom.map((b) => b.kind)).toEqual(['technical']);
  });
});
