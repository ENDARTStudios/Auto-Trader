// Backfill `PaperCycleAttempt` rows from historical completed Rounds OR —
// when no completed Round exists (e.g. mid-session restarts left rounds as
// "running") — from closed Positions grouped by roundId.
//
// v14 introduced PaperCycleAttempt to drive the rolling-window graduation
// evaluator, but the table is empty for any round that completed before v14
// was deployed. This script backfills the table from existing history so
// graduation can pick up the prior track record.
//
// Strategy (two paths):
//   Path A — preferred: Round row has status="completed" AND roundPnlUsd != null.
//     We trust the snapshot fields (tokensScanned, positionsOpened, etc.) and
//     use roundPnlUsd as the attempt's pnlUsd. completedAt = round.endedAt.
//
//   Path B — fallback: no completed Round exists (or some rounds are missing
//     roundPnlUsd), but there ARE closed Positions for that roundId. We
//     derive the attempt by summing pnlUsd across all closed positions for
//     that roundId. tokensScanned/positionsOpened/positionsClosed are
//     approximated from the positions we found. completedAt = max(exitAt)
//     across that round's closed positions.
//
// Path B handles the real-world case where the engine crashed/restarted mid-
// round and never wrote Round.endedAt or roundPnlUsd. The rounds end up
// stuck in status="running" forever. We still have the Position rows with
// exitAt + pnlUsd, which is enough to reconstruct the attempt.
//
// Heuristic for de-dup: we check by roundId. If a PaperCycleAttempt with
// the same roundId already exists, we skip it.
//
// Usage:  node /home/z/my-project/scripts/backfill-paper-cycle-attempts.js
//
// Output: prints inserted/skipped counts and exits 0 on success. Idempotent.

const { PrismaClient } = require("@prisma/client");

const db = new PrismaClient();

async function main() {
  console.log("→ Step 1: Reading completed Rounds with non-null roundPnlUsd…");
  const completedRounds = await db.round.findMany({
    where: {
      status: "completed",
      roundPnlUsd: { not: null },
    },
    orderBy: { endedAt: "asc" },
    select: {
      id: true,
      endedAt: true,
      startedAt: true,
      roundPnlUsd: true,
      tokensScanned: true,
      positionsOpened: true,
      positionsClosed: true,
    },
  });
  console.log(`  Found ${completedRounds.length} completed round(s) with P&L (path A).`);

  // Existing attempts — for de-dup across both paths
  const allRoundIds = new Set();
  // Also include any round that has closed positions (for path B)
  console.log("→ Step 2: Reading roundIds from closed Positions…");
  const closedByRound = await db.position.groupBy({
    by: ["roundId"],
    where: {
      status: { in: ["closed", "liquidated", "killed"] },
      exitAt: { not: null },
    },
    _count: { id: true },
    _sum: { pnlUsd: true },
    _max: { exitAt: true },
  });
  console.log(
    `  Found ${closedByRound.length} round(s) with at least one closed position (path B candidates).`
  );

  for (const r of completedRounds) allRoundIds.add(r.id);
  for (const r of closedByRound) allRoundIds.add(r.roundId);

  if (allRoundIds.size === 0) {
    console.log("✓ No completed rounds AND no closed positions. PaperCycleAttempt stays empty.");
    return;
  }

  const allIdsArray = Array.from(allRoundIds);
  const existing = await db.paperCycleAttempt.findMany({
    where: { roundId: { in: allIdsArray } },
    select: { roundId: true },
  });
  const existingSet = new Set(existing.map((e) => e.roundId));
  console.log(`  ${existingSet.size} round(s) already have a PaperCycleAttempt — will skip.`);

  let inserted = 0;
  let skipped = 0;
  let wins = 0;
  let losses = 0;
  let cumulativePnl = 0;

  // Path A — completed rounds with snapshot fields
  for (const r of completedRounds) {
    if (existingSet.has(r.id)) {
      skipped++;
      continue;
    }
    const pnl = r.roundPnlUsd ?? 0;
    const profitable = pnl > 0;
    if (profitable) wins++;
    else losses++;
    cumulativePnl += pnl;
    const completedAt = r.endedAt ?? r.startedAt ?? new Date();
    await db.paperCycleAttempt.create({
      data: {
        roundId: r.id,
        pnlUsd: pnl,
        tokensScanned: r.tokensScanned,
        positionsOpened: r.positionsOpened,
        positionsClosed: r.positionsClosed,
        profitable,
        completedAt,
      },
    });
    inserted++;
  }

  // Path B — fallback for rounds that never got a proper Round.status=completed
  // but have closed positions. We treat each roundId with ≥1 closed position
  // as a single attempt whose pnlUsd = sum of position pnlUsd.
  // Skip any roundId already covered by path A or by existing attempts.
  for (const grp of closedByRound) {
    const roundId = grp.roundId;
    if (existingSet.has(roundId)) {
      skipped++;
      continue;
    }
    // Also skip if this roundId was already inserted by path A in this run
    // (it would have been added to existingSet conceptually, but to be safe)
    if (completedRounds.some((r) => r.id === roundId)) {
      // already handled by path A
      continue;
    }

    const pnl = grp._sum.pnlUsd ?? 0;
    const positionsClosed = grp._count.id;
    const profitable = pnl > 0;
    if (profitable) wins++;
    else losses++;
    cumulativePnl += pnl;

    // Fetch the round to get tokensScanned / positionsOpened snapshot if available
    const round = await db.round.findUnique({
      where: { id: roundId },
      select: { tokensScanned: true, positionsOpened: true, startedAt: true },
    });
    const completedAt = grp._max.exitAt ?? round?.startedAt ?? new Date();

    await db.paperCycleAttempt.create({
      data: {
        roundId,
        pnlUsd: pnl,
        tokensScanned: round?.tokensScanned ?? 0,
        positionsOpened: round?.positionsOpened ?? positionsClosed,
        positionsClosed,
        profitable,
        completedAt,
      },
    });
    inserted++;
  }

  console.log(`✓ Inserted ${inserted} PaperCycleAttempt(s), skipped ${skipped}.`);
  console.log(
    `  Summary of backfilled window: ${wins}W / ${losses}L, ` +
      `cumulative P&L = $${cumulativePnl.toFixed(2)}`
  );

  // Surface a hint about graduation window status.
  const totalAttempts = await db.paperCycleAttempt.count();
  const WINDOW_SIZE = 20;
  console.log(
    `  Total PaperCycleAttempt rows now: ${totalAttempts} ` +
      `(graduation window needs ${WINDOW_SIZE} to be eligible).`
  );

  if (totalAttempts >= WINDOW_SIZE) {
    const last = await db.paperCycleAttempt.findMany({
      orderBy: { completedAt: "desc" },
      take: WINDOW_SIZE,
      select: { pnlUsd: true, profitable: true },
    });
    const winRate = (last.filter((a) => a.profitable).length / last.length) * 100;
    const cumPnl = last.reduce((s, a) => s + a.pnlUsd, 0);
    console.log(
      `  Rolling window: win rate ${winRate.toFixed(1)}%, cumulative P&L $${cumPnl.toFixed(2)} ` +
        `(graduation requires >= 60% win rate AND > 0 P&L AND drawdown <= 5% AND no single loss > 2x maxLossPerTrade).`
    );
  } else if (totalAttempts > 0) {
    console.warn(
      `⚠️  Window not yet full (${totalAttempts}/${WINDOW_SIZE}). Bot will not be eligible for ` +
        `graduation until ${WINDOW_SIZE - totalAttempts} more cycle(s) complete.`
    );
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
