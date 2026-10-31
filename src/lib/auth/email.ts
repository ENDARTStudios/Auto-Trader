import { z } from 'zod';

// Email de conta do produto — aceita domínios single-label.
// O produto usa contas locais de primeira classe (admin@local,
// viewer@local, trader@local — scripts/seed-auth.ts + defaults da página
// de login). z.email() exige domínio com ponto e rejeitaria TODAS elas
// com 400 em todo login (CI e2e #34782794854). Não enviamos e-mail de
// verdade (notificações são Telegram/Discord/webhook), então a validação
// RFC estrita não compra nada aqui — só exige local@domínio.
export const zAccountEmail = z.string().refine(
  (v) => /^[^@\s]+@[^@\s]+$/.test(v),
  { message: 'Email inválido' },
);
