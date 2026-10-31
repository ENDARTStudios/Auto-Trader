import { describe, it, expect } from 'vitest';
import {
  TradingAgentsAdapter,
  IntegrationTimeout,
  scoreChallengerLang,
  recordForwardOutcome,
  type TAGraph,
  type LLMExtractor,
  type RegimeCtx,
  type DebateAux,
  type ChallengerLangRecord,
} from '@/lib/trading/tradingagents-adapter';

const CTX: RegimeCtx = {
  regime: 'reflation',
  regime_confidence: 0.72,
  p_transition_20d: 0.32,
  p_unknown_transition: 0.08,
  bubble_phase: 'awareness',
  bubble_risk: 38,
  drift_flag: false,
  as_of_date: '2026-09-05T12:00Z',
  as_of_ms: 1_700_000_000_000,
};

const dagPass = () => ({ pass: true });
const dagFail = () => ({ pass: false, failed_edges: ['Foo -> Bar'] });
const fallback = async (): Promise<DebateAux> => ({
  bull_conviction: 0.3,
  bear_conviction: 0.3,
  winner: 'none',
  thesis_causal: [],
  forward_prediction: null,
  veto: false,
  source: 'internal_fallback',
  regime_ctx_hash: 'fb',
  raw_confidence: 0.3,
});

// Extrator mock: prosa fake com "Buy" -> reports, sem prob de EV
const mockExtractor: LLMExtractor = {
  async extractProsaToReports() {
    return [
      { kind: 'sentiment', asOf: CTX.as_of_ms, payload: { narrativeHeat: 0.7 }, rawConfidence: 0.8 },
    ];
  },
};

function graphWith(state: Record<string, string>): TAGraph {
  return { async ainvoke() { return state; } };
}

describe('Fase 2 — tradingagents adapter (skill §0.5/2.5/5.12/4.4d/5.4)', () => {
  it('1. extrator mock: prosa com Buy → winner=bull, sem prob de EV', async () => {
    const g = graphWith({ final_trade_decision: 'We recommend Buy with high conviction' });
    const a = new TradingAgentsAdapter(g, mockExtractor, dagPass, fallback);
    const aux = await a.runDebate('PETR4.SA', CTX);
    expect(aux.winner).toBe('bull');
    expect(aux.source).toBe('tradingagents');
    expect(aux.bull_conviction).toBeGreaterThan(aux.bear_conviction);
  });

  it('2. rebaçamento §0.5: DebateAux nunca tem campo probability', async () => {
    const g = graphWith({ final_trade_decision: 'Buy now' });
    const a = new TradingAgentsAdapter(g, mockExtractor, dagPass, fallback);
    const aux = await a.runDebate('PETR4.SA', CTX);
    expect((aux as unknown as Record<string, unknown>)['probability']).toBeUndefined();
    expect((aux as unknown as Record<string, unknown>)['ev']).toBeUndefined();
  });

  it('3. DAG veto §2.5: aresta inválida → veto + rejected_thesis (não shadow)', async () => {
    const g = graphWith({
      final_trade_decision: 'Buy the dip',
      investment_plan: 'Foo causes Bar out of thin air',
    });
    const a = new TradingAgentsAdapter(g, mockExtractor, dagFail, fallback);
    const aux = await a.runDebate('PETR4.SA', CTX);
    expect(aux.veto).toBe(true);
    expect(aux.source).toContain('+dag_veto');
    expect(aux.veto_reason).toContain('dag_validation.fail');
  });

  it('4. forward §5.12c: sem alvo → needs_fill=true (pipeline exige fill ou NO_TRADE)', async () => {
    const g = graphWith({ final_trade_decision: 'Hold position' });
    const a = new TradingAgentsAdapter(g, mockExtractor, dagPass, fallback);
    const aux = await a.runDebate('PETR4.SA', CTX);
    expect(aux.forward_prediction).not.toBeNull();
    expect(aux.forward_prediction?.needs_fill).toBe(true);
    expect(aux.forward_prediction?.deadline_days).toBe(20);
  });

  it('5. kill §4.4d: timeout → IntegrationTimeout; prosa vazia → fallback', async () => {
    // timeout: grafo que nunca resolve, timeout_s curto → throw p/ caller
    const hanging: TAGraph = {
      ainvoke() { return new Promise(() => {}); },
    };
    const slow = new TradingAgentsAdapter(hanging, mockExtractor, dagPass, fallback, { timeout_s: 0.05 });
    await expect(slow.runDebate('PETR4.SA', CTX)).rejects.toBeInstanceOf(IntegrationTimeout);

    // prosa vazia: extrator retorna [] → fallback interno
    const emptyExtractor: LLMExtractor = { async extractProsaToReports() { return []; } };
    const g = graphWith({ final_trade_decision: '' });
    const a = new TradingAgentsAdapter(g, emptyExtractor, dagPass, fallback);
    const aux = await a.runDebate('PETR4.SA', CTX);
    expect(aux.source).toBe('internal_fallback');

    // falha de integração: grafo lança → fallback, nunca opera no escuro
    const broken: TAGraph = {
      async ainvoke() { throw new Error('langgraph down'); },
    };
    const b = new TradingAgentsAdapter(broken, mockExtractor, dagPass, fallback);
    expect((await b.runDebate('PETR4.SA', CTX)).source).toBe('internal_fallback');
  });

  it('6. challenger §5.4: só promove com n_min + forward>champion + dag ok', () => {
    const champ: ChallengerLangRecord = {
      version: 'internal_v10', forward_samples: [], forward_hit_rate: 0.55,
      dag_pass_rate: 0.9, eligible_for_promotion: false,
    };
    const mkTa = (hits: number, n: number, dag: number): ChallengerLangRecord => ({
      version: 'tradingagents',
      forward_samples: Array.from({ length: n }, (_, i) => ({
        episode_id: `e${i}`, lang_version: 'tradingagents',
        forward: { event: 'x', deadline_days: 20 }, hit: i < hits,
      })),
      forward_hit_rate: n ? hits / n : 0,
      dag_pass_rate: dag,
      eligible_for_promotion: false,
    });
    // amostra insuficiente → não promove
    expect(scoreChallengerLang(mkTa(5, 5, 0.95), champ, 10).eligible_for_promotion).toBe(false);
    // forward menor → não promove
    expect(scoreChallengerLang(mkTa(5, 10, 0.95), champ, 10).eligible_for_promotion).toBe(false);
    // dag piora → não promove
    expect(scoreChallengerLang(mkTa(7, 10, 0.8), champ, 10).eligible_for_promotion).toBe(false);
    // tudo ok → promove; champion nativo segue operando (não limbo)
    expect(scoreChallengerLang(mkTa(7, 10, 0.95), champ, 10).eligible_for_promotion).toBe(true);

    // recordForwardOutcome atualiza hit_rate
    const rec = recordForwardOutcome(mkTa(0, 0, 1), {
      episode_id: 'e1', lang_version: 'tradingagents',
      forward: { event: 'x', deadline_days: 20 }, hit: true,
    });
    expect(rec.forward_hit_rate).toBe(1);
    expect(rec.forward_samples.length).toBe(1);
  });

  it('7. superfície §8c: adaptador nunca expõe place_order', async () => {
    const g = graphWith({ final_trade_decision: 'Buy' });
    const a = new TradingAgentsAdapter(g, mockExtractor, dagPass, fallback);
    const anyA = a as unknown as Record<string, unknown>;
    expect(anyA['placeOrder']).toBeUndefined();
    expect(anyA['place_order']).toBeUndefined();
    expect(anyA['execute']).toBeUndefined();
    const aux = await a.runDebate('PETR4.SA', CTX);
    expect((aux as unknown as Record<string, unknown>)['placeOrder']).toBeUndefined();
  });
});
