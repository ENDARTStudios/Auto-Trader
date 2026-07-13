// Platform scanner — discovers and audits the major crypto platforms we may
// route orders through. This satisfies step 1 + 2 of the autonomous workflow:
//   1. "Pesquisar as principais plataformas de criptomoedas"
//   2. "Verificar integridade"
//
// What it does:
//   - Maintains a curated list of major CEXs, DEXs, and aggregators (Binance,
//     Coinbase, Kraken, Uniswap, 1inch, Curve, SushiSwap, Aerodrome, etc.)
//   - For each platform, runs the existing auditSite() from site-integrity.ts
//     (SSL + domain age + security headers + Safe Browsing + content red flags)
//   - Caches the audit in the existing SiteAudit table (no schema change needed)
//   - Returns a ranked list: platforms that pass go to the top, rejected ones
//     sink to the bottom with the reason.
//
// The engine SCOUT phase can read this list and only consider tokens whose
// source platform is in the "approved" set — preventing the bot from ever
// touching an unaudited venue.
//
// All resources used here are 100% free / open-source:
//   - auditSite() uses Node tls, RDAP, and HTML fetch — no paid API.
//   - The platform list is hardcoded from public knowledge.

import { auditSite, SiteAuditResult } from "./site-integrity";
import { logger } from "./logger";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Curated platform registry
// ---------------------------------------------------------------------------
export type PlatformKind = "cex" | "dex" | "aggregator" | "data";

export interface PlatformEntry {
  id: string;            // stable slug, used as primary key in cache
  name: string;          // human-readable
  url: string;           // canonical URL to audit
  kind: PlatformKind;
  chains?: string[];     // for DEX/aggregator — chains supported
  notes?: string;
}

export const PLATFORM_REGISTRY: PlatformEntry[] = [
  // ----- Major CEXs -----
  { id: "binance",   name: "Binance",   url: "https://www.binance.com",   kind: "cex", notes: "Maior CEX por volume. API pública REST gratuita." },
  { id: "coinbase",  name: "Coinbase",  url: "https://www.coinbase.com",  kind: "cex", notes: "CEX americano regulado. API pública gratuita." },
  { id: "kraken",    name: "Kraken",    url: "https://www.kraken.com",    kind: "cex", notes: "CEX americano regulado. API pública gratuita." },
  { id: "okx",       name: "OKX",       url: "https://www.okx.com",        kind: "cex", notes: "CEX global. API pública gratuita." },
  { id: "bybit",     name: "Bybit",     url: "https://www.bybit.com",      kind: "cex", notes: "CEX global. API pública gratuita." },
  { id: "kucoin",    name: "KuCoin",    url: "https://www.kucoin.com",     kind: "cex", notes: "CEX global. API pública gratuita." },
  { id: "gateio",    name: "Gate.io",   url: "https://www.gate.io",        kind: "cex", notes: "CEX global. API pública gratuita." },
  { id: "mexc",      name: "MEXC",      url: "https://www.mexc.com",       kind: "cex", notes: "CEX global com listings agressivos." },

  // ----- Major DEXs (multi-chain) -----
  { id: "uniswap",   name: "Uniswap",   url: "https://app.uniswap.org",    kind: "dex", chains: ["ethereum", "arbitrum", "optimism", "base", "polygon"], notes: "Maior DEX Ethereum. Open-source." },
  { id: "sushiswap", name: "SushiSwap", url: "https://www.sushi.com",      kind: "dex", chains: ["ethereum", "arbitrum", "optimism", "base", "polygon"], notes: "Fork do Uniswap com incentivos adicionais." },
  { id: "curve",     name: "Curve",     url: "https://curve.fi",           kind: "dex", chains: ["ethereum", "arbitrum", "optimism", "base", "polygon"], notes: "DEX especializado em stablecoins." },
  { id: "balancer",  name: "Balancer",  url: "https://balancer.fi",        kind: "dex", chains: ["ethereum", "arbitrum", "optimism", "base"], notes: "DEX com pools de pesos arbitrários." },
  { id: "pancake",   name: "PancakeSwap", url: "https://pancakeswap.finance", kind: "dex", chains: ["bsc", "ethereum", "arbitrum", "base"], notes: "DEX líder na BNB Chain." },
  { id: "aerodrome", name: "Aerodrome", url: "https://aerodrome.finance",  kind: "dex", chains: ["base"], notes: "DEX principal da Base. Fork do Velodrome." },
  { id: "velodrome", name: "Velodrome", url: "https://velodrome.finance",  kind: "dex", chains: ["optimism"], notes: "DEX principal da Optimism." },
  { id: "camelot",   name: "Camelot",   url: "https://camelot.exchange",   kind: "dex", chains: ["arbitrum"], notes: "DEX nativa da Arbitrum." },

  // ----- Aggregators (roteadores que escolhem o melhor DEX) -----
  { id: "oneinch",   name: "1inch",     url: "https://app.1inch.io",       kind: "aggregator", chains: ["ethereum", "arbitrum", "optimism", "base", "polygon", "bsc"], notes: "Maior agregador DEX. API gratuita." },
  { id: "paraswap",  name: "ParaSwap",  url: "https://www.paraswap.io",    kind: "aggregator", chains: ["ethereum", "arbitrum", "optimism", "base", "polygon", "bsc"], notes: "Agregador DEX. API gratuita." },
  { id: "odos",      name: "Odos",      url: "https://app.odos.com",       kind: "aggregator", chains: ["ethereum", "arbitrum", "optimism", "base", "polygon"], notes: "Agregador DEX com otimização de rota." },
  { id: "0x",        name: "0x Protocol", url: "https://www.0x.org",       kind: "aggregator", chains: ["ethereum", "arbitrum", "optimism", "base", "polygon", "bsc"], notes: "Protocolo de liquidez para DEXs. API Matcha gratuita." },

  // ----- Data providers (free APIs we already use) -----
  { id: "dexscreener", name: "DexScreener", url: "https://dexscreener.com", kind: "data", notes: "Analytics DEX. API pública gratuita." },
  { id: "coingecko",   name: "CoinGecko",   url: "https://www.coingecko.com", kind: "data", notes: "Crypto market data. API pública gratuita." },
  { id: "goplus",      name: "GoPlus Security", url: "https://gopluslabs.io", kind: "data", notes: "Security data de tokens. API pública gratuita." },
  { id: "etherscan",   name: "Etherscan", url: "https://etherscan.io", kind: "data", notes: "Block explorer Ethereum. API gratuita (5 calls/s)." },
  { id: "arbiscan",    name: "Arbiscan",  url: "https://arbiscan.io",   kind: "data", notes: "Block explorer Arbitrum. API gratuita." },
  { id: "basescan",    name: "Basescan",  url: "https://basescan.org",  kind: "data", notes: "Block explorer Base. API gratuita." },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface PlatformScanResult {
  id: string;
  name: string;
  url: string;
  kind: PlatformKind;
  chains?: string[];
  notes?: string;
  audit: SiteAuditResult | null;
  approved: boolean;        // true iff audit exists and passed
  rejectionReason?: string;
  scannedAt: string | null;
}

export interface PlatformScanSummary {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  results: PlatformScanResult[];
}

// ---------------------------------------------------------------------------
// Cache: read the most recent SiteAudit for each platform URL
// ---------------------------------------------------------------------------
async function getCachedAudit(url: string): Promise<SiteAuditResult | null> {
  try {
    const row = await db.siteAudit.findFirst({
      where: { url },
      orderBy: { auditedAt: "desc" },
    });
    if (!row) return null;
    return {
      url: row.url,
      score: row.score,
      passed: row.passed,
      sslScore: row.sslScore,
      domainAgeScore: row.domainAgeScore,
      headersScore: row.headersScore,
      safeBrowsingScore: row.safeBrowsingScore,
      contentScore: row.contentScore,
      sslValid: row.sslValid,
      sslDaysToExpiry: row.sslDaysToExpiry,
      domainAgeDays: row.domainAgeDays,
      hstsPresent: row.hstsPresent,
      cspPresent: row.cspPresent,
      xfoPresent: row.xfoPresent,
      safeBrowsingFlagged: row.safeBrowsingFlagged,
      redFlags: row.redFlags ? JSON.parse(row.redFlags) : [],
      findings: row.findings ? JSON.parse(row.findings) : {},
    } as SiteAuditResult;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scan a single platform (force fresh audit)
// ---------------------------------------------------------------------------
export async function scanPlatform(
  platformId: string,
  opts?: { force?: boolean }
): Promise<PlatformScanResult> {
  const entry = PLATFORM_REGISTRY.find((p) => p.id === platformId);
  if (!entry) {
    throw new Error(`Unknown platform id: ${platformId}`);
  }

  // If not forced, try cache first (audit younger than 24h)
  if (!opts?.force) {
    const cached = await getCachedAudit(entry.url);
    if (cached) {
      const ageMs = Date.now() - (cached.sslDaysToExpiry ?? 0); // not exact, but we re-check via DB query
      // Re-fetch to know auditedAt
      try {
        const row = await db.siteAudit.findFirst({
          where: { url: entry.url },
          orderBy: { auditedAt: "desc" },
          select: { auditedAt: true },
        });
        if (row) {
          const ageHours = (Date.now() - row.auditedAt.getTime()) / 3_600_000;
          if (ageHours < 24) {
            logger.info("site", `Platform ${entry.name} cached audit (age ${ageHours.toFixed(1)}h) — score=${cached.score}`);
            return {
              id: entry.id,
              name: entry.name,
              url: entry.url,
              kind: entry.kind,
              chains: entry.chains,
              notes: entry.notes,
              audit: cached,
              approved: cached.passed,
              rejectionReason: cached.passed ? undefined : `Score ${cached.score}/100${cached.redFlags.length > 0 ? ` (${cached.redFlags.length} red flag(s))` : ""}`,
              scannedAt: row.auditedAt.toISOString(),
            };
          }
        }
      } catch {
        // fall through to fresh audit
      }
    }
  }

  // Fresh audit
  logger.info("site", `Scanning platform ${entry.name} (${entry.url})...`);
  const audit = await auditSite(entry.url, { symbol: entry.name });

  return {
    id: entry.id,
    name: entry.name,
    url: entry.url,
    kind: entry.kind,
    chains: entry.chains,
    notes: entry.notes,
    audit,
    approved: audit.passed,
    rejectionReason: audit.passed ? undefined : `Score ${audit.score}/100${audit.redFlags.length > 0 ? ` (${audit.redFlags.length} red flag(s))` : ""}`,
    scannedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Scan all platforms (sequential to avoid hammering RDAP/SSL endpoints)
// ---------------------------------------------------------------------------
export async function scanAllPlatforms(
  opts?: { force?: boolean; concurrency?: number }
): Promise<PlatformScanSummary> {
  const force = opts?.force ?? false;
  const concurrency = Math.min(opts?.concurrency ?? 3, 6); // cap at 6

  logger.info("site", `Platform scan start: ${PLATFORM_REGISTRY.length} platforms (force=${force})`);

  const results: PlatformScanResult[] = [];
  // Process in batches to avoid flooding external endpoints
  for (let i = 0; i < PLATFORM_REGISTRY.length; i += concurrency) {
    const batch = PLATFORM_REGISTRY.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (entry) => {
        try {
          return await scanPlatform(entry.id, { force });
        } catch (err) {
          logger.error("site", `Error scanning ${entry.name}: ${String(err)}`);
          return {
            id: entry.id,
            name: entry.name,
            url: entry.url,
            kind: entry.kind,
            chains: entry.chains,
            notes: entry.notes,
            audit: null,
            approved: false,
            rejectionReason: `Erro: ${String(err)}`,
            scannedAt: new Date().toISOString(),
          } as PlatformScanResult;
        }
      })
    );
    results.push(...batchResults);
  }

  const approved = results.filter((r) => r.approved).length;
  const rejected = results.filter((r) => r.audit && !r.approved).length;
  const pending = results.filter((r) => !r.audit).length;

  logger.info(
    "site",
    `Platform scan done: ${approved}/${results.length} approved, ${rejected} rejected, ${pending} errored`
  );

  return {
    total: results.length,
    approved,
    rejected,
    pending,
    results: results.sort((a, b) => {
      // approved first, then by score desc, then by name
      if (a.approved !== b.approved) return a.approved ? -1 : 1;
      const sa = a.audit?.score ?? 0;
      const sb = b.audit?.score ?? 0;
      if (sa !== sb) return sb - sa;
      return a.name.localeCompare(b.name);
    }),
  };
}

// ---------------------------------------------------------------------------
// Get cached scan results without triggering fresh audits
// ---------------------------------------------------------------------------
export async function getCachedPlatformScan(): Promise<PlatformScanSummary> {
  const results: PlatformScanResult[] = [];
  for (const entry of PLATFORM_REGISTRY) {
    const cached = await getCachedAudit(entry.url);
    let scannedAt: string | null = null;
    try {
      const row = await db.siteAudit.findFirst({
        where: { url: entry.url },
        orderBy: { auditedAt: "desc" },
        select: { auditedAt: true },
      });
      scannedAt = row?.auditedAt.toISOString() ?? null;
    } catch {
      // ignore
    }
    results.push({
      id: entry.id,
      name: entry.name,
      url: entry.url,
      kind: entry.kind,
      chains: entry.chains,
      notes: entry.notes,
      audit: cached,
      approved: cached?.passed ?? false,
      rejectionReason: cached?.passed
        ? undefined
        : cached
        ? `Score ${cached.score}/100${cached.redFlags.length > 0 ? ` (${cached.redFlags.length} red flag(s))` : ""}`
        : "Ainda não auditado",
      scannedAt,
    });
  }

  const approved = results.filter((r) => r.approved).length;
  const rejected = results.filter((r) => r.audit && !r.approved).length;
  const pending = results.filter((r) => !r.audit).length;

  return {
    total: results.length,
    approved,
    rejected,
    pending,
    results: results.sort((a, b) => {
      if (a.approved !== b.approved) return a.approved ? -1 : 1;
      const sa = a.audit?.score ?? 0;
      const sb = b.audit?.score ?? 0;
      if (sa !== sb) return sb - sa;
      return a.name.localeCompare(b.name);
    }),
  };
}

// ---------------------------------------------------------------------------
// Convenience: return the set of approved platform IDs (for engine SCOUT gate)
// ---------------------------------------------------------------------------
export async function getApprovedPlatformIds(): Promise<Set<string>> {
  const summary = await getCachedPlatformScan();
  return new Set(summary.results.filter((r) => r.approved).map((r) => r.id));
}
