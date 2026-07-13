import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(req: Request) {
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
}
