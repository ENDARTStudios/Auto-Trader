import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { zAccountEmail } from '@/lib/auth/email';
import { generateToken, hashToken } from '@/lib/auth/session';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { handleApiError } from '@/lib/api/error-handler';
import { sendEmail } from '@/lib/notifications/email';
import { logger } from '@/lib/trading/logger';

const schema = z.object({ email: zAccountEmail });

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, '/api/auth/forgot');
    if (!rl.allowed) return rateLimitResponse(rl.retryAfter);
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'validation_error', details: parsed.error.flatten() }, { status: 400 });

    // Limite por CONTA (acct:<email>): mitiga flood distribuído de reset por conta.
    const acctRl = checkRateLimit(`acct:${parsed.data.email.toLowerCase()}`, '/api/auth/forgot');
    if (!acctRl.allowed) return rateLimitResponse(acctRl.retryAfter);

    const user = await db.user.findUnique({ where: { email: parsed.data.email } });
    // Always return ok to avoid email enumeration
    if (!user) return NextResponse.json({ ok: true });

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await db.passwordReset.create({ data: { userId: user.id, tokenHash, expiresAt } });

    // E-mail transacional REAL (Resend ou webhook próprio). O resetUrl carrega o
    // token: NUNCA pode aparecer em log de produção.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const resetUrl = `${appUrl}/reset?token=${token}`;
    const isProduction = process.env.NODE_ENV === 'production';

    const emailResult = await sendEmail({
      to: user.email,
      subject: 'Redefinição de senha — Auto Trader',
      text:
        'Recebemos um pedido para redefinir a senha da sua conta.\n\n' +
        `Abra este link (expira em 15 minutos): ${resetUrl}\n\n` +
        'Se não foi você, ignore este e-mail — sua senha continua a mesma.',
      html:
        '<p>Recebemos um pedido para redefinir a senha da sua conta.</p>' +
        `<p><a href="${resetUrl}">Redefinir senha</a> (expira em 15 minutos)</p>` +
        '<p>Se não foi você, ignore este e-mail — sua senha continua a mesma.</p>',
    });

    // Metadados de envio (sem token, sem resetUrl). Vai para AppLog via logger.
    logger.info('api', 'password reset solicitado', {
      userId: user.id,
      emailSent: emailResult.ok,
      provider: emailResult.provider,
    });
    if (!emailResult.ok) {
      logger.warn('api', 'falha ao enviar e-mail de reset (sem token no log)', {
        userId: user.id,
        code: emailResult.code ?? 'EMAIL_UNKNOWN',
        provider: emailResult.provider,
      });
    }

    // Apenas fora de produção o link é impresso (e devolvido) — necessário para E2E/dev.
    if (!isProduction) {
      console.log('[dev] Password reset link:', resetUrl);
      return NextResponse.json({ ok: true, token, resetUrl });
    }
    // Produção: resposta SEMPRE genérica (não confirma existência de conta nem expõe token).
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, 'POST /api/auth/forgot');
  }
}
