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
import { withSystemRls } from "@/lib/auth/rls-context";
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
import { getRisingCandidates } from "./rising-tokens";
import { fetchPricesBatch } from "./price-feed";
import { scanTokenWithGoPlus } from "./goplus-scanner";
import { analyzeMarket } from "./market-analysis";
import { runAgentSquad } from "./ai-agent";
import { runSurveillance, resolveAlertsForPosition } from "./position-surveillance";
import { planExit, applyExitPlan } from "./exit-planner";
import { getApprovedPlatformIds } from "./platform-scanner";
import { eventBus } from "./event-bus";
import { recordSnapshotIfDue } from "./performance-snapshot";
import { notifyEvent } from "./notifier";
import { canScoutNow, forceCloseAllIfOutsideWindow } from "./schedule";
import {
  ensureInitialized,
  openPosition,
  closePosition,
  rebalanceRound,
  getSystemOwnerId,
  systemOwnerScope,
} from "./portfolio";
import { checkDiversification, pickStrategyForCandidate } from "./diversification";
import { recordPaperCycleAttempt } from "./graduation";
import { evaluateSourceHealthForScout } from "./source-health";
import {
  decideMechanicalExit,
  evaluateAiSquadOutcome,
  evaluateDataQualityGate,
  getMaxEntryDeviationPct,
  isMarketDataUnavailableError,
  shouldCreateRound,
  validateEntryPrice,
} from "./engine-correctness";
import type { EngineSnapshot, ExitReason, LoopState } from "./types";
import { isDemoDataPresent } from "@/lib/demo-data";

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

// AI provider outage is a feature-off condition; log it ONCE per process.
let aiUnavailableLogged = false;

class Engine {
  private intervalId: NodeJS.Timeout | null = null;
  private currentLoopState: LoopState = "scout";
  private lastLoopAt: Date | null = null;
  private loopIteration = 0;
  private currentRoundId: number | null = null;
  private busy = false;

  async start(): Promise<void> {
    // Serverless (Vercel) congela a instância após a resposta: gravar
    // engineRunning=true aqui faria a UI mentir sobre um loop que não existe.
    if (process.env.VERCEL) {
      logger.warn("engine", "Start bloqueado: serverless não sustenta loop contínuo");
      return;
    }
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
    // External notification
    notifyEvent({
      eventType: "engine_started",
      title: "Engine Iniciada",
      message: `Engine de trading iniciada em modo *${cfg.mode}* com intervalo de ${cfg.loopIntervalSec}s. Saldo: $${cfg.initialCapitalUsd.toFixed(2)}.`,
      context: {
        mode: cfg.mode,
        loopIntervalSec: cfg.loopIntervalSec,
        killSwitchActive: cfg.killSwitchActive,
      },
    }).catch(() => { /* fire-and-forget */ });
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
    // External notification
    notifyEvent({
      eventType: "engine_stopped",
      title: "Engine Parada",
      message: `Engine de trading foi parada. Nenhuma nova posição será aberta. Posições abertas existentes continuam sendo monitoradas manualmente.`,
      context: {
        loopIteration: this.loopIteration,
        currentRoundId: this.currentRoundId,
      },
    }).catch(() => { /* fire-and-forget */ });
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
      await this.monitorAndExit(cfg);

      // 2. Engine queries are scoped to the system owner (Position.ownerId is
      //    NOT NULL — see portfolio.getSystemOwnerId). Never touch another
      //    operator's positions from the automated loop.
      const ownerId = await getSystemOwnerId();
      const openCount = await withSystemRls((tx) =>
        tx.position.count({
          where: { status: "open", ...systemOwnerScope(ownerId) },
        })
      );

      if (openCount === 0) {
        // Finalize any round that still exists: the in-memory id, or a round
        // left "running" in the DB by a previous process/restart. A running
        // round with zero open positions must never be left behind.
        let roundId = this.currentRoundId;
        if (roundId === null) {
          const stale = await db.round.findFirst({
            where: { status: "running" },
            orderBy: { id: "desc" },
            select: { id: true },
          });
          roundId = stale?.id ?? null;
        }
        if (roundId !== null) {
          this.currentLoopState = "rebalance";
          await this.finalizeRound(cfg, roundId);
          this.currentRoundId = null;
        }

        // 3. SCOUT — gated by trading schedule if enabled. NO round is created
        //    unless a position is actually executable (inside scoutAndExecute).
        this.currentLoopState = "scout";
        if (await canScoutNow()) {
          await this.scoutAndExecute(cfg);
        } else {
          logger.info("engine", "Fora da janela de trading — SCOUT pulado (MONITOR/EXIT continua)");
        }
      } else {
        // Round still has open positions — just continue monitoring.
        logger.debug("engine", `Round em andamento, ${openCount} posições abertas`);
      }

      // Always enforce the schedule's force-close rule. This used to sit
      // inside the openCount===0 branch, so it could never close anything.
      await forceCloseAllIfOutsideWindow();

      // Update peak balance after each tick
      await updatePeakBalance();
      // Record performance snapshot (throttled to 1/min)
      await recordSnapshotIfDue();
    } catch (err) {
      logger.error("engine", "Erro no tick", { error: String(err), stack: (err as Error).stack });
    } finally {
      this.busy = false;
    }
  }

  // -------------------------------------------------------------------------
  // Round finalization — always completes the round (even at PnL <= 0) and
  // feeds the graduation window with one PaperCycleAttempt per round.
  // -------------------------------------------------------------------------
  private async finalizeRound(cfg: EngineConfig, roundId: number): Promise<void> {
    const result = await rebalanceRound(cfg, roundId);

    if (cfg.mode !== "paper") return;
    const round = await db.round.findUnique({ where: { id: roundId } });
    if (!round || (round.positionsOpened ?? 0) <= 0) return;

    const positionsClosed = await withSystemRls((tx) =>
      tx.position.count({
        where: { roundId, status: { in: ["closed", "liquidated", "killed"] } },
      })
    );
    // feed the 20-attempt graduation window; also keeps the legacy
    // paperCyclesPassed counter compatible (incremented on profitable rounds).
    await recordPaperCycleAttempt(roundId, result.profitUsd, {
      tokensScanned: round.tokensScanned,
      positionsOpened: round.positionsOpened,
      positionsClosed,
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
      await safeRecordRiskEvent(
        "kill_switch",
        "info",
        `Graduação paper → live disponível`,
        { cycles: updated.paperCyclesPassed }
      );
      notifyEvent({
        eventType: "graduation",
        title: "🎓 Graduação Paper → Live",
        message: `Bot completou ${updated.paperCyclesPassed} ciclos paper aprovados (mínimo: ${updated.paperCyclesRequired}). Modo *live trading* agora disponível para ativação manual.`,
        context: {
          paperCyclesPassed: updated.paperCyclesPassed,
          paperCyclesRequired: updated.paperCyclesRequired,
        },
      }).catch(() => { /* fire-and-forget */ });
    }
  }

  // -------------------------------------------------------------------------
  // MONITOR + EXIT — check TP/SL/timeout for all open positions
  // + run surveillance (GoPlus re-scan, liquidity drain, price anomaly)
  // + run exit planner (AI-driven exit decision for flagged positions)
  // -------------------------------------------------------------------------
  private async monitorAndExit(cfg: EngineConfig): Promise<number> {
    const ownerId = await getSystemOwnerId();
    const openPositions = await withSystemRls((tx) =>
      tx.position.findMany({
        where: { status: "open", ...systemOwnerScope(ownerId) },
      })
    );
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

    // ---- Phase 1: Standard mechanical exits (TP/SL/timeout) ----
    let closed = 0;
    const now = new Date();
    const stillOpen: typeof openPositions = [];
    for (const pos of openPositions) {
      const price = prices.get(pos.id) ?? 0;
      // Pure decision helper: TP/SL when priced; TIMEOUT even when unpriced
      // (falls back to entryPrice + risk event) so positions cannot get stuck.
      const decision = decideMechanicalExit(
        {
          entryPriceUsd: pos.entryPriceUsd,
          takeProfitPrice: pos.takeProfitPrice,
          stopLossPrice: pos.stopLossPrice,
          maxExitAt: pos.maxExitAt,
        },
        price,
        now
      );

      if (decision.action === "none") {
        if (price <= 0) {
          logger.warn(
            "engine",
            `Sem preço para ${pos.symbol} — mantendo aberta até o timeout (${pos.maxExitAt.toISOString()})`
          );
        }
        stillOpen.push(pos);
        continue;
      }

      const reason = decision.action as ExitReason;
      const exitPrice = decision.exitPriceUsd;

      if (!decision.priced) {
        // No market price available: exit at entryPrice for bookkeeping and
        // make the fallback loud instead of silent.
        await safeRecordRiskEvent(
          "unpriced_exit",
          "warning",
          `Timeout sem preço para ${pos.symbol} — fechando em entryPrice (fallback)`,
          {
            positionId: pos.id,
            symbol: pos.symbol,
            reason: "timeout",
            fallback: "entry_price",
            entryPriceUsd: pos.entryPriceUsd,
            maxExitAt: pos.maxExitAt.toISOString(),
          }
        );
      }

      await closePosition(cfg, pos.id, exitPrice, reason);
      await resolveAlertsForPosition(pos.id, "exited_position");
      closed++;
      eventBus.push({
        type: "position",
        level: reason === "take_profit" ? "info" : reason === "stop_loss" ? "warn" : "info",
        source: "engine",
        title: `Posição ${pos.symbol} fechada (${reasonLabel(reason)})`,
        message: `${pos.symbol} saiu em ${reasonLabel(reason)} @ $${exitPrice.toFixed(exitPrice < 1 ? 6 : 2)}${decision.priced ? "" : " (fallback: entry price, sem preço de mercado)"}`,
        context: {
          positionId: pos.id,
          symbol: pos.symbol,
          reason,
          exitPrice,
          priceFallback: !decision.priced,
          entryPrice: pos.entryPriceUsd,
          entryAmountUsd: pos.entryAmountUsd,
        },
      });
      // External notification — fetch fresh position to compute P&L
      try {
        const fresh = await withSystemRls((tx) =>
          tx.position.findUnique({ where: { id: pos.id } })
        );
        const pnlUsd = fresh?.pnlUsd ?? 0;
        const pnlPct = fresh?.pnlPct ?? 0;
        notifyEvent({
          eventType: "position_closed",
          title: `Posição Fechada: ${pos.symbol} (${reasonLabel(reason)})`,
          message: `${pos.symbol} saiu em *${reasonLabel(reason)}* @ $${exitPrice.toFixed(exitPrice < 1 ? 6 : 2)}. P&L: ${pnlUsd >= 0 ? "+" : ""}$${pnlUsd.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%).`,
          context: {
            symbol: pos.symbol,
            reason,
            exitPrice,
            priceFallback: !decision.priced,
            entryPrice: pos.entryPriceUsd,
            pnlUsd: pnlUsd.toFixed(2),
            pnlPct: pnlPct.toFixed(2) + "%",
            positionId: pos.id,
          },
        }).catch(() => { /* fire-and-forget */ });
      } catch {
        // ignore
      }
    }

    if (closed > 0) {
      logger.info("engine", `MONITOR fechou ${closed} posições (mecânico)`);
    }

    if (stillOpen.length === 0) return closed;

    // ---- Phase 2: Surveillance (re-scan for emerging risks) ----
    // Run surveillance only every ~5min to limit GoPlus + DexScreener API calls
    const SURVEILLANCE_INTERVAL_MS = 5 * 60_000;
    const surveillanceResults = [] as Awaited<ReturnType<typeof runSurveillance>>;
    const lastSurveillanceKey = "__lastSurveillanceAt";
    const lastSurveillanceAt = (this as unknown as Record<string, number | undefined>)[lastSurveillanceKey] ?? 0;
    if (Date.now() - lastSurveillanceAt >= SURVEILLANCE_INTERVAL_MS) {
      try {
        const results = await runSurveillance(
          stillOpen.map((p) => ({
            id: p.id,
            symbol: p.symbol,
            tokenId: p.tokenId,
            chain: p.chain,
            source: p.source,
            entryPriceUsd: p.entryPriceUsd,
            entryAmountUsd: p.entryAmountUsd,
            entryAt: p.entryAt,
            takeProfitPrice: p.takeProfitPrice,
            stopLossPrice: p.stopLossPrice,
            maxExitAt: p.maxExitAt,
          }))
        );
        surveillanceResults.push(...results);
        (this as unknown as Record<string, number>)[lastSurveillanceKey] = Date.now();
        const totalAlerts = results.reduce((s, r) => s + r.alerts.length, 0);
        if (totalAlerts > 0) {
          logger.info("surveillance", `${totalAlerts} alerta(s) em ${results.length} posições`);
        }
      } catch (err) {
        logger.warn("surveillance", `Erro runSurveillance: ${String(err)}`);
      }
    }

    // ---- Phase 3: AI exit planner (only for positions with active alerts) ----
    for (const pos of stillOpen) {
      const surveillance = surveillanceResults.find((r) => r.positionId === pos.id);
      if (!surveillance || surveillance.alerts.length === 0) continue;

      // Run exit planner (LLM call) — only if there are alerts
      const currentPrice = prices.get(pos.id) ?? pos.entryPriceUsd;
      try {
        const plan = await planExit({
          positionId: pos.id,
          symbol: pos.symbol,
          source: pos.source as "cex" | "dex",
          chain: pos.chain,
          tokenId: pos.tokenId,
          entryPriceUsd: pos.entryPriceUsd,
          currentPriceUsd: currentPrice,
          entryAmountUsd: pos.entryAmountUsd,
          takeProfitPrice: pos.takeProfitPrice,
          stopLossPrice: pos.stopLossPrice,
          entryAt: pos.entryAt,
          maxExitAt: pos.maxExitAt,
          scamScoreAtEntry: pos.scamScore,
          surveillance,
        });

        // Apply the plan (may update TP/SL or signal full exit)
        const shouldExit = await applyExitPlan(plan);
        if (shouldExit && (plan.action === "exit_now" || plan.action === "scale_out_50")) {
          // For now, scale_out_50 escalates to full exit (no partial close yet)
          await closePosition(cfg, pos.id, currentPrice, "manual");
          await resolveAlertsForPosition(pos.id, "exited_position");
          closed++;
          logger.info(
            "exit_planner",
            `${pos.symbol} fechada por AI plan (action=${plan.action} conf=${plan.confidence}% sev=${plan.alertSeverity})`
          );
        }
      } catch (err) {
        logger.warn("exit_planner", `Erro planExit ${pos.symbol}: ${String(err)}`);
      }
    }

    return closed;
  }

  // -------------------------------------------------------------------------
  // Force-exit all open positions (used by kill switch)
  // -------------------------------------------------------------------------
  private async forceExitAll(cfg: EngineConfig, reason: ExitReason): Promise<void> {
    const ownerId = await getSystemOwnerId();
    const openPositions = await withSystemRls((tx) =>
      tx.position.findMany({
        where: { status: "open", ...systemOwnerScope(ownerId) },
      })
    );
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
      const marketPrice = prices.get(pos.id) ?? 0;
      const priced = marketPrice > 0;
      const exitPrice = priced ? marketPrice : pos.entryPriceUsd;
      if (!priced) {
        // Kill switch must not silently pretend it exited at market: no price
        // means we fall back to entryPrice and record WHY, loudly.
        await safeRecordRiskEvent(
          "unpriced_exit",
          "warning",
          `Kill switch sem preço para ${pos.symbol} — liquidando em entryPrice (fallback)`,
          {
            positionId: pos.id,
            symbol: pos.symbol,
            reason,
            fallback: "entry_price",
            entryPriceUsd: pos.entryPriceUsd,
          }
        );
      }
      await closePosition(cfg, pos.id, exitPrice, reason);
      await resolveAlertsForPosition(pos.id, "exited_position");
      eventBus.push({
        type: "position",
        level: "critical",
        source: "engine",
        title: `Force-exit: ${pos.symbol} (${reasonLabel(reason)})`,
        message: `${pos.symbol} forçadamente fechado @ $${exitPrice.toFixed(exitPrice < 1 ? 6 : 2)}${priced ? "" : " (fallback: entry price, sem preço)"} — motivo: ${reasonLabel(reason)}`,
        context: {
          positionId: pos.id,
          symbol: pos.symbol,
          reason,
          exitPrice,
          priceFallback: !priced,
          entryPrice: pos.entryPriceUsd,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // SCOUT + ANALYZE + EXECUTE
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // SCOUT + ANALYZE + EXECUTE
  // -------------------------------------------------------------------------
  private async scoutAndExecute(cfg: EngineConfig): Promise<void> {
    // SCOUT
    // Merge standard watchlist candidates + rising tokens discovered via
    // DexScreener boosted/trending + CoinGecko trending + per-chain gainers.
    this.currentLoopState = "scout";
    const [standard, rising] = await Promise.all([
      selectCandidates(cfg, cfg.maxPositionsPerRound * 3),
      getRisingCandidates(cfg, cfg.maxPositionsPerRound * 2, 30).catch((err) => {
        logger.warn("rising", `Erro discovery rising tokens: ${String(err)}`);
        return [];
      }),
    ]);
    // Dedupe by tokenId/symbol and prefer rising tokens (they have momentum)
    const seenKeys = new Set<string>();
    const candidates: typeof standard = [];
    for (const c of [...rising, ...standard]) {
      const key = c.tokenId
        ? `${c.chain}:${c.tokenId.toLowerCase()}`
        : `cex:${c.symbol}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      candidates.push(c);
    }
    logger.info("scout", `Candidatos: ${candidates.length} (${rising.length} rising + ${standard.length} standard)`);
    if (candidates.length === 0) {
      logger.warn("engine", "SCOUT: nenhum candidato — NO_TRADE (round não criado)");
      await safeRecordRiskEvent("no_trade", "info", "SCOUT sem candidatos — round não criado", {
        stage: "scout",
      });
      return;
    }

    // ---- PLATFORM GATE ----
    // Reject any candidate whose platformId refers to a platform that failed
    // our integrity audit. Candidates without platformId (e.g. CoinGecko DEX
    // discovery) are allowed through but logged — they still go through the
    // full 4-layer analyze pipeline (scam → GoPlus → market → AI) before any
    // position is opened.
    let rejectedPlatform = 0;
    let platformGateSkipped = false;
    let approvedPlatformIds: Set<string> | null = null;
    try {
      approvedPlatformIds = await getApprovedPlatformIds();
    } catch (err) {
      logger.warn("platform", `Erro lendo approved platforms — gate desativado: ${String(err)}`);
      platformGateSkipped = true;
    }
    const gatedCandidates: typeof candidates = [];
    for (const c of candidates) {
      if (!c.platformId) {
        // No platform info — allow but log (CEX majors from CoinGecko or unknown DEX)
        gatedCandidates.push(c);
        continue;
      }
      if (platformGateSkipped || approvedPlatformIds === null) {
        gatedCandidates.push(c);
        continue;
      }
      if (approvedPlatformIds.has(c.platformId)) {
        gatedCandidates.push(c);
      } else {
        rejectedPlatform++;
        logger.info(
          "platform",
          `${c.symbol} rejeitado pelo platform gate — plataforma '${c.platformId}' não aprovada`
        );
      }
    }
    if (rejectedPlatform > 0) {
      logger.info(
        "platform",
        `Platform gate: ${rejectedPlatform}/${candidates.length} candidatos rejeitados (plataforma não-aprovada). ${gatedCandidates.length} restantes.`
      );
    } else if (!platformGateSkipped && approvedPlatformIds) {
      logger.info(
        "platform",
        `Platform gate OK: ${approvedPlatformIds.size} plataformas aprovadas, ${gatedCandidates.length} candidatos passaram`
      );
    }
    candidates.length = 0;
    candidates.push(...gatedCandidates);
    if (candidates.length === 0) {
      logger.warn("engine", "Platform gate bloqueou todos — NO_TRADE (round não criado)");
      await safeRecordRiskEvent("no_trade", "info", "Platform gate bloqueou todos os candidatos", {
        stage: "platform_gate",
        rejected: rejectedPlatform,
      });
      return;
    }

    // ---- SOURCE HEALTH GATE (scoped: CEX vs DEX) ----
    // Uma fonte crítica DEX em erro não derruba o CEX (e vice-versa); fonte
    // global (LLM) bloqueia ambos. Sem isso o SCOUT ignora fonte morta.
    try {
      const health = await evaluateSourceHealthForScout();
      if (health.globalBlocked || health.blockedScopes.cex || health.blockedScopes.dex) {
        let rejectedHealth = 0;
        const healthy = candidates.filter((c) => {
          const scope = c.source === "cex" ? "cex" : "dex";
          const blocked = health.globalBlocked || health.blockedScopes[scope];
          if (blocked) {
            rejectedHealth++;
            logger.warn("engine", `${c.symbol} (${scope}) rejeitado por source health — ${health.reasons.join("; ")}`);
          }
          return !blocked;
        });
        candidates.length = 0;
        candidates.push(...healthy);
        if (rejectedHealth > 0) {
          await safeRecordRiskEvent("no_trade", "warning", "Source health bloqueou candidatos", {
            stage: "source_health",
            rejected: rejectedHealth,
            remaining: candidates.length,
            reasons: health.reasons,
          });
        }
        if (candidates.length === 0) {
          logger.warn("engine", "Source health bloqueou todos — NO_TRADE (round não criado)");
          return;
        }
      }
    } catch (err) {
      logger.warn("engine", `Erro avaliando source health — gate desativado: ${String(err)}`);
    }

    // ANALYZE
    // Multi-layer analysis: scam-detector (regex on contract source) +
    // GoPlus (real honeypot/tax/holder data via API) + market indicators +
    // AI agent squad (LLM thesis, news sentiment, contract audit).
    //
    // A token must pass ALL layers to be approved:
    //   1. scam-detector score >= cfg.scamScoreMin
    //   2. GoPlus has no criticalFlags
    //   3. Market data is LIVE (DEX) — never trade a neutral signal on bad data
    //   4. AI consensus is NOT "avoid" (AI unavailable = feature off, not veto)
    //   5. Market signal is not "strong_sell"
    this.currentLoopState = "analyze";
    const approved: {
      candidate: (typeof candidates)[0];
      report: Awaited<ReturnType<typeof analyzeToken>>;
      market: Awaited<ReturnType<typeof analyzeMarket>>;
    }[] = [];
    let rejectedScam = 0;
    let rejectedAI = 0;
    let rejectedMarket = 0;
    let rejectedDataQuality = 0;
    let skippedNoData = 0;
    let aiDisabled = false;

    // Process candidates sequentially to avoid burning rate limits on
    // GoPlus + LLM APIs. We analyze up to (maxPositions * 3) candidates.
    for (const c of candidates) {
      // Layer 1: scam-detector (regex + Etherscan source check)
      const report = await analyzeToken(cfg, c);
      if (!report.passed) {
        rejectedScam++;
        continue;
      }

      // Layer 2: GoPlus (real on-chain honeypot/tax check)
      if (c.source === "dex" && c.tokenId && c.chain) {
        try {
          const goplus = await scanTokenWithGoPlus(c.chain, c.tokenId);
          if (goplus.criticalFlags.length > 0) {
            rejectedScam++;
            logger.warn(
              "goplus",
              `${c.symbol} rejeitado por GoPlus: ${goplus.criticalFlags.join("; ")}`
            );
            continue;
          }
        } catch (err) {
          // GoPlus failure shouldn't hard-block — log and continue
          logger.warn("goplus", `Erro scan ${c.symbol}: ${String(err)}`);
        }
      }

      // Layer 3: market analysis (TA + sentiment)
      let market: Awaited<ReturnType<typeof analyzeMarket>>;
      try {
        market = await analyzeMarket(c);
      } catch (err) {
        if (isMarketDataUnavailableError(err)) {
          // Honest data failure → NO_TRADE for this candidate. Never build a
          // neutral signal out of missing market data.
          skippedNoData++;
          logger.warn("market", `${c.symbol} NO_TRADE — market data indisponível: ${String(err)}`);
          await safeRecordRiskEvent(
            "no_trade",
            "warning",
            `Market data indisponível para ${c.symbol} — NO_TRADE`,
            {
              stage: "market_analysis",
              symbol: c.symbol,
              reason: "market_data_unavailable",
            }
          );
          continue;
        }
        logger.warn("market", `Erro analisando ${c.symbol}: ${String(err)}`);
        market = {
          symbol: c.symbol,
          source: c.source,
          chain: c.chain,
          tokenId: c.tokenId,
          priceUsd: c.priceUsd,
          rsi14: null,
          macdHist: null,
          ema20: null,
          ema50: null,
          bollUpper: null,
          bollLower: null,
          bollPercent: null,
          fearGreedIndex: null,
          fearGreedClass: null,
          trendingRank: null,
          signalScore: 50,
          signalLabel: "neutral",
          dataQuality: "unavailable",
          raw: {},
        };
      }

      // Layer 3b: data-quality gate — DEX only trades on LIVE market data.
      // A "neutral" signal computed from stale data is a no-trade, not approval.
      const dataQualityGate = evaluateDataQualityGate(c.source, market);
      if (dataQualityGate.skip) {
        rejectedDataQuality++;
        logger.info(
          "market",
          `${c.symbol} NO_TRADE — dataQuality=${dataQualityGate.dataQuality ?? "missing"} (exige 'live')`
        );
        await safeRecordRiskEvent(
          "no_trade",
          "warning",
          `Data quality '${dataQualityGate.dataQuality ?? "missing"}' para ${c.symbol} — NO_TRADE`,
          {
            stage: "data_quality",
            symbol: c.symbol,
            dataQuality: dataQualityGate.dataQuality,
            reason: dataQualityGate.reason,
          }
        );
        continue;
      }

      if (market.signalLabel === "strong_sell") {
        rejectedMarket++;
        logger.info("market", `${c.symbol} rejeitado — signal=strong_sell`);
        continue;
      }

      // Layer 4: AI agent squad (LLM thesis + news + contract audit)
      // Only run on the first maxPositions candidates that pass earlier layers
      // to limit LLM API spend. If the provider is unavailable we disable AI
      // for this tick (feature off) instead of vetoing or inventing a verdict.
      if (approved.length < cfg.maxPositionsPerRound && !aiDisabled) {
        try {
          const goplusForAI =
            c.source === "dex" && c.tokenId && c.chain
              ? await scanTokenWithGoPlus(c.chain, c.tokenId)
              : null;
          const squad = await runAgentSquad(c, market, report, goplusForAI);
          const outcome = evaluateAiSquadOutcome({
            ok: true,
            consensus: squad.consensus,
            consensusConfidence: squad.consensusConfidence,
          });
          // AI veto only when consensus is "avoid" AND confidence is high
          // (>=70%). "investigate" alone doesn't veto — just logs.
          if (outcome.veto) {
            rejectedAI++;
            logger.info(
              "ai",
              `${c.symbol} rejeitado pela AI squad: ${outcome.consensus} (conf ${outcome.confidence}%)`
            );
            continue;
          }
          if (outcome.investigate) {
            logger.info(
              "ai",
              `${c.symbol} marcado para investigação pela AI (conf ${outcome.confidence}%) — prosseguindo com cautela`
            );
          }
        } catch (err) {
          const outcome = evaluateAiSquadOutcome({ ok: false, error: err });
          if (outcome.aiUnavailable) {
            // Feature off: do NOT veto, do NOT fabricate "investigate".
            aiDisabled = true;
            if (!aiUnavailableLogged) {
              aiUnavailableLogged = true;
              logger.warn(
                "ai",
                "AI provider indisponível (AI_UNAVAILABLE) — seguindo SEM IA (feature desligada; sem veto e sem 'investigate')"
              );
            }
          } else {
            // AI failure shouldn't block — log and proceed with the token
            logger.warn("ai", `Erro squad ${c.symbol}: ${String(err)} — prosseguindo sem AI veto`);
          }
        }
      }

      approved.push({ candidate: c, report, market });
      if (approved.length >= cfg.maxPositionsPerRound) break;
    }

    logger.info(
      "engine",
      `ANALYZE: ${approved.length} aprovados, ${rejectedScam} scam, ${rejectedMarket} market, ${rejectedAI} AI-veto, ${rejectedDataQuality} data-quality, ${skippedNoData} sem-dados`
    );

    if (approved.length === 0) {
      logger.warn("engine", "Nenhum token passou nos filtros — NO_TRADE (round não criado)");
      await safeRecordRiskEvent("no_trade", "info", "ANALYZE sem aprovados — round não criado", {
        stage: "analyze",
        rejectedScam,
        rejectedMarket,
        rejectedAI,
        rejectedDataQuality,
        skippedNoData,
      });
      return;
    }

    // EXECUTE — every gate runs BEFORE a round exists, so an empty tick can
    // never leave a "running" round behind (round-spam bug).
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
    if (!Number.isFinite(perToken) || perToken <= 0) {
      logger.warn("engine", "NO_TRADE — alocação por token inválida: $" + perToken.toFixed(2));
      return;
    }

    const ownerId = await getSystemOwnerId();
    const maxDeviationPct = getMaxEntryDeviationPct();
    const executable: Array<{
      candidate: (typeof candidates)[0];
      report: Awaited<ReturnType<typeof analyzeToken>>;
      strategy: string;
      entryPriceUsd: number;
    }> = [];
    let blockedPrice = 0;
    let blockedRisk = 0;
    let blockedDiv = 0;

    for (const { candidate, report } of approved.slice(0, maxPositions)) {
      // GATE 1 — price consistency: re-fetch the CURRENT price from the same
      // feed used for exits and reject stale/divergent candidates. This is the
      // LIT/USDT "-77% in 13s" guard.
      const fetchedPrice = await this.fetchEntryPrice(candidate);
      const validation = validateEntryPrice(
        candidate.priceUsd,
        fetchedPrice,
        maxDeviationPct
      );
      if (!validation.ok) {
        blockedPrice++;
        const dev = validation.deviationPct === null ? "n/a" : `${validation.deviationPct.toFixed(2)}%`;
        logger.warn(
          "engine",
          `NO_TRADE ${candidate.symbol}: preço inconsistente (${validation.reason}, desvio=${dev}, máx=${maxDeviationPct}%)`
        );
        await safeRecordRiskEvent(
          "no_trade",
          "warning",
          `Entrada rejeitada por inconsistência de preço: ${candidate.symbol} (${validation.reason})`,
          {
            stage: "entry_price",
            symbol: candidate.symbol,
            source: candidate.source,
            candidatePriceUsd: candidate.priceUsd,
            fetchedPriceUsd: fetchedPrice,
            deviationPct: validation.deviationPct,
            maxDeviationPct,
            reason: validation.reason,
          }
        );
        continue;
      }

      // Same feed/resolution for entry and exit: use the verified live price.
      const verifiedCandidate = { ...candidate, priceUsd: validation.entryPriceUsd };

      // GATE 2 — risk manager
      const risk = await assessTradeRisk(freshCfg, candidate.symbol, perToken);
      if (!risk.allowed) {
        blockedRisk++;
        logger.warn(
          "engine",
          `Risk manager bloqueou ${candidate.symbol}: ${risk.reasons.join("; ")}`
        );
        continue;
      }

      // GATE 3 — diversification (per symbol / chain / strategy caps)
      const strategy = (await pickStrategyForCandidate(freshCfg)) ?? "day";
      const div = await checkDiversification(freshCfg, verifiedCandidate, strategy);
      if (!div.allowed) {
        blockedDiv++;
        logger.info(
          "engine",
          `Diversificação bloqueou ${candidate.symbol}: ${div.reasons.join("; ")}`
        );
        continue;
      }

      executable.push({
        candidate: verifiedCandidate,
        report,
        strategy,
        entryPriceUsd: validation.entryPriceUsd,
      });
    }

    logger.info(
      "engine",
      `EXECUTE pré-checks: ${executable.length} executáveis (${blockedPrice} preço, ${blockedRisk} risco, ${blockedDiv} diversificação)`
    );

    if (!shouldCreateRound(executable.length)) {
      logger.warn("engine", "Nenhum candidato executável — NO_TRADE (round não criado)");
      await safeRecordRiskEvent(
        "no_trade",
        "info",
        "Nenhum candidato executável — round não criado",
        { stage: "execute_precheck", blockedPrice, blockedRisk, blockedDiv }
      );
      return;
    }

    // ROUND — created only now that there is a position to open.
    const tb = await db.tradingBalance.findUnique({ where: { id: "singleton" } });
    const rb = await db.reserve.findUnique({ where: { id: "singleton" } });
    if (!tb || !rb) return;

    const round = await db.round.create({
      data: {
        startedAt: new Date(),
        tradingBalanceUsd: tb.balanceUsd,
        reserveBalanceUsd: rb.balanceUsd,
        status: "running",
        tokensScanned: candidates.length,
        tokensPassedFilter: approved.length,
        tokensRejectedScam: rejectedScam,
      },
    });
    this.currentRoundId = round.id;
    logger.info(
      "engine",
      `Round ${round.id} iniciado (saldo $${tb.balanceUsd.toFixed(2)}, ${executable.length} candidato(s) executável(is))`
    );

    let opened = 0;
    for (const { candidate, report, strategy, entryPriceUsd } of executable) {
      const pos = await openPosition(
        freshCfg,
        candidate,
        perToken,
        report,
        round.id,
        ownerId,
        strategy
      );
      if (pos) {
        opened++;
        eventBus.push({
          type: "position",
          level: "info",
          source: "engine",
          title: `Posição aberta: ${candidate.symbol}`,
          message: `Comprou ${candidate.symbol} @ $${entryPriceUsd.toFixed(entryPriceUsd < 1 ? 6 : 2)} ($${perToken.toFixed(2)} alocado, score ${report.score}/100)`,
          context: {
            positionId: pos.id,
            symbol: candidate.symbol,
            source: candidate.source,
            chain: candidate.chain,
            entryPrice: entryPriceUsd,
            entryAmountUsd: perToken,
            scamScore: report.score,
            roundId: round.id,
          },
        });
        // External notification — new position opened
        notifyEvent({
          eventType: "position_opened",
          title: `Posição Aberta: ${candidate.symbol}`,
          message: `Comprou *${candidate.symbol}* @ $${entryPriceUsd.toFixed(entryPriceUsd < 1 ? 6 : 2)} — $${perToken.toFixed(2)} alocado (score anti-scam: ${report.score}/100, source: ${candidate.source}${candidate.chain ? "/" + candidate.chain : ""}).`,
          context: {
            symbol: candidate.symbol,
            source: candidate.source,
            chain: candidate.chain ?? "",
            entryPrice: entryPriceUsd.toFixed(entryPriceUsd < 1 ? 6 : 2),
            entryAmountUsd: perToken.toFixed(2),
            scamScore: report.score,
            roundId: round.id,
            positionId: pos.id,
          },
        }).catch(() => { /* fire-and-forget */ });
      }
    }

    if (opened === 0) {
      // Never leave a "running" round with zero open positions.
      await db.round.update({
        where: { id: round.id },
        data: {
          status: "aborted",
          endedAt: new Date(),
          positionsOpened: 0,
          notes: "Execução não abriu nenhuma posição",
        },
      });
      this.currentRoundId = null;
      logger.warn(
        "engine",
        `Round ${round.id} abortado — nenhuma posição aberta (não fica 'running')`
      );
      await safeRecordRiskEvent(
        "no_trade",
        "warning",
        "Execução não abriu nenhuma posição — round abortado",
        { roundId: round.id, executable: executable.length }
      );
      return;
    }

    await db.round.update({
      where: { id: round.id },
      data: { positionsOpened: opened },
    });
    logger.info("engine", `EXECUTE: ${opened} posições abertas no round ${round.id}`);
  }

  // Fetch the live price for a candidate using the SAME price-feed/resolution
  // used to price open positions at exit time. A synthetic id lets us reuse
  // fetchPricesBatch (and its 15s cache) instead of a second feed.
  private async fetchEntryPrice(candidate: {
    symbol: string;
    source: "cex" | "dex";
    chain?: string;
    tokenId?: string;
  }): Promise<number> {
    const syntheticId = `entry:${candidate.source}:${candidate.chain ?? "cex"}:${candidate.tokenId ?? candidate.symbol}`;
    const prices = await fetchPricesBatch([
      {
        id: syntheticId,
        symbol: candidate.symbol,
        source: candidate.source,
        chain: candidate.chain ?? null,
        tokenId: candidate.tokenId ?? null,
      },
    ]);
    return prices.get(syntheticId) ?? 0;
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
  const openCount = await withSystemRls((tx) =>
    tx.position.count({ where: { status: "open" } })
  );
  const demoData = await isDemoDataPresent();

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
    demoData,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function reasonLabel(r: ExitReason): string {
  switch (r) {
    case "take_profit":
      return "TP";
    case "stop_loss":
      return "SL";
    case "timeout":
      return "timeout";
    case "kill_switch":
      return "kill switch";
    case "manual":
      return "manual";
    case "schedule_force_close":
      return "fechamento de agenda";
    default:
      return r;
  }
}

// Risk events are audit trail, not control flow: a failure to persist one must
// never abort an exit or an engine tick.
async function safeRecordRiskEvent(
  type: string,
  severity: "info" | "warning" | "critical",
  message: string,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    await recordRiskEvent(type, severity, message, context);
  } catch (err) {
    logger.warn("risk", `Falha ao registrar risk event '${type}': ${String(err)}`);
  }
}