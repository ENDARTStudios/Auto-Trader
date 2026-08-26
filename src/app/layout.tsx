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
        className={`${inter.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>{children}</Providers>
        <Toaster richColors position="top-right" theme="dark" />
      </body>
    </html>
  );
}
