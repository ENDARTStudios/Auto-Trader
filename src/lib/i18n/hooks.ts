// src/lib/i18n/hooks.ts — S31: client-side translation hook
"use client";

import { useMemo } from "react";
import { useTranslationStore } from "./store";
import { makeT, type TParams, type Locale } from "./index";

export function useTranslation() {
  const messages = useTranslationStore((s) => s.messages);
  const locale = useTranslationStore((s) => s.locale);
  const t = useMemo(() => makeT(messages), [messages]);
  return { t, locale } as { t: (key: string, params?: TParams) => string; locale: Locale };
}
