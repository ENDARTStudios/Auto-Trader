"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/components/meridian/api";
import { Icon } from "@/components/meridian/icons";
import { Badge, Card, Empty, Kpi, Skeleton } from "@/components/meridian/ui";
import { clockUtc, pct, price, signedUsd, stampUtc, usd } from "@/lib/meridian/format";

interface Detail {
  position: {
    id: string;
    symbol: string;
    status: string;
    source: string;
    chain: string | null;
    entryPriceUsd: number;
    entryAmountUsd: number;
    entryQty: number;
    entryAt: string;
    exitPriceUsd: number | null;
    exitAt: string | null;
    exitReason: string | null;
    pnlUsd: number | null;
    pnlPct: number | null;
    takeProfitPrice: number | null;
    stopLossPrice: number | null;
    maxExitAt: string | null;
    scamScore: number | null;
    strategy: string | null;
    roundId: number | null;
    currentPriceUsd?: number | null;
  };
  currentPrice?: number | null;
  scamReport?: { score?: number; flags?: string; summary?: string; analyzedAt?: string } | null;
  aiInsights?: { id: string; title?: string; message?: string; severity?: string; createdAt: string }[];
  surveillanceAlerts?: { id: string; title?: string; message?: string; severity?: string; createdAt: string; resolvedAt?: string | null }[];
  marketSnapshots?: { id: number; priceUsd: number; signalScore: number; signalLabel: string; analyzedAt: string }[];
  round?: { id: number; startedAt?: string; roundPnlUsd?: number } | null;
}

export function PositionDetailView({ id }: { id: string }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);

  const q = useQuery<Detail>({
    queryKey: ["mrd", "position", id],
    queryFn: () => apiGet<Detail>(`/api/positions/${id}`),
    refetchInterval: 20_000,
    retry: 0,
  });

  const close = useMutation({
    mutationFn: () => apiPost<{ ok: boolean }>(`/api/positions/${id}/close`, { note }),
    onSuccess: () => {
      toast.success("Posição fechada");
      setConfirm(false);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["mrd", "position", id] });
      void qc.invalidateQueries({ queryKey: ["mrd", "positions"] });
    },
    onError: (err: Error) => toast.error("Não foi possível fechar", { description: err.message }),
  });

  if (q.isLoading) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <Skeleton height={28} width="40%" />
        <Skeleton height={120} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (q.isError || !q.data?.position) {
    return (
      <Empty
        title="Posição não encontrada"
        description="Ela pode ter sido removida ou o link está incorreto."
        action={<Link href="/portfolio" className="mrd-btn mrd-btn-secondary mrd-btn-sm">Voltar ao portfólio</Link>}
      />
    );
  }

  const { position: p, scamReport, aiInsights, surveillanceAlerts, marketSnapshots, round } = q.data;
  const isOpen = p.status === "open";
  const live = q.data.currentPrice ?? p.currentPriceUsd ?? 0;
  const hasLive = live > 0;
  const mark = hasLive ? live : p.exitPriceUsd ?? p.entryPriceUsd;
  const pnl = isOpen ? (hasLive ? (mark - p.entryPriceUsd) * p.entryQty : p.pnlUsd ?? 0) : p.pnlUsd ?? 0;
  const pnlPct = isOpen && hasLive && p.entryAmountUsd > 0 ? (pnl / p.entryAmountUsd) * 100 : p.pnlPct ?? 0;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-3)", marginBottom: 10 }}>
        <Link href="/portfolio" style={{ color: "inherit", textDecoration: "none" }}>Portfolio</Link>
        <span>/</span>
        <span style={{ color: "var(--text-2)" }}>{p.symbol}</span>
      </div>

      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">{p.symbol}</h1>
            <span className="mrd-status">
              <Badge tone={isOpen ? "pos" : "neutral"}>{p.status}</Badge>
              <Badge>LONG</Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }}>{p.source.toUpperCase()}{p.chain ? ` · ${p.chain}` : ""}</span>
            </span>
          </div>
          <p className="mrd-sub">
            {isOpen
              ? `Aberta em ${stampUtc(p.entryAt)} UTC · ${p.strategy ?? "estratégia padrão"} · round ${p.roundId ? `R-${p.roundId}` : "—"}`
              : `Fechada em ${p.exitAt ? stampUtc(p.exitAt) : "—"} UTC · motivo ${p.exitReason ?? "—"}`}
          </p>
        </div>
        <div className="mrd-actions">
          <a className="mrd-btn mrd-btn-ghost mrd-btn-sm" href={`/journal`}>
            <Icon name="journal" size={15} /> Journal
          </a>
          {isOpen ? (
            <button type="button" className="mrd-btn mrd-btn-danger-solid mrd-btn-sm" onClick={() => setConfirm(true)}>
              <Icon name="power" size={15} /> Fechar posição
            </button>
          ) : null}
        </div>
      </header>

      <div className="mrd-kpi-row">
        <Kpi label="Entrada" value={price(p.entryPriceUsd)} foot={<span className="mrd-dim">{usd(p.entryAmountUsd)}</span>} />
        <Kpi label={isOpen ? "Mark" : "Saída"} value={isOpen ? price(mark) : price(p.exitPriceUsd ?? 0)} foot={<span className="mrd-dim">{isOpen ? (hasLive ? "preço atual" : "sem cotação ao vivo") : "preço de saída"}</span>} />
        <Kpi label="P&L" value={signedUsd(pnl)} valueClassName={pnl >= 0 ? "mrd-pos" : "mrd-neg"} foot={<span className="mrd-dim">{pct(pnlPct)}</span>} />
        <Kpi label="Stop" value={p.stopLossPrice ? price(p.stopLossPrice) : "—"} foot={<span className="mrd-dim">invalidação</span>} />
        <Kpi label="Alvo" value={p.takeProfitPrice ? price(p.takeProfitPrice) : "—"} foot={<span className="mrd-dim">take profit</span>} />
        <Kpi label="Scam score" value={p.scamScore !== null ? String(p.scamScore) : "—"} foot={<span className="mrd-dim">0 = limpo</span>} />
      </div>

      <div className="mrd-hero" style={{ marginTop: 16 }}>
        <div style={{ display: "grid", gap: 16 }}>
          <Card title="Decisão" sub={round ? `Round R-${round.id} · ${round.startedAt ? clockUtc(round.startedAt) : ""}` : "sem round associado"}>
            <dl className="mrd-kv">
              <dt>Quantidade</dt>
              <dd>{p.entryQty.toFixed(6)}</dd>
              <dt>Horizonte máximo</dt>
              <dd>{p.maxExitAt ? `${stampUtc(p.maxExitAt)} UTC` : "—"}</dd>
              <dt>Estratégia</dt>
              <dd>{p.strategy ?? "—"}</dd>
              <dt>Round P&L</dt>
              <dd className={(round?.roundPnlUsd ?? 0) >= 0 ? "mrd-pos" : "mrd-neg"}>{round?.roundPnlUsd !== undefined ? signedUsd(round.roundPnlUsd ?? 0) : "—"}</dd>
            </dl>
          </Card>

          <Card title="Scam report" sub="o que os gates viram antes da entrada">
            {scamReport ? (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <b style={{ fontSize: 26 }}>{scamReport.score ?? "—"}</b>
                  <span className="mrd-dim" style={{ fontSize: 12 }}>score</span>
                  <Badge tone={(scamReport.score ?? 0) > 40 ? "neg" : "pos"}>{(scamReport.score ?? 0) > 40 ? "arriscado" : "aprovado"}</Badge>
                </div>
                <p className="mrd-muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.55 }}>
                  {scamReport.summary ?? "Relatório sem resumo textual."}
                </p>
                {scamReport.flags ? (
                  <p className="mrd-dim" style={{ fontSize: 11.5, marginTop: 6 }}>Flags: {scamReport.flags}</p>
                ) : null}
              </>
            ) : (
              <p className="mrd-dim" style={{ fontSize: 12.5 }}>Nenhum relatório de scam registrado para este token.</p>
            )}
          </Card>

          <Card title="Insights de IA" sub={`${aiInsights?.length ?? 0} registros`}>
            {aiInsights?.length ? (
              <div className="mrd-list">
                {aiInsights.slice(0, 5).map((i) => (
                  <div className="mrd-list-item" key={i.id}>
                    <div className="mrd-list-main">
                      <div className="mrd-list-title">{i.title ?? i.severity ?? "insight"}</div>
                      <div className="mrd-list-sub">{i.message ?? "—"}</div>
                    </div>
                    <span className="mrd-dim" style={{ fontSize: 11 }}>{clockUtc(i.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mrd-dim" style={{ fontSize: 12.5 }}>Nada foi gerado para esta posição.</p>
            )}
          </Card>
        </div>

        <div className="mrd-side">
          <Card title="Surveillance" sub={`${surveillanceAlerts?.length ?? 0} alertas`}>
            {surveillanceAlerts?.length ? (
              <div style={{ display: "grid", gap: 10 }}>
                {surveillanceAlerts.slice(0, 5).map((a) => (
                  <div key={a.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <b>{a.title ?? a.severity ?? "alerta"}</b>
                      <Badge tone={a.resolvedAt ? "neutral" : "warn"}>{a.resolvedAt ? "resolvido" : "aberto"}</Badge>
                    </div>
                    <div className="mrd-dim" style={{ fontSize: 11.5 }}>{a.message ?? "—"}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mrd-dim" style={{ fontSize: 12.5 }}>Nenhum alerta aberto para esta posição.</p>
            )}
          </Card>

          <Card title="Contexto de mercado" sub="snapshots do símbolo">
            {marketSnapshots?.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {marketSnapshots.slice(0, 5).map((s) => (
                  <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
                    <span className="mrd-dim">{clockUtc(s.analyzedAt)}</span>
                    <span>{price(s.priceUsd)}</span>
                    <Badge tone={s.signalLabel.includes("buy") ? "pos" : s.signalLabel.includes("sell") ? "neg" : "neutral"}>{s.signalScore}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mrd-dim" style={{ fontSize: 12.5 }}>Sem snapshots recentes.</p>
            )}
          </Card>
        </div>
      </div>

      {confirm ? (
        <div className="mrd-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(false)}>
          <div className="mrd-modal" role="dialog" aria-modal="true" aria-label={`Fechar ${p.symbol}`}>
            <div className="mrd-modal-hd">
              <h2>Fechar {p.symbol}?</h2>
              <p>Ordem simulada no preço atual. A posição sai do monitoramento.</p>
            </div>
            <div className="mrd-modal-body">
              <dl className="mrd-kv">
                <dt>Tamanho</dt>
                <dd>{usd(p.entryAmountUsd)}</dd>
                <dt>Mark</dt>
                <dd>{price(mark)}</dd>
                <dt>P&amp;L</dt>
                <dd className={pnl >= 0 ? "mrd-pos" : "mrd-neg"}>{signedUsd(pnl)} ({pct(pnlPct)})</dd>
              </dl>
              <label className="mrd-field" style={{ marginTop: 14 }}>
                <span>Nota do operador (opcional)</span>
                <input className="mrd-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="por que está fechando?" maxLength={200} />
              </label>
            </div>
            <div className="mrd-modal-foot">
              <button type="button" className="mrd-btn mrd-btn-ghost" onClick={() => setConfirm(false)}>Cancelar</button>
              <button type="button" className="mrd-btn mrd-btn-danger-solid" onClick={() => close.mutate()} disabled={close.isPending}>
                {close.isPending ? "Fechando…" : "Fechar posição"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
