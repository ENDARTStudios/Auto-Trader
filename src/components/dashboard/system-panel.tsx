"use client";

import { useState, useRef, useMemo, useEffect } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Calendar,
  Clock,
  Database,
  Download,
  Upload,
  Trash2,
  Activity,
  HardDrive,
  Cpu,
  Timer,
  Save,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Zap,
} from "lucide-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useSchedule,
  useSystemInfo,
  type TradingScheduleData,
  type SystemInfoData,
} from "@/hooks/use-trading-data";

const WEEKDAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

const COMMON_TIMEZONES = [
  "America/Sao_Paulo",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Singapore",
  "UTC",
];

function fmtBytes(mb: number): string {
  if (mb < 1) return `${Math.round(mb * 1024)} KB`;
  return `${mb.toFixed(2)} MB`;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function SystemPanel() {
  return (
    <div className="space-y-4">
      <Tabs defaultValue="schedule">
        <TabsList>
          <TabsTrigger value="schedule" className="gap-1">
            <Calendar className="size-3.5" /> Agenda
          </TabsTrigger>
          <TabsTrigger value="info" className="gap-1">
            <Cpu className="size-3.5" /> Sistema
          </TabsTrigger>
          <TabsTrigger value="backup" className="gap-1">
            <Database className="size-3.5" /> Backup
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="gap-1">
            <Trash2 className="size-3.5" /> Manutenção
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="space-y-4">
          <SchedulePanel />
        </TabsContent>
        <TabsContent value="info" className="space-y-4">
          <SystemInfoPanel />
        </TabsContent>
        <TabsContent value="backup" className="space-y-4">
          <BackupPanel />
        </TabsContent>
        <TabsContent value="maintenance" className="space-y-4">
          <MaintenancePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Schedule panel
// ---------------------------------------------------------------------------

function SchedulePanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useSchedule();
  const [form, setForm] = useState<Partial<TradingScheduleData>>({});

  // Sync form when data loads — setState in effect is intentional
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data) setForm(data.schedule);
  }, [data]);

  const save = useMutation({
    mutationFn: async (patch: Partial<TradingScheduleData>) => {
      const r = await fetch("/api/schedule", {
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
      toast.success("Agenda salva");
      qc.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="size-5" /> Agenda de Trading
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

  const sched = data.schedule;
  const status = data.status;
  const selectedDays = form.daysOfWeek ?? sched.daysOfWeek;

  const toggleDay = (day: number, checked: boolean) => {
    const current = new Set(form.daysOfWeek ?? sched.daysOfWeek);
    if (checked) current.add(day);
    else current.delete(day);
    setForm((f) => ({ ...f, daysOfWeek: Array.from(current).sort() }));
  };

  const handleSave = () => {
    save.mutate({
      enabled: form.enabled ?? sched.enabled,
      daysOfWeek: selectedDays,
      startTime: form.startTime ?? sched.startTime,
      endTime: form.endTime ?? sched.endTime,
      timezone: form.timezone ?? sched.timezone,
      forceCloseAtEnd: form.forceCloseAtEnd ?? sched.forceCloseAtEnd,
    });
  };

  return (
    <>
      {/* Live status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-2">
              <Calendar className="size-5" /> Agenda de Trading
            </span>
            <Badge
              variant={status.within ? "default" : "outline"}
              className="gap-1"
            >
              {status.within ? (
                <CheckCircle2 className="size-3 text-emerald-500" />
              ) : (
                <XCircle className="size-3 text-red-500" />
              )}
              {status.within ? "Dentro da janela" : "Fora da janela"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Restringe quando a engine pode abrir novas posições. MONITOR/EXIT
            de posições existentes continua 24/7.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Status</p>
              <p className="font-medium">
                {sched.enabled ? "Ativada" : "Desativada"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Hora local</p>
              <p className="font-medium">{status.localTime}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Janela</p>
              <p className="font-medium">
                {sched.startTime} - {sched.endTime}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Próxima mudança</p>
              <p className="font-medium">
                {status.nextChange === "open"
                  ? "Abre"
                  : status.nextChange === "close"
                  ? "Fecha"
                  : "—"}
              </p>
            </div>
          </div>
          <Alert>
            <Timer className="size-4" />
            <AlertDescription>{status.reason}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Editor */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-2">
              <Clock className="size-5" /> Configurar Agenda
            </span>
            <Button onClick={handleSave} disabled={save.isPending} className="gap-1" size="sm">
              <Save className="size-4" /> Salvar
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enabled */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Agenda ativada</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Se desativada, a engine pode operar 24/7.
              </p>
            </div>
            <Switch
              checked={form.enabled ?? sched.enabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            />
          </div>

          {/* Days of week */}
          <div className="space-y-3">
            <Label>Dias permitidos</Label>
            <div className="grid grid-cols-7 gap-2">
              {WEEKDAYS.map((d) => (
                <label
                  key={d.value}
                  className={`flex flex-col items-center gap-1 p-3 rounded-md border cursor-pointer transition-colors ${
                    selectedDays.includes(d.value)
                      ? "bg-primary/10 border-primary text-primary"
                      : "bg-background hover:bg-accent"
                  }`}
                >
                  <Checkbox
                    checked={selectedDays.includes(d.value)}
                    onCheckedChange={(c) => toggleDay(d.value, c === true)}
                  />
                  <span className="text-xs font-medium">{d.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Time + tz */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startTime">Início (HH:MM)</Label>
              <Input
                id="startTime"
                type="time"
                value={form.startTime ?? sched.startTime}
                onChange={(e) =>
                  setForm((f) => ({ ...f, startTime: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime">Fim (HH:MM)</Label>
              <Input
                id="endTime"
                type="time"
                value={form.endTime ?? sched.endTime}
                onChange={(e) =>
                  setForm((f) => ({ ...f, endTime: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tz">Timezone</Label>
              <select
                id="tz"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={form.timezone ?? sched.timezone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, timezone: e.target.value }))
                }
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
                {/* Include current if not in list */}
                {!COMMON_TIMEZONES.includes(sched.timezone) && (
                  <option value={sched.timezone}>{sched.timezone}</option>
                )}
              </select>
            </div>
          </div>

          {/* Force close */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Forçar fechamento ao fim da janela</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Se ativado, todas as posições abertas serão fechadas quando a
                janela fechar. Caso contrário, posições existentes seguem
                TP/SL/timeout normal.
              </p>
            </div>
            <Switch
              checked={form.forceCloseAtEnd ?? sched.forceCloseAtEnd}
              onCheckedChange={(v) =>
                setForm((f) => ({ ...f, forceCloseAtEnd: v }))
              }
            />
          </div>

          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertDescription>
              <strong>Atenção:</strong> Alterar a agenda não reinicia a engine.
              Se a engine estiver rodando, o novo horário entra em vigor no
              próximo tick (em até {`<loopIntervalSec>`}s).
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// 2. System info panel
// ---------------------------------------------------------------------------

function SystemInfoPanel() {
  const { data, isLoading } = useSystemInfo();

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="size-5" /> Informações do Sistema
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

  const tableRows: Array<[string, number]> = Object.entries(data.tables);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <HardDrive className="size-4" /> Tamanho DB
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtBytes(data.db.sizeMb)}</div>
            <p className="text-xs text-muted-foreground mt-1">{data.db.path}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Timer className="size-4" /> Uptime
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {fmtUptime(data.runtime.uptimeSec)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              PID {data.runtime.pid} • Node {data.runtime.nodeVersion}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="size-4" /> Memória (RSS)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {fmtBytes(data.runtime.rssMb)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Heap {fmtBytes(data.runtime.heapUsedMb)} /{" "}
              {fmtBytes(data.runtime.heapTotalMb)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Database className="size-4" /> Prisma Models
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.schema.prismaModels}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Plataforma: {data.runtime.platform}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-5" /> Contagem por Tabela
          </CardTitle>
          <CardDescription>
            Número de rows em cada tabela do banco SQLite. Útil para entender
            o volume de dados e quando executar manutenção.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {tableRows.map(([name, count]) => (
              <div
                key={name}
                className="flex items-center justify-between p-3 rounded-md border bg-card"
              >
                <span className="text-sm text-muted-foreground truncate">{name}</span>
                <Badge variant="outline" className="font-mono">
                  {count.toLocaleString()}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// 3. Backup panel
// ---------------------------------------------------------------------------

function BackupPanel() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [importing, setImporting] = useState(false);

  const downloadBackup = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/system/backup");
      if (!r.ok) throw new Error("backup failed");
      const blob = await r.blob();
      // Extract filename from Content-Disposition
      const cd = r.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? `backup-${Date.now()}.json`;
      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return filename;
    },
    onSuccess: (filename) => {
      toast.success(`Backup exportado: ${filename}`);
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!json?._meta || json?._meta?.app !== "auto-trader") {
        toast.error("Arquivo não é um backup válido do Auto Trader");
        return;
      }
      setImportPreview(json);
      toast.success(`Backup carregado: ${file.name}`);
    } catch (err) {
      toast.error(`Erro ao ler arquivo: ${String(err)}`);
    }
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const performRestore = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      const r = await fetch("/api/system/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(importPreview),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "restore failed");
      }
      const result = await r.json();
      toast.success(
        `Restaurado: ${Object.entries(result.restored)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}`
      );
      setImportPreview(null);
      qc.invalidateQueries();
    } catch (err) {
      toast.error(`Erro: ${String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const tableCounts = importPreview?._meta?.tables ?? {};

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="size-5" /> Exportar Backup
          </CardTitle>
          <CardDescription>
            Baixa um snapshot JSON do banco de dados. Inclui config, saldos,
            posições, rounds, logs, canais de notificação e schedule. Use para
            arquivar estado ou migrar entre instâncias.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => downloadBackup.mutate()}
            disabled={downloadBackup.isPending}
            className="gap-1"
          >
            <Download className="size-4" />
            {downloadBackup.isPending ? "Gerando..." : "Baixar backup JSON"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="size-5" /> Importar Backup
          </CardTitle>
          <CardDescription>
            Restaura config, saldos, schedule e canais de notificação de um
            backup. <strong>Posições/rounds/logs NÃO são sobrescritos</strong>{" "}
            (dados históricos são append-only).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Operação destrutiva</AlertTitle>
            <AlertDescription>
              Esta ação sobrescreve a configuração atual. Faça um backup
              exportado primeiro se quiser reverter.
            </AlertDescription>
          </Alert>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileSelected}
            className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
          />

          {importPreview && (
            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  Backup pronto para importar
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Exportado em:{" "}
                  <span className="font-mono">
                    {importPreview._meta?.exportedAt ?? "?"}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  {Object.entries(tableCounts).map(([k, v]: [string, any]) => (
                    <div
                      key={k}
                      className="flex items-center justify-between p-2 rounded border bg-background"
                    >
                      <span className="text-muted-foreground">{k}</span>
                      <Badge variant="outline" className="font-mono">
                        {v}
                      </Badge>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={performRestore}
                    disabled={importing}
                    className="gap-1"
                  >
                    <Upload className="size-4" />
                    {importing ? "Importando..." : "Confirmar importação"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setImportPreview(null)}
                    disabled={importing}
                  >
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// 4. Maintenance panel
// ---------------------------------------------------------------------------

interface MaintenanceAction {
  action: string;
  label: string;
  description: string;
  icon: typeof Trash2;
  variant: "outline" | "destructive" | "secondary";
}

const MAINTENANCE_ACTIONS: MaintenanceAction[] = [
  {
    action: "clear_logs",
    label: "Limpar Logs Antigos",
    description: "Remove logs de aplicação com mais de 7 dias.",
    icon: Trash2,
    variant: "outline",
  },
  {
    action: "clear_notification_logs",
    label: "Limpar Logs de Notificação",
    description: "Remove logs de envio de notificações com mais de 7 dias.",
    icon: Trash2,
    variant: "outline",
  },
  {
    action: "clear_market_snapshots",
    label: "Limpar Market Snapshots",
    description: "Remove snapshots de mercado com mais de 30 dias.",
    icon: Trash2,
    variant: "outline",
  },
  {
    action: "clear_performance_snapshots",
    label: "Limpar Performance Snapshots",
    description: "Remove snapshots de equity curve com mais de 7 dias.",
    icon: Trash2,
    variant: "outline",
  },
  {
    action: "clear_old_alerts",
    label: "Limpar Alertas Resolvidos",
    description: "Remove alertas de vigilância já resolvidos (>7 dias).",
    icon: Trash2,
    variant: "outline",
  },
  {
    action: "clear_scam_reports",
    label: "Limpar Scam Reports",
    description: "Remove scam reports com mais de 30 dias.",
    icon: Trash2,
    variant: "outline",
  },
  {
    action: "clear_ai_insights",
    label: "Limpar AI Insights",
    description: "Remove insights de IA com mais de 7 dias.",
    icon: Trash2,
    variant: "outline",
  },
  {
    action: "vacuum",
    label: "VACUUM SQLite",
    description: "Compacta o arquivo do banco e recupera espaço livre.",
    icon: Zap,
    variant: "secondary",
  },
];

function MaintenancePanel() {
  const qc = useQueryClient();
  const [results, setResults] = useState<Record<string, { deleted: number; label: string }>>({});

  const runAction = useMutation({
    mutationFn: async (action: string) => {
      const r = await fetch("/api/system/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "maintenance failed");
      }
      return r.json();
    },
    onSuccess: (data, action) => {
      toast.success(`${data.label} (${data.deleted} rows)`);
      setResults((r) => ({
        ...r,
        [action]: { deleted: data.deleted, label: data.label },
      }));
      qc.invalidateQueries({ queryKey: ["system-info"] });
    },
    onError: (e) => toast.error(`Erro: ${String(e)}`),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="size-5" /> Manutenção do Banco
        </CardTitle>
        <CardDescription>
          Remove dados antigos para manter o banco enxuto. Posições, rounds,
          config e canais de notificação <strong>nunca</strong> são deletados
          por estas ações.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertDescription>
            Recomendado executar após 7+ dias de operação contínua. Faça backup
            antes da primeira manutenção.
          </AlertDescription>
        </Alert>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {MAINTENANCE_ACTIONS.map((a) => {
            const Icon = a.icon;
            const result = results[a.action];
            const isRunning = runAction.isPending && runAction.variables === a.action;
            return (
              <div
                key={a.action}
                className="flex flex-col p-4 rounded-md border bg-card space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <Icon className="size-4 mt-0.5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{a.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {a.description}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Button
                    size="sm"
                    variant={a.variant}
                    onClick={() => runAction.mutate(a.action)}
                    disabled={isRunning}
                    className="gap-1"
                  >
                    <Trash2 className="size-3.5" />
                    {isRunning ? "Executando..." : "Executar"}
                  </Button>
                  {result && (
                    <Badge variant="secondary" className="text-xs">
                      Último: {result.deleted} removidos
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
