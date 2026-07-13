"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle } from "lucide-react";
import type { ScamReportRow } from "@/hooks/use-trading-data";

function ScoreBar({ score, label }: { score: number; label: string }) {
  const color =
    score >= 80
      ? "bg-green-500"
      : score >= 60
      ? "bg-yellow-500"
      : score >= 40
      ? "bg-orange-500"
      : "bg-red-500";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-muted-foreground">{label}</span>
      <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
      <span className="w-8 text-right tabular-nums">{score}</span>
    </div>
  );
}

export function ScamReportsList({
  reports,
  isLoading,
}: {
  reports: ScamReportRow[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Scam Audit — Análises Recentes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (reports.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Scam Audit — Análises Recentes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-12">
            Nenhuma análise de scam executada ainda. Engine vai analisar tokens no próximo round.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scam Audit — Análises Recentes ({reports.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-[700px] overflow-y-auto">
          {reports.map((r) => (
            <div
              key={r.id}
              className={`p-3 rounded-lg border ${
                r.passed ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"
              }`}
            >
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  {r.passed ? (
                    <CheckCircle2 className="size-4 text-green-500" />
                  ) : (
                    <XCircle className="size-4 text-red-500" />
                  )}
                  <span className="font-medium">{r.symbol}</span>
                  <Badge variant="outline" className="text-xs">
                    {r.chain ?? "cex"}
                  </Badge>
                  {r.tokenId && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {r.tokenId.slice(0, 8)}…{r.tokenId.slice(-6)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={r.passed ? "default" : "destructive"}
                    className="tabular-nums"
                  >
                    Score: {r.score}/100
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.analyzedAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 mt-3">
                <ScoreBar score={r.honeypotScore} label="Honeypot" />
                <ScoreBar score={r.liquidityScore} label="Liquidity" />
                <ScoreBar score={r.contractScore} label="Contract" />
                <ScoreBar score={r.taxScore} label="Tax" />
                <ScoreBar score={r.holderScore} label="Holders" />
                <ScoreBar score={r.ageScore} label="Age" />
              </div>

              {/* Show first 3 findings for context */}
              {Object.keys(r.findings).length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                  {Object.entries(r.findings)
                    .slice(0, 2)
                    .flatMap(([key, arr]) => arr.slice(0, 1).map((f) => `• [${key}] ${f}`))
                    .slice(0, 3)
                    .map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
