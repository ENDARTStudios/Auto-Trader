// src/lib/etl/etherscan.ts — Etherscan contract source verifier
// Real: Etherscan API V2 (chave única multi-chain, param chainid). O free tier
// valida apenas algumas chains — watchlist restrita a Ethereum + Arbitrum
// (Base/Optimism/BSC exigem plano Pro; ver mapa em .env.example). Sem rede →
// fallback mock. Em NODE_ENV=test fica no mock (determinismo).
import { getEnv } from "@/lib/env";
import { logger } from "../trading/logger";

export interface ContractSource {
  address: string;
  chain: string;             // "ethereum" | "arbitrum" | "optimism" | "base"
  verified: boolean;
  hasMint: boolean;          // risk flag
  hasBlacklist: boolean;     // risk flag
  isProxy: boolean;          // upgradeable flag
  compilerVersion: string;   // e.g. "v0.8.24+commit.e11b9ed9"
}

const MOCK_SOURCES: ContractSource[] = [
  { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", chain: "ethereum", verified: true, hasMint: false, hasBlacklist: false, isProxy: false, compilerVersion: "v0.8.24+commit.e11b9ed9" },
  { address: "0xA0b86991c6218b36c1d1D4F73CA3dab40Eb8Fd9Da", chain: "ethereum", verified: true, hasMint: false, hasBlacklist: true,  isProxy: false, compilerVersion: "v0.6.6+commit.6cbfd09" },
  { address: "0xC02aaA39b223FE8D000A0e5C4F27eAD9083C756Cc2", chain: "ethereum", verified: true, hasMint: true,  hasBlacklist: false, isProxy: true,  compilerVersion: "v0.8.20+commit.a1b79de6" },
  { address: "0x4200000000000000000000000000000000000042", chain: "optimism", verified: true, hasMint: false, hasBlacklist: false, isProxy: true,  compilerVersion: "v0.8.19+commit.ea26856" },
  { address: "0xDead000000000000000000000000000000000dEaD", chain: "ethereum", verified: false, hasMint: true,  hasBlacklist: true,  isProxy: true,  compilerVersion: "unknown" },
];

// Contratos notáveis cobertos pelo free tier da V2 (endereços validados
// via getsourcecode em 2026-11-01)
const WATCHLIST: Array<{ chain: string; chainId: number; address: string }> = [
  { chain: "ethereum", chainId: 1, address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },     // WETH9
  { chain: "ethereum", chainId: 1, address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },     // TetherToken
  { chain: "arbitrum", chainId: 42161, address: "0x912CE59144191C1204E64559FE8253a0e49E6548" }, // ARB (proxy)
];

interface V2SourceResult {
  SourceCode: string;
  ABI: string;
  ContractName: string;
  CompilerVersion: string;
  Proxy: string;
}

async function fetchOne(apiKey: string, chainId: number, address: string): Promise<ContractSource | null> {
  const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`;
  const resp = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Etherscan HTTP ${resp.status}`);
  const json = (await resp.json()) as { status: string; result: V2SourceResult[] | string };
  if (json.status !== "1" || !Array.isArray(json.result) || json.result.length === 0) {
    throw new Error(`Etherscan NOTOK: ${JSON.stringify(json.result).slice(0, 120)}`);
  }
  const r = json.result[0];
  const verified = r.ABI !== "Contract source code not verified" && r.SourceCode.trim().length > 0;
  return {
    address,
    chain: WATCHLIST.find((w) => w.address === address)?.chain ?? "ethereum",
    verified,
    hasMint: /function mint\(|_mint\(/i.test(r.SourceCode),
    hasBlacklist: /blacklist/i.test(r.SourceCode),
    isProxy: r.Proxy === "1" || /TransparentUpgradeableProxy|Initializable/i.test(r.ContractName + r.SourceCode),
    compilerVersion: r.CompilerVersion || "unknown",
  };
}

export async function fetchEtherscan(): Promise<{ sources: ContractSource[]; source: string }> {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return { sources: MOCK_SOURCES, source: "Etherscan mock" };
  }

  const apiKey = getEnv().ETHERSCAN_API_KEY;
  if (!apiKey) {
    return { sources: MOCK_SOURCES, source: "Etherscan mock (sem ETHERSCAN_API_KEY)" };
  }

  try {
    const out: ContractSource[] = [];
    for (const w of WATCHLIST) {
      try {
        const s = await fetchOne(apiKey, w.chainId, w.address);
        if (s) out.push(s);
      } catch (e) {
        // Contrato individual falhando não derruba o ETL — registra e segue
        logger.warn("etl", `Etherscan ${w.address} (chain ${w.chainId}) falhou: ${String(e)}`);
      }
      await new Promise((r) => setTimeout(r, 250)); // rate limit free: 5 req/s
    }
    if (out.length === 0) throw new Error("nenhum contrato retornado");
    logger.info("etl", `Etherscan real: ${out.length} contratos verificados`);
    return { sources: out, source: "Etherscan real (V2 multi-chain)" };
  } catch (e) {
    logger.warn("etl", `Etherscan real falhou — usando mock como fallback: ${String(e)}`);
    return { sources: MOCK_SOURCES, source: "Etherscan mock (fallback)" };
  }
}
