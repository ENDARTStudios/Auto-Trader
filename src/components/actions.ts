"use server";

import { cookies } from "next/headers";
import { isValidLocale, type Locale } from "@/lib/i18n";

export async function setLocaleCookie(locale: Locale) {
  if (!isValidLocale(locale)) return;
  const cookieStore = await cookies();
  cookieStore.set("locale", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
  });
}
