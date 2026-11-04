// tests/rag-provider.test.ts — embedText real (OpenAI-compatible / Ollama), sem rede
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AIUnavailableError, embedText, getAIStatus } from '@/lib/ai/provider';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockFetch(handler: Handler) {
  const fn = vi.fn((input: unknown, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}
function clearAIEnv() {
  vi.stubEnv('AI_PROVIDER', '');
  vi.stubEnv('AI_API_KEY', '');
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('AI_BASE_URL', '');
  vi.stubEnv('AI_MODEL', '');
  vi.stubEnv('AI_EMBEDDING_MODEL', '');
  vi.stubEnv('AI_EMBEDDING_DIMS', '');
  vi.stubEnv('OLLAMA_URL', '');
  vi.stubEnv('OLLAMA_MODEL', '');
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('embedText — OpenAI-compatible', () => {
  it('faz POST /embeddings com model default, input e Authorization Bearer', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_API_KEY', 'sk-embed');
    const fn = mockFetch(() =>
      jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2] }, { index: 1, embedding: [0.3, 0.4] }] })
    );

    const res = await embedText(['a', 'b']);
    expect(res.provider).toBe('openai');
    expect(res.model).toBe('text-embedding-3-small');
    expect(res.vectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);

    const [url, init] = fn.mock.calls[0];
    expect(String(url)).toBe('https://api.openai.com/v1/embeddings');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-embed');
    const body = JSON.parse(String(init!.body));
    expect(body).toEqual({ model: 'text-embedding-3-small', input: ['a', 'b'] });
  });

  it('respeita AI_BASE_URL, AI_EMBEDDING_MODEL e AI_EMBEDDING_DIMS', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_API_KEY', 'k');
    vi.stubEnv('AI_BASE_URL', 'https://llm.local/v1/');
    vi.stubEnv('AI_EMBEDDING_MODEL', 'meu-embed');
    vi.stubEnv('AI_EMBEDDING_DIMS', '768');
    const fn = mockFetch(() => jsonResponse({ data: [{ index: 0, embedding: [1] }] }));

    const res = await embedText(['x']);
    expect(res.model).toBe('meu-embed');
    expect(String(fn.mock.calls[0][0])).toBe('https://llm.local/v1/embeddings');
    expect(JSON.parse(String(fn.mock.calls[0][1]!.body))).toEqual({ model: 'meu-embed', input: ['x'], dimensions: 768 });
  });

  it('ordena por index mesmo se a API devolver fora de ordem', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_API_KEY', 'k');
    mockFetch(() => jsonResponse({ data: [{ index: 1, embedding: [9] }, { index: 0, embedding: [1] }] }));
    expect((await embedText(['a', 'b'])).vectors).toEqual([[1], [9]]);
  });

  it('credencial rejeitada (401) => AIUnavailableError', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_API_KEY', 'bad');
    mockFetch(() => jsonResponse({ error: 'invalid key' }, 401));
    await expect(embedText(['a'])).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it('HTTP 500 => Error normal (não AIUnavailable)', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_API_KEY', 'k');
    mockFetch(() => jsonResponse({}, 500));
    const err = await embedText(['a']).catch((x) => x);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AIUnavailableError);
  });

  it('quantidade/estrutura inválida de vetores => Error', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_API_KEY', 'k');
    mockFetch(() => jsonResponse({ data: [{ index: 0, embedding: [1] }] })); // 1 vetor p/ 2 textos
    await expect(embedText(['a', 'b'])).rejects.toThrow(/inválidos/);
  });
});

describe('embedText — Ollama', () => {
  it('faz POST /api/embed com model default nomic-embed-text', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'ollama');
    const fn = mockFetch(() => jsonResponse({ embeddings: [[0.5, 0.6]] }));

    const res = await embedText(['texto']);
    expect(res).toMatchObject({ provider: 'ollama', model: 'nomic-embed-text', vectors: [[0.5, 0.6]] });
    expect(String(fn.mock.calls[0][0])).toBe('http://localhost:11434/api/embed');
    expect(JSON.parse(String(fn.mock.calls[0][1]!.body))).toEqual({ model: 'nomic-embed-text', input: ['texto'] });
  });

  it('AI_EMBEDDING_MODEL tem prioridade sobre OLLAMA_MODEL', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_MODEL', 'llama3.1');
    vi.stubEnv('AI_EMBEDDING_MODEL', 'embed-custom');
    mockFetch(() => jsonResponse({ embeddings: [[1]] }));
    expect((await embedText(['x'])).model).toBe('embed-custom');
  });

  it('sem AI_EMBEDDING_MODEL usa OLLAMA_MODEL como fallback do modelo de embedding', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_MODEL', 'meu-modelo-local');
    mockFetch(() => jsonResponse({ embeddings: [[1]] }));
    expect((await embedText(['x'])).model).toBe('meu-modelo-local');
  });

  it('HTTP erro => Error com status', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'ollama');
    mockFetch(() => jsonResponse({ error: 'model not found' }, 404));
    await expect(embedText(['x'])).rejects.toThrow(/HTTP 404/);
  });
});

describe('embedText — indisponibilidade', () => {
  it('sem provider => AIUnavailableError (código estável)', async () => {
    clearAIEnv();
    const err = await embedText(['a']).catch((e) => e);
    expect(err).toBeInstanceOf(AIUnavailableError);
    expect((err as AIUnavailableError).code).toBe('AI_UNAVAILABLE');
  });

  it('getAIStatus expõe embeddingModel', () => {
    clearAIEnv();
    expect(getAIStatus().embeddingModel).toBeNull();
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_API_KEY', 'k');
    expect(getAIStatus().embeddingModel).toBe('text-embedding-3-small');
  });

  it('lote vazio não chama a rede', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_API_KEY', 'k');
    const fn = mockFetch(() => jsonResponse({ data: [] }));
    const res = await embedText([]);
    expect(res.vectors).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
