// src/lib/rag/ollama.ts — DEPRECATED shim
//
// Round 10: embeddings reais agora vivem em src/lib/ai/provider.ts (embedText),
// usado pelo RAG em src/lib/rag/embeddings.ts (embedTextForRag). Esta função é
// mantida apenas por compatibilidade de assinatura e delega ao provider.
// Sem provider em dev/test, cai no hash determinístico (fallback explícito);
// em produção sem provider propaga AIUnavailableError (nunca hash silencioso).
import { AIUnavailableError, embedText } from '@/lib/ai/provider';
import { generateEmbedding, isHashFallbackAllowed } from './embeddings';

export async function generateEmbeddingOllama(text: string): Promise<number[]> {
  try {
    const res = await embedText([text]);
    const vector = res.vectors[0];
    if (Array.isArray(vector) && vector.length > 0) return vector;
    throw new Error('provider devolveu embedding vazio');
  } catch (err) {
    if (err instanceof AIUnavailableError) {
      if (!isHashFallbackAllowed()) throw err;
      return generateEmbedding(text);
    }
    throw err;
  }
}
