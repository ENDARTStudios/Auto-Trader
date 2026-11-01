import { Doc, C, FONT, writeScript } from "./figcraft-lib.mjs";

const doc = new Doc();
doc.add("page.rename", { name: "Brand" });

/* 512 tile */
{
  const f = doc.frame("logo-tile", 0, 0, 512, 512, { fill: C.bg });
  doc.rect(f, 64, 64, 384, 384, {
    fill: { type: "linearGradient", stops: ["#5B6CFF", "#35D6E8"], from: [0, 0], to: [1, 1] },
    radius: 96,
    name: "tile",
  });
  doc.path(f, 148, 176, 216, 160, "M0 120 L48 72 L86 96 L160 16", { stroke: C.white, weight: 18 });
  doc.circle(f, 342, 176, 44, { fill: C.white, name: "dot" });
}

/* 512 mark on dark (transparent background export) */
{
  const f = doc.frame("logo-mark", 600, 0, 512, 512, { fill: C.bg });
  doc.rect(f, 156, 156, 200, 200, {
    fill: { type: "linearGradient", stops: ["#5B6CFF", "#35D6E8"], from: [0, 0], to: [1, 1] },
    radius: 50,
    name: "tile",
  });
  doc.path(f, 200, 216, 112, 84, "M0 62 L25 38 L45 50 L84 8", { stroke: C.white, weight: 9.5 });
  doc.circle(f, 300, 216, 23, { fill: C.white });
}

/* wordmark */
{
  const f = doc.frame("logo-wordmark", 1200, 0, 640, 200, { fill: C.bg });
  doc.rect(f, 32, 56, 88, 88, {
    fill: { type: "linearGradient", stops: ["#5B6CFF", "#35D6E8"], from: [0, 0], to: [1, 1] },
    radius: 22,
  });
  doc.path(f, 51, 82, 50, 38, "M0 28 L11 17 L20 22 L37 3", { stroke: C.white, weight: 4.2 });
  doc.circle(f, 94, 82, 10, { fill: C.white });
  doc.text(f, 140, 62, "Auto Trader", { size: 40, weight: "Semi Bold", track: -1 });
  doc.text(f, 142, 112, "MERIDIAN", { size: 12, weight: "Medium", color: C.t3, track: 3 });
}

writeScript(doc, "design/brand/brand-script.json");
console.log("steps", doc.steps.length);
