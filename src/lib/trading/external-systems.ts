/**
 * Registry dos 20 sistemas externos (skills/EXTERNAL_SYSTEMS_INDEX.md).
 * Skill v1.6. Módulo PURO de doutrina: declara papel, camada e constraint
 * de cada sistema. NÃO executa, NÃO decide, NÃO dimensiona — não há
 * place_order aqui por construção (advisory-only, §0/§8c).
 *
 * Categorias: trading (motores/venues de trade) + agent-infra (memória,
 * harness, coleta, diagramas, red-team — a meta-camada do agente).
 *
 * Classes de licença vinculantes:
 *   permissive → uso direto permitido (só CCXT é dependência viva)
 *   copyleft    → SPEC-ONLY (nenhum código copiado — repo proprietário)
 *   fair-code   → SPEC-ONLY (Commons Clause proíbe revenda baseada)
 *   unverified  → SPEC-ONLY por precaução até confirmação da licença
 */

export type SystemCategory = 'trading' | 'agent-infra';

export type ExternalLayer =
  | 'perception'
  | 'debate'
  | 'backtest'
  | 'risk'
  | 'operation'
  | 'evolution'
  | 'execution'
  | 'doctrine'
  | 'docs';

export type LicenseClass = 'permissive' | 'copyleft' | 'fair-code' | 'unverified';
export type IntegrationStatus = 'wired' | 'dependency' | 'spec-only';

export interface ExternalSystem {
  id: string;
  skillFile: string;
  repo: string;
  role: string;
  category: SystemCategory;
  layers: ExternalLayer[];
  license: string;
  licenseClass: LicenseClass;
  status: IntegrationStatus;
  /** Regra-mãe: sempre true. Nenhum sistema externo decide/executa. */
  advisoryOnly: true;
}

export const EXTERNAL_LAYERS: ExternalLayer[] = [
  'perception', 'debate', 'backtest', 'risk',
  'operation', 'evolution', 'execution', 'doctrine', 'docs',
];

export const EXTERNAL_SYSTEMS: ExternalSystem[] = [
  {
    id: 'tradingagents-tauric',
    skillFile: 'skills/ext-tradingagents-tauric.md',
    repo: 'https://github.com/vongchu/TradingAgents_TauricResearch',
    category: 'trading',
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
    category: 'trading',
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
    category: 'trading',
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
    category: 'trading',
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
    category: 'trading',
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
    category: 'trading',
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
    category: 'trading',
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
    category: 'trading',
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
    category: 'trading',
    role: 'Disciplina DRL train→test→trade + turbulence→regime + ensemble calibrado',
    layers: ['evolution', 'debate'],
    license: 'MIT',
    licenseClass: 'permissive',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'codebase-memory-mcp',
    skillFile: 'skills/agent-codebase-memory-mcp.md',
    repo: 'https://github.com/DeusData/codebase-memory-mcp',
    category: 'agent-infra',
    role: 'Graph-first validado: knowledge graph + MCP, gêmeo do graft/',
    layers: ['doctrine'],
    license: 'MIT',
    licenseClass: 'permissive',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'agency-agents',
    skillFile: 'skills/agent-agency-agents.md',
    repo: 'https://github.com/msitarzewski/agency-agents',
    category: 'agent-infra',
    role: 'Personas especialistas (Finance/Security/Testing) p/ debate/red-team/teste',
    layers: ['debate', 'doctrine'],
    license: 'MIT',
    licenseClass: 'permissive',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'agentmemory',
    skillFile: 'skills/agent-agentmemory.md',
    repo: 'https://github.com/rohitg00/agentmemory',
    category: 'agent-infra',
    role: 'Memória 4-tier + RRF + privacy-first (≈ §5.2)',
    layers: ['doctrine'],
    license: 'Apache-2.0',
    licenseClass: 'permissive',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'openviking-plugins',
    skillFile: 'skills/agent-openviking-plugins.md',
    repo: 'https://github.com/Castor6/openviking-plugins',
    category: 'agent-infra',
    role: 'Precedente mínimo recall/capture hooks (menor, Claude-only)',
    layers: ['doctrine'],
    license: 'Apache-2.0',
    licenseClass: 'permissive',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'browser-use',
    skillFile: 'skills/agent-browser-use.md',
    repo: 'https://github.com/browser-use/browser-use',
    category: 'agent-infra',
    role: 'Coleta web read-only sandboxed p/ ETL/sentimento',
    layers: ['perception'],
    license: 'MIT',
    licenseClass: 'permissive',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'harness-engineering',
    skillFile: 'skills/agent-harness-engineering.md',
    repo: 'https://github.com/ai-boost/awesome-harness-engineering',
    category: 'agent-infra',
    role: 'Catálogo de doutrina harness (loops/contexto/permissões/evals)',
    layers: ['doctrine'],
    license: 'NOASSERTION (Other, via API GitHub)',
    licenseClass: 'unverified',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'diagram-design',
    skillFile: 'skills/agent-diagram-design.md',
    repo: 'https://github.com/cathrynlavery/diagram-design',
    category: 'agent-infra',
    role: 'Padrão de diagramas editoriais p/ ARCHITECTURE/UML',
    layers: ['docs'],
    license: 'MIT',
    licenseClass: 'permissive',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'scientific-skills',
    skillFile: 'skills/agent-scientific-skills.md',
    repo: 'https://github.com/K-Dense-AI/scientific-agent-skills',
    category: 'agent-infra',
    role: 'Falsificação validada + FRED macro + TimesFM/PyMC challengers',
    layers: ['evolution', 'perception'],
    license: 'MIT',
    licenseClass: 'permissive',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'agent-reach',
    skillFile: 'skills/agent-agent-reach.md',
    repo: 'https://github.com/Panniantong/Agent-Reach',
    category: 'agent-infra',
    role: 'Coleta social N/R/M (Twitter/Reddit/YouTube/Bilibili/Xiaohongshu/RSS)',
    layers: ['perception'],
    license: 'MIT',
    licenseClass: 'permissive',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'strix',
    skillFile: 'skills/agent-strix.md',
    repo: 'https://github.com/usestrix/strix',
    category: 'agent-infra',
    role: 'Doutrina red-team PoC-validado + CI gate',
    layers: ['risk', 'operation'],
    license: 'Apache-2.0',
    licenseClass: 'permissive',
    status: 'spec-only',
    advisoryOnly: true,
  },
  {
    id: 'mirofish',
    skillFile: 'skills/agent-mirofish.md',
    repo: 'https://github.com/DragonJAR/MiroFish-ES',
    category: 'agent-infra',
    role: 'Enxame simulador: cenários/teses p/ debate + choques p/ gerador (nunca prob)',
    layers: ['debate', 'evolution'],
    license: 'AGPL-3.0',
    licenseClass: 'copyleft',
    status: 'spec-only',
    advisoryOnly: true,
  },
];

export function getExternalSystem(id: string): ExternalSystem | null {
  return EXTERNAL_SYSTEMS.find((s) => s.id === id) ?? null;
}

/** Sistemas por categoria (trading vs agent-infra). */
export function byCategory(category: SystemCategory): ExternalSystem[] {
  return EXTERNAL_SYSTEMS.filter((s) => s.category === category);
}

/** Camadas cobertas pelo conjunto (para auditoria de lacuna). */
export function coveredLayers(): ExternalLayer[] {
  const set = new Set<ExternalLayer>();
  for (const s of EXTERNAL_SYSTEMS) for (const l of s.layers) set.add(l);
  return EXTERNAL_LAYERS.filter((l) => set.has(l));
}
