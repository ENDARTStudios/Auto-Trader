// src/lib/i18n/index.ts — S31: isomorphic core (no next/headers → safe for client/server)
// Server-only helpers (detectLocale/getServerTranslation) live in server.ts
export type Locale = "pt-BR" | "en-US" | "es-ES";
export const LOCALES: Locale[] = ["pt-BR", "en-US", "es-ES"];
export const DEFAULT_LOCALE: Locale = "pt-BR";

const messages = {} as Record<Locale, Record<string, unknown>>;
async function loadMessages(): Promise<typeof messages> {
  if (Object.keys(messages).length > 0) return messages;
  const [{ default: ptBR }, { default: enUS }, { default: esES }] = await Promise.all([
    import("../../../messages/pt-BR.json"),
    import("../../../messages/en-US.json"),
    import("../../../messages/es-ES.json"),
  ]);
  messages["pt-BR"] = ptBR as Record<string, unknown>;
  messages["en-US"] = enUS as Record<string, unknown>;
  messages["es-ES"] = esES as Record<string, unknown>;
  return messages;
}

export function isValidLocale(value: string | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}

export async function getMessages(locale: Locale): Promise<Record<string, unknown>> {
  const all = await loadMessages();
  return all[locale] ?? all[DEFAULT_LOCALE];
}

function resolve(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

export type TParams = Record<string, string | number>;

export function makeT(messages: Record<string, unknown>, fallback?: string) {
  return function t(key: string, params?: TParams): string {
    const found = resolve(messages, key);
    let v: string;
    if (typeof found === "string") {
      v = found;
    } else {
      const alt = resolve(messages, key.replace(/^[a-z]+_/, ""));
      v = typeof alt === "string" ? alt : (fallback ?? key);
    }
    if (params) {
      for (const [k, val] of Object.entries(params)) v = v.replace(`{${k}}`, String(val));
    }
    return v;
  };
}

export const LOCALE_NAMES: Record<Locale, string> = {
  "pt-BR": "Português (BR)",
  "en-US": "English (US)",
  "es-ES": "Español (ES)",
};
