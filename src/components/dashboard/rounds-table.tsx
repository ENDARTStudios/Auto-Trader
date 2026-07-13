"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { RoundRow } from "@/hooks/use-trading-data";

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function RoundsTable({
  rounds,
  isLoading,
}: {
  rounds: RoundRow[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Rounds</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (rounds.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Rounds</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-12">
            Nenhum round executado ainda.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico de Rounds ({rounds.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Started</th>
                <th className="py-2 pr-3">Ended</th>
                <th className="py-2 pr-3 text-right">Saldo Inicial</th>
                <th className="py-2 pr-3 text-right">Reserva Inicial</th>
                <th className="py-2 pr-3 text-right">Scanned</th>
                <th className="py-2 pr-3 text-right">Passed</th>
                <th className="py-2 pr-3 text-right">Rejected</th>
                <th className="py-2 pr-3 text-right">Opened</th>
                <th className="py-2 pr-3 text-right">Round P&L</th>
                <th className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.id} className="border-b hover:bg-muted/50">
                  <td className="py-2 pr-3 font-medium">#{r.id}</td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {new Date(r.startedAt).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {r.endedAt
                      ? new Date(r.endedAt).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {fmtUsd(r.tradingBalanceUsd)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-green-600">
                    {fmtUsd(r.reserveBalanceUsd)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.tokensScanned}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-green-600">
                    {r.tokensPassedFilter}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-red-500">
                    {r.tokensRejectedScam}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.positionsOpened}</td>
                  <td
                    className={`py-2 pr-3 text-right tabular-nums font-medium ${
                      (r.roundPnlUsd ?? 0) >= 0 ? "text-green-500" : "text-red-500"
                    }`}
                  >
                    {r.roundPnlUsd !== null && r.roundPnlUsd !== undefined
                      ? fmtUsd(r.roundPnlUsd)
                      : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge
                      variant={
                        r.status === "completed"
                          ? "default"
                          : r.status === "running"
                          ? "secondary"
                          : "outline"
                      }
                      className="text-xs"
                    >
                      {r.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
