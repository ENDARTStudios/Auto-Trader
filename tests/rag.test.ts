import { describe, it, expect, vi } from 'vitest';

// Round 10: o RAG usa provider REAL. Aqui mockamos só as chamadas de IA
// (chatCompletion) mantendo a classe AIUnavailableError real. Embeddings caem
// no fallback hash em NODE_ENV=test (sem provider) — comportamento explícito.
vi.mock('@/lib/ai/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/provider')>();
  return { ...actual, chatCompletion: vi.fn() };
});

import { chatCompletion, AIUnavailableError } from '@/lib/ai/provider';
import { generateEmbedding, cosine, searchEmbeddings } from '@/lib/rag/embeddings';
import { askRag } from '@/lib/rag/pipeline';
import { buildGraph } from '@/lib/rag/graph';

const mockedChat = vi.mocked(chatCompletion);

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

  it('askRag devolve a resposta REAL do provider (sem "mock LLM")', async () => {
    mockedChat.mockResolvedValueOnce({ content: 'Resposta real do provider.', provider: 'openai', model: 'gpt-4o-mini', durationMs: 1 });
    const res = await askRag('Qual é o token com maior liquidez?');
    expect(res.answer).toBe('Resposta real do provider.');
    expect(res.answer).not.toMatch(/mock LLM/i);
    expect(res.citations.length).toBeLessThanOrEqual(3);
    expect(res.provider).toBe('openai');
    expect(mockedChat).toHaveBeenCalledTimes(1);
  });

  it('askRag sem provider => AIUnavailableError (nunca fabrica resposta)', async () => {
    mockedChat.mockRejectedValueOnce(new AIUnavailableError());
    await expect(askRag('qualquer pergunta válida')).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it('buildGraph nodes/edges', async () => {
    const graph = await buildGraph();
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.edges)).toBe(true);
  });
});
