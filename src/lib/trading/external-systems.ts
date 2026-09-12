/**
 * Registry dos 9 sistemas externos (skills/EXTERNAL_SYSTEMS_INDEX.md).
 * Skill v1.6. Módulo PURO de doutrina: declara papel, camada e constraint
 * de cada sistema. NÃO executa, NÃO decide, NÃO dimensiona — não há
 * place_order aqui por construção (advisory-only, §0/§8c).
 *
 * Classes de licença vinculantes:
 *   permissive → uso direto permitido (só CCXT é dependência viva)
 *   copyleft    → SPEC-ONLY (nenhum código copiado — repo proprietário)
 *   fair-code   → SPEC-ONLY (Commons Clause proíbe revenda baseada)
 */

export type ExternalLayer =
  | 'perception'
  | 'debate'
  | 'backtest'
  | 'risk'
  | 'operation'
  | 'evolution'
  | 'execution'
  | 'doctrine';

export type LicenseClass = 'permissive' | 'copyleft' | 'fair-code';
export type IntegrationStatus = 'wired' | 'dependency' | 'spec-only';

export interface ExternalSystem {
  id: string;
  skillFile: string;
  repo: string;
  role: string;
  layers: ExternalLayer[];
  license: string;
  licenseClass: LicenseClass;
  status: IntegrationStatus;
  /** Regra-mãe: sempre true. Nenhum sistema externo decide/executa. */
  advisoryOnly: true;
}

export const EXTERNAL_LAYERS: ExternalLayer[] = [
  'perception', 'debate', 'backtest', 'risk',
  'operation', 'evolution', 'execution', 'doctrine',
];

export const EXTERNAL_SYSTEMS: ExternalSystem[] = [
  {
    id: 'tradingagents-tauric',
    skillFile: 'skills/ext-tradingagents-tauric.md',
    repo: 'https://github.com/vongchu/TradingAgents_TauricResearch',
    role: 'M_lang challenger + perception enrichment (Fases 1–4 wired)',
    layers: ['perception', 'debate', 'evolution'],
    license: 'Apache-2.0',
    licenseClass: 'permissive',
    status: 'wired',
    advisoryOnly: true,
  },
  {
    id: 'backtrader',
    skillFile: 'skills/ext-backtrader.md',
    repo: 'https://github.com/mementum/backtrader',
    role: 'Metodologia de backtest: Cerebro/analyzers/sizers/anti-look-ahead',
    layers: ['backtest'],
    license: 'GPL-3.0',
    licenseClass: 'copyleft',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'nautilus-agents',
    skillFile: 'skills/ext-nautilus-agents.md',
    repo: 'https://github.com/nautechsystems/nautilus_agents',
    role: 'Fronteira de autoridade advisory-only + shadow + traces versionados',
    layers: ['doctrine', 'risk'],
    license: 'LGPL-3.0',
    licenseClass: 'copyleft',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'freqtrade',
    skillFile: 'skills/ext-freqtrade.md',
    repo: 'https://github.com/freqtrade/freqtrade',
    role: 'Playbook operacional: dry-run/pairlists/protections/hyperopt/FreqAI',
    layers: ['operation', 'backtest', 'evolution'],
    license: 'GPL-3.0',
    licenseClass: 'copyleft',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'ccxt',
    skillFile: 'skills/ext-ccxt.md',
    repo: 'https://github.com/ccxt/ccxt',
    role: 'Transporte unificado 100+ exchanges (leitura pública + S14-gated)',
    layers: ['perception', 'execution'],
    license: 'MIT',
    licenseClass: 'permissive',
    status: 'dependency',
    advisoryOnly: true,
  },
  {
    id: 'vectorbt',
    skillFile: 'skills/ext-vectorbt.md',
    repo: 'https://github.com/polakowo/vectorbt',
    role: 'Varredura vetorizada 10k configs + métricas QuantStats + walk-forward',
    layers: ['evolution', 'backtest'],
    license: 'Apache-2.0 + Commons Clause',
    licenseClass: 'fair-code',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'lumibot',
    skillFile: 'skills/ext-lumibot.md',
    repo: 'https://github.com/Lumiwealth/lumibot',
    role: 'Precedente híbrido: researchers read-only + gates + memória auditável',
    layers: ['doctrine', 'debate', 'perception'],
    license: 'GPL-3.0 (badge)',
    licenseClass: 'copyleft',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'hummingbot',
    skillFile: 'skills/ext-hummingbot.md',
    repo: 'https://github.com/hummingbot/hummingbot',
    role: 'Taxonomia CLOB/AMM/CLMM + executores triple-barrier + Condor (S14-gated)',
    layers: ['execution', 'risk'],
    license: 'Apache-2.0',
    licenseClass: 'permissive',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'finrl',
    skillFile: 'skills/ext-finrl.md',
    repo: 'https://github.com/AI4Finance-Foundation/FinRL',
    role: 'Disciplina DRL train→test→trade + turbulence→regime + ensemble calibrado',
    layers: ['evolution', 'debate'],
    license: 'MIT',
    licenseClass: 'permissive',
    status: 'spec-only',
    advisoryOnly: true,
  },
];

export function getExternalSystem(id: string): ExternalSystem | null {
  return EXTERNAL_SYSTEMS.find((s) => s.id === id) ?? null;
}

/** Camadas cobertas pelo conjunto (para auditoria de lacuna). */
export function coveredLayers(): ExternalLayer[] {
  const set = new Set<ExternalLayer>();
  for (const s of EXTERNAL_SYSTEMS) for (const l of s.layers) set.add(l);
  return EXTERNAL_LAYERS.filter((l) => set.has(l));
}
