// tests/ai-provider.test.ts — provider de IA REAL/configurável (sem chave = indisponível)
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AIUnavailableError,
  chatCompletion,
  getAIProvider,
  getAIStatus,
  extractJsonObject,
} from '@/lib/ai/provider';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockFetch(handler: Handler) {
  const fn = vi.fn((input: unknown, init?: RequestInit) => handler(String(input), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function clearAIEnv() {
  vi.stubEnv('AI_PROVIDER', '');
  vi.stubEnv('AI_API_KEY', '');
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('AI_BASE_URL', '');
  vi.stubEnv('AI_MODEL', '');
  vi.stubEnv('OLLAMA_URL', '');
  vi.stubEnv('OLLAMA_MODEL', '');
}

describe('AI provider — sem configuração', () => {
  it('getAIStatus() => configured false e getAIProvider() lança AIUnavailableError', () => {
    clearAIEnv();
    expect(getAIStatus()).toEqual({ configured: false, provider: null, model: null, embeddingModel: null });
    try {
      getAIProvider();
      throw new Error('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(AIUnavailableError);
      expect((err as AIUnavailableError).code).toBe('AI_UNAVAILABLE');
    }
  });

  it('chatCompletion sem provider lança AIUnavailableError (não devolve texto falso)', async () => {
    clearAIEnv();
    await expect(chatCompletion({ system: 's', user: 'u' })).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it('AI_PROVIDER=openai sem chave => indisponível', () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'openai');
    expect(getAIStatus().configured).toBe(false);
    expect(() => getAIProvider()).toThrow(AIUnavailableError);
  });
});

describe('AI provider — OpenAI-compatible', () => {
  it('usa defaults (base https://api.openai.com/v1, model gpt-4o-mini) e devolve a resposta', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_API_KEY', 'sk-test');
    const fn = mockFetch(() =>
      jsonResponse({ choices: [{ message: { content: 'RECOMMENDATION: hold' } }], usage: { total_tokens: 42 } })
    );

    const status = getAIStatus();
    expect(status).toEqual({ configured: true, provider: 'openai', model: 'gpt-4o-mini', embeddingModel: 'text-embedding-3-small' });

    const res = await chatCompletion({ system: 'sys', user: 'usr', json: true });
    expect(res.content).toBe('RECOMMENDATION: hold');
    expect(res.provider).toBe('openai');
    expect(res.model).toBe('gpt-4o-mini');
    expect(res.usage?.totalTokens).toBe(42);

    const call = fn.mock.calls[0];
    expect(String(call[0])).toBe('https://api.openai.com/v1/chat/completions');
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'usr' });
  });

  it('respeita AI_BASE_URL e AI_MODEL', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_API_KEY', 'k');
    vi.stubEnv('AI_BASE_URL', 'https://llm.local/v1/');
    vi.stubEnv('AI_MODEL', 'meu-modelo');
    const fn = mockFetch(() => jsonResponse({ choices: [{ message: { content: 'ok' } }] }));

    const res = await chatCompletion({ system: 's', user: 'u' });
    expect(res.model).toBe('meu-modelo');
    expect(String(fn.mock.calls[0][0])).toBe('https://llm.local/v1/chat/completions');
  });

  it('credencial rejeitada (401) => AIUnavailableError (config quebrada)', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_API_KEY', 'sk-bad');
    mockFetch(() => jsonResponse({ error: 'invalid api key' }, 401));
    await expect(chatCompletion({ system: 's', user: 'u' })).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it('erro 500 => Error normal (engine decide), não AIUnavailableError', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_API_KEY', 'sk');
    mockFetch(() => jsonResponse({ error: 'boom' }, 500));
    const err = await chatCompletion({ system: 's', user: 'u' }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AIUnavailableError);
    expect(String(err.message)).toContain('HTTP 500');
  });
});

describe('AI provider — Ollama', () => {
  it('fala POST /api/chat e devolve message.content', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'ollama');
    const fn = mockFetch(() =>
      jsonResponse({ message: { content: '{"reports":[]}' }, prompt_eval_count: 10, eval_count: 5 })
    );

    const status = getAIStatus();
    expect(status).toEqual({ configured: true, provider: 'ollama', model: 'llama3.1', embeddingModel: 'nomic-embed-text' });

    const res = await chatCompletion({ system: 'sys', user: 'usr', json: true });
    expect(res.provider).toBe('ollama');
    expect(res.content).toBe('{"reports":[]}');
    expect(res.usage?.totalTokens).toBe(15);

    const call = fn.mock.calls[0];
    expect(String(call[0])).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(String((call[1] as RequestInit).body));
    expect(body.stream).toBe(false);
    expect(body.format).toBe('json');
    expect(body.model).toBe('llama3.1');
  });

  it('OLLAMA_URL/OLLAMA_MODEL customizados', async () => {
    clearAIEnv();
    vi.stubEnv('AI_PROVIDER', 'ollama');
    vi.stubEnv('OLLAMA_URL', 'http://gpu-box:11434/');
    vi.stubEnv('OLLAMA_MODEL', 'qwen2.5');
    const fn = mockFetch(() => jsonResponse({ message: { content: 'ok' } }));
    const res = await chatCompletion({ system: 's', user: 'u' });
    expect(res.model).toBe('qwen2.5');
    expect(String(fn.mock.calls[0][0])).toBe('http://gpu-box:11434/api/chat');
  });

  it('auto: OLLAMA_URL presente já configura o provider', () => {
    clearAIEnv();
    vi.stubEnv('OLLAMA_URL', 'http://localhost:11434');
    expect(getAIStatus()).toMatchObject({ configured: true, provider: 'ollama' });
  });
});

describe('extractJsonObject', () => {
  it('extrai o objeto JSON de prosa', () => {
    expect(extractJsonObject('texto antes {"a":1} texto depois')).toBe('{"a":1}');
  });
  it('sem JSON lança', () => {
    expect(() => extractJsonObject('sem json aqui')).toThrow();
  });
});
