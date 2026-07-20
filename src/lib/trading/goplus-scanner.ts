// GoPlus Security API integration — free, no auth required.
//
// GoPlus (https://gopluslabs.io) is the de facto open-source token security
// data layer for EVM chains. Their public API returns real honeypot detection
// results (computed via eth_call simulation on archive nodes), buy/sell tax
// measurements, holder concentration, LP lock status, mint authority, etc.
//
// Endpoints used (all free, ~100 req/min per IP):
//   GET https://api.gopluslabs.io/api/v1/token_security/{chainId}?address={addr}
//
// Chain IDs accepted by GoPlus (numeric, NOT chain slugs):
//   1       = Ethereum mainnet
//   56      = BSC
//   137     = Polygon
//   42161   = Arbitrum
//   10      = Optimism
//   8453    = Base
//   43114   = Avalanche
//
// We translate our internal chain slugs ("base", "arbitrum", "optimism") to
// these IDs before calling.
//
// IMPORTANT: GoPlus is a great signal but NOT infallible. Sophisticated rug
// pulls can evade it (e.g., honeypot with delayed re-lock that activates only
// after the developer detects the token has been added to a watchlist). Use
// this as ONE input among several — never as the sole gatekeeper.

import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Chain slug → GoPlus chain ID
// ---------------------------------------------------------------------------
const CHAIN_ID: Record<string, string> = {
  ethereum: "1",
  eth: "1",
  bsc: "56",
  polygon: "137",
  arbitrum: "42161",
  optimism: "10",
  base: "8453",
  avalanche: "43114",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface GoPlusResult {
  // Composite scam-risk score 0-100 (100 = safest)
  score: number;
  // Sub-scores for transparency
  honeypotScore: number;
  taxScore: number;
  holderScore: number;
  liquidityScore: number;
  contractScore: number;
  // Human-readable findings
  findings: string[];
  // Critical red flags — if any are true, we should reject the token outright
  criticalFlags: string[];
  // Raw response (truncated) for audit
  raw: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Call GoPlus token_security endpoint
// ---------------------------------------------------------------------------
async function fetchGoPlus(
  chain: string,
  address: string
): Promise<Record<string, string> | null> {
  const chainId = CHAIN_ID[chain.toLowerCase()];
  if (!chainId) {
    logger.warn("goplus", `Chain ${chain} não suportada pelo GoPlus`);
    return null;
  }
  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?address=${address.toLowerCase()}`;
  const resp = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    logger.warn("goplus", `HTTP ${resp.status} para ${chain}:${address}`);
    return null;
  }
  const json = (await resp.json()) as {
    code: number;
    message?: string;
    result?: Record<string, string>;
  };
  if (json.code !== 1 || !json.result) {
    logger.warn("goplus", `API error code=${json.code} msg=${json.message ?? ""}`);
    return null;
  }
  // result is keyed by the address — flatten it
  const inner = json.result[address.toLowerCase()] ?? json.result[Object.keys(json.result)[0]];
  return (inner as unknown as Record<string, string>) ?? null;
}

// ---------------------------------------------------------------------------
// Convert string "1"/"0"/"5"/"unknown" → number where helpful
// ---------------------------------------------------------------------------
function asBool(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "True";
}
function asNum(v: string | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function asPct(v: string | undefined): number | null {
  // GoPlus returns some fields as "5" meaning 5%, others as "0.05" meaning 5%
  // For tax fields they return the integer percentage (e.g. "5" = 5%)
  const n = asNum(v);
  return n;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
export async function scanTokenWithGoPlus(
  chain: string,
  address: string
): Promise<GoPlusResult> {
  const findings: string[] = [];
  const criticalFlags: string[] = [];

  let data: Record<string, string> | null = null;
  try {
    data = await fetchGoPlus(chain, address);
  } catch (err) {
    logger.error("goplus", `Erro chamando GoPlus: ${String(err)}`);
    return {
      score: 50,
      honeypotScore: 50,
      taxScore: 50,
      holderScore: 50,
      liquidityScore: 50,
      contractScore: 50,
      findings: [`GoPlus indisponível: ${String(err)}`],
      criticalFlags: [],
      raw: null,
    };
  }

  if (!data) {
    // No data — neutral score. We don't fail the token just because GoPlus
    // is unavailable; we already have other heuristics in the scam-detector.
    return {
      score: 50,
      honeypotScore: 50,
      taxScore: 50,
      holderScore: 50,
      liquidityScore: 50,
      contractScore: 50,
      findings: ["GoPlus sem dados para este token — score neutro"],
      criticalFlags: [],
      raw: null,
    };
  }

  // ------------------- honeypot -------------------
  // is_honeypot is the strongest single signal. If true → critical flag.
  let honeypotScore = 80;
  const isHoneypot = asBool(data["is_honeypot"]);
  if (isHoneypot) {
    honeypotScore = 0;
    criticalFlags.push("HONEYPOT: GoPlus confirmou — comprar OK mas vender falha");
    findings.push("⚠️ HONEYPOT confirmado por simulação on-chain");
  } else {
    honeypotScore = 90;
    findings.push("✓ Honeypot: NEGATIVO (venda simulada com sucesso)");
  }
  // Also check buy/sell tax consistency — honeypots often have sell tax = 100%
  const buyTax = asPct(data["buy_tax"]);
  const sellTax = asPct(data["sell_tax"]);
  if (buyTax !== null && sellTax !== null) {
    if (sellTax >= 90) {
      honeypotScore = Math.min(honeypotScore, 5);
      criticalFlags.push(`Sell tax ${sellTax}% ≈ honeypot funcional`);
      findings.push(`⚠️ Sell tax ${sellTax}% — praticamente impede venda`);
    } else if (sellTax - buyTax >= 20) {
      honeypotScore = Math.min(honeypotScore, 30);
      findings.push(`Sell tax ${sellTax}% >> buy tax ${buyTax}% — assimetria suspeita`);
    }
  }

  // ------------------- tax -------------------
  let taxScore = 100;
  if (buyTax !== null) {
    if (buyTax <= 3) {
      taxScore = 100;
      findings.push(`Buy tax ${buyTax}% (excelente)`);
    } else if (buyTax <= 8) {
      taxScore = 80;
      findings.push(`Buy tax ${buyTax}% (aceitável)`);
    } else if (buyTax <= 15) {
      taxScore = 50;
      findings.push(`Buy tax ${buyTax}% (alta)`);
    } else {
      taxScore = 15;
      findings.push(`⚠️ Buy tax ${buyTax}% (predatória)`);
    }
  }
  if (sellTax !== null) {
    if (sellTax <= 3) {
      taxScore = Math.min(taxScore, 100);
      findings.push(`Sell tax ${sellTax}% (excelente)`);
    } else if (sellTax <= 8) {
      taxScore = Math.min(taxScore, 80);
      findings.push(`Sell tax ${sellTax}% (aceitável)`);
    } else if (sellTax <= 15) {
      taxScore = Math.min(taxScore, 50);
      findings.push(`Sell tax ${sellTax}% (alta)`);
    } else if (sellTax < 90) {
      taxScore = Math.min(taxScore, 15);
      findings.push(`⚠️ Sell tax ${sellTax}% (predatória)`);
    }
  }

  // ------------------- holder concentration -------------------
  let holderScore = 80;
  const topHolderPct = asNum(data["holder_count"] ? undefined : data["holders"]);
  // GoPlus returns "holder_count" as the count, not concentration.
  // The concentration is in "top_10_holders_rate" (string like "0.45" = 45%)
  const top10Rate = asNum(data["top_10_holders_rate"]);
  if (top10Rate !== null) {
    // top_10_holders_rate is a fraction 0-1
    const top10Pct = top10Rate <= 1 ? top10Rate * 100 : top10Rate;
    if (top10Pct <= 20) {
      holderScore = 100;
      findings.push(`Top 10 holders: ${top10Pct.toFixed(1)}% (ótima distribuição)`);
    } else if (top10Pct <= 40) {
      holderScore = 75;
      findings.push(`Top 10 holders: ${top10Pct.toFixed(1)}% (boa)`);
    } else if (top10Pct <= 60) {
      holderScore = 50;
      findings.push(`Top 10 holders: ${top10Pct.toFixed(1)}% (concentrada)`);
    } else {
      holderScore = 15;
      criticalFlags.push(`Top 10 holders possuem ${top10Pct.toFixed(1)}% — risco de dump`);
      findings.push(`⚠️ Top 10 holders: ${top10Pct.toFixed(1)}% (perigosamente concentrada)`);
    }
  }
  const holderCount = asNum(data["holder_count"]);
  if (holderCount !== null) {
    if (holderCount >= 5000) {
      holderScore = Math.min(100, holderScore + 10);
      findings.push(`${holderCount.toFixed(0)} holders (excelente)`);
    } else if (holderCount >= 1000) {
      findings.push(`${holderCount.toFixed(0)} holders (bom)`);
    } else if (holderCount >= 100) {
      holderScore = Math.min(holderScore, 60);
      findings.push(`${holderCount.toFixed(0)} holders (modesto)`);
    } else {
      holderScore = Math.min(holderScore, 25);
      findings.push(`⚠️ Apenas ${holderCount.toFixed(0)} holders (risco elevado)`);
    }
  }

  // ------------------- liquidity -------------------
  let liquidityScore = 80;
  const lpLockedRaw = data["lp_holders"] ? "0" : (data["is_lp_locked"] ?? "0");
  const lpLocked = asBool(lpLockedRaw);
  // is_lp_locked: true = locked → good
  if (lpLocked) {
    liquidityScore = 95;
    findings.push("✓ Liquidity Pool está LOCKED");
  } else {
    liquidityScore = 60;
    findings.push("⚠️ LP não está locked — risco de rug pull");
  }
  const totalLp = asNum(data["lp_total_supply"]);
  if (totalLp !== null && totalLp > 0) {
    const lpHolders = asNum(data["lp_holder_count"]);
    if (lpHolders !== null && lpHolders === 1) {
      liquidityScore = Math.min(liquidityScore, 30);
      criticalFlags.push("LP tem apenas 1 holder — rug pull iminente possível");
      findings.push("⚠️ LP holder_count = 1");
    }
  }
  const lpTopHolderRate = asNum(data["lp_top_10_rate"]);
  if (lpTopHolderRate !== null) {
    const lpPct = lpTopHolderRate <= 1 ? lpTopHolderRate * 100 : lpTopHolderRate;
    if (lpPct >= 90) {
      liquidityScore = Math.min(liquidityScore, 25);
      findings.push(`⚠️ Top 10 LP holders: ${lpPct.toFixed(1)}% (centralizado)`);
    }
  }

  // ------------------- contract authority -------------------
  let contractScore = 80;
  const isMintable = asBool(data["is_mintable"]);
  if (isMintable) {
    contractScore = Math.min(contractScore, 35);
    findings.push("⚠️ Contrato permite MINT (owner pode inflar supply)");
  } else {
    findings.push("✓ Sem função mint (supply fixo)");
  }
  const isProxy = asBool(data["is_proxy"]);
  if (isProxy) {
    contractScore = Math.min(contractScore, 40);
    findings.push("⚠️ Contrato é PROXY (upgradeable — risco oculto)");
  }
  const isBlacklisted = asBool(data["is_blacklisted"]);
  if (isBlacklisted) {
    contractScore = Math.min(contractScore, 20);
    criticalFlags.push("Contrato tem função de blacklist — owner pode congelar vendas");
    findings.push("⚠️ Função blacklist presente");
  }
  const isWhitelisted = asBool(data["is_whitelisted"]);
  if (isWhitelisted) {
    contractScore = Math.min(contractScore, 30);
    findings.push("⚠️ Função whitelist presente (transferências restritas)");
  }
  const isAntiWhale = asBool(data["is_anti_whale"]);
  if (isAntiWhale) {
    findings.push("ℹ️ Anti-whale ativo (limita tx size — nem sempre ruim)");
  }
  const ownerAddress = data["owner_address"];
  if (ownerAddress && ownerAddress !== "0x0000000000000000000000000000000000000000") {
    findings.push(`Owner ativo: ${ownerAddress.slice(0, 8)}...${ownerAddress.slice(-6)}`);
  } else if (ownerAddress) {
    contractScore = Math.min(100, contractScore + 10);
    findings.push("✓ Ownership renounced (owner = 0x0)");
  }
  const canTakeBack = asBool(data["can_take_back_ownership"]);
  if (canTakeBack) {
    contractScore = Math.min(contractScore, 20);
    criticalFlags.push("Owner pode retomar ownership mesmo após renounce");
    findings.push("⚠️ can_take_back_ownership = true");
  }
  const isTrueToken = asBool(data["is_true_token"]);
  if (isTrueToken === false) {
    contractScore = Math.min(contractScore, 10);
    criticalFlags.push("GoPlus marcou como token FALSO/clone");
    findings.push("⚠️ GoPlus: token identificado como falso/clonado");
  }
  const isOpensource = asBool(data["is_opensource"]);
  if (!isOpensource) {
    contractScore = Math.min(contractScore, 30);
    findings.push("⚠️ Source code não é open-source (não verificado)");
  } else {
    findings.push("✓ Source code verificado");
  }

  // ------------------- composite -------------------
  // Weighted: honeypot 35% + liquidity 25% + contract 20% + holder 10% + tax 10%
  const composite =
    honeypotScore * 0.35 +
    liquidityScore * 0.25 +
    contractScore * 0.20 +
    holderScore * 0.10 +
    taxScore * 0.10;
  const score = Math.round(composite);

  logger.info("goplus", `Scan ${chain}:${address.slice(0, 8)}... score=${score}`, {
    honeypot: honeypotScore,
    tax: taxScore,
    holder: holderScore,
    liquidity: liquidityScore,
    contract: contractScore,
    critical: criticalFlags.length,
  });

  return {
    score,
    honeypotScore,
    taxScore,
    holderScore,
    liquidityScore,
    contractScore,
    findings,
    criticalFlags,
    raw: data as Record<string, unknown>,
  };
}
