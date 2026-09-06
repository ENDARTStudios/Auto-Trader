/**
 * src/lib/trading/schema-descriptor.ts
 * Fase 4.1 — abstrai as keys do grafo TA p/ torná-las injetáveis.
 * Resolve a B-fim pendente por DESIGN: o roteamento nao hardcodea keys
 * que nao foram confirmadas por leitura real. Default = ALTA-por-indice;
 * o manifest (scripts/inspect_ta_schema.py) gera o descriptor exato do fork.
 *
 * Desvio da spec: `loadDescriptor` usa `import { readFileSync } from 'node:fs'`
 * no topo em vez de `require('node:fs')` inline — require viola
 * `@typescript-eslint/no-require-imports` (gate eslint 0). Semântica idêntica.
 */

import { readFileSync } from 'node:fs';

export interface SchemaDescriptor {
  graph_entry_keys: string[];
  prosa_keys: { technical: string | null; fundamental: string | null; sentiment: string | null; macro: string | null };
  debate_keys: { bull: string | null; bear: string | null; judge: string | null };
  decision_keys: { trader: string | null; final: string | null };
  risk_keys_ignored: string | null;
  nodes_detected: string[];
  json_mode_detected: boolean;
}

/**
 * DEFAULT = keys de confianca ALTA do core TauricResearch (estaveis e
 * amplamente documentadas). NAO sao "confirmadas por leitura desta sessao" —
 * sao o ponto de partida seguro. O manifest substitui por dados reais.
 * null = "nao confirmada"; o roteamento ignora com seguranca (fallback).
 */
export const DEFAULT_DESCRIPTOR: SchemaDescriptor = {
  graph_entry_keys: ['company_name', 'trade_date'],
  prosa_keys: {
    technical: 'market_report',
    fundamental: 'fundamentals_report',
    sentiment: 'social_media_report',
    macro: 'news_report', // derivado (core nao tem no macro dedicado)
  },
  debate_keys: { bull: 'bull_history', bear: 'bear_history', judge: 'judge_decision' },
  decision_keys: { trader: 'trader_plan', final: 'final_trade_decision' },
  risk_keys_ignored: 'risk_debate_state',
  nodes_detected: [],
  json_mode_detected: false,
};

/** Carrega descriptor do manifest (JSON) ou usa default. Nunca hardcodea o fork. */
export function loadDescriptor(jsonPath?: string): SchemaDescriptor {
  if (!jsonPath) return DEFAULT_DESCRIPTOR;
  try {
    const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
    // merge defensivo: so aceita keys que o manifest confirmou (nao null)
    return {
      ...DEFAULT_DESCRIPTOR,
      ...raw,
      prosa_keys: { ...DEFAULT_DESCRIPTOR.prosa_keys, ...pickNonNull(raw.prosa_keys) },
      debate_keys: { ...DEFAULT_DESCRIPTOR.debate_keys, ...pickNonNull(raw.debate_keys) },
      decision_keys: { ...DEFAULT_DESCRIPTOR.decision_keys, ...pickNonNull(raw.decision_keys) },
    };
  } catch {
    return DEFAULT_DESCRIPTOR; // manifest ausente -> default ALTA, nunca crash
  }
}
const pickNonNull = (o?: Record<string, string | null>) =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v != null));
