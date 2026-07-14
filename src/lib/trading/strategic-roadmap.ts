// Strategic Roadmap — tracks the operator's vision for the bot as a list of
// capabilities with status + completion %. Renders as a progress board in
// the dashboard's "Estratégia" tab.
//
// v16: The vision (from operator, translated from PT-BR):
//   1. Fee-aware execution — avoid losses from fees, find best buy/sell timing
//   2. 50/50 reserve allocation — 50% gains to safety, 50% to new investments
//   3. Buy low, sell high
//   4. Senior analyst — leverage market volatility
//   5. Day Trading mastery
//   6. Scalping mastery
//   7. Swing Trading mastery
//   8. Copy Trading
//   9. Automation
//  10. Risk Management
//  11. Education & Discipline
//  12. Diversification between active operations
//  13. Scale by success rate
//  14. Connect digital wallet (maximum security)
//  15. Connect to exchanges and execute operations
//
// Each capability is seeded on first run and can be updated by the operator
// (status, completionPct, notes).

import { db } from "@/lib/db";
import { logger } from "./logger";

export type CapabilityCategory =
  | "execution"
  | "strategy"
  | "risk"
  | "security"
  | "ops";

export type CapabilityStatus =
  | "planned"
  | "in_progress"
  | "shipped"
  | "blocked";

export interface StrategicCapabilityRow {
  id: string;
  category: CapabilityCategory;
  title: string;
  description: string;
  status: CapabilityStatus;
  completionPct: number;
  notes: string | null;
  sortOrder: number;
  updatedAt: string;
}

// Initial seed data — reflects v16 state of the bot.
// As features are implemented, these statuses are updated.
const SEED_CAPABILITIES: Array<{
  id: string;
  category: CapabilityCategory;
  title: string;
  description: string;
  status: CapabilityStatus;
  completionPct: number;
  notes?: string;
  sortOrder: number;
}> = [
  {
    id: "fee-aware-execution",
    category: "execution",
    title: "Fee-Aware Execution",
    description:
      "Modelo de taxas transparente: cada trade calcula fee + slippage em ambos os lados. Posições só abrem se TP cobrir o custo round-trip com margem 3x. Net P&L rastreado por posição.",
    status: "shipped",
    completionPct: 100,
    notes: "v16 — fee-model.ts + FeeAuditLog table + fee gate no engine",
    sortOrder: 10,
  },
  {
    id: "reserve-allocation",
    category: "risk",
    title: "Reserva 50/50",
    description:
      "50% do lucro de cada round vai para reserva USDC cold storage (só sai com saque manual); 50% reinvestido no próximo round. Reserva nunca é auto-tradeada.",
    status: "shipped",
    completionPct: 100,
    notes: "v1 — portfolio.ts rebalanceRound()",
    sortOrder: 20,
  },
  {
    id: "buy-low-sell-high",
    category: "execution",
    title: "Buy Low, Sell High",
    description:
      "TP/SL por estratégia (scalp 3%/1.5%, day 8%/4%, swing 20%/10%). Engine só compra tokens que passaram 4 camadas de análise (scam + GoPlus + market + AI).",
    status: "shipped",
    completionPct: 100,
    notes: "v2 + v16 — STRATEGY_PROFILES no portfolio.ts",
    sortOrder: 30,
  },
  {
    id: "volatility-analyst",
    category: "strategy",
    title: "Senior Analyst — Volatility Capture",
    description:
      "RSI(14) + MACD + EMA(20/50) + Bollinger Bands + Fear & Greed Index + CoinGecko trending. Composite signal 0-100 com labels strong_buy/buy/neutral/sell/strong_sell. AI thesis squad valida cada setup.",
    status: "shipped",
    completionPct: 100,
    notes: "v2 — market-analysis.ts + ai-agent.ts",
    sortOrder: 40,
  },
  {
    id: "scalping",
    category: "strategy",
    title: "Scalping",
    description:
      "Estratégia scalp: TP 3%, SL 1.5%, hold 5-30min. Alto throughput, captura movimentos intraday de baixa magnitude. Sujeito a fee gate (TP deve cobrir round-trip cost).",
    status: "shipped",
    completionPct: 90,
    notes: "v16 — STRATEGY_PROFILES.scalp",
    sortOrder: 50,
  },
  {
    id: "day-trading",
    category: "strategy",
    title: "Day Trading",
    description:
      "Estratégia day: TP 8%, SL 4%, hold 1-4h. Capture movimentos intraday de magnitude média. Balanceia frequência e qualidade.",
    status: "shipped",
    completionPct: 90,
    notes: "v16 — STRATEGY_PROFILES.day (default)",
    sortOrder: 60,
  },
  {
    id: "swing-trading",
    category: "strategy",
    title: "Swing Trading",
    description:
      "Estratégia swing: TP 20%, SL 10%, hold 4-24h. Captura tendências multi-dia, menos sensível a ruído intraday.",
    status: "shipped",
    completionPct: 90,
    notes: "v16 — STRATEGY_PROFILES.swing",
    sortOrder: 70,
  },
  {
    id: "copy-trading",
    category: "strategy",
    title: "Copy Trading",
    description:
      "Replicar operações de traders de referência (ainda não implementado). Requer integração com plataforma de copy trading (eToro / Bybit Copy / MEXC).",
    status: "planned",
    completionPct: 0,
    notes: "Roadmap v18+",
    sortOrder: 80,
  },
  {
    id: "automation",
    category: "ops",
    title: "Automação",
    description:
      "Engine roda em loop automático (60s tick) com state machine SCOUT → ANALYZE → EXECUTE → MONITOR → EXIT → REBALANCE. Schedule window, circuit breakers, kill switch, notifications tudo automatizado.",
    status: "shipped",
    completionPct: 100,
    notes: "v1-v15 — engine.ts + schedule.ts + notifier.ts",
    sortOrder: 90,
  },
  {
    id: "risk-management",
    category: "risk",
    title: "Gerenciamento de Risco",
    description:
      "5 circuit breakers (kill switch, daily loss, per-trade loss, exposure per token, drawdown). Consecutive loss circuit breaker (5L → pause 1h). Risk scaling dinâmico por win rate (0.5x-1.5x). Diversificação per-symbol/chain/strategy.",
    status: "shipped",
    completionPct: 100,
    notes: "v1 + v14 + v16 — risk-manager.ts + risk-scaling.ts + diversification.ts",
    sortOrder: 100,
  },
  {
    id: "education-discipline",
    category: "ops",
    title: "Educação e Disciplina",
    description:
      "Painel de Roadmap Estratégico (este painel) + tooltips explicativos em cada componente + audit trail completo (cada decisão é logada com contexto). Disciplina imposta pelo fee gate e circuit breakers — engine não abre trade marginal mesmo se operador quiser.",
    status: "shipped",
    completionPct: 80,
    notes: "v16 — painel Roadmap; faltam tutoriais inline e docs",
    sortOrder: 110,
  },
  {
    id: "diversification",
    category: "risk",
    title: "Diversificação entre Operações Ativas",
    description:
      "Caps configuráveis: max posições por symbol (default 2), por chain (5), por strategy (4), total por round (10). Diversity score 0-100 exibido no dashboard. Engine automaticamente picks a strategy com menos posições abertas para balancear o mix.",
    status: "shipped",
    completionPct: 100,
    notes: "v16 — diversification.ts",
    sortOrder: 120,
  },
  {
    id: "scale-by-success",
    category: "risk",
    title: "Escalar conforme Taxa de Sucesso",
    description:
      "Risk scaling em 5 bands por win rate: <33% → 0.5x, 33-50% → 0.75x, 50-65% → 1.0x, 65-80% → 1.25x, >80% → 1.5x. Anti-martingale: aumenta quando ganha, diminui quando perde. Nunca bypassa maxExposurePerTokenPct.",
    status: "shipped",
    completionPct: 100,
    notes: "v16 — risk-scaling.ts",
    sortOrder: 130,
  },
  {
    id: "wallet-connection",
    category: "security",
    title: "Conexão de Carteira Digital",
    description:
      "Modelo WalletConnection com criptografia AES-256-GCM + PBKDF2 (600k iters). Passphrase nunca persistida — só em memória após unlock. Suporte a EVM/Solana/hardware/multisig. Rollouts incrementais — v16 cria o modelo, v17 ativa signing.",
    status: "in_progress",
    completionPct: 40,
    notes: "v16 — schema + UI painel; v17 — signing real",
    sortOrder: 140,
  },
  {
    id: "exchange-connectivity",
    category: "security",
    title: "Conexão com Exchanges",
    description:
      "Modelo ExchangeConnection com mesmo scheme de criptografia. Suporte inicial: Binance, Kraken, Bybit, OKX, Coinbase Advanced Trade. Permissões enforced: read+trade only, NO withdraw. IP whitelist strongly recommended.",
    status: "in_progress",
    completionPct: 30,
    notes: "v16 — schema + UI painel; v17 — CCXT integration real",
    sortOrder: 150,
  },
  {
    id: "anti-hacker-security",
    category: "security",
    title: "Segurança Máxima contra Hackers",
    description:
      "Defense in depth: (1) chaves AES-256-GCM encrypted at rest, (2) passphrase nunca persistida, (3) in-memory key wipe on stop, (4) NO withdraw permission em API keys, (5) IP whitelist recommendation, (6) audit trail de todas as operações, (7) kill switch instantâneo, (8) graduated paper→live com 50 ciclos.",
    status: "in_progress",
    completionPct: 60,
    notes: "v16 — modelo + UI; v17 — HMAC signing, rate limiting, IP allowlist enforcement",
    sortOrder: 160,
  },
];

/**
 * Ensure all seed capabilities exist in the DB. Idempotent — uses upsert
 * so concurrent calls don't race on the unique constraint. Never overwrites
 * operator edits (only sets fields on create, not on update).
 */
export async function ensureStrategicCapabilitiesSeeded(): Promise<void> {
  for (const cap of SEED_CAPABILITIES) {
    try {
      await db.strategicCapability.upsert({
        where: { id: cap.id },
        create: {
          id: cap.id,
          category: cap.category,
          title: cap.title,
          description: cap.description,
          status: cap.status,
          completionPct: cap.completionPct,
          notes: cap.notes ?? null,
          sortOrder: cap.sortOrder,
        },
        // On update: do nothing — preserve operator edits
        update: {},
      });
    } catch (err) {
      // Swallow unique constraint errors (concurrent seeding from parallel requests)
      logger.debug("roadmap", `Seed upsert(${cap.id}) failed: ${String(err)}`);
    }
  }
}

/**
 * List all capabilities, ordered by sortOrder.
 */
export async function listStrategicCapabilities(): Promise<StrategicCapabilityRow[]> {
  await ensureStrategicCapabilitiesSeeded();
  const rows = await db.strategicCapability.findMany({
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    category: r.category as CapabilityCategory,
    title: r.title,
    description: r.description,
    status: r.status as CapabilityStatus,
    completionPct: r.completionPct,
    notes: r.notes,
    sortOrder: r.sortOrder,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/**
 * Update a capability's status / completion / notes. Used by the operator
 * to mark progress as features are rolled out.
 */
export async function updateStrategicCapability(
  id: string,
  patch: { status?: CapabilityStatus; completionPct?: number; notes?: string }
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.completionPct !== undefined) data.completionPct = patch.completionPct;
  if (patch.notes !== undefined) data.notes = patch.notes;
  await db.strategicCapability.update({ where: { id }, data });
  logger.info("roadmap", `Capability ${id} updated`, patch);
}

/**
 * Get aggregate stats for the dashboard header card.
 */
export async function getRoadmapStats(): Promise<{
  total: number;
  shipped: number;
  inProgress: number;
  planned: number;
  blocked: number;
  avgCompletion: number;
  byCategory: Record<string, { total: number; shipped: number; avgCompletion: number }>;
}> {
  await ensureStrategicCapabilitiesSeeded();
  const rows = await db.strategicCapability.findMany();

  const total = rows.length;
  let shipped = 0;
  let inProgress = 0;
  let planned = 0;
  let blocked = 0;
  let sumCompletion = 0;
  const byCategory: Record<string, { total: number; shipped: number; sumCompletion: number }> = {};

  for (const r of rows) {
    sumCompletion += r.completionPct;
    if (r.status === "shipped") shipped++;
    else if (r.status === "in_progress") inProgress++;
    else if (r.status === "planned") planned++;
    else if (r.status === "blocked") blocked++;

    if (!byCategory[r.category]) {
      byCategory[r.category] = { total: 0, shipped: 0, sumCompletion: 0 };
    }
    byCategory[r.category].total++;
    byCategory[r.category].sumCompletion += r.completionPct;
    if (r.status === "shipped") byCategory[r.category].shipped++;
  }

  const byCategoryOut: Record<string, { total: number; shipped: number; avgCompletion: number }> = {};
  for (const [cat, v] of Object.entries(byCategory)) {
    byCategoryOut[cat] = {
      total: v.total,
      shipped: v.shipped,
      avgCompletion: v.total > 0 ? v.sumCompletion / v.total : 0,
    };
  }

  return {
    total,
    shipped,
    inProgress,
    planned,
    blocked,
    avgCompletion: total > 0 ? sumCompletion / total : 0,
    byCategory: byCategoryOut,
  };
}
