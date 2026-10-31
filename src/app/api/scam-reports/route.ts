import { NextResponse } from "next/server";
import { db } from "@/lib/db";
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

export async function GET(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip, "/api/scam-reports");
    if (!rl.allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
    }
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);

    const reports = await db.scamReport.findMany({
      orderBy: { analyzedAt: "desc" },
      take: limit,
    });

    return NextResponse.json(
      reports.map((r) => ({
        id: r.id,
        symbol: r.symbol,
        tokenId: r.tokenId,
        chain: r.chain,
        score: r.score,
        passed: r.passed,
        honeypotScore: r.honeypotScore,
        liquidityScore: r.liquidityScore,
        contractScore: r.contractScore,
        taxScore: r.taxScore,
        holderScore: r.holderScore,
        ageScore: r.ageScore,
        findings: r.findings ? JSON.parse(r.findings) : {},
        analyzedAt: r.analyzedAt.toISOString(),
      }))
    );
  } catch (err) {
    return handleApiError(err, "GET /api/scam-reports");
  }
}
