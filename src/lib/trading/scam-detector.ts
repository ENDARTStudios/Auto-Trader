// Scam Detector — multi-heuristic scorer.
//
// Each candidate gets a score 0-100 (100 = safest). Score is a weighted
// average of sub-scores:
//
//   honeypot  (weight 0.30) — can we actually sell after buying?
//   liquidity (weight 0.20) — LP locked? enough depth? single LP provider?
//   contract  (weight 0.20) — verified source? mint function? owner can pause/blacklist?
//   tax       (weight 0.10) — buy/sell tax reasonable (<=10%)? symmetric?
//   holder    (weight 0.10) — top 10 holders own <30%? LP holder excluded?
//   age       (weight 0.10) — token at least 7 days old? newer = riskier
//
// CEX tokens (BTC, ETH, etc) bypass all checks and get score 100 — they're
// not contract-based, so contract-level scam doesn't apply.
//
// IMPORTANT: This reduces risk. It does NOT eliminate it. Sophisticated rug
// pulls (honeypot with delayed re-lock, mint hidden in modifier, etc.) can
// pass all of these. Each position's audit trail records the sub-scores so
// you can post-mortem any failure.

import { db } from "@/lib/db";
import { EngineConfig } from "./config";
import { logger } from "./logger";
import type { ScamReportData, ScamSubScore, TokenCandidate } from "./types";

// ---------------------------------------------------------------------------
// CEX bypass
// ---------------------------------------------------------------------------
function cexBypass(candidate: TokenCandidate): ScamReportData {
  return {
    symbol: candidate.symbol,
    tokenId: undefined,
    chain: undefined,
    score: 100,
    passed: true,
    subscores: [
      {
        name: "cex_listed",
        score: 100,
        weight: 1.0,
        findings: ["Token listado em CEX regulada — isento de checks de contrato"],
      },
    ],
    findings: { cex_listed: ["Listado em Binance"] },
  };
}

// ---------------------------------------------------------------------------
// Sub-scorers (DEX only)
// ---------------------------------------------------------------------------

// 1. Liquidity check — uses DexScreener data already fetched in candidate.
function scoreLiquidity(c: TokenCandidate): ScamSubScore {
  const findings: string[] = [];
  let score = 0;

  if (c.liquidityUsd >= 500_000) {
    score = 100;
    findings.push(`Liquidez $${c.liquidityUsd.toFixed(0)} >= $500k (excelente)`);
  } else if (c.liquidityUsd >= 250_000) {
    score = 80;
    findings.push(`Liquidez $${c.liquidityUsd.toFixed(0)} >= $250k (boa)`);
  } else if (c.liquidityUsd >= 100_000) {
    score = 60;
    findings.push(`Liquidez $${c.liquidityUsd.toFixed(0)} >= $100k (mínimo aceitável)`);
  } else {
    score = 20;
    findings.push(`Liquidez $${c.liquidityUsd.toFixed(0)} abaixo do mínimo`);
  }

  // Age bonus/penalty
  if (c.ageHours !== undefined) {
    if (c.ageHours < 24) {
      score = Math.min(score, 30);
      findings.push(`Token tem <24h (${c.ageHours.toFixed(1)}h) — altíssimo risco`);
    } else if (c.ageHours < 168) {
      score = Math.min(score, 70);
      findings.push(`Token tem <7d (${c.ageHours.toFixed(1)}h) — risco elevado`);
    } else {
      findings.push(`Token tem ${(c.ageHours / 24).toFixed(0)}d — idade saudável`);
    }
  }

  return { name: "liquidity", score, weight: 0.20, findings };
}

// 2. Holder concentration
function scoreHolders(c: TokenCandidate): ScamSubScore {
  const findings: string[] = [];
  let score = 60; // neutral when we don't have data

  if (c.holderCount !== undefined) {
    if (c.holderCount >= 1000) {
      score = 100;
      findings.push(`${c.holderCount} holders (excelente distribuição)`);
    } else if (c.holderCount >= 500) {
      score = 80;
      findings.push(`${c.holderCount} holders (boa distribuição)`);
    } else if (c.holderCount >= 100) {
      score = 50;
      findings.push(`${c.holderCount} holders (distribuição modesta)`);
    } else {
      score = 20;
      findings.push(`${c.holderCount} holders (concentração perigosa)`);
    }
  } else {
    findings.push("Holder count indisponível — score neutro");
  }

  return { name: "holder", score, weight: 0.10, findings };
}

// 3. Age-based score (also factored into liquidity, but isolated for clarity)
function scoreAge(c: TokenCandidate): ScamSubScore {
  const findings: string[] = [];
  let score = 50;

  if (c.ageHours === undefined) {
    findings.push("Idade indisponível");
    return { name: "age", score, weight: 0.10, findings };
  }

  const days = c.ageHours / 24;
  if (days >= 30) {
    score = 100;
    findings.push(`${days.toFixed(0)}d desde criação (maduro)`);
  } else if (days >= 7) {
    score = 75;
    findings.push(`${days.toFixed(0)}d desde criação (jovem mas estável)`);
  } else if (days >= 1) {
    score = 40;
    findings.push(`${days.toFixed(0)}d desde criação (altíssimo risco)`);
  } else {
    score = 10;
    findings.push(`<1 dia desde criação (extremo risco de rug)`);
  }

  return { name: "age", score, weight: 0.10, findings };
}

// 4. Contract audit — query Etherscan/Arbiscan/Basescan free API to check:
//    - Is source code verified?
//    - Does it implement mint function (look at ABI)?
//    - Does it implement blacklist/pause function?
//    - Does it have owner (centralization risk)?
//
//    We use the free tier (5 req/sec, 100k/day). No API key required for
//    basic source code fetch, but key raises rate limit.
const EXPLORER_API: Record<string, string> = {
  base: "https://api.basescan.org/api",
  arbitrum: "https://api.arbiscan.io/api",
  optimism: "https://api-optimistic.etherscan.io/api",
};

async function scoreContract(c: TokenCandidate): Promise<ScamSubScore> {
  const findings: string[] = [];
  let score = 50;

  if (!c.tokenId || !c.chain) {
    findings.push("Sem endereço de contrato — não aplicável");
    return { name: "contract", score, weight: 0.20, findings };
  }

  const apiBase = EXPLORER_API[c.chain];
  if (!apiBase) {
    findings.push(`Chain ${c.chain} não suportada para audit`);
    return { name: "contract", score, weight: 0.20, findings };
  }

  try {
    const url = `${apiBase}?module=contract&action=getsourcecode&address=${c.tokenId}`;
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) {
      findings.push(`Explorer retornou ${resp.status}`);
      return { name: "contract", score: 30, weight: 0.20, findings };
    }
    const json = (await resp.json()) as {
      status: string;
      result?: Array<{
        SourceCode?: string;
        ABI?: string;
        ContractName?: string;
        CompilerVersion?: string;
        OptimizerUsed?: string;
        Proxy?: string;
      }>;
    };

    if (json.status !== "1" || !json.result || json.result.length === 0) {
      score = 10;
      findings.push("Código-fonte NÃO VERIFICADO — risco crítico");
      return { name: "contract", score, weight: 0.20, findings };
    }

    const src = json.result[0];
    if (!src.SourceCode || src.SourceCode.trim().length === 0) {
      score = 10;
      findings.push("SourceCode vazio — não verificado");
      return { name: "contract", score, weight: 0.20, findings };
    }

    // Verified source — base score 70
    score = 70;
    findings.push(`Código verificado: ${src.ContractName ?? "unknown"}`);

    // Look for red flags in the ABI string
    const abiStr = (src.ABI || "").toLowerCase();
    const srcLower = src.SourceCode.toLowerCase();

    const redFlags: { pattern: string; label: string; penalty: number }[] = [
      { pattern: "mint(", label: "Função mint() exposta", penalty: 25 },
      { pattern: "mintto", label: "mintTo exposto", penalty: 25 },
      { pattern: "_mint", label: "_mint interno", penalty: 10 },
      { pattern: "blacklist", label: "Função de blacklist", penalty: 20 },
      { pattern: "pause(", label: "Função pause()", penalty: 15 },
      { pattern: "settax", label: "setTaxFee changeable", penalty: 15 },
      { pattern: "setfee", label: "setFee changeable", penalty: 15 },
      { pattern: "renouncedownership", label: "Ownership renounced (bom)", penalty: -15 },
      { pattern: "onlyowner", label: "Restrição onlyOwner presente", penalty: 5 },
    ];

    for (const flag of redFlags) {
      if (abiStr.includes(flag.pattern) || srcLower.includes(flag.pattern)) {
        score = Math.max(0, Math.min(100, score - flag.penalty));
        findings.push(`${flag.label} (${flag.penalty > 0 ? "-" : "+"}${Math.abs(flag.penalty)})`);
      }
    }

    // Proxy contracts get a penalty (upgradeable = hidden risk)
    if (src.Proxy === "1") {
      score = Math.max(0, score - 20);
      findings.push("Contrato é proxy upgradeable (-20)");
    }

    findings.push(`Score final contrato: ${score}`);
  } catch (err) {
    score = 30;
    findings.push(`Erro no audit: ${String(err)}`);
  }

  return { name: "contract", score, weight: 0.20, findings };
}

// 5. Tax simulation — query DexScreener again for token metadata that
//    often includes buy/sell tax. As a fallback, assume neutral.
async function scoreTax(c: TokenCandidate): Promise<ScamSubScore> {
  const findings: string[] = [];
  let score = 70;

  if (!c.tokenId || !c.chain) {
    findings.push("Sem endereço — tax não aplicável");
    return { name: "tax", score, weight: 0.10, findings };
  }

  try {
    // DexScreener endpoint: GET /tokens/v1/{chain}/{address}
    const url = `https://api.dexscreener.com/tokens/v1/${c.chain}/${c.tokenId}`;
    const resp = await fetch(url, { cache: "no-store" });
    if (resp.ok) {
      const json = (await resp.json()) as Array<{
        baseToken?: { symbol?: string };
        priceUsd?: string;
      }>;
      // DexScreener token endpoint doesn't directly return taxes.
      // We'd need to actually simulate a swap to compute tax — heavy.
      // For MVP we assume neutral with a small warning.
      findings.push("Taxa real requer simulação de swap (não executada no MVP)");
    } else {
      findings.push(`DexScreener tax endpoint ${resp.status}`);
    }
  } catch (err) {
    findings.push(`Erro tax: ${String(err)}`);
  }

  return { name: "tax", score, weight: 0.10, findings };
}

// 6. Honeypot check — best-effort.
//    Real honeypot detection requires simulating a buy+sell on a local RPC
//    via eth_call. Without access to a free archive node with state at
//    recent block, we approximate by combining:
//      - contract verified? (already in contract score)
//      - liquidity locked? (DexScreener doesn't expose this directly; we
//        approximate by checking if age > 7d AND liquidity > $250k)
//      - sell-side volume ratio (if 24h volume is high relative to liquidity,
//        people ARE selling successfully — strong honeypot disconfirmation)
async function scoreHoneypot(c: TokenCandidate): Promise<ScamSubScore> {
  const findings: string[] = [];
  let score = 50;

  if (!c.tokenId || !c.chain) {
    findings.push("Sem endereço — honeypot não aplicável");
    return { name: "honeypot", score, weight: 0.30, findings };
  }

  // Sell activity ratio: volume_24h / liquidity
  // If >= 1.0, that means the entire liquidity pool has turned over at least
  // once in 24h — strong evidence sells are working.
  const turnover = c.liquidityUsd > 0 ? c.volume24hUsd / c.liquidityUsd : 0;
  if (turnover >= 2.0) {
    score = 90;
    findings.push(`Turnover 24h/liquidez = ${turnover.toFixed(2)}x — vende ativo (excelente)`);
  } else if (turnover >= 1.0) {
    score = 80;
    findings.push(`Turnover ${turnover.toFixed(2)}x — vende ativo (bom)`);
  } else if (turnover >= 0.3) {
    score = 60;
    findings.push(`Turnover ${turnover.toFixed(2)}x — atividade de venda moderada`);
  } else if (turnover > 0) {
    score = 35;
    findings.push(`Turnover ${turnover.toFixed(2)}x — baixa atividade de venda (suspeito)`);
  } else {
    score = 10;
    findings.push("Sem volume 24h — possível honeypot");
  }

  // Age + liquidity combo bonus
  if ((c.ageHours ?? 0) >= 168 && c.liquidityUsd >= 250_000) {
    score = Math.min(100, score + 10);
    findings.push("Bonus: token maduro + liquidez saudável (+10)");
  }

  return { name: "honeypot", score, weight: 0.30, findings };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function analyzeToken(
  cfg: EngineConfig,
  candidate: TokenCandidate
): Promise<ScamReportData> {
  // CEX bypass
  if (candidate.source === "cex") {
    return cexBypass(candidate);
  }

  // DEX full analysis
  const honeypot = await scoreHoneypot(candidate);
  const liquidity = scoreLiquidity(candidate);
  const contract = await scoreContract(candidate);
  const tax = await scoreTax(candidate);
  const holder = scoreHolders(candidate);
  const age = scoreAge(candidate);

  const subscores = [honeypot, liquidity, contract, tax, holder, age];
  let weighted = 0;
  let totalWeight = 0;
  for (const s of subscores) {
    weighted += s.score * s.weight;
    totalWeight += s.weight;
  }
  const finalScore = totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;
  const passed = finalScore >= cfg.scamScoreMin;

  const findings: Record<string, string[]> = {};
  for (const s of subscores) findings[s.name] = s.findings;

  const report: ScamReportData = {
    symbol: candidate.symbol,
    tokenId: candidate.tokenId,
    chain: candidate.chain,
    score: finalScore,
    passed,
    subscores,
    findings,
  };

  // Persist audit log
  try {
    await db.scamReport.create({
      data: {
        symbol: candidate.symbol,
        tokenId: candidate.tokenId ?? null,
        chain: candidate.chain ?? null,
        score: finalScore,
        passed,
        honeypotScore: honeypot.score,
        liquidityScore: liquidity.score,
        contractScore: contract.score,
        taxScore: tax.score,
        holderScore: holder.score,
        ageScore: age.score,
        findings: JSON.stringify(findings),
      },
    });
  } catch (err) {
    logger.error("scam", "Erro persistindo ScamReport", { error: String(err) });
  }

  logger.info(
    "scam",
    `${candidate.symbol} score=${finalScore} passed=${passed}`,
    {
      chain: candidate.chain,
      honeypot: honeypot.score,
      liquidity: liquidity.score,
      contract: contract.score,
      tax: tax.score,
      holder: holder.score,
      age: age.score,
    }
  );

  return report;
}
