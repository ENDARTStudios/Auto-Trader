// src/lib/rag/pipeline.ts — RAG ask REAL (provider de IA, sem "mock LLM")
//
// Round 10: a resposta deixou de ser texto sintético ("Resposta (mock LLM)").
// askRag():
//   1. garante o seed do índice (idempotente: count>0 => não reindexa);
//   2. busca citações por similaridade (embeddings reais via provider);
//   3. chama chatCompletion() REAL com system prompt + contexto citado;
//   4. devolve { answer real, citations, context, provider, model }.
// Sem provider configurado -> AIUnavailableError (a rota responde 503).
import { chatCompletion, type AIProviderKind } from '@/lib/ai/provider';
import { searchEmbeddings, indexEntity } from './embeddings';
import { db } from '@/lib/db';

const SYSTEM_PROMPT =
  'Você é o analista do Auto Trader (bot de cripto em paper-trading). ' +
  'Responda em português, curto e direto, USANDO APENAS o contexto citado. ' +
  'Se o contexto não bastar, diga explicitamente o que falta — nunca invente números. ' +
  'Não dê conselho financeiro pessoal; descreva risco e evidência.';

export async function ensureRagSeed(): Promise<void> {
  const count = await db.embedding.count();
  if (count > 0) return; // idempotente
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

export interface RagAskResult {
  answer: string;
  citations: Array<{ entityType: string; entityId: string; score: number; content: string }>;
  context: string;
  provider: AIProviderKind;
  model: string;
}

export async function askRag(question: string): Promise<RagAskResult> {
  await ensureRagSeed();
  const citations = await searchEmbeddings(question, 3);
  const context = citations
    .map((c) => `[${c.entityType}:${c.entityId} score=${c.score.toFixed(3)}] ${c.content}`)
    .join('\n');

  // Resposta REAL do provider (lança AIUnavailableError se não configurado).
  const completion = await chatCompletion({
    system: SYSTEM_PROMPT,
    user: `CONTEXTO INDEXADO:\n${context || '(vazio)'}\n\nPERGUNTA: ${question}`,
    temperature: 0.2,
  });

  return {
    answer: completion.content,
    citations,
    context,
    provider: completion.provider,
    model: completion.model,
  };
}
