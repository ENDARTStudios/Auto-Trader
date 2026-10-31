// /api/i18n/[locale] — return the messages JSON for a given locale
import { NextRequest, NextResponse } from "next/server";
import { isValidLocale, getMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isValidLocale(locale)) {
    return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
  }
  const messages = await getMessages(locale);
  return NextResponse.json(messages, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    },
  });
}
