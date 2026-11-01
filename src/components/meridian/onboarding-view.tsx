"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet, type AnalyticsResponse, type EngineConfig, type PositionRow, type RoundRow } from "./api";
import { Icon } from "./icons";
import { Badge, Card, Meter, Ring, Skeleton } from "./ui";
import { usd } from "@/lib/meridian/format";

interface OnboardingData {
  config?: EngineConfig;
  rounds?: RoundRow[];
  positions?: PositionRow[];
  analytics?: AnalyticsResponse;
}

export function OnboardingView() {
  const config = useQuery<EngineConfig>({ queryKey: ["mrd", "config"], queryFn: () => apiGet<EngineConfig>("/api/config") });
  const rounds = useQuery<RoundRow[]>({ queryKey: ["mrd", "rounds"], queryFn: () => apiGet<RoundRow[]>("/api/rounds") });
  const positions = useQuery<PositionRow[]>({ queryKey: ["mrd", "positions"], queryFn: () => apiGet<PositionRow[]>("/api/positions") });
  const analytics = useQuery<AnalyticsResponse>({
    queryKey: ["mrd", "analytics", "30d"],
    queryFn: () => apiGet<AnalyticsResponse>("/api/analytics?range=30d"),
  });

  const data: OnboardingData = {
    config: config.data,
    rounds: rounds.data,
    positions: positions.data,
    analytics: analytics.data,
  };

  const cfg = data.config;
  const hasRounds = (data.rounds?.length ?? 0) > 0;
  const hasPositions = (data.positions?.length ?? 0) > 0;
  const hasCurve = (data.analytics?.equityCurve.length ?? 0) > 0;
  const killTested = Boolean(cfg?.killSwitchAt);
  const cyclesPassed = cfg?.paperCyclesPassed ?? 0;
  const cyclesRequired = cfg?.paperCyclesRequired ?? 50;

  const steps = [
    {
      title: "Confirme o modo paper",
      body: "O workspace começa em paper: preços reais, zero capital em risco. Live só depois da graduação.",
      done: cfg?.mode === "paper",
      href: "/strategy",
      cta: "Ver engine",
    },
    {
      title: "Revise os limites de risco",
      body: "Perda diária, drawdown e exposição vivem em Risk & safety. O motor pode apertar, nunca afrouxar.",
      done: killTested,
      href: "/risk",
      cta: killTested ? "Revisar de novo" : "Revisar risco",
    },
    {
      title: "Rode a primeira rodada",
      body: "Start no engine cria um round: scan, score, decisão e log. Você vê a decisão, não só o resultado.",
      done: hasRounds,
      href: "/strategy",
      cta: hasRounds ? "Ver rounds" : "Iniciar engine",
    },
    {
      title: "Abra a primeira posição",
      body: "A entrada só acontece depois dos gates de liquidez e scam score. O journal guarda o porquê.",
      done: hasPositions,
      href: "/portfolio",
      cta: hasPositions ? "Ver posições" : "Ver portfólio",
    },
    {
      title: "Leia o journal",
      body: "Cada saída registra o motivo — alvo, stop, tempo ou manual. É a fonte dos números de analytics.",
      done: hasCurve,
      href: "/journal",
      cta: hasCurve ? "Abrir journal" : "Abrir journal",
    },
  ];

  const done = steps.filter((s) => s.done).length;
  const progress = Math.round((done / steps.length) * 100);
  const loading = config.isPending || rounds.isPending || positions.isPending;

  return (
    <>
      <header className="mrd-page-head">
        <div>
          <div className="mrd-title-row">
            <h1 className="mrd-title">Primeiros passos</h1>
            <span className="mrd-status">
              <Badge tone={done === steps.length ? "pos" : "brand"}>{done}/{steps.length} concluídos</Badge>
              <span className="mrd-dim" style={{ fontSize: 12 }}>leva ~10 minutos</span>
            </span>
          </div>
          <p className="mrd-sub">
            Um roteiro curto para ver o motor decidindo com segurança. Nada aqui liga o modo live — isso exige 50 ciclos
            positivos e MFA.
          </p>
        </div>
        <div className="mrd-actions">
          <Link href="/overview" className="mrd-btn mrd-btn-primary mrd-btn-sm">
            Ir para o overview <Icon name="up" size={15} />
          </Link>
        </div>
      </header>

      <div className="mrd-hero">
        <section className="mrd-card">
          <div className="mrd-card-body" style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
            <Ring value={done / steps.length} label={`${progress}%`} />
            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="mrd-card-title">Progresso do setup</div>
              <div className="mrd-card-sub" style={{ marginTop: 4 }}>
                {done === steps.length
                  ? "Tudo pronto. O próximo marco é a graduação para live."
                  : `Faltam ${steps.length - done} passo(s) para o workspace estar completo.`}
              </div>
              <div style={{ marginTop: 12 }}>
                <Meter value={progress} label="Setup" tone="brand" />
              </div>
            </div>
          </div>
        </section>

        <div className="mrd-side">
          <Card title="Graduação" sub={`${cyclesPassed} / ${cyclesRequired} ciclos positivos`}>
            <Meter value={Math.min(100, (cyclesPassed / Math.max(1, cyclesRequired)) * 100)} label="Graduação" tone="pos" />
            <p className="mrd-dim" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.5 }}>
              Ao completar a janela, o modo live é liberado mas continua exigindo confirmação explícita com MFA.
            </p>
            <dl className="mrd-kv" style={{ marginTop: 12 }}>
              <dt>Equity (30d)</dt>
              <dd>{data.analytics ? usd(data.analytics.summary.endEquityUsd) : "—"}</dd>
              <dt>Posições abertas</dt>
              <dd>{data.positions?.length ?? 0}</dd>
              <dt>Rounds</dt>
              <dd>{data.rounds?.length ?? 0}</dd>
            </dl>
          </Card>
        </div>
      </div>

      <section className="mrd-card" style={{ marginTop: 16 }}>
        <div className="mrd-card-hd" data-border="true">
          <div>
            <div className="mrd-card-title">Checklist</div>
            <div className="mrd-card-sub">cada item reflete o estado real do workspace</div>
          </div>
        </div>
        {loading ? (
          <div className="mrd-card-body" style={{ display: "grid", gap: 10 }}>
            <Skeleton height={18} />
            <Skeleton height={18} />
            <Skeleton height={18} />
          </div>
        ) : (
          <div className="mrd-list">
            {steps.map((s, i) => (
              <div className="mrd-list-item" key={s.title}>
                <span
                  className="mrd-asset-ico"
                  style={{
                    background: s.done ? "var(--brand-soft)" : "var(--surface-2)",
                    color: s.done ? "var(--brand)" : "var(--text-3)",
                    fontWeight: 700,
                  }}
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <div className="mrd-list-main">
                  <div className="mrd-list-title">
                    {s.title} {s.done ? <Badge tone="pos">feito</Badge> : <Badge tone="neutral">pendente</Badge>}
                  </div>
                  <div className="mrd-list-sub">{s.body}</div>
                </div>
                <Link href={s.href} className={`mrd-btn mrd-btn-sm ${s.done ? "mrd-btn-ghost" : "mrd-btn-secondary"}`}>
                  {s.cta}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
