"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Brain, Flame, TrendingUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { fadeInUp, staggerContainer, staggerItem } from "@/lib/ui/motion";
import type { MarketData, MarketSnapshotRow } from "@/hooks/use-trading-data";

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}

function signalColor(label: string): string {
  switch (label) {
    case "strong_buy": return "text-emerald-500";
    case "buy": return "text-green-500";
    case "neutral": return "text-yellow-500";
    case "sell": return "text-orange-500";
    case "strong_sell": return "text-red-500";
    default: return "text-muted-foreground";
  }
}

function signalBadgeVariant(label: string): "default" | "secondary" | "destructive" | "outline" {
  switch (label) {
    case "strong_buy": return "default";
    case "buy": return "default";
    case "sell":
    case "strong_sell": return "destructive";
    default: return "secondary";
  }
}

function fearGreedColor(value: number): string {
  if (value < 25) return "text-red-500";
  if (value < 45) return "text-orange-500";
  if (value < 55) return "text-yellow-500";
  if (value < 75) return "text-green-500";
  return "text-emerald-500";
}

interface Props {
  data: MarketData | undefined;
  isLoading: boolean;
}

function MarketSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-2 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-14" />
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

export function MarketPanel({ data, isLoading }: Props) {
  if (isLoading && !data) {
    return <MarketSkeleton />;
  }

  const fg = data?.fearGreed;
  const trending = data?.trending ?? [];
  const snapshots = data?.snapshots ?? [];

  return (
    <motion.div
      className="space-y-4"
      variants={fadeInUp}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      {/* Macro sentiment row */}
      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 gap-4"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Brain className="size-4" />
              Fear &amp; Greed Index
            </CardTitle>
          </CardHeader>
          <CardContent>
            {fg ? (
              <div className="space-y-2">
                <div className={`text-4xl font-bold ${fearGreedColor(fg.value)}`}>
                  {fg.value}
                </div>
                <div className="text-sm text-muted-foreground">{fg.classification}</div>
                <Progress value={fg.value} className="h-2" />
                <p className="text-xs text-muted-foreground mt-2">
                  Índice global de sentimento cripto — 0 (medo extremo) a 100 (ganância extrema).
                  Estratégia contrarian: comprar em medo extremo, ter cautela em ganância extrema.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Indisponível</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Flame className="size-4" />
              Trending (CoinGecko)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trending.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados de trending</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {trending.map((t) => (
                  <Badge key={t.id} variant="outline" className="gap-1">
                    <span className="text-muted-foreground">#{t.rank}</span>
                    {t.symbol.toUpperCase()}
                  </Badge>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              Tokens em alta no CoinGecko — proxy de atenção de mercado. Boost
              menor no score para trending top 5.
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Snapshots table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="size-4" />
            Snapshots de Análise Técnica ({snapshots.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {snapshots.length === 0 ? (
            <Alert>
              <AlertDescription>
                Nenhum snapshot ainda. Inicie a engine para que ela colete indicadores
                (RSI, MACD, EMA, Bollinger) a cada candidato analisado.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 px-2">Symbol</th>
                    <th className="px-2">Price</th>
                    <th className="px-2">RSI(14)</th>
                    <th className="px-2">MACD</th>
                    <th className="px-2">EMA Trend</th>
                    <th className="px-2">%B</th>
                    <th className="px-2">FG</th>
                    <th className="px-2">Trend</th>
                    <th className="px-2">Signal</th>
                    <th className="px-2">Score</th>
                    <th className="px-2">When</th>
                  </tr>
                </thead>
                <motion.tbody variants={staggerContainer} initial="hidden" animate="visible">
                  <AnimatePresence mode="popLayout">
                    {snapshots.map((s: MarketSnapshotRow) => (
                      <motion.tr
                        key={s.id}
                        variants={staggerItem}
                        layout
                        className="border-b hover:bg-muted/30"
                      >
                      <td className="py-2 px-2 font-medium">
                        {s.symbol}
                        {s.chain && (
                          <span className="ml-1 text-muted-foreground">[{s.chain}]</span>
                        )}
                      </td>
                      <td className="px-2 tabular-nums">${fmtPrice(s.priceUsd)}</td>
                      <td className="px-2 tabular-nums">
                        {s.rsi14 !== null ? (
                          <span className={
                            s.rsi14 > 70 ? "text-red-500" :
                            s.rsi14 < 30 ? "text-emerald-500" : ""
                          }>
                            {s.rsi14.toFixed(0)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className={`px-2 tabular-nums ${s.macdHist !== null && s.macdHist > 0 ? "text-emerald-500" : s.macdHist !== null ? "text-red-500" : ""}`}>
                        {s.macdHist !== null ? s.macdHist.toFixed(4) : "—"}
                      </td>
                      <td className="px-2">
                        {s.ema20 !== null && s.ema50 !== null ? (
                          s.ema20 > s.ema50 ? (
                            <span className="text-emerald-500">↑ UP</span>
                          ) : (
                            <span className="text-red-500">↓ DOWN</span>
                          )
                        ) : "—"}
                      </td>
                      <td className="px-2 tabular-nums">
                        {s.bollPercent !== null ? s.bollPercent.toFixed(2) : "—"}
                      </td>
                      <td className="px-2 tabular-nums">
                        {s.fearGreedIndex ?? "—"}
                      </td>
                      <td className="px-2">
                        {s.trendingRank !== null ? `#${s.trendingRank}` : "—"}
                      </td>
                      <td className="px-2">
                        <Badge variant={signalBadgeVariant(s.signalLabel)} className="text-[10px]">
                          {s.signalLabel}
                        </Badge>
                      </td>
                      <td className={`px-2 tabular-nums font-medium ${signalColor(s.signalLabel)}`}>
                        {s.signalScore}
                      </td>
                      <td className="px-2 text-muted-foreground text-[10px]">
                        {new Date(s.analyzedAt).toLocaleTimeString("pt-BR")}
                      </td>
                    </motion.tr>
                    ))}
                  </AnimatePresence>
                </motion.tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Alert>
        <Activity className="size-4" />
        <AlertDescription className="text-xs">
          Indicadores são calculados em candles de 1h (CEX) ou sintéticos de 24h (DEX).
          Score composto: RSI 20% + MACD 20% + EMA trend 20% + Bollinger 10% + Fear&amp;Greed 10% + Trending 10% + idade/vol 10%.
          Engine bloqueia entry quando signalLabel = "strong_sell".
        </AlertDescription>
      </Alert>
    </motion.div>
  );
}
