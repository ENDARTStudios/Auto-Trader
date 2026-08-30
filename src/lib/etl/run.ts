// src/lib/etl/run.ts — Crypto ETL orchestrator (CoinGecko + DexScreener + GoPlus + Etherscan)
import { fetchCoinGecko } from './coingecko';
import { fetchDexScreener } from './dexscreener';
import { fetchGoPlus } from './goplus';
import { fetchEtherscan } from './etherscan';
import { indexEntity } from '../rag/embeddings';
import { db } from '@/lib/db';

interface SourceResult {
  source: string;
  url: string;
  recordsCount: number;
  status: 'ok' | 'error';
  error?: string;
}

export async function runETL(): Promise<{ tokens: number; pairs: number; audits: number; sources: number; embeddings: number; dataSources: number }> {
  const sources: SourceResult[] = [];

  // 1. CoinGecko
  const cgStarted = new Date();
  let cgStatus: 'ok' | 'error' = 'ok';
  let cgError: string | undefined;
  let cgTokens: Awaited<ReturnType<typeof fetchCoinGecko>>['tokens'] = [];
  try {
    const cg = await fetchCoinGecko();
    cgTokens = cg.tokens;
    for (const t of cgTokens) {
      await indexEntity('Token', t.symbol, `Token ${t.symbol} (${t.name}) chain ${t.chain} price $${t.priceUsd} marketCap $${t.marketCapUsd}`);
    }
  } catch (e) {
    cgStatus = 'error';
    cgError = String(e);
  }
  sources.push({
    source: 'CoinGecko',
    url: 'https://api.coingecko.com/api/v3/coins/markets',
    recordsCount: cgTokens.length,
    status: cgStatus,
    error: cgError,
  });
  await db.dataSource
    .create({
      data: {
        name: 'CoinGecko',
        url: 'https://api.coingecko.com/api/v3/coins/markets',
        status: cgStatus,
        recordsCount: cgTokens.length,
        error: cgError ?? null,
        startedAt: cgStarted,
        finishedAt: new Date(),
      },
    })
    .catch(() => null);

  // 2. DexScreener
  const dsStarted = new Date();
  let dsStatus: 'ok' | 'error' = 'ok';
  let dsError: string | undefined;
  let dsPairs: Awaited<ReturnType<typeof fetchDexScreener>>['pairs'] = [];
  try {
    const ds = await fetchDexScreener();
    dsPairs = ds.pairs;
    for (const p of dsPairs) {
      await indexEntity('DexPair', p.pair, `DexPair ${p.pair} on ${p.dex} chain ${p.chain} liquidity $${p.liquidityUsd}`);
    }
  } catch (e) {
    dsStatus = 'error';
    dsError = String(e);
  }
  sources.push({
    source: 'DexScreener',
    url: 'https://api.dexscreener.com/latest/dex/tokens',
    recordsCount: dsPairs.length,
    status: dsStatus,
    error: dsError,
  });
  await db.dataSource
    .create({
      data: {
        name: 'DexScreener',
        url: 'https://api.dexscreener.com/latest/dex/tokens',
        status: dsStatus,
        recordsCount: dsPairs.length,
        error: dsError ?? null,
        startedAt: dsStarted,
        finishedAt: new Date(),
      },
    })
    .catch(() => null);

  // 3. GoPlus
  const gpStarted = new Date();
  let gpStatus: 'ok' | 'error' = 'ok';
  let gpError: string | undefined;
  let gpAudits: Awaited<ReturnType<typeof fetchGoPlus>>['audits'] = [];
  try {
    const gp = await fetchGoPlus();
    gpAudits = gp.audits;
    for (const a of gpAudits) {
      await indexEntity('SecurityAudit', a.address, `SecurityAudit ${a.address} chain ${a.chain} riskScore ${a.riskScore} honeypot ${a.isHoneypot}`);
    }
  } catch (e) {
    gpStatus = 'error';
    gpError = String(e);
  }
  sources.push({
    source: 'GoPlus',
    url: 'https://api.gopluslabs.io/api/v1/token_security',
    recordsCount: gpAudits.length,
    status: gpStatus,
    error: gpError,
  });
  await db.dataSource
    .create({
      data: {
        name: 'GoPlus',
        url: 'https://api.gopluslabs.io/api/v1/token_security',
        status: gpStatus,
        recordsCount: gpAudits.length,
        error: gpError ?? null,
        startedAt: gpStarted,
        finishedAt: new Date(),
      },
    })
    .catch(() => null);

  // 4. Etherscan
  const esStarted = new Date();
  let esStatus: 'ok' | 'error' = 'ok';
  let esError: string | undefined;
  let esSources: Awaited<ReturnType<typeof fetchEtherscan>>['sources'] = [];
  try {
    const es = await fetchEtherscan();
    esSources = es.sources;
    for (const s of esSources) {
      await indexEntity('ContractSource', s.address, `Contract ${s.address} chain ${s.chain} verified ${s.verified} proxy ${s.isProxy} compiler ${s.compilerVersion}`);
    }
  } catch (e) {
    esStatus = 'error';
    esError = String(e);
  }
  sources.push({
    source: 'Etherscan',
    url: 'https://api.etherscan.io/api',
    recordsCount: esSources.length,
    status: esStatus,
    error: esError,
  });
  await db.dataSource
    .create({
      data: {
        name: 'Etherscan',
        url: 'https://api.etherscan.io/api',
        status: esStatus,
        recordsCount: esSources.length,
        error: esError ?? null,
        startedAt: esStarted,
        finishedAt: new Date(),
      },
    })
    .catch(() => null);

  const embeddings = await db.embedding.count();
  return {
    tokens: cgTokens.length,
    pairs: dsPairs.length,
    audits: gpAudits.length,
    sources: esSources.length,
    embeddings,
    dataSources: sources.length,
  };
}
