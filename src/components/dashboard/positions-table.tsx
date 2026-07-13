"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { PositionRow } from "@/hooks/use-trading-data";

function fmtUsd(n: number, decimals = 4): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function PositionsTable({
  positions,
  isLoading,
}: {
  positions: PositionRow[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Posições Abertas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (positions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Posições Abertas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-12">
            Nenhuma posição aberta. Engine vai abrir posições no próximo round.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Posições Abertas ({positions.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">Token</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3 text-right">Entry $</th>
                <th className="py-2 pr-3 text-right">Current $</th>
                <th className="py-2 pr-3 text-right">Qty</th>
                <th className="py-2 pr-3 text-right">Allocated</th>
                <th className="py-2 pr-3 text-right">uP&L</th>
                <th className="py-2 pr-3 text-right">uP&L %</th>
                <th className="py-2 pr-3 text-right">TP</th>
                <th className="py-2 pr-3 text-right">SL</th>
                <th className="py-2 pr-3 text-right">Scam</th>
                <th className="py-2 pr-3">Expires</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const pnl = p.unrealizedPnlUsd ?? 0;
                const pnlPct = p.unrealizedPnlPct ?? 0;
                const isProfit = pnl >= 0;
                return (
                  <tr key={p.id} className="border-b hover:bg-muted/50">
                    <td className="py-2 pr-3 font-medium">{p.symbol}</td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className="text-xs">
                        {p.source}
                        {p.chain && ` · ${p.chain}`}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {fmtUsd(p.entryPriceUsd, 6)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {p.currentPriceUsd ? fmtUsd(p.currentPriceUsd, 6) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {p.entryQty.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {fmtUsd(p.entryAmountUsd, 2)}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums font-medium ${
                        isProfit ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      <span className="inline-flex items-center gap-0.5">
                        {isProfit ? (
                          <TrendingUp className="size-3" />
                        ) : (
                          <TrendingDown className="size-3" />
                        )}
                        {fmtUsd(pnl, 2)}
                      </span>
                    </td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums ${
                        isProfit ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      {fmtPct(pnlPct)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-green-600">
                      {fmtUsd(p.takeProfitPrice, 6)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-red-600">
                      {fmtUsd(p.stopLossPrice, 6)}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Badge
                        variant={
                          p.scamScore >= 80
                            ? "default"
                            : p.scamScore >= 60
                            ? "secondary"
                            : "destructive"
                        }
                        className="tabular-nums"
                      >
                        {p.scamScore}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {new Date(p.maxExitAt).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
