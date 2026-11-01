import type { ReactNode } from "react";

type Tone = "pos" | "neg" | "warn" | "brand" | "neutral";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className="mrd-badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral", live = false }: { tone?: Tone; live?: boolean }) {
  return <span className="mrd-dot" data-tone={tone} data-live={live || undefined} aria-hidden="true" />;
}

export function Delta({ value, suffix = "%", dp = 2 }: { value: number; suffix?: string; dp?: number }) {
  const v = Number.isFinite(value) ? value : 0;
  const tone = v > 0 ? "mrd-pos" : v < 0 ? "mrd-neg" : "mrd-muted";
  return (
    <span className={`mrd-delta ${tone}`}>
      {v > 0 ? "↗" : v < 0 ? "↘" : "→"} {v > 0 ? "+" : v < 0 ? "−" : ""}
      {Math.abs(v).toFixed(dp)}
      {suffix}
    </span>
  );
}

export function Card({
  title,
  sub,
  actions,
  children,
  className = "",
  bodyClassName = "mrd-card-body",
  border = false,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  border?: boolean;
}) {
  return (
    <section className={`mrd-card ${className}`}>
      {title || actions ? (
        <div className="mrd-card-hd" data-border={border || undefined}>
          <div>
            <div className="mrd-card-title">{title}</div>
            {sub ? <div className="mrd-card-sub">{sub}</div> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children ? <div className={bodyClassName}>{children}</div> : null}
    </section>
  );
}

export function Kpi({
  label,
  value,
  foot,
  valueClassName = "",
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="mrd-kpi">
      <div className="mrd-kpi-label">{label}</div>
      <div className={`mrd-kpi-value ${valueClassName}`}>{value}</div>
      <div className="mrd-kpi-foot">{foot}</div>
    </div>
  );
}

export function Meter({ value, tone = "brand", label }: { value: number; tone?: "brand" | "pos" | "warn" | "neg"; label: string }) {
  const p = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      className="mrd-meter"
      data-tone={tone === "brand" ? undefined : tone}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(p)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ "--p": (p / 100).toFixed(3) } as React.CSSProperties} />
    </div>
  );
}

export function Ring({ value, label }: { value: number; label?: string }) {
  const p = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div className="mrd-ring" style={{ "--p": p } as React.CSSProperties} aria-hidden="true">
      <b>{label ?? `${Math.round(p * 100)}%`}</b>
    </div>
  );
}

export function Skeleton({ width = "100%", height = 12, className = "" }: { width?: string | number; height?: number; className?: string }) {
  return <div className={`mrd-skeleton ${className}`} style={{ width, height }} aria-hidden="true" />;
}

export function Empty({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mrd-empty">
      {icon ?? (
        <svg viewBox="0 0 120 88" fill="none" aria-hidden="true">
          <rect x="12" y="16" width="96" height="56" rx="8" stroke="currentColor" strokeOpacity=".28" strokeDasharray="4 5" />
          <path d="M30 54l14-14 10 10 16-20 12 14" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="60" cy="44" r="20" stroke="currentColor" strokeOpacity=".16" />
        </svg>
      )}
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="mrd-empty-actions">{action}</div> : null}
    </div>
  );
}

export function AssetIcon({ symbol, color, size = 26 }: { symbol: string; color: string; size?: number }) {
  return (
    <span
      className="mrd-asset-ico"
      style={{ width: size, height: size, fontSize: Math.max(8, size / 2.6), background: `linear-gradient(145deg, ${color}, ${color}99)` }}
      aria-hidden="true"
    >
      {symbol.slice(0, 3)}
    </span>
  );
}

export const SYMBOL_COLORS: Record<string, string> = {
  BTC: "#F7931A",
  ETH: "#627EEA",
  SOL: "#14F195",
  BNB: "#F3BA2F",
  ARB: "#28A0F0",
  TIA: "#7B2BF9",
  JUP: "#C7F284",
  USDT: "#26A17B",
  USDC: "#2775CA",
};

export const colorFor = (symbol: string) => SYMBOL_COLORS[symbol.replace(/USDT$/, "")] ?? "#3A4250";
