// src/lib/rag/embeddings.ts — embeddings do RAG
//
// POLÍTICA (round 10):
//   • Com provider de IA configurado (src/lib/ai/provider.ts), index/search usam
//     embeddings REAIS via embedText().
//   • generateEmbedding() (hash determinístico) permanece como fallback
//     EXPLÍCITO/DEGRADADO para dev/testes: permitido quando NODE_ENV !== 'production'
//     OU RAG_ALLOW_HASH_FALLBACK=1. Em PRODUÇÃO sem provider -> AIUnavailableError
//     (nunca indexar um vetor aleatório silenciosamente).
//   • searchEmbeddings ignora linhas cujo vetor tenha dimensão diferente da query
//     (troca de provider/modelo muda a dimensão) — senão o cosine seria inválido.
import { createHash } from 'crypto';
import { db } from '@/lib/db';
import { logger } from '@/lib/trading/logger';
import { AIUnavailableError, embedText } from '@/lib/ai/provider';

function hashToSeed(str: string): number {
  const h = createHash('sha256').update(str).digest('hex');
  return parseInt(h.slice(0, 8), 16) >>> 0;
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Embedding hash determinístico (1536 dims, L2-normalizado).
 * FALLBACK de dev/test — NÃO é semântico. Nunca deve ser a fonte em produção
 * com provider configurado (ver embedTextForRag).
 */
export function generateEmbedding(text: string, dims = 1536): number[] {
  const seed = hashToSeed(text);
  const rand = mulberry32(seed);
  const vec = Array.from({ length: dims }, () => rand() * 2 - 1);
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / (norm || 1));
}

/** Fallback hash permitido? (dev/test, ou opt-in explícito em produção) */
export function isHashFallbackAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.RAG_ALLOW_HASH_FALLBACK === '1';
}

export interface EmbeddingMeta {
  vector: number[];
  provider: string;
  model: string;
}

/**
 * Embedding para uso do RAG: provider real quando configurado; hash como
 * fallback degradado APENAS se permitido. Erros de rede do provider propagam
 * (o chamador decide), mas indisponibilidade sem fallback vira AIUnavailableError.
 */
export async function embedTextForRag(text: string): Promise<EmbeddingMeta> {
  try {
    const res = await embedText([text]);
    const vector = res.vectors[0];
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error('provider devolveu embedding vazio');
    }
    return { vector, provider: res.provider, model: res.model };
  } catch (err) {
    if (err instanceof AIUnavailableError) {
      if (!isHashFallbackAllowed()) {
        // Produção sem provider: NÃO indexar hash aleatório silenciosamente.
        throw new AIUnavailableError(
          'RAG: nenhum provider de embeddings configurado e RAG_ALLOW_HASH_FALLBACK!=1 em produção'
        );
      }
      logger.warn(
        'engine',
        `embeddings: provider indisponível (${err.message}) — usando fallback hash (dev/test)`
      );
      return { vector: generateEmbedding(text), provider: 'hash-fallback', model: 'sha256-mulberry32-1536' };
    }
    throw err;
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function searchEmbeddings(query: string, topK = 3): Promise<Array<{ entityType: string; entityId: string; score: number; content: string }>> {
  const { vector: qEmb } = await embedTextForRag(query);
  const rows = await db.embedding.findMany();
  const scored: Array<{ entityType: string; entityId: string; score: number; content: string }> = [];
  let skipped = 0;
  for (const r of rows) {
    let emb: number[];
    try {
      emb = JSON.parse(r.embedding) as number[];
    } catch {
      skipped++;
      continue;
    }
    // Vetores de dimensão diferente vêm de outro provider/modelo (ex.: troca de
    // text-embedding-3-small -> nomic-embed-text). Cosine entre dims diferentes
    // não tem significado => ignorar (o reindex popula os novos).
    if (!Array.isArray(emb) || emb.length !== qEmb.length) {
      skipped++;
      continue;
    }
    scored.push({ entityType: r.entityType, entityId: r.entityId, score: cosine(qEmb, emb), content: r.content });
  }
  if (skipped > 0) {
    logger.debug('engine', `searchEmbeddings: ${skipped} linha(s) ignorada(s) por dimensão/parse`);
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

export async function indexEntity(entityType: string, entityId: string, content: string): Promise<void> {
  const { vector } = await embedTextForRag(content);
  const emb = JSON.stringify(vector);
  const existing = await db.embedding.findFirst({ where: { entityType, entityId } });
  if (existing) {
    await db.embedding.update({ where: { id: existing.id }, data: { embedding: emb, content } });
  } else {
    await db.embedding.create({ data: { entityType, entityId, embedding: emb, content } });
  }
}
