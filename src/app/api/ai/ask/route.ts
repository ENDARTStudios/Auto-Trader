import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { ForbiddenError } from '@/lib/auth/errors';
import { handleApiError } from '@/lib/api/error-handler';
import { checkRateLimit } from '@/lib/rate-limit';
import { askRag } from '@/lib/rag/pipeline';
import { buildEvidenceLedger } from '@/lib/rag/evidence';
import { getAIStatus, AIUnavailableError } from '@/lib/ai/provider';
import { recordSuccess, recordError } from '@/lib/trading/source-health';

const schema = z.object({ question: z.string().min(3).max(500) });

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

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

    // Sem provider real configurado -> 503 explícito (nada de resposta "mock LLM").
    const status = getAIStatus();
    if (!status.configured) {
      return NextResponse.json(
        { error: 'ai_unavailable', message: 'Nenhum provedor de IA configurado (AI_PROVIDER/AI_API_KEY/OLLAMA_URL).', provider: null, model: null },
        { status: 503 }
      );
    }

    // UMA chamada real ao provider (dentro de askRag). O evidence ledger é gerado
    // a partir da RESPOSTA REAL — antes ele era montado sobre o texto mock.
    let result: Awaited<ReturnType<typeof askRag>>;
    try {
      result = await askRag(parsed.data.question);
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

    const evidence = buildEvidenceLedger(result.answer, result.citations);

    return NextResponse.json({
      answer: result.answer,
      citations: result.citations,
      context: result.context,
      evidence,
      provider: result.provider,
      model: result.model,
    });
  } catch (err) {
    return handleApiError(err, 'POST /api/ai/ask');
  }
}
