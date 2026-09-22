import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseRssItems,
  getNews,
  clearNewsCache,
  isSafeHttpUrl,
} from "@/lib/trading/news";

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>CoinDesk</title>
    <item>
      <title>Bitcoin Hits New High</title>
      <link>https://www.coindesk.com/markets/btc-150k/</link>
      <pubDate>Mon, 14 Sep 2026 10:00:00 GMT</pubDate>
      <description>&lt;p&gt;BTC broke &lt;b&gt;$150k&lt;/b&gt; amid ETF inflows.&lt;/p&gt;</description>
    </item>
    <item>
      <title>Ethereum Upgrade Live</title>
      <link>https://www.coindesk.com/tech/eth-upgrade/</link>
      <pubDate>Sun, 13 Sep 2026 09:00:00 GMT</pubDate>
      <description>The upgrade reduces gas fees significantly.</description>
    </item>
    <item>
      <title>Evil Link</title>
      <link>http://evil.example.com/x</link>
      <description>Should be rejected — non-https.</description>
    </item>
    <item>
      <title>Missing Link</title>
      <description>No link tag.</description>
    </item>
  </channel>
</rss>`;

describe("isSafeHttpUrl", () => {
  it("accepts https", () => {
    expect(isSafeHttpUrl("https://example.com/a")).toBe(true);
  });
  it("rejects http", () => {
    expect(isSafeHttpUrl("http://example.com")).toBe(false);
  });
  it("rejects javascript:", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
  });
  it("rejects garbage", () => {
    expect(isSafeHttpUrl("not-a-url")).toBe(false);
  });
});

describe("parseRssItems", () => {
  it("parses valid items and strips HTML", () => {
    const items = parseRssItems(FIXTURE, "CoinDesk");
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Bitcoin Hits New High");
    expect(items[0].source).toBe("CoinDesk");
    expect(items[0].summary).not.toContain("<");
    expect(items[0].summary).toContain("$150k");
    expect(items[0].publishedAt).toBeTruthy();
    expect(items[0].link.startsWith("https://")).toBe(true);
  });

  it("rejects non-https links", () => {
    const items = parseRssItems(FIXTURE, "CoinDesk");
    expect(items.some((i) => i.link.includes("evil"))).toBe(false);
  });

  it("skips items without link", () => {
    const items = parseRssItems(FIXTURE, "CoinDesk");
    expect(items.every((i) => i.link.length > 0)).toBe(true);
  });

  it("returns empty for garbage input", () => {
    expect(parseRssItems("", "X")).toEqual([]);
    expect(parseRssItems("not xml at all", "X")).toEqual([]);
  });

  it("respects max limit", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      `<item><title>T${i}</title><link>https://e.com/${i}</link></item>`,
    ).join("");
    const items = parseRssItems(`<rss><channel>${many}</channel></rss>`, "X", 5);
    expect(items).toHaveLength(5);
  });

  it("decodes basic HTML entities", () => {
    const xml = `<rss><channel><item>
      <title>A &amp; B</title>
      <link>https://e.com/a</link>
      <description>Foo &lt;bar&gt;</description>
    </item></channel></rss>`;
    const items = parseRssItems(xml, "X");
    expect(items[0].title).toBe("A & B");
    expect(items[0].summary).toBe("Foo <bar>");
  });
});

describe("getNews", () => {
  beforeEach(() => {
    clearNewsCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearNewsCache();
  });

  it("aggregates from feeds and sorts newest first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => FIXTURE,
      })),
    );
    const result = await getNews();
    expect(result.degraded).toBe(false);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].title).toBe("Bitcoin Hits New High");
    expect(result.fetchedAt).toBeTruthy();
  });

  it("dedupes identical links across feeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => FIXTURE,
      })),
    );
    const result = await getNews();
    const links = result.items.map((i) => i.link);
    expect(new Set(links).size).toBe(links.length);
  });

  it("returns degraded=true when all feeds fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await getNews();
    expect(result.degraded).toBe(true);
    expect(result.items).toEqual([]);
  });

  it("respects limit parameter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => FIXTURE,
      })),
    );
    const result = await getNews(1);
    expect(result.items).toHaveLength(1);
  });

  it("caches result (second call does not refetch)", async () => {
    const mock = vi.fn(async () => ({
      ok: true,
      text: async () => FIXTURE,
    }));
    vi.stubGlobal("fetch", mock);
    await getNews();
    const callsAfterFirst = mock.mock.calls.length;
    await getNews();
    expect(mock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("handles non-ok responses as empty feed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, text: async () => "" })),
    );
    const result = await getNews();
    expect(result.degraded).toBe(true);
  });

  it("clamps non-positive/NaN limit to default 20", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => FIXTURE,
      })),
    );
    const neg = await getNews(-5);
    expect(neg.items).toHaveLength(2);
    const zero = await getNews(0);
    expect(zero.items).toHaveLength(2);
    const nan = await getNews(NaN);
    expect(nan.items).toHaveLength(2);
  });
});
