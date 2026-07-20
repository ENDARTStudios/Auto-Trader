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
  title: "Auto Trader — Autonomous Crypto Paper Trading",
  description:
    "Auto Trader: sistema autônomo de trade com scam detection multicamada, circuit breakers e split 50/50 de lucro. Paper mode default, live mode após graduação.",
  keywords: ["auto trader", "crypto", "trading bot", "autonomous", "scam detection", "paper trading"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className="dark">
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>{children}</Providers>
        <Toaster richColors position="top-right" theme="dark" />
      </body>
    </html>
  );
}
