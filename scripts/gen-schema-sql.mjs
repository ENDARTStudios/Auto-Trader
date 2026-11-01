// scripts/gen-schema-sql.mjs — gera src/lib/db/schema-sql.generated.ts a partir
// do prisma/schema.prisma. Rodar SEMPRE que o schema mudar (o runtime de
// ambientes efêmeros (Vercel) aplica esse SQL quando o banco está vazio).
// Uso: node scripts/gen-schema-sql.mjs
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const sql = execSync(
  "npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script",
  { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
);

const safe = sql.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const header = `// GERADO AUTOMATICAMENTE por scripts/gen-schema-sql.mjs — não editar à mão.
// Fonte: prisma/schema.prisma (prisma migrate diff --from-empty --to-schema).
// Consumido por src/lib/db-init.ts para auto-inicializar bancos SQLite vazios
// em ambientes efêmeros (ex.: Vercel serverless).
`;

mkdirSync("src/lib/db", { recursive: true });
writeFileSync("src/lib/db/schema-sql.generated.ts", header + "export const SCHEMA_SQL = `" + safe + "`;\n");

const tables = (sql.match(/CREATE TABLE/g) || []).length;
console.log(`gerado src/lib/db/schema-sql.generated.ts (${sql.split("\n").length} linhas, ${tables} tabelas)`);
