// src/app/api/runtime/status/route.ts
//
// M5.5c — Read-only runtime status endpoint.
//
// Per the operator's M5 directive:
//
//   "The API must be read-only.
//    No business logic.
//    Only exposure of the Registry."
//
// Returns the current RuntimeSnapshot from the global Registry. The
// snapshot includes:
//   - runtime status (RUNNING/STOPPED/DEGRADED)
//   - uptime (seconds)
//   - round counters (started/ok/failed)
//   - latency percentiles (pipeline/signer/broadcaster/lease p50/p95/p99)
//   - lease state (active/renews/failures)
//   - canary state (pct/accepted/skipped)
//   - RPC quorum health (healthy/unhealthy/errors)
//   - per-gate reject counters
//   - error counters (rpc/signer/broadcast)
//   - shadow diff counter
//
// If no runtime has been attached (engine not started), the endpoint
// returns a snapshot with all-zero counters + status="STOPPED".
//
// Response shape:
//
//   {
//     "runtime": "RUNNING",
//     "uptime": 18233,
//     "rounds": { "started": 1524, "ok": 1522, "failed": 2 },
//     "latency": { "pipelineP95": 41, "signerP95": 17, "broadcasterP95": 28, ... },
//     "lease": { "active": true, "renews": 514, "failures": 0 },
//     "canary": { "pct": 5, "accepted": 73, "skipped": 1448 },
//     "rpc": { "quorumHealthy": 3, "unhealthy": 0, "errors": 0 },
//     "gateRejects": { "liquidity": 0, "authority": 0, ... },
//     "errors": { "rpc": 0, "signer": 0, "broadcast": 0 },
//     "shadow": { "diffs": 0 },
//     "ts": 1718000000000
//   }

import { NextResponse } from "next/server";
import { Exporter } from "@/lib/observability/exporter";

// Force dynamic — never cache. The snapshot is real-time state.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const exporter = Exporter.global();
  const snapshot = exporter.export();
  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
    },
  });
}
