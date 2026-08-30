// src/lib/etl/run.ts — Crypto ETL orchestrator (CoinGecko + DexScreener + GoPlus + Etherscan)
import { fetchCoinGecko } from './coingecko';
import { fetchDexScreener } from './dexscreener';
import { fetchGoPlus } from './goplus';
import { fetchEtherscan } from './etherscan';
import { indexEntity } from '../rag/embeddings';
import { db } from '@/lib/db';

export async function runETL(): Promise<{ tokens: number; pairs: number; audits: number; sources: number; embeddings: number }> {
  const cg = await fetchCoinGecko();
  for (const t of cg.tokens) {
    await indexEntity('Token', t.symbol, `Token ${t.symbol} (${t.name}) chain ${t.chain} price $${t.priceUsd} marketCap $${t.marketCapUsd}`);
  }

  const ds = await fetchDexScreener();
  for (const p of ds.pairs) {
    await indexEntity('DexPair', p.pair, `DexPair ${p.pair} on ${p.dex} chain ${p.chain} liquidity $${p.liquidityUsd}`);
  }

  const gp = await fetchGoPlus();
  for (const a of gp.audits) {
    await indexEntity('SecurityAudit', a.address, `SecurityAudit ${a.address} chain ${a.chain} riskScore ${a.riskScore} honeypot ${a.isHoneypot}`);
  }

  const es = await fetchEtherscan();
  for (const s of es.sources) {
    await indexEntity('ContractSource', s.address, `Contract ${s.address} chain ${s.chain} verified ${s.verified} proxy ${s.isProxy} compiler ${s.compilerVersion}`);
  }

  const embeddings = await db.embedding.count();
  return { tokens: cg.tokens.length, pairs: ds.pairs.length, audits: gp.audits.length, sources: es.sources.length, embeddings };
}
