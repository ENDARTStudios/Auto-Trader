// src/lib/etl/run.ts — Crypto ETL orchestrator (CoinGecko + DexScreener + GoPlus + Etherscan)
//
// Regra de honestidade (audit round1):
//   - status "ok" SÓ quando o dado veio de HTTP 2xx (provenance "live").
//   - qualquer falha/fallback mock -> status "error", com o motivo persistido.
//   - o rótulo `source` devolvido por cada connector NÃO é descartado: ele é
//     registrado no resultado (e no log), e o status persistido é a proveniência.
//
// Nenhum dado sintético entra no índice RAG ou nas tabelas DataSource.
import { fetchCoinGecko } from "./coingecko";
import { fetchDexScreener } from "./dexscreener";
import { fetchGoPlus } from "./goplus";
import { fetchEtherscan } from "./etherscan";
import type { EtlProvenance } from "./dexscreener";
import { indexEntity } from "../rag/embeddings";
import { logger } from "../trading/logger";
import { db } from "@/lib/db";

export interface EtlSourceResult {
  /** Nome canônico do connector ("CoinGecko", "DexScreener", ...). */
  name: string;
  /** Rótulo de proveniência devolvido pelo connector (ex.: "CoinGecko live (demo key)"). */
  source: string;
  url: string;
  recordsCount: number;
  status: "ok" | "error";
  provenance: EtlProvenance;
  error?: string;
  durationMs: number;
}

export interface EtlRunResult {
  tokens: number;
  pairs: number;
  audits: number;
  contracts: number;
  embeddings: number;
  dataSources: number;
  sources: EtlSourceResult[];
  startedAt: string;
  finishedAt: string;
}

interface JobOutcome<T> {
  records: number;
  source: string;
  provenance: EtlProvenance;
  data: T;
  /** Motivo quando a fonte está indisponível (ex.: sem API key). */
  error?: string;
}

async function runSource<T>(
  name: string,
  url: string,
  fn: () => Promise<JobOutcome<T>>,
  index: (data: T) => Promise<void>
): Promise<EtlSourceResult> {
  const startedAt = Date.now();
  let result: EtlSourceResult;
  try {
    const out = await fn();
    const live = out.provenance === "live";
    if (live) await index(out.data);
    result = {
      name,
      source: out.source,
      url,
      recordsCount: live ? out.records : 0,
      status: live ? "ok" : "error",
      provenance: out.provenance,
      // status "ok" é reservado para dado real (HTTP 2xx). mock/unavailable/error
      // viram "error" explícito — nunca existe fonte "ok" com dado sintético.
      error: live
        ? undefined
        : out.error ?? `proveniência não-live: ${out.provenance} (${out.source})`,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    result = {
      name,
      source: name,
      url,
      recordsCount: 0,
      status: "error",
      provenance: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    await db.dataSource.create({
      data: {
        name: result.name,
        url: result.url,
        status: result.status,
        recordsCount: result.recordsCount,
        error: result.error ?? null,
        startedAt: new Date(Date.now() - result.durationMs),
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    logger.warn("etl", `Falha persistindo DataSource ${result.name}: ${String(err)}`);
  }

  if (result.status === "ok") {
    logger.info("etl", `${result.name}: ok (${result.recordsCount} registros, ${result.source})`);
  } else {
    logger.warn("etl", `${result.name}: error — ${result.error ?? "?"}`);
  }
  return result;
}

export async function runETL(): Promise<EtlRunResult> {
  const startedAt = new Date();
  const sources: EtlSourceResult[] = [];

  // 1. CoinGecko
  let tokens = 0;
  sources.push(
    await runSource(
      "CoinGecko",
      "https://api.coingecko.com/api/v3/coins/markets",
      async () => {
        const cg = await fetchCoinGecko();
        return { records: cg.tokens.length, source: cg.source, provenance: cg.provenance, data: cg.tokens };
      },
      async (list) => {
        for (const t of list) {
          await indexEntity(
            "Token",
            t.symbol,
            `Token ${t.symbol} (${t.name}) chain ${t.chain} price $${t.priceUsd} marketCap $${t.marketCapUsd}`
          );
        }
      }
    )
  );
  if (sources[0].status === "ok") tokens = sources[0].recordsCount;

  // 2. DexScreener
  let pairs = 0;
  sources.push(
    await runSource(
      "DexScreener",
      "https://api.dexscreener.com/tokens/v1",
      async () => {
        const ds = await fetchDexScreener();
        return { records: ds.pairs.length, source: ds.source, provenance: ds.provenance, data: ds.pairs };
      },
      async (list) => {
        for (const p of list) {
          await indexEntity(
            "DexPair",
            p.pairAddress,
            `DexPair ${p.pair} on ${p.dex} chain ${p.chain} liquidity $${p.liquidityUsd} volume24h $${p.volume24hUsd}`
          );
        }
      }
    )
  );
  if (sources[1].status === "ok") pairs = sources[1].recordsCount;

  // 3. GoPlus
  let audits = 0;
  sources.push(
    await runSource(
      "GoPlus",
      "https://api.gopluslabs.io/api/v1/token_security",
      async () => {
        const gp = await fetchGoPlus();
        return { records: gp.audits.length, source: gp.source, provenance: gp.provenance, data: gp.audits };
      },
      async (list) => {
        for (const a of list) {
          await indexEntity(
            "SecurityAudit",
            a.address,
            `SecurityAudit ${a.address} chain ${a.chain} riskScore ${a.riskScore} honeypot ${a.isHoneypot} buyTax ${a.buyTax} sellTax ${a.sellTax}`
          );
        }
      }
    )
  );
  if (sources[2].status === "ok") audits = sources[2].recordsCount;

  // 4. Etherscan (mock só em teste; em produção sem chave -> unavailable)
  let contracts = 0;
  sources.push(
    await runSource(
      "Etherscan",
      "https://api.etherscan.io/v2/api",
      async () => {
        const es = await fetchEtherscan();
        return {
          records: es.sources.length,
          source: es.source,
          provenance: es.provenance,
          data: es.sources,
          error: es.error,
        };
      },
      async (list) => {
        for (const s of list) {
          await indexEntity(
            "ContractSource",
            s.address,
            `Contract ${s.address} chain ${s.chain} verified ${s.verified} proxy ${s.isProxy} compiler ${s.compilerVersion}`
          );
        }
      }
    )
  );
  if (sources[3].status === "ok") contracts = sources[3].recordsCount;

  const embeddings = await db.embedding.count();
  const finishedAt = new Date();

  return {
    tokens,
    pairs,
    audits,
    contracts,
    embeddings,
    dataSources: sources.length,
    sources,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
}
