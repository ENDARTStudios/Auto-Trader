import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "./providers";
import { getServerTranslation } from "@/lib/i18n/server";
import { LanguageSelector } from "@/components/language-selector";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const LOCALE_OG: Record<string, string> = {
  "pt-BR": "pt_BR",
  "en-US": "en_US",
  "es-ES": "es_ES",
};

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getServerTranslation();
  return {
    title: {
      default: "Auto Trader — Autonomous Crypto Paper Trading",
      template: `%s | Auto Trader`,
    },
    description: t("common.tagline"),
    keywords: ["auto trader", "crypto", "trading bot", "autonomous", "scam detection", "paper trading"],
    authors: [{ name: "Auto Trader" }],
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
    alternates: { canonical: "/" },
    openGraph: {
      title: "Auto Trader — Autonomous Crypto Paper Trading",
      description: t("common.tagline"),
      url: "/",
      siteName: "Auto Trader",
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Auto Trader Dashboard" }],
      locale: LOCALE_OG[locale] ?? "pt_BR",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Auto Trader — Autonomous Crypto Paper Trading",
      description: t("common.tagline"),
      images: ["/og-image.png"],
    },
    robots: { index: true, follow: true },
    icons: {
      icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
    },
  };
}

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Auto Trader",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  description: "Sistema autônomo de trading de criptomoedas com scam detection multicamada.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  creator: { "@type": "Organization", name: "Auto Trader", url: "https://your-domain.com" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, t } = await getServerTranslation();
  return (
    <html lang={locale} suppressHydrationWarning className="dark">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased bg-background text-foreground flex min-h-screen flex-col`}
      >
        <div className="flex-1">
          <Providers>
            <div className="flex justify-end border-b border-border/40 bg-background/30 px-4 py-1.5">
              <LanguageSelector currentLocale={locale} />
            </div>
            {children}
          </Providers>
        </div>
        <footer className="border-t border-border/40 bg-background/50 py-4 text-center text-xs text-muted-foreground">
          <div className="container mx-auto px-4">
            <p>{t("footer.copyright")}</p>
            <p className="mt-1">
              {t("footer.contact")}:{" "}
              <a href="mailto:endart.studios@gmail.com" className="underline hover:text-foreground">
                endart.studios@gmail.com
              </a>{" "}
              ·{" "}
              <a href="https://t.me/AutoTrader2027" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                {t("footer.telegram")}
              </a>{" "}
              ·{" "}
              <a href="/terms" className="underline hover:text-foreground">
                {t("footer.terms")}
              </a>{" "}
              ·{" "}
              <a href="/privacy" className="underline hover:text-foreground">
                {t("footer.privacy")}
              </a>
            </p>
          </div>
        </footer>
        <Toaster richColors position="top-right" theme="dark" />
      </body>
    </html>
  );
}
