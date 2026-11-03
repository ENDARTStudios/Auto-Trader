// src/lib/ai/provider.ts — camada ÚNICA de acesso a LLM (real, configurável)
//
// Antes: o código usava z-ai-web-dev-sdk direto e, quando falhava, virava
// recommendation="investigate" (mentira: parecia análise, era ausência de IA).
// Agora:
//   - provider configurável por env; sem provider -> AIUnavailableError (o
//     chamador decide degradar honestamente: 503 na API, sem veto no engine).
//   - erros de rede/HTTP não-401 propagam como Error normal (o engine decide).
//   - JSON inválido é responsabilidade do chamador (parse).
//
// Providers suportados:
//   openai  — qualquer endpoint OpenAI-compatible (OpenAI, DeepSeek, Groq, vLLM…)
//             env: AI_PROVIDER=openai, AI_API_KEY|OPENAI_API_KEY,
//                  AI_BASE_URL (default https://api.openai.com/v1),
//                  AI_MODEL (default gpt-4o-mini)
//   ollama  — servidor local
//             env: AI_PROVIDER=ollama, OLLAMA_URL (default http://localhost:11434),
//                  OLLAMA_MODEL (default llama3.1)
//   auto    — default: detecta openai se houver chave, ollama se OLLAMA_URL/
//             OLLAMA_MODEL estiverem definidos; senão -> não configurado.

export type AIProviderKind = "openai" | "ollama";

export interface ChatCompletionRequest {
  system: string;
  user: string;
  /** Pede JSON mode quando o provider suportar. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletionResult {
  content: string;
  provider: AIProviderKind;
  model: string;
  usage?: { totalTokens?: number };
  durationMs: number;
}

export interface AIProvider {
  kind: AIProviderKind;
  model: string;
  baseUrl: string;
  chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResult>;
}

export interface AIStatus {
  configured: boolean;
  provider: AIProviderKind | null;
  model: string | null;
}

/** Erro de configuração/indisponibilidade do provedor de IA (não é falha de rede). */
export class AIUnavailableError extends Error {
  readonly code = "AI_UNAVAILABLE" as const;
  constructor(message = "Nenhum provedor de IA configurado (AI_PROVIDER/AI_API_KEY/OLLAMA_URL ausentes)") {
    super(message);
    this.name = "AIUnavailableError";
  }
}

const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const OLLAMA_DEFAULT_URL = "http://localhost:11434";
const OLLAMA_DEFAULT_MODEL = "llama3.1";
const AI_TIMEOUT_MS = 30_000;

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function resolveProviderKind(): AIProviderKind | null {
  const explicit = env("AI_PROVIDER")?.toLowerCase();
  const hasOpenAIKey = Boolean(env("AI_API_KEY") ?? env("OPENAI_API_KEY"));
  const hasOllama = Boolean(env("OLLAMA_URL") ?? env("OLLAMA_MODEL"));

  if (explicit === "openai") return hasOpenAIKey ? "openai" : null;
  if (explicit === "ollama") return "ollama";
  if (explicit === "none" || explicit === "disabled") return null;
  // auto (default)
  if (hasOpenAIKey) return "openai";
  if (hasOllama) return "ollama";
  return null;
}

export function getAIStatus(): AIStatus {
  const kind = resolveProviderKind();
  if (!kind) return { configured: false, provider: null, model: null };
  if (kind === "openai") {
    return { configured: true, provider: "openai", model: env("AI_MODEL") ?? OPENAI_DEFAULT_MODEL };
  }
  return {
    configured: true,
    provider: "ollama",
    model: env("OLLAMA_MODEL") ?? OLLAMA_DEFAULT_MODEL,
  };
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal: AbortSignal
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
}

function openAIProvider(apiKey: string): AIProvider {
  const baseUrl = (env("AI_BASE_URL") ?? OPENAI_DEFAULT_BASE).replace(/\/+$/, "");
  const model = env("AI_MODEL") ?? OPENAI_DEFAULT_MODEL;
  return {
    kind: "openai",
    model,
    baseUrl,
    async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
      const started = Date.now();
      const messages = [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ];
      const resp = await postJson(
        `${baseUrl}/chat/completions`,
        {
          model,
          temperature: req.temperature ?? 0.2,
          ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
          ...(req.json ? { response_format: { type: "json_object" } } : {}),
          messages,
        },
        { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        AbortSignal.timeout(AI_TIMEOUT_MS)
      );
      if (resp.status === 401 || resp.status === 403) {
        // chave inválida/sem permissão = configuração quebrada, não indisponibilidade transitória
        throw new AIUnavailableError(
          `Provedor OpenAI-compatible rejeitou a credencial (HTTP ${resp.status})`
        );
      }
      if (!resp.ok) {
        throw new Error(`AI provider HTTP ${resp.status} (${baseUrl})`);
      }
      const json = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens?: number };
      };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        throw new Error("AI provider devolveu resposta vazia");
      }
      return {
        content,
        provider: "openai",
        model,
        usage: { totalTokens: json.usage?.total_tokens },
        durationMs: Date.now() - started,
      };
    },
  };
}

function ollamaProvider(): AIProvider {
  const baseUrl = (env("OLLAMA_URL") ?? OLLAMA_DEFAULT_URL).replace(/\/+$/, "");
  const model = env("OLLAMA_MODEL") ?? OLLAMA_DEFAULT_MODEL;
  return {
    kind: "ollama",
    model,
    baseUrl,
    async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
      const started = Date.now();
      const resp = await postJson(
        `${baseUrl}/api/chat`,
        {
          model,
          stream: false,
          ...(req.json ? { format: "json" } : {}),
          options: { temperature: req.temperature ?? 0.2 },
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        },
        { Accept: "application/json" },
        AbortSignal.timeout(AI_TIMEOUT_MS)
      );
      if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        throw new Error(`Ollama HTTP ${resp.status} (${baseUrl})${detail ? ": " + detail.slice(0, 200) : ""}`);
      }
      const json = (await resp.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const content = json.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        throw new Error("Ollama devolveu resposta vazia");
      }
      const total = (json.prompt_eval_count ?? 0) + (json.eval_count ?? 0);
      return {
        content,
        provider: "ollama",
        model,
        usage: { totalTokens: total > 0 ? total : undefined },
        durationMs: Date.now() - started,
      };
    },
  };
}

/** Provider ativo ou lança AIUnavailableError. */
export function getAIProvider(): AIProvider {
  const kind = resolveProviderKind();
  if (kind === "openai") {
    const apiKey = env("AI_API_KEY") ?? env("OPENAI_API_KEY");
    if (!apiKey) throw new AIUnavailableError("AI_PROVIDER=openai sem AI_API_KEY/OPENAI_API_KEY");
    return openAIProvider(apiKey);
  }
  if (kind === "ollama") return ollamaProvider();
  throw new AIUnavailableError();
}

/** Atalho: chat completion pelo provider ativo (lança AIUnavailableError se não houver). */
export async function chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
  return getAIProvider().chatCompletion(req);
}

/** Extrai o primeiro objeto JSON de um texto (LLMs às vezes embrulham em prosa). */
export function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("resposta sem objeto JSON");
  return candidate.slice(start, end + 1);
}
