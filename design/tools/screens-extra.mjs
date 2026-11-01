/* screens-extra.mjs — remaining Meridian screens for the FigCraft file */
import { C, FONT, chrome, pageTitle, card, button, badge, statsRow, logoSymbol, areaPath, series } from "./figcraft-lib.mjs";

const navRows = (doc, f, x, y, rows, widths) =>
  rows.forEach((r, i) => {
    const ry = y + i * 30;
    doc.text(f, x, ry, r[0], { size: 11, color: C.text, weight: "Medium" });
    r.slice(1).forEach((cell, j) => {
      doc.text(f, x + widths[j], ry, cell[0], {
        size: 10.5,
        color: cell[1] || C.t2,
        align: widths[j] > 300 ? "right" : "left",
        ...(widths[j] > 300 ? { w: 90 } : {}),
      });
    });
    if (i < rows.length - 1) doc.line(f, x, ry + 20, 700, { color: C.line });
  });

export function drawExtra(doc) {
  /* ------------------------------ PORTFOLIO ------------------------------ */
  {
    const f = doc.frame("04 · Portfolio", 3080, 1000, 1440, 900);
    const { x, y, w } = chrome(doc, f, { active: "Portfolio", crumb: "Portfolio" });
    pageTitle(doc, f, x, y + 12, "Portfolio", "4 open positions and $6,120 in cash. Allocation is rebalanced by the risk engine, not by hand.", { w: 540 });
    button(doc, f, 1150, y + 12, "Export", { w: 80 });
    button(doc, f, 1240, y + 12, "New position", { primary: true, w: 124 });

    card(doc, f, x, y + 96, 520, 250);
    doc.text(f, x + 20, y + 112, "Equity", { size: 13, weight: "Semi Bold" });
    doc.text(f, x + 20, y + 130, "Paper ledger · USD", { size: 10, color: C.t3 });
    doc.text(f, x + 20, y + 156, "$24,812.44", { size: 30, weight: "Semi Bold", track: -0.8 });
    doc.text(f, x + 20, y + 194, "+14.42% 30d", { size: 11, color: C.pos });
    doc.text(f, x + 110, y + 194, "benchmark +8.12%", { size: 10, color: C.t3 });
    ["Realized +$2,489.79", "Unrealized +$638.40", "Fees −$142.18"].forEach((t, i) =>
      doc.text(f, x + 20 + i * 156, y + 218, t, { size: 9.5, color: i === 2 ? C.t3 : i === 1 ? C.pos : C.t2 })
    );
    const pv = series(24, 22000, 0.004, 0.018, 5);
    doc.path(f, x + 20, y + 240, 480, 90, areaPath(pv, 480, 90), { stroke: C.pos, weight: 2 });

    card(doc, f, x + 536, y + 96, 300, 250);
    doc.text(f, x + 556, y + 112, "Allocation", { size: 13, weight: "Semi Bold" });
    badge(doc, f, x + 760, y + 110, "5 assets", { tone: "neutral" });
    const alloc = [
      ["Solana", 34.1, "#14F195"],
      ["Bitcoin", 24.9, "#F7931A"],
      ["Ethereum", 13.4, "#627EEA"],
      ["Arbitrum", 4.2, "#28A0F0"],
      ["Cash", 23.4, "#3A4250"],
    ];
    let ax = x + 556;
    alloc.forEach(([n, v, c]) => {
      const segw = (v / 100) * 260;
      doc.rect(f, ax, y + 142, segw, 10, { fill: c, radius: 2 });
      ax += segw;
    });
    alloc.forEach(([n, v, c], i) => {
      const ry = y + 172 + i * 26;
      doc.circle(f, x + 556, ry, 8, { fill: c });
      doc.text(f, x + 572, ry - 1, n, { size: 10.5, color: C.t2 });
      doc.text(f, x + 782, ry - 1, `${v.toFixed(1)}%`, { size: 10.5, align: "right", w: 34 });
    });

    card(doc, f, x + 852, y + 96, w - 852, 250);
    doc.text(f, x + 872, y + 112, "Buying power", { size: 13, weight: "Semi Bold" });
    badge(doc, f, x + 1002, y + 110, "paper", { tone: "warn" });
    doc.text(f, x + 872, y + 138, "Available cash", { size: 10, color: C.t3 });
    doc.text(f, x + 872, y + 154, "$6,120.44", { size: 24, weight: "Semi Bold" });
    doc.text(f, x + 872, y + 186, "Exposure 75.4% of 80%", { size: 10, color: C.t2 });
    doc.rect(f, x + 872, y + 202, w - 892, 6, { fill: C.s3, radius: 99 });
    doc.rect(f, x + 872, y + 202, (w - 892) * 0.94, 6, { fill: C.warn, radius: 99 });
    doc.text(f, x + 872, y + 220, "Risk budget 1.24% of 2.0%", { size: 10, color: C.t2 });
    doc.rect(f, x + 872, y + 236, w - 892, 6, { fill: C.s3, radius: 99 });
    doc.rect(f, x + 872, y + 236, (w - 892) * 0.62, 6, { fill: C.pos, radius: 99 });

    card(doc, f, x, y + 362, 760, 330);
    doc.text(f, x + 20, y + 378, "Open positions", { size: 13, weight: "Semi Bold" });
    badge(doc, f, x + 128, y + 376, "4", { tone: "neutral" });
    doc.text(f, x + 20, y + 396, "Unrealized +$638.40", { size: 10, color: C.t3 });
    ["ASSET", "SIDE", "SIZE", "ENTRY", "MARK", "P&L", "WEIGHT"].forEach((h, i) =>
      doc.text(f, x + [20, 190, 270, 360, 450, 540, 650][i], y + 420, h, { size: 8, color: C.t3, track: 0.5 })
    );
    doc.line(f, x + 20, y + 436, 720, { color: C.line });
    const pos = [
      ["SOL/USDT", "LONG", "$8,420.50", "$196.20", "$208.44", "+$525.40", "34.1%"],
      ["BTC/USDT", "LONG", "$6,120.00", "$94,180", "$96,420", "+$145.60", "24.9%"],
      ["ETH/USDT", "LONG", "$3,120.00", "$3,496", "$3,418.72", "−$69.40", "13.4%"],
      ["ARB/USDT", "SHORT", "$1,031.50", "$0.9512", "$0.9184", "+$36.80", "4.2%"],
    ];
    pos.forEach((r, i) => {
      const ry = y + 452 + i * 46;
      doc.text(f, x + 20, ry, r[0], { size: 10.5, weight: "Medium" });
      badge(doc, f, x + 182, ry - 4, r[1], { tone: r[1] === "LONG" ? "pos" : "neg" });
      doc.text(f, x + 270, ry, r[2], { size: 10.5 });
      doc.text(f, x + 360, ry, r[3], { size: 10.5 });
      doc.text(f, x + 450, ry, r[4], { size: 10.5 });
      doc.text(f, x + 540, ry, r[5], { size: 10.5, color: r[5].startsWith("+") ? C.pos : C.neg });
      doc.text(f, x + 650, ry, r[6], { size: 10.5, color: C.t2 });
      if (i < pos.length - 1) doc.line(f, x + 20, ry + 30, 720, { color: C.line });
    });

    card(doc, f, x + 776, y + 362, w - 776, 330);
    doc.text(f, x + 796, y + 378, "Exposure by strategy", { size: 13, weight: "Semi Bold" });
    [
      ["Momentum Breakout", 42, 52],
      ["Trend Core", 31, 40],
      ["Mean Reversion", 18, 25],
      ["Breakdown", 9, 20],
    ].forEach(([n, v, cap], i) => {
      const ry = y + 410 + i * 44;
      doc.text(f, x + 796, ry, n, { size: 10, color: C.t2 });
      doc.text(f, x + 1112, ry, `${v}%`, { size: 10, align: "right", w: 30 });
      doc.rect(f, x + 796, ry + 16, w - 860, 6, { fill: C.s3, radius: 99 });
      doc.rect(f, x + 796, ry + 16, ((w - 860) * v) / cap, 6, { fill: C.brand, radius: 99 });
    });
    doc.line(f, x + 796, y + 596, w - 816, { color: C.line });
    doc.text(f, x + 796, y + 614, "Portfolio beta (BTC)", { size: 10, color: C.t3 });
    doc.text(f, x + 1112, y + 614, "0.82", { size: 10, align: "right", w: 30 });
    doc.text(f, x + 796, y + 640, "Value at risk (95%)", { size: 10, color: C.t3 });
    doc.text(f, x + 1112, y + 640, "−$1,842", { size: 10, color: C.neg, align: "right", w: 30 });
  }

  /* ------------------------------ STRATEGY ------------------------------- */
  {
    const f = doc.frame("05 · Strategy", 0, 2050, 1440, 900);
    const { x, y, w } = chrome(doc, f, { active: "Strategy & engine", crumb: "Strategy" });
    pageTitle(doc, f, x, y + 12, "Strategy & engine", "Five strategies, one engine. Allocation and promotion are decided by the evolution loop, inside the guardrails.", { w: 560 });
    button(doc, f, 1180, y + 12, "Edit config", { primary: true, w: 104 });

    card(doc, f, x, y + 96, 760, 96);
    doc.circle(f, x + 20, y + 114, 54, { fill: C.s2, stroke: C.brand, strokeWeight: 4 });
    doc.text(f, x + 34, y + 136, "72%", { size: 13, weight: "Semi Bold" });
    doc.text(f, x + 90, y + 118, "Engine running", { size: 15, weight: "Semi Bold" });
    badge(doc, f, x + 206, y + 116, "paper", { tone: "warn" });
    doc.text(f, x + 90, y + 140, "Round 4,128 · 18 pairs · next scan in 41s", { size: 10, color: C.t3 });
    ["Rounds today 1,284", "Trades today 12", "Uptime 7d 99.97%"].forEach((t, i) =>
      doc.text(f, x + 90 + i * 164, y + 162, t, { size: 9.5, color: C.t2 })
    );
    button(doc, f, x + 600, y + 120, "Pause", { w: 72 });
    button(doc, f, x + 682, y + 120, "Kill switch", { w: 88 });

    card(doc, f, x, y + 208, 760, 400);
    doc.text(f, x + 20, y + 224, "Strategies", { size: 13, weight: "Semi Bold" });
    badge(doc, f, x + 104, y + 222, "5", { tone: "neutral" });
    doc.text(f, x + 20, y + 242, "Allocation is a share of the risk budget, not of equity", { size: 10, color: C.t3 });
    const st = [
      ["Momentum Breakout", "v12", "live", "+$1,842.40", "64.2%", "52%"],
      ["Trend Core", "v9", "live", "+$1,284.10", "58.8%", "40%"],
      ["Mean Reversion", "v7", "live", "−$142.80", "49.1%", "25%"],
      ["Breakdown", "v3", "shadow", "+$96.40", "52.4%", "20%"],
      ["Degen Guard", "v1", "paused", "−$84.20", "41.7%", "0%"],
    ];
    st.forEach((r, i) => {
      const ry = y + 268 + i * 66;
      doc.circle(f, x + 20, ry + 4, 32, { fill: C.s2 });
      doc.text(f, x + 30, ry + 14, "↯", { size: 12, color: r[2] === "live" ? C.pos : C.t3 });
      doc.text(f, x + 64, ry + 2, r[0], { size: 11.5, weight: "Medium" });
      badge(doc, f, x + 64 + r[0].length * 6.4, ry, r[1], { tone: "neutral" });
      badge(doc, f, x + 64 + r[0].length * 6.4 + 34, ry, r[2], { tone: r[2] === "live" ? "pos" : r[2] === "shadow" ? "brand" : "neutral" });
      doc.text(f, x + 64, ry + 20, `62 trades · win ${r[4]} · alloc ${r[5]}`, { size: 9, color: C.t3 });
      doc.text(f, x + 566, ry + 2, r[3], { size: 11.5, weight: "Semi Bold", color: r[3].startsWith("+") ? C.pos : C.neg, align: "right", w: 78 });
      doc.rect(f, x + 664, ry + 8, 30, 16, { fill: r[2] === "paused" ? C.s3 : C.brand, radius: 99 });
      doc.circle(f, x + (r[2] === "paused" ? 666 : 680), ry + 10, 12, { fill: C.white });
      if (i < st.length - 1) doc.line(f, x + 20, ry + 52, 720, { color: C.line });
    });

    // guardrails
    card(doc, f, x + 776, y + 96, w - 776, 300);
    doc.text(f, x + 796, y + 112, "Guardrails", { size: 13, weight: "Semi Bold" });
    badge(doc, f, x + 1072, y + 110, "human-owned", { tone: "warn" });
    [
      ["Risk per trade", "0.35% of 0.5%", 0.7, C.pos],
      ["Daily loss", "1.2% of 2.0%", 0.6, C.warn],
      ["Exposure", "75.4% of 80%", 0.94, C.warn],
      ["Open positions", "4 of 6", 0.66, C.pos],
    ].forEach(([l, v, m, c], i) => {
      const ry = y + 144 + i * 44;
      doc.text(f, x + 796, ry, l, { size: 10, color: C.t2 });
      doc.text(f, x + 1088, ry, v, { size: 10, color: C.t3, align: "right", w: 88 });
      doc.rect(f, x + 796, ry + 16, w - 816, 6, { fill: C.s3, radius: 99 });
      doc.rect(f, x + 796, ry + 16, (w - 816) * m, 6, { fill: c, radius: 99 });
    });
    doc.text(f, x + 796, y + 326, "These values are the human envelope. The engine cannot change them.", { size: 9, color: C.t3, w: w - 816 });

    // graduation
    card(doc, f, x + 776, y + 412, w - 776, 196);
    doc.text(f, x + 796, y + 428, "Graduation to live", { size: 13, weight: "Semi Bold" });
    badge(doc, f, x + 1112, y + 426, "12 / 50", { tone: "neutral" });
    doc.rect(f, x + 796, y + 454, w - 816, 6, { fill: C.s3, radius: 99 });
    doc.rect(f, x + 796, y + 454, (w - 816) * 0.24, 6, { fill: C.pos, radius: 99 });
    doc.text(f, x + 796, y + 474, "Positive cycles with zero risk incidents. At 50 the live switch unlocks; it still needs your confirmation.", { size: 9.5, color: C.t3, w: w - 816, lh: 15 });
    doc.text(f, x + 796, y + 524, "Risk incidents 0 · est. unlock ~38 days", { size: 9.5, color: C.t2 });
  }

  /* -------------------------------- RISK --------------------------------- */
  {
    const f = doc.frame("06 · Risk", 1540, 2050, 1440, 900);
    const { x, y, w } = chrome(doc, f, { active: "Risk & safety", crumb: "Risk & safety" });
    pageTitle(doc, f, x, y + 12, "Risk & safety", "The only page allowed to stop the machine. Limits are human-owned; the engine can tighten them, never loosen them.", { w: 540 });
    button(doc, f, 1262, y + 12, "Kill switch", { w: 104 });

    card(doc, f, x, y + 96, 480, 250, { fill: "#1A1015", stroke: "rgba(255,77,94,0.35)" });
    doc.text(f, x + 20, y + 114, "Emergency stop", { size: 14, weight: "Semi Bold" });
    badge(doc, f, x + 400, y + 112, "armed", { tone: "crit" });
    doc.text(f, x + 20, y + 142, "Halts the engine instantly and flattens every open", { size: 10.5, color: C.t2 });
    doc.text(f, x + 20, y + 158, "position at market. Typed confirmation required.", { size: 10.5, color: C.t2 });
    button(doc, f, x + 20, y + 186, "Trigger kill switch", { primary: true, w: 152 });
    doc.line(f, x + 20, y + 236, 440, { color: "rgba(255,77,94,0.25)" });
    doc.text(f, x + 20, y + 250, "Stops the loop · flattens · writes to the audit chain", { size: 9, color: C.t3 });
    doc.text(f, x + 20, y + 270, "Last triggered 11 days ago by trader@local", { size: 9, color: C.t3 });

    card(doc, f, x + 496, y + 96, w - 496, 250);
    doc.text(f, x + 516, y + 112, "Risk budget", { size: 13, weight: "Semi Bold" });
    badge(doc, f, x + 1000, y + 110, "62% used", { tone: "warn" });
    [
      ["Daily loss", "1.24% of 2.0% cap", 0.62, C.warn],
      ["Exposure", "75.4% of 80% cap", 0.94, C.warn],
      ["Risk per trade", "0.35% of 0.50%", 0.7, C.pos],
      ["Open positions", "4 of 6 slots", 0.66, C.pos],
    ].forEach(([l, v, m, c], i) => {
      const ry = y + 144 + i * 46;
      doc.text(f, x + 516, ry, l, { size: 10.5, color: C.t2 });
      doc.text(f, x + 1030, ry, v, { size: 10, color: C.t3, align: "right", w: 130 });
      doc.rect(f, x + 516, ry + 16, w - 552, 6, { fill: C.s3, radius: 99 });
      doc.rect(f, x + 516, ry + 16, (w - 552) * m, 6, { fill: c, radius: 99 });
    });

    card(doc, f, x, y + 362, 480, 400);
    doc.text(f, x + 20, y + 378, "Circuit breakers", { size: 13, weight: "Semi Bold" });
    badge(doc, f, x + 400, y + 376, "3 armed", { tone: "pos" });
    [
      ["Drawdown breaker", "−3.5% in 24h → halve sizing", "−1.2% today"],
      ["Loss streak", "3 losses → cooldown 30m", "1 in a row"],
      ["Volatility guard", "ATR > 2.4× median → skip", "0.8× median"],
      ["Venue outage", "2 failed fills → read-only", "no failures"],
      ["Honeypot guard", "sell simulation fails → reject", "1 today"],
    ].forEach(([n, d, v], i) => {
      const ry = y + 404 + i * 66;
      doc.circle(f, x + 20, ry + 4, 26, { fill: C.s2 });
      doc.text(f, x + 30, ry + 10, "✓", { size: 9, color: C.pos });
      doc.text(f, x + 56, ry, n, { size: 10.5, weight: "Medium" });
      doc.text(f, x + 56, ry + 15, d, { size: 9, color: C.t3 });
      doc.text(f, x + 380, ry + 2, v, { size: 9, color: C.t3, align: "right", w: 80 });
    });

    card(doc, f, x + 496, y + 362, w - 496, 400);
    doc.text(f, x + 516, y + 378, "Scam surveillance", { size: 13, weight: "Semi Bold" });
    badge(doc, f, x + 1000, y + 376, "1,842 scanned", { tone: "neutral" });
    [
      ["PEPE/USDT", "Honeypot · sell simulation failed", "blocked", "crit"],
      ["SAFE/USDT", "Mint authority still active", "watch", "warn"],
      ["XYZ/USDT", "Liquidity removed 92% in 6h", "blocked", "crit"],
      ["JUP/USDT", "Holder concentration 18.2%", "watch", "warn"],
    ].forEach(([t, d, s, tone], i) => {
      const ry = y + 404 + i * 72;
      doc.circle(f, x + 516, ry + 2, 26, { fill: C.s2 });
      doc.text(f, x + 524, ry + 8, "◈", { size: 9, color: tone === "crit" ? C.neg : C.warn });
      doc.text(f, x + 552, ry, t, { size: 10.5, weight: "Medium" });
      badge(doc, f, x + 552 + t.length * 6.2, ry - 4, s, { tone });
      doc.text(f, x + 552, ry + 15, d, { size: 9, color: C.t3 });
      if (i < 3) doc.line(f, x + 516, ry + 48, w - 552, { color: C.line });
    });
  }

  /* ------------------------------- COPILOT ------------------------------- */
  {
    const f = doc.frame("07 · AI Copilot", 3080, 2050, 1440, 900);
    const { x, y, w } = chrome(doc, f, { active: "AI Copilot", crumb: "AI Copilot" });
    pageTitle(doc, f, x, y + 12, "AI Copilot", "Ask about decisions, risk or performance. Answers cite the ledger they used and never invent numbers.", { w: 560 });
    button(doc, f, 1272, y + 12, "New thread", { primary: true, w: 104 });

    card(doc, f, x, y + 96, 240, 560);
    doc.text(f, x + 16, y + 112, "Threads", { size: 12.5, weight: "Semi Bold" });
    doc.rect(f, x + 16, y + 132, 208, 28, { fill: C.s1, stroke: C.line2, radius: 6 });
    doc.text(f, x + 26, y + 140, "Search threads", { size: 9, color: C.t3 });
    [
      ["Why did SOL get promoted?", "12m", true],
      ["Is my drawdown within limits?", "1h", false],
      ["Explain the liquidity gate", "yesterday", false],
      ["Draft a weekly summary", "2d", false],
      ["Compare v11 and v12", "3d", false],
    ].forEach(([t, tm, on], i) => {
      const ry = y + 176 + i * 48;
      if (on) doc.rect(f, x + 8, ry - 8, 224, 42, { fill: C.s2, radius: 6 });
      doc.text(f, x + 16, ry, t, { size: 10.5, weight: on ? "Medium" : "Regular", color: on ? C.text : C.t2 });
      doc.text(f, x + 16, ry + 15, tm, { size: 8.5, color: C.t3 });
    });

    card(doc, f, x + 256, y + 96, 560, 560);
    doc.text(f, x + 276, y + 112, "Why did SOL get promoted?", { size: 12.5, weight: "Semi Bold" });
    doc.text(f, x + 276, y + 130, "Grounded on 6 sources · updated 2m ago", { size: 9, color: C.t3 });
    badge(doc, f, x + 688, y + 110, "paper dataset", { tone: "warn" });

    doc.rect(f, x + 420, y + 152, 376, 44, { fill: C.brandSoft, stroke: "rgba(91,108,255,0.35)", radius: 10 });
    doc.text(f, x + 434, y + 162, "SOL was promoted this morning. What changed, and", { size: 10, color: C.text });
    doc.text(f, x + 434, y + 178, "what would make you reverse it?", { size: 10, color: C.text });

    doc.circle(f, x + 276, y + 214, 20, { fill: C.brand });
    doc.text(f, x + 282, y + 221, "AI", { size: 7.5, weight: "Bold", color: C.white });
    doc.rect(f, x + 306, y + 210, 490, 300, { fill: C.s2, stroke: C.line, radius: 10 });
    doc.text(f, x + 322, y + 224, "v12 cleared its 21-day forward window with a 1.92", { size: 10.5, color: C.text, w: 450, lh: 17 });
    doc.text(f, x + 322, y + 260, "Sharpe and a −4.2% max drawdown, beating v11 on", { size: 10.5, color: C.text, w: 450, lh: 17 });
    doc.text(f, x + 322, y + 296, "both. Allocation moved from 40% to 52%.", { size: 10.5, color: C.text });
    doc.text(f, x + 322, y + 326, "What changed", { size: 10, weight: "Semi Bold" });
    [
      "Forward Sharpe 1.92 (v11: 1.41)",
      "Max drawdown −4.2% (v11: −6.1%)",
      "Zero honeypot exposures in the window",
    ].forEach((t, i) => {
      doc.circle(f, x + 324, y + 348 + i * 22, 5, { fill: C.pos });
      doc.text(f, x + 338, y + 344 + i * 22, t, { size: 9.5, color: C.t2 });
    });
    doc.text(f, x + 322, y + 418, "What would reverse it", { size: 10, weight: "Semi Bold" });
    doc.text(f, x + 322, y + 438, "Two consecutive weeks under a 1.0 rolling Sharpe, or any", { size: 9.5, color: C.t2, w: 440 });
    doc.text(f, x + 322, y + 454, "unresolved risk incident. Demotion is automatic.", { size: 9.5, color: C.t2, w: 440 });
    ["forward_collection · 21d", "model_registry.json", "risk_config.json"].forEach((t, i) => {
      const cw = t.length * 5 + 12;
      const cx = x + 322 + i * (cw + 6);
      doc.rect(f, cx, y + 480, cw, 18, { fill: C.s1, stroke: C.line, radius: 4 });
      doc.text(f, cx + 6, y + 485, t, { size: 8, color: C.t3 });
    });
    doc.rect(f, x + 276, y + 604, 520, 36, { fill: C.s1, stroke: C.line2, radius: 8 });
    doc.text(f, x + 290, y + 616, "Ask about a decision, a position or a metric…", { size: 10, color: C.t3 });
    button(doc, f, x + 748, y + 608, "Send", { primary: true, w: 44, h: 28 });

    card(doc, f, x + 832, y + 96, w - 832, 280);
    doc.text(f, x + 852, y + 112, "Evidence used", { size: 12.5, weight: "Semi Bold" });
    badge(doc, f, x + 1080, y + 110, "6", { tone: "neutral" });
    [
      ["Forward collection", "21 days · 214 trades · Sharpe 1.92"],
      ["model_registry.json", "param_v12 promoted 14:02 UTC"],
      ["Risk envelope", "risk_config.json unchanged since 12 Oct"],
      ["Ledger", "episodes.jsonl · 148 closed trades"],
    ].forEach(([t, d], i) => {
      const ry = y + 144 + i * 56;
      doc.text(f, x + 852, ry, t, { size: 10, weight: "Medium" });
      doc.text(f, x + 852, ry + 16, d, { size: 9, color: C.t3, w: w - 872 });
      if (i < 3) doc.line(f, x + 852, ry + 38, w - 872, { color: C.line });
    });

    card(doc, f, x + 832, y + 392, w - 832, 264);
    doc.text(f, x + 852, y + 408, "Decision at a glance", { size: 12.5, weight: "Semi Bold" });
    doc.circle(f, x + 852, y + 432, 30, { fill: "#14F195" });
    doc.text(f, x + 860, y + 442, "SOL", { size: 8, weight: "Bold", color: C.bg });
    doc.text(f, x + 892, y + 434, "SOL/USDT", { size: 11, weight: "Medium" });
    doc.text(f, x + 892, y + 450, "Momentum Breakout · v12", { size: 9, color: C.t3 });
    [
      ["Liquidity depth", "$28.4M"],
      ["Sell simulation", "passed"],
      ["Exposure", "within cap"],
      ["Regime", "trend up"],
    ].forEach(([k, v], i) => {
      const ry = y + 480 + i * 26;
      doc.circle(f, x + 856, ry + 4, 9, { fill: "rgba(61,220,151,0.15)", stroke: C.pos, strokeWeight: 1 });
      doc.text(f, x + 872, ry, k, { size: 9.5, color: C.t2 });
      doc.text(f, x + 1080, ry, v, { size: 9, color: C.t3, align: "right", w: 60 });
    });
    doc.text(f, x + 852, y + 620, "Copilot is advisory. It cannot place, close or resize orders.", { size: 8.5, color: C.t3 });
  }

  /* -------------------------------- LOGIN -------------------------------- */
  {
    const f = doc.frame("08 · Sign in", 0, 3100, 1440, 900);
    doc.rect(f, 0, 0, 760, 900, {
      fill: { type: "linearGradient", stops: ["#151A38", "#0A0B0D"], from: [0, 0], to: [1, 1] },
    });
    logoSymbol(doc, f, 56, 48, 34);
    doc.text(f, 102, 52, "Auto Trader", { size: 15, weight: "Semi Bold" });
    doc.label(f, 102, 72, "Meridian", { size: 8, color: C.t3 });
    doc.text(f, 56, 470, "“The first bot I actually", { family: FONT.display, size: 40, color: C.text, track: -0.8 });
    doc.text(f, 56, 522, "trust with a spreadsheet", { family: FONT.display, size: 40, color: C.text, track: -0.8 });
    doc.text(f, 56, 574, "of its own decisions.”", { family: FONT.display, size: 40, color: C.brand, track: -0.8 });
    doc.text(f, 56, 640, "Risk-first automation for crypto. Paper capital, real", { size: 12.5, color: C.t2 });
    doc.text(f, 56, 660, "prices, full audit trail — from day one.", { size: 12.5, color: C.t2 });
    ["18 pairs scanned", "1,842 tokens checked", "99.97% uptime"].forEach((t, i) =>
      doc.text(f, 56 + i * 190, 730, t, { size: 10, color: C.t3 })
    );

    doc.rect(f, 760, 0, 680, 900, { fill: C.bg });
    doc.text(f, 940, 232, "Welcome back", { size: 26, weight: "Semi Bold", track: -0.6 });
    doc.text(f, 940, 272, "Sign in to your workspace to continue.", { size: 12, color: C.t2 });
    doc.text(f, 940, 314, "Email", { size: 11, color: C.t2 });
    doc.rect(f, 940, 334, 380, 40, { fill: C.s1, stroke: C.line2, radius: 8 });
    doc.text(f, 954, 346, "you@company.com", { size: 11.5, color: C.t3 });
    doc.text(f, 940, 392, "Password", { size: 11, color: C.t2 });
    doc.rect(f, 940, 412, 380, 40, { fill: C.s1, stroke: C.line2, radius: 8 });
    doc.text(f, 954, 424, "••••••••••••", { size: 11.5, color: C.t3 });
    doc.text(f, 940, 470, "Keep me signed in", { size: 10.5, color: C.t2 });
    doc.text(f, 1230, 470, "Forgot password?", { size: 10.5, color: "#8C9BFF" });
    button(doc, f, 940, 496, "Sign in  →", { primary: true, w: 380, h: 44 });
    doc.line(f, 940, 572, 160, { color: C.line });
    doc.text(f, 1120, 563, "OR", { size: 9, color: C.t3 });
    doc.line(f, 1160, 572, 160, { color: C.line });
    button(doc, f, 940, 594, "Continue with passkey", { w: 380, h: 40 });
    doc.text(f, 940, 664, "Explore the demo workspace →", { size: 11, color: C.t2 });
    doc.text(f, 940, 706, "New here?  Create an account", { size: 10.5, color: C.t2 });
    doc.text(f, 940, 740, "Protected by TOTP MFA · session expires in 12h", { size: 9.5, color: C.t3 });
  }

  /* ------------------------------- LANDING ------------------------------- */
  {
    const f = doc.frame("09 · Landing", 1540, 3100, 1440, 900);
    doc.rect(f, 0, 0, 1440, 900, {
      fill: { type: "radialGradient", stops: ["#141936", "#0A0B0D"] },
    });
    logoSymbol(doc, f, 40, 20, 26);
    doc.text(f, 74, 22, "Auto Trader", { size: 13.5, weight: "Semi Bold" });
    doc.label(f, 74, 38, "Meridian", { size: 7.5, color: C.t3 });
    ["How it works", "Safety", "Pricing", "Docs"].forEach((t, i) =>
      doc.text(f, 210 + i * 108, 26, t, { size: 11, color: C.t2 })
    );
    button(doc, f, 1180, 18, "Sign in", { w: 72 });
    button(doc, f, 1262, 18, "Start free", { primary: true, w: 92 });

    doc.rect(f, 600, 120, 240, 26, { fill: C.s1, stroke: C.line, radius: 99 });
    doc.text(f, 614, 127, "NEW", { size: 8, weight: "Semi Bold", color: "#8C9BFF" });
    doc.text(f, 648, 127, "Multichain scanner · 18 pairs", { size: 9.5, color: C.t2 });

    doc.text(f, 250, 190, "Autonomous crypto trading,", { family: FONT.display, size: 52, color: C.text, track: -1.2 });
    doc.text(f, 250, 250, "with a risk officer built in.", { family: FONT.display, size: 52, color: C.brand, track: -1.2 });
    doc.text(f, 350, 336, "Auto Trader runs a disciplined strategy loop on live prices, checks every token", { size: 12.5, color: C.t2 });
    doc.text(f, 425, 356, "for scams before it buys, and explains each decision in plain language.", { size: 12.5, color: C.t2 });
    button(doc, f, 520, 396, "Start in paper mode  →", { primary: true, w: 190, h: 44 });
    button(doc, f, 722, 396, "See the live demo", { w: 158, h: 44 });
    doc.text(f, 520, 454, "No card required · paper capital included · live unlocks after 50 positive cycles", { size: 9.5, color: C.t3 });

    // app preview
    doc.rect(f, 180, 500, 1080, 380, { fill: C.s1, stroke: C.line2, radius: 14 });
    doc.rect(f, 180, 500, 1080, 32, { fill: C.s2, radius: 14 });
    doc.circle(f, 196, 512, 8, { fill: C.line2 });
    doc.circle(f, 210, 512, 8, { fill: C.line2 });
    doc.circle(f, 224, 512, 8, { fill: C.line2 });
    doc.text(f, 246, 512, "app.autotrader.io/overview", { size: 8.5, color: C.t3, family: FONT.mono });
    doc.rect(f, 180, 532, 180, 348, { fill: C.elev });
    doc.text(f, 200, 552, "Auto Trader", { size: 9.5, weight: "Semi Bold" });
    ["Overview", "Markets", "Portfolio", "Strategy", "Backtest", "Risk"].forEach((t, i) => {
      if (i === 0) doc.rect(f, 192, 578 + i * 26, 156, 22, { fill: C.s2, radius: 5 });
      doc.text(f, 202, 583 + i * 26, t, { size: 9, color: i === 0 ? C.text : C.t3 });
    });
    doc.text(f, 380, 556, "PORTFOLIO EQUITY", { size: 8, color: C.t3, track: 0.6 });
    doc.text(f, 380, 570, "$24,812.44", { size: 28, weight: "Semi Bold", track: -0.8 });
    badge(doc, f, 1180, 560, "USD · paper", { tone: "neutral" });
    const heroVals = series(40, 16000, 0.007, 0.02, 91);
    doc.path(f, 380, 620, 840, 150, areaPath(heroVals, 840, 150), { stroke: C.pos, weight: 2.4 });
    ["Win rate 61.8%", "Sharpe 1.84", "Open 4 · 75%"].forEach((t, i) => {
      doc.rect(f, 380 + i * 210, 790, 196, 56, { fill: C.s1, stroke: C.line, radius: 8 });
      doc.text(f, 394 + i * 210, 802, t, { size: 9.5, color: C.t2 });
    });
    doc.text(f, 60, 870, "Auto Trader · © 2026", { size: 9, color: C.t3 });
    ["Terms", "Privacy", "Status", "Docs"].forEach((t, i) =>
      doc.text(f, 1170 + i * 64, 870, t, { size: 9, color: C.t3 })
    );
  }

  /* ------------------------------ ONBOARDING ----------------------------- */
  {
    const f = doc.frame("10 · Onboarding", 3080, 3100, 1440, 900);
    doc.rect(f, 0, 0, 340, 900, { fill: C.elev });
    doc.line(f, 339, 0, 1, { color: C.line, h: 900 });
    logoSymbol(doc, f, 32, 32, 28);
    doc.text(f, 70, 36, "Auto Trader", { size: 13, weight: "Semi Bold" });
    doc.label(f, 70, 54, "Meridian", { size: 7.5, color: C.t3 });

    [
      ["Risk profile", "How much can you lose?"],
      ["Strategy", "What should it trade?"],
      ["Connections", "Exchange & alerts"],
      ["Review", "Start in paper"],
    ].forEach(([t, d], i) => {
      const ry = 120 + i * 62;
      if (i === 0) doc.rect(f, 24, ry - 10, 292, 52, { fill: C.s2, radius: 8 });
      doc.circle(f, 36, ry, 22, { fill: i === 0 ? "transparent" : "transparent", stroke: i === 0 ? C.brand : C.line2, strokeWeight: 1.5 });
      doc.text(f, 42, ry + 4, String(i + 1), { size: 9, weight: "Semi Bold", color: i === 0 ? C.brand : C.t3 });
      doc.text(f, 70, ry - 2, t, { size: 11, weight: "Medium", color: i === 0 ? C.text : C.t2 });
      doc.text(f, 70, ry + 14, d, { size: 9, color: C.t3 });
    });
    doc.rect(f, 24, 780, 292, 56, { fill: "rgba(91,108,255,0.10)", stroke: "rgba(91,108,255,0.3)", radius: 8 });
    doc.text(f, 38, 796, "Takes about 2 minutes.", { size: 9.5, color: "#B9C2FF" });
    doc.text(f, 38, 812, "You can change everything later.", { size: 9.5, color: "#B9C2FF" });
    doc.text(f, 120, 862, "Skip for now", { size: 10, color: C.t2 });

    doc.label(f, 420, 180, "Step 1 of 4", { size: 9, color: C.t3 });
    doc.text(f, 420, 210, "How much risk should", { family: FONT.display, size: 40, color: C.text, track: -0.8 });
    doc.text(f, 420, 258, "the engine take?", { family: FONT.display, size: 40, color: C.text, track: -0.8 });
    doc.text(f, 420, 322, "This sets your default risk per trade and position size. The engine can tighten these limits, never loosen them.", { size: 12.5, color: C.t2, w: 760 });

    [
      ["Conservative", "0.25% per trade", "2 positions · wider stops", false],
      ["Balanced", "0.50% per trade", "4 positions · recommended", true],
      ["Aggressive", "1.00% per trade", "6 positions · tighter stops", false],
    ].forEach(([t, f2, d, on], i) => {
      const cx = 420 + i * 252;
      doc.rect(f, cx, 380, 236, 124, {
        fill: on ? "rgba(91,108,255,0.10)" : C.s1,
        stroke: on ? C.brand : C.line,
        radius: 12,
      });
      doc.rect(f, cx + 16, 396, 28, 28, { fill: on ? C.brand : C.s3, radius: 7 });
      doc.text(f, cx + 16, 454, t, { size: 12, weight: "Semi Bold" });
      doc.text(f, cx + 16, 472, f2, { size: 10, color: C.t2 });
      doc.text(f, cx + 16, 488, d, { size: 9, color: C.t3 });
    });

    doc.rect(f, 420, 528, 760, 72, { fill: C.s1, stroke: C.line, radius: 12 });
    doc.circle(f, 444, 544, 40, { fill: C.s2, stroke: C.brand, strokeWeight: 3 });
    doc.text(f, 456, 560, "0.5%", { size: 10, weight: "Semi Bold" });
    doc.text(f, 500, 544, "Risk per trade", { size: 11, weight: "Medium" });
    doc.text(f, 500, 560, "At $10,000 paper capital, one stop-out costs $50 — about 0.5% of equity.", { size: 9.5, color: C.t3 });
    badge(doc, f, 1096, 550, "within envelope", { tone: "pos" });

    doc.line(f, 420, 640, 760, { color: C.line });
    doc.text(f, 420, 664, "You can import an existing configuration instead.", { size: 9.5, color: C.t3 });
    button(doc, f, 980, 650, "Import config", { w: 108 });
    button(doc, f, 1100, 650, "Continue  →", { primary: true, w: 116 });
  }

  /* ------------------------------- MOBILE -------------------------------- */
  {
    const f = doc.frame("11 · Mobile · Overview", 0, 4150, 390, 844);
    doc.rect(f, 0, 0, 390, 844, { fill: C.bg });
    doc.text(f, 16, 18, "☰", { size: 12, color: C.t2 });
    doc.rect(f, 276, 12, 96, 28, { fill: C.s1, stroke: C.line, radius: 99 });
    doc.circle(f, 286, 26, 7, { fill: C.pos });
    doc.text(f, 296, 22, "Running", { size: 9, weight: "Semi Bold" });
    doc.circle(f, 356, 20, 18, { fill: C.s2 });

    doc.text(f, 16, 60, "Paper", { size: 8, weight: "Semi Bold", color: C.warn });
    doc.text(f, 58, 60, "Engine running · round 4,128", { size: 8, color: C.t3 });
    doc.text(f, 16, 92, "Mission control", { size: 22, weight: "Semi Bold", track: -0.5 });
    doc.text(f, 16, 116, "Autonomous engine scanning 18 pairs. 4 open positions,", { size: 10, color: C.t2, w: 340 });
    doc.text(f, 16, 130, "75.4% exposure, no unresolved risk events.", { size: 10, color: C.t2 });

    doc.rect(f, 16, 148, 358, 52, { fill: "rgba(91,108,255,0.10)", stroke: "rgba(91,108,255,0.3)", radius: 8 });
    doc.text(f, 28, 162, "Paper mode — live unlocks after 50 positive", { size: 9, color: "#B9C2FF" });
    doc.text(f, 28, 176, "cycles · 12/50 completed.", { size: 9, color: "#B9C2FF" });

    doc.rect(f, 16, 216, 358, 280, { fill: C.s1, stroke: C.line, radius: 12 });
    doc.text(f, 32, 234, "Portfolio equity", { size: 12, weight: "Semi Bold" });
    doc.text(f, 32, 250, "Net of fees · updated 4s ago", { size: 8.5, color: C.t3 });
    doc.text(f, 32, 284, "$24,812.44", { size: 30, weight: "Semi Bold", track: -0.8 });
    doc.text(f, 32, 308, "+$3,128.19 · +14.42%", { size: 10, color: C.pos });
    doc.text(f, 32, 326, "Initial $10,000 · Peak $25,904", { size: 8.5, color: C.t3 });
    const mv = series(22, 18000, 0.005, 0.02, 12);
    doc.path(f, 32, 344, 326, 130, areaPath(mv, 326, 130), { stroke: C.pos, weight: 2 });

    doc.rect(f, 16, 512, 358, 96, { fill: C.s1, stroke: C.line, radius: 12 });
    doc.text(f, 32, 528, "Engine · running", { size: 11, weight: "Semi Bold" });
    doc.circle(f, 40, 546, 32, { fill: C.s2, stroke: C.brand, strokeWeight: 3 });
    doc.text(f, 48, 558, "72%", { size: 8, weight: "Semi Bold" });
    doc.text(f, 84, 546, "Round 4,128 · stage 4/5", { size: 9.5, weight: "Medium" });
    doc.text(f, 84, 562, "Executing SOL/USDT · next scan 41s", { size: 8.5, color: C.t3 });
    for (let i = 0; i < 5; i++) doc.rect(f, 84 + i * 56, 582, 50, 3, { fill: i < 3 ? C.brand : C.s3, radius: 99 });

    doc.rect(f, 16, 624, 358, 150, { fill: "#111427", stroke: "rgba(91,108,255,0.35)", radius: 12 });
    doc.text(f, 32, 640, "AI decision · 2m ago", { size: 9, color: C.t3 });
    doc.text(f, 32, 664, "LONG SOL/USDT", { size: 16, weight: "Semi Bold", track: -0.3 });
    doc.text(f, 32, 684, "Momentum Breakout · $8,420", { size: 8.5, color: C.t2 });
    ["Liquidity $28.4M", "Sell test passed", "Exposure 75.4%"].forEach((t, i) => {
      doc.circle(f, 34, 706 + i * 20, 5, { fill: C.pos });
      doc.text(f, 46, 702 + i * 20, t, { size: 9, color: C.t2 });
    });

    doc.rect(f, 0, 810, 390, 34, { fill: C.elev });
    doc.line(f, 0, 809, 390, 1, { color: C.line });
    doc.text(f, 16, 822, "Engine running · BSC mainnet", { size: 8, color: C.t3 });
  }

  {
    const f = doc.frame("12 · Mobile · Markets", 500, 4150, 390, 844);
    doc.rect(f, 0, 0, 390, 844, { fill: C.bg });
    doc.text(f, 16, 18, "☰", { size: 12, color: C.t2 });
    doc.rect(f, 276, 12, 96, 28, { fill: C.s1, stroke: C.line, radius: 99 });
    doc.circle(f, 286, 26, 7, { fill: C.pos });
    doc.text(f, 296, 22, "Running", { size: 9, weight: "Semi Bold" });

    doc.text(f, 16, 76, "Markets", { size: 22, weight: "Semi Bold", track: -0.5 });
    doc.text(f, 16, 98, "18 pairs · ranked by opportunity score", { size: 9, color: C.t2 });

    doc.rect(f, 16, 120, 358, 72, { fill: C.s1, stroke: C.line, radius: 10 });
    [
      ["Fear & Greed", "72"],
      ["BTC dom.", "54.2%"],
      ["Funding", "0.011%"],
    ].forEach(([l, v], i) => {
      const cx = 28 + i * 120;
      doc.text(f, cx, 132, l, { size: 7.5, color: C.t3 });
      doc.text(f, cx, 148, v, { size: 14, weight: "Semi Bold" });
    });
    doc.line(f, 16, 172, 358, { color: C.line });

    doc.rect(f, 16, 204, 358, 500, { fill: C.s1, stroke: C.line, radius: 12 });
    doc.text(f, 32, 220, "Scanner", { size: 11, weight: "Semi Bold" });
    ["ASSET", "PRICE", "24H"].forEach((h, i) => doc.text(f, [32, 190, 300][i], 244, h, { size: 7, color: C.t3, track: 0.5 }));
    doc.line(f, 16, 256, 358, { color: C.line });
    const mr = [
      ["BTC", "96,420.18", "+2.41%", C.pos],
      ["ETH", "3,418.72", "+1.86%", C.pos],
      ["SOL", "208.44", "+6.12%", C.pos],
      ["BNB", "662.11", "−0.84%", C.neg],
      ["ARB", "0.9184", "−3.42%", C.neg],
      ["TIA", "5.41", "+11.80%", C.pos],
      ["JUP", "1.08", "+3.94%", C.pos],
    ];
    mr.forEach(([s, p, c, tone], i) => {
      const ry = 276 + i * 56;
      doc.circle(f, 32, ry - 4, 26, { fill: C.s3 });
      doc.text(f, 38, ry + 3, s.slice(0, 3), { size: 7, weight: "Bold", color: C.t2 });
      doc.text(f, 68, ry - 6, `${s}/USDT`, { size: 10, weight: "Medium" });
      doc.text(f, 68, ry + 8, s, { size: 8, color: C.t3 });
      doc.text(f, 190, ry - 2, p, { size: 9.5 });
      doc.text(f, 300, ry - 2, c, { size: 9.5, color: tone });
      if (i < mr.length - 1) doc.line(f, 32, ry + 22, 326, { color: C.line });
    });

    doc.rect(f, 0, 810, 390, 34, { fill: C.elev });
    doc.line(f, 0, 809, 390, 1, { color: C.line });
    doc.text(f, 16, 822, "Live · 4s ago", { size: 8, color: C.t3 });
  }

  /* --------------------------------- IA ---------------------------------- */
  {
    const f = doc.frame("13 · Information architecture", 1000, 4150, 1200, 844);
    doc.text(f, 40, 40, "Information architecture", { size: 24, weight: "Semi Bold", track: -0.5 });
    doc.text(f, 40, 76, "One question per screen. Every view is addressable; the command palette mirrors the rail.", { size: 11, color: C.t2 });

    const groups = [
      ["OPERATE", ["Overview", "Markets", "Portfolio", "Strategy", "Backtest", "Analytics", "Journal"]],
      ["GUARD", ["Risk & safety", "AI Copilot"]],
      ["SYSTEM", ["Alerts", "Data & sources", "Settings", "Billing"]],
      ["ADMIN", ["Users & audit"]],
    ];
    let gy = 130;
    groups.forEach(([g, items]) => {
      doc.label(f, 40, gy, g, { size: 8.5, color: C.t3 });
      items.forEach((it, i) => {
        const y = gy + 22 + i * 36;
        doc.rect(f, 40, y, 210, 28, { fill: C.s1, stroke: C.line, radius: 7 });
        doc.text(f, 54, y + 8, it, { size: 10.5, color: C.text });
      });
      gy += 22 + items.length * 36 + 18;
    });

    const flows = [
      ["Alert → position", ["Alerts", "drawer", "Position detail"]],
      ["Scanner → token", ["Markets", "Token detail", "Paper trade"]],
      ["Decision → evidence", ["Overview", "Copilot", "Journal"]],
      ["Risk → halt", ["Risk & safety", "Kill switch", "Audit log"]],
    ];
    flows.forEach(([title, steps], i) => {
      const y = 130 + i * 96;
      doc.text(f, 620, y, title, { size: 11, weight: "Semi Bold" });
      steps.forEach((s, j) => {
        const x = 620 + j * 150;
        doc.rect(f, x, y + 20, 128, 34, { fill: C.s2, stroke: C.line2, radius: 8 });
        doc.text(f, x + 12, y + 31, s, { size: 9.5, color: C.t2 });
        if (j < steps.length - 1) doc.text(f, x + 132, y + 32, "→", { size: 11, color: C.t3 });
      });
    });

    doc.rect(f, 620, 540, 520, 240, { fill: C.s1, stroke: C.line, radius: 10 });
    doc.text(f, 640, 558, "Cross-cutting rules", { size: 11, weight: "Semi Bold" });
    [
      "Every screen has a URL and a deep link into its detail.",
      "Destructive actions live on one page (Risk & safety).",
      "Paper/live mode is global, never per widget.",
      "The rail is the only primary navigation.",
      "Cmd/Ctrl+K mirrors the rail and exposes actions.",
      "Empty, loading and error states are designed per page.",
    ].forEach((r, i) => doc.text(f, 640, 584 + i * 28, `— ${r}`, { size: 9.5, color: C.t2 }));
  }
}
