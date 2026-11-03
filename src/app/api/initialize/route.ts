// Initialize database singletons (config / tradingBalance / reserve).
//
// SECURITY: this is an idempotent, non-destructive bootstrap of the singleton
// rows (no credentials, no users). It used to be fully public. It is now gated
// by system:admin (super_admin only) because:
//   - the app auto-initializes the DB on boot (src/instrumentation.ts ->
//     ensureDatabaseReady), so no anonymous bootstrap path is required;
//   - leaving it public allowed anonymous writes to singleton tables.
import { NextResponse } from "next/server";
import { ensureInitialized } from "@/lib/trading/portfolio";
import { requirePermission } from "@/lib/auth/session";
import { handleApiError } from "@/lib/api/error-handler";

export async function POST(req: Request) {
  try {
    await requirePermission("system:admin")(req);
    await ensureInitialized();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, "POST /api/initialize");
  }
}
