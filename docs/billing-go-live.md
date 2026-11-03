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

## Estado em produção (Railway, test mode) — 2026-11-03

Host canônico: `https://auto-trader-production-0cbc.up.railway.app` (Vercel sem aliases de produção).

| Item | Valor |
|---|---|
| Chaves | `pk_test_…` / `sk_test_…` no serviço `auto-trader` |
| Preços | Pro `price_1UXLh5…`, Elite `price_1UXLh6…` (USD 49/199 mensal) |
| Webhook | `we_1UXiTn…` → `https://auto-trader-production-0cbc.up.railway.app/api/webhooks/stripe` |
| Eventos | `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` |
| Segredo | `STRIPE_WEBHOOK_SECRET` = segredo **desse** endpoint (não o do CLI local) |

Verificado ponta a ponta com cartão `4242 4242 4242 4242`: sessão criada → pagamento →
`/billing?checkout=success`, subscription `active` no Stripe e plano `pro` no banco.

### Regressão corrigida

`checkout.session.completed` traz uma **Session** (`status: complete`), não uma Subscription.
O handler antigo gravava `enabled: false` nesse evento e, como ele chega depois de
`customer.subscription.created`, sobrescrevia o estado ativo. Agora a decisão usa
`payment_status` (`paid`/`no_payment_required`) e `active`/`trialing` para subscriptions
(`src/lib/billing/subscription-state.ts`, com testes).

### Para live

1. Criar preços live (mesmos valores) e trocar `STRIPE_PRICE_*`.
2. Trocar `pk`/`sk` para live.
3. Criar endpoint de webhook live apontando para o mesmo path; copiar o novo `whsec_`.
4. Rodar `npm run billing:check` com o ambiente de produção e repetir o teste de compra.

### Customer persistido para o Billing Portal

O portal procurava o customer **por e-mail**. Contas locais (`admin@local`) não têm e-mail
entregável e o Stripe cria o customer com o e-mail digitado no Checkout — a busca falhava com
`409 no_customer`. Agora `checkout.session.completed` grava `stripe_customer:<userId>` em
FeatureFlag e o portal usa esse id primeiro, caindo no e-mail só como fallback.

### Falha de cobrança

`invoice.payment_failed` revoga o acesso na hora (`enabled: false`, plano preservado) e
`invoice.payment_succeeded` devolve; `customer.subscription.updated` continua sendo a fonte
final do status. A tela de Billing mostra **“pagamento pendente”** quando `enabled=false`
com plano pago. O userId é resolvido pelo customer salvo no checkout
(`stripe_customer:<userId>`), sem chamada extra ao Stripe.

### Configuração do Customer Portal

Config `bpc_1UXjCbQ76C0SHZqcSueKL33Z` (test mode): atualiza nome/e-mail/endereço/telefone,
troca de cartão, histórico de faturas e cancelamento ao fim do período (sem upgrade
self-service). Headline e links de privacidade/termos apontam para o Railway.

A rota `/api/billing/portal` passa `configuration` quando `STRIPE_PORTAL_CONFIGURATION`
está definida — assim o portal não depende do "default" do dashboard.

### Produtos e preços (via Stripe CLI)

- `prod_VYSce3423wn0dW` **Auto Trader Pro** — default price `price_1UXLh5…` (US$ 49/mês),
  metadata `plan=pro`.
- `prod_VYScckU7wQK3bn` **Auto Trader Elite** — default price `price_1UXLh6…` (US$ 199/mês),
  metadata `plan=elite`.
- Produtos/preços de teste criados pelo CLI (`myproduct`, US$ 15) foram arquivados.
- Webhook `we_1UXiTn…` agora assina também `invoice.payment_succeeded` (6 eventos).

### Bloqueio atual para live (verificado na API)

A conta do app é `acct_1UXCaGQ76C0SHZqc` (standard, BR) com `charges_enabled=false`,
`payouts_enabled=false` e `details_submitted=false` — o onboarding nunca foi concluído.
Enquanto isso, preços/keys live não podem ser criados: o Stripe só libera `sk_live_` após a
ativação. A chave live do CLI (`rk_live_…`) também está expirada desde 2026-11-01.

Para liberar: concluir o onboarding no dashboard (dados de negócio + conta bancária) e então
rodar `stripe login --live` para renovar a chave do CLI, criar preços live e trocar as envs.

## Live ativado (2026-11-03)

Conta live `acct_1UXCZALsXM10JIlV` com `charges_enabled=true`.

| Item | Valor |
|---|---|
| Chave | `rk_live_…` (restrita, no Railway) — modo detectado por prefixo `rk_live_`/`sk_live_` |
| Publishable | `pk_live_…` |
| Preço Pro | `price_1UXnXZLsXM10JIlVF4lX13Zy` (US$ 49/mês) |
| Preço Elite | `price_1UXnXaLsXM10JIlVNZQo8RNP` (US$ 199/mês) |
| Webhook | `we_1UXnfpLsXM10JIlVkpc9pJL9` — 6 eventos, URL do Railway |
| Portal | `bpc_1UXnfqLsXM10JIlVMBe4cYLY` |

Ajustes de código: `stripeMode()` reconhece chaves restritas (antes `rk_live_` era
reportado como "test"); o portal faz fallback para e-mail quando o customer salvo é de
outro modo (id de test após a migração), devolvendo `409 no_customer` em vez de 500.

Estado de assinatura de test mode foi limpo no banco antes do go-live: o admin não herda
plano pago na conta live.
