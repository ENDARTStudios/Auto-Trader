"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Eye,
  Plus,
  Trash2,
  Sparkles,
  ArrowUp,
  ArrowDown,
  Pencil,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import {
  useWatchlist,
  useAddWatchlistToken,
  useUpdateWatchlistToken,
  useRemoveWatchlistToken,
  useAnalyzeWatchlistToken,
  useResetWatchlistAlert,
  type WatchlistToken,
  type WatchlistInsight,
} from "@/hooks/use-trading-data";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtPrice(p: number | null | undefined): string {
  if (p === null || p === undefined) return "—";
  if (p === 0) return "$0";
  if (p < 0.0001) return `$${p.toExponential(2)}`;
  if (p < 1) return `$${p.toFixed(6)}`;
  if (p < 100) return `$${p.toFixed(4)}`;
  return `$${p.toFixed(2)}`;
}

function fmtPct(p: number | null | undefined): string {
  if (p === null || p === undefined) return "—";
  const sign = p >= 0 ? "+" : "";
  return `${sign}${p.toFixed(2)}%`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "nunca";
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s atrás`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const days = Math.floor(h / 24);
  return `${days}d atrás`;
}

const RECOMMENDATION_STYLE: Record<
  WatchlistInsight["recommendation"],
  { label: string; className: string }
> = {
  buy: { label: "BUY", className: "bg-green-500/20 text-green-400 border-green-500/30" },
  hold: { label: "HOLD", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  avoid: { label: "AVOID", className: "bg-red-500/20 text-red-400 border-red-500/30" },
  investigate: { label: "INVESTIGATE", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  exit: { label: "EXIT", className: "bg-red-500/20 text-red-400 border-red-500/30" },
};

// ---------------------------------------------------------------------------
// Add-form component
// ---------------------------------------------------------------------------
function AddWatchlistForm() {
  const addMut = useAddWatchlistToken();
  const [symbol, setSymbol] = useState("");
  const [source, setSource] = useState<"cex" | "dex">("cex");
  const [chain, setChain] = useState("base");
  const [tokenId, setTokenId] = useState("");
  const [notes, setNotes] = useState("");
  const [threshold, setThreshold] = useState("10");

  function reset() {
    setSymbol("");
    setSource("cex");
    setChain("base");
    setTokenId("");
    setNotes("");
    setThreshold("10");
  }

  function submit() {
    const sym = symbol.trim();
    if (!sym) {
      toast.error("Símbolo é obrigatório");
      return;
    }
    if (source === "dex" && (!chain || !tokenId.trim())) {
      toast.error("DEX tokens precisam de chain + contract address");
      return;
    }
    addMut.mutate(
      {
        symbol: sym,
        source,
        chain: source === "dex" ? chain : undefined,
        tokenId: source === "dex" ? tokenId.trim() : undefined,
        notes: notes.trim() || undefined,
        alertThresholdPct: parseFloat(threshold) || 10,
      },
      {
        onSuccess: () => {
          toast.success(`${sym.toUpperCase()} adicionado à watchlist`);
          reset();
        },
        onError: (e: Error) => toast.error(e.message),
      }
    );
  }

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plus className="h-4 w-4 text-primary" />
          Adicionar token à Watchlist
        </CardTitle>
        <CardDescription>
          Monitore tokens sem auto-trading. O engine busca o preço a cada tick e dispara alertas quando o preço cruza o threshold configurado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="wl-symbol" className="text-xs">Símbolo</Label>
            <Input
              id="wl-symbol"
              placeholder="BTC/USDT ou PEPE"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Fonte</Label>
            <Select
              value={source}
              onValueChange={(v) => setSource(v as "cex" | "dex")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cex">CEX (Binance)</SelectItem>
                <SelectItem value="dex">DEX (DexScreener)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wl-threshold" className="text-xs">Alerta ± %</Label>
            <Input
              id="wl-threshold"
              type="number"
              step="0.5"
              min="0"
              max="100"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </div>
        </div>

        {source === "dex" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Chain</Label>
              <Select value={chain} onValueChange={setChain}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="base">Base</SelectItem>
                  <SelectItem value="arbitrum">Arbitrum</SelectItem>
                  <SelectItem value="optimism">Optimism</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wl-token" className="text-xs">Contract address</Label>
              <Input
                id="wl-token"
                placeholder="0x..."
                value={tokenId}
                onChange={(e) => setTokenId(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="wl-notes" className="text-xs">Notas (opcional)</Label>
          <Textarea
            id="wl-notes"
            placeholder="Por que estou observando este token?"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </div>

        <div className="flex justify-end">
          <Button
            onClick={submit}
            disabled={addMut.isPending}
            className="gap-2"
          >
            {addMut.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Adicionar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Analysis result dialog
// ---------------------------------------------------------------------------
function AnalysisDialog({
  open,
  onOpenChange,
  symbol,
  insight,
  isLoading,
  durationMs,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  symbol: string;
  insight: WatchlistInsight | null;
  isLoading: boolean;
  durationMs?: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:!max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Análise de IA — {symbol}
          </DialogTitle>
          <DialogDescription>
            Sentimento gerado pelo agente news_sentiment (z-ai-web-dev-sdk).
            Persistido em AIInsight para trilha de auditoria.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center gap-3 py-8 justify-center text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Chamando LLM…
          </div>
        ) : insight ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge
                variant="outline"
                className={RECOMMENDATION_STYLE[insight.recommendation].className}
              >
                {RECOMMENDATION_STYLE[insight.recommendation].label}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Confiança: <span className="font-mono font-semibold">{insight.confidence}%</span>
              </span>
              {durationMs !== undefined && (
                <span className="text-xs text-muted-foreground">
                  {durationMs}ms · {insight.tokensUsed} tokens
                </span>
              )}
            </div>
            {insight.keySignals.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Sinais-chave
                </Label>
                <ul className="space-y-1 text-sm">
                  {insight.keySignals.map((s, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Output completo do modelo
              </Label>
              <pre className="text-xs bg-muted/40 border border-border/60 rounded p-3 whitespace-pre-wrap max-h-72 overflow-y-auto font-mono">
                {insight.modelOutput}
              </pre>
            </div>
            {insight.error && (
              <div className="text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded p-2">
                {insight.error}
              </div>
            )}
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Sem resultado.
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit dialog (notes / threshold / enabled)
// ---------------------------------------------------------------------------
function EditDialog({
  token,
  open,
  onOpenChange,
}: {
  token: WatchlistToken | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const updateMut = useUpdateWatchlistToken();
  const [notes, setNotes] = useState("");
  const [threshold, setThreshold] = useState("10");
  const [enabled, setEnabled] = useState(true);

  // Sync local state when token changes
  useState(() => {
    if (token) {
      setNotes(token.notes ?? "");
      setThreshold(String(token.alertThresholdPct));
      setEnabled(token.enabled);
    }
  });

  if (!token) return null;

  function submit() {
    if (!token) return;
    updateMut.mutate(
      {
        id: token.id,
        patch: {
          notes: notes.trim() || null,
          alertThresholdPct: parseFloat(threshold) || 10,
          enabled,
        },
      },
      {
        onSuccess: () => {
          toast.success("Watchlist atualizado");
          onOpenChange(false);
        },
        onError: (e: Error) => toast.error(e.message),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:!max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Editar — {token.symbol}
          </DialogTitle>
          <DialogDescription>
            Ajuste notas, threshold de alerta, ou pause o monitoramento.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Notas</Label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Por que estou observando este token?"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Alerta ± %</Label>
            <Input
              type="number"
              step="0.5"
              min="0"
              max="100"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between rounded border border-border/60 p-3">
            <div>
              <Label className="text-sm">Monitoramento ativo</Label>
              <p className="text-xs text-muted-foreground">
                Se desligado, o engine não atualiza o preço nem dispara alertas.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={updateMut.isPending}>
            {updateMut.isPending && <RefreshCw className="h-4 w-4 animate-spin mr-2" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Single row
// ---------------------------------------------------------------------------
function WatchlistRow({
  token,
  onAnalyze,
  onEdit,
}: {
  token: WatchlistToken;
  onAnalyze: (t: WatchlistToken) => void;
  onEdit: (t: WatchlistToken) => void;
}) {
  const removeMut = useRemoveWatchlistToken();
  const toggleMut = useUpdateWatchlistToken();
  const resetMut = useResetWatchlistAlert();

  const changePct = token.changePct;
  const positive = (changePct ?? 0) >= 0;

  return (
    <tr
      className={`border-b border-border/40 hover:bg-muted/30 transition-colors ${
        !token.enabled ? "opacity-50" : ""
      }`}
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium">{token.symbol}</span>
          <Badge variant="outline" className="text-[10px] uppercase">
            {token.source}
          </Badge>
          {token.source === "dex" && token.chain && (
            <Badge variant="outline" className="text-[10px]">{token.chain}</Badge>
          )}
          {token.alertTriggered && token.enabled && (
            <Badge
              variant="outline"
              className="text-[10px] bg-orange-500/15 text-orange-400 border-orange-500/30 gap-1"
            >
              <AlertTriangle className="h-3 w-3" />
              ALERT
            </Badge>
          )}
        </div>
        {token.notes && (
          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
            {token.notes}
          </div>
        )}
        {token.source === "dex" && token.tokenId && (
          <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate max-w-[200px]">
            {token.tokenId}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-sm">
        {fmtPrice(token.addedPriceUsd)}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-sm">
        {fmtPrice(token.lastPriceUsd)}
      </td>
      <td
        className={`px-3 py-2.5 text-right font-mono text-sm font-medium ${
          changePct === null
            ? "text-muted-foreground"
            : positive
            ? "text-green-400"
            : "text-red-400"
        }`}
      >
        {changePct !== null && (positive ? (
          <ArrowUp className="h-3 w-3 inline mr-0.5" />
        ) : (
          <ArrowDown className="h-3 w-3 inline mr-0.5" />
        ))}
        {fmtPct(changePct)}
      </td>
      <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">
        ±{token.alertThresholdPct}%
      </td>
      <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">
        {timeAgo(token.lastCheckedAt)}
      </td>
      <td className="px-3 py-2.5 text-center">
        <Switch
          checked={token.enabled}
          onCheckedChange={(v) =>
            toggleMut.mutate(
              { id: token.id, patch: { enabled: v } },
              { onError: (e: Error) => toast.error(e.message) }
            )
          }
        />
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1">
          {token.alertTriggered && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() =>
                resetMut.mutate(token.id, {
                  onSuccess: () => toast.success("Baseline resetado"),
                  onError: (e: Error) => toast.error(e.message),
                })
              }
              title="Resetar baseline do alerta"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => onAnalyze(token)}
          >
            <Sparkles className="h-3 w-3" />
            Analisar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => onEdit(token)}
            title="Editar"
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-destructive hover:text-destructive"
            onClick={() => {
              if (confirm(`Remover ${token.symbol} da watchlist?`)) {
                removeMut.mutate(token.id, {
                  onSuccess: () => toast.success("Token removido"),
                  onError: (e: Error) => toast.error(e.message),
                });
              }
            }}
            title="Remover"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export function WatchlistPanel() {
  const { data: tokens, isLoading } = useWatchlist();
  const analyzeMut = useAnalyzeWatchlistToken();
  const [analyzeTarget, setAnalyzeTarget] = useState<WatchlistToken | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<WatchlistInsight | null>(null);
  const [analyzeDuration, setAnalyzeDuration] = useState<number | undefined>(undefined);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WatchlistToken | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  function onAnalyze(t: WatchlistToken) {
    setAnalyzeTarget(t);
    setAnalyzeResult(null);
    setAnalyzeDuration(undefined);
    setAnalyzeOpen(true);
    analyzeMut.mutate(t.id, {
      onSuccess: (r) => {
        setAnalyzeResult(r.insight);
        setAnalyzeDuration(r.durationMs);
        toast.success(
          `Análise de ${t.symbol}: ${r.insight.recommendation.toUpperCase()} (${r.insight.confidence}%)`
        );
      },
      onError: (e: Error) => {
        toast.error(e.message);
        setAnalyzeOpen(false);
      },
    });
  }

  function onEdit(t: WatchlistToken) {
    setEditTarget(t);
    setEditOpen(true);
  }

  const list = tokens ?? [];
  const enabledCount = list.filter((t) => t.enabled).length;
  const alertCount = list.filter((t) => t.alertTriggered && t.enabled).length;

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Eye className="h-3.5 w-3.5" />
              Tokens
            </div>
            <div className="text-2xl font-semibold mt-1">{list.length}</div>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Eye className="h-3.5 w-3.5" />
              Ativos
            </div>
            <div className="text-2xl font-semibold mt-1">{enabledCount}</div>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              Alertas
            </div>
            <div className="text-2xl font-semibold mt-1 text-orange-400">
              {alertCount}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Análises IA
            </div>
            <div className="text-2xl font-semibold mt-1">
              {list.filter((t) => t.lastCheckedAt).length}
            </div>
          </CardContent>
        </Card>
      </div>

      <AddWatchlistForm />

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Eye className="h-4 w-4 text-primary" />
            Tokens em observação
          </CardTitle>
          <CardDescription>
            Preço atualizado a cada loop do engine (~{`<loopIntervalSec>`}s). Threshold é medido contra o preço no momento em que o token foi adicionado (ou quando o baseline foi resetado).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              <Eye className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Nenhum token em observação. Adicione acima para começar.
            </div>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border/60">
                    <th className="px-3 py-2 text-left">Token</th>
                    <th className="px-3 py-2 text-right">Preço inicial</th>
                    <th className="px-3 py-2 text-right">Preço atual</th>
                    <th className="px-3 py-2 text-right">Variação</th>
                    <th className="px-3 py-2 text-center">Threshold</th>
                    <th className="px-3 py-2 text-center">Último check</th>
                    <th className="px-3 py-2 text-center">Ativo</th>
                    <th className="px-3 py-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((t) => (
                    <WatchlistRow
                      key={t.id}
                      token={t}
                      onAnalyze={onAnalyze}
                      onEdit={onEdit}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AnalysisDialog
        open={analyzeOpen}
        onOpenChange={setAnalyzeOpen}
        symbol={analyzeTarget?.symbol ?? ""}
        insight={analyzeResult}
        isLoading={analyzeMut.isPending}
        durationMs={analyzeDuration}
      />

      <EditDialog
        token={editTarget}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </div>
  );
}
