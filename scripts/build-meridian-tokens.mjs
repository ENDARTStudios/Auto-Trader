import fs from "node:fs";

const src = fs.readFileSync("design/tokens.css", "utf8");
let out = src
  // scope everything to the Meridian shell so the legacy app keeps its own tokens
  .replace(/^:root \{/m, ".mrd {")
  .replace(/^\[data-theme="light"\] \{/m, '.mrd[data-theme="light"] {')
  .replace(/^@media \(max-width: 1200px\) \{\n  :root \{/m, "@media (max-width: 1200px) {\n  .mrd {")
  .replace(/^@media \(max-width: 640px\) \{\n  :root \{/m, "@media (max-width: 640px) {\n  .mrd {");

out = `/* Gerado de design/tokens.css — escopo .mrd para não vazar no app legado. */\n${out}`;

fs.mkdirSync("src/app/(meridian)", { recursive: true });
fs.writeFileSync("src/app/(meridian)/meridian-tokens.css", out);
console.log("ok", out.length, "chars");
