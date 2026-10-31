/**
 * Wiring Fase 1→2→3: injeta provedor (BYOK) + grafo do fork + validator DAG + fallback.
 * Nenhum lugar aqui chama place_order (superfície de decisão é Camada 4).
 *
 * Desvio da spec: factory `buildStack` em vez de `require('openai')` no topo.
 * Motivo: `require` viola `@typescript-eslint/no-require-imports` (gate eslint 0)
 * e acoplaria o módulo ao SDK OpenAI em runtime. BYOK continua: o dev passa o
 * `LLMProvider` (openAIProvider/anthropicProvider/mockProvider de llm-extractor).
 */

import { ProsaToReportExtractor, type LLMProvider } from './llm-extractor';
import {
  TradingAgentsAdapter,
  type TAGraph,
  type RegimeCtx,
  type DebateAux,
} from './tradingagents-adapter';
import { enrichPerception, type Phase1Surface } from './perception-enrichment';

export interface StackDeps {
  provider: LLMProvider;
  graph: TAGraph;
  validateThesisDag: (thesis: string[]) => { pass: boolean; failed_edges?: string[] };
  runInternalDebate: (ctx: RegimeCtx) => Promise<DebateAux>;
  timeout_s?: number;
  forwardDefaultDays?: number;
}

export interface Stack {
  extractor: ProsaToReportExtractor;
  adapter: TradingAgentsAdapter;
  perceiveAndDebate: (
    symbol: string,
    ctx: RegimeCtx,
    primary: Parameters<typeof enrichPerception>[1],
  ) => Promise<{ surface: Phase1Surface; debate: DebateAux }>;
}

export function buildStack(deps: StackDeps): Stack {
  // 2.1) extractor (Fase 2.1)
  const extractor = new ProsaToReportExtractor(deps.provider);

  // 2) adaptador (Fase 2) — graph = compilado do TradingAgentsX (ainvoke/propagate)
  const adapter = new TradingAgentsAdapter(
    deps.graph,
    extractor,
    deps.validateThesisDag,
    deps.runInternalDebate,
    { timeout_s: deps.timeout_s ?? 45, forwardDefaultDays: deps.forwardDefaultDays ?? 20 },
  );

  // 1)+2) Fase 1: perception enrichment consome reports do extractor.
  // Nota: invoca o grafo 1x para reports + 1x dentro de runDebate.
  // Em produção, memoizar o TAGraphState por ciclo (TODO).
  async function perceiveAndDebate(
    symbol: string,
    ctx: RegimeCtx,
    primary: Parameters<typeof enrichPerception>[1],
  ): Promise<{ surface: Phase1Surface; debate: DebateAux }> {
    const raw = await invokeGraph(deps.graph, symbol, ctx.as_of_date);
    const reports = await extractor.extractProsaToReports(raw, ctx.as_of_ms);
    const surface = enrichPerception(reports, primary, symbol, ctx.as_of_ms);
    const debate = await adapter.runDebate(symbol, ctx); // DebateAux (conviction, nao prob)
    return { surface, debate }; // decisao (EV/sizing/kill) acontece na Camada 4, aqui nao
  }

  return { extractor, adapter, perceiveAndDebate };
}

async function invokeGraph(graph: TAGraph, symbol: string, tradeDate: string) {
  if (graph.ainvoke) {
    return graph.ainvoke({ company_name: symbol, trade_date: tradeDate });
  }
  if (graph.propagate) {
    return (await graph.propagate(symbol, tradeDate)) as Awaited<ReturnType<NonNullable<TAGraph['propagate']>>>;
  }
  throw new Error('graph sem ainvoke/propagate — ver manifest (B)');
}
