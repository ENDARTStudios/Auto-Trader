"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, type PositionRow, type RoundRow } from "./api";
import { Icon } from "./icons";

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = () => cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
function read(key: string) {
  try {
    return window.localStorage.getItem(key) ?? "0";
  } catch {
    return "0";
  }
}
function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage indisponível */
  }
  listeners.forEach((l) => l());
}
function useFlag(key: string) {
  return useSyncExternalStore(
    subscribe,
    () => read(key),
    () => "0"
  );
}

const STEPS = [
  {
    title: "Risco antes do lucro",
    body: "Caps de perda diária, drawdown e exposição ficam em Risk & safety. O motor pode apertar esses limites, nunca afrouxar — e o kill switch exige HALT digitado.",
    href: "/risk",
    cta: "Ver Risk & safety",
  },
  {
    title: "Engine em paper",
    body: "O loop começa em paper: preços reais, zero capital em risco. Cada rodada varre o mercado, pontua candidatos e registra a decisão no journal.",
    href: "/strategy",
    cta: "Ver Strategy",
  },
  {
    title: "Tudo auditado",
    body: "Cada saída guarda o motivo — alvo, stop, tempo ou manual. O journal e o analytics são calculados a partir disso, sem número inventado.",
    href: "/journal",
    cta: "Abrir Journal",
  },
];

export function OnboardingWizard({ email }: { email: string }) {
  const dismissed = useFlag(`mrd.onboarded.${email}`);
  const force = useFlag("mrd.wizard.force");

  const rounds = useQuery<RoundRow[]>({
    queryKey: ["mrd", "rounds"],
    queryFn: () => apiGet<RoundRow[]>("/api/rounds"),
    staleTime: 60_000,
  });
  const positions = useQuery<PositionRow[]>({
    queryKey: ["mrd", "positions"],
    queryFn: () => apiGet<PositionRow[]>("/api/positions"),
    staleTime: 60_000,
  });

  const fresh =
    rounds.isSuccess && positions.isSuccess && (rounds.data?.length ?? 0) === 0 && (positions.data?.length ?? 0) === 0;
  const show = dismissed === "0" && (force === "1" || fresh);
  const step = useFlag("mrd.wizard.step");
  const index = Math.min(STEPS.length - 1, Math.max(0, Number(step) || 0));
  const current = STEPS[index];

  if (!show) return null;

  const close = () => {
    write(`mrd.onboarded.${email}`, "1");
    write("mrd.wizard.step", "0");
  };
  const next = () => {
    if (index + 1 >= STEPS.length) close();
    else write("mrd.wizard.step", String(index + 1));
  };
  const back = () => write("mrd.wizard.step", String(Math.max(0, index - 1)));

  return (
    <div className="mrd-modal-backdrop" role="presentation">
      <div className="mrd-modal" role="dialog" aria-modal="true" aria-label="Primeiros passos">
        <div className="mrd-modal-hd">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <h2>{current.title}</h2>
            <span className="mrd-dim" style={{ fontSize: 11 }}>
              {index + 1} / {STEPS.length}
            </span>
          </div>
          <div className="mrd-dim" style={{ fontSize: 12, marginTop: 4 }}>
            Bem-vindo ao Auto Trader, {email.split("@")[0]}. Três coisas para começar bem.
          </div>
        </div>
        <div className="mrd-modal-body" style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {STEPS.map((s, i) => (
              <span
                key={s.title}
                style={{
                  height: 3,
                  flex: 1,
                  borderRadius: 99,
                  background: i <= index ? "var(--brand)" : "var(--surface-3)",
                }}
              />
            ))}
          </div>
          <p className="mrd-muted" style={{ fontSize: 13, lineHeight: 1.65 }}>{current.body}</p>
          <Link href={current.href} className="mrd-btn mrd-btn-secondary mrd-btn-sm" style={{ width: "fit-content" }} onClick={close}>
            {current.cta} <Icon name="up" size={14} />
          </Link>
        </div>
        <div className="mrd-modal-foot" style={{ justifyContent: "space-between" }}>
          <button type="button" className="mrd-btn mrd-btn-ghost mrd-btn-sm" onClick={close}>
            Pular
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {index > 0 ? (
              <button type="button" className="mrd-btn mrd-btn-ghost mrd-btn-sm" onClick={back}>
                Voltar
              </button>
            ) : null}
            <button type="button" className="mrd-btn mrd-btn-primary mrd-btn-sm" onClick={next}>
              {index + 1 === STEPS.length ? "Concluir" : "Próximo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
