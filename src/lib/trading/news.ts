export const NEWS_RSS_FEEDS = [
  "https://www.coindesk.com/arc/outboundfeeds/rss/",
  "https://cointelegraph.com/rss",
  "https://decrypt.co/feed",
] as const;

export type NewsSource = string;

export interface NewsItem {
  title: string;
  link: string;
  summary: string;
  source: NewsSource;
  publishedAt: string | null;
}

export interface NewsResult {
  items: NewsItem[];
  degraded: boolean;
  fetchedAt: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { result: NewsResult; at: number } | null = null;

export function clearNewsCache(): void {
  cache = null;
}

export function isSafeHttpUrl(link: string): boolean {
  try {
    const u = new URL(link);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function stripHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // T052: dangerous tags are never safe to keep, even as text, because
    // downstream consumers may not escape like React does.
    .replace(
      /<\/?(?:script|style|iframe|frame|frameset|object|embed|applet|form|svg|math|link|meta|base|title|textarea|button|select|option|input|video|audio|source|track|canvas|noscript|template|slot)(?:\s[^>]*)?>/gi,
      ""
    )
    // T052: unknown tags carrying attributes (event handlers, href/src with
    // javascript:) are dropped; bare literals like <bar> are preserved.
    .replace(/<[a-zA-Z][^>]*[=:][^>]*>/g, "")
    .replace(
      /<\/?(?:p|b|i|em|strong|br|div|span|a|h[1-6]|ul|ol|li|img|code|pre|article|section)(?:\s[^>]*)?>/gi,
      ""
    )
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

export function parseRssItems(xml: string, source: NewsSource, max = 20): NewsItem[] {
  if (!xml || typeof xml !== "string") return [];
  const items: NewsItem[] = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null && items.length < max) {
    const block = m[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const desc = extractTag(block, "description") ?? extractTag(block, "summary");
    const pub = extractTag(block, "pubDate") ?? extractTag(block, "published");
    if (!title || !link) continue;
    if (!isSafeHttpUrl(link)) continue;
    let publishedAt: string | null = null;
    if (pub) {
      const d = new Date(pub);
      publishedAt = isNaN(d.getTime()) ? null : d.toISOString();
    }
    items.push({
      title: stripHtml(title),
      link,
      summary: desc ? stripHtml(desc).slice(0, 280) : "",
      source,
      publishedAt,
    });
  }
  return items;
}

// T052: bound a single feed body so a malicious/huge feed cannot exhaust
// memory or hang parsing. Oversized feeds are skipped (degraded mode).
export const MAX_FEED_BYTES = 512 * 1024;

async function fetchFeed(url: string, source: NewsSource): Promise<NewsItem[]> {
  const res = await fetch(url, {
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  const declared = res.headers?.get?.("content-length");
  if (declared !== null && declared !== undefined) {
    const n = Number.parseInt(String(declared), 10);
    if (Number.isFinite(n) && n > MAX_FEED_BYTES) {
      throw new Error(`feed too large (${n} bytes)`);
    }
  }
  const text = await res.text();
  return parseRssItems(
    text.length > MAX_FEED_BYTES ? text.slice(0, MAX_FEED_BYTES) : text,
    source
  );
}

function sourceNameFromUrl(url: string): NewsSource {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.split(".")[0].replace(/^\w/, (c) => c.toUpperCase());
  } catch {
    return "Unknown";
  }
}

export async function getNews(limit = 20): Promise<NewsResult> {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return { ...cache.result, items: cache.result.items.slice(0, safeLimit) };
  }

  const settled = await Promise.allSettled(
    NEWS_RSS_FEEDS.map((url) => fetchFeed(url, sourceNameFromUrl(url))),
  );

  const all: NewsItem[] = [];
  let anyOk = false;
  for (const s of settled) {
    if (s.status === "fulfilled") {
      anyOk = true;
      all.push(...s.value);
    }
  }

  all.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });

  const deduped: NewsItem[] = [];
  const seen = new Set<string>();
  for (const item of all) {
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    deduped.push(item);
  }

  const result: NewsResult = {
    items: deduped.slice(0, safeLimit),
    degraded: !anyOk,
    fetchedAt: new Date().toISOString(),
  };

  cache = { result, at: now };
  return result;
}
