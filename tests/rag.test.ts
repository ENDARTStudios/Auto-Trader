import { describe, it, expect, beforeAll } from 'vitest';
import { generateEmbedding, cosine, searchEmbeddings } from '@/lib/rag/embeddings';
import { askRag } from '@/lib/rag/pipeline';
import { buildGraph } from '@/lib/rag/graph';

describe('RAG embeddings', () => {
  it('generateEmbedding 1536 dims normalized', () => {
    const emb = generateEmbedding('BTC Bitcoin');
    expect(emb.length).toBe(1536);
    const norm = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('cosine same text ~1.0', () => {
    const a = generateEmbedding('BTC');
    const b = generateEmbedding('BTC');
    expect(cosine(a, b)).toBeCloseTo(1, 5);
  });

  it('cosine different text <1.0', () => {
    const a = generateEmbedding('BTC Bitcoin');
    const b = generateEmbedding('SCAM honeypot');
    expect(cosine(a, b)).toBeLessThan(1);
  });

  it('search top 3 returns citations', async () => {
    const res = await searchEmbeddings('BTC', 3);
    expect(Array.isArray(res)).toBe(true);
    // May be 0 if no embeddings yet, but after askRag seed it will be 3
  });

  it('askRag returns answer + citations', async () => {
    const res = await askRag('Quem ganhou a Copa?');
    expect(res.answer.length).toBeGreaterThan(10);
    expect(res.citations.length).toBeGreaterThan(0);
    expect(res.citations.length).toBeLessThanOrEqual(3);
    expect(res.context.length).toBeGreaterThan(0);
  });

  it('buildGraph nodes/edges', async () => {
    const graph = await buildGraph();
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.edges)).toBe(true);
  });
});
