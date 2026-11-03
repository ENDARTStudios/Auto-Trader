import { describe, expect, it } from "vitest";
import {
  checkoutSessionGrantsAccess,
  isActiveSubscriptionStatus,
  planFromMetadata,
  userIdFromCustomerKey,
} from "@/lib/billing/subscription-state";

describe("subscription state", () => {
  it("considera active e trialing como acesso liberado", () => {
    expect(isActiveSubscriptionStatus("active")).toBe(true);
    expect(isActiveSubscriptionStatus("trialing")).toBe(true);
    expect(isActiveSubscriptionStatus("past_due")).toBe(false);
    expect(isActiveSubscriptionStatus("canceled")).toBe(false);
    expect(isActiveSubscriptionStatus(null)).toBe(false);
  });

  it("checkout pago concede acesso mesmo com status complete", () => {
    // regressão: Session.status é "complete", não "active"
    expect(checkoutSessionGrantsAccess({ status: "complete", payment_status: "paid" })).toBe(true);
  });

  it("checkout com promoção integral (no_payment_required) concede acesso", () => {
    expect(checkoutSessionGrantsAccess({ status: "complete", payment_status: "no_payment_required" })).toBe(true);
  });

  it("checkout não pago não concede acesso", () => {
    expect(checkoutSessionGrantsAccess({ status: "complete", payment_status: "unpaid" })).toBe(false);
    expect(checkoutSessionGrantsAccess({ status: "open", payment_status: "unpaid" })).toBe(false);
  });

  it("sem payment_status aceita apenas sessão completa", () => {
    expect(checkoutSessionGrantsAccess({ status: "complete" })).toBe(true);
    expect(checkoutSessionGrantsAccess({ status: "open" })).toBe(false);
  });

  it("extrai userId da chave de customer", () => {
    expect(userIdFromCustomerKey("stripe_customer:user_123")).toBe("user_123");
    expect(userIdFromCustomerKey("subscription:user_123")).toBeNull();
    expect(userIdFromCustomerKey("stripe_customer:")).toBeNull();
  });

  it("plano só aceita pro/elite, com fallback pro", () => {
    expect(planFromMetadata({ plan: "elite" })).toBe("elite");
    expect(planFromMetadata({ plan: "pro" })).toBe("pro");
    expect(planFromMetadata({ plan: "free" })).toBe("pro");
    expect(planFromMetadata(undefined)).toBe("pro");
  });
});
