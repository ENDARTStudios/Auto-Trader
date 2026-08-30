import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditSite } from "@/lib/trading/site-integrity";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { handleApiError } from "@/lib/api/error-handler";

function getClientIp(req: Request): string {
  const xff = (req.headers as unknown as Headers).get?.("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

const postSchema = z.object({
  url: z.string().url(),
  symbol: z.string().optional(),
  tokenId: z.string().optional(),
  chain: z.string().optional(),
});

// GET /api/site-audit?limit=30
// Returns recent site integrity audits.
export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/site-audit");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "logs:read")) throw new ForbiddenError("logs:read");

    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "30", 10);
    const audits = await db.siteAudit.findMany({
      orderBy: { auditedAt: "desc" },
      take: Math.min(limit, 200),
    });

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
  } catch (err) {
    return handleApiError(err, "GET /api/site-audit");
  }
}

// POST /api/site-audit
// Body: { url, symbol?, tokenId?, chain? }
// Triggers a fresh audit on the given URL.
export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/site-audit");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "logs:read")) throw new ForbiddenError("logs:read");

    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_error", details: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

    const result = await auditSite(body.url, {
      symbol: body.symbol,
      tokenId: body.tokenId,
      chain: body.chain,
    });
    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err, "POST /api/site-audit");
  }
}
