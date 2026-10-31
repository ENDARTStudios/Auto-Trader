// src/lib/i18n/server.ts — S31: server-only (cookies/headers) — keep index.ts client-safe
import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALES, getMessages, isValidLocale, makeT, type Locale, type TParams } from "./index";

export async function detectLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("locale")?.value;
  if (isValidLocale(cookieLocale)) return cookieLocale as Locale;
  const headerStore = await headers();
  const accept = headerStore.get("accept-language") ?? "";
  const first = accept.split(",")[0]?.split(";")[0]?.trim();
  if (first) {
    const matched = LOCALES.find((l) => l.toLowerCase() === first.toLowerCase() || l.split("-")[0].toLowerCase() === first.split("-")[0].toLowerCase());
    if (matched) return matched;
  }
  return DEFAULT_LOCALE;
}

export async function getServerTranslation(): Promise<{
  locale: Locale;
  t: (key: string, params?: TParams) => string;
  messages: Record<string, unknown>;
}> {
  const locale = await detectLocale();
  const messages = await getMessages(locale);
  return { locale, t: makeT(messages), messages };
}

export async function getTranslations(): Promise<{ locale: Locale; t: ReturnType<typeof makeT>; messages: Record<string, unknown> }> {
  const locale = await detectLocale();
  const msgs = await getMessages(locale);
  return { locale, t: makeT(msgs), messages: msgs };
}
