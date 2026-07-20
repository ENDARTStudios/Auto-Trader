"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Bell,
  Plus,
  Trash2,
  Pencil,
  Send,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  useNotificationChannels,
  useNotificationLogs,
  type NotificationChannelRow,
  type NotificationEventType,
  type ChannelType,
  type TelegramConfig,
  type DiscordConfig,
  type WebhookConfig,
} from "@/hooks/use-trading-data";
import { useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventTypeLabel(t: string): string {
  const map: Record<string, string> = {
    kill_switch_on: "Kill ON",
    kill_switch_off: "Kill OFF",
    position_opened: "Pos Aberta",
    position_closed: "Pos Fechada",
    drawdown_breach: "Drawdown",
    daily_loss_breach: "Perda Diária",
    graduation: "Graduação",
    engine_started: "Engine ON",
    engine_stopped: "Engine OFF",
  };
  return map[t] ?? t;
}

function eventTypeColor(t: string): string {
  if (t === "kill_switch_on" || t === "drawdown_breach" || t === "daily_loss_breach")
    return "bg-red-500/10 text-red-400 border-red-500/30";
  if (t === "kill_switch_off" || t === "graduation")
    return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  if (t === "position_opened" || t === "engine_started")
    return "bg-blue-500/10 text-blue-400 border-blue-500/30";
  if (t === "position_closed" || t === "engine_stopped")
    return "bg-amber-500/10 text-amber-400 border-amber-500/30";
  return "bg-muted text-muted-foreground";
}

function channelTypeLabel(t: ChannelType): string {
  return t === "telegram" ? "Telegram" : t === "discord" ? "Discord" : "Webhook";
}

function channelTypeColor(t: ChannelType): string {
  if (t === "telegram") return "bg-sky-500/10 text-sky-400 border-sky-500/30";
  if (t === "discord") return "bg-indigo-500/10 text-indigo-400 border-indigo-500/30";
  return "bg-purple-500/10 text-purple-400 border-purple-500/30";
}

function formatSentAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }) + " " + d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function NotificationsPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const channelsQ = useNotificationChannels();
  const logsQ = useNotificationLogs(100);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<NotificationChannelRow | null>(null);

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["notif-channels"] });
    qc.invalidateQueries({ queryKey: ["notif-logs"] });
  }

  async function handleToggleEnabled(ch: NotificationChannelRow, enabled: boolean) {
    try {
      const r = await fetch(`/api/notifications/channels/${ch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!r.ok) throw new Error("patch failed");
      toast({
        title: enabled ? "Canal ativado" : "Canal desativado",
        description: ch.name,
      });
      invalidateAll();
    } catch (err) {
      toast({
        title: "Erro",
        description: String(err),
        variant: "destructive",
      });
    }
  }

  async function handleTest(ch: NotificationChannelRow) {
    try {
      const r = await fetch(`/api/notifications/channels/${ch.id}/test`, {
        method: "POST",
      });
      const json = await r.json();
      if (json.status === "sent") {
        toast({
          title: "Teste enviado com sucesso",
          description: `${ch.name} (${channelTypeLabel(ch.type)}) respondeu em ${json.durationMs}ms`,
        });
      } else {
        toast({
          title: "Falha no teste",
          description: json.error ?? "erro desconhecido",
          variant: "destructive",
        });
      }
      invalidateAll();
    } catch (err) {
      toast({
        title: "Erro no teste",
        description: String(err),
        variant: "destructive",
      });
    }
  }

  async function handleDelete(ch: NotificationChannelRow) {
    if (!confirm(`Deletar canal "${ch.name}"?`)) return;
    try {
      const r = await fetch(`/api/notifications/channels/${ch.id}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error("delete failed");
      toast({ title: "Canal deletado", description: ch.name });
      invalidateAll();
    } catch (err) {
      toast({
        title: "Erro",
        description: String(err),
        variant: "destructive",
      });
    }
  }

  const channels = channelsQ.data?.channels ?? [];
  const eventTypes = channelsQ.data?.eventTypes ?? [];
  const logs = logsQ.data?.logs ?? [];

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Canais Configurados</p>
                <p className="text-2xl font-bold mt-1">{channels.length}</p>
              </div>
              <Bell className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Canais Ativos</p>
                <p className="text-2xl font-bold mt-1 text-emerald-400">
                  {channels.filter((c) => c.enabled).length}
                </p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Envios (logs recentes)</p>
                <p className="text-2xl font-bold mt-1">{logsQ.data?.total ?? 0}</p>
              </div>
              <Send className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Channels list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Canais de Notificação</span>
            <Button
              size="sm"
              className="gap-1"
              onClick={() => {
                setEditing(null);
                setShowCreate(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Novo Canal
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {channelsQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : channels.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              Nenhum canal configurado. Clique em &quot;Novo Canal&quot; para adicionar
              Telegram, Discord ou Webhook.
            </div>
          ) : (
            <div className="space-y-3">
              {channels.map((ch) => (
                <div
                  key={ch.id}
                  className="border rounded-lg p-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{ch.name}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${channelTypeColor(ch.type)}`}
                        >
                          {channelTypeLabel(ch.type)}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={
                            ch.enabled
                              ? "text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                              : "text-[10px] bg-muted text-muted-foreground"
                          }
                        >
                          {ch.enabled ? "Ativo" : "Inativo"}
                        </Badge>
                        {ch.throttleSec > 0 && (
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30"
                          >
                            throttle {ch.throttleSec}s
                          </Badge>
                        )}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {ch.type === "telegram" &&
                          `chat_id: ${(ch.config as TelegramConfig).chatId}`}
                        {ch.type === "discord" &&
                          `webhook: ${truncateUrl(
                            (ch.config as DiscordConfig).webhookUrl
                          )}`}
                        {ch.type === "webhook" &&
                          `url: ${truncateUrl((ch.config as WebhookConfig).url)}`}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {ch.events.length === 0 ? (
                          <span className="text-xs text-muted-foreground italic">
                            Sem eventos inscritos
                          </span>
                        ) : (
                          ch.events.map((ev) => (
                            <Badge
                              key={ev}
                              variant="outline"
                              className={`text-[10px] ${eventTypeColor(ev)}`}
                            >
                              {eventTypeLabel(ev)}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Switch
                        checked={ch.enabled}
                        onCheckedChange={(v) => handleToggleEnabled(ch, v)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1"
                        onClick={() => handleTest(ch)}
                      >
                        <Send className="h-3 w-3" />
                        Testar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => {
                          setEditing(ch);
                          setShowCreate(true);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(ch)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dispatch logs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Histórico de Envios (últimos 100)</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => logsQ.refetch()}
            >
              Atualizar
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logsQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              Nenhuma notificação enviada ainda. Dispare um evento (ex: ative o kill
              switch) ou clique em &quot;Testar&quot; em um canal.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Evento</th>
                    <th className="py-2 pr-3">Canal</th>
                    <th className="py-2 pr-3">Mensagem</th>
                    <th className="py-2 pr-3">Dur.</th>
                    <th className="py-2 pr-3">Enviado</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        {log.status === "sent" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${eventTypeColor(log.eventType)}`}
                        >
                          {eventTypeLabel(log.eventType)}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <div className="font-medium">{log.channelName}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {channelTypeLabel(log.channelType as ChannelType)}
                        </div>
                      </td>
                      <td className="py-2 pr-3 max-w-md">
                        <div className="truncate" title={log.error ?? log.message}>
                          {log.status === "failed" && log.error ? (
                            <span className="text-destructive">
                              {log.error.slice(0, 80)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {log.message.slice(0, 80)}
                              {log.message.length > 80 ? "…" : ""}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                        {log.durationMs > 0 ? `${log.durationMs}ms` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                        {formatSentAt(log.sentAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      <ChannelDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        editing={editing}
        eventTypes={eventTypes}
        onSaved={() => {
          setShowCreate(false);
          setEditing(null);
          invalidateAll();
        }}
      />
    </div>
  );
}

function truncateUrl(url: string): string {
  if (!url) return "";
  if (url.length <= 60) return url;
  return url.slice(0, 30) + "…" + url.slice(-25);
}

// ---------------------------------------------------------------------------
// Channel Dialog — create or edit a channel
// ---------------------------------------------------------------------------

interface ChannelDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: NotificationChannelRow | null;
  eventTypes: { value: NotificationEventType; label: string; description: string }[];
  onSaved: () => void;
}

function ChannelDialog({
  open,
  onOpenChange,
  editing,
  eventTypes,
  onSaved,
}: ChannelDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("telegram");
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [whUrl, setWhUrl] = useState("");
  const [whMethod, setWhMethod] = useState<"POST" | "PUT">("POST");
  const [whHeaders, setWhHeaders] = useState("");
  const [events, setEvents] = useState<NotificationEventType[]>([]);
  const [throttleSec, setThrottleSec] = useState(0);
  const [saving, setSaving] = useState(false);

  // Reset form when dialog opens (with editing or empty)
  function resetForm() {
    if (editing) {
      setName(editing.name);
      setType(editing.type);
      if (editing.type === "telegram") {
        const c = editing.config as TelegramConfig;
        setBotToken(c.botToken ?? "");
        setChatId(c.chatId ?? "");
      } else if (editing.type === "discord") {
        const c = editing.config as DiscordConfig;
        setWebhookUrl(c.webhookUrl ?? "");
      } else if (editing.type === "webhook") {
        const c = editing.config as WebhookConfig;
        setWhUrl(c.url ?? "");
        setWhMethod(c.method ?? "POST");
        setWhHeaders(c.headers ? JSON.stringify(c.headers, null, 2) : "");
      }
      setEvents(editing.events);
      setThrottleSec(editing.throttleSec);
    } else {
      setName("");
      setType("telegram");
      setBotToken("");
      setChatId("");
      setWebhookUrl("");
      setWhUrl("");
      setWhMethod("POST");
      setWhHeaders("");
      setEvents([]);
      setThrottleSec(0);
    }
  }

  // When opening, sync form
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const _ = open; // re-render trigger
  if (open && saving === false && name === "" && editing !== null) {
    // first render with editing — initialize once
    resetForm();
  }
  if (open && saving === false && editing === null && name === "" && type !== "telegram") {
    setType("telegram");
  }

  function toggleEvent(ev: NotificationEventType) {
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev]
    );
  }

  function buildConfig(): TelegramConfig | DiscordConfig | WebhookConfig | null {
    if (type === "telegram") {
      if (!botToken.trim() || !chatId.trim()) {
        toast({
          title: "Configuração inválida",
          description: "Telegram requer botToken e chatId",
          variant: "destructive",
        });
        return null;
      }
      return { botToken: botToken.trim(), chatId: chatId.trim() };
    }
    if (type === "discord") {
      if (!webhookUrl.trim()) {
        toast({
          title: "Configuração inválida",
          description: "Discord requer webhookUrl",
          variant: "destructive",
        });
        return null;
      }
      return { webhookUrl: webhookUrl.trim() };
    }
    if (type === "webhook") {
      if (!whUrl.trim()) {
        toast({
          title: "Configuração inválida",
          description: "Webhook requer url",
          variant: "destructive",
        });
        return null;
      }
      let headers: Record<string, string> | undefined;
      if (whHeaders.trim()) {
        try {
          headers = JSON.parse(whHeaders);
        } catch {
          toast({
            title: "Headers inválidos",
            description: "JSON malformado nos headers",
            variant: "destructive",
          });
          return null;
        }
      }
      return { url: whUrl.trim(), method: whMethod, headers };
    }
    return null;
  }

  async function handleSave() {
    if (!name.trim()) {
      toast({
        title: "Nome obrigatório",
        variant: "destructive",
      });
      return;
    }
    const config = buildConfig();
    if (!config) return;

    setSaving(true);
    try {
      const url = editing
        ? `/api/notifications/channels/${editing.id}`
        : "/api/notifications/channels";
      const method = editing ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          config,
          events,
          throttleSec,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? "save failed");
      }
      toast({
        title: editing ? "Canal atualizado" : "Canal criado",
        description: name.trim(),
      });
      // Reset form for next open
      setName("");
      setBotToken("");
      setChatId("");
      setWebhookUrl("");
      setWhUrl("");
      setEvents([]);
      onSaved();
    } catch (err) {
      toast({
        title: "Erro ao salvar",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          // reset on close
          setName("");
          setBotToken("");
          setChatId("");
          setWebhookUrl("");
          setWhUrl("");
          setEvents([]);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Editar Canal" : "Novo Canal de Notificação"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name + type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ch-name">Nome</Label>
              <Input
                id="ch-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Meu Telegram"
              />
            </div>
            <div>
              <Label htmlFor="ch-type">Tipo</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as ChannelType)}
                disabled={!!editing}
              >
                <SelectTrigger id="ch-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="telegram">Telegram</SelectItem>
                  <SelectItem value="discord">Discord</SelectItem>
                  <SelectItem value="webhook">Webhook genérico</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Type-specific config */}
          {type === "telegram" && (
            <div className="space-y-3 border rounded-md p-3 bg-muted/30">
              <p className="text-xs text-muted-foreground">
                Crie um bot via <code>@BotFather</code> no Telegram, copie o token.
                <code>@userinfobot</code> mostra seu chat_id numérico.
              </p>
              <div>
                <Label htmlFor="tg-token">Bot Token</Label>
                <Input
                  id="tg-token"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="123456:ABC-DEF..."
                  type="password"
                />
              </div>
              <div>
                <Label htmlFor="tg-chat">Chat ID</Label>
                <Input
                  id="tg-chat"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  placeholder="123456789"
                />
              </div>
            </div>
          )}

          {type === "discord" && (
            <div className="space-y-3 border rounded-md p-3 bg-muted/30">
              <p className="text-xs text-muted-foreground">
                Em Configurações do Servidor → Integrações → Webhooks → Novo Webhook,
                copie a URL do webhook.
              </p>
              <div>
                <Label htmlFor="dc-url">Webhook URL</Label>
                <Input
                  id="dc-url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/..."
                  type="password"
                />
              </div>
            </div>
          )}

          {type === "webhook" && (
            <div className="space-y-3 border rounded-md p-3 bg-muted/30">
              <p className="text-xs text-muted-foreground">
                Webhook genérico: recebe POST/PUT JSON com payload{" "}
                <code>{"{ eventType, title, message, context, timestamp }"}</code>.
              </p>
              <div>
                <Label htmlFor="wh-url">URL</Label>
                <Input
                  id="wh-url"
                  value={whUrl}
                  onChange={(e) => setWhUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="wh-method">Método</Label>
                  <Select
                    value={whMethod}
                    onValueChange={(v) => setWhMethod(v as "POST" | "PUT")}
                  >
                    <SelectTrigger id="wh-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="POST">POST</SelectItem>
                      <SelectItem value="PUT">PUT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="wh-throttle">Throttle (segundos)</Label>
                  <Input
                    id="wh-throttle"
                    type="number"
                    min={0}
                    value={throttleSec}
                    onChange={(e) =>
                      setThrottleSec(Math.max(0, parseInt(e.target.value, 10) || 0))
                    }
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="wh-headers">Headers (JSON, opcional)</Label>
                <textarea
                  id="wh-headers"
                  className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
                  value={whHeaders}
                  onChange={(e) => setWhHeaders(e.target.value)}
                  placeholder='{"Authorization": "Bearer xxx"}'
                />
              </div>
            </div>
          )}

          {type !== "webhook" && (
            <div>
              <Label htmlFor="other-throttle">Throttle (segundos, 0 = sem limite)</Label>
              <Input
                id="other-throttle"
                type="number"
                min={0}
                value={throttleSec}
                onChange={(e) =>
                  setThrottleSec(Math.max(0, parseInt(e.target.value, 10) || 0))
                }
              />
              <p className="text-xs text-muted-foreground mt-1">
                Limita a 1 mensagem por evento a cada N segundos.
              </p>
            </div>
          )}

          {/* Events subscription */}
          <div>
            <Label>Eventos Inscritos</Label>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 border rounded-md p-3">
              {eventTypes.map((ev) => (
                <label
                  key={ev.value}
                  className="flex items-start gap-2 cursor-pointer hover:bg-muted/50 rounded p-1"
                >
                  <Checkbox
                    checked={events.includes(ev.value)}
                    onCheckedChange={() => toggleEvent(ev.value)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{ev.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {ev.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando…" : editing ? "Salvar" : "Criar Canal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
