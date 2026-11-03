// Regras de acesso derivadas de eventos do Stripe.
//
// Bug que originou este módulo: `checkout.session.completed` traz uma Session
// (status "complete"), não uma Subscription. Usar `status === "active"` nesse
// evento gravava `enabled: false` no plano — e, como ele chega depois de
// `customer.subscription.created`, sobrescrevia o estado correto.

export function isActiveSubscriptionStatus(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}

/** Session concluída concede acesso quando não há pagamento pendente. */
export function checkoutSessionGrantsAccess(session: {
  payment_status?: string | null;
  status?: string | null;
}): boolean {
  if (session.payment_status === "paid" || session.payment_status === "no_payment_required") return true;
  // Sem payment_status no payload, exige sessão completa e não "unpaid".
  return session.payment_status == null && session.status === "complete";
}

export function planFromMetadata(metadata: Record<string, string> | undefined): string {
  const plan = metadata?.plan?.trim();
  return plan === "pro" || plan === "elite" ? plan : "pro";
}
