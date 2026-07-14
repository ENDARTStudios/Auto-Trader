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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Target,
  TrendingUp,
  Shield,
  Layers,
  Coins,
  Zap,
  Award,
  BookOpen,
  Crown,
  Wallet,
  Building2,
  Lock,
  Unlock,
  Trash2,
  Plus,
  Activity,
  PieChart,
  Flame,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface FeeStats {
  totalFeesUsd: number;
  totalSlippageUsd: number;
  totalCostUsd: number;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  avgCostPerTradeUsd: number;
  costAsPctOfVolume: number;
  totalVolumeUsd: number;
  byStrategy: Record<string, { count: number; costUsd: number }>;
  byExchange: Record<string, { count: number; costUsd: number }>;
}

interface RoundTripPreview {
  positionSizeUsd: number;
  costUsd: number;
  costPct: number;
  breakevenMovePct: number;
}

interface FeesData {
  stats: FeeStats;
  config: { feeBps: number; slippageBps: number; feePct: number; slippagePct: number };
  roundTripPreview: RoundTripPreview[];
}

interface RiskScaleBand {
  minWinRate: number;
  maxWinRate: number;
  multiplier: number;
  label: string;
  description: string;
}

interface RiskScaleAssessment {
  winRate: number;
  tradesClosed: number;
  band: RiskScaleBand;
  multiplier: number;
  applied: boolean;
  reason: string;
}

interface DiversificationSnapshot {
  totalOpen: number;
  bySymbol: Record<string, number>;
  byChain: Record<string, number>;
  byStrategy: Record<string, number>;
  uniqueSymbols: number;
  uniqueChains: number;
  uniqueStrategies: number;
  diversityScore: number;
}

interface StrategicCapability {
  id: string;
  category: "execution" | "strategy" | "risk" | "security" | "ops";
  title: string;
  description: string;
  status: "planned" | "in_progress" | "shipped" | "blocked";
  completionPct: number;
  notes: string | null;
  sortOrder: number;
  updatedAt: string;
}

interface RoadmapStats {
  total: number;
  shipped: number;
  inProgress: number;
  planned: number;
  blocked: number;
  avgCompletion: number;
  byCategory: Record<string, { total: number; shipped: number; avgCompletion: number }>;
}

interface WalletRow {
  id: string;
  label: string;
  type: string;
  address: string;
  chain: string | null;
  isActive: boolean;
  readOnly: boolean;
  hasPrivateKey: boolean;
  publicKey: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface ExchangeRow {
  id: string;
  label: string;
  exchange: string;
  apiKeyPrefix: string | null;
  permissions: { read: boolean; trade: boolean; withdraw: boolean } | null;
  isActive: boolean;
  testnet: boolean;
  ipWhitelistConfigured: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

interface VaultStatus {
  unlocked: boolean;
  walletCount: number;
  exchangeCount: number;
  unlockTime: string | null;
  lastKeyAccessAt: string | null;
  autoLockInSec: number | null;
  cooldownUntil: string | null;
  recentFailures: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtUsd(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n: number, decimals = 2): string {
  return `${n.toFixed(decimals)}%`;
}

const STATUS_COLORS: Record<string, string> = {
  shipped: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  in_progress: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  planned: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400 border-zinc-500/30",
  blocked: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  shipped: "Shipped",
  in_progress: "Em progresso",
  planned: "Planejado",
  blocked: "Bloqueado",
};

const CATEGORY_LABELS: Record<string, string> = {
  execution: "Execução",
  strategy: "Estratégia",
  risk: "Risco",
  security: "Segurança",
  ops: "Operação",
};

const CATEGORY_ICONS: Record<string, typeof Target> = {
  execution: Zap,
  strategy: Target,
  risk: Shield,
  security: Lock,
  ops: Activity,
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export function StrategicPanel() {
  return (
    <Tabs defaultValue="roadmap">
      <TabsList>
        <TabsTrigger value="roadmap" className="gap-1">
          <Target className="size-3.5" /> Roadmap
        </TabsTrigger>
        <TabsTrigger value="fees" className="gap-1">
          <Coins className="size-3.5" /> Taxas
        </TabsTrigger>
        <TabsTrigger value="risk" className="gap-1">
          <TrendingUp className="size-3.5" /> Risk Scale
        </TabsTrigger>
        <TabsTrigger value="diversification" className="gap-1">
          <PieChart className="size-3.5" /> Diversificação
        </TabsTrigger>
        <TabsTrigger value="wallets" className="gap-1">
          <Wallet className="size-3.5" /> Carteiras
        </TabsTrigger>
        <TabsTrigger value="exchanges" className="gap-1">
          <Building2 className="size-3.5" /> Exchanges
        </TabsTrigger>
      </TabsList>

      <TabsContent value="roadmap" className="space-y-4">
        <RoadmapPanel />
      </TabsContent>
      <TabsContent value="fees" className="space-y-4">
        <FeesPanel />
      </TabsContent>
      <TabsContent value="risk" className="space-y-4">
        <RiskScalePanel />
      </TabsContent>
      <TabsContent value="diversification" className="space-y-4">
        <DiversificationPanel />
      </TabsContent>
      <TabsContent value="wallets" className="space-y-4">
        <WalletsPanel />
      </TabsContent>
      <TabsContent value="exchanges" className="space-y-4">
        <ExchangesPanel />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// 1. Roadmap Panel — operator's vision progress board
// ---------------------------------------------------------------------------
function useRoadmap() {
  return useQuery({
    queryKey: ["roadmap"],
    queryFn: async () => {
      const r = await fetch("/api/roadmap");
      if (!r.ok) throw new Error("Failed to fetch roadmap");
      return r.json() as Promise<{ capabilities: StrategicCapability[]; stats: RoadmapStats }>;
    },
    refetchInterval: 30_000,
  });
}

function RoadmapPanel() {
  const { data, isLoading } = useRoadmap();

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="size-5" /> Roadmap Estratégico
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const { capabilities, stats } = data;

  // Group by category
  const byCategory = new Map<string, StrategicCapability[]>();
  for (const cap of capabilities) {
    if (!byCategory.has(cap.category)) byCategory.set(cap.category, []);
    byCategory.get(cap.category)!.push(cap);
  }

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="size-5" /> Visão Estratégica do Bot
          </CardTitle>
          <CardDescription>
            15 capacidades que definem o bot como analista sênior + mestre em
            Day/Scalp/Swing trading + automação + segurança máxima.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="text-center">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-600">{stats.shipped}</div>
              <div className="text-xs text-muted-foreground">Shipped</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.inProgress}</div>
              <div className="text-xs text-muted-foreground">Em progresso</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-zinc-600">{stats.planned}</div>
              <div className="text-xs text-muted-foreground">Planejado</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{stats.avgCompletion.toFixed(0)}%</div>
              <div className="text-xs text-muted-foreground">Avg completion</div>
            </div>
          </div>
          <Progress value={stats.avgCompletion} className="mt-4" />
        </CardContent>
      </Card>

      {/* Capabilities by category */}
      {Array.from(byCategory.entries()).map(([cat, caps]) => {
        const Icon = CATEGORY_ICONS[cat] ?? Target;
        const catStats = stats.byCategory[cat];
        return (
          <Card key={cat}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Icon className="size-4" /> {CATEGORY_LABELS[cat] ?? cat}
                {catStats && (
                  <Badge variant="outline" className="ml-auto">
                    {catStats.shipped}/{catStats.total} shipped · {catStats.avgCompletion.toFixed(0)}%
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {caps.map((cap) => (
                <CapabilityRow key={cap.id} cap={cap} />
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function CapabilityRow({ cap }: { cap: StrategicCapability }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(cap.notes ?? "");
  const [status, setStatus] = useState(cap.status);
  const [completion, setCompletion] = useState(cap.completionPct);

  const update = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/roadmap/${cap.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, completionPct: completion, notes }),
      });
      if (!r.ok) throw new Error("update failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success(`${cap.title} atualizado`);
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["roadmap"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{cap.title}</span>
            <Badge className={STATUS_COLORS[cap.status]} variant="outline">
              {STATUS_LABELS[cap.status]}
            </Badge>
            <Badge variant="outline">{cap.completionPct}%</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{cap.description}</p>
          {cap.notes && !editing && (
            <p className="text-xs text-muted-foreground mt-1 italic">📝 {cap.notes}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setEditing(!editing);
            setNotes(cap.notes ?? "");
            setStatus(cap.status);
            setCompletion(cap.completionPct);
          }}
        >
          {editing ? "Cancelar" : "Editar"}
        </Button>
      </div>
      {editing && (
        <div className="space-y-2 border-t pt-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as StrategicCapability["status"])}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Planejado</SelectItem>
                  <SelectItem value="in_progress">Em progresso</SelectItem>
                  <SelectItem value="shipped">Shipped</SelectItem>
                  <SelectItem value="blocked">Bloqueado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Completion (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={completion}
                onChange={(e) => setCompletion(parseInt(e.target.value || "0", 10))}
                className="h-8"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notas</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="text-xs"
            />
          </div>
          <Button size="sm" onClick={() => update.mutate()} disabled={update.isPending}>
            Salvar
          </Button>
        </div>
      )}
      <Progress value={cap.completionPct} className="h-1.5" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Fees Panel — fee + slippage breakdown
// ---------------------------------------------------------------------------
function useFees(days = 7) {
  return useQuery({
    queryKey: ["fees", days],
    queryFn: async () => {
      const r = await fetch(`/api/fees?days=${days}`);
      if (!r.ok) throw new Error("Failed to fetch fees");
      return r.json() as Promise<FeesData>;
    },
    refetchInterval: 30_000,
  });
}

function FeesPanel() {
  const { data, isLoading } = useFees(7);

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="size-5" /> Fee-Aware Execution
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const { stats, config, roundTripPreview } = data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="size-5" /> Fee-Aware Execution
          </CardTitle>
          <CardDescription>
            Cada trade paga fee + slippage em ambos os lados. Engine só abre
            posições se o TP cobrir o custo round-trip com margem 3x.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Taxa configurada</div>
              <div className="text-lg font-semibold">{config.feePct.toFixed(3)}%</div>
              <div className="text-xs text-muted-foreground">{config.feeBps} bps/side</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Slippage assumido</div>
              <div className="text-lg font-semibold">{config.slippagePct.toFixed(3)}%</div>
              <div className="text-xs text-muted-foreground">{config.slippageBps} bps/side</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Custo round-trip</div>
              <div className="text-lg font-semibold">
                {((config.feeBps + config.slippageBps) * 2 / 100).toFixed(3)}%
              </div>
              <div className="text-xs text-muted-foreground">buy + sell</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Trades (7d)</div>
              <div className="text-lg font-semibold">{stats.tradeCount}</div>
              <div className="text-xs text-muted-foreground">{stats.buyCount}B / {stats.sellCount}S</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4" /> Custo Acumulado (7 dias)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Total fees</div>
              <div className="text-lg font-semibold text-orange-600">
                {fmtUsd(stats.totalFeesUsd)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Total slippage</div>
              <div className="text-lg font-semibold text-orange-600">
                {fmtUsd(stats.totalSlippageUsd)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Custo total</div>
              <div className="text-lg font-semibold text-red-600">
                {fmtUsd(stats.totalCostUsd)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">% do volume</div>
              <div className="text-lg font-semibold">
                {fmtPct(stats.costAsPctOfVolume, 3)}
              </div>
            </div>
          </div>
          <div className="mt-4 text-sm">
            <span className="text-muted-foreground">Volume total (7d): </span>
            <span className="font-semibold">{fmtUsd(stats.totalVolumeUsd)}</span>
            <span className="text-muted-foreground"> · Custo médio/trade: </span>
            <span className="font-semibold">{fmtUsd(stats.avgCostPerTradeUsd)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="size-4" /> Round-Trip Cost Preview
          </CardTitle>
          <CardDescription>
            Quanto custa abrir E fechar uma posição de cada tamanho. O trade
            precisa mover &gt; breakeven para ser lucrativo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2">Position size</th>
                  <th className="py-2">Custo round-trip (USD)</th>
                  <th className="py-2">Custo (%)</th>
                  <th className="py-2">Breakeven move</th>
                </tr>
              </thead>
              <tbody>
                {roundTripPreview.map((r) => (
                  <tr key={r.positionSizeUsd} className="border-b">
                    <td className="py-2 font-mono">{fmtUsd(r.positionSizeUsd)}</td>
                    <td className="py-2 font-mono text-red-600">{fmtUsd(r.costUsd, 4)}</td>
                    <td className="py-2 font-mono">{fmtPct(r.costPct, 3)}</td>
                    <td className="py-2 font-mono">
                      <span className="text-orange-600">+{fmtPct(r.breakevenMovePct, 3)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {Object.keys(stats.byStrategy).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Custo por Estratégia</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(stats.byStrategy).map(([strat, s]) => (
                <div key={strat} className="flex justify-between text-sm border-b pb-1">
                  <span className="capitalize">{strat}</span>
                  <span>
                    <Badge variant="outline" className="mr-2">{s.count} trades</Badge>
                    <span className="font-mono text-red-600">{fmtUsd(s.costUsd, 4)}</span>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Risk Scale Panel — win-rate-based position sizing
// ---------------------------------------------------------------------------
function useRiskScale() {
  return useQuery({
    queryKey: ["risk-scale"],
    queryFn: async () => {
      const r = await fetch("/api/risk-scale");
      if (!r.ok) throw new Error("Failed to fetch risk scale");
      return r.json() as Promise<{ assessment: RiskScaleAssessment; bands: RiskScaleBand[] }>;
    },
    refetchInterval: 30_000,
  });
}

function RiskScalePanel() {
  const { data, isLoading } = useRiskScale();

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="size-5" /> Risk Scaling
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const { assessment, bands } = data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="size-5" /> Escalar conforme Taxa de Sucesso
          </CardTitle>
          <CardDescription>
            Posições escalam dinamicamente: engine vencedora → 1.5x; engine perdedora → 0.5x.
            Anti-martingale: aumenta quando ganha, diminui quando perde.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Win rate atual</div>
              <div className="text-2xl font-bold">{fmtPct(assessment.winRate, 1)}</div>
              <div className="text-xs text-muted-foreground">{assessment.tradesClosed} trades fechados</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Multiplicador</div>
              <div className="text-2xl font-bold text-blue-600">{assessment.multiplier}x</div>
              <div className="text-xs text-muted-foreground">aplicado ao per-token</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Banda atual</div>
              <div className="text-lg font-semibold">{assessment.band.label}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <div className="text-lg font-semibold">
                {assessment.applied ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700">Ativo</Badge>
                ) : (
                  <Badge variant="outline">Inativo</Badge>
                )}
              </div>
            </div>
          </div>
          <Alert className="mt-4">
            <Flame className="size-4" />
            <AlertDescription>{assessment.reason}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bandas de Risk Scaling</CardTitle>
          <CardDescription>
            5 bandas baseadas em win rate. Cada banda ajusta o tamanho da posição.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {bands.map((b) => {
              const isCurrent = assessment.band.label === b.label;
              return (
                <div
                  key={b.label}
                  className={`border rounded-lg p-3 ${
                    isCurrent ? "border-blue-500 bg-blue-500/5" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {b.multiplier >= 1 ? (
                        <ArrowUpRight className="size-4 text-emerald-600" />
                      ) : (
                        <ArrowDownRight className="size-4 text-orange-600" />
                      )}
                      <span className="font-medium">{b.label}</span>
                      {isCurrent && <Badge className="bg-blue-500/15 text-blue-700">atual</Badge>}
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">
                        {fmtPct(b.minWinRate, 0)}-{fmtPct(b.maxWinRate, 0)} WR
                      </Badge>
                      <span className="font-mono font-bold">{b.multiplier}x</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{b.description}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Diversification Panel
// ---------------------------------------------------------------------------
function useDiversification() {
  return useQuery({
    queryKey: ["diversification"],
    queryFn: async () => {
      const r = await fetch("/api/diversification");
      if (!r.ok) throw new Error("Failed to fetch diversification");
      return r.json() as Promise<{
        snapshot: DiversificationSnapshot;
        caps: {
          maxPositionsPerSymbol: number;
          maxPositionsPerChain: number;
          maxPositionsPerStrategy: number;
          maxPositionsPerRound: number;
        };
        enabledStrategies: string[];
      }>;
    },
    refetchInterval: 15_000,
  });
}

function DiversificationPanel() {
  const { data, isLoading } = useDiversification();

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="size-5" /> Diversificação
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const { snapshot: s, caps, enabledStrategies } = data;
  const diversityColor =
    s.diversityScore >= 70 ? "text-emerald-600"
    : s.diversityScore >= 40 ? "text-orange-600"
    : "text-red-600";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="size-5" /> Diversificação entre Operações Ativas
          </CardTitle>
          <CardDescription>
            Caps por símbolo, chain e strategy. Engine automaticamente balanceia
            o mix escolhendo a strategy com menos posições abertas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Posições abertas</div>
              <div className="text-2xl font-bold">{s.totalOpen}</div>
              <div className="text-xs text-muted-foreground">/ {caps.maxPositionsPerRound} max</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Símbolos únicos</div>
              <div className="text-2xl font-bold">{s.uniqueSymbols}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Chains únicos</div>
              <div className="text-2xl font-bold">{s.uniqueChains}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Strategies únicos</div>
              <div className="text-2xl font-bold">{s.uniqueStrategies}</div>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Diversity score</span>
              <span className={`font-bold ${diversityColor}`}>{s.diversityScore.toFixed(0)}/100</span>
            </div>
            <Progress value={s.diversityScore} className="h-2" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Por Símbolo (cap: {caps.maxPositionsPerSymbol})</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(s.bySymbol).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma posição aberta</p>
            ) : (
              <div className="space-y-1">
                {Object.entries(s.bySymbol).map(([sym, count]) => (
                  <div key={sym} className="flex justify-between text-sm">
                    <span className="font-mono">{sym}</span>
                    <Badge variant={count >= caps.maxPositionsPerSymbol ? "destructive" : "outline"}>
                      {count}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Por Chain (cap: {caps.maxPositionsPerChain})</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(s.byChain).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma posição aberta</p>
            ) : (
              <div className="space-y-1">
                {Object.entries(s.byChain).map(([ch, count]) => (
                  <div key={ch} className="flex justify-between text-sm">
                    <span className="font-mono">{ch}</span>
                    <Badge variant={count >= caps.maxPositionsPerChain ? "destructive" : "outline"}>
                      {count}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Por Strategy (cap: {caps.maxPositionsPerStrategy})</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(s.byStrategy).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma posição aberta</p>
            ) : (
              <div className="space-y-1">
                {Object.entries(s.byStrategy).map(([st, count]) => (
                  <div key={st} className="flex justify-between text-sm">
                    <span className="capitalize">{st}</span>
                    <Badge variant={count >= caps.maxPositionsPerStrategy ? "destructive" : "outline"}>
                      {count}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Strategies Habilitados</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            {enabledStrategies.map((s) => (
              <Badge key={s} variant="outline" className="capitalize">{s}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Wallets Panel
// ---------------------------------------------------------------------------
function useWallets() {
  return useQuery({
    queryKey: ["wallets"],
    queryFn: async () => {
      const r = await fetch("/api/wallets");
      if (!r.ok) throw new Error("Failed to fetch wallets");
      return r.json() as Promise<{ wallets: WalletRow[]; vaultStatus: VaultStatus }>;
    },
    refetchInterval: 15_000,
  });
}

function useVaultUnlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (passphrase: string) => {
      const r = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlock", passphrase }),
      });
      const json = await r.json();
      if (!r.ok) {
        // Distinguish rate-limit (429) from wrong passphrase (401) for toast messaging.
        if (r.status === 429) {
          throw new Error(`🛑 Rate limited: ${json.error}`);
        }
        throw new Error(json.error || "unlock failed");
      }
      return json;
    },
    onSuccess: (data) => {
      toast.success(
        `Vault desbloqueado — ${data.loaded.wallets} carteira(s) + ${data.loaded.exchanges} exchange(s) carregadas`
      );
      qc.invalidateQueries({ queryKey: ["wallets"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });
}

function useVaultLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lock" }),
      });
      if (!r.ok) throw new Error("lock failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Vault bloqueado — chaves limpas da memória");
      qc.invalidateQueries({ queryKey: ["wallets"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });
}

function VaultControlCard({ vaultStatus }: { vaultStatus: VaultStatus }) {
  const [passphrase, setPassphrase] = useState("");
  const [showPass, setShowPass] = useState(false);
  const unlockMut = useVaultUnlock();
  const lockMut = useVaultLock();

  const cooldownActive =
    vaultStatus.cooldownUntil && new Date(vaultStatus.cooldownUntil) > new Date();
  const autoLockMins =
    vaultStatus.autoLockInSec !== null
      ? Math.floor(vaultStatus.autoLockInSec / 60)
      : null;
  const autoLockSecs =
    vaultStatus.autoLockInSec !== null ? vaultStatus.autoLockInSec % 60 : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {vaultStatus.unlocked ? (
            <Unlock className="size-5 text-emerald-600" />
          ) : (
            <Lock className="size-5" />
          )}
          Vault de Credenciais
        </CardTitle>
        <CardDescription>
          v17: AES-256-GCM + PBKDF2 (600k iters). Passphrase nunca persistida —
          só em memória. Auto-lock após 30min idle. Rate limit: 5 falhas/60s →
          5min cooldown.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Status banner */}
        <Alert
          className={
            vaultStatus.unlocked
              ? "border-emerald-500/30 bg-emerald-500/5"
              : cooldownActive
                ? "border-red-500/30 bg-red-500/5"
                : ""
          }
        >
          {vaultStatus.unlocked ? (
            <Unlock className="size-4 text-emerald-600" />
          ) : (
            <Lock className="size-4" />
          )}
          <AlertTitle className="text-sm">
            Vault: {vaultStatus.unlocked ? "Desbloqueado" : cooldownActive ? "Rate-limited" : "Bloqueado"}
          </AlertTitle>
          <AlertDescription className="text-xs space-y-1">
            {vaultStatus.unlocked ? (
              <>
                <div>
                  {vaultStatus.walletCount} carteira(s) + {vaultStatus.exchangeCount} exchange(s) carregadas em memória.
                </div>
                <div>
                  Desbloqueado às:{" "}
                  <span className="font-mono">
                    {vaultStatus.unlockTime ? new Date(vaultStatus.unlockTime).toLocaleTimeString("pt-BR") : "-"}
                  </span>
                </div>
                {vaultStatus.lastKeyAccessAt && (
                  <div>
                    Último acesso a chave:{" "}
                    <span className="font-mono">
                      {new Date(vaultStatus.lastKeyAccessAt).toLocaleTimeString("pt-BR")}
                    </span>
                  </div>
                )}
                {autoLockMins !== null && autoLockSecs !== null && (
                  <div className="text-amber-700 dark:text-amber-400 font-medium">
                    Auto-lock em {autoLockMins}:{autoLockSecs.toString().padStart(2, "0")}
                  </div>
                )}
              </>
            ) : cooldownActive ? (
              <>
                <div className="text-red-700 dark:text-red-400 font-medium">
                  🛑 Muitas tentativas falhas. Cooldown ativo até{" "}
                  {new Date(vaultStatus.cooldownUntil!).toLocaleTimeString("pt-BR")}.
                </div>
                <div>Falhas recentes: {vaultStatus.recentFailures}/5</div>
              </>
            ) : (
              <>
                <div>Nenhuma chave carregada. Live trading indisponível até desbloquear.</div>
                {vaultStatus.recentFailures > 0 && (
                  <div className="text-amber-700 dark:text-amber-400">
                    ⚠️ {vaultStatus.recentFailures}/5 tentativas falhas recentes
                  </div>
                )}
              </>
            )}
          </AlertDescription>
        </Alert>

        {/* Unlock form OR lock button */}
        {vaultStatus.unlocked ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => lockMut.mutate()}
            disabled={lockMut.isPending}
          >
            <Lock className="size-3.5" /> Bloquear vault agora
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type={showPass ? "text" : "password"}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Passphrase do vault"
                className="font-mono"
                disabled={!!cooldownActive}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && passphrase && !cooldownActive) {
                    unlockMut.mutate(passphrase);
                    setPassphrase("");
                  }
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPass(!showPass)}
                type="button"
              >
                {showPass ? "🙈" : "👁"}
              </Button>
            </div>
            <Button
              className="w-full"
              onClick={() => {
                unlockMut.mutate(passphrase);
                setPassphrase("");
              }}
              disabled={unlockMut.isPending || !passphrase || !!cooldownActive}
            >
              <Unlock className="size-3.5" /> Desbloquear vault
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              A passphrase decripta todas as chaves AES-256-GCM em memória. Nunca
              armazenada. Será pedida novamente após restart.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WalletsPanel() {
  const { data, isLoading } = useWallets();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    label: "",
    type: "evm",
    address: "",
    chain: "",
    readOnly: false,
    publicKey: "",
    privateKey: "",
    passphrase: "",
  });

  const create = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          chain: form.chain || undefined,
          publicKey: form.publicKey || undefined,
          privateKey: form.privateKey || undefined,
          passphrase: form.passphrase || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "create failed");
      }
      return r.json();
    },
    onSuccess: () => {
      toast.success("Carteira criada");
      setShowForm(false);
      setForm({ label: "", type: "evm", address: "", chain: "", readOnly: false, publicKey: "", privateKey: "", passphrase: "" });
      qc.invalidateQueries({ queryKey: ["wallets"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  const activate = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const r = await fetch(`/api/wallets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!r.ok) throw new Error("activate failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Carteira atualizada");
      qc.invalidateQueries({ queryKey: ["wallets"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/wallets/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("delete failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Carteira removida");
      qc.invalidateQueries({ queryKey: ["wallets"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-5" /> Carteiras
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const { wallets, vaultStatus } = data;

  return (
    <div className="space-y-4">
      <VaultControlCard vaultStatus={vaultStatus} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="size-5" /> Conexão de Carteira Digital
          </CardTitle>
          <CardDescription>
            Carteiras para live trading. Chaves privadas AES-256-GCM encrypted
            com passphrase nunca persistida. Multi-sig/hardware suportados.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Carteiras Conectadas</CardTitle>
            <Button size="sm" onClick={() => setShowForm(!showForm)}>
              <Plus className="size-3.5" /> Nova carteira
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {showForm && (
            <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Label</Label>
                  <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="h-8" placeholder="Main Trading Wallet" />
                </div>
                <div>
                  <Label className="text-xs">Tipo</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="evm">EVM (Ethereum/L2s)</SelectItem>
                      <SelectItem value="solana">Solana</SelectItem>
                      <SelectItem value="hardware">Hardware (Ledger/Trezor)</SelectItem>
                      <SelectItem value="multisig">Multi-sig (Safe)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Endereço (público)</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="h-8 font-mono" placeholder="0x..." />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Chain (opcional)</Label>
                  <Input value={form.chain} onChange={(e) => setForm({ ...form, chain: e.target.value })} className="h-8" placeholder="base / arbitrum / optimism" />
                </div>
                <div>
                  <Label className="text-xs">Public key (opcional)</Label>
                  <Input value={form.publicKey} onChange={(e) => setForm({ ...form, publicKey: e.target.value })} className="h-8 font-mono" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.readOnly} onCheckedChange={(v) => setForm({ ...form, readOnly: v })} />
                <Label className="text-xs">Read-only (watch wallet — sem signing)</Label>
              </div>
              {form.type !== "hardware" && form.type !== "multisig" && !form.readOnly && (
                <>
                  <div>
                    <Label className="text-xs">Private key (será encriptado — nunca armazenado em plaintext)</Label>
                    <Input type="password" value={form.privateKey} onChange={(e) => setForm({ ...form, privateKey: e.target.value })} className="h-8 font-mono" />
                  </div>
                  <div>
                    <Label className="text-xs">Passphrase (para encriptar — NUNCA persistida)</Label>
                    <Input type="password" value={form.passphrase} onChange={(e) => setForm({ ...form, passphrase: e.target.value })} className="h-8" />
                  </div>
                </>
              )}
              <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending || !form.label || !form.address}>
                Salvar carteira
              </Button>
            </div>
          )}

          {wallets.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhuma carteira conectada. Clique em "Nova carteira" para adicionar.
            </p>
          ) : (
            wallets.map((w) => (
              <div key={w.id} className="border rounded-lg p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{w.label}</span>
                    <Badge variant="outline">{w.type}</Badge>
                    {w.isActive && <Badge className="bg-emerald-500/15 text-emerald-700">ativa</Badge>}
                    {w.readOnly && <Badge variant="outline">read-only</Badge>}
                    {w.hasPrivateKey && <Badge variant="outline">🔑 encrypted</Badge>}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant={w.isActive ? "outline" : "default"}
                      onClick={() => activate.mutate({ id: w.id, active: !w.isActive })}
                    >
                      {w.isActive ? "Desativar" : "Ativar"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => del.mutate(w.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  {w.address.slice(0, 10)}...{w.address.slice(-8)}
                  {w.chain && <Badge variant="outline" className="ml-2">{w.chain}</Badge>}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Exchanges Panel
// ---------------------------------------------------------------------------
function useExchanges() {
  return useQuery({
    queryKey: ["exchanges"],
    queryFn: async () => {
      const r = await fetch("/api/exchanges");
      if (!r.ok) throw new Error("Failed to fetch exchanges");
      return r.json() as Promise<{ exchanges: ExchangeRow[] }>;
    },
    refetchInterval: 15_000,
  });
}

function ExchangesPanel() {
  const { data, isLoading } = useExchanges();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    label: "",
    exchange: "binance",
    apiKey: "",
    apiSecret: "",
    apiPassphrase: "",
    passphrase: "",
    testnet: false,
    ipWhitelistConfigured: false,
  });

  const create = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/exchanges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          apiPassphrase: form.apiPassphrase || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "create failed");
      }
      return r.json();
    },
    onSuccess: () => {
      toast.success("Exchange criada");
      setShowForm(false);
      setForm({ label: "", exchange: "binance", apiKey: "", apiSecret: "", apiPassphrase: "", passphrase: "", testnet: false, ipWhitelistConfigured: false });
      qc.invalidateQueries({ queryKey: ["exchanges"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  const activate = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const r = await fetch(`/api/exchanges/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!r.ok) throw new Error("activate failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Exchange atualizada");
      qc.invalidateQueries({ queryKey: ["exchanges"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/exchanges/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("delete failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Exchange removida");
      qc.invalidateQueries({ queryKey: ["exchanges"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-5" /> Exchanges
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-5" /> Conexão com Exchanges
          </CardTitle>
          <CardDescription>
            API keys para CEX trading. AES-256-GCM encrypted, NO withdraw
            permission enforced, IP whitelist strongly recommended.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert className="border-orange-500/30 bg-orange-500/5">
            <Shield className="size-4" />
            <AlertTitle className="text-sm">Segurança de API keys</AlertTitle>
            <AlertDescription className="text-xs">
              Crie API keys com permissão <strong>read + trade apenas</strong>.
              NUNCA ative permissão de withdraw. Configure IP whitelist no painel
              da exchange para o IP deste servidor. Use testnet primeiro.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Exchanges Conectadas</CardTitle>
            <Button size="sm" onClick={() => setShowForm(!showForm)}>
              <Plus className="size-3.5" /> Nova exchange
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {showForm && (
            <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Label</Label>
                  <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="h-8" placeholder="Binance Testnet" />
                </div>
                <div>
                  <Label className="text-xs">Exchange</Label>
                  <Select value={form.exchange} onValueChange={(v) => setForm({ ...form, exchange: v })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="binance">Binance</SelectItem>
                      <SelectItem value="kraken">Kraken</SelectItem>
                      <SelectItem value="bybit">Bybit</SelectItem>
                      <SelectItem value="okx">OKX</SelectItem>
                      <SelectItem value="coinbase_adv">Coinbase Advanced Trade</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">API Key</Label>
                <Input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className="h-8 font-mono" />
              </div>
              <div>
                <Label className="text-xs">API Secret</Label>
                <Input type="password" value={form.apiSecret} onChange={(e) => setForm({ ...form, apiSecret: e.target.value })} className="h-8 font-mono" />
              </div>
              <div>
                <Label className="text-xs">Passphrase (apenas OKX / Bybit)</Label>
                <Input type="password" value={form.apiPassphrase} onChange={(e) => setForm({ ...form, apiPassphrase: e.target.value })} className="h-8 font-mono" />
              </div>
              <div>
                <Label className="text-xs">Passphrase de criptografia (NUNCA persistida)</Label>
                <Input type="password" value={form.passphrase} onChange={(e) => setForm({ ...form, passphrase: e.target.value })} className="h-8" />
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch checked={form.testnet} onCheckedChange={(v) => setForm({ ...form, testnet: v })} />
                  <Label className="text-xs">Testnet</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={form.ipWhitelistConfigured} onCheckedChange={(v) => setForm({ ...form, ipWhitelistConfigured: v })} />
                  <Label className="text-xs">IP whitelist configurada</Label>
                </div>
              </div>
              <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending || !form.label || !form.apiKey || !form.apiSecret || !form.passphrase}>
                Salvar exchange
              </Button>
            </div>
          )}

          {data.exchanges.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhuma exchange conectada. Clique em "Nova exchange" para adicionar.
            </p>
          ) : (
            data.exchanges.map((ex) => (
              <div key={ex.id} className="border rounded-lg p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{ex.label}</span>
                    <Badge variant="outline" className="capitalize">{ex.exchange}</Badge>
                    {ex.isActive && <Badge className="bg-emerald-500/15 text-emerald-700">ativa</Badge>}
                    {ex.testnet && <Badge variant="outline" className="bg-orange-500/10">testnet</Badge>}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant={ex.isActive ? "outline" : "default"}
                      onClick={() => activate.mutate({ id: ex.id, active: !ex.isActive })}
                    >
                      {ex.isActive ? "Desativar" : "Ativar"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => del.mutate(ex.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">API key: {ex.apiKeyPrefix ?? "***"}</span>
                  {ex.permissions && (
                    <span className="ml-2">
                      perms: 
                      {ex.permissions.read && <Badge variant="outline" className="ml-1 text-emerald-700">read</Badge>}
                      {ex.permissions.trade && <Badge variant="outline" className="ml-1 text-blue-700">trade</Badge>}
                      {ex.permissions.withdraw && <Badge variant="destructive" className="ml-1">⚠ withdraw</Badge>}
                    </span>
                  )}
                  {!ex.ipWhitelistConfigured && (
                    <Badge variant="outline" className="ml-2 text-orange-700">⚠ sem IP whitelist</Badge>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
