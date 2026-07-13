"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ShieldCheck,
  ShieldAlert,
  Globe,
  Building2,
  Coins,
  Combine,
  Database,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  usePlatforms,
  type PlatformScanResult,
  type PlatformKind,
} from "@/hooks/use-trading-data";

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-500";
  if (score >= 60) return "text-yellow-500";
  if (score >= 40) return "text-orange-500";
  return "text-red-500";
}

function kindIcon(kind: PlatformKind) {
  switch (kind) {
    case "cex":
      return <Building2 className="size-3.5" />;
    case "dex":
      return <Coins className="size-3.5" />;
    case "aggregator":
      return <Combine className="size-3.5" />;
    case "data":
      return <Database className="size-3.5" />;
  }
}

function kindLabel(kind: PlatformKind): string {
  switch (kind) {
    case "cex":
      return "CEX";
    case "dex":
      return "DEX";
    case "aggregator":
      return "Aggregator";
    case "data":
      return "Data";
  }
}

function PlatformRow({ p }: { p: PlatformScanResult }) {
  return (
    <Card
      className={`border-l-4 ${
        p.approved
          ? "border-l-emerald-500"
          : p.audit
          ? "border-l-red-500"
          : "border-l-muted-foreground/30"
      }`}
    >
      <CardContent className="py-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {p.approved ? (
                <ShieldCheck className="size-4 text-emerald-500 shrink-0" />
              ) : p.audit ? (
                <ShieldAlert className="size-4 text-red-500 shrink-0" />
              ) : (
                <Globe className="size-4 text-muted-foreground shrink-0" />
              )}
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium underline truncate flex items-center gap-1"
              >
                {p.name}
                <ExternalLink className="size-3 inline" />
              </a>
              <Badge variant="outline" className="text-[10px] gap-1">
                {kindIcon(p.kind)}
                {kindLabel(p.kind)}
              </Badge>
              {p.chains && p.chains.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {p.chains.slice(0, 4).map((c) => (
                    <Badge key={c} variant="secondary" className="text-[9px] py-0 px-1.5">
                      {c}
                    </Badge>
                  ))}
                  {p.chains.length > 4 && (
                    <Badge variant="secondary" className="text-[9px] py-0 px-1.5">
                      +{p.chains.length - 4}
                    </Badge>
                  )}
                </div>
              )}
            </div>
            {p.notes && (
              <p className="text-[11px] text-muted-foreground line-clamp-1">{p.notes}</p>
            )}
            {p.audit && (
              <div className="flex gap-3 text-[11px] text-muted-foreground flex-wrap mt-0.5">
                <span>
                  SSL:{" "}
                  <span className={p.audit.sslValid ? "text-emerald-500" : "text-red-500"}>
                    {p.audit.sslValid
                      ? `✓ ${p.audit.sslDaysToExpiry ?? "?"}d`
                      : "✗"}
                  </span>
                </span>
                <span>
                  Domínio:{" "}
                  <span
                    className={
                      (p.audit.domainAgeDays ?? 0) >= 90
                        ? "text-emerald-500"
                        : (p.audit.domainAgeDays ?? 0) >= 30
                        ? "text-yellow-500"
                        : "text-red-500"
                    }
                  >
                    {p.audit.domainAgeDays !== null ? `${p.audit.domainAgeDays}d` : "?"}
                  </span>
                </span>
                <span>HSTS: {p.audit.hstsPresent ? "✓" : "✗"}</span>
                <span>CSP: {p.audit.cspPresent ? "✓" : "✗"}</span>
                <span>XFO: {p.audit.xfoPresent ? "✓" : "✗"}</span>
                {p.audit.safeBrowsingFlagged && (
                  <Badge variant="destructive" className="text-[10px] py-0">
                    Safe Browsing: FLAGGED
                  </Badge>
                )}
                {p.scannedAt && (
                  <span className="text-muted-foreground/70">
                    scan: {new Date(p.scannedAt).toLocaleString()}
                  </span>
                )}
              </div>
            )}
            {!p.audit && p.rejectionReason && (
              <p className="text-[11px] text-muted-foreground italic">{p.rejectionReason}</p>
            )}
            {p.audit && p.audit.redFlags.length > 0 && (
              <div className="mt-1.5 pt-1.5 border-t">
                <p className="text-[10px] text-muted-foreground uppercase">Red flags:</p>
                <ul className="text-xs space-y-0.5 mt-0.5">
                  {p.audit.redFlags.slice(0, 4).map((flag, i) => (
                    <li key={i} className="text-red-500">
                      ⚠ {flag}
                    </li>
                  ))}
                  {p.audit.redFlags.length > 4 && (
                    <li className="text-muted-foreground">
                      + {p.audit.redFlags.length - 4} mais...
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <div className="text-right shrink-0">
            {p.audit ? (
              <>
                <div className={`text-2xl font-bold ${scoreColor(p.audit.score)}`}>
                  {p.audit.score}
                </div>
                <Badge
                  variant={p.approved ? "default" : "destructive"}
                  className="text-[10px] gap-1"
                >
                  {p.approved ? (
                    <>
                      <CheckCircle2 className="size-3" /> APPROVED
                    </>
                  ) : (
                    <>
                      <XCircle className="size-3" /> REJECTED
                    </>
                  )}
                </Badge>
              </>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                PENDING
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function PlatformScannerPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = usePlatforms();

  const scanAllMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan_all", force: true }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "scan failed");
      }
      return r.json();
    },
    onSuccess: (summary) => {
      toast.success(
        `Scan completo: ${summary.approved}/${summary.total} aprovadas, ${summary.rejected} rejeitadas`
      );
      qc.invalidateQueries({ queryKey: ["platforms"] });
      qc.invalidateQueries({ queryKey: ["site-audits"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  const scanOneMutation = useMutation({
    mutationFn: async (platformId: string) => {
      const r = await fetch("/api/platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan_one", platformId, force: true }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "scan failed");
      }
      return r.json();
    },
    onSuccess: (res: PlatformScanResult) => {
      toast.success(
        `${res.name}: ${res.approved ? "APROVADA" : "REJEITADA"} (score ${res.audit?.score ?? "?"})`
      );
      qc.invalidateQueries({ queryKey: ["platforms"] });
      qc.invalidateQueries({ queryKey: ["site-audits"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  const summary = data ?? { total: 0, approved: 0, rejected: 0, pending: 0, results: [] };
  const approved = summary.results.filter((r) => r.approved);
  const rejected = summary.results.filter((r) => r.audit && !r.approved);
  const pending = summary.results.filter((r) => !r.audit);

  return (
    <div className="space-y-4">
      <Alert>
        <Globe className="size-4" />
        <AlertTitle>Scanner de plataformas de criptomoedas</AlertTitle>
        <AlertDescription className="text-xs">
          O Auto Trader mantém um registro curado de {summary.total || "27"} plataformas
          principais (CEXs, DEXs, agregadores e data providers) e audita cada uma com 5
          camadas: <strong>SSL/TLS</strong>, <strong>idade do domínio</strong> (via RDAP gratuito),
          <strong> HTTP security headers</strong> (HSTS/CSP/XFO),{" "}
          <strong>Google Safe Browsing</strong> (opcional) e{" "}
          <strong>padrões suspeitos no HTML</strong>. Plataformas aprovadas podem ser
          usadas pelo engine; rejeitadas são bloqueadas. 100% fontes gratuitas / open-source.
        </AlertDescription>
      </Alert>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase">Total</p>
                <p className="text-2xl font-bold">{summary.total}</p>
              </div>
              <Globe className="size-6 text-muted-foreground/40" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/40">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase">Aprovadas</p>
                <p className="text-2xl font-bold text-emerald-500">{summary.approved}</p>
              </div>
              <CheckCircle2 className="size-6 text-emerald-500/60" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-500/40">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase">Rejeitadas</p>
                <p className="text-2xl font-bold text-red-500">{summary.rejected}</p>
              </div>
              <XCircle className="size-6 text-red-500/60" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-yellow-500/40">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] text-muted-foreground uppercase">Pendentes</p>
                <p className="text-2xl font-bold text-yellow-500">{summary.pending}</p>
              </div>
              <RefreshCw className="size-6 text-yellow-500/60" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action bar */}
      <Card>
        <CardContent className="py-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs text-muted-foreground">
            {isLoading
              ? "Carregando cache de auditorias..."
              : `Última verificação: ${
                  summary.results.find((r) => r.scannedAt)?.scannedAt
                    ? new Date(
                        summary.results.find((r) => r.scannedAt)!.scannedAt!
                      ).toLocaleString()
                    : "—"
                }`}
          </div>
          <Button
            onClick={() => scanAllMutation.mutate()}
            disabled={scanAllMutation.isPending}
            className="gap-1"
          >
            <RefreshCw
              className={`size-4 ${scanAllMutation.isPending ? "animate-spin" : ""}`}
            />
            {scanAllMutation.isPending ? "Scaneando todas..." : "Escanear todas (forçado)"}
          </Button>
        </CardContent>
      </Card>

      {/* Approved platforms first */}
      {approved.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="size-4 text-emerald-500" />
              Plataformas aprovadas ({approved.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {approved.map((p) => (
                <PlatformRow key={p.id} p={p} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rejected */}
      {rejected.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="size-4 text-red-500" />
              Plataformas rejeitadas ({rejected.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {rejected.map((p) => (
                <PlatformRow key={p.id} p={p} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending */}
      {pending.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="size-4 text-yellow-500" />
              Não auditadas ainda ({pending.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pending.map((p) => (
                <PlatformRow key={p.id} p={p} />
              ))}
            </div>
            <Button
              onClick={() => scanAllMutation.mutate()}
              disabled={scanAllMutation.isPending}
              className="gap-1 mt-3"
              variant="outline"
              size="sm"
            >
              <RefreshCw
                className={`size-4 ${scanAllMutation.isPending ? "animate-spin" : ""}`}
              />
              Auditar todas agora
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && summary.total === 0 && (
        <Alert>
          <AlertDescription>
            Nenhuma plataforma carregada. Clique em &quot;Escanear todas&quot; para começar.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
