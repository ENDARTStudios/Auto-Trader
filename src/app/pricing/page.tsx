"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { fadeInUp, staggerContainer, cardMotion } from "@/lib/ui/motion";
import { useAuth } from "@/hooks/use-auth";
import { PLANS } from "@/lib/billing/plans";
import { useTranslation } from "@/lib/i18n/hooks";

export default function PricingPage() {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();
  const [submitting, setSubmitting] = useState<string | null>(null);

  async function handleSubscribe(planId: string) {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    setSubmitting(planId);
    try {
      const res = await fetch("/api/billing/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: planId === "free" ? "cancel" : "upgrade", plan: planId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      alert(`Subscription updated to ${planId}`);
    } catch (e) {
      alert(`Error: ${(e as Error).message}`);
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="min-h-screen bg-background p-6 md:p-10">
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="container mx-auto max-w-6xl space-y-8"
      >
        <motion.div variants={fadeInUp} className="text-center space-y-2">
          <h1 className="text-3xl md:text-5xl font-bold">{t("pricing.title")}</h1>
          <p className="text-muted-foreground text-lg">
            {t("common.tagline")}
          </p>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          {PLANS.map((plan) => (
            <motion.div key={plan.id} {...cardMotion}>
              <Card className={plan.id === "pro" ? "border-primary shadow-lg" : ""}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl">{plan.name}</CardTitle>
                    {plan.id === "pro" && <Badge>{t("pricing.popular")}</Badge>}
                  </div>
                  <div className="mt-2">
                    <span className="text-3xl font-bold">${plan.priceUsdMonthly}</span>
                    <span className="text-muted-foreground text-sm">/mo</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2 text-sm">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-primary">✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="text-xs text-muted-foreground">
                    {t("pricing.rateLimit")}: {plan.rateLimitPerMinute}/min · {t("pricing.maxPositions")} {plan.maxOpenPositions}
                  </div>
                  <Button
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={submitting === plan.id || isLoading}
                    className="w-full"
                    variant={plan.id === "pro" ? "default" : "outline"}
                  >
                    {submitting === plan.id ? "..." : plan.id === "free" ? t("pricing.downgrade") : `${t("pricing.subscribeTo")} ${plan.name}`}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>

        <motion.p variants={fadeInUp} className="text-center text-xs text-muted-foreground">
          All plans include paper trading by default. Live trading requires Pro or Elite + 50 paper-trade graduation cycles.
        </motion.p>
      </motion.div>
    </div>
  );
}
