import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseRssItems,
  getNews,
  clearNewsCache,
} from "@/lib/trading/news";
import {
  preferencesSchema,
  serializePreferences,
} from "@/lib/preferences";
import {
  isShortcutEvent,
  isEditableTarget,
  filterCommands,
} from "@/components/dashboard/command-palette-utils";
import { getAvailableActionIds } from "@/components/dashboard/command-palette";

// ---------------------------------------------------------------------------
// T052 — S41 security vectors (TDD: red before fix)
// ---------------------------------------------------------------------------

const MALICIOUS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>&lt;script&gt;alert(document.cookie)&lt;/script&gt; Market News</title>
    <link>https://example.com/a</link>
    <description>&lt;img src=x onerror=alert(1)&gt; summary</description>
  </item>
  <item>
    <title>SVG vector</title>
    <link>https://example.com/b</link>
    <description><svg onload="alert(1)"><circle r="5"/></svg> text</description>
  </item>
  <item>
    <title>iframe vector</title>
    <link>https://example.com/c</link>
    <description><iframe src="https://evil.example.com"></iframe> text</description>
  </item>
  <item>
    <title>JS link</title>
    <link>javascript:alert(1)</link>
    <description>must be dropped</description>
  </item>
</channel></rss>`;

describe("news XSS — dangerous markup never survives parsing", () => {
  it("strips entity-encoded <script> from title", () => {
    const items = parseRssItems(MALICIOUS_FEED, "X");
    const a = items.find((i) => i.link.endsWith("/a"))!;
    expect(a.title).not.toContain("<script");
    expect(a.title).not.toContain("</script");
    expect(a.title).toContain("Market News");
  });

  it("strips entity-encoded <img onerror> from description", () => {
    const items = parseRssItems(MALICIOUS_FEED, "X");
    const a = items.find((i) => i.link.endsWith("/a"))!;
    expect(a.summary).not.toContain("<img");
    expect(a.summary).not.toContain("onerror");
  });

  it("strips raw <svg onload> from description", () => {
    const items = parseRssItems(MALICIOUS_FEED, "X");
    const b = items.find((i) => i.link.endsWith("/b"))!;
    expect(b.summary).not.toContain("<svg");
    expect(b.summary).not.toContain("onload");
  });

  it("strips raw <iframe> from description", () => {
    const items = parseRssItems(MALICIOUS_FEED, "X");
    const c = items.find((i) => i.link.endsWith("/c"))!;
    expect(c.summary).not.toContain("<iframe");
    expect(c.summary).not.toContain("evil.example.com");
  });

  it("drops javascript: links entirely", () => {
    const items = parseRssItems(MALICIOUS_FEED, "X");
    expect(items.some((i) => i.link.startsWith("javascript:"))).toBe(false);
  });

  it("preserves innocent literal angle text (no over-strip)", () => {
    const xml = `<rss><channel><item>
      <title>5 &lt; 10 and 20 &gt; 15</title>
      <link>https://e.com/x</link>
    </item></channel></rss>`;
    const items = parseRssItems(xml, "X");
    expect(items[0].title).toContain("5 < 10");
  });
});

describe("news DoS — oversized feeds are bounded", () => {
  beforeEach(() => clearNewsCache());
  afterEach(() => {
    vi.unstubAllGlobals();
    clearNewsCache();
  });

  it("skips feed advertising content-length over the cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: (k: string) => (k.toLowerCase() === "content-length" ? "9000000" : null) },
        text: async () => "<rss></rss>",
      })),
    );
    const result = await getNews();
    // all three feeds oversized -> degraded, no items, no hang
    expect(result.degraded).toBe(true);
    expect(result.items).toEqual([]);
  });

  it("truncates unbounded huge bodies to the cap", async () => {
    const big = `<rss><channel><item><title>${"A".repeat(2_000_000)}</title><link>https://e.com/big</link></item></channel></rss>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => null },
        text: async () => big,
      })),
    );
    const result = await getNews();
    const total = result.items.reduce((n, i) => n + i.title.length + i.summary.length, 0);
    expect(total).toBeLessThanOrEqual(600_000);
  });
});

describe("preferences — mass assignment neutralized", () => {
  it("strips privileged keys even when sent in body", () => {
    const parsed = preferencesSchema.parse({
      riskTolerance: "balanced",
      goals: ["growth"],
      role: "super_admin",
      permissions: ["*"],
      userId: "someone-else",
      onboardedAt: new Date().toISOString(),
      isAdmin: true,
    } as unknown as Record<string, unknown>);
    expect(parsed).not.toHaveProperty("role");
    expect(parsed).not.toHaveProperty("permissions");
    expect(parsed).not.toHaveProperty("userId");
    expect(parsed).not.toHaveProperty("onboardedAt");
    expect(parsed).not.toHaveProperty("isAdmin");
    expect(parsed.riskTolerance).toBe("balanced");
  });

  it("serialize round-trip drops privileged keys", () => {
    const out = JSON.parse(
      serializePreferences({
        riskTolerance: "aggressive",
        role: "super_admin",
      } as unknown as Parameters<typeof serializePreferences>[0]),
    );
    expect(out).not.toHaveProperty("role");
  });

  it("rejects invalid enum, overlong strings and oversized arrays", () => {
    expect(() =>
      preferencesSchema.parse({ riskTolerance: "degen" }),
    ).toThrow();
    expect(() =>
      preferencesSchema.parse({ goals: ["x".repeat(65)] }),
    ).toThrow();
    expect(() =>
      preferencesSchema.parse({ goals: Array.from({ length: 21 }, (_, i) => `g${i}`) }),
    ).toThrow();
  });
});

describe("palette RBAC — privileged actions hidden by role", () => {
  it("viewer sees only logout", () => {
    expect(getAvailableActionIds("viewer")).toEqual(["logout"]);
  });

  it("trader sees start/stop/kill/logout", () => {
    expect(getAvailableActionIds("trader")).toEqual(["start", "stop", "kill", "logout"]);
  });

  it("super_admin sees start/stop/kill/logout", () => {
    expect(getAvailableActionIds("super_admin")).toEqual(["start", "stop", "kill", "logout"]);
  });

  it("null/unknown role sees only logout", () => {
    expect(getAvailableActionIds(null)).toEqual(["logout"]);
    expect(getAvailableActionIds("hacker")).toEqual(["logout"]);
  });
});

describe("palette shortcut guards (regression)", () => {
  it("detects cmd/ctrl+K only", () => {
    expect(isShortcutEvent({ metaKey: true, ctrlKey: false, key: "k" } as KeyboardEvent)).toBe(true);
    expect(isShortcutEvent({ metaKey: false, ctrlKey: true, key: "K" } as KeyboardEvent)).toBe(true);
    expect(isShortcutEvent({ metaKey: false, ctrlKey: false, key: "k" } as KeyboardEvent)).toBe(false);
    expect(isShortcutEvent({ metaKey: true, ctrlKey: false, key: "j" } as KeyboardEvent)).toBe(false);
  });

  it("treats inputs/textareas/contenteditables as editable", () => {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "textarea" })).toBe(true);
    expect(isEditableTarget({ isContentEditable: true, tagName: "DIV" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV" })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it("filter is case-insensitive substring match", () => {
    const entries = [{ id: "a", label: "Start Engine", keywords: ["play"] }];
    expect(filterCommands(entries, "start")).toHaveLength(1);
    expect(filterCommands(entries, "PLAY")).toHaveLength(1);
    expect(filterCommands(entries, "zzz")).toHaveLength(0);
  });
});
