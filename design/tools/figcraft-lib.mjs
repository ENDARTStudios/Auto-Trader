/* figcraft-lib.mjs — tiny DSL that emits FigCraft CLI script steps */
import fs from "node:fs";

export const C = {
  bg: "#0A0B0D",
  elev: "#0E1014",
  s1: "#101216",
  s2: "#16191F",
  s3: "#1D2129",
  line: "#23272F",
  line2: "#31363F",
  text: "#F2F4F7",
  t2: "#A7AFBC",
  t3: "#6D7582",
  brand: "#5B6CFF",
  brandSoft: "#1B1F3A",
  pos: "#3DDC97",
  neg: "#FF6B81",
  warn: "#F5B454",
  crit: "#FF4D5E",
  white: "#FFFFFF",
};

export const FONT = {
  ui: "Inter",
  display: "Cambria",
  mono: "Cascadia Mono",
};

export class Doc {
  constructor() {
    this.steps = [];
    this.id = 2; // page.rename creates no node; the first frame gets id 2
  }
  add(command, params) {
    this.steps.push({ command, params });
    return this;
  }
  /** creates a node and returns its id */
  node(type, params) {
    const id = this.id++;
    this.add("node.create", { type, ...params });
    return id;
  }
  frame(name, x, y, w, h, { fill = C.bg, radius = 0, clip = true } = {}) {
    const id = this.id++;
    this.add("frame.create", {
      name,
      x,
      y,
      width: w,
      height: h,
      props: { ...(fill && typeof fill === "object" ? { fills: [fill] } : { fill }), ...(radius ? { cornerRadius: radius } : {}), clip },
    });
    return id;
  }
  rect(parent, x, y, w, h, { fill = C.s1, radius = 0, stroke = null, strokeWeight = 1, name = "rect" } = {}) {
    return this.node("rectangle", {
      name,
      x,
      y,
      width: w,
      height: h,
      parent,
      props: {
        ...(fill && typeof fill === "object" ? { fills: [fill] } : { fill }),
        ...(radius ? { cornerRadius: radius } : {}),
        ...(stroke ? { stroke, strokeWeight } : {}),
      },
    });
  }
  circle(parent, x, y, d, { fill = C.s3, name = "circle" } = {}) {
    return this.node("ellipse", { name, x, y, width: d, height: d, parent, props: fill && typeof fill === "object" ? { fills: [fill] } : { fill } });
  }
  text(parent, x, y, str, opts = {}) {
    const {
      size = 13,
      color = C.text,
      weight = "Regular",
      family = FONT.ui,
      w = null,
      lh = null,
      align = "left",
      track = null,
      name = null,
      upper = false,
      opacity = null,
    } = opts;
    return this.node("text", {
      name: name || str.slice(0, 34),
      x,
      y,
      ...(w ? { width: w } : {}),
      parent,
      text: str,
      props: {
        fontFamily: family,
        fontStyle: weight,
        fontSize: size,
        fill: color,
        ...(lh ? { lineHeight: lh } : {}),
        ...(align !== "left" ? { textAlign: align } : {}),
        ...(track !== null ? { letterSpacing: track } : {}),
        ...(upper ? { textCase: "upper" } : {}),
        ...(opacity !== null ? { opacity } : {}),
        ...(w ? { textAutoResize: "height" } : {}),
      },
    });
  }
  label(parent, x, y, str, opts = {}) {
    return this.text(parent, x, y, str, {
      size: 10,
      color: C.t3,
      weight: "Medium",
      upper: true,
      track: 0.6,
      ...opts,
    });
  }
  line(parent, x, y, w, { color = C.line, h = 1 } = {}) {
    return this.rect(parent, x, y, w, h, { fill: color, name: "divider" });
  }
  pill(parent, x, y, w, h, { fill = C.s2, stroke = C.line, radius = 999 } = {}) {
    return this.rect(parent, x, y, w, h, { fill, radius, stroke, name: "pill" });
  }
  path(parent, x, y, w, h, d, { stroke = C.pos, weight = 2, fill = null, dashed = false } = {}) {
    return this.node("vector", {
      name: "path",
      x,
      y,
      width: w,
      height: h,
      parent,
      path: d,
      props: { stroke, strokeWeight: weight, ...(fill ? { fill } : {}), ...(dashed ? { dashes: [3, 4] } : {}) },
    });
  }
}

/* ---------- higher level pieces ---------- */
export function card(doc, p, x, y, w, h, { fill = C.s1, stroke = C.line, radius = 12 } = {}) {
  doc.rect(p, x, y, w, h, { fill, stroke, radius, name: "card" });
}

export function button(doc, p, x, y, label, { primary = false, w = null, h = 32, iconText = "" } = {}) {
  const width = w || Math.max(78, label.length * 6.6 + (iconText ? 20 : 0) + 26);
  doc.rect(p, x, y, width, h, {
    fill: primary ? C.brand : C.s2,
    radius: 8,
    stroke: primary ? null : C.line2,
    name: `btn-${label}`,
  });
  doc.text(p, x + (iconText ? 12 : 0), y + (h - 13) / 2 - 1, `${iconText}${label}`, {
    size: 12,
    weight: "Semi Bold",
    color: primary ? C.white : C.text,
  });
  return width;
}

export function badge(doc, p, x, y, label, { tone = "neutral", w = null } = {}) {
  const map = {
    pos: [C.pos, "rgba(61,220,151,0.14)"],
    neg: [C.neg, "rgba(255,107,129,0.14)"],
    warn: [C.warn, "rgba(245,180,84,0.14)"],
    brand: [C.brand, C.brandSoft],
    crit: [C.crit, "rgba(255,77,94,0.16)"],
    neutral: [C.t2, C.s3],
  };
  const [fg, bg] = map[tone] || map.neutral;
  const width = w || label.length * 5.9 + 16;
  doc.rect(p, x, y, width, 19, { fill: bg, radius: 5, name: `badge-${label}` });
  doc.text(p, x + 8, y + 4, label, { size: 10, weight: "Semi Bold", color: fg });
  return width;
}

export function navItem(doc, p, x, y, label, { active = false, count = null, w = 224 } = {}) {
  if (active) {
    doc.rect(p, x - 10, y - 5, w, 32, { fill: C.s2, radius: 8, stroke: C.line, name: `nav-${label}` });
    doc.rect(p, x - 14, y + 2, 2, 18, { fill: C.brand, radius: 2, name: "nav-marker" });
  }
  doc.circle(p, x + 2, y + 4, 13, { fill: active ? C.brand : C.s3, name: "nav-dot" });
  doc.text(p, x + 22, y + 2, label, { size: 12.5, color: active ? C.text : C.t2, weight: active ? "Medium" : "Regular" });
  if (count) badge(doc, p, x + w - 40, y + 1, count, { tone: "neutral" });
}

export function statsRow(doc, p, x, y, w, items, { h = 78, gap = 0 } = {}) {
  const cw = w / items.length;
  doc.rect(p, x, y, w, h, { fill: C.s1, stroke: C.line, radius: 12, name: "stats" });
  items.forEach((it, i) => {
    if (i > 0) doc.line(p, x + cw * i, y + 12, 1, { color: C.line, h: h - 24 });
    const cx = x + cw * i + 16;
    doc.text(p, cx, y + 14, it[0], { size: 10.5, color: C.t3 });
    doc.text(p, cx, y + 32, it[1], { size: 20, weight: "Semi Bold", color: it[3] || C.text, track: -0.3 });
    if (it[2]) doc.text(p, cx, y + 58, it[2], { size: 10, color: C.t3 });
  });
}

export function logoSymbol(doc, p, x, y, d = 28) {
  doc.rect(p, x, y, d, d, {
    fill: { type: "linearGradient", stops: [C.brand, "#35D6E8"], from: [0, 0], to: [1, 1] },
    radius: d / 3.5,
    name: "logo-tile",
  });
  doc.path(p, x + d * 0.22, y + d * 0.28, d * 0.56, d * 0.44, "M0 14 L5 9 L9 11 L15 3", {
    stroke: C.white,
    weight: 2.2,
  });
  doc.circle(p, x + d * 0.7, y + d * 0.26, 3.2, { fill: C.white, name: "logo-dot" });
}

/** big app chrome: rail + topbar + telemetry. body is drawn by the caller. */
export function chrome(doc, f, { active = "Overview", crumb = "Overview", w = 1440, h = 900 } = {}) {
  const nav = [
    ["OPERATE", ["Overview", "Markets", "Portfolio", "Strategy & engine", "Backtest", "Analytics", "Journal"]],
    ["GUARD", ["Risk & safety", "AI Copilot"]],
    ["SYSTEM", ["Alerts", "Data & sources", "Settings", "Billing"]],
    ["ADMIN", ["Users & audit"]],
  ];
  // rail
  doc.rect(f, 0, 0, 256, h, { fill: C.elev, name: "rail" });
  doc.line(f, 255, 0, 1, { color: C.line, h });
  logoSymbol(doc, f, 22, 18, 26);
  doc.text(f, 56, 18, "Auto Trader", { size: 14, weight: "Semi Bold", track: -0.3 });
  doc.label(f, 56, 34, "Meridian", { size: 8.5, color: C.t3 });

  doc.rect(f, 14, 60, 228, 44, { fill: C.s1, stroke: C.line, radius: 8, name: "workspace" });
  doc.rect(f, 24, 70, 24, 24, { fill: C.s3, radius: 6, name: "ws-badge" });
  doc.text(f, 32, 76, "AT", { size: 9, weight: "Bold", color: C.t2 });
  doc.text(f, 56, 68, "Paper workspace", { size: 11.5, weight: "Medium" });
  doc.text(f, 56, 83, "Pro plan · BSC", { size: 9.5, color: C.t3 });

  let y = 122;
  for (const [group, items] of nav) {
    doc.label(f, 22, y, group, { size: 8.5, color: C.t3, track: 1 });
    y += 18;
    for (const item of items) {
      navItem(doc, f, 22, y, item, {
        active: item === active,
        count: item === "Risk & safety" || item === "Alerts" ? "2" : null,
      });
      y += 33;
    }
    y += 10;
  }

  doc.rect(f, 14, h - 118, 228, 30, { fill: "rgba(245,180,84,0.12)", radius: 8, name: "mode" });
  doc.circle(f, 24, h - 109, 6, { fill: C.warn, name: "mode-dot" });
  doc.text(f, 38, h - 112, "Paper mode · no capital", { size: 10.5, color: C.warn });
  doc.circle(f, 22, h - 76, 26, {
    fill: { type: "linearGradient", stops: [C.brand, "#35D6E8"], from: [0, 0], to: [1, 1] },
  });
  doc.text(f, 32, h - 70, "AD", { size: 9, weight: "Bold", color: C.white });
  doc.text(f, 56, h - 78, "Alex Duarte", { size: 11.5, weight: "Medium" });
  doc.text(f, 56, h - 63, "super admin", { size: 9, color: C.t3 });

  // topbar
  doc.rect(f, 256, 0, w - 256, 60, { fill: C.bg, name: "topbar" });
  doc.line(f, 256, 59, w - 256, 1, { color: C.line });
  doc.text(f, 288, 22, `${crumb}`, { size: 12, color: C.t3 });
  doc.text(f, 288 + crumb.length * 6.2 + 10, 22, "· live", { size: 12, color: C.t3, opacity: 0.6 });

  doc.rect(f, 700, 13, 300, 34, { fill: C.s1, stroke: C.line, radius: 8, name: "search" });
  doc.text(f, 716, 23, "Search", { size: 11.5, color: C.t3 });
  doc.rect(f, 960, 19, 30, 20, { fill: C.s2, stroke: C.line2, radius: 5, name: "kbd" });
  doc.text(f, 965, 23, "⌘K", { size: 9, weight: "Medium", color: C.t2 });

  doc.rect(f, 1044, 13, 116, 34, { fill: C.s1, stroke: C.line, radius: 8, name: "mode-switch" });
  doc.rect(f, 1047, 16, 54, 28, { fill: C.s3, radius: 6, name: "mode-on" });
  doc.circle(f, 1055, 25, 6, { fill: C.t2 });
  doc.text(f, 1064, 21, "Paper", { size: 10.5, weight: "Semi Bold" });
  doc.text(f, 1110, 21, "Live", { size: 10.5, color: C.t3 });

  doc.rect(f, 1172, 13, 150, 34, { fill: C.s1, stroke: C.line, radius: 999, name: "engine-pill" });
  doc.circle(f, 1186, 25, 7, { fill: C.pos, name: "engine-dot" });
  doc.text(f, 1198, 21, "Running", { size: 11, weight: "Semi Bold" });
  doc.text(f, 1252, 21, "round 4,128", { size: 10.5, color: C.t3 });

  for (let i = 0; i < 3; i++) {
    doc.circle(f, 1344 + i * 34, 18, 24, { fill: C.s1, stroke: C.line, name: "iconbtn" });
  }
  doc.circle(f, 1378, 20, 20, {
    fill: { type: "linearGradient", stops: [C.brand, "#35D6E8"], from: [0, 0], to: [1, 1] },
  });

  // telemetry
  doc.rect(f, 256, h - 34, w - 256, 34, { fill: C.elev, name: "telemetry" });
  doc.line(f, 256, h - 35, w - 256, 1, { color: C.line });
  doc.circle(f, 288, h - 20, 6, { fill: C.pos });
  doc.text(f, 300, h - 24, "Engine running", { size: 9.5, color: C.t3 });
  doc.text(f, 430, h - 24, "RPC 20ms · quorum 100%", { size: 9.5, color: C.t3 });
  doc.text(f, 620, h - 24, "Signer paper", { size: 9.5, color: C.t3 });
  doc.text(f, 740, h - 24, "DB ok · 1.5M rows", { size: 9.5, color: C.t3 });
  doc.text(f, 900, h - 24, "Block 44,182,904", { size: 9.5, color: C.t3 });
  doc.text(f, 1080, h - 24, "BSC mainnet", { size: 9.5, color: C.t3 });
  doc.text(f, 1310, h - 24, "v1.0.0 · meridian", { size: 9.5, color: C.t3 });

  return { x: 288, y: 96, w: w - 288 - 32 };
}

export function pageTitle(doc, f, x, y, title, sub, { w = 700 } = {}) {
  doc.text(f, x, y, title, { size: 28, weight: "Semi Bold", track: -0.6 });
  if (sub) doc.text(f, x, y + 38, sub, { size: 12.5, color: C.t2, w, lh: 19 });
}

export function areaPath(values, w, h) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function writeScript(doc, path) {
  fs.writeFileSync(path, JSON.stringify(doc.steps, null, 1));
  return path;
}

export function series(n, start, drift, vol, seed = 7) {
  let a = seed;
  const rnd = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [];
  let v = start;
  for (let i = 0; i < n; i++) {
    v = Math.max(1, v * (1 + (rnd() - 0.5) * vol + drift));
    out.push(+v.toFixed(2));
  }
  return out;
}
