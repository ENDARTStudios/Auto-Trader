"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ShieldAlert,
  Activity,
  RefreshCw,
  AlertTriangle,
  Clock,
  Droplets,
  Users,
  Percent,
  TrendingDown,
  Bug,
} from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SurveillanceAlertRow, AlertType, AlertSeverity } from "@/hooks/use-trading-data";

const TYPE_META: Record<
  AlertType,
  { label: string; icon: typeof ShieldAlert; color: string }
> = {
  goplus_critical_flag: {
    label: "GoPlus Critical",
    icon: ShieldAlert,
    color: "text-red-500",
  },
  liquidity_drain: {
    label: "Liquidity Drain",
    icon: Droplets,
    color: "text-red-500",
  },
  price_dump_velocity: {
    label: "Price Dump",
    icon: TrendingDown,
    color: "text-orange-500",
  },
  holder_concentration: {
    label: "Holder Concentration",
    icon: Users,
    color: "text-yellow-500",
  },
  tax_spike: {
    label: "Tax Spike",
    icon: Percent,
    color: "text-yellow-500",
  },
  timeout_approaching: {
    label: "Timeout Soon",
    icon: Clock,
    color: "text-blue-500",
  },
  price_anomaly: {
    label: "Price Anomaly",
    icon: Bug,
    color: "text-red-500",
  },
};

const SEVERITY_BADGE: Record<AlertSeverity, string> = {
  critical: "bg-red-500/15 text-red-500 border-red-500/30",
  warning: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30",
  info: "bg-blue-500/15 text-blue-500 border-blue-500/30",
};

interface Props {
  alerts: SurveillanceAlertRow[];
  counts: { critical: number; warning: number; info: number; total: number };
  isLoading: boolean;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s atrás`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min atrás`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h atrás`;
  return `${Math.floor(diff / 86_400_000)}d atrás`;
}

export function SurveillancePanel({ alerts, counts, isLoading }: Props) {
  const qc = useQueryClient();

  const scanNow = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/surveillance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan_now" }),
      });
      if (!r.ok) throw new Error("scan failed");
      return r.json();
    },
    onSuccess: (data) => {
      toast.success(data.message ?? "Scan executado");
      qc.invalidateQueries({ queryKey: ["surveillance"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  return (
    <div className="space-y-4">
      <Alert>
        <ShieldAlert className="size-4" />
        <AlertTitle>Vigilância contínua de posições abertas</AlertTitle>
        <AlertDescription className="text-xs">
          Cada posição aberta é re-escaneada a cada 5 min em busca de riscos
          emergentes que não existiam (ou não foram detectados) na entrada:
          <strong> GoPlus re-scan</strong> (honeypot/tax/holder crítico),
          <strong> dreno de liquidez</strong> (DEX liquidity &lt; $50k),
          <strong> velocidade de queda</strong> (&gt;12% desde entrada mas ainda acima do SL),
          <strong> anomalia de preço</strong> (&gt;10% drop em 1h ou &gt;80% sells em 1h),
          <strong> concentração de holders</strong>,
          <strong> spike de tax</strong>,
          <strong> timeout próximo</strong> (&lt;30 min).
          Alertas críticos são encaminhados ao <strong>Exit Planner AI</strong> que decide
          entre hold / tighten_sl / raise_tp / scale_out / exit_now.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className={counts.critical > 0 ? "animate-pulse border-red-500/30" : ""}>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Críticos</div>
            <div className="text-2xl font-bold text-red-500">{counts.critical}</div>
          </CardContent>
        </Card>
        <Card className={counts.warning > 0 ? "border-yellow-500/30" : ""}>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Avisos</div>
            <div className="text-2xl font-bold text-yellow-500">{counts.warning}</div>
          </CardContent>
        </Card>
        <Card className={counts.info > 0 ? "border-blue-500/30" : ""}>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Informativos</div>
            <div className="text-2xl font-bold text-blue-500">{counts.info}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground">Total ativos</div>
            <div className="text-2xl font-bold">{counts.total}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4" />
            Alertas recentes ({alerts.length})
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => scanNow.mutate()}
            disabled={scanNow.isPending}
            className="gap-1"
          >
            <RefreshCw className={`size-3 ${scanNow.isPending ? "animate-spin" : ""}`} />
            Scan agora
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              Carregando alertas...
            </div>
          ) : alerts.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              <ShieldAlert className="size-8 mx-auto mb-2 opacity-50" />
              Nenhum alerta de vigilância ativo. Posições sob controle.
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {alerts.map((a) => {
                const meta = TYPE_META[a.type];
                const Icon = meta.icon;
                return (
                  <div
                    key={a.id}
                    className={`border rounded-lg p-3 ${
                      a.resolvedAt
                        ? "opacity-50 border-muted"
                        : a.severity === "critical"
                        ? "border-red-500/30 bg-red-500/5"
                        : a.severity === "warning"
                        ? "border-yellow-500/30 bg-yellow-500/5"
                        : "border-blue-500/30 bg-blue-500/5"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <Icon className={`size-4 mt-0.5 shrink-0 ${meta.color}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{a.symbol}</span>
                            <Badge variant="outline" className={`text-[10px] ${SEVERITY_BADGE[a.severity]}`}>
                              {a.severity}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">{meta.label}</span>
                            {a.resolvedAt && (
                              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-500">
                                {a.resolution ?? "resolvido"}
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm mt-1 break-words">{a.message}</div>
                          {a.context && Object.keys(a.context).length > 0 && (
                            <details className="mt-1.5">
                              <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground">
                                contexto
                              </summary>
                              <pre className="text-[10px] text-muted-foreground mt-1 whitespace-pre-wrap break-all">
                                {JSON.stringify(a.context, null, 2)}
                              </pre>
                            </details>
                          )}
                          <div className="text-[10px] text-muted-foreground mt-1">
                            {timeAgo(a.detectedAt)} · pos {a.positionId.slice(0, 8)}...
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
