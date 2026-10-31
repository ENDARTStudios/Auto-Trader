// src/lib/rag/embeddings.ts — Mock embeddings (S12, 1536 dims, SQLite JSON, pg prod vector)
import { createHash } from 'crypto';
import { db } from '@/lib/db';

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

export function generateEmbedding(text: string, dims = 1536): number[] {
  const seed = hashToSeed(text);
  const rand = mulberry32(seed);
  const vec = Array.from({ length: dims }, () => rand() * 2 - 1);
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / (norm || 1));
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
  const qEmb = generateEmbedding(query);
  const rows = await db.embedding.findMany();
  const scored = rows.map((r) => {
    const emb = JSON.parse(r.embedding) as number[];
    return { entityType: r.entityType, entityId: r.entityId, score: cosine(qEmb, emb), content: r.content };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

export async function indexEntity(entityType: string, entityId: string, content: string): Promise<void> {
  const emb = generateEmbedding(content);
  const existing = await db.embedding.findFirst({ where: { entityType, entityId } });
  if (existing) {
    await db.embedding.update({ where: { id: existing.id }, data: { embedding: JSON.stringify(emb), content } });
  } else {
    await db.embedding.create({ data: { entityType, entityId, embedding: JSON.stringify(emb), content } });
  }
}
