"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldCheck, ShieldAlert, Globe, Lock, Search } from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { SiteAuditRow } from "@/hooks/use-trading-data";

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-500";
  if (score >= 60) return "text-yellow-500";
  if (score >= 40) return "text-orange-500";
  return "text-red-500";
}

interface Props {
  audits: SiteAuditRow[];
  isLoading: boolean;
}

export function SiteAuditPanel({ audits, isLoading }: Props) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [symbol, setSymbol] = useState("");

  const auditMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/site-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, symbol: symbol || undefined }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "audit failed");
      }
      return r.json();
    },
    onSuccess: () => {
      toast.success("Site auditado");
      qc.invalidateQueries({ queryKey: ["site-audits"] });
      setUrl("");
      setSymbol("");
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  return (
    <div className="space-y-4">
      <Alert>
        <Globe className="size-4" />
        <AlertTitle>Verificador de integridade de sites</AlertTitle>
        <AlertDescription className="text-xs">
          Antes de considerar o token de qualquer projeto com site, o sistema audita:
          <strong> SSL/TLS</strong> (validade + dias até expiração),
          <strong> idade do domínio</strong> (via RDAP gratuito),
          <strong> HTTP security headers</strong> (HSTS/CSP/X-Frame-Options),
          <strong> Google Safe Browsing</strong> (se GOOGLE_SAFE_BROWSING_KEY configurado),
          <strong> padrões suspeitos no HTML</strong> (pedidos de seed phrase, drainers, etc).
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="size-4" />
            Auditoria manual de URL
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-2 items-end">
            <div className="space-y-1">
              <Label htmlFor="audit-url" className="text-xs">URL do site</Label>
              <Input
                id="audit-url"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="audit-sym" className="text-xs">Símbolo (opcional)</Label>
              <Input
                id="audit-sym"
                placeholder="BTC"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
              />
            </div>
            <Button
              onClick={() => auditMutation.mutate()}
              disabled={auditMutation.isPending || !url}
              className="gap-1"
            >
              <Globe className="size-4" />
              Auditar
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Útil para verificar sites de projetos DEX antes de qualquer engajamento.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="size-4" />
            Histórico de auditorias ({audits.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && audits.length === 0 ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : audits.length === 0 ? (
            <Alert>
              <AlertDescription>
                Nenhuma auditoria registrada. Dispare uma manualmente acima.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              {audits.map((a) => (
                <Card key={a.id} className="border-l-4 border-l-primary/30">
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {a.passed ? (
                            <ShieldCheck className="size-4 text-emerald-500" />
                          ) : (
                            <ShieldAlert className="size-4 text-red-500" />
                          )}
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium underline"
                          >
                            {a.url}
                          </a>
                          {a.symbol && (
                            <Badge variant="outline" className="text-[10px]">{a.symbol}</Badge>
                          )}
                        </div>
                        <div className="flex gap-3 text-[11px] text-muted-foreground flex-wrap">
                          <span>SSL: <span className={a.sslValid ? "text-emerald-500" : "text-red-500"}>
                            {a.sslValid ? `✓ ${a.sslDaysToExpiry}d` : "✗"}
                          </span></span>
                          <span>Domínio: <span className={
                            (a.domainAgeDays ?? 0) >= 90 ? "text-emerald-500" :
                            (a.domainAgeDays ?? 0) >= 30 ? "text-yellow-500" : "text-red-500"
                          }>
                            {a.domainAgeDays !== null ? `${a.domainAgeDays}d` : "?"}
                          </span></span>
                          <span>HSTS: {a.hstsPresent ? "✓" : "✗"}</span>
                          <span>CSP: {a.cspPresent ? "✓" : "✗"}</span>
                          <span>XFO: {a.xfoPresent ? "✓" : "✗"}</span>
                          {a.safeBrowsingFlagged && (
                            <Badge variant="destructive" className="text-[10px]">Safe Browsing: FLAGGED</Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${scoreColor(a.score)}`}>
                          {a.score}
                        </div>
                        <Badge variant={a.passed ? "default" : "destructive"} className="text-[10px]">
                          {a.passed ? "PASS" : "FAIL"}
                        </Badge>
                      </div>
                    </div>

                    {a.redFlags.length > 0 && (
                      <div className="mt-2 pt-2 border-t">
                        <p className="text-[10px] text-muted-foreground uppercase">Red flags:</p>
                        <ul className="text-xs space-y-0.5 mt-1">
                          {a.redFlags.map((flag, i) => (
                            <li key={i} className="text-red-500">⚠ {flag}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <details className="mt-2">
                      <summary className="text-[10px] text-muted-foreground cursor-pointer">
                        Detalhes por sub-score
                      </summary>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2 text-[11px]">
                        <div>
                          <p className="text-muted-foreground">SSL</p>
                          <p className={`font-medium ${scoreColor(a.sslScore)}`}>{a.sslScore}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Domain age</p>
                          <p className={`font-medium ${scoreColor(a.domainAgeScore)}`}>{a.domainAgeScore}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Headers</p>
                          <p className={`font-medium ${scoreColor(a.headersScore)}`}>{a.headersScore}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Safe Browsing</p>
                          <p className={`font-medium ${scoreColor(a.safeBrowsingScore)}`}>{a.safeBrowsingScore}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Content</p>
                          <p className={`font-medium ${scoreColor(a.contentScore)}`}>{a.contentScore}</p>
                        </div>
                      </div>
                    </details>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
