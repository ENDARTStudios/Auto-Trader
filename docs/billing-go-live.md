# Billing — checklist de go-live (Stripe)

Estado atual: **test mode** validado (`npm run billing:check`). O que falta para produção é
ação humana no dashboard (ativação da conta e criação das credenciais live).

## 1. Ativar a conta

- [ ] Preencher dados da empresa e conta bancária no dashboard (modo live).
- [ ] Confirmar que cobranças estão habilitadas (não apenas test mode).

## 2. Criar produtos e preços live

- [ ] Produto **Pro** — recorrência mensal, USD 49,00.
- [ ] Produto **Elite** — recorrência mensal, USD 199,00.
- [ ] Copiar os `price_id` live (`price_…`) — eles **não** são os mesmos do test mode.

## 3. Webhook de produção

- [ ] Endpoint: `https://<domínio>/api/webhooks/stripe`
- [ ] Eventos: `checkout.session.completed`, `customer.subscription.updated`,
      `customer.subscription.deleted`, `invoice.payment_failed`.
- [ ] Copiar o **signing secret** (`whsec_…`) do endpoint — ele é diferente do segredo local.

## 4. Variáveis de ambiente (produção)

```env
STRIPE_PUBLISHABLE_KEY=pk_live_…
STRIPE_SECRET_KEY=sk_live_…
STRIPE_PRICE_PRO=price_…   # live
STRIPE_PRICE_ELITE=price_… # live
STRIPE_WEBHOOK_SECRET=whsec_… # do endpoint de produção
NEXT_PUBLIC_APP_URL=https://<domínio>
```

## 5. Verificação

```bash
npm run billing:check            # modo, preços, segredo e endpoints
npm run billing:check -- --checkout  # cria e expira uma sessão (sem cobrança)
```

Depois, no ambiente de produção:

- [ ] `GET /api/billing/status` → `configured: true`, `mode: live`, `missing: []`.
- [ ] Assinar o plano Pro com cartão real e conferir:
  - [ ] redirecionamento para `/billing?ok=1`;
  - [ ] linha da assinatura em `/billing` (status `active`);
  - [ ] evento recebido no dashboard do Stripe (200);
  - [ ] `AppLog` com `source=stripe-webhook`.
- [ ] Cancelar pelo portal (`/api/billing/portal`) e confirmar downgrade.
- [ ] Reembolsar a cobrança de teste no dashboard.

## 6. Rollback

- Voltar os envs para as chaves de test e reiniciar.
- O webhook de produção pode ficar ativo sem risco: eventos live só chegam se houver cobrança live.

## Notas de segurança

- `.env` é gitignored; nunca commitar chaves.
- O webhook valida HMAC com tolerância de 5 min e é idempotente por `event.id`
  (`tests/billing-webhook.test.ts` cobre assinatura válida, expirada e inválida).
- O endpoint é público no proxy (sem sessão) por necessidade do Stripe, mas exige assinatura válida.
