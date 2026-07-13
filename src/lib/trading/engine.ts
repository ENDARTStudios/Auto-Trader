// Engine — main loop. Runs in-process (singleton) inside the Next.js dev server.
//
// State machine:
//   SCOUT     → discover candidates via token-selector
//   ANALYZE   → run scam-detector on each candidate, filter by score
//   EXECUTE   → for each approved candidate (up to maxPositionsPerRound),
//               run risk-manager, open position via portfolio
//   MONITOR   → fetch current prices for open positions, check TP/SL/timeout
//   EXIT      → close positions that hit TP/SL/timeout/kill-switch
//   REBALANCE → when round has zero open positions, split profit 50/50
//
// The engine runs on a setInterval. Each tick advances the state machine
// by one logical step. Real production would run this in a separate worker.

import { db } from "@/lib/db";
import { getConfig, setEngineRunning, EngineConfig } from "./config";
import { logger } from "./logger";
import {
  assessTradeRisk,
  triggerKillSwitch,
  updatePeakBalance,
  recordRiskEvent,
} from "./risk-manager";
import { analyzeToken } from "./scam-detector";
import { selectCandidates } from "./token-selector";
import { fetchPricesBatch } from "./price-feed";
import {
  ensureInitialized,
  openPosition,
  closePosition,
  rebalanceRound,
} from "./portfolio";
import type { EngineSnapshot, ExitReason, LoopState } from "./types";

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

class Engine {
  private intervalId: NodeJS.Timeout | null = null;
  private currentLoopState: LoopState = "scout";
  private lastLoopAt: Date | null = null;
  private loopIteration = 0;
  private currentRoundId: number | null = null;
  private busy = false;

  async start(): Promise<void> {
    await ensureInitialized();
    const cfg = await getConfig();
    if (cfg.killSwitchActive) {
      logger.warn("engine", "Start bloqueado: kill switch ativo");
      return;
    }
    if (this.intervalId) {
      logger.warn("engine", "Engine já está rodando");
      return;
    }
    await setEngineRunning(true);
    logger.info("engine", `Engine iniciada (modo ${cfg.mode}, intervalo ${cfg.loopIntervalSec}s)`);
    // Run first tick immediately, then setInterval.
    this.tick();
    this.intervalId = setInterval(
      () => this.tick(),
      Math.max(5, cfg.loopIntervalSec) * 1000
    );
  }

  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    await setEngineRunning(false);
    logger.info("engine", "Engine parada");
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  getLoopState(): LoopState {
    return this.currentLoopState;
  }

  getIteration(): number {
    return this.loopIteration;
  }

  getCurrentRoundId(): number | null {
    return this.currentRoundId;
  }

  getLastLoopAt(): Date | null {
    return this.lastLoopAt;
  }

  // -------------------------------------------------------------------------
  // Main tick — runs one full state machine cycle.
  // -------------------------------------------------------------------------
  private async tick(): Promise<void> {
    if (this.busy) {
      logger.debug("engine", "Tick pulado (busy)");
      return;
    }
    this.busy = true;
    try {
      const cfg = await getConfig();

      // Hard stop on kill switch
      if (cfg.killSwitchActive) {
        logger.warn("engine", "Kill switch ativo — forçando EXIT de posições abertas");
        await this.forceExitAll(cfg, "kill_switch");
        await this.stop();
        return;
      }

      this.loopIteration++;
      this.lastLoopAt = new Date();

      // 1. MONITOR/EXIT first — close positions that need closing
      this.currentLoopState = "monitor";
      const closedThisTick = await this.monitorAndExit(cfg);

      // 2. Check if current round is complete (no open positions)
      const openCount = await db.position.count({ where: { status: "open" } });
      if (openCount === 0) {
        if (this.currentRoundId !== null) {
          this.currentLoopState = "rebalance";
          await rebalanceRound(cfg, this.currentRoundId);
          // Increment paper cycles if in paper mode and round was profitable
          if (cfg.mode === "paper") {
            const round = await db.round.findUnique({
              where: { id: this.currentRoundId },
            });
            if (round && (round.roundPnlUsd ?? 0) > 0) {
              await db.config.update({
                where: { id: "singleton" },
                data: { paperCyclesPassed: { increment: 1 } },
              });
              const updated = await getConfig();
              if (
                updated.paperCyclesPassed >= updated.paperCyclesRequired &&
                !updated.graduatedToLive
              ) {
                logger.info(
                  "engine",
                  `🎓 Graduação atingida! ${updated.paperCyclesPassed} ciclos paper aprovados. Live mode disponível.`
                );
                await recordRiskEvent(
                  "kill_switch",
                  "info",
                  `Graduação paper → live disponível`,
                  { cycles: updated.paperCyclesPassed }
                );
              }
            }
            this.currentRoundId = null;
          }
        }
        // 3. SCOUT — start a new round
        this.currentLoopState = "scout";
        await this.scoutAndExecute(cfg);
      } else {
        // Round still has open positions — just continue monitoring.
        logger.debug("engine", `Round em andamento, ${openCount} posições abertas`);
      }

      // Update peak balance after each tick
      await updatePeakBalance();
    } catch (err) {
      logger.error("engine", "Erro no tick", { error: String(err), stack: (err as Error).stack });
    } finally {
      this.busy = false;
    }
  }

  // -------------------------------------------------------------------------
  // MONITOR + EXIT — check TP/SL/timeout for all open positions
  // -------------------------------------------------------------------------
  private async monitorAndExit(cfg: EngineConfig): Promise<number> {
    const openPositions = await db.position.findMany({
      where: { status: "open" },
    });
    if (openPositions.length === 0) return 0;

    const prices = await fetchPricesBatch(
      openPositions.map((p) => ({
        id: p.id,
        symbol: p.symbol,
        source: p.source as "cex" | "dex",
        chain: p.chain,
        tokenId: p.tokenId,
      }))
    );

    let closed = 0;
    const now = new Date();
    for (const pos of openPositions) {
      const price = prices.get(pos.id) ?? 0;
      if (price <= 0) {
        logger.warn("engine", `Sem preço para ${pos.symbol}, pulando`);
        continue;
      }

      let reason: ExitReason | null = null;
      if (price >= pos.takeProfitPrice) reason = "take_profit";
      else if (price <= pos.stopLossPrice) reason = "stop_loss";
      else if (now >= pos.maxExitAt) reason = "timeout";

      if (reason) {
        await closePosition(cfg, pos.id, price, reason);
        closed++;
      }
    }

    if (closed > 0) {
      logger.info("engine", `MONITOR fechou ${closed} posições`);
    }
    return closed;
  }

  // -------------------------------------------------------------------------
  // Force-exit all open positions (used by kill switch)
  // -------------------------------------------------------------------------
  private async forceExitAll(cfg: EngineConfig, reason: ExitReason): Promise<void> {
    const openPositions = await db.position.findMany({
      where: { status: "open" },
    });
    const prices = await fetchPricesBatch(
      openPositions.map((p) => ({
        id: p.id,
        symbol: p.symbol,
        source: p.source as "cex" | "dex",
        chain: p.chain,
        tokenId: p.tokenId,
      }))
    );
    for (const pos of openPositions) {
      const price = prices.get(pos.id) ?? pos.entryPriceUsd;
      await closePosition(cfg, pos.id, price, reason);
    }
  }

  // -------------------------------------------------------------------------
  // SCOUT + ANALYZE + EXECUTE
  // -------------------------------------------------------------------------
  private async scoutAndExecute(cfg: EngineConfig): Promise<void> {
    // Create round record
    const tb = await db.tradingBalance.findUnique({ where: { id: "singleton" } });
    const rb = await db.reserve.findUnique({ where: { id: "singleton" } });
    if (!tb || !rb) return;

    const round = await db.round.create({
      data: {
        startedAt: new Date(),
        tradingBalanceUsd: tb.balanceUsd,
        reserveBalanceUsd: rb.balanceUsd,
        status: "running",
      },
    });
    this.currentRoundId = round.id;
    logger.info("engine", `Round ${round.id} iniciado (saldo $${tb.balanceUsd.toFixed(2)})`);

    // SCOUT
    this.currentLoopState = "scout";
    const candidates = await selectCandidates(cfg, cfg.maxPositionsPerRound * 3);
    await db.round.update({
      where: { id: round.id },
      data: { tokensScanned: candidates.length },
    });
    if (candidates.length === 0) {
      logger.warn("engine", "Nenhum candidato encontrado — round abortado");
      await db.round.update({
        where: { id: round.id },
        data: { status: "aborted", notes: "Nenhum candidato", endedAt: new Date() },
      });
      this.currentRoundId = null;
      return;
    }

    // ANALYZE
    this.currentLoopState = "analyze";
    const approved: { candidate: typeof candidates[0]; report: Awaited<ReturnType<typeof analyzeToken>> }[] = [];
    let rejectedScam = 0;
    for (const c of candidates) {
      const report = await analyzeToken(cfg, c);
      if (report.passed) {
        approved.push({ candidate: c, report });
      } else {
        rejectedScam++;
      }
    }
    await db.round.update({
      where: { id: round.id },
      data: {
        tokensPassedFilter: approved.length,
        tokensRejectedScam: rejectedScam,
      },
    });
    logger.info(
      "engine",
      `ANALYZE: ${approved.length} aprovados, ${rejectedScam} rejeitados (scam score < ${cfg.scamScoreMin})`
    );

    if (approved.length === 0) {
      logger.warn("engine", "Nenhum token passou no scam filter — round abortado");
      await db.round.update({
        where: { id: round.id },
        data: { status: "aborted", notes: "Scam filter bloqueou todos", endedAt: new Date() },
      });
      this.currentRoundId = null;
      return;
    }

    // EXECUTE
    this.currentLoopState = "execute";
    const maxPositions = Math.min(cfg.maxPositionsPerRound, approved.length);
    // Allocate capital across the N approved tokens, capped by BOTH:
    //   - capitalPctPerRound of trading balance (round cap)
    //   - maxExposurePerTokenPct of trading balance (per-token cap)
    // If per-token cap binds first, we deploy less than 100% this round — that's
    // intentional. Capital preservation > full deployment.
    const freshCfg = await getConfig(); // reload in case balance changed
    const balance = await db.tradingBalance.findUnique({
      where: { id: "singleton" },
    });
    if (!balance) return;
    const roundAllocation =
      (freshCfg.capitalPctPerRound / 100) * balance.balanceUsd;
    const maxPerTokenFromCap =
      (freshCfg.maxExposurePerTokenPct / 100) * balance.balanceUsd;
    // Ideal per-token = roundAllocation / maxPositions, but never exceed cap.
    const perToken = Math.min(
      roundAllocation / Math.max(maxPositions, 1),
      maxPerTokenFromCap
    );

    let opened = 0;
    for (const { candidate, report } of approved.slice(0, maxPositions)) {
      const risk = await assessTradeRisk(cfg, candidate.symbol, perToken);
      if (!risk.allowed) {
        logger.warn(
          "engine",
          `Risk manager bloqueou ${candidate.symbol}: ${risk.reasons.join("; ")}`
        );
        continue;
      }
      const pos = await openPosition(cfg, candidate, perToken, report, round.id);
      if (pos) opened++;
    }

    await db.round.update({
      where: { id: round.id },
      data: { positionsOpened: opened },
    });
    logger.info("engine", `EXECUTE: ${opened} posições abertas no round ${round.id}`);
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------
export const engine = new Engine();

// -------------------------------------------------------------------------
// Snapshot for API / dashboard
// -------------------------------------------------------------------------
export async function getEngineSnapshot(): Promise<EngineSnapshot> {
  const cfg = await getConfig();
  const tb = await db.tradingBalance.findUnique({ where: { id: "singleton" } });
  const openCount = await db.position.count({ where: { status: "open" } });

  const status: EngineSnapshot["status"] = cfg.killSwitchActive
    ? "killed"
    : engine.isRunning()
    ? "running"
    : "stopped";

  const winRate =
    tb && tb.tradesClosed > 0 ? (tb.wins / tb.tradesClosed) * 100 : 0;

  return {
    status,
    mode: cfg.mode,
    loopState: engine.getLoopState(),
    lastLoopAt: engine.getLastLoopAt()?.toISOString() ?? null,
    nextLoopAt: engine.isRunning()
      ? new Date(
          (engine.getLastLoopAt()?.getTime() ?? Date.now()) +
            cfg.loopIntervalSec * 1000
        ).toISOString()
      : null,
    tradingBalanceUsd: tb?.balanceUsd ?? 0,
    reserveBalanceUsd:
      (await db.reserve.findUnique({ where: { id: "singleton" } }))?.balanceUsd ?? 0,
    peakBalanceUsd: tb?.peakBalanceUsd ?? 0,
    realizedPnlUsd: tb?.realizedPnlUsd ?? 0,
    openPositionsCount: openCount,
    totalPositionsOpened: tb?.tradesOpened ?? 0,
    totalPositionsClosed: tb?.tradesClosed ?? 0,
    wins: tb?.wins ?? 0,
    losses: tb?.losses ?? 0,
    winRate,
    paperCyclesPassed: cfg.paperCyclesPassed,
    paperCyclesRequired: cfg.paperCyclesRequired,
    graduatedToLive: cfg.graduatedToLive,
    killSwitchActive: cfg.killSwitchActive,
    killSwitchReason: cfg.killSwitchReason,
    currentRoundId: engine.getCurrentRoundId(),
    loopIteration: engine.getIteration(),
  };
}
