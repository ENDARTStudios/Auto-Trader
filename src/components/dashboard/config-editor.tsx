"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Settings, Save, AlertTriangle } from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import type { EngineConfig } from "@/hooks/use-trading-data";

interface Props {
  config?: EngineConfig;
  isLoading: boolean;
}

export function ConfigEditor({ config, isLoading }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Partial<EngineConfig>>({});
  const [cexSymbolsText, setCexSymbolsText] = useState("");
  const [dexChainsText, setDexChainsText] = useState("");

  // Sync form when config loads — setState in effect is intentional (form hydration)
  useEffect(() => {
    if (config) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(config);
      setCexSymbolsText(config.cexSymbols.join(", "));
      setDexChainsText(config.dexChains.join(", "));
    }
  }, [config]);

  const save = useMutation({
    mutationFn: async (patch: Partial<EngineConfig>) => {
      const r = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "save failed");
      }
      return r.json();
    },
    onSuccess: () => {
      toast.success("Config salva");
      qc.invalidateQueries({ queryKey: ["config"] });
      qc.invalidateQueries({ queryKey: ["engine-status"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  if (isLoading || !config) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="size-5" />
            Configuração da Engine
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const set = <K extends keyof EngineConfig>(key: K, value: EngineConfig[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleSave = () => {
    const patch: Partial<EngineConfig> = { ...form };
    // Parse comma-separated text fields
    patch.cexSymbols = cexSymbolsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    patch.dexChains = dexChainsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    delete patch.engineRunning;
    delete patch.killSwitchActive;
    delete patch.killSwitchReason;
    delete patch.killSwitchAt;
    delete patch.paperCyclesPassed;
    delete patch.graduatedToLive;
    save.mutate(patch);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <Settings className="size-5" />
            Configuração da Engine
          </span>
          <Button onClick={handleSave} disabled={save.isPending} className="gap-1" size="sm">
            <Save className="size-4" />
            Salvar
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {config.mode === "live" && !config.graduatedToLive && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Live mode bloqueado</AlertTitle>
            <AlertDescription>
              Live mode requer {config.paperCyclesRequired} ciclos paper lucrativos.
              Atualmente: {config.paperCyclesPassed}. Volte para paper mode para continuar
              acumulando ciclos.
            </AlertDescription>
          </Alert>
        )}

        {/* Mode */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Modo de operação</Label>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.mode === "live"}
                onCheckedChange={(checked) =>
                  set("mode", checked ? "live" : "paper")
                }
                disabled={!config.graduatedToLive && form.mode === "paper"}
              />
              <Badge variant={form.mode === "live" ? "destructive" : "secondary"}>
                {form.mode?.toUpperCase()}
              </Badge>
              {!config.graduatedToLive && (
                <span className="text-xs text-muted-foreground">
                  (requer graduação)
                </span>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="loopInterval">Intervalo do loop (segundos)</Label>
            <Input
              id="loopInterval"
              type="number"
              min={5}
              value={form.loopIntervalSec ?? ""}
              onChange={(e) => set("loopIntervalSec", parseInt(e.target.value) || 60)}
            />
          </div>
        </div>

        {/* Capital allocation */}
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
            Alocação de Capital
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="initialCapital">Capital inicial (USD)</Label>
              <Input
                id="initialCapital"
                type="number"
                step="0.01"
                value={form.initialCapitalUsd ?? ""}
                onChange={(e) =>
                  set("initialCapitalUsd", parseFloat(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxPositions">Máx. posições/round</Label>
              <Input
                id="maxPositions"
                type="number"
                min={1}
                max={50}
                value={form.maxPositionsPerRound ?? ""}
                onChange={(e) =>
                  set("maxPositionsPerRound", parseInt(e.target.value) || 10)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="capitalPct">% capital por round</Label>
              <Input
                id="capitalPct"
                type="number"
                step="0.1"
                min={1}
                max={100}
                value={form.capitalPctPerRound ?? ""}
                onChange={(e) =>
                  set("capitalPctPerRound", parseFloat(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reservePct">% lucro → reserva</Label>
              <Input
                id="reservePct"
                type="number"
                step="0.1"
                min={0}
                max={100}
                value={form.reservePct ?? ""}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 0;
                  set("reservePct", v);
                  set("reinvestPct", 100 - v);
                }}
              />
            </div>
          </div>
        </div>

        {/* Exit rules */}
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
            Regras de Saída
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tp">Take Profit (%)</Label>
              <Input
                id="tp"
                type="number"
                step="0.1"
                value={form.takeProfitPct ?? ""}
                onChange={(e) => set("takeProfitPct", parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sl">Stop Loss (%)</Label>
              <Input
                id="sl"
                type="number"
                step="0.1"
                value={form.stopLossPct ?? ""}
                onChange={(e) => set("stopLossPct", parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxHold">Hold máx (minutos)</Label>
              <Input
                id="maxHold"
                type="number"
                min={1}
                value={form.maxHoldMinutes ?? ""}
                onChange={(e) =>
                  set("maxHoldMinutes", parseInt(e.target.value) || 60)
                }
              />
            </div>
          </div>
        </div>

        {/* Risk / circuit breakers */}
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
            Circuit Breakers
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="maxDailyLoss">Perda diária máx (%)</Label>
              <Input
                id="maxDailyLoss"
                type="number"
                step="0.1"
                value={form.maxDailyLossPct ?? ""}
                onChange={(e) =>
                  set("maxDailyLossPct", parseFloat(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxLossTrade">Perda/trade máx (%)</Label>
              <Input
                id="maxLossTrade"
                type="number"
                step="0.1"
                value={form.maxLossPerTradePct ?? ""}
                onChange={(e) =>
                  set("maxLossPerTradePct", parseFloat(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxExposure">Exposição/token máx (%)</Label>
              <Input
                id="maxExposure"
                type="number"
                step="0.1"
                value={form.maxExposurePerTokenPct ?? ""}
                onChange={(e) =>
                  set("maxExposurePerTokenPct", parseFloat(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxDrawdown">Drawdown máx (%)</Label>
              <Input
                id="maxDrawdown"
                type="number"
                step="0.1"
                value={form.maxDrawdownPct ?? ""}
                onChange={(e) =>
                  set("maxDrawdownPct", parseFloat(e.target.value) || 0)
                }
              />
            </div>
          </div>
        </div>

        {/* Scam filter */}
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
            Filtro de Scam & Seleção
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="scamMin">Scam score mínimo (0-100)</Label>
              <Input
                id="scamMin"
                type="number"
                min={0}
                max={100}
                value={form.scamScoreMin ?? ""}
                onChange={(e) =>
                  set("scamScoreMin", parseInt(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="minLiq">Liquidez mín (USD)</Label>
              <Input
                id="minLiq"
                type="number"
                value={form.minLiquidityUsd ?? ""}
                onChange={(e) =>
                  set("minLiquidityUsd", parseFloat(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="minVol">Volume 24h mín (USD)</Label>
              <Input
                id="minVol"
                type="number"
                value={form.minVolume24hUsd ?? ""}
                onChange={(e) =>
                  set("minVolume24hUsd", parseFloat(e.target.value) || 0)
                }
              />
            </div>
          </div>
        </div>

        {/* Sources */}
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
            Fontes de Tokens
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Scan CEX (majors)</Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.scanCex ?? false}
                  onCheckedChange={(v) => set("scanCex", v)}
                />
                <span className="text-sm">Binance public ticker</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Scan DEX (memecoins)</Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.scanDex ?? false}
                  onCheckedChange={(v) => set("scanDex", v)}
                />
                <span className="text-sm">DexScreener</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cexSymbols">Símbolos CEX (separados por vírgula)</Label>
              <Input
                id="cexSymbols"
                value={cexSymbolsText}
                onChange={(e) => setCexSymbolsText(e.target.value)}
                placeholder="BTC/USDT, ETH/USDT, SOL/USDT"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dexChains">Chains DEX (separadas por vírgula)</Label>
              <Input
                id="dexChains"
                value={dexChainsText}
                onChange={(e) => setDexChainsText(e.target.value)}
                placeholder="base, arbitrum, optimism"
              />
            </div>
          </div>
        </div>

        {/* Graduation */}
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
            Graduação Paper → Live
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="paperReq">Ciclos paper requeridos</Label>
              <Input
                id="paperReq"
                type="number"
                min={1}
                value={form.paperCyclesRequired ?? ""}
                onChange={(e) =>
                  set("paperCyclesRequired", parseInt(e.target.value) || 50)
                }
              />
            </div>
            <div className="flex items-end">
              <div className="text-sm space-y-1">
                <p>
                  Aprovados: <strong>{config.paperCyclesPassed}</strong> /{" "}
                  {config.paperCyclesRequired}
                </p>
                <p>
                  Graduado:{" "}
                  {config.graduatedToLive ? (
                    <Badge variant="default">SIM</Badge>
                  ) : (
                    <Badge variant="outline">NÃO</Badge>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
