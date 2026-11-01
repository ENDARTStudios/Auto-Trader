// src/lib/i18n/hydration.tsx — hidrata a store i18n client-side com o
// locale/messages do servidor (ver feat/ui-ux-polish: login/onboarding
// mostravam chaves cruas porque a store nascia vazia).
"use client";

import { useTranslationHydration } from "./store";
import type { Locale } from "./index";

export function I18nHydration({
  initial,
}: {
  initial: { locale: Locale; messages: Record<string, unknown> };
}) {
  useTranslationHydration(initial);
  return null;
}
