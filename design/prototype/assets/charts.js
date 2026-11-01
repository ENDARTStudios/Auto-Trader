/* charts.js — dependency-free SVG charts */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function smoothPath(pts, tension = 0.22) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * tension;
    const c1y = p1[1] + (p2[1] - p0[1]) * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension;
    const c2y = p2[1] - (p3[1] - p1[1]) * tension;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

export function mountAreaChart(host, opts) {
  const {
    data,
    bench = null,
    w: fixedW = null,
    h = 250,
    padL = 46,
    padR = 8,
    padT = 12,
    padB = 26,
    tone = "pos",
    labels = null,
    valueFmt = (v) => v.toFixed(0),
    fill = true,
  } = opts;
  const w = fixedW || Math.max(320, Math.round(host.clientWidth || 780));
  const all = bench ? data.concat(bench) : data;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const lo = min - span * 0.08;
  const hi = max + span * 0.08;
  const iw = w - padL - padR;
  const ih = h - padT - padB;
  const x = (i) => padL + (i / (data.length - 1)) * iw;
  const y = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;
  const pts = data.map((v, i) => [x(i), y(v)]);
  const line = smoothPath(pts);
  const area = `${line} L${x(data.length - 1)},${padT + ih} L${padL},${padT + ih} Z`;
  const gid = "g" + Math.random().toString(36).slice(2, 8);
  const color = tone === "neg" ? "var(--neg)" : "var(--pos)";

  const gridY = [];
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    gridY.push({ v, y: y(v) });
  }

  const labelsX = labels || [];
  const step = Math.ceil(data.length / 7);

  host.innerHTML = `
  <div class="chart" data-chart>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:${h}px" role="img" aria-label="Equity curve">
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${tone === "neg" ? "#FF6B81" : "#3DDC97"}" stop-opacity="0.28"/>
          <stop offset="70%" stop-color="${tone === "neg" ? "#FF6B81" : "#3DDC97"}" stop-opacity="0.02"/>
          <stop offset="100%" stop-color="${tone === "neg" ? "#FF6B81" : "#3DDC97"}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <g class="chart-grid">${gridY.map((g) => `<line x1="${padL}" x2="${w - padR}" y1="${g.y}" y2="${g.y}"/>`).join("")}</g>
      ${gridY
        .map(
          (g) =>
            `<text class="axis-label" x="0" y="${g.y + 3.5}" font-size="10">${valueFmt(g.v)}</text>`
        )
        .join("")}
      ${bench ? `<path d="${smoothPath(bench.map((v, i) => [x(i), y(v)]))}" fill="none" stroke="var(--text-3)" stroke-width="1.2" stroke-dasharray="3 4" opacity="0.7" vector-effect="non-scaling-stroke"/>` : ""}
      ${fill ? `<path d="${area}" fill="url(#${gid})"/>` : ""}
      <path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
      <line data-cross x1="0" x2="0" y1="${padT}" y2="${padT + ih}" stroke="var(--text-3)" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>
      <circle data-dot r="3.5" fill="${color}" stroke="var(--bg)" stroke-width="2" opacity="0"/>
      ${labelsX.length ? labelsX.map((l, i) => `<text class="axis-label" x="${x(i)}" y="${h - 6}" font-size="10" text-anchor="middle">${l}</text>`).join("") : ""}
    </svg>
    <div class="chart-tip" data-tip></div>
  </div>`;

  const svg = host.querySelector("svg");
  const tip = host.querySelector("[data-tip]");
  const cross = host.querySelector("[data-cross]");
  const dot = host.querySelector("[data-dot]");

  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const rel = ((e.clientX - r.left) / r.width) * w;
    const i = clamp(Math.round(((rel - padL) / iw) * (data.length - 1)), 0, data.length - 1);
    const px = (x(i) / w) * r.width;
    const py = (y(data[i]) / h) * r.height;
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("opacity", "0.55");
    dot.setAttribute("cx", x(i));
    dot.setAttribute("cy", y(data[i]));
    dot.setAttribute("opacity", "1");
    tip.style.display = "block";
    tip.style.left = `${px}px`;
    tip.style.top = `${py}px`;
    tip.innerHTML = `<b>${valueFmt(data[i])}</b><span class="dim">${labelsX[i] || "day " + (i + 1)}</span>`;
  });
  svg.addEventListener("pointerleave", () => {
    cross.setAttribute("opacity", "0");
    dot.setAttribute("opacity", "0");
    tip.style.display = "none";
  });

  if (!host.__chartRO && typeof ResizeObserver !== "undefined") {
    let last = w;
    host.__chartRO = new ResizeObserver(() => {
      const nw = Math.round(host.clientWidth || 0);
      if (nw > 0 && Math.abs(nw - last) > 10) {
        last = nw;
        mountAreaChart(host, { ...opts, w: nw });
      }
    });
    host.__chartRO.observe(host);
  }
}

export function spark(data, { w = 120, h = 34, tone = "pos", fill = false, strokeWidth = 1.6 } = {}) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * (w - 2) + 1,
    h - 2 - ((v - min) / span) * (h - 4),
  ]);
  const line = smoothPath(pts);
  const color = tone === "neg" ? "var(--neg)" : "var(--pos)";
  const gid = "s" + Math.random().toString(36).slice(2, 8);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:${h}px" aria-hidden="true">
    ${fill ? `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${tone === "neg" ? "#FF6B81" : "#3DDC97"}" stop-opacity="0.25"/><stop offset="100%" stop-color="${tone === "neg" ? "#FF6B81" : "#3DDC97"}" stop-opacity="0"/></linearGradient></defs><path d="${line} L${w - 1},${h} L1,${h} Z" fill="url(#${gid})"/>` : ""}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" vector-effect="non-scaling-stroke" stroke-linecap="round"/>
  </svg>`;
}

export function candles(list, { w = 760, h = 250, tone = "pos" } = {}) {
  const lows = list.map((c) => c.l);
  const highs = list.map((c) => c.h);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || 1;
  const padL = 8;
  const padR = 46;
  const padT = 10;
  const padB = 22;
  const iw = w - padL - padR;
  const ih = h - padT - padB;
  const cw = iw / list.length;
  const y = (v) => padT + ih - ((v - min) / span) * ih;
  const body = list
    .map((c, i) => {
      const up = c.c >= c.o;
      const col = up ? "var(--pos)" : "var(--neg)";
      const x = padL + i * cw + cw * 0.18;
      const bw = Math.max(1.6, cw * 0.64);
      const top = y(Math.max(c.o, c.c));
      const bh = Math.max(1, Math.abs(y(c.o) - y(c.c)));
      return `<g><line x1="${x + bw / 2}" x2="${x + bw / 2}" y1="${y(c.h)}" y2="${y(c.l)}" stroke="${col}" stroke-width="1" opacity="0.8"/>
      <rect x="${x}" y="${top}" width="${bw}" height="${bh}" rx="0.8" fill="${col}" opacity="${up ? 0.85 : 0.9}"/></g>`;
    })
    .join("");
  const vol = list
    .map((c, i) => {
      const x = padL + i * cw + cw * 0.18;
      const bw = Math.max(1.6, cw * 0.64);
      const vh = (c.v / Math.max(...list.map((k) => k.v))) * ih * 0.18;
      return `<rect x="${x}" y="${padT + ih - vh}" width="${bw}" height="${vh}" fill="${c.c >= c.o ? "var(--pos)" : "var(--neg)"}" opacity="0.14"/>`;
    })
    .join("");
  const yl = [0, 1, 2, 3, 4].map((i) => {
    const v = min + (span * i) / 4;
    return `<text class="axis-label" x="${w - padR + 8}" y="${y(v) + 3.5}" font-size="10">${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(1)}</text>`;
  });
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="height:${h}px" role="img" aria-label="Price chart">
    <g class="chart-grid">${[0, 1, 2, 3, 4].map((i) => { const v = min + (span * i) / 4; return `<line x1="${padL}" x2="${w - padR}" y1="${y(v)}" y2="${y(v)}"/>`; }).join("")}</g>
    ${vol}${body}${yl.join("")}
  </svg>`;
}

export function donut(segments, { size = 132, thickness = 14 } = {}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const rings = segments
    .map((s) => {
      const len = (s.value / total) * c;
      const off = -acc;
      acc += len;
      return `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thickness}" stroke-dasharray="${len - 2} ${c - len + 2}" stroke-dashoffset="${off}" transform="rotate(-90 ${size / 2} ${size / 2})" stroke-linecap="round"/>`;
    })
    .join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${rings}</svg>`;
}

export function gauge(value, { size = 120, label = "" } = {}) {
  const r = 46;
  const c = Math.PI * r;
  const p = clamp(value, 0, 1);
  return `<svg width="${size}" height="${size * 0.62}" viewBox="0 0 120 74" aria-hidden="true">
    <path d="M14 64 A46 46 0 0 1 106 64" fill="none" stroke="var(--surface-3)" stroke-width="9" stroke-linecap="round"/>
    <path d="M14 64 A46 46 0 0 1 106 64" fill="none" stroke="var(--brand)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c * p} ${c}"/>
    <text x="60" y="58" text-anchor="middle" font-size="17" font-weight="600" fill="var(--text)">${label}</text>
  </svg>`;
}

export function bars(values, { h = 92 } = {}) {
  const max = Math.max(...values.map((v) => Math.abs(v))) || 1;
  return values
    .map((v) => {
      const pct = (Math.abs(v) / max) * 100;
      return `<i class="${v >= 0 ? "pos" : "neg"}" style="height:${Math.max(3, pct)}%" title="${v}"></i>`;
    })
    .join("");
}

export function depthChart({ w = 300, h = 110 } = {}) {
  const bids = [12, 18, 26, 35, 52, 74, 96, 132, 190, 260];
  const asks = [14, 20, 30, 44, 58, 80, 112, 150, 210, 290];
  const max = Math.max(...bids, ...asks);
  const half = (w - 10) / 2;
  const path = (arr, dir) =>
    arr
      .map((v, i) => `${i === 0 ? "M" : "L"}${10 + dir * ((i / (arr.length - 1)) * half)},${h - 8 - (v / max) * (h - 20)}`)
      .join("");
  return `<svg viewBox="0 0 ${w} ${h}" style="height:${h}px;width:100%" aria-hidden="true">
    <path d="${path(bids, 1)} L${10 + half},${h - 8} L10,${h - 8} Z" fill="var(--pos)" opacity="0.16"/>
    <path d="${path(bids, 1)}" fill="none" stroke="var(--pos)" stroke-width="1.4"/>
    <path d="${path(asks, -1)} L${w - 10},${h - 8} L${w / 2},${h - 8} Z" fill="var(--neg)" opacity="0.14"/>
    <path d="${path(asks, -1)}" fill="none" stroke="var(--neg)" stroke-width="1.4"/>
    <line x1="${w / 2}" x2="${w / 2}" y1="8" y2="${h - 8}" stroke="var(--line-strong)" stroke-dasharray="3 3"/>
  </svg>`;
}
