// src/lib/i18n/store.ts — S31: client-side translation store (zustand)
// 2026-10-31 (feat/ui-ux-polish): useTranslationHydration agora escreve na store
// Zustand (antes mantinha useState local morto — login/onboarding mostravam
// chaves cruas porque a store nascia vazia e ninguém a preenchia).
"use client";

import { create } from "zustand";
import { useEffect, useRef } from "react";
import { makeT, type Locale, type TParams } from "./index";

type State = {
  locale: Locale;
  messages: Record<string, unknown>;
  t: (key: string, params?: TParams) => string;
  setLocale: (l: Locale) => void;
};

const LOCALES = ["pt-BR", "en-US", "es-ES"] as const;

export const useTranslationStore = create<State>((set) => ({
  locale: "pt-BR",
  messages: {},
  t: (key) => key,
  setLocale: () => {},
}));

function applyMessages(l: Locale, messages: Record<string, unknown>) {
  useTranslationStore.setState({ locale: l, messages, t: makeT(messages) });
}

export function setLocale(l: Locale) {
  document.cookie = `locale=${l}; path=/; max-age=31536000; samesite=lax`;
  void fetch(`/api/i18n/${l}.json`)
    .then((res) => (res.ok ? res.json() : null))
    .then((messages) => {
      if (messages) applyMessages(l, messages as Record<string, unknown>);
    })
    .catch(() => {});
}

// Hidrata a store a partir do locale/messages renderizados no servidor.
// useEffect (não render): evita "Cannot update a component while rendering"
// — o SSR mostra as chaves cruas por um frame e troca após o mount.
export function useTranslationHydration(initial: { locale: Locale; messages: Record<string, unknown> }): void {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const cookieLocale = document.cookie.split("; ").find((c) => c.startsWith("locale="))?.split("=")[1];
    const l = cookieLocale && (LOCALES as readonly string[]).includes(cookieLocale) ? (cookieLocale as Locale) : initial.locale;
    if (l === initial.locale) {
      applyMessages(initial.locale, initial.messages);
    } else {
      setLocale(l);
    }
  }, [initial.locale, initial.messages]);
}
