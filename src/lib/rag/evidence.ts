// Ledger de evidências (Fase C): toda afirmação numérica precisa aparecer em
// alguma citação usada para responder. Implementação própria; nenhum código
// externo copiado. Regra cultural: número sem fonte não é "aceito por padrão".

export interface Claim {
  raw: string;
  value: number;
  kind: "money" | "percent" | "number";
}

export interface Citation {
  entityType?: string;
  entityId?: string;
  score?: number;
  content: string;
}

export interface ClaimEvidence extends Claim {
  supported: boolean;
  source?: { entityType?: string; entityId?: string };
}

export interface EvidenceLedger {
  verdict: "grounded" | "partial" | "unsupported" | "no_claims";
  claims: ClaimEvidence[];
  unsupportedCount: number;
  citationCount: number;
}

const MONEY = /(?:US\$|R\$|\$)\s?-?\d+(?:[.,]\d{3})*(?:[.,]\d+)?/g;
const PERCENT = /-?\d+(?:[.,]\d{3})*(?:[.,]\d+)?\s?%/g;
const NUMBER = /-?\d+(?:[.,]\d{3})*(?:[.,]\d+)?/g;

/** Normaliza "1.234,56", "1,234.56", "US$ 1.234,56" e "12%" para número. */
export function normalizeNumber(raw: string): number | null {
  const cleaned = raw
    .replace(/US\$|R\$|\$|%/g, "")
    .replace(/\s/g, "")
    .trim();
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma > -1 && lastDot > -1) {
    // o separador decimal é o que aparece por último
    normalized = lastComma > lastDot ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (lastComma > -1) {
    const decimals = cleaned.length - lastComma - 1;
    normalized = decimals === 3 ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  } else if (lastDot > -1) {
    const decimals = cleaned.length - lastDot - 1;
    normalized = decimals === 3 && cleaned.split(".").length > 2 ? cleaned.replace(/\./g, "") : cleaned;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function extractClaims(text: string): Claim[] {
  const claims: Claim[] = [];
  const seen = new Set<string>();

  const push = (raw: string, kind: Claim["kind"]) => {
    const value = normalizeNumber(raw);
    if (value === null) return;
    const key = `${kind}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    claims.push({ raw: raw.trim(), value, kind });
  };

  for (const m of text.matchAll(MONEY)) push(m[0], "money");
  for (const m of text.matchAll(PERCENT)) push(m[0], "percent");
  for (const m of text.matchAll(NUMBER)) {
    const raw = m[0];
    const idx = m.index ?? 0;
    const prev = text[idx - 1] ?? "";
    const next = text[idx + raw.length] ?? "";
    // ignora números dentro de dinheiro/percentual já capturados
    const around = text.slice(Math.max(0, idx - 3), idx + raw.length + 1);
    if (/\$|%/.test(around)) continue;
    // ignora hashes/identificadores (0xC02a..., token123): letra ou dígito colado
    if (/[0-9a-zA-Z_]/.test(prev) || /[0-9a-zA-Z_]/.test(next)) continue;
    push(raw, "number");
  }
  return claims;
}

function citationHasValue(content: string, value: number): boolean {
  for (const c of extractClaims(content)) {
    if (Math.abs(c.value - value) <= Math.max(1e-9, Math.abs(value) * 1e-9)) return true;
  }
  return false;
}

export function buildEvidenceLedger(answer: string, citations: Citation[]): EvidenceLedger {
  const claims = extractClaims(answer);
  const evidence: ClaimEvidence[] = claims.map((claim) => {
    const source = citations.find((c) => citationHasValue(c.content ?? "", claim.value));
    return {
      ...claim,
      supported: Boolean(source),
      source: source ? { entityType: source.entityType, entityId: source.entityId } : undefined,
    };
  });

  const unsupportedCount = evidence.filter((e) => !e.supported).length;
  const verdict: EvidenceLedger["verdict"] =
    evidence.length === 0
      ? "no_claims"
      : unsupportedCount === 0
        ? "grounded"
        : unsupportedCount === evidence.length
          ? "unsupported"
          : "partial";

  return { verdict, claims: evidence, unsupportedCount, citationCount: citations.length };
}
