// Source Health — tracks availability and error rate of external data sources.
//
// Sources tracked:
//   binance      — CEX price feed (api.binance.com)
//   dexscreener  — DEX price + liquidity (api.dexscreener.com)
//   geckoterminal — OHLCV real de pools DEX (api.geckoterminal.com)
//   goplus       — token security scan (api.gopluslabs.io)
//   coingecko / feargreed — sentimento/mercado global
//   zai          — LLM provider
//   rdap / safebrowsing — auditoria de site
//
// The engine queries evaluateSourceHealthForScout() before SCOUT to decide
// whether to pause entradas. Critical sources are those whose failure
// invalidates the analysis: binance, dexscreener, geckoterminal, goplus, zai.
//
// ESCOPO (audit round2): cada fonte crítica tem um escopo — CEX, DEX ou GLOBAL.
// Uma fonte DEX em erro bloqueia APENAS candidatos DEX (o CEX continua
// operando); uma fonte global (ex.: LLM) bloqueia ambos.
//
// Each source increments windowSuccessCount or windowErrorCount on every call.
// The window resets every hour — so the error rate reflects the last hour of
// activity, not lifetime. The 24h counters (successCount24h, errorCount24h)
// are an approximation: they decay by 50% every 24h via a maintenance tick,
// giving an exponentially-weighted view of recent reliability.

import { db } from "@/lib/db";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type SourceName =
  | "binance"
  | "dexscreener"
  | "geckoterminal"
  | "coingecko"
  | "feargreed"
  | "goplus"
  | "zai"
  | "rdap"
  | "safebrowsing";

export interface SourceHealthRow {
  source: SourceName;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMsg: string | null;
  successCount24h: number;
  errorCount24h: number;
  rateLimited: boolean;
  rateLimitUntil: string | null;
  windowStartedAt: string;
  windowSuccessCount: number;
  windowErrorCount: number;
  // Derived
  windowErrorRate: number; // 0..1
  status: "healthy" | "degraded" | "down";
  isCritical: boolean;
}

const CRITICAL_SOURCES: ReadonlySet<SourceName> = new Set([
  "binance",
  "dexscreener",
  "geckoterminal",
  "goplus",
  "zai",
]);

/** Escopo de impacto de cada fonte: "cex" | "dex" | "all" (global). */
export type SourceScope = "cex" | "dex" | "all";

const SOURCE_SCOPE: Readonly<Record<SourceName, SourceScope>> = {
  binance: "cex",
  dexscreener: "dex",
  geckoterminal: "dex",
  goplus: "dex",
  coingecko: "all",
  feargreed: "all",
  zai: "all",
  rdap: "all",
  safebrowsing: "all",
};

export function sourceScope(source: SourceName): SourceScope {
  return SOURCE_SCOPE[source] ?? "all";
}

// Error-rate threshold above which a source is considered "degraded" within
// the current rolling window. 30% means: out of the last N calls in the
// past hour, more than 30% failed.
const DEGRADED_ERROR_RATE = 0.3;

// Minimum sample size in the window before we trust the error rate.
// Below this we treat the source as healthy (not enough data to condemn).
const MIN_WINDOW_SAMPLES = 5;

const WINDOW_RESET_MS = 60 * 60 * 1000; // 1h

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
export async function recordSuccess(source: SourceName): Promise<void> {
  try {
    const now = new Date();
    const existing = await db.sourceHealth.findUnique({ where: { source } });
    if (!existing) {
      await db.sourceHealth.create({
        data: {
          id: source,
          source,
          lastSuccessAt: now,
          successCount24h: 1,
          windowSuccessCount: 1,
          windowStartedAt: now,
        },
      });
      return;
    }
    const resets = shouldResetWindow(existing.windowStartedAt, now);
    await db.sourceHealth.update({
      where: { source },
      data: {
        lastSuccessAt: now,
        rateLimited: false,
        rateLimitUntil: null,
        successCount24h: { increment: 1 },
        windowSuccessCount: resets ? 1 : { increment: 1 },
        windowErrorCount: resets ? 0 : undefined,
        windowStartedAt: resets ? now : undefined,
      },
    });
  } catch (err) {
    // Never let health tracking break the engine
    logger.debug("engine", `SourceHealth recordSuccess(${source}) failed: ${String(err)}`);
  }
}

export async function recordError(
  source: SourceName,
  errorMsg: string,
  opts?: { rateLimited?: boolean; retryAfterSec?: number }
): Promise<void> {
  try {
    const now = new Date();
    const rateLimited = opts?.rateLimited ?? false;
    const rateLimitUntil = opts?.retryAfterSec
      ? new Date(now.getTime() + opts.retryAfterSec * 1000)
      : null;

    const existing = await db.sourceHealth.findUnique({ where: { source } });
    if (!existing) {
      await db.sourceHealth.create({
        data: {
          id: source,
          source,
          lastErrorAt: now,
          lastErrorMsg: errorMsg.slice(0, 500),
          errorCount24h: 1,
          windowErrorCount: 1,
          windowStartedAt: now,
          rateLimited,
          rateLimitUntil,
        },
      });
      return;
    }
    const resets = shouldResetWindow(existing.windowStartedAt, now);
    await db.sourceHealth.update({
      where: { source },
      data: {
        lastErrorAt: now,
        lastErrorMsg: errorMsg.slice(0, 500),
        errorCount24h: { increment: 1 },
        windowErrorCount: resets ? 1 : { increment: 1 },
        windowSuccessCount: resets ? 0 : undefined,
        windowStartedAt: resets ? now : undefined,
        rateLimited,
        rateLimitUntil,
      },
    });
  } catch (err) {
    logger.debug("engine", `SourceHealth recordError(${source}) failed: ${String(err)}`);
  }
}

function shouldResetWindow(windowStartedAt: Date, now: Date): boolean {
  return now.getTime() - windowStartedAt.getTime() > WINDOW_RESET_MS;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
export async function getSourceHealth(): Promise<SourceHealthRow[]> {
  // Ensure all known sources exist (defensive — created on first call)
  const known: SourceName[] = [
    "binance",
    "dexscreener",
    "geckoterminal",
    "coingecko",
    "feargreed",
    "goplus",
    "zai",
    "rdap",
    "safebrowsing",
  ];
  for (const s of known) {
    const ex = await db.sourceHealth.findUnique({ where: { source: s } });
    if (!ex) {
      await db.sourceHealth.create({
        data: { id: s, source: s, windowStartedAt: new Date() },
      });
    }
  }
  const rows = await db.sourceHealth.findMany({ orderBy: { source: "asc" } });
  return rows.map(toRow);
}

export async function getSourceHealthMap(): Promise<Map<SourceName, SourceHealthRow>> {
  const rows = await getSourceHealth();
  const map = new Map<SourceName, SourceHealthRow>();
  for (const r of rows) map.set(r.source, r);
  return map;
}

function toRow(r: Awaited<ReturnType<typeof db.sourceHealth.findFirst>>): SourceHealthRow {
  if (!r) throw new Error("SourceHealth row null");
  const total = r.windowSuccessCount + r.windowErrorCount;
  const windowErrorRate = total >= MIN_WINDOW_SAMPLES ? r.windowErrorCount / total : 0;
  let status: SourceHealthRow["status"] = "healthy";
  if (r.rateLimited && r.rateLimitUntil && new Date(r.rateLimitUntil) > new Date()) {
    status = "down";
  } else if (total >= MIN_WINDOW_SAMPLES && windowErrorRate >= DEGRADED_ERROR_RATE) {
    status = "degraded";
  }
  return {
    source: r.source as SourceName,
    lastSuccessAt: r.lastSuccessAt ? r.lastSuccessAt.toISOString() : null,
    lastErrorAt: r.lastErrorAt ? r.lastErrorAt.toISOString() : null,
    lastErrorMsg: r.lastErrorMsg,
    successCount24h: r.successCount24h,
    errorCount24h: r.errorCount24h,
    rateLimited: r.rateLimited,
    rateLimitUntil: r.rateLimitUntil ? r.rateLimitUntil.toISOString() : null,
    windowStartedAt: r.windowStartedAt.toISOString(),
    windowSuccessCount: r.windowSuccessCount,
    windowErrorCount: r.windowErrorCount,
    windowErrorRate,
    status,
    isCritical: CRITICAL_SOURCES.has(r.source as SourceName),
  };
}

// ---------------------------------------------------------------------------
// Engine decision: should SCOUT proceed?
// Returns { proceed, reasons, degradedSources, blocked scopes }
//
// Sem `candidateSource` o comportamento é conservador (qualquer fonte crítica
// degradada bloqueia — compatível com o uso antigo). Com `candidateSource`,
// respeita o escopo: fonte DEX não bloqueia CEX e vice-versa; fonte global
// ("all") bloqueia os dois.
// ---------------------------------------------------------------------------
export type ScoutCandidateSource = "cex" | "dex";

export interface ScoutHealthDecision {
  proceed: boolean;
  reasons: string[];
  degradedSources: SourceName[];
  /** Escopos bloqueados (global => ambos true). */
  blockedScopes: { cex: boolean; dex: boolean };
  globalBlocked: boolean;
}

export async function evaluateSourceHealthForScout(opts?: {
  candidateSource?: ScoutCandidateSource;
}): Promise<ScoutHealthDecision> {
  const map = await getSourceHealthMap();
  const reasons: string[] = [];
  const degraded: SourceName[] = [];
  let cexBlocked = false;
  let dexBlocked = false;
  let globalBlocked = false;

  for (const [name, row] of map.entries()) {
    if (!row.isCritical) continue;
    let reason: string | null = null;
    if (row.status === "down") {
      reason = `${name} está DOWN (rate-limited até ${row.rateLimitUntil ?? "?"})`;
    } else if (row.status === "degraded") {
      reason = `${name} degradada (${(row.windowErrorRate * 100).toFixed(0)}% erros na última janela)`;
    }
    if (!reason) continue;

    const scope = sourceScope(name);
    if (scope === "all") {
      globalBlocked = true;
      cexBlocked = true;
      dexBlocked = true;
    } else if (scope === "cex") {
      cexBlocked = true;
    } else {
      dexBlocked = true;
    }
    reasons.push(`[${scope}] ${reason}`);
    degraded.push(name);
  }

  const candidateSource = opts?.candidateSource;
  let proceed: boolean;
  if (candidateSource === "cex") {
    proceed = !cexBlocked;
  } else if (candidateSource === "dex") {
    proceed = !dexBlocked;
  } else {
    // Conservador: sem escopo informado, qualquer bloqueio impede o SCOUT.
    proceed = !cexBlocked && !dexBlocked;
  }

  // Quando o escopo do candidato é conhecido, só reportamos o que o afeta —
  // assim o motivo exibido é acionável (ex.: DEX degradado não explica CEX).
  if (candidateSource) {
    const relevant = degraded.filter((name) => {
      const scope = sourceScope(name);
      return scope === "all" || scope === candidateSource;
    });
    const relevantReasons = reasons.filter((reason) => {
      const match = reason.match(/^\[(cex|dex|all)\]/);
      const scope = match?.[1];
      return scope === "all" || scope === candidateSource;
    });
    return {
      proceed,
      reasons: relevantReasons,
      degradedSources: relevant,
      blockedScopes: { cex: cexBlocked, dex: dexBlocked },
      globalBlocked,
    };
  }

  return {
    proceed,
    reasons,
    degradedSources: degraded,
    blockedScopes: { cex: cexBlocked, dex: dexBlocked },
    globalBlocked,
  };
}

export function isCritical(source: SourceName): boolean {
  return CRITICAL_SOURCES.has(source);
}

/** Fontes críticas cujo dado só afeta candidatos DEX. */
export function isDexScopedSource(source: SourceName): boolean {
  return CRITICAL_SOURCES.has(source) && sourceScope(source) === "dex";
}

// ---------------------------------------------------------------------------
// Manual reset — clears counters and rolling window for one or all sources.
// Used by the operator via the "Reset counters" button in the Source Health
// panel. Does NOT clear `lastSuccessAt` / `lastErrorAt` — those are audit
// trail. Only zeroes the counters and the window.
// ---------------------------------------------------------------------------
export async function resetSourceHealthCounters(
  source?: SourceName
): Promise<{ reset: number }> {
  const where = source ? { source } : {};
  const rows = await db.sourceHealth.findMany({ where, select: { source: true } });
  if (rows.length === 0) return { reset: 0 };
  const now = new Date();
  await db.sourceHealth.updateMany({
    where: { source: { in: rows.map((r) => r.source) } },
    data: {
      successCount24h: 0,
      errorCount24h: 0,
      windowStartedAt: now,
      windowSuccessCount: 0,
      windowErrorCount: 0,
      rateLimited: false,
      rateLimitUntil: null,
    },
  });
  logger.info(
    "engine",
    `SourceHealth counters resetados: ${rows.length} fonte(s) (${source ?? "todas"})`
  );
  return { reset: rows.length };
}

// ---------------------------------------------------------------------------
// Maintenance: decay 24h counters periodically so they reflect recent history.
// Called once per hour by the engine. Multiplies counts by 0.5 — equivalent
// to an EMA with α=0.5 over a 24h period, simple and predictable.
// ---------------------------------------------------------------------------
export async function decaySourceHealthCounters(): Promise<void> {
  try {
    const all = await db.sourceHealth.findMany();
    const now = new Date();
    for (const r of all) {
      // Only decay if there's been activity in the last 24h
      const lastActivity = r.lastSuccessAt ?? r.lastErrorAt;
      if (!lastActivity) continue;
      if (now.getTime() - lastActivity.getTime() < 24 * 60 * 60 * 1000) continue;
      await db.sourceHealth.update({
        where: { source: r.source },
        data: {
          successCount24h: Math.floor(r.successCount24h * 0.5),
          errorCount24h: Math.floor(r.errorCount24h * 0.5),
        },
      });
    }
  } catch (err) {
    logger.debug("engine", `decaySourceHealthCounters failed: ${String(err)}`);
  }
}
