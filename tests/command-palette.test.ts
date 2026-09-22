import { describe, it, expect } from "vitest";
import {
  filterCommands,
  filterActions,
  filterSymbols,
  isShortcutEvent,
  type PaletteEntry,
} from "@/components/dashboard/command-palette-utils";

const NAV: PaletteEntry[] = [
  { id: "history", label: "Histórico" },
  { id: "rounds", label: "Rounds" },
  { id: "backtest", label: "Backtest" },
  { id: "analytics", label: "Analytics" },
];

const ACTIONS: PaletteEntry[] = [
  { id: "start", label: "Iniciar engine", keywords: ["start", "play"] },
  { id: "stop", label: "Parar engine", keywords: ["stop", "pause"] },
  { id: "kill", label: "Kill switch", keywords: ["emergency"] },
];

const SYMBOLS: PaletteEntry[] = [
  { id: "1", label: "BTC/USDT", detail: "cex" },
  { id: "2", label: "ETH/USDT", detail: "cex" },
  { id: "3", label: "SOL/USDT", detail: "dex", keywords: ["solana"] },
  { id: "4", label: "BTC/USDT", detail: "dex" },
];

describe("filterCommands", () => {
  it("returns all when query empty", () => {
    expect(filterCommands(NAV, "")).toHaveLength(4);
    expect(filterCommands(NAV, "   ")).toHaveLength(4);
  });

  it("matches label case-insensitively", () => {
    expect(filterCommands(NAV, "hIST").map((e) => e.id)).toEqual(["history"]);
    expect(filterCommands(NAV, "back").map((e) => e.id)).toEqual(["backtest"]);
  });

  it("matches keywords", () => {
    expect(filterCommands(ACTIONS, "emergency").map((e) => e.id)).toEqual(["kill"]);
    expect(filterCommands(ACTIONS, "pause").map((e) => e.id)).toEqual(["stop"]);
  });

  it("returns empty for no match", () => {
    expect(filterCommands(NAV, "zzzz")).toEqual([]);
  });
});

describe("filterActions", () => {
  it("filters by label", () => {
    expect(filterActions(ACTIONS, "kill").map((e) => e.id)).toEqual(["kill"]);
  });

  it("empty query returns all", () => {
    expect(filterActions(ACTIONS, "")).toHaveLength(3);
  });
});

describe("filterSymbols", () => {
  it("dedupes same label+detail", () => {
    const r = filterSymbols(SYMBOLS, "");
    expect(r).toHaveLength(4); // BTC/USDT cex and dex are distinct
  });

  it("dedupes exact label+detail duplicates", () => {
    const dupes: PaletteEntry[] = [
      { id: "a", label: "BTC/USDT", detail: "cex" },
      { id: "b", label: "BTC/USDT", detail: "cex" },
    ];
    expect(filterSymbols(dupes, "")).toHaveLength(1);
  });

  it("matches by keyword", () => {
    expect(filterSymbols(SYMBOLS, "solana").map((e) => e.id)).toEqual(["3"]);
  });
});

describe("isShortcutEvent", () => {
  it("detects meta+k", () => {
    expect(isShortcutEvent({ metaKey: true, key: "k" } as KeyboardEvent)).toBe(true);
  });

  it("detects ctrl+k", () => {
    expect(isShortcutEvent({ metaKey: false, ctrlKey: true, key: "k" } as KeyboardEvent)).toBe(true);
  });

  it("rejects other keys", () => {
    expect(isShortcutEvent({ metaKey: true, key: "j" } as KeyboardEvent)).toBe(false);
    expect(isShortcutEvent({ metaKey: false, ctrlKey: false, key: "k" } as KeyboardEvent)).toBe(false);
  });
});
