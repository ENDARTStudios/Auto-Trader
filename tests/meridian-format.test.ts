import { describe, expect, it } from "vitest";
import {
  clockUtc,
  compact,
  duration,
  money,
  pct,
  price,
  signedUsd,
  stampUtc,
  toneOf,
  usd,
} from "@/lib/meridian/format";
import { MERIDIAN_ROUTES, isChromelessPath, isMeridianPath } from "@/lib/meridian/nav";

describe("format — dinheiro", () => {
  it("usa sinal tipográfico e mantém casas decimais", () => {
    expect(usd(1234.5)).toBe("$1,234.50");
    expect(usd(-42.1)).toBe("−$42.10");
    expect(usd(0)).toBe("$0.00");
  });

  it("signedUsd só mostra + quando é positivo", () => {
    expect(signedUsd(12)).toBe("+$12.00");
    expect(signedUsd(-12)).toBe("−$12.00");
    expect(signedUsd(0)).toBe("$0.00");
  });

  it("pct formata com sinal", () => {
    expect(pct(9.69)).toBe("+9.69%");
    expect(pct(-3)).toBe("−3.00%");
    expect(pct(0)).toBe("0.00%");
  });

  it("money abrevia milhares, milhões e bilhões", () => {
    expect(money(950)).toBe("$950");
    expect(money(7400)).toBe("$7.4K");
    expect(money(2_400_000)).toBe("$2.40M");
    expect(money(1_500_000_000)).toBe("$1.50B");
  });

  it("compact usa uma casa e não tem símbolo de moeda", () => {
    expect(compact(999)).toBe("999");
    expect(compact(1500)).toBe("1.5K");
    expect(compact(2_500_000)).toBe("2.5M");
  });

  it("price adapta a precisão ao tamanho do ativo", () => {
    expect(price(96_420.18)).toBe("96,420.18");
    expect(price(208.44)).toBe("208.44");
    expect(price(5.412)).toBe("5.41");
    expect(price(0.5)).toBe("0.5000");
    expect(price(0.0000108)).toBe("0.0000108");
  });

  it("entradas inválidas caem para zero em vez de NaN", () => {
    expect(usd(Number.NaN)).toBe("$0.00");
    expect(pct(Number.POSITIVE_INFINITY)).toBe("0.00%");
    expect(price(Number.NaN)).toBe("0.0000000");
  });
});

describe("format — tempo", () => {
  it("clockUtc devolve HH:mm em UTC", () => {
    expect(clockUtc("2026-11-01T20:35:00.000Z")).toBe("20:35");
  });

  it("stampUtc inclui dia e mês", () => {
    expect(stampUtc("2026-11-01T20:35:00.000Z")).toContain("20:35");
    expect(stampUtc(null)).toBe("—");
    expect(stampUtc("not-a-date")).toBe("—");
  });

  it("duration mostra a unidade mais útil", () => {
    expect(duration(0)).toBe("—");
    expect(duration(45_000)).toBe("45s");
    expect(duration(125_000)).toBe("2m 05s");
    expect(duration(3_930_000)).toBe("1h 05m");
  });
});

describe("nav — rotas do shell", () => {
  it("reconhece rotas migradas e subrotas", () => {
    for (const route of MERIDIAN_ROUTES) expect(isMeridianPath(route)).toBe(true);
    expect(isMeridianPath("/positions/abc-123")).toBe(true);
    expect(isMeridianPath("/terminal")).toBe(false);
    expect(isMeridianPath(null)).toBe(false);
  });

  it("páginas públicas também ficam sem o chrome antigo", () => {
    expect(isChromelessPath("/welcome")).toBe(true);
    expect(isChromelessPath("/login")).toBe(true);
    expect(isChromelessPath("/forgot")).toBe(true);
    expect(isChromelessPath("/reset")).toBe(true);
    expect(isChromelessPath("/admin/users")).toBe(false);
  });
});

describe("format — tom", () => {
  it("classifica zero como neutro", () => {
    expect(toneOf(1)).toBe("pos");
    expect(toneOf(-1)).toBe("neg");
    expect(toneOf(0)).toBe("neutral");
  });
});
