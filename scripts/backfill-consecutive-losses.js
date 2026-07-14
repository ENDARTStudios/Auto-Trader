// Backfill `TradingBalance.consecutiveLosses` from closed Position history.
//
// v14 added the consecutiveLosses field, but it was added mid-session so existing
// closed trades didn't increment it. This script scans the most recent closed
// positions in chronological order (newest first), counting backwards:
//   - each losing trade increments the counter
//   - the first winning trade (or no trades at all) resets it to 0
//
// The result is the "current streak of consecutive losses" had the field always
// existed. It's a one-shot migration — once the engine starts incrementing the
// field on closePosition, this script becomes a no-op (idempotent).
//
// Usage:  node /home/z/my-project/scripts/backfill-consecutive-losses.js
//
// Output: prints the old → new value and exits 0 on success.

const { PrismaClient } = require("@prisma/client");

const db = new PrismaClient();

async function main() {
  console.log("→ Reading TradingBalance singleton…");
  const tb = await db.tradingBalance.findUnique({ where: { id: "singleton" } });
  if (!tb) {
    console.error("✗ TradingBalance singleton not found. Run `npx prisma db push` first.");
    process.exit(1);
  }
  const oldValue = tb.consecutiveLosses ?? 0;

  // Fetch closed/liquidated/killed positions ordered by exitAt DESC.
  // We walk backwards until we hit a winning trade (pnlUsd >= 0) or run out.
  // Cap at 1000 to avoid scanning forever on a heavily-used DB.
  console.log("→ Scanning up to 1000 most recent closed positions…");
  const closed = await db.position.findMany({
    where: {
      status: { in: ["closed", "liquidated", "killed"] },
      exitAt: { not: null },
    },
    orderBy: { exitAt: "desc" },
    take: 1000,
    select: {
      id: true,
      symbol: true,
      pnlUsd: true,
      exitAt: true,
      exitReason: true,
    },
  });
  console.log(`  Found ${closed.length} closed positions.`);

  if (closed.length === 0) {
    console.log("→ No closed positions — consecutiveLosses stays at 0.");
    if (oldValue !== 0) {
      await db.tradingBalance.update({
        where: { id: "singleton" },
        data: { consecutiveLosses: 0 },
      });
      console.log(`✓ Reset TradingBalance.consecutiveLosses: ${oldValue} → 0`);
    } else {
      console.log("✓ No changes needed (already 0).");
    }
    return;
  }

  // Walk backwards from most recent — count losses until a win or end of list.
  let streak = 0;
  let firstWin = null;
  for (const p of closed) {
    const pnl = p.pnlUsd ?? 0;
    if (pnl >= 0) {
      firstWin = p;
      break;
    }
    streak++;
  }

  console.log(
    `  Current losing streak: ${streak}` +
      (firstWin
        ? ` (last win was ${firstWin.symbol} on ${firstWin.exitAt.toISOString()} via ${firstWin.exitReason})`
        : " (no winning trades in the scanned window — entire history is losses")
  );

  if (streak === oldValue) {
    console.log(`✓ No changes needed (already ${oldValue}).`);
    return;
  }

  await db.tradingBalance.update({
    where: { id: "singleton" },
    data: { consecutiveLosses: streak },
  });
  console.log(`✓ Updated TradingBalance.consecutiveLosses: ${oldValue} → ${streak}`);

  // If streak hits the circuit-breaker threshold (5), surface a warning so the
  // operator knows the engine will pause SCOUT on the next tick if pauseScoutUntil
  // isn't already set.
  if (streak >= 5) {
    const cfg = await db.config.findUnique({ where: { id: "singleton" } });
    const pauseActive =
      cfg?.pauseScoutUntil && new Date(cfg.pauseScoutUntil) > new Date();
    if (!pauseActive) {
      console.warn(
        `⚠️  Streak >= 5 — the engine will trigger the loss circuit breaker on the next loss. ` +
          `Consider setting pauseScoutUntil manually if you want to pre-empt it.`
      );
    } else {
      console.warn(
        `⚠️  Streak >= 5 AND pauseScoutUntil is already active until ${cfg.pauseScoutUntil.toISOString()}.`
      );
    }
  }
}

main()
  .catch((err) => {
    console.error("✗ Backfill failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
