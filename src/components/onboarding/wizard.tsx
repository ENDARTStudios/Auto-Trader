"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/hooks";
import type { UserPreferences, RiskTolerance } from "@/lib/preferences";

const GOALS = ["swing", "long-term", "income", "growth"] as const;
const CHAINS = ["base", "arbitrum", "optimism", "ethereum"] as const;
const SOURCES = ["cex", "dex"] as const;

interface OnboardingWizardProps {
  open: boolean;
  onClose: () => void;
}

type Step = 0 | 1 | 2 | 3;

export function OnboardingWizard({ open, onClose }: OnboardingWizardProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(0);
  const [prefs, setPrefs] = useState<UserPreferences>({
    riskTolerance: undefined,
    goals: [],
    preferredChains: [],
    preferredSources: [],
  });

  const save = useMutation({
    mutationFn: async (payload: UserPreferences & { onboarded?: boolean }) => {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(t("onboarding.saved"));
      qc.invalidateQueries({ queryKey: ["preferences"] });
      qc.invalidateQueries({ queryKey: ["auth"] });
      onClose();
      router.refresh();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const toggle = (key: "goals" | "preferredChains" | "preferredSources", value: string) => {
    setPrefs((p) => {
      const arr = p[key] ?? [];
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      return { ...p, [key]: next };
    });
  };

  const canNext =
    (step === 0 && !!prefs.riskTolerance) ||
    step === 1 ||
    step === 2;

  const handleFinish = () => {
    save.mutate({ ...prefs, onboarded: true });
  };

  const stepLabels = [
    t("onboarding.step1"),
    t("onboarding.step2"),
    t("onboarding.step3"),
    t("onboarding.step4"),
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("onboarding.title")}</DialogTitle>
          <DialogDescription>{t("onboarding.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 mb-4" data-testid="onboarding-progress">
          {stepLabels.map((label, i) => (
            <div
              key={label}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= step ? "bg-primary" : "bg-muted"
              }`}
              title={label}
            />
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-3" data-testid="onboarding-step-0">
            <p className="text-sm font-medium">{t("onboarding.riskQuestion")}</p>
            <RadioGroup
              value={prefs.riskTolerance ?? ""}
              onValueChange={(v) =>
                setPrefs((p) => ({ ...p, riskTolerance: v as RiskTolerance }))
              }
            >
              {(["conservative", "balanced", "aggressive"] as const).map((opt) => (
                <div key={opt} className="flex items-center gap-2">
                  <RadioGroupItem value={opt} id={`risk-${opt}`} />
                  <Label htmlFor={`risk-${opt}`} className="cursor-pointer">
                    {t(`onboarding.risk.${opt}`)}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3" data-testid="onboarding-step-1">
            <p className="text-sm font-medium">{t("onboarding.goalsQuestion")}</p>
            <div className="grid grid-cols-2 gap-2">
              {GOALS.map((g) => (
                <div key={g} className="flex items-center gap-2">
                  <Checkbox
                    id={`goal-${g}`}
                    checked={(prefs.goals ?? []).includes(g)}
                    onCheckedChange={() => toggle("goals", g)}
                  />
                  <Label htmlFor={`goal-${g}`} className="cursor-pointer text-sm">
                    {t(`onboarding.goals.${g}`)}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4" data-testid="onboarding-step-2">
            <div>
              <p className="text-sm font-medium mb-2">{t("onboarding.chainsQuestion")}</p>
              <div className="grid grid-cols-2 gap-2">
                {CHAINS.map((c) => (
                  <div key={c} className="flex items-center gap-2">
                    <Checkbox
                      id={`chain-${c}`}
                      checked={(prefs.preferredChains ?? []).includes(c)}
                      onCheckedChange={() => toggle("preferredChains", c)}
                    />
                    <Label htmlFor={`chain-${c}`} className="cursor-pointer text-sm capitalize">
                      {c}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">{t("onboarding.sourcesQuestion")}</p>
              <div className="flex gap-4">
                {SOURCES.map((s) => (
                  <div key={s} className="flex items-center gap-2">
                    <Checkbox
                      id={`source-${s}`}
                      checked={(prefs.preferredSources ?? []).includes(s)}
                      onCheckedChange={() => toggle("preferredSources", s)}
                    />
                    <Label htmlFor={`source-${s}`} className="cursor-pointer text-sm uppercase">
                      {s}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-2 text-sm" data-testid="onboarding-step-3">
            <p className="font-medium">{t("onboarding.reviewTitle")}</p>
            <p>
              <span className="text-muted-foreground">{t("onboarding.riskQuestion")}: </span>
              {prefs.riskTolerance ? t(`onboarding.risk.${prefs.riskTolerance}`) : "—"}
            </p>
            <p>
              <span className="text-muted-foreground">{t("onboarding.goalsQuestion")}: </span>
              {(prefs.goals ?? []).map((g) => t(`onboarding.goals.${g}`)).join(", ") || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">{t("onboarding.chainsQuestion")}: </span>
              {(prefs.preferredChains ?? []).join(", ") || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">{t("onboarding.sourcesQuestion")}: </span>
              {(prefs.preferredSources ?? []).join(", ") || "—"}
            </p>
          </div>
        )}

        <div className="flex justify-between mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStep((s) => Math.max(0, s - 1) as Step)}
            disabled={step === 0}
          >
            {t("common.back")}
          </Button>
          {step < 3 ? (
            <Button size="sm" onClick={() => setStep((s) => (s + 1) as Step)} disabled={!canNext}>
              {t("common.next")}
            </Button>
          ) : (
            <Button size="sm" onClick={handleFinish} disabled={save.isPending}>
              {save.isPending ? t("common.loading") : t("onboarding.finish")}
            </Button>
          )}
        </div>

        <button
          type="button"
          className="text-xs text-muted-foreground underline mt-1 self-start"
          onClick={onClose}
          data-testid="onboarding-skip"
        >
          {t("onboarding.skip")}
        </button>
      </DialogContent>
    </Dialog>
  );
}
