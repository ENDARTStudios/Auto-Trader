import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "./providers";

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

export const metadata: Metadata = {
  title: {
    default: "Auto Trader — Autonomous Crypto Paper Trading",
    template: "%s | Auto Trader",
  },
  description:
    "Auto Trader: sistema autônomo de trade com scam detection multicamada, circuit breakers e split 50/50 de lucro. Paper mode default, live mode após graduação.",
  keywords: ["auto trader", "crypto", "trading bot", "autonomous", "scam detection", "paper trading"],
  authors: [{ name: "Auto Trader" }],
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  alternates: { canonical: "/" },
  openGraph: {
    title: "Auto Trader — Autonomous Crypto Paper Trading",
    description:
      "Scam detection multicamada, circuit breakers, split 50/50. Paper mode default.",
    url: "/",
    siteName: "Auto Trader",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Auto Trader Dashboard" }],
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Auto Trader — Autonomous Crypto Paper Trading",
    description: "Scam detection multicamada, circuit breakers, split 50/50.",
    images: ["/og-image.png"],
  },
  robots: { index: true, follow: true },
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Auto Trader",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  description:
    "Sistema autônomo de trading de criptomoedas com scam detection multicamada.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  creator: { "@type": "Organization", name: "Auto Trader", url: "https://your-domain.com" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className="dark">
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
          <Providers>{children}</Providers>
        </div>
        <footer className="border-t border-border/40 bg-background/50 py-4 text-center text-xs text-muted-foreground">
          <div className="container mx-auto px-4">
            <p>Copyright © 2026 END ART Studios — CNPJ 45.370.930/0001-75 — Osasco/SP - Brasil</p>
            <p className="mt-1">
              Contato:{" "}
              <a href="mailto:endart.studios@gmail.com" className="underline hover:text-foreground">
                endart.studios@gmail.com
              </a>{" "}
              ·{" "}
              <a href="https://t.me/AutoTrader2027" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                Telegram
              </a>{" "}
              ·{" "}
              <a href="/terms" className="underline hover:text-foreground">
                Termos de Uso
              </a>{" "}
              ·{" "}
              <a href="/privacy" className="underline hover:text-foreground">
                Privacidade
              </a>
            </p>
          </div>
        </footer>
        <Toaster richColors position="top-right" theme="dark" />
      </body>
    </html>
  );
}
