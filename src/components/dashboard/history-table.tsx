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

const REASON_LABEL: Record<string, string> = {
  take_profit: "TP",
  stop_loss: "SL",
  timeout: "Timeout",
  kill_switch: "Kill",
  manual: "Manual",
};

export function HistoryTable({
  history,
  isLoading,
}: {
  history: PositionRow[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Operações</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Operações</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-12">
            Nenhuma operação fechada ainda.
          </div>
        </CardContent>
      </Card>
    );
  }

  // Summary
  const totalPnl = history.reduce((s, p) => s + (p.pnlUsd ?? 0), 0);
  const wins = history.filter((p) => (p.pnlUsd ?? 0) >= 0).length;
  const losses = history.length - wins;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between flex-wrap gap-2">
          <span>Histórico de Operações ({history.length})</span>
          <div className="flex gap-2 text-sm font-normal">
            <Badge variant="outline" className="gap-1">
              Total: <span className={totalPnl >= 0 ? "text-green-500" : "text-red-500"}>
                {fmtUsd(totalPnl, 2)}
              </span>
            </Badge>
            <Badge variant="outline" className="gap-1">
              <TrendingUp className="size-3 text-green-500" />
              {wins}W
            </Badge>
            <Badge variant="outline" className="gap-1">
              <TrendingDown className="size-3 text-red-500" />
              {losses}L
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">Token</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3 text-right">Entry $</th>
                <th className="py-2 pr-3 text-right">Exit $</th>
                <th className="py-2 pr-3 text-right">Amount</th>
                <th className="py-2 pr-3 text-right">P&L</th>
                <th className="py-2 pr-3 text-right">P&L %</th>
                <th className="py-2 pr-3">Reason</th>
                <th className="py-2 pr-3 text-right">Scam</th>
                <th className="py-2 pr-3">Round</th>
                <th className="py-2 pr-3">Closed</th>
              </tr>
            </thead>
            <tbody>
              {history.map((p) => {
                const pnl = p.pnlUsd ?? 0;
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
                      {p.exitPriceUsd ? fmtUsd(p.exitPriceUsd, 6) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {fmtUsd(p.exitAmountUsd ?? p.entryAmountUsd, 2)}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums font-medium ${
                        isProfit ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      {fmtUsd(pnl, 2)}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums ${
                        isProfit ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      {fmtPct(p.pnlPct ?? 0)}
                    </td>
                    <td className="py-2 pr-3">
                      {p.exitReason && (
                        <Badge variant="outline" className="text-xs">
                          {REASON_LABEL[p.exitReason] ?? p.exitReason}
                        </Badge>
                      )}
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
                    <td className="py-2 pr-3 text-muted-foreground">#{p.roundId}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {p.exitAt
                        ? new Date(p.exitAt).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
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
