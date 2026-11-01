/* figcraft-build.mjs — generates the Meridian design file */
import { drawExtra } from "./screens-extra.mjs";
import { Doc, C, FONT, chrome, pageTitle, card, button, badge, statsRow, logoSymbol, areaPath, series, writeScript } from "./figcraft-lib.mjs";

const doc = new Doc();
doc.add("page.rename", { name: "Meridian — screens" });

const SW = [
  ["Canvas", C.bg], ["Surface 1", C.s1], ["Surface 2", C.s2], ["Surface 3", C.s3],
  ["Line", C.line], ["Text", C.text], ["Text 2", C.t2], ["Text 3", C.t3],
  ["Brand", C.brand], ["Profit", C.pos], ["Loss", C.neg], ["Warning", C.warn],
];

/* ============================== COVER ============================== */
{
  const f = doc.frame("00 · Cover", 0, 0, 1440, 900, { fill: C.bg });
  doc.rect(f, 0, 0, 1440, 900, {
    fill: { type: "radialGradient", stops: ["#171B45", "#0A0B0D"] },
    name: "glow",
  });
  logoSymbol(doc, f, 96, 88, 44);
  doc.text(f, 154, 96, "Auto Trader", { size: 18, weight: "Semi Bold", track: -0.4 });
  doc.label(f, 154, 118, "Meridian design system", { size: 9.5, color: C.t3 });

  doc.text(f, 96, 300, "The quiet", { family: FONT.display, size: 88, color: C.text, track: -1.5 });
  doc.text(f, 96, 392, "advantage.", { family: FONT.display, size: 88, color: C.brand, track: -1.5 });
  doc.text(f, 96, 512, "A complete UI/UX concept for autonomous crypto trading —", { size: 15, color: C.t2 });
  doc.text(f, 96, 534, "risk-first, fully explained, and calm under pressure.", { size: 15, color: C.t2 });
  doc.line(f, 96, 588, 120, { color: C.brand, h: 3 });

  const cols = [
    ["Scope", ["22 screens", "Primary + mobile", "Light & dark", "All states"]],
    ["Principles", ["Calm by default", "Numbers are the product", "Explain before asking", "One question per screen"]],
    ["Deliverables", ["Prototype (HTML)", "Figma-style file", "Design tokens", "Implementation map"]],
  ];
  cols.forEach(([title, items], i) => {
    const x = 96 + i * 300;
    doc.label(f, x, 640, title, { size: 9, color: C.t3 });
    items.forEach((it, j) => doc.text(f, x, 666 + j * 24, it, { size: 13, color: C.text }));
  });

  doc.text(f, 96, 848, "v1.0.0 · 01 Nov 2026 · Prototype, FigCraft, VectorCraft, DeckCraft", { size: 10, color: C.t3 });
  doc.text(f, 1180, 848, "1440 × 900", { size: 10, color: C.t3, align: "right" });
}

/* ============================ FOUNDATIONS ========================== */
{
  const f = doc.frame("01 · Foundations", 1540, 0, 1440, 900);
  pageTitle(doc, f, 48, 48, "Foundations", "Semantic colour, one type scale, an 4px rhythm and a strict radius system. Brand never means profit.");

  doc.label(f, 48, 132, "Colour · dark theme", { size: 9, color: C.t3 });
  SW.forEach(([name, hex], i) => {
    const col = i % 6;
    const row = Math.floor(i / 6);
    const x = 48 + col * 224;
    const y = 156 + row * 110;
    doc.rect(f, x, y, 206, 54, { fill: hex, stroke: C.line, radius: 8, name: `sw-${name}` });
    doc.text(f, x, y + 62, name, { size: 11, weight: "Medium" });
    doc.text(f, x, y + 78, hex, { size: 9.5, color: C.t3, family: FONT.mono });
  });

  doc.label(f, 48, 400, "Type scale", { size: 9, color: C.t3 });
  const types = [
    ["Display / Cambria", "The quiet advantage", 40, FONT.display, "Regular"],
    ["H1 / Inter", "Mission control", 28, FONT.ui, "Semi Bold"],
    ["H2", "Portfolio", 20, FONT.ui, "Semi Bold"],
    ["Body", "Autonomous engine scanning 18 pairs.", 13, FONT.ui, "Regular"],
    ["Caption", "UNREALIZED P&L", 10, FONT.ui, "Medium"],
    ["Numeric", "24,812.44", 28, FONT.ui, "Semi Bold"],
  ];
  types.forEach(([name, sample, size, family, weight], i) => {
    const y = 426 + i * 52;
    doc.text(f, 48, y, sample, {
      size,
      family,
      weight,
      color: i === 4 ? C.t3 : C.text,
      ...(i === 4 ? { upper: true, track: 0.6 } : {}),
    });
    doc.text(f, 470, y + (size > 20 ? 12 : 2), name, { size: 9.5, color: C.t3 });
  });

  doc.label(f, 620, 132, "Spacing · 4px base", { size: 9, color: C.t3 });
  [4, 8, 12, 16, 24, 32, 48].forEach((s, i) => {
    const y = 160 + i * 32;
    doc.text(f, 620, y, String(s), { size: 9.5, color: C.t3, family: FONT.mono });
    doc.rect(f, 660, y + 2, s * 4, 10, { fill: C.brandSoft, stroke: C.brand, strokeWeight: 1, radius: 2 });
  });

  doc.label(f, 960, 132, "Radius", { size: 9, color: C.t3 });
  [6, 8, 12, 16, 20].forEach((r, i) => {
    const x = 960 + i * 92;
    doc.rect(f, x, 158, 76, 52, { fill: C.s2, stroke: C.line2, radius: r, name: `radius-${r}` });
    doc.text(f, x + 26, 220, `r ${r}`, { size: 10, color: C.t3 });
  });

  doc.label(f, 960, 270, "Components", { size: 9, color: C.t3 });
  button(doc, f, 960, 296, "Primary", { primary: true });
  button(doc, f, 1060, 296, "Secondary");
  button(doc, f, 1176, 296, "Ghost", { w: 74 });
  button(doc, f, 1266, 296, "Danger", { w: 82 });
  badge(doc, f, 960, 344, "profit", { tone: "pos" });
  badge(doc, f, 1024, 344, "loss", { tone: "neg" });
  badge(doc, f, 1082, 344, "watch", { tone: "warn" });
  badge(doc, f, 1144, 344, "brand", { tone: "brand" });
  badge(doc, f, 1206, 344, "critical", { tone: "crit" });

  doc.label(f, 960, 392, "Data display", { size: 9, color: C.t3 });
  card(doc, f, 960, 416, 430, 168);
  doc.text(f, 980, 434, "ASSET", { size: 8.5, color: C.t3, track: 0.6 });
  doc.text(f, 1100, 434, "PRICE", { size: 8.5, color: C.t3, track: 0.6 });
  doc.text(f, 1230, 434, "24H", { size: 8.5, color: C.t3, track: 0.6 });
  doc.text(f, 1310, 434, "WEIGHT", { size: 8.5, color: C.t3, track: 0.6 });
  doc.line(f, 980, 452, 390, { color: C.line });
  [
    ["SOL/USDT", "208.44", "+6.12%", "34.1%", C.pos],
    ["BTC/USDT", "96,420.18", "+2.41%", "24.9%", C.pos],
    ["PEPE/USDT", "0.0000112", "+24.6%", "0%", C.warn],
  ].forEach(([a, p, c, w, tone], i) => {
    const y = 468 + i * 36;
    doc.text(f, 980, y, a, { size: 11, weight: "Medium" });
    doc.text(f, 1100, y, p, { size: 11 });
    doc.text(f, 1230, y, c, { size: 11, color: tone });
    doc.text(f, 1310, y, w, { size: 11, color: C.t2 });
    if (i < 2) doc.line(f, 980, y + 22, 390, { color: C.line });
  });

  doc.label(f, 48, 800, "Rules", { size: 9, color: C.t3 });
  ["One primary action per screen", "No colour without meaning", "Explain before asking"].forEach((r, i) =>
    doc.text(f, 48 + i * 300, 824, `— ${r}`, { size: 11.5, color: C.t2 })
  );
}

/* ============================== OVERVIEW ============================ */
{
  const f = doc.frame("02 · Overview", 0, 1000, 1440, 900);
  const { x, y, w } = chrome(doc, f, { active: "Overview", crumb: "Overview" });
  doc.rect(f, x - 2, y - 12, 46, 18, { fill: "rgba(245,180,84,0.12)", radius: 5 });
  doc.text(f, x + 6, y - 9, "Paper", { size: 9, weight: "Semi Bold", color: C.warn });
  doc.text(f, x + 54, y - 9, "Engine running · round 4,128", { size: 9, color: C.t3 });

  pageTitle(doc, f, x, y + 12, "Mission control", "Autonomous engine scanning 18 pairs. 4 open positions, 75.4% exposure, no unresolved risk events.", { w: 620 });
  button(doc, f, 1048, y + 12, "Export", { w: 84 });
  button(doc, f, 1140, y + 12, "New backtest", { w: 116 });
  button(doc, f, 1266, y + 12, "Pause engine", { primary: true, w: 120 });

  // banner
  doc.rect(f, x, y + 92, w, 40, { fill: "rgba(91,108,255,0.10)", stroke: "rgba(91,108,255,0.35)", radius: 8, name: "banner" });
  doc.text(f, x + 14, y + 105, "Paper mode — real prices, zero capital at risk. Live unlocks after 50 positive cycles · 12/50 completed.", { size: 11, color: "#B9C2FF" });
  doc.text(f, 1244, y + 105, "Graduation rules →", { size: 11, color: "#B9C2FF" });

  // equity card
  card(doc, f, x, y + 148, 760, 430);
  doc.text(f, x + 20, y + 168, "Portfolio equity", { size: 13, weight: "Semi Bold" });
  doc.text(f, x + 20, y + 186, "Net of fees · updated 4s ago", { size: 10, color: C.t3 });
  badge(doc, f, x + 596, y + 166, "USD", { tone: "neutral" });
  ["1W", "1M", "3M", "ALL"].forEach((r, i) => {
    const rx = x + 648 + i * 26;
    if (r === "1M") doc.rect(f, rx - 4, y + 163, 30, 22, { fill: C.s3, radius: 5 });
    doc.text(f, rx, y + 169, r, { size: 9.5, color: r === "1M" ? C.text : C.t3 });
  });

  doc.text(f, x + 20, y + 218, "$24,812.44", { size: 40, weight: "Semi Bold", track: -1 });
  doc.text(f, x + 250, y + 244, "USD", { size: 14, color: C.t3 });
  doc.text(f, x + 296, y + 240, "+$3,128.19 · +14.42%", { size: 11.5, color: C.pos });

  ["Initial $10,000.00", "Peak $25,904.12", "Max drawdown −4.22%", "Benchmark +8.12%"].forEach((m, i) => {
    doc.text(f, x + 20 + i * 168, y + 278, m, { size: 10, color: i === 2 ? C.neg : C.t3 });
  });

  // chart
  const vals = series(30, 18400, 0.0042, 0.02, 11);
  const chartW = 660;
  const chartH = 210;
  const cy = y + 310;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min;
  [0, 1, 2, 3].forEach((i) => {
    const gy = cy + (i * chartH) / 3;
    doc.line(f, x + 60, gy, chartW - 16, { color: C.line, h: 1 });
    doc.text(f, x + 20, gy - 5, `$${((max - (span * i) / 3) / 1000).toFixed(1)}K`, { size: 8.5, color: C.t3 });
  });
  const d = areaPath(vals, chartW - 20, chartH);
  doc.path(f, x + 60, cy, chartW - 20, chartH, d, { stroke: C.pos, weight: 2 });
  doc.text(f, x + 20, y + 540, "Auto Trader", { size: 9.5, color: C.t3 });
  doc.text(f, x + 118, y + 540, "BTC benchmark (dashed)", { size: 9.5, color: C.t3 });

  // engine card
  card(doc, f, x + 776, y + 148, w - 776, 190);
  doc.text(f, x + 796, y + 166, "Engine", { size: 13, weight: "Semi Bold" });
  badge(doc, f, x + 856, y + 164, "running", { tone: "pos" });
  doc.text(f, x + 796, y + 184, "Scout → decision → risk → execute", { size: 10, color: C.t3 });
  doc.circle(f, x + 800, y + 210, 46, { fill: C.s2, stroke: C.brand, strokeWeight: 3 });
  doc.text(f, x + 810, y + 226, "72%", { size: 12, weight: "Semi Bold" });
  doc.text(f, x + 862, y + 216, "Round 4,128 · stage 4/5", { size: 12, weight: "Medium" });
  doc.text(f, x + 862, y + 234, "Executing SOL/USDT · next scan in 41s", { size: 10, color: C.t3 });
  for (let i = 0; i < 5; i++) {
    doc.rect(f, x + 796 + i * 74, y + 282, 68, 4, { fill: i < 3 ? C.brand : i === 3 ? "#3B478F" : C.s3, radius: 99 });
    doc.text(f, x + 796 + i * 74, y + 292, ["SCAN", "SCORE", "RISK", "EXECUTE", "LOG"][i], { size: 7.5, color: C.t3, track: 0.5 });
  }

  // decision card
  card(doc, f, x + 776, y + 354, w - 776, 224, { fill: "#111427", stroke: "rgba(91,108,255,0.35)" });
  doc.text(f, x + 796, y + 372, "AI decision", { size: 13, weight: "Semi Bold" });
  badge(doc, f, x + 890, y + 370, "2m ago", { tone: "neutral" });
  doc.text(f, x + 796, y + 398, "LONG  SOL/USDT", { size: 19, weight: "Semi Bold", track: -0.4 });
  doc.text(f, x + 796, y + 424, "Momentum Breakout · size $8,420 · stop $186.40", { size: 10, color: C.t2 });
  doc.circle(f, x + 1026, y + 396, 46, { fill: C.s2, stroke: C.brand, strokeWeight: 3 });
  doc.text(f, x + 1038, y + 412, "78", { size: 12, weight: "Semi Bold" });
  [
    ["Liquidity", "$28.4M"],
    ["Token authority", "renounced"],
    ["Sell simulation", "passed"],
    ["Exposure budget", "75.4% / 80%"],
  ].forEach(([k, v], i) => {
    const gy = y + 454 + i * 24;
    doc.circle(f, x + 798, gy + 3, 10, { fill: "rgba(61,220,151,0.15)", stroke: C.pos, strokeWeight: 1 });
    doc.text(f, x + 814, gy, k, { size: 10.5, color: C.t2 });
    doc.text(f, x + 1030, gy, v, { size: 10, color: C.t3, align: "right", w: 70 });
  });
  doc.rect(f, x + 796, y + 550, w - 816, 30, { fill: C.s1, stroke: C.line2, radius: 8 });
  doc.text(f, x + 920, y + 559, "Why this trade?", { size: 10.5, weight: "Medium" });

  // KPI row
  statsRow(doc, f, x, y + 592, w, [
    ["Equity", "$24,812.44", "+$14,812.44 all-time"],
    ["30d P&L", "$3,128.19", "+14.42% vs bench +8.1%", C.pos],
    ["Win rate", "61.8%", "92W · 56L · 148 trades"],
    ["Sharpe", "1.84", "30d · non-annualized"],
    ["Exposure", "75.4%", "$18,692 of $24,812"],
    ["Open positions", "4", "SOL · BTC · ETH · ARB"],
  ], { h: 96 });
}

/* =============================== MARKETS =========================== */
{
  const f = doc.frame("03 · Markets", 1540, 1000, 1440, 900);
  const { x, y, w } = chrome(doc, f, { active: "Markets", crumb: "Markets" });
  pageTitle(doc, f, x, y + 12, "Markets", "18 pairs across 3 venues, ranked by opportunity score. Scanner refreshes every 30 seconds.", { w: 560 });
  button(doc, f, 1100, y + 12, "Export", { w: 84 });
  button(doc, f, 1192, y + 12, "Filters", { w: 84 });
  button(doc, f, 1284, y + 12, "Add pair", { primary: true, w: 104 });

  // stats strip
  const stats = [
    ["Fear & Greed", "72", "+4 · Greed 7d"],
    ["BTC dominance", "54.2%", "+0.3 · 24h"],
    ["Total market cap", "$3.42T", "+1.8% · 24h"],
    ["Funding (avg)", "0.011%", "−0.002 · 8h"],
    ["Open interest", "$68.4B", "+2.4% · 24h"],
  ];
  doc.rect(f, x, y + 96, w, 76, { fill: C.s1, stroke: C.line, radius: 12 });
  stats.forEach(([l, v, f2], i) => {
    const cx = x + i * (w / 5);
    if (i > 0) doc.line(f, cx, y + 108, 1, { color: C.line, h: 52 });
    doc.text(f, cx + 16, y + 110, l, { size: 10, color: C.t3 });
    doc.text(f, cx + 16, y + 128, v, { size: 18, weight: "Semi Bold", track: -0.3 });
    doc.text(f, cx + 16, y + 154, f2, { size: 9.5, color: C.t3 });
  });

  // table card
  card(doc, f, x, y + 188, 820, 470);
  doc.text(f, x + 20, y + 204, "Scanner", { size: 13, weight: "Semi Bold" });
  ["All", "Watchlist", "Positions", "Rejected"].forEach((t, i) => {
    const tx = x + 96 + i * (i === 0 ? 0 : 74);
    if (i === 0) doc.rect(f, tx - 8, y + 198, 40, 24, { fill: C.s3, radius: 6 });
    doc.text(f, x + 96 + [0, 40, 118, 194][i], y + 204, t, { size: 10, color: i === 0 ? C.text : C.t3 });
  });
  doc.rect(f, x + 620, y + 198, 180, 26, { fill: C.s1, stroke: C.line2, radius: 6 });
  doc.text(f, x + 632, y + 205, "Filter pairs", { size: 9.5, color: C.t3 });

  const heads = ["ASSET", "PRICE", "5M", "24H", "VOLUME", "SPREAD", "LIQUIDITY", "RISK", "SCORE"];
  const xs = [20, 206, 292, 358, 436, 520, 596, 690, 770];
  heads.forEach((h, i) => doc.text(f, x + xs[i], y + 244, h, { size: 8, color: C.t3, track: 0.5 }));
  doc.line(f, x, y + 260, 820, { color: C.line });

  const rows = [
    ["BTC/USDT", "96,420.18", "+0.18%", "+2.41%", "1.24B", "0.01%", "98.4M", "low", "94"],
    ["ETH/USDT", "3,418.72", "+0.42%", "+1.86%", "684M", "0.02%", "62.1M", "low", "91"],
    ["SOL/USDT", "208.44", "+1.24%", "+6.12%", "312M", "0.03%", "28.4M", "mid", "82"],
    ["BNB/USDT", "662.11", "−0.21%", "−0.84%", "184M", "0.02%", "19.2M", "low", "88"],
    ["ARB/USDT", "0.9184", "−0.62%", "−3.42%", "96M", "0.04%", "8.4M", "mid", "71"],
    ["TIA/USDT", "5.41", "+2.06%", "+11.80%", "74M", "0.06%", "4.1M", "high", "58"],
    ["JUP/USDT", "1.08", "+0.44%", "+3.94%", "51M", "0.05%", "6.8M", "mid", "76"],
  ];
  rows.forEach((r, i) => {
    const ry = y + 280 + i * 44;
    doc.circle(f, x + 20, ry - 3, 26, { fill: C.s3, name: "asset" });
    doc.text(f, x + 26, ry + 3, r[0].slice(0, 3), { size: 8, weight: "Bold", color: C.t2 });
    doc.text(f, x + 54, ry - 8, r[0], { size: 10.5, weight: "Medium" });
    doc.text(f, x + 54, ry + 6, r[0].slice(0, 3), { size: 9, color: C.t3 });
    doc.text(f, x + 206, ry - 6, r[1], { size: 10.5, weight: "Medium" });
    doc.text(f, x + 292, ry - 6, r[2], { size: 10, color: r[2].startsWith("+") ? C.pos : C.neg });
    doc.text(f, x + 358, ry - 6, r[3], { size: 10, color: r[3].startsWith("+") ? C.pos : C.neg });
    doc.text(f, x + 436, ry - 6, r[4], { size: 10, color: C.t2 });
    doc.text(f, x + 520, ry - 6, r[5], { size: 10, color: C.t2 });
    doc.text(f, x + 596, ry - 6, r[6], { size: 10, color: C.t2 });
    badge(doc, f, x + 682, ry - 11, r[7], { tone: r[7] === "low" ? "pos" : r[7] === "mid" ? "warn" : "neg" });
    doc.text(f, x + 770, ry - 6, r[8], { size: 10, color: C.t2 });
    if (i < rows.length - 1) doc.line(f, x + 20, ry + 26, 780, { color: C.line });
  });
  doc.text(f, x + 20, y + 630, "8 of 18 pairs · sorted by score", { size: 9.5, color: C.t3 });

  // top movers
  card(doc, f, x + 836, y + 188, w - 836, 258);
  doc.text(f, x + 856, y + 204, "Top movers", { size: 13, weight: "Semi Bold" });
  doc.text(f, x + 856, y + 221, "24h · min $20M volume", { size: 9.5, color: C.t3 });
  const movers = [
    ["PEPE", "+24.60%", "412M vol", C.pos],
    ["TIA", "+11.80%", "74M vol", C.pos],
    ["SOL", "+6.12%", "312M vol", C.pos],
    ["JUP", "+3.94%", "51M vol", C.pos],
    ["ARB", "−3.42%", "96M vol", C.neg],
  ];
  movers.forEach(([s, c, v, tone], i) => {
    const ry = y + 246 + i * 38;
    doc.circle(f, x + 856, ry, 24, { fill: C.s3 });
    doc.text(f, x + 861, ry + 7, s.slice(0, 3), { size: 7.5, weight: "Bold", color: C.t2 });
    doc.text(f, x + 890, ry + 1, s, { size: 10.5, weight: "Medium" });
    doc.text(f, x + 890, ry + 14, v, { size: 9, color: C.t3 });
    doc.text(f, x + 1070, ry + 1, c, { size: 10.5, weight: "Semi Bold", color: tone, align: "right", w: 56 });
  });

  // order flow
  card(doc, f, x + 836, y + 462, w - 836, 200);
  doc.text(f, x + 856, y + 478, "Order flow", { size: 13, weight: "Semi Bold" });
  badge(doc, f, x + 1096, y + 476, "SOL/USDT", { tone: "neutral" });
  doc.text(f, x + 856, y + 504, "Buy 62.4%", { size: 9.5, color: C.pos });
  doc.text(f, x + 1040, y + 504, "Sell 37.6%", { size: 9.5, color: C.neg, align: "right", w: 56 });
  doc.rect(f, x + 856, y + 520, 256, 7, { fill: C.s3, radius: 99 });
  doc.rect(f, x + 856, y + 520, 160, 7, { fill: C.pos, radius: 99 });
  doc.text(f, x + 856, y + 546, "Buy volume", { size: 10, color: C.t3 });
  doc.text(f, x + 1060, y + 546, "$4.82M", { size: 10, color: C.pos, align: "right", w: 52 });
  doc.text(f, x + 856, y + 566, "Sell volume", { size: 10, color: C.t3 });
  doc.text(f, x + 1060, y + 566, "$2.91M", { size: 10, color: C.neg, align: "right", w: 52 });
  doc.text(f, x + 856, y + 586, "Depth ±1%", { size: 10, color: C.t3 });
  doc.text(f, x + 1060, y + 586, "$1.24M", { size: 10, align: "right", w: 52 });

  // sentiment
  card(doc, f, x + 836, y + 678, w - 836, 86);
  doc.text(f, x + 856, y + 694, "Sentiment", { size: 12, weight: "Semi Bold" });
  doc.text(f, x + 856, y + 716, "72", { size: 22, weight: "Semi Bold" });
  doc.text(f, x + 892, y + 720, "Greed · 7d avg 64", { size: 9.5, color: C.t3 });
}

drawExtra(doc);
writeScript(doc, "design/figcraft/script.json");
console.log("steps:", doc.steps.length, "nextId:", doc.id);
