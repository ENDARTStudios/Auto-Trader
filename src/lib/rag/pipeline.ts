// src/lib/rag/pipeline.ts — RAG ask (mock LLM + citations)
import { generateEmbedding, searchEmbeddings, indexEntity } from './embeddings';
import { db } from '@/lib/db';

export async function ensureRagSeed(): Promise<void> {
  const count = await db.embedding.count();
  if (count > 0) return;
  // Seed with existing ScamReport and MarketSnapshot as embeddings
  const scams = await db.scamReport.findMany({ take: 5 });
  for (const s of scams) {
    await indexEntity('ScamReport', s.id, `Token ${s.symbol} score ${s.score} passed ${s.passed} findings ${s.findings ?? ''}`);
  }
  const markets = await db.marketSnapshot.findMany({ take: 5 });
  for (const m of markets) {
    await indexEntity('MarketSnapshot', String(m.id), `Market ${m.symbol} price ${m.priceUsd} signal ${m.signalLabel} score ${m.signalScore}`);
  }
  // Fallback if no data yet
  if (scams.length === 0 && markets.length === 0) {
    await indexEntity('Token', 'BTC', 'BTC Bitcoin is the largest cryptocurrency by market cap, often used as benchmark');
    await indexEntity('Token', 'ETH', 'ETH Ethereum is the second largest, with smart contracts');
    await indexEntity('Token', 'SCAM', 'SCAM token honeypot risk high, liquidity low, contract not verified');
  }
}

export async function askRag(question: string): Promise<{ answer: string; citations: Array<{ entityType: string; entityId: string; score: number; content: string }>; context: string }> {
  await ensureRagSeed();
  // Ensure query also indexed for future? No
  const citations = await searchEmbeddings(question, 3);
  const context = citations.map((c) => `[${c.entityType}:${c.entityId} score=${c.score.toFixed(3)}] ${c.content}`).join('\n');
  // Mock LLM: echo question + context
  const answer = `Com base nos dados indexados:\n${context}\n\nPergunta: "${question}"\nResposta (mock LLM): O sistema analisou ${citations.length} fontes citadas acima. Para "${question}", a recomendação é verificar scamScore e signalLabel das citações.`;
  return { answer, citations, context };
}
