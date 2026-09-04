"use client";

import { useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { LOCALES, type Locale, LOCALE_NAMES } from "@/lib/i18n";
import { setLocaleCookie } from "./actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Globe } from "lucide-react";

export function LanguageSelector({ currentLocale }: { currentLocale: Locale }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function onChange(locale: Locale) {
    startTransition(async () => {
      await setLocaleCookie(locale);
      // Replace any /xx-XX/ prefix in the pathname, then refresh
      const newPath = pathname.replace(/^\/[\w-]+(?=\/)/, "") || pathname;
      router.refresh();
      router.push(newPath);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          className="gap-1 text-xs"
          aria-label="Language selector"
        >
          <Globe className="size-3" />
          <span className="font-mono">{currentLocale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l}
            onSelect={() => onChange(l)}
            disabled={l === currentLocale}
            className="text-xs"
          >
            <span className={l === currentLocale ? "font-semibold" : ""}>{LOCALE_NAMES[l]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
