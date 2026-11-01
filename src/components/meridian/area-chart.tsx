"use client";

import { useMemo, useState } from "react";
import { money } from "@/lib/meridian/format";

interface Point {
  t: number;
  v: number;
}

export function AreaChart({
  data,
  height = 220,
  format = (v: number) => money(v),
  label = "Equity curve",
  color = "var(--positive)",
  emptyLabel = "No snapshots in this window",
}: {
  data: Point[];
  height?: number;
  format?: (v: number) => string;
  label?: string;
  color?: string;
  emptyLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760;
  const H = height;
  const padL = 46;
  const padR = 10;
  const padT = 12;
  const padB = 24;

  const geom = useMemo(() => {
    if (data.length < 2) return null;
    const vals = data.map((d) => d.v);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const lo = min - span * 0.08;
    const hi = max + span * 0.08;
    const iw = W - padL - padR;
    const ih = H - padT - padB;
    const x = (i: number) => padL + (i / (data.length - 1)) * iw;
    const y = (v: number) => padT + ih - ((v - lo) / (hi - lo)) * ih;
    const pts = data.map((d, i) => [x(i), y(d.v)] as const);
    let path = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const t = 0.2;
      const c1x = p1[0] + (p2[0] - p0[0]) * t;
      const c1y = p1[1] + (p2[1] - p0[1]) * t;
      const c2x = p2[0] - (p3[0] - p1[0]) * t;
      const c2y = p2[1] - (p3[1] - p1[1]) * t;
      path += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    const area = `${path} L${x(data.length - 1)},${padT + ih} L${padL},${padT + ih} Z`;
    const grid = [0, 1, 2, 3, 4].map((i) => ({ v: lo + ((hi - lo) * i) / 4, y: y(lo + ((hi - lo) * i) / 4) }));
    return { path, area, grid, x, y, iw, ih };
  }, [data, H]);

  if (!geom) {
    return (
      <div className="mrd-empty" style={{ padding: "32px 12px" }}>
        <p>{emptyLabel}</p>
      </div>
    );
  }

  const gid = "mrd-grad";
  const active = hover !== null && hover >= 0 && hover < data.length ? hover : null;

  return (
    <div className="mrd-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ height: "auto" }}
        role="img"
        aria-label={label}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const rel = ((e.clientX - rect.left) / rect.width) * W;
          const idx = Math.round(((rel - padL) / geom.iw) * (data.length - 1));
          setHover(Math.max(0, Math.min(data.length - 1, idx)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="70%" stopColor={color} stopOpacity="0.02" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {geom.grid.map((g, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={g.y} y2={g.y} stroke="var(--chart-grid)" strokeWidth="1" strokeDasharray="2 4" />
            <text x="0" y={g.y + 3.5} fontSize="10" fill="var(--chart-axis)">
              {format(g.v)}
            </text>
          </g>
        ))}
        <path d={geom.area} fill={`url(#${gid})`} />
        <path d={geom.path} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
        {active !== null ? (
          <g>
            <line x1={geom.x(active)} x2={geom.x(active)} y1={padT} y2={padT + geom.ih} stroke="var(--chart-axis)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            <circle cx={geom.x(active)} cy={geom.y(data[active].v)} r="3.5" fill={color} stroke="var(--bg)" strokeWidth="2" />
          </g>
        ) : null}
      </svg>
      {active !== null ? (
        <div
          className="mrd-chart-tip"
          style={{
            display: "block",
            left: `${(geom.x(active) / W) * 100}%`,
            top: `${(geom.y(data[active].v) / H) * 100}%`,
          }}
        >
          <b>{format(data[active].v)}</b>
          <span className="mrd-dim">{new Date(data[active].t).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      ) : null}
    </div>
  );
}

