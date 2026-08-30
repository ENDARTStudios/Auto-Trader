// src/lib/billing/plans.ts — Billing plans (Free/Pro/Elite) for Auto Trader
export interface Plan {
  id: string;
  name: string;
  priceUsdMonthly: number;
  features: string[];
  rateLimitPerMinute: number;
  maxOpenPositions: number;
}

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    priceUsdMonthly: 0,
    features: ['Paper trading', '1 open position', 'Community support'],
    rateLimitPerMinute: 30,
    maxOpenPositions: 1,
  },
  {
    id: 'pro',
    name: 'Pro',
    priceUsdMonthly: 49,
    features: ['Live trading paper→live', '20 open positions', 'Priority support', 'TOTP MFA', 'Discord alerts'],
    rateLimitPerMinute: 300,
    maxOpenPositions: 20,
  },
  {
    id: 'elite',
    name: 'Elite',
    priceUsdMonthly: 199,
    features: ['Live trading', 'Unlimited positions', 'Dedicated support', 'Custom strategies', 'White-glove onboarding'],
    rateLimitPerMinute: 3000,
    maxOpenPositions: 1000,
  },
];

export function getPlan(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

export function planLimits(planId: string): { rateLimitPerMinute: number; maxOpenPositions: number } {
  const plan = getPlan(planId);
  return {
    rateLimitPerMinute: plan?.rateLimitPerMinute ?? 30,
    maxOpenPositions: plan?.maxOpenPositions ?? 1,
  };
}
