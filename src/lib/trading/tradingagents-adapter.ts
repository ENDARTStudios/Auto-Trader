/**
 * Fase 2 — TradingAgents como M_lang (challenger/debate insumo).
 * Skill: auto-trade-bubble-macro-evolution v1.6
 *
 * ACHADO DA FASE B: o TA core emite PROSA, não JSON numérico.
 * Logo este adaptador tem 2 camadas:
 *   (1) LLMExtractor: prosa do grafo TA -> TAAnalystReport[] (Fase 1 types)
 *   (2) guardrails: rebaçar confidence->conviction (0.5), validar DAG (2.5),
 *       exigir forward (5.12), kill de integracao (4.4d), nunca place_order (8c).
 *
 * O M_param (Camada 4/5) continua sendo a UNICA fonte de probabilidade/EV.
 *
 * TODOs do manifest (B): travar keys do TAGraphState no repo real do fork
 * TradingAgentsX (investment_debate_state, risk_debate_state, trader_plan,
 * final_trade_decision) + decidir se o fork expõe JSON-mode (extrator opcional).
 * Até lá, tudo é DEFENSIVO: campos ausentes -> undefined -> rawConfidence baixo
 * -> enrichmentQuality cai -> Juiz reduz convicção (§4.4d degrada, nunca opera
 * no escuro).
 */

import type { TAAnalystReport } from './perception-enrichment';
import type { SchemaDescriptor } from './schema-descriptor';
import { DEFAULT_DESCRIPTOR, loadDescriptor } from './schema-descriptor';

/* ------------------------------------------------------------------ *
 * 1. Contrato do grafo LangGraph (do fork). Ajustar keys apos o
 *    manifest de verificacao humana (B). Tudo aqui e DEFENSIVO:
 *    campos ausentes -> undefined -> extractor marca rawConfidence baixo.
 *
 * TODO(manifest-B): confirmar no repo real:
 *  - nomes exatos de investment_debate_state/risk_debate_state keys
 *  - assinatura ainvoke/propagate + shape de entrada
 *  - se fork X expoe JSON-mode (extrator vira opcional)
 * ------------------------------------------------------------------ */
export interface TAGraphState {
  company_name?: string;
  trade_date?: string;
  // saidas de prosa dos nos (nomes a confirmar no repo)
  market_report?: string;
  fundamentals_report?: string;
  news_report?: string;
  social_media_report?: string;
  investment_debate_state?: {
    bull_history?: string;
    bear_history?: string;
    history?: string;
    judge_decision?: string;
  };
  investment_plan?: string;
  trader_plan?: string;
  risk_debate_state?: {
    aggressive_history?: string;
    conservative_history?: string;
    neutral_history?: string;
    judge_decision?: string;
  };
  final_trade_decision?: string;
}

export interface TAGraph {
  ainvoke(state: Record<string, unknown>): Promise<TAGraphState>;
  // alguns forks expoe propagate(ticker, date) -> state
  propagate?(ticker: string, date?: string): Promise<TAGraphState> | TAGraphState;
}

/* ------------------------------------------------------------------ *
 * 2. Extrator LLM injetavel: prosa -> TAAnalystReport[] (JSON mode).
 *    Implementacao real = call ao provedor com JSON schema abaixo.
 *    rawConfidence vem DO EXTRACTOR (autoconfianca da extracao),
 *    NAO do TA — e o que o enrichmentQuality penaliza (Fase 1).
 * ------------------------------------------------------------------ */
export interface LLMExtractor {
  extractProsaToReports(
    state: TAGraphState,
    asOf: number,
    descriptor?: SchemaDescriptor,
  ): Promise<TAAnalystReport[]>;
  /** PATCH 2.1 (Fase 2.1): forward real se o extractor achou alvo/prazo; senão null (stub vale). */
  extractForward?(state: TAGraphState): Promise<{ event: string; deadline_days: number } | null>;
}

/* ------------------------------------------------------------------ *
 * 3. DebateAux: saida do debate (rebaçada, sem prob de EV).
 *    §0.5: NUNCA tem campo probability — convicção auxiliar apenas.
 * ------------------------------------------------------------------ */
export interface DebateAux {
  bull_conviction: number;
  bear_conviction: number;
  winner: 'bull' | 'bear' | 'none';
  thesis_causal: string[];
  forward_prediction: { event: string; deadline_days: number; needs_fill?: boolean } | null;
  veto: boolean;
  veto_reason?: string;
  source: string;
  regime_ctx_hash: string;
  raw_confidence: number; // do extractor, p/ enrichmentQuality
}

export class IntegrationTimeout extends Error {}
export class UnparseableThesis extends Error {}

/* ------------------------------------------------------------------ *
 * 4. Adaptador principal.
 * ------------------------------------------------------------------ */
export interface AdapterConfig {
  timeout_s?: number;
  forwardDefaultDays?: number;
  /** Fase 4.1: descriptor injetado (manifest) ou path p/ JSON; default = ALTA-por-indice. */
  descriptor?: SchemaDescriptor;
  descriptorJsonPath?: string;
}

export class TradingAgentsAdapter {
  private readonly timeout_s: number;
  private readonly forwardDefaultDays: number;
  private readonly descriptor: SchemaDescriptor;

  constructor(
    private readonly graph: TAGGraph,
    private readonly extractor: LLMExtractor,
    private readonly dagValidator: (thesis: string[]) => { pass: boolean; failed_edges?: string[] },
    private readonly fallbackDebate: (ctx: RegimeCtx) => Promise<DebateAux>,
    cfg: AdapterConfig = {},
  ) {
    this.timeout_s = cfg.timeout_s ?? 45;
    this.forwardDefaultDays = cfg.forwardDefaultDays ?? 20;
    this.descriptor = cfg.descriptor ?? (cfg.descriptorJsonPath ? loadDescriptor(cfg.descriptorJsonPath) : DEFAULT_DESCRIPTOR);
  }

  /** Injeta contexto da Camada 3 (3.6 obrigatorio). */
  private buildState(symbol: string, ctx: RegimeCtx): Record<string, unknown> {
    return {
      company_name: symbol,
      trade_date: ctx.as_of_date,
      // prompt de contexto: o fork pode nao ter campo nativo -> injetamos
      // via instrucao no state (ajustar conforme repo). Sem isso, debate
      // roda "no escuro" e e invalido (3.6).
      regime_context: JSON.stringify({
        regime: ctx.regime,
        regime_confidence: ctx.regime_confidence,
        p_transition_20d: ctx.p_transition_20d,
        p_unknown_transition: ctx.p_unknown_transition,
        bubble_phase: ctx.bubble_phase,
        bubble_risk: ctx.bubble_risk,
        drift_flag: ctx.drift_flag,
      }),
    };
  }

  /** Converte prosa do TA em DebateAux, REBACANDO confidence->conviction (0.5). */
  private async toDebateAux(
    state: TAGraphState,
    asOf: number,
    ctxHash: string,
  ): Promise<DebateAux> {
    // (a) prosa -> reports estruturados (extrator LLM, JSON mode; descriptor injetado Fase 4.1)
    const reports = await this.extractor.extractProsaToReports(state, asOf, this.descriptor);
    if (!reports.length) throw new UnparseableThesis('extractor retornou vazio');

    // (b) conviccao = media ponderada do rawConfidence do extractor (NAO prob)
    const avgConf = reports.reduce((a, r) => a + r.rawConfidence, 0) / reports.length;

    // (c) winner/direcao: extrator marca direcao da tese (action em prosa)
    const dir = this.inferDirection(state); // 'bull'|'bear'|'none'
    const bullConv = dir === 'bull' ? clamp01(avgConf) : clamp01(avgConf * 0.3);
    const bearConv = dir === 'bear' ? clamp01(avgConf) : clamp01(avgConf * 0.3);

    // (d) tese causal: prosa do debate/juiz (mapeada p/ DAG depois)
    const thesis = this.collectThesis(state);

    // (e) forward obrigatorio (5.12c): sem alvo/prazo -> needs_fill
    const forward = await this.extractForward(state);

    return {
      bull_conviction: round2(bullConv),
      bear_conviction: round2(bearConv),
      winner: dir,
      thesis_causal: thesis,
      forward_prediction: forward,
      veto: false,
      source: 'tradingagents',
      regime_ctx_hash: ctxHash,
      raw_confidence: round2(avgConf),
    };
  }

  private inferDirection(state: TAGraphState): 'bull' | 'bear' | 'none' {
    const txt = (state.final_trade_decision ?? state.trader_plan ?? '').toLowerCase();
    if (/\b(buy|long)\b/.test(txt)) return 'bull';
    if (/\b(sell|short)\b/.test(txt)) return 'bear';
    return 'none';
  }

  private collectThesis(state: TAGraphState): string[] {
    const out: string[] = [];
    const judge = state.investment_debate_state?.judge_decision;
    if (judge) out.push(judge);
    if (state.investment_plan) out.push(state.investment_plan);
    return out.filter(Boolean);
  }

  private async extractForward(state: TAGraphState): Promise<DebateAux['forward_prediction']> {
    // PATCH 2.1: delega ao extractor concreto (Fase 2.1) se ele extraiu alvo/prazo real.
    const real = await this.extractor.extractForward?.(state);
    if (real) return { event: real.event, deadline_days: real.deadline_days };
    // senão, stub obrigatório: agente DEVE preencher, ou NO_TRADE (5.12c).
    return {
      event: 'PREENCHER: close > alvo em <=N dias (extrair do final_trade_decision)',
      deadline_days: this.forwardDefaultDays,
      needs_fill: true,
    };
  }

  /** Valida DAG (2.5) antes de aceitar a tese. Fail -> veto (rejected_thesis). */
  private validateDag(aux: DebateAux): DebateAux {
    if (!aux.thesis_causal.length) return aux;
    const res = this.dagValidator(aux.thesis_causal);
    if (!res.pass) {
      aux.veto = true;
      aux.veto_reason = `dag_validation.fail: ${res.failed_edges?.join(', ')}`;
      aux.source += '+dag_veto';
    }
    return aux;
  }

  /** API principal: run_debate com kill de integracao + fallback. */
  async runDebate(symbol: string, ctx: RegimeCtx): Promise<DebateAux> {
    const ctxHash = hashCtx(ctx);
    const state = this.buildState(symbol, ctx);
    let raw: TAGraphState;
    try {
      raw = await withTimeout(this.invoke(state), this.timeout_s * 1000);
    } catch (e) {
      if (e instanceof IntegrationTimeout) throw e; // propaga p/ fallback no caller
      // falha de integracao -> fallback interno, NAO opera no escuro (4.4d)
      return this.fallbackDebate(ctx);
    }

    let aux: DebateAux;
    try {
      aux = await this.toDebateAux(raw, ctx.as_of_ms, ctxHash);
    } catch (e) {
      if (e instanceof UnparseableThesis) {
        // prosa ilegivel -> fallback (TA sem saida util = dado invalido)
        return this.fallbackDebate(ctx);
      }
      throw e;
    }
    return this.validateDag(aux);
  }

  private async invoke(state: Record<string, unknown>): Promise<TAGraphState> {
    if (this.graph.ainvoke) return this.graph.ainvoke(state);
    if (this.graph.propagate) {
      const r = await this.graph.propagate(String(state.company_name), state.trade_date as string);
      return r as TAGraphState;
    }
    throw new Error('graph sem ainvoke/propagate — ver manifest (B)');
  }
}

/* ------------------------------------------------------------------ *
 * 5. No challenger_lang_tradingagents (5.4): TA vira UM challenger_lang,
 *    promovido por forward_hit_rate OOS (5.12), NAO por red-team.
 *    Champion em producao nunca fica em limbo (5.12b).
 * ------------------------------------------------------------------ */
export interface ForwardOutcome {
  episode_id: string;
  lang_version: string; // 'tradingagents' | 'internal_vNN'
  forward: { event: string; deadline_days: number };
  hit: boolean; // resolvido apos prazo
}

export interface ChallengerLangRecord {
  version: string;
  forward_samples: ForwardOutcome[];
  forward_hit_rate: number; // out-of-sample
  dag_pass_rate: number;
  eligible_for_promotion: boolean;
}

/**
 * Calcula elegibilidade do challenger TA (5.4/5.12).
 * Promove so se forward_hit_rate OOS supera champion + dag_pass nao piora,
 * com amostra minima (n_min) e latencia declarada (5.12b).
 */
export function scoreChallengerLang(
  ta: ChallengerLangRecord,
  champion: ChallengerLangRecord,
  nMin: number,
): ChallengerLangRecord {
  const hasEnough = ta.forward_samples.length >= nMin;
  const forwardWins = ta.forward_hit_rate > champion.forward_hit_rate;
  const dagOk = ta.dag_pass_rate >= champion.dag_pass_rate;
  return {
    ...ta,
    eligible_for_promotion: hasEnough && forwardWins && dagOk,
  };
}

/**
 * Hook do loop 5.4: ao resolver um forward OOS, atualiza o record do TA.
 * (Chamado pelo cron diario da skill, secao 7.)
 */
export function recordForwardOutcome(
  ta: ChallengerLangRecord,
  outcome: ForwardOutcome,
): ChallengerLangRecord {
  const samples = [...ta.forward_samples, outcome];
  const hits = samples.filter((s) => s.hit).length;
  return {
    ...ta,
    forward_samples: samples,
    forward_hit_rate: samples.length ? hits / samples.length : 0,
  };
}

/* ------------------------------------------------------------------ *
 * helpers / tipos de contexto (Camada 3)
 * ------------------------------------------------------------------ */
export interface RegimeCtx {
  regime: string;
  regime_confidence: number;
  p_transition_20d: number;
  p_unknown_transition: number;
  bubble_phase: string;
  bubble_risk: number;
  drift_flag: boolean;
  as_of_date: string;
  as_of_ms: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

function hashCtx(ctx: RegimeCtx): string {
  // hash estavel do contexto p/ auditoria (regime_ctx_hash, 4.5)
  const s = `${ctx.regime}|${ctx.bubble_phase}|${ctx.bubble_risk}|${ctx.drift_flag}|${ctx.as_of_date}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new IntegrationTimeout('TA timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
