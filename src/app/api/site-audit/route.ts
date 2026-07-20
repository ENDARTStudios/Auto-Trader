import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auditSite } from "@/lib/trading/site-integrity";

// GET /api/site-audit?limit=30
// Returns recent site integrity audits.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "30", 10);
  const audits = await db.siteAudit.findMany({
    orderBy: { auditedAt: "desc" },
    take: Math.min(limit, 200),
  });

  // Parse JSON fields back to objects
  const parsed = audits.map((a) => ({
    ...a,
    redFlags: (() => {
      try {
        return JSON.parse(a.redFlags ?? "[]") as string[];
      } catch {
        return [];
      }
    })(),
    findings: (() => {
      try {
        return JSON.parse(a.findings ?? "{}") as Record<string, string[]>;
      } catch {
        return {};
      }
    })(),
  }));

  return NextResponse.json(parsed);
}

// POST /api/site-audit
// Body: { url, symbol?, tokenId?, chain? }
// Triggers a fresh audit on the given URL.
export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      url: string;
      symbol?: string;
      tokenId?: string;
      chain?: string;
    };
    if (!body.url) {
      return NextResponse.json({ error: "url é obrigatório" }, { status: 400 });
    }
    const result = await auditSite(body.url, {
      symbol: body.symbol,
      tokenId: body.tokenId,
      chain: body.chain,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
