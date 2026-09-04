// src/lib/i18n/store.ts — S31: client-side translation store (zustand-like via React state)
"use client";

import { create } from "zustand";
import { useEffect, useState } from "react";
import type { Locale, TParams } from "./index";

type State = {
  locale: Locale;
  messages: Record<string, unknown>;
  t: (key: string, params?: TParams) => string;
  setLocale: (l: Locale) => void;
};

export const useTranslationStore = create<State>((set) => ({
  locale: "pt-BR",
  messages: {},
  t: () => "",
  setLocale: () => {},
}));

// A hook that hydrates from the server-rendered locale passed via prop
export function useTranslationHydration(initial: { locale: Locale; messages: Record<string, unknown> }) {
  const [locale, setLocaleState] = useState<Locale>(initial.locale);
  const [messages, setMessages] = useState<Record<string, unknown>>(initial.messages);

  useEffect(() => {
    if (typeof document !== "undefined") {
      const cookieLocale = document.cookie.split("; ").find((c) => c.startsWith("locale="))?.split("=")[1];
      if (cookieLocale && ["pt-BR", "en-US", "es-ES"].includes(cookieLocale)) {
        if (cookieLocale !== locale) void loadMessages(cookieLocale as Locale, setLocaleState, setMessages);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t = useTranslationStore.getState().t; // placeholder
  return { locale, setLocale: setLocaleState, messages };
}

async function loadMessages(
  l: Locale,
  setLocaleState: (l: Locale) => void,
  setMessages: (m: Record<string, unknown>) => void,
) {
  const res = await fetch(`/api/i18n/${l}.json`).catch(() => null);
  if (!res || !res.ok) return;
  const messages = (await res.json()) as Record<string, unknown>;
  setMessages(messages);
  setLocaleState(l);
}
