// tests/rag-pipeline.test.ts — RAG usa provider real; sem mock LLM; dims guard
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const emb = {
  count: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};

vi.mock('@/lib/db', () => ({
  db: {
    embedding: {
      count: (...a: unknown[]) => emb.count(...a),
      findMany: (...a: unknown[]) => emb.findMany(...a),
      findFirst: (...a: unknown[]) => emb.findFirst(...a),
      create: (...a: unknown[]) => emb.create(...a),
      update: (...a: unknown[]) => emb.update(...a),
    },
    scamReport: { findMany: vi.fn(async () => []) },
    marketSnapshot: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock('@/lib/trading/logger', () => {
  const noop = () => undefined;
  return { logger: { info: noop, warn: noop, error: noop, debug: noop } };
});
// Mantém a classe AIUnavailableError real; só as chamadas de IA são mockadas.
vi.mock('@/lib/ai/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/provider')>();
  return {
    ...actual,
    embedText: vi.fn(),
    chatCompletion: vi.fn(),
  };
});

import { AIUnavailableError, chatCompletion, embedText } from '@/lib/ai/provider';
import { generateEmbedding, searchEmbeddings, indexEntity } from '@/lib/rag/embeddings';
import { askRag, ensureRagSeed } from '@/lib/rag/pipeline';

const mockedEmbed = vi.mocked(embedText);
const mockedChat = vi.mocked(chatCompletion);

function row(entityId: string, vector: number[], content = 'conteudo') {
  return { id: `id-${entityId}`, entityType: 'Token', entityId, embedding: JSON.stringify(vector), content };
}

beforeEach(() => {
  for (const fn of Object.values(emb)) fn.mockReset();
  mockedEmbed.mockReset();
  mockedChat.mockReset();
  emb.count.mockResolvedValue(1); // seed já feito (idempotente)
  emb.findMany.mockResolvedValue([]);
  emb.findFirst.mockResolvedValue(null);
  emb.create.mockResolvedValue({});
  emb.update.mockResolvedValue({});
  mockedEmbed.mockResolvedValue({ vectors: [[1, 0, 0]], model: 'text-embedding-3-small', provider: 'openai' });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('indexEntity — embeddings reais', () => {
  it('usa o vetor do provider (não hash) ao indexar', async () => {
    await indexEntity('Token', 'BTC', 'BTC bitcoin');
    expect(mockedEmbed).toHaveBeenCalledWith(['BTC bitcoin']);
    expect(emb.create).toHaveBeenCalledWith({
      data: { entityType: 'Token', entityId: 'BTC', embedding: JSON.stringify([1, 0, 0]), content: 'BTC bitcoin' },
    });
  });

  it('atualiza linha existente em vez de duplicar', async () => {
    emb.findFirst.mockResolvedValue({ id: 'row-1' });
    await indexEntity('Token', 'BTC', 'novo conteúdo');
    expect(emb.update).toHaveBeenCalledWith({ where: { id: 'row-1' }, data: expect.objectContaining({ content: 'novo conteúdo' }) });
    expect(emb.create).not.toHaveBeenCalled();
  });

  it('provider indisponível em teste => fallback hash explícito 1536', async () => {
    mockedEmbed.mockRejectedValue(new AIUnavailableError());
    await indexEntity('Token', 'ETH', 'ETH ethereum');
    const stored = JSON.parse(emb.create.mock.calls[0][0].data.embedding);
    expect(stored).toHaveLength(1536);
    expect(stored).toEqual(generateEmbedding('ETH ethereum'));
  });

  it('em produção sem fallback => AIUnavailableError (não indexa hash)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RAG_ALLOW_HASH_FALLBACK', '0');
    mockedEmbed.mockRejectedValue(new AIUnavailableError());
    await expect(indexEntity('Token', 'X', 'y')).rejects.toBeInstanceOf(AIUnavailableError);
    expect(emb.create).not.toHaveBeenCalled();
  });

  it('produção com RAG_ALLOW_HASH_FALLBACK=1 permite hash (opt-in explícito)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RAG_ALLOW_HASH_FALLBACK', '1');
    mockedEmbed.mockRejectedValue(new AIUnavailableError());
    await indexEntity('Token', 'X', 'y');
    expect(JSON.parse(emb.create.mock.calls[0][0].data.embedding)).toHaveLength(1536);
  });

  it('erro de rede do provider NÃO vira hash (propaga)', async () => {
    mockedEmbed.mockRejectedValue(new Error('HTTP 500'));
    await expect(indexEntity('Token', 'X', 'y')).rejects.toThrow('HTTP 500');
  });
});

describe('searchEmbeddings', () => {
  it('usa embedding do provider na query e pontua por cosine', async () => {
    mockedEmbed.mockResolvedValue({ vectors: [[1, 0, 0]], model: 'm', provider: 'openai' });
    emb.findMany.mockResolvedValue([row('a', [1, 0, 0]), row('b', [0, 1, 0])]);

    const res = await searchEmbeddings('BTC', 2);
    expect(mockedEmbed).toHaveBeenCalledWith(['BTC']);
    expect(res[0]).toMatchObject({ entityId: 'a', score: 1 });
    expect(res[1].score).toBeCloseTo(0, 6);
  });

  it('IGNORA linhas com dimensão diferente (troca de provider/modelo)', async () => {
    mockedEmbed.mockResolvedValue({ vectors: [[1, 0, 0]], model: 'm', provider: 'openai' });
    emb.findMany.mockResolvedValue([row('old-768', new Array(768).fill(0.1)), row('same-3', [0, 0, 1])]);

    const res = await searchEmbeddings('q', 5);
    expect(res).toHaveLength(1);
    expect(res[0].entityId).toBe('same-3');
  });

  it('ignora linhas com embedding malformado (não throw)', async () => {
    mockedEmbed.mockResolvedValue({ vectors: [[1, 0, 0]], model: 'm', provider: 'openai' });
    emb.findMany.mockResolvedValue([{ id: 'x', entityType: 'T', entityId: 'bad', embedding: 'não-json', content: 'c' }, row('ok', [1, 0, 0])]);

    const res = await searchEmbeddings('q', 5);
    expect(res.map((r) => r.entityId)).toEqual(['ok']);
  });

  it('provider indisponível em teste => query hash 1536 (fallback explícito)', async () => {
    mockedEmbed.mockRejectedValue(new AIUnavailableError());
    emb.findMany.mockResolvedValue([row('h', generateEmbedding('q'))]);
    const res = await searchEmbeddings('q', 3);
    expect(res).toHaveLength(1);
    expect(res[0].score).toBeCloseTo(1, 5);
  });
});

describe('ensureRagSeed', () => {
  it('idempotente: count>0 não reindexa', async () => {
    emb.count.mockResolvedValue(7);
    await ensureRagSeed();
    expect(mockedEmbed).not.toHaveBeenCalled();
    expect(emb.create).not.toHaveBeenCalled();
  });

  it('count=0 indexa os fallbacks base quando não há ScamReport/MarketSnapshot', async () => {
    emb.count.mockResolvedValue(0);
    await ensureRagSeed();
    const ids = emb.create.mock.calls.map((c) => c[0].data.entityId);
    expect(ids).toEqual(['BTC', 'ETH', 'SCAM']);
  });
});

describe('askRag — resposta REAL (sem mock LLM)', () => {
  it('chama chatCompletion com o contexto citado e devolve a resposta do provider', async () => {
    mockedEmbed.mockResolvedValue({ vectors: [[1, 0, 0]], model: 'm', provider: 'openai' });
    emb.findMany.mockResolvedValue([row('btc', [1, 0, 0], 'BTC Bitcoin largest cap')]);
    mockedChat.mockResolvedValue({ content: 'Resposta real do modelo.', provider: 'openai', model: 'gpt-4o-mini', durationMs: 5 });

    const res = await askRag('Qual o maior token?');
    expect(res.answer).toBe('Resposta real do modelo.');
    expect(res.provider).toBe('openai');
    expect(res.model).toBe('gpt-4o-mini');
    expect(res.citations).toHaveLength(1);
    expect(res.context).toContain('BTC Bitcoin largest cap');
    expect(res.answer).not.toContain('mock LLM');

    expect(mockedChat).toHaveBeenCalledTimes(1);
    const req = mockedChat.mock.calls[0][0];
    expect(req.user).toContain('CONTEXTO INDEXADO');
    expect(req.user).toContain('BTC Bitcoin largest cap');
    expect(req.user).toContain('Qual o maior token?');
    expect(req.system).toMatch(/USANDO APENAS o contexto/);
  });

  it('sem provider => AIUnavailableError (nunca resposta fabricada)', async () => {
    mockedEmbed.mockRejectedValue(new AIUnavailableError());
    mockedChat.mockRejectedValue(new AIUnavailableError());
    await expect(askRag('x y z')).rejects.toBeInstanceOf(AIUnavailableError);
  });
});
