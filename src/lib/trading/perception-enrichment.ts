/**
 * Fase 1 — TradingAgents como PERCEPTION ENRICHMENT.
 * Skill: auto-trade-bubble-macro-evolution v1.6
 * Guardrails aplicados:
 *   §0/0.5  — TA nunca produz probabilidade de EV; só sinais de percepção.
 *   §1      — MarketSnapshot + data_quality_score (gate 0.6 = stale_data).
 *   §2.2    — alimenta pilares N (Narrative Power) e R (Retail Inflow Late).
 *   §3      — alimenta variáveis-mestre macro (liquidez/juros/geopolítica).
 *   §4.4d   — consistência TA vs primário; divergência penaliza, não contamina.
 *   §8 Fase1— superfície SEM trader/risk/place_order (codificado em tipo).
 *
 * Nota de tipos: MarketSnapshot/MacroContext/SentimentVector/LiquidityState
 * da skill NÃO existem em types.ts do repo (só MarketSnapshotRow de dashboard).
 * Definidos aqui de forma autocontida e alinhada à skill §1, para manter a
 * Fase 1 desacoplada do grafo LangGraph específico (extração texto→report
 * fica no adaptador da Fase 2).
 */

export type LiquidityState = string;

export interface MacroContext {
  liquidityState?: 'flood' | 'neutral' | 'drain' | string;
  ratesDirection?: 'up' | 'flat' | 'down' | string;
  geopoliticRisk?: number;
  [key: string]: unknown;
}

export interface SentimentVector {
  narrativeHeat?: number;
  retailInflowZ?: number;
  mediaLeadLag?: number;
  [key: string]: unknown;
}

export interface BubblePillarsHint {
  N: number;
  R: number;
  M: number;
  V_hint: number;
}

export interface MarketSnapshotAsset {
  symbol: string;
  price: number;
  volume: number;
  bubblePillars: BubblePillarsHint;
}

export interface MarketSnapshot {
  timestamp: number;
  assets: MarketSnapshotAsset[];
  macro_context: Partial<MacroContext>;
  liquidity_state: LiquidityState;
  sentiment_vector: Partial<SentimentVector>;
  data_quality_score: number;
  enrichment_quality: number;
}

/* ------------------------------------------------------------------ *
 * Contrato de entrada: o que o adaptador (Fase 2) entrega por analyst.
 * A extração texto→estruturado é do adaptador; aqui AGREGAMOS + medimos
 * qualidade. Mantém Fase 1 desacoplada do grafo LangGraph específico.
 * ------------------------------------------------------------------ */
export type AnalystKind = 'technical' | 'fundamental' | 'sentiment' | 'macro';

export interface TAAnalystReport {
  kind: AnalystKind;
  asOf: number;                 // epoch ms do dado reportado
  payload: {
    // técnico/fundamental
    price?: number;
    volume?: number;
    valuationZ?: number;        // z-score de múltiplo (V)
    // sentimento
    narrativeHeat?: number;     // 0-1 ubiquidade da tese (N)
    retailInflowZ?: number;     // z-score de entrada novato (R)
    mediaLeadLag?: number;      // Granger notícia→preço (M)
    // macro
    liquidityState?: 'flood' | 'neutral' | 'drain';
    ratesDirection?: 'up' | 'flat' | 'down';
    geopoliticRisk?: number;    // 0-1
  };
  rawConfidence: number;        // 0-1 auto-confiança do LLM extractor
}

/* ------------------------------------------------------------------ *
 * Saída da Fase 1: enriquecimento + qualidade, SEM decisão.
 * ------------------------------------------------------------------ */
export interface PerceptionEnrichment {
  narrativePower: number;       // pilar N (0-100)
  retailInflowLate: number;     // pilar R (0-100)
  reflexivityMedia: number;     // pilar M (0-100)
  valuationDisconnectHint: number; // insumo V (0-100), não final
  macroContext: Partial<MacroContext>;
  sentimentVector: Partial<SentimentVector>;
  enrichmentQuality: number;    // 0-1 confiança do TA (não gate de abort)
  coverage: number;             // fração de analysts válidos
}

/* ------------------------------------------------------------------ *
 * GUARDRAIL DE FASE 1 codificado em tipo:
 * A superfície exposta NÃO tem trader, risk manager, ordem ou prob.
 * Qualquer tentativa de decidir a partir daqui é erro de compilação.
 * ------------------------------------------------------------------ */
export interface Phase1Surface {
  readonly perception: PerceptionEnrichment;
  readonly snapshot: MarketSnapshot;
  readonly stale: boolean;      // só do PRIMÁRIO (§1 gate 0.6)
  // NÃO há: trader, risk, placeOrder, probability, decision.
}

/* ------------------------------------------------------------------ *
 * Parâmetros de qualidade (ajustáveis em config/risk_config.json).
 * ------------------------------------------------------------------ */
export interface QualityConfig {
  maxAgeMs: Record<AnalystKind, number>; // frescura por classe
  priceToleranceRel: number;             // divergência TA vs primário
  abortGatePrimary: number;              // 0.6 (§1)
}

const DEFAULT_QC: QualityConfig = {
  maxAgeMs: {
    technical: 5 * 60_000,      // preço decai rápido
    fundamental: 7 * 86_400_000,
    sentiment: 24 * 3_600_000,
    macro: 7 * 86_400_000,
  },
  priceToleranceRel: 0.02,      // 2%
  abortGatePrimary: 0.6,
};

/* ------------------------------------------------------------------ *
 * FUNÇÃO PRINCIPAL DA FASE 1.
 * Recebe reports do TA + feeds primários → devolve Phase1Surface.
 * Decisão (EV/sizing/kill) NÃO acontece aqui — é Camada 4.
 * ------------------------------------------------------------------ */
export function enrichPerception(
  reports: TAAnalystReport[],
  primary: {
    lastPrice: number;
    lastVolume: number;
    liquidity: LiquidityState;
    macro: MacroContext;
    dataQualityPrimary: number; // já calculado pelos feeds obrigatórios
  },
  symbol: string,
  asOf: number,
  qc: QualityConfig = DEFAULT_QC,
): Phase1Surface {
  const valid = reports.filter((r) => isFresh(r, asOf, qc));
  const coverage = reports.length ? valid.length / reports.length : 0;

  // --- consistência TA vs primário (§4.4d aplicado a dado) ---
  const priceDivergence = checkPriceConsistency(valid, primary.lastPrice, qc);

  // --- extração estruturada dos pilares ---
  const narrativePower = aggregatePillar(valid, 'narrativeHeat', 100);
  const retailInflowLate = aggregatePillar(valid, 'retailInflowZ', 100, true);
  const reflexivityMedia = aggregatePillar(valid, 'mediaLeadLag', 100);
  const valuationHint = aggregatePillar(valid, 'valuationZ', 100, true);

  const macroContext = buildMacroContext(valid, primary.macro);
  const sentimentVector = buildSentimentVector(valid);

  // --- qualidade do ENRIQUECIMENTO (não gate de abort) ---
  const enrichmentQuality = computeEnrichmentQuality(
    valid, coverage, priceDivergence, asOf, qc,
  );

  // --- snapshot final: preço/liquidez do PRIMÁRIO, N/R do TA ---
  const snapshot: MarketSnapshot = {
    timestamp: asOf,
    assets: [{
      symbol,
      price: primary.lastPrice,
      volume: primary.lastVolume,
      // pilares alimentados pela Camada 2.2 a partir daqui:
      bubblePillars: {
        N: narrativePower,
        R: retailInflowLate,
        M: reflexivityMedia,
        V_hint: valuationHint,
      },
    }],
    macro_context: macroContext,
    liquidity_state: primary.liquidity,
    sentiment_vector: sentimentVector,
    // gate §1: dominado pelo PRIMÁRIO; TA é opcional (sentiment-feed optional).
    data_quality_score: primary.dataQualityPrimary,
    // meta de confiança do enriquecimento, para o Juiz (§4.5) ponderar N/R:
    enrichment_quality: enrichmentQuality,
  };

  const surface: Phase1Surface = {
    perception: {
      narrativePower,
      retailInflowLate,
      reflexivityMedia,
      valuationDisconnectHint: valuationHint,
      macroContext,
      sentimentVector,
      enrichmentQuality,
      coverage,
    },
    snapshot,
    stale: primary.dataQualityPrimary < qc.abortGatePrimary,
  };
  return surface;
}

/* ===================== helpers ===================== */

function isFresh(r: TAAnalystReport, asOf: number, qc: QualityConfig): boolean {
  return asOf - r.asOf <= qc.maxAgeMs[r.kind];
}

/**
 * Média ponderada por frescura + auto-confiança do extractor.
 * `zScore=true` normaliza z-score → 0-100 (sigmoid suave).
 */
function aggregatePillar(
  valid: TAAnalystReport[],
  key: keyof TAAnalystReport['payload'],
  scale: number,
  zScore = false,
): number {
  const vals = valid
    .map((r) => r.payload[key])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!vals.length) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (zScore) return clamp01to100(1 / (1 + Math.exp(-mean))); // z→[0,100]
  void scale;
  return clamp01to100(mean);
}

/** divergência relativa de preço TA vs primário (§4.4d). */
function checkPriceConsistency(
  valid: TAAnalystReport[],
  primaryPrice: number,
  qc: QualityConfig,
): number {
  const tech = valid.filter((r) => r.kind === 'technical' && r.payload.price);
  if (!tech.length || !primaryPrice) return 0;
  const taPrice = tech[0].payload.price as number;
  const rel = Math.abs(taPrice - primaryPrice) / primaryPrice;
  return rel > qc.priceToleranceRel ? Math.min(1, rel) : 0;
}

function computeEnrichmentQuality(
  valid: TAAnalystReport[],
  coverage: number,
  priceDivergence: number,
  asOf: number,
  qc: QualityConfig,
): number {
  if (!valid.length) return 0;
  const avgConf = valid.reduce((a, r) => a + r.rawConfidence, 0) / valid.length;
  const freshness = valid.reduce((a, r) => {
    const age = asOf - r.asOf;
    return a + Math.exp(-age / qc.maxAgeMs[r.kind]);
  }, 0) / valid.length;
  // penalidade por divergência de preço (TA desatualizado vs broker).
  const consistency = 1 - priceDivergence;
  const score = 0.4 * coverage + 0.3 * freshness + 0.2 * avgConf + 0.1 * consistency;
  return clamp01(score);
}

function buildMacroContext(
  valid: TAAnalystReport[],
  primary: MacroContext,
): Partial<MacroContext> {
  const macro = valid.find((r) => r.kind === 'macro');
  if (!macro) return {};
  return {
    liquidityState: macro.payload.liquidityState ?? primary.liquidityState,
    ratesDirection: macro.payload.ratesDirection ?? primary.ratesDirection,
    geopoliticRisk: macro.payload.geopoliticRisk ?? primary.geopoliticRisk,
  };
}

function buildSentimentVector(
  valid: TAAnalystReport[],
): Partial<SentimentVector> {
  const sent = valid.find((r) => r.kind === 'sentiment');
  if (!sent) return {};
  return {
    narrativeHeat: sent.payload.narrativeHeat,
    retailInflowZ: sent.payload.retailInflowZ,
    mediaLeadLag: sent.payload.mediaLeadLag,
  };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const clamp01to100 = (x: number) => Math.max(0, Math.min(100, x * 100));
