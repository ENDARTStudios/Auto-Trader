/**
 * Fase 2.1 — LLMExtractor concreto: prosa do TradingAgents -> TAAnalystReport[].
 * Skill v1.6. Guardrails:
 *   §2.7   roteamento determinístico prosa->kind (LLM não decide estrutura).
 *   §0.5   devolve convicção/direção, NUNCA probabilidade de EV.
 *   §4.4d  validação estrita: JSON malformado -> UnparseableThesis -> fallback.
 *   §5.12  extrai forward com prazo; sem alvo -> needs_fill (não inventa).
 *   BYOK   provedor-agnóstico via interface LLMProvider (OpenAI/Anthropic/DeepSeek).
 */

import type { TAAnalystReport, AnalystKind } from './perception-enrichment';
import type { TAGraphState, LLMExtractor } from './tradingagents-adapter';
import { UnparseableThesis } from './tradingagents-adapter';
import type { SchemaDescriptor } from './schema-descriptor';
import { DEFAULT_DESCRIPTOR } from './schema-descriptor';

/* ===================== provedor-agnóstico (BYOK) ===================== */
export interface JSONSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
}

export interface LLMRequest {
  system: string;
  user: string;
  schema: JSONSchema;
  /** 0 = determinístico; extractor usa baixo p/ reduzir alucinação. */
  temperature?: number;
}

export interface LLMProvider {
  /** Deve retornar JSON já parseado conforme `schema`. */
  completeJSON<T>(req: LLMRequest): Promise<T>;
}

/* Wrappers finitos: recebem o client SDK injetado (BYOK do TradingAgentsX).
   Não acoplam a um SDK específico — o dev passa o client. */
export function openAIProvider(client: {
  chat: { completions: { create(o: unknown): Promise<{ choices: { message: { content: string } }[] }> } };
  model: string;
}): LLMProvider {
  return {
    async completeJSON<T>(req: LLMRequest): Promise<T> {
      const res = await client.chat.completions.create({
        model: client.model,
        temperature: req.temperature ?? 0,
        response_format: { type: 'json_object' }, // JSON mode
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      });
      return JSON.parse(res.choices[0].message.content) as T;
    },
  };
}

export function anthropicProvider(client: {
  messages: { create(o: unknown): Promise<{ content: { text: string }[] }> };
  model: string;
}): LLMProvider {
  return {
    async completeJSON<T>(req: LLMRequest): Promise<T> {
      const res = await client.messages.create({
        model: client.model,
        temperature: req.temperature ?? 0,
        max_tokens: 2048,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      });
      const text = res.content.map((c) => c.text).join('');
      return JSON.parse(extractJSONBlock(text)) as T;
    },
  };
}

/* Mock p/ testes determinísticos (sem rede). */
export function mockProvider(fn: (req: LLMRequest) => unknown): LLMProvider {
  return { async completeJSON<T>(req: LLMRequest) { return fn(req) as T; } };
}

/* ===================== schema de saída do extractor ===================== */
const EXTRACT_SCHEMA: JSONSchema = {
  type: 'object',
  properties: {
    reports: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['technical', 'fundamental', 'sentiment', 'macro'] },
          payload: {
            type: 'object',
            properties: {
              price: { type: 'number' },
              volume: { type: 'number' },
              valuationZ: { type: 'number' },
              narrativeHeat: { type: 'number', minimum: 0, maximum: 1 },
              retailInflowZ: { type: 'number' },
              mediaLeadLag: { type: 'number' },
              liquidityState: { type: 'string', enum: ['flood', 'neutral', 'drain'] },
              ratesDirection: { type: 'string', enum: ['up', 'flat', 'down'] },
              geopoliticRisk: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
          // autoconfiança da EXTRAÇÃO (não do TA) -> alimenta enrichmentQuality.
          extraction_confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['kind', 'payload', 'extraction_confidence'],
      },
    },
    forward: {
      type: 'object',
      nullable: true,
      properties: {
        event: { type: 'string' },
        deadline_days: { type: 'integer', minimum: 1, maximum: 120 },
      },
    },
  },
  required: ['reports'],
};

/* ===================== roteamento determinístico (sem LLM) ===================== */
interface LabeledBlock { kind: AnalystKind; text: string }

/**
 * Roteamento descriptor-driven (Fase 4.1): lê as keys do SchemaDescriptor
 * em vez de hardcodear. Coerente com achado (B): o core NÃO tem nó macro
 * dedicado -> default deriva macro do news_report. Key null (não confirmada)
 * -> ignorada com segurança; fallback interno cobre (§4.4d).
 * Isso tira do LLM a decisão "qual texto é qual analista" (menos alucinação).
 *
 * TODO(manifest-B): rodar scripts/inspect_ta_schema.py no fork e injetar o
 * descriptor gerado; default ALTA sustenta o core até lá.
 */
export function routeProsaToBlocks(state: TAGraphState, desc: SchemaDescriptor = DEFAULT_DESCRIPTOR): LabeledBlock[] {
  const blocks: LabeledBlock[] = [];
  const push = (kind: AnalystKind, key: string | null) => {
    if (!key) return; // B-fim: key nao confirmada -> ignora com seguranca (fallback cobre)
    const t = String((state as Record<string, unknown>)[key] ?? '').trim();
    if (t.length > 40) blocks.push({ kind, text: t }); // ignora prosa vazia/trivial
  };
  push('technical',   desc.prosa_keys.technical);
  push('fundamental', desc.prosa_keys.fundamental);
  push('sentiment',   desc.prosa_keys.sentiment);
  push('macro',       desc.prosa_keys.macro);
  return blocks;
}

/* ===================== extractor concreto ===================== */
export interface ExtractorConfig {
  /** teto de custo/latência: 1 chamada por runDebate. */
  maxBlocksPerCall?: number;
  /** descriptor do manifest; default = ALTA-por-indice (seguro p/ core). */
  descriptor?: SchemaDescriptor;
}

export class ProsaToReportExtractor implements LLMExtractor {
  private lastParsed: { reports: TAAnalystReport[]; forward: ExtractorForward | null } | null = null;
  private readonly maxBlocks: number;
  private readonly descriptor: SchemaDescriptor;

  constructor(
    private readonly provider: LLMProvider,
    cfg: ExtractorConfig = {},
  ) {
    this.maxBlocks = cfg.maxBlocksPerCall ?? 4;
    this.descriptor = cfg.descriptor ?? DEFAULT_DESCRIPTOR;
  }

  /** Contrato Fase 2: prosa -> TAAnalystReport[]. Cacheia p/ extractForward. */
  async extractProsaToReports(
    state: TAGraphState,
    asOf: number,
    desc?: SchemaDescriptor,
  ): Promise<TAAnalystReport[]> {
    const blocks = routeProsaToBlocks(state, desc ?? this.descriptor).slice(0, this.maxBlocks);
    if (!blocks.length) throw new UnparseableThesis('sem prosa utilizável do TA');

    const user = this.buildUserPrompt(blocks, asOf);
    const system =
      'Você extrai sinais ESTRUTURADOS de relatórios de análise de mercado. ' +
      'Responda SOMENTE com JSON conforme o schema. NÃO invente números ausentes: ' +
      'se um campo não estiver claro no texto, omita-o e reduza extraction_confidence. ' +
      'NUNCA produza probabilidade de alta/baixa — apenas os campos do schema. ' +
      'forward: extraia alvo e prazo se existirem; senão null.';

    let raw: unknown;
    try {
      raw = await this.provider.completeJSON({ system, user, schema: EXTRACT_SCHEMA, temperature: 0 });
    } catch (e) {
      // falha do provedor = dado inválido -> propaga p/ fallback (4.4d), não opera no escuro
      throw new UnparseableThesis(`provedor falhou: ${(e as Error).message}`);
    }

    const parsed = validateExtract(raw, blocks, asOf); // validação estrita
    this.lastParsed = parsed;
    return parsed.reports;
  }

  /** Extra: preenche forward real se o LLM achou alvo/prazo; senão null (stub do adaptador vale). */
  async extractForward(): Promise<ExtractorForward | null> {
    return this.lastParsed?.forward ?? null;
  }

  private buildUserPrompt(blocks: LabeledBlock[], asOf: number): string {
    const labeled = blocks
      .map((b, i) => `--- BLOCO ${i + 1} [kind=${b.kind}] as_of=${asOf} ---\n${b.text}`)
      .join('\n\n');
    return `Extraia um report por bloco, usando o kind indicado. Blocos:\n\n${labeled}\n\n` +
      `Devolva {"reports":[...], "forward":{...}|null}. ` +
      `Cada report.kind DEVE ser igual ao kind do bloco. Payload só com campos presentes no texto.`;
  }
}

export interface ExtractorForward { event: string; deadline_days: number }

/* ===================== validação estrita (anti-alucinação) ===================== */
const KINDS: AnalystKind[] = ['technical', 'fundamental', 'sentiment', 'macro'];

function validateExtract(
  raw: unknown,
  blocks: LabeledBlock[],
  asOf: number,
): { reports: TAAnalystReport[]; forward: ExtractorForward | null } {
  if (!raw || typeof raw !== 'object') throw new UnparseableThesis('resposta não-objeto');
  const obj = raw as { reports?: unknown; forward?: unknown };
  if (!Array.isArray(obj.reports) || obj.reports.length === 0) {
    throw new UnparseableThesis('reports vazio/não-array');
  }

  const expectedKinds = new Set(blocks.map((b) => b.kind));
  const reports: TAAnalystReport[] = [];
  for (const item of obj.reports) {
    const r = coerceReport(item, expectedKinds, asOf);
    if (r) reports.push(r);
  }
  if (!reports.length) throw new UnparseableThesis('nenhum report válido após coerção');

  const forward = coerceForward(obj.forward);
  return { reports, forward };
}

function coerceReport(item: unknown, expectedKinds: Set<AnalystKind>, asOf: number): TAAnalystReport | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  const kind = o.kind as AnalystKind;
  if (!KINDS.includes(kind) || !expectedKinds.has(kind)) return null; // kind fora do roteamento = rejeita
  const payload = (o.payload && typeof o.payload === 'object') ? o.payload as Record<string, unknown> : {};

  // precisa de ao menos UM campo numérico/enum plausível pro kind -> senão descarta.
  const hasSignal = Object.values(payload).some((v) =>
    typeof v === 'number' || (typeof v === 'string' && ['flood','neutral','drain','up','flat','down'].includes(v)));
  if (!hasSignal) return null;

  // extraction_confidence ausente -> baixo (0.2) e marcado (penaliza enrichmentQuality).
  const conf = typeof o.extraction_confidence === 'number'
    ? clamp01(o.extraction_confidence) : 0.2;

  return {
    kind,
    asOf, // frescura do ciclo, não do texto (TA não carimba data confiável)
    payload: sanitizePayload(kind, payload),
    rawConfidence: conf,
  };
}

/** Garante ranges dos campos (narrativeHeat 0-1, geopoliticRisk 0-1). */
function sanitizePayload(kind: AnalystKind, p: Record<string, unknown>): TAAnalystReport['payload'] {
  const out: TAAnalystReport['payload'] = {};
  const num = (k: string) => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? p[k] as number : undefined);
  const frac = (k: string) => { const v = num(k); return v === undefined ? undefined : clamp01(v); };
  if (kind === 'technical') { out.price = num('price'); out.volume = num('volume'); }
  if (kind === 'fundamental') { out.valuationZ = num('valuationZ'); }
  if (kind === 'sentiment') {
    out.narrativeHeat = frac('narrativeHeat');
    out.retailInflowZ = num('retailInflowZ');
    out.mediaLeadLag = num('mediaLeadLag');
  }
  if (kind === 'macro') {
    if (typeof p.liquidityState === 'string') out.liquidityState = p.liquidityState as 'flood'|'neutral'|'drain';
    if (typeof p.ratesDirection === 'string') out.ratesDirection = p.ratesDirection as 'up'|'flat'|'down';
    out.geopoliticRisk = frac('geopoliticRisk');
  }
  return out;
}

function coerceForward(f: unknown): ExtractorForward | null {
  if (!f || typeof f !== 'object') return null;
  const o = f as Record<string, unknown>;
  const event = typeof o.event === 'string' ? o.event.trim() : '';
  const days = typeof o.deadline_days === 'number' ? Math.round(o.deadline_days) : 0;
  if (!event || days < 1 || days > 120) return null; // alvo/prazo não plausível -> null (stub vale)
  return { event, deadline_days: days };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
function extractJSONBlock(text: string): string {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('sem JSON na resposta');
  return m[0];
}
