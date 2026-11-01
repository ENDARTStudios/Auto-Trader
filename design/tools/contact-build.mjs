import fs from "node:fs";

const shots = [
  ["Overview", "final-overview.png"],
  ["Markets", "final-markets.png"],
  ["Token detail", "final-token.png"],
  ["Portfolio", "final-portfolio.png"],
  ["Position", "final-position.png"],
  ["Strategy", "final-strategy.png"],
  ["Risk & safety", "final-risk.png"],
  ["AI Copilot", "final-copilot.png"],
  ["Backtest", "final-backtest.png"],
  ["Analytics", "final-analytics.png"],
  ["Journal", "final-journal.png"],
  ["Onboarding", "final-onboarding.png"],
];

const base = "D:/PROJETOS/Auto Trader/at-meridian/design/prototype/shots/";
const pageW = 842;
const pageH = 595;
const margin = 40;
const cols = 4;
const rows = 3;
const gapX = 18;
const gapY = 26;
const capH = 18;
const cellW = (pageW - margin * 2 - gapX * (cols - 1)) / cols;
const cellH = cellW / 1.6;

const steps = [
  { command: "file.new", params: { width: pageW, height: pageH, pages: 1, intent: "print", margins: margin, facingPages: false } },
  { command: "frame.create", params: { rect: [margin, 34, pageW - margin, 62], content: "text", text: "Auto Trader — Meridian" } },
  { command: "frame.create", params: { rect: [margin, 62, pageW - margin, 82], content: "text", text: "12 of 22 screens · UI/UX concept v1.0 · 1440×900 · 01 Nov 2026" } },
  { command: "frame.create", params: { rect: [margin, 86, pageW - margin, 88], content: "graphic" } },
];

shots.forEach(([label, file], i) => {
  const col = i % cols;
  const row = Math.floor(i / cols);
  const x = margin + col * (cellW + gapX);
  const y = 96 + row * (cellH + gapY + capH);
  steps.push({ command: "place.load", params: { path: base + file } });
  steps.push({ command: "place.drop", params: { x, y, rect: [x, y, x + cellW, y + cellH] } });
  steps.push({ command: "frame.create", params: { rect: [x, y + cellH + 2, x + cellW, y + cellH + capH], content: "text", text: label } });
});

steps.push({ command: "file.exportPdf", params: { path: "D:/PROJETOS/Auto Trader/at-meridian/design/brand/exports/contact-sheet.pdf" } });
steps.push({ command: "file.saveAs", params: { path: "D:/PROJETOS/Auto Trader/at-meridian/design/brand/exports/contact-sheet.designcraft" } });

fs.writeFileSync("D:/PROJETOS/Auto Trader/at-meridian/design/brand/contact-script.json", JSON.stringify(steps, null, 2));
console.log("steps", steps.length, "cell", cellW.toFixed(0), "x", cellH.toFixed(0));
