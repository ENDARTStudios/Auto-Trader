import { NextResponse } from "next/server";
import {
  PLATFORM_REGISTRY,
  scanAllPlatforms,
  scanPlatform,
  getCachedPlatformScan,
  getApprovedPlatformIds,
} from "@/lib/trading/platform-scanner";

export const dynamic = "force-dynamic";

// GET /api/platforms
//   ?refresh=1   → force fresh audit on every platform (slow — ~2-3 min)
//   ?approved=1  → return just the set of approved platform IDs
// Default: return cached scan results (instant).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";
  const approvedOnly = url.searchParams.get("approved") === "1";

  try {
    if (approvedOnly) {
      const ids = await getApprovedPlatformIds();
      return NextResponse.json({
        approved: Array.from(ids),
        count: ids.size,
      });
    }

    if (refresh) {
      const summary = await scanAllPlatforms({ force: true, concurrency: 4 });
      return NextResponse.json(summary);
    }

    const summary = await getCachedPlatformScan();
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[/api/platforms] error:", err);
    return NextResponse.json(
      { error: String(err), total: 0, approved: 0, rejected: 0, pending: 0, results: [] },
      { status: 500 }
    );
  }
}

// POST /api/platforms
// Body: { platformId?: string, action?: "scan_one" | "scan_all" }
//   - Without body or with action="scan_all": scan every platform (cache-aware — uses cache when <24h old)
//   - With action="scan_one" + platformId: scan a single platform
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      platformId?: string;
      action?: "scan_one" | "scan_all";
      force?: boolean;
    };

    if (body.action === "scan_one" && body.platformId) {
      const result = await scanPlatform(body.platformId, { force: body.force ?? true });
      return NextResponse.json(result);
    }

    // Default: scan all (cache-aware)
    const summary = await scanAllPlatforms({ force: body.force ?? false, concurrency: 3 });
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[/api/platforms] POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
