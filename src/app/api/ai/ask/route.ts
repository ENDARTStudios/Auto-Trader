import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { ForbiddenError } from '@/lib/auth/errors';
import { handleApiError } from '@/lib/api/error-handler';
import { checkRateLimit } from '@/lib/rate-limit';
import { askRag } from '@/lib/rag/pipeline';
import { buildEvidenceLedger } from '@/lib/rag/evidence';
import { chatCompletion, getAIStatus, AIUnavailableError } from '@/lib/ai/provider';
import { recordSuccess, recordError } from '@/lib/trading/source-health';

const schema = z.object({ question: z.string().min(3).max(500) });

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

const SYSTEM_PROMPT =
  'Você é o analista do Auto Trader (bot de cripto em paper-trading). ' +
  'Responda em português, curto e direto, USANDO APENAS o contexto citado. ' +
  'Se o contexto não bastar, diga explicitamente o que falta — nunca invente números. ' +
  'Não dê conselho financeiro pessoal; descreva risco e evidência.';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, '/api/ai/ask');
    if (!rl.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } });
    const session = await requireSession(req);
    if (!hasPermission(session.role, 'dashboard:read')) throw new ForbiddenError('dashboard:read');
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'validation_error', details: parsed.error.flatten() }, { status: 400 });

    // Sem provider real configurado -> 503 explícito. Nada de resposta "mock LLM"
    // apresentada como análise (era o comportamento antigo de askRag).
    const status = getAIStatus();
    if (!status.configured) {
      return NextResponse.json(
        { error: 'ai_unavailable', message: 'Nenhum provedor de IA configurado (AI_PROVIDER/AI_API_KEY/OLLAMA_URL).', provider: null, model: null },
        { status: 503 }
      );
    }

    const result = await askRag(parsed.data.question);
    const evidence = buildEvidenceLedger(result.answer, result.citations);

    let answer = result.answer;
    try {
      const completion = await chatCompletion({
        system: SYSTEM_PROMPT,
        user: `CONTEXTO INDEXADO:\n${result.context || '(vazio)'}\n\nPERGUNTA: ${parsed.data.question}`,
        temperature: 0.2,
      });
      answer = completion.content;
      await recordSuccess('zai');
    } catch (err) {
      if (err instanceof AIUnavailableError) {
        return NextResponse.json(
          { error: 'ai_unavailable', message: err.message, provider: status.provider, model: status.model },
          { status: 503 }
        );
      }
      await recordError('zai', err instanceof Error ? err.message : String(err));
      throw err;
    }

    return NextResponse.json({
      answer,
      citations: result.citations,
      context: result.context,
      evidence,
      provider: status.provider,
      model: status.model,
    });
  } catch (err) {
    return handleApiError(err, 'POST /api/ai/ask');
  }
}
