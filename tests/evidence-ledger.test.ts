import { describe, expect, it } from "vitest";
import { buildEvidenceLedger, extractClaims, normalizeNumber } from "@/lib/rag/evidence";

describe("normalizeNumber", () => {
  it("entende formato pt-BR e en-US", () => {
    expect(normalizeNumber("1.234,56")).toBeCloseTo(1234.56, 6);
    expect(normalizeNumber("1,234.56")).toBeCloseTo(1234.56, 6);
    expect(normalizeNumber("US$ 1.234,56")).toBeCloseTo(1234.56, 6);
    expect(normalizeNumber("12,5%")).toBeCloseTo(12.5, 6);
  });

  it("distingue milhar de decimal pela convenção do separador", () => {
    // ponto único é decimal (en-US, formato das citações); vírgula com 3 casas é milhar (pt-BR)
    expect(normalizeNumber("1.234")).toBeCloseTo(1.234, 6);
    expect(normalizeNumber("1,234")).toBe(1234);
    expect(normalizeNumber("0,5")).toBe(0.5);
    expect(normalizeNumber("abc")).toBeNull();
  });
});

describe("extractClaims", () => {
  it("separa dinheiro, percentual e número", () => {
    const claims = extractClaims("Equity de US$ 11.018,80, +9,69% em 30 dias e 3 posições.");
    const kinds = claims.map((c) => c.kind);
    expect(kinds).toContain("money");
    expect(kinds).toContain("percent");
    expect(claims.some((c) => c.kind === "money" && c.value === 11018.8)).toBe(true);
    expect(claims.some((c) => c.kind === "percent" && c.value === 9.69)).toBe(true);
  });

  it("ignora hash/identificador no meio do texto", () => {
    const claims = extractClaims("Contrato 0xC02aaA39b223FE8D000A0e5C4F27eAD9083C756Cc2 e token123.");
    expect(claims).toHaveLength(0);
  });

  it("não duplica o mesmo valor", () => {
    const claims = extractClaims("12,5% e 12,5%");
    expect(claims.filter((c) => c.value === 12.5)).toHaveLength(1);
  });
});

describe("buildEvidenceLedger", () => {
  const citations = [
    { entityType: "position", entityId: "p1", content: "Entrada em SOLUSDT por US$ 196.20, tamanho 3536.61" },
  ];

  it("marca como grounded quando o número aparece na citação (formato diferente)", () => {
    const ledger = buildEvidenceLedger("A entrada foi de $196,20.", citations);
    expect(ledger.verdict).toBe("grounded");
    expect(ledger.unsupportedCount).toBe(0);
    expect(ledger.claims[0].source?.entityId).toBe("p1");
  });

  it("marca partial quando parte dos números tem fonte", () => {
    const ledger = buildEvidenceLedger("Entrada de $196,20 e alvo de $232,00.", citations);
    expect(ledger.verdict).toBe("partial");
    expect(ledger.unsupportedCount).toBe(1);
  });

  it("marca unsupported quando nenhum número aparece", () => {
    const ledger = buildEvidenceLedger("O drawdown foi de 42,7%.", citations);
    expect(ledger.verdict).toBe("unsupported");
  });

  it("sem números não há claim a auditar", () => {
    const ledger = buildEvidenceLedger("Não há dados suficientes para responder.", citations);
    expect(ledger.verdict).toBe("no_claims");
    expect(ledger.claims).toHaveLength(0);
  });

  it("registra a citação que sustenta cada número", () => {
    const ledger = buildEvidenceLedger("Tamanho de 3536.61.", citations);
    expect(ledger.claims[0].supported).toBe(true);
    expect(ledger.claims[0].source?.entityType).toBe("position");
  });
});
