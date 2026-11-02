import { describe, expect, it } from "vitest";
import { isBenignSocketError } from "@/lib/crash-logger";

describe("isBenignSocketError", () => {
  it("trata ECONNRESET/EPIPE/ECONNABORTED como benignos", () => {
    expect(isBenignSocketError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(true);
    expect(isBenignSocketError(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }))).toBe(true);
    expect(isBenignSocketError(Object.assign(new Error("x"), { code: "ECONNABORTED" }))).toBe(true);
  });

  it("trata 'aborted' vindo do http server como benigno", () => {
    const err = new Error("aborted");
    err.stack = "Error: aborted\n    at abortIncoming (node:_http_server:911:17)\n    at socketOnClose (node:_http_server:904:3)";
    expect(isBenignSocketError(err)).toBe(true);
  });

  it("não classifica erro genérico como benigno", () => {
    expect(isBenignSocketError(new Error("database is locked"))).toBe(false);
    expect(isBenignSocketError(new Error("aborted"))).toBe(false); // sem stack do http server
    expect(isBenignSocketError(null)).toBe(false);
    expect(isBenignSocketError(undefined)).toBe(false);
    expect(isBenignSocketError("string qualquer")).toBe(false);
  });

  it("não confunde erro de aplicação com o mesmo código textual", () => {
    const err = new Error("Prisma failed: ECONNRESET no pool");
    expect(isBenignSocketError(err)).toBe(false);
  });
});
