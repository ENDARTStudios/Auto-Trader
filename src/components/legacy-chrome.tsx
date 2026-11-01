"use client";

import { usePathname } from "next/navigation";
import { LanguageSelector } from "@/components/language-selector";
import type { Locale } from "@/lib/i18n";
import { isMeridianPath } from "@/lib/meridian/nav";

interface Strings {
  copyright: string;
  contact: string;
  telegram: string;
  terms: string;
  privacy: string;
}

/**
 * Chrome do app legado (barra de idioma + footer). É escondido nas rotas do
 * redesign, que têm shell próprio — evita dois headers/footers na mesma tela.
 */
export function LegacyChrome({
  locale,
  strings,
  children,
}: {
  locale: Locale;
  strings: Strings;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isMeridian = isMeridianPath(pathname);

  if (isMeridian) return <div className="flex-1">{children}</div>;

  return (
    <div className="flex-1">
      <div className="flex justify-end border-b border-border/40 bg-background/30 px-4 py-1.5">
        <LanguageSelector currentLocale={locale} />
      </div>
      {children}
    </div>
  );
}

export function LegacyFooter({ strings }: { strings: Strings }) {
  const pathname = usePathname();
  if (isMeridianPath(pathname)) return null;

  return (
    <footer className="border-t border-border/40 bg-background/50 py-4 text-center text-xs text-muted-foreground">
      <div className="container mx-auto px-4">
        <p>{strings.copyright}</p>
        <p className="mt-1">
          {strings.contact}:{" "}
          <a href="mailto:endart.studios@gmail.com" className="underline hover:text-foreground">
            endart.studios@gmail.com
          </a>{" "}
          ·{" "}
          <a href="https://t.me/AutoTrader2027" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
            {strings.telegram}
          </a>{" "}
          ·{" "}
          <a href="/terms" className="underline hover:text-foreground">
            {strings.terms}
          </a>{" "}
          ·{" "}
          <a href="/privacy" className="underline hover:text-foreground">
            {strings.privacy}
          </a>
        </p>
      </div>
    </footer>
  );
}
