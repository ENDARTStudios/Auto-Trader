// src/lib/etl/goplus.ts — GoPlus connector (HTTP real, sem mock)
//
// Endpoint real (público, sem auth, ~100 req/min por IP):
//   GET https://api.gopluslabs.io/api/v1/token_security/{chainId}
//        ?contract_addresses={addr1},{addr2},...
//
// Devolve honeypot simulado on-chain, buy/sell tax, holder concentration,
// LP lock, mint authority etc. GoPlus NÃO é infalível (rug pull com re-lock
// tardio passa), mas é dado real — diferente do mock anterior.
//
// Honestidade: falha de rede/HTTP -> LANÇA; o orquestrador grava status
// "error". Nenhum audit é inventado.
import { logger } from "../trading/logger";
import { ETL_TOKEN_UNIVERSE, type EtlProvenance } from "./dexscreener";

export interface SecurityAudit {
  address: string;
  chain: string;
  isHoneypot: boolean;
  buyTax: number;     // %
  sellTax: number;    // %
  cannotSell: boolean;
  cannotBuy: boolean;
  contractVerified: boolean;
  riskScore: number;  // 0..100 (maior = mais risco)
}

/** chain slug interno -> chainId numérico exigido pelo GoPlus. */
export const GOPLUS_CHAIN_ID: Readonly<Record<string, string>> = {
  ethereum: "1",
  eth: "1",
  bsc: "56",
  polygon: "137",
  arbitrum: "42161",
  optimism: "10",
  base: "8453",
  avalanche: "43114",
};

const GP_TIMEOUT_MS = 8_000;
const GP_BASE = "https://api.gopluslabs.io/api/v1/token_security";

interface GoPlusTokenFields {
  is_honeypot?: string;
  buy_tax?: string;
  sell_tax?: string;
  cannot_sell_all?: string;
  cannot_buy?: string;
  is_open_source?: string;
  is_proxy?: string;
  is_mintable?: string;
  is_blacklisted?: string;
  owner_address?: string;
  [k: string]: unknown;
}

const flag = (v: unknown): boolean => v === "1" || v === "true";

function toAudit(chain: string, address: string, f: GoPlusTokenFields): SecurityAudit {
  const isHoneypot = flag(f.is_honeypot) || flag(f.cannot_sell_all);
  const buyTax = Number.parseFloat(String(f.buy_tax ?? "0")) || 0;
  const sellTax = Number.parseFloat(String(f.sell_tax ?? "0")) || 0;
  const cannotSell = flag(f.cannot_sell_all);
  const cannotBuy = flag(f.cannot_buy);
  const contractVerified = flag(f.is_open_source);

  // Score determinístico a partir de flags reais (0 = sem risco conhecido).
  let risk = 0;
  if (isHoneypot) risk += 60;
  if (cannotSell) risk += 15;
  if (cannotBuy) risk += 10;
  if (!contractVerified) risk += 10;
  if (flag(f.is_proxy)) risk += 5;
  if (flag(f.is_mintable)) risk += 5;
  if (flag(f.is_blacklisted)) risk += 5;
  if (sellTax >= 50) risk += 10;
  else if (sellTax >= 10) risk += 5;
  if (buyTax >= 10) risk += 3;
  const riskScore = Math.max(0, Math.min(100, risk));

  return {
    address,
    chain,
    isHoneypot,
    buyTax,
    sellTax,
    cannotSell,
    cannotBuy,
    contractVerified,
    riskScore,
  };
}

/**
 * Consulta o GoPlus para um conjunto de contratos agrupados por chain.
 * Lança em HTTP != 2xx ou resposta sem `result`; chains sem chainId conhecido
 * são ignoradas com warn (não é falha de rede).
 */
export async function fetchGoPlus(
  tokens: ReadonlyArray<{ chain: string; tokenId: string }> = ETL_TOKEN_UNIVERSE
): Promise<{ audits: SecurityAudit[]; source: string; provenance: EtlProvenance }> {
  const byChain = new Map<string, string[]>();
  for (const t of tokens) {
    const chainId = GOPLUS_CHAIN_ID[t.chain.toLowerCase()];
    if (!chainId) {
      logger.warn("etl", `GoPlus: chain ${t.chain} não suportada (chainId desconhecido)`);
      continue;
    }
    const list = byChain.get(chainId) ?? [];
    list.push(t.tokenId.toLowerCase());
    byChain.set(chainId, list);
  }
  if (byChain.size === 0) throw new Error("GoPlus: nenhum contrato com chainId suportado");

  const audits: SecurityAudit[] = [];
  const failures: string[] = [];

  for (const [chainId, addresses] of byChain.entries()) {
    const url = `${GP_BASE}/${chainId}?contract_addresses=${addresses.join(",")}`;
    try {
      const resp = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(GP_TIMEOUT_MS),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = (await resp.json()) as {
        code?: number;
        message?: string;
        result?: Record<string, GoPlusTokenFields>;
      };
      if (json.code !== 1 || !json.result) {
        throw new Error(`API code=${json.code ?? "?"} msg=${json.message ?? ""}`);
      }
      const chainSlug = ETL_TOKEN_UNIVERSE.find((t) => GOPLUS_CHAIN_ID[t.chain] === chainId)?.chain ?? chainId;
      for (const [address, fields] of Object.entries(json.result)) {
        audits.push(toAudit(chainSlug, address, fields ?? {}));
      }
    } catch (err) {
      failures.push(`chain ${chainId}: ${String(err)}`);
      logger.warn("etl", `GoPlus chain ${chainId} falhou: ${String(err)}`);
    }
  }

  if (audits.length === 0) {
    throw new Error(`GoPlus: nenhum audit real obtido (${failures.join("; ") || "sem retorno"})`);
  }
  logger.info("etl", `GoPlus real: ${audits.length} audits (${failures.length} chains falharam)`);
  return {
    audits,
    source: `GoPlus live (${audits.length} audits)`,
    provenance: "live",
  };
}
