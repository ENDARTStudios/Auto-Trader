// scripts/lib/demo-ids.mjs — classificação dos IDs de dados DEMO.
//
// Fonte da verdade: scripts/seed-demo.ts (ids fixos, versionados). Mantido puro e
// sem dependências para ser testável (tests/demo-cleanup.test.ts) e reutilizado
// por scripts/clear-demo-data.mjs. Se o seed mudar, mude aqui e o teste falha.

export const DEMO_POSITION_PREFIX = "demo-pos-";
export const DEMO_ORDER_PREFIX = "demo-order-";

// Faixas numéricas criadas pelo seed-demo.ts (id Int em cada tabela).
export const DEMO_RANGES = Object.freeze({
  MarketSnapshot: { lo: 7001, hi: 7010, label: "snapshots de mercado" },
  PerformanceSnapshot: { lo: 8001, hi: 8030, label: "curva de equity" },
  Round: { lo: 9001, hi: 9005, label: "rounds" },
  AppLog: { lo: 6001, hi: 6006, label: "eventos de atividade" },
});

// Tabelas tocadas pelo clear (ordem importa: dependentes primeiro).
export const DEMO_TABLES = Object.freeze([
  "PaperOrder",
  "Position",
  "MarketSnapshot",
  "PerformanceSnapshot",
  "Round",
  "AppLog",
]);

export function isDemoPositionId(id) {
  return typeof id === "string" && id.startsWith(DEMO_POSITION_PREFIX);
}

// PaperOrder é demo quando aponta para uma posição demo (seed usa orderKey(id,'buy')).
export function isDemoOrderPositionId(positionId) {
  return isDemoPositionId(positionId);
}

export function inDemoRange(table, id) {
  const range = DEMO_RANGES[table];
  if (!range) return false;
  if (typeof id !== "number" || !Number.isFinite(id)) return false;
  return id >= range.lo && id <= range.hi;
}

// O que cada tabela precisa para ser limpa (usado pelo script e pelo teste).
export function demoDeleteSpec() {
  return {
    PaperOrder: { column: "positionId", kind: "prefix", value: DEMO_POSITION_PREFIX },
    Position: { column: "id", kind: "prefix", value: DEMO_POSITION_PREFIX },
    MarketSnapshot: { column: "id", kind: "range", lo: DEMO_RANGES.MarketSnapshot.lo, hi: DEMO_RANGES.MarketSnapshot.hi },
    PerformanceSnapshot: { column: "id", kind: "range", lo: DEMO_RANGES.PerformanceSnapshot.lo, hi: DEMO_RANGES.PerformanceSnapshot.hi },
    Round: { column: "id", kind: "range", lo: DEMO_RANGES.Round.lo, hi: DEMO_RANGES.Round.hi },
    AppLog: { column: "id", kind: "range", lo: DEMO_RANGES.AppLog.lo, hi: DEMO_RANGES.AppLog.hi },
  };
}

export function buildCountSql(table, spec) {
  const col = '"' + spec.column + '"';
  const tbl = '"' + table + '"';
  if (spec.kind === "prefix") {
    return { text: "SELECT COUNT(*)::int AS n FROM " + tbl + " WHERE " + col + " LIKE $1", values: [spec.value + "%"] };
  }
  return {
    text: "SELECT COUNT(*)::int AS n FROM " + tbl + " WHERE " + col + " >= $1 AND " + col + " <= $2",
    values: [spec.lo, spec.hi],
  };
}

export function buildDeleteSql(table, spec) {
  const col = '"' + spec.column + '"';
  const tbl = '"' + table + '"';
  if (spec.kind === "prefix") {
    return { text: "DELETE FROM " + tbl + " WHERE " + col + " LIKE $1", values: [spec.value + "%"] };
  }
  return {
    text: "DELETE FROM " + tbl + " WHERE " + col + " >= $1 AND " + col + " <= $2",
    values: [spec.lo, spec.hi],
  };
}

export function totalCounts(counts) {
  return Object.values(counts).reduce((acc, n) => acc + (Number(n) || 0), 0);
}
