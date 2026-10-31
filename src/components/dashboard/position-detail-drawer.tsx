"use client";

import { useState, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  TrendingUp,
  TrendingDown,
  Brain,
  ShieldAlert,
  Shield,
  Clock,
  DollarSign,
  Activity,
  XCircle,
  AlertTriangle,
  ScrollText,
  BarChart3,
} from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  usePositionDetail,
  type PositionDetailData,
} from "@/hooks/use-trading-data";

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

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s atrás`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min atrás`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h atrás`;
  return `${Math.floor(diff / 86_400_000)}d atrás`;
}

const RECOMMENDATION_COLOR: Record<string, string> = {
  buy: "text-emerald-500",
  hold: "text-yellow-500",
  avoid: "text-red-500",
  investigate: "text-blue-500",
  exit: "text-red-500",
};

const REASON_LABEL: Record<string, string> = {
  take_profit: "Take Profit",
  stop_loss: "Stop Loss",
  timeout: "Timeout",
  kill_switch: "Kill Switch",
  manual: "Manual",
  schedule_force_close: "Agenda (forçado)",
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "destructive",
  warning: "secondary",
  info: "outline",
};

interface Props {
  positionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PositionDetailDrawer({
  positionId,
  open,
  onOpenChange,
}: Props) {
  const { data, isLoading, error } = usePositionDetail(open ? positionId : null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:!max-w-2xl overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {data?.position ? (
              <>
                <Badge variant="outline">{data.position.source}</Badge>
                {data.position.symbol}
                {data.position.chain && (
                  <span className="text-sm text-muted-foreground">
                    · {data.position.chain}
                  </span>
                )}
              </>
            ) : (
              "Carregando..."
            )}
          </SheetTitle>
          <SheetDescription>
            Detalhes completos da posição — scam audit, AI insights, alertas de
            vigilância, e histórico de mercado.
          </SheetDescription>
        </SheetHeader>

        {isLoading && <LoadingState />}

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Erro</AlertTitle>
            <AlertDescription>{String(error)}</AlertDescription>
          </Alert>
        )}

        {data && !isLoading && <PositionDetailContent data={data} />}
      </SheetContent>
    </Sheet>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

function PositionDetailContent({ data }: { data: PositionDetailData }) {
  const p = data.position;
  const isClosed = p.status !== "open";
  const pnl = isClosed ? p.pnlUsd ?? 0 : p.unrealizedPnlUsd ?? 0;
  const pnlPct = isClosed ? p.pnlPct ?? 0 : p.unrealizedPnlPct ?? 0;
  const isProfit = pnl >= 0;
  const currentPrice = isClosed ? p.exitPriceUsd : p.currentPriceUsd;

  return (
    <div className="space-y-4 pr-2">
      {/* Status + P&L */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <Badge
                variant={
                  p.status === "open"
                    ? "default"
                    : p.status === "closed"
                    ? "secondary"
                    : "destructive"
                }
              >
                {p.status.toUpperCase()}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {isClosed ? "P&L Realizado" : "P&L Não-realizado"}
              </p>
              <p
                className={`text-lg font-bold flex items-center gap-1 ${
                  isProfit ? "text-green-500" : "text-red-500"
                }`}
              >
                {isProfit ? (
                  <TrendingUp className="size-4" />
                ) : (
                  <TrendingDown className="size-4" />
                )}
                {fmtUsd(pnl, 2)} ({fmtPct(pnlPct)})
              </p>
            </div>
          </div>
          {p.exitReason && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-xs text-muted-foreground">Motivo de saída</p>
              <Badge variant="outline">
                {REASON_LABEL[p.exitReason] ?? p.exitReason}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Price + qty */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <DollarSign className="size-4" /> Preços & Quantidade
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Preço entrada</p>
            <p className="font-mono">{fmtUsd(p.entryPriceUsd, 6)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">
              {isClosed ? "Preço saída" : "Preço atual"}
            </p>
            <p className="font-mono">
              {currentPrice ? fmtUsd(currentPrice, 6) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Qty</p>
            <p className="font-mono">
              {p.entryQty.toLocaleString("en-US", { maximumFractionDigits: 4 })}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Alocado</p>
            <p className="font-mono">{fmtUsd(p.entryAmountUsd, 2)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Take Profit</p>
            <p className="font-mono text-emerald-600">
              {fmtUsd(p.takeProfitPrice, 6)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Stop Loss</p>
            <p className="font-mono text-red-600">
              {fmtUsd(p.stopLossPrice, 6)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Entrada</p>
            <p className="font-mono text-xs">{fmtDate(p.entryAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Saída</p>
            <p className="font-mono text-xs">{fmtDate(p.exitAt ?? null)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Expira</p>
            <p className="font-mono text-xs">{fmtDate(p.maxExitAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Round</p>
            <p className="font-mono">#{p.roundId}</p>
          </div>
        </CardContent>
      </Card>

      {/* Manual close action for open positions */}
      {!isClosed && <ManualCloseCard positionId={p.id} symbol={p.symbol} />}

      {/* Token ID (for DEX) */}
      {p.tokenId && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Token ID (contrato)</p>
            <p className="font-mono text-xs break-all">{p.tokenId}</p>
          </CardContent>
        </Card>
      )}

      {/* Market chart mini */}
      {data.marketChart.length > 1 && (
        <MarketChartCard data={data.marketChart} entryPrice={p.entryPriceUsd} />
      )}

      {/* Scam audit */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="size-4" /> Scam Audit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Badge
              variant={
                p.scamScore >= 80
                  ? "default"
                  : p.scamScore >= 60
                  ? "secondary"
                  : "destructive"
              }
              className="text-base"
            >
              Score: {p.scamScore}/100
            </Badge>
            {data.scamReport && (
              <span className="text-xs text-muted-foreground">
                Auditado {timeAgo(data.scamReport.analyzedAt)}
              </span>
            )}
          </div>
          {data.scamReport ? (
            <div className="grid grid-cols-3 gap-2 text-xs">
              <ScoreCell label="Honeypot" v={data.scamReport.honeypotScore} />
              <ScoreCell label="Liquidez" v={data.scamReport.liquidityScore} />
              <ScoreCell label="Contrato" v={data.scamReport.contractScore} />
              <ScoreCell label="Taxa" v={data.scamReport.taxScore} />
              <ScoreCell label="Holders" v={data.scamReport.holderScore} />
              <ScoreCell label="Idade" v={data.scamReport.ageScore} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Sem scam report detalhado para este token.
            </p>
          )}
          {p.scamBreakdown && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Ver breakdown completo
              </summary>
              <pre className="mt-2 p-2 bg-muted rounded text-[10px] overflow-x-auto">
                {JSON.stringify(p.scamBreakdown, null, 2)}
              </pre>
            </details>
          )}
        </CardContent>
      </Card>

      {/* Surveillance alerts */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="size-4" /> Vigilância
            {data.surveillanceAlerts.length > 0 && (
              <Badge variant="destructive" className="text-xs">
                {data.surveillanceAlerts.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.surveillanceAlerts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum alerta de vigilância para esta posição.
            </p>
          ) : (
            data.surveillanceAlerts.map((a) => (
              <div
                key={a.id}
                className={`p-2 rounded-md border text-xs space-y-1 ${
                  a.severity === "critical"
                    ? "border-red-500/50 bg-red-500/5"
                    : a.severity === "warning"
                    ? "border-yellow-500/50 bg-yellow-500/5"
                    : "border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge
                    variant={SEVERITY_COLOR[a.severity] as any}
                    className="text-[10px]"
                  >
                    {a.severity}
                  </Badge>
                  <span className="text-muted-foreground text-[10px]">
                    {timeAgo(a.detectedAt)}
                  </span>
                </div>
                <p className="font-medium">{a.message}</p>
                {a.type && (
                  <p className="text-muted-foreground text-[10px]">
                    Tipo: {a.type}
                  </p>
                )}
                {a.resolution && (
                  <p className="text-emerald-600 text-[10px]">
                    Resolvido: {a.resolution}
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* AI insights — v14: dissent matrix */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="size-4" /> AI Insights — Matriz de Dissidência
            {data.aiInsights.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {data.aiInsights.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.aiInsights.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum insight de IA gerado para este token.
            </p>
          ) : (
            <>
              {/* Dissent summary — per-agent latest recommendation */}
              {(() => {
                // Group by agentRole, take latest per role
                const byRole = new Map<string, typeof data.aiInsights[number]>();
                for (const ins of data.aiInsights) {
                  const ex = byRole.get(ins.agentRole);
                  if (!ex || new Date(ins.createdAt) > new Date(ex.createdAt)) {
                    byRole.set(ins.agentRole, ins);
                  }
                }
                const roles = Array.from(byRole.entries());
                if (roles.length <= 1) return null;
                // Detect dissent: any avoid or investigate → veto flag
                const hasVeto = roles.some(
                  ([, i]) => i.recommendation === "avoid" || i.recommendation === "investigate"
                );
                const hasExit = roles.some(([, i]) => i.recommendation === "exit");
                const allBuy = roles.every(([, i]) => i.recommendation === "buy");
                const consensus = hasVeto
                  ? "VETO (avoid/investigate presente)"
                  : hasExit
                  ? "EXIT recomendado"
                  : allBuy
                  ? "CONSENSO BUY"
                  : "MISTO";
                return (
                  <div
                    className={`p-3 rounded border text-xs space-y-2 ${
                      hasVeto
                        ? "border-red-500/30 bg-red-500/5"
                        : hasExit
                        ? "border-orange-500/30 bg-orange-500/5"
                        : "border-border/60 bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Consensus</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          hasVeto
                            ? "bg-red-500/15 text-red-400 border-red-500/30"
                            : hasExit
                            ? "bg-orange-500/15 text-orange-400 border-orange-500/30"
                            : "bg-green-500/15 text-green-400 border-green-500/30"
                        }`}
                      >
                        {consensus}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {roles.map(([role, i]) => (
                        <div
                          key={role}
                          className="text-center p-1.5 rounded bg-background/50 border border-border/40"
                        >
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                            {role.replace(/_/g, " ")}
                          </div>
                          <div
                            className={`text-xs font-semibold mt-0.5 ${
                              RECOMMENDATION_COLOR[i.recommendation] ?? ""
                            }`}
                          >
                            {i.recommendation.toUpperCase()}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {i.confidence}%
                          </div>
                        </div>
                      ))}
                    </div>
                    {hasVeto && (
                      <p className="text-[10px] text-red-400 italic">
                        ⚠️ Pelo menos um agente vetou esta operação. O engine
                        respeita o veto — posições existentes continuam sob
                        MONITOR/EXIT, mas nenhuma nova entrada é tomada quando o
                        veto veio da análise pré-trade.
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* Individual insights — full list */}
              <div className="space-y-2">
                {data.aiInsights.slice(0, 5).map((i) => (
                  <div
                    key={i.id}
                    className="p-2 rounded-md border text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {i.agentRole}
                        </Badge>
                        <span
                          className={`font-medium ${
                            RECOMMENDATION_COLOR[i.recommendation] ?? ""
                          }`}
                        >
                          {i.recommendation.toUpperCase()}
                        </span>
                        <span className="text-muted-foreground text-[10px]">
                          ({i.confidence}% conf)
                        </span>
                      </div>
                      <span className="text-muted-foreground text-[10px]">
                        {timeAgo(i.createdAt)}
                      </span>
                    </div>
                    <p className="text-muted-foreground">{i.promptSummary}</p>
                    {i.error && (
                      <p className="text-red-500 text-[10px]">Erro: {i.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Round info */}
      {data.round && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="size-4" /> Round #{data.round.id}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground">Iniciado</p>
              <p className="font-mono">{fmtDate(data.round.startedAt)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Finalizado</p>
              <p className="font-mono">{fmtDate(data.round.endedAt ?? null)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tokens escaneados</p>
              <p className="font-mono">{data.round.tokensScanned}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Passaram filtro</p>
              <p className="font-mono">{data.round.tokensPassedFilter}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Posições abertas</p>
              <p className="font-mono">{data.round.positionsOpened}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Posições fechadas</p>
              <p className="font-mono">{data.round.positionsClosed}</p>
            </div>
            {data.round.roundPnlUsd != null && (
              <div className="col-span-2">
                <p className="text-muted-foreground">P&L do round</p>
                <p
                  className={`font-mono font-medium ${
                    data.round.roundPnlUsd >= 0
                      ? "text-green-500"
                      : "text-red-500"
                  }`}
                >
                  {fmtUsd(data.round.roundPnlUsd, 2)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ScoreCell({ label, v }: { label: string; v: number }) {
  const color =
    v >= 80
      ? "text-emerald-500"
      : v >= 60
      ? "text-yellow-500"
      : "text-red-500";
  return (
    <div className="p-2 rounded border bg-card">
      <p className="text-muted-foreground text-[10px]">{label}</p>
      <p className={`font-mono font-medium ${color}`}>{v}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual close card — only shown for open positions
// ---------------------------------------------------------------------------

function ManualCloseCard({
  positionId,
  symbol,
}: {
  positionId: string;
  symbol: string;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const close = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/positions/${positionId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "close failed");
      }
      return r.json();
    },
    onSuccess: (data) => {
      toast.success(
        `${symbol} fechada @ $${data.exitPrice.toFixed(6)} (P&L $${data.position.pnlUsd?.toFixed(2) ?? "?"})`
      );
      setNote("");
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["open-positions"] });
      qc.invalidateQueries({ queryKey: ["history"] });
      qc.invalidateQueries({ queryKey: ["engine-status"] });
      qc.invalidateQueries({ queryKey: ["position-detail", positionId] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  return (
    <Card className="border-orange-500/50 bg-orange-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-orange-600">
          <XCircle className="size-4" /> Fechamento Manual
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertDescription>
            Fecha a posição <strong>{symbol}</strong> ao preço de mercado atual.
            Motivo será registrado como <code>manual</code>. Não pode ser desfeito.
          </AlertDescription>
        </Alert>
        {!confirmOpen ? (
          <Button
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
            className="w-full gap-1"
          >
            <XCircle className="size-4" /> Fechar posição manualmente
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="note">Nota do operador (opcional, máx 500 chars)</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                placeholder="Ex: stop mental, rebalanceamento, notícia negativa..."
                rows={2}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={() => close.mutate()}
                disabled={close.isPending}
                className="flex-1 gap-1"
              >
                <XCircle className="size-4" />
                {close.isPending ? "Fechando..." : "Confirmar fechamento"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmOpen(false);
                  setNote("");
                }}
                disabled={close.isPending}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Market chart mini — inline SVG sparkline of last 30 snapshots
// ---------------------------------------------------------------------------

function MarketChartCard({
  data,
  entryPrice,
}: {
  data: Array<{ t: string; p: number; rsi: number | null; signal: string }>;
  entryPrice: number;
}) {
  const { path, fillPath, min, max, width, height, entryY } = useMemo(() => {
    if (data.length < 2) {
      return {
        path: "",
        fillPath: "",
        min: 0,
        max: 0,
        width: 0,
        height: 0,
        entryY: 0,
      };
    }
    const w = 600;
    const h = 120;
    const pad = 8;
    const prices = data.map((d) => d.p);
    const min = Math.min(...prices, entryPrice);
    const max = Math.max(...prices, entryPrice);
    const range = max - min || 1;
    const xStep = (w - pad * 2) / (data.length - 1);
    const yScale = (p: number) =>
      h - pad - ((p - min) / range) * (h - pad * 2);

    const points = data.map((d, i) => ({
      x: pad + i * xStep,
      y: yScale(d.p),
    }));

    const path = points
      .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(" ");

    const fillPath = `${path} L ${points[points.length - 1].x.toFixed(1)} ${h - pad} L ${points[0].x.toFixed(1)} ${h - pad} Z`;

    return {
      path,
      fillPath,
      min,
      max,
      width: w,
      height: h,
      entryY: yScale(entryPrice),
    };
  }, [data, entryPrice]);

  if (data.length < 2) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 className="size-4" /> Histórico de Preço
          <span className="text-xs text-muted-foreground font-normal">
            ({data.length} snapshots)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Entry price line */}
          <line
            x1="0"
            x2={width}
            y1={entryY}
            y2={entryY}
            stroke="rgb(59 130 246)"
            strokeWidth="1"
            strokeDasharray="4 2"
          />
          {/* Area fill */}
          <path d={fillPath} fill="rgba(59 130 246, 0.1)" />
          {/* Price line */}
          <path
            d={path}
            fill="none"
            stroke="rgb(59 130 246)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>Min: ${min.toFixed(4)}</span>
          <span className="text-blue-500">→ Entrada: ${entryPrice.toFixed(4)}</span>
          <span>Max: ${max.toFixed(4)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
