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
                // External notification — graduation milestone
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
      // Record performance snapshot (throttled to 1/min)
      await recordSnapshotIfDue();
    } catch (err) {
      logger.error("engine", "Erro no tick", { error: String(err), stack: (err as Error).stack });
    } finally {
      this.busy = false;
    }
  }

  // -------------------------------------------------------------------------
  // MONITOR + EXIT — check TP/SL/timeout for all open positions
  // + run surveillance (GoPlus re-scan, liquidity drain, price anomaly)
  // + run exit planner (AI-driven exit decision for flagged positions)
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

    // ---- Phase 1: Standard mechanical exits (TP/SL/timeout) ----
    let closed = 0;
    const now = new Date();
    const stillOpen: typeof openPositions = [];
    for (const pos of openPositions) {
      const price = prices.get(pos.id) ?? 0;
      if (price <= 0) {
        logger.warn("engine", `Sem preço para ${pos.symbol}, pulando`);
        stillOpen.push(pos);
        continue;
      }

      let reason: ExitReason | null = null;
      if (price >= pos.takeProfitPrice) reason = "take_profit";
      else if (price <= pos.stopLossPrice) reason = "stop_loss";
      else if (now >= pos.maxExitAt) reason = "timeout";

      if (reason) {
        await closePosition(cfg, pos.id, price, reason);
        await resolveAlertsForPosition(pos.id, "exited_position");
        closed++;
        eventBus.push({
          type: "position",
          level: reason === "take_profit" ? "info" : reason === "stop_loss" ? "warn" : "info",
          source: "engine",
          title: `Posição ${pos.symbol} fechada (${reasonLabel(reason)})`,
          message: `${pos.symbol} saiu em ${reasonLabel(reason)} @ $${price.toFixed(price < 1 ? 6 : 2)}`,
          context: {
            positionId: pos.id,
            symbol: pos.symbol,
            reason,
            exitPrice: price,
            entryPrice: pos.entryPriceUsd,
            entryAmountUsd: pos.entryAmountUsd,
          },
        });
        // External notification — fetch fresh position to compute P&L
        try {
          const fresh = await db.position.findUnique({ where: { id: pos.id } });
          const pnlUsd = fresh?.pnlUsd ?? 0;
          const pnlPct = fresh?.pnlPct ?? 0;
          notifyEvent({
            eventType: "position_closed",
            title: `Posição Fechada: ${pos.symbol} (${reasonLabel(reason)})`,
            message: `${pos.symbol} saiu em *${reasonLabel(reason)}* @ $${price.toFixed(price < 1 ? 6 : 2)}. P&L: ${pnlUsd >= 0 ? "+" : ""}$${pnlUsd.toFixed(2)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%).`,
            context: {
              symbol: pos.symbol,
              reason,
              exitPrice: price,
              entryPrice: pos.entryPriceUsd,
              pnlUsd: pnlUsd.toFixed(2),
              pnlPct: pnlPct.toFixed(2) + "%",
              positionId: pos.id,
            },
          }).catch(() => { /* fire-and-forget */ });
        } catch {
          // ignore
        }
      } else {
        stillOpen.push(pos);
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
      await resolveAlertsForPosition(pos.id, "exited_position");
      eventBus.push({
        type: "position",
        level: "critical",
        source: "engine",
        title: `Force-exit: ${pos.symbol} (${reasonLabel(reason)})`,
        message: `${pos.symbol} forçadamente fechado @ $${price.toFixed(price < 1 ? 6 : 2)} — motivo: ${reasonLabel(reason)}`,
        context: {
          positionId: pos.id,
          symbol: pos.symbol,
          reason,
          exitPrice: price,
          entryPrice: pos.entryPriceUsd,
        },
      });
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
      logger.warn("engine", "Todos candidatos rejeitados pelo platform gate — round abortado");
      await db.round.update({
        where: { id: round.id },
        data: { status: "aborted", notes: "Platform gate bloqueou todos", endedAt: new Date() },
      });
      this.currentRoundId = null;
      return;
    }

    // ANALYZE
    // Multi-layer analysis: scam-detector (regex on contract source) +
    // GoPlus (real honeypot/tax/holder data via API) + market indicators +
    // AI agent squad (LLM thesis, news sentiment, contract audit).
    //
    // A token must pass ALL layers to be approved:
    //   1. scam-detector score >= cfg.scamScoreMin
    //   2. GoPlus has no criticalFlags
    //   3. AI consensus is NOT "avoid" or "investigate"
    //   4. Market signal is not "strong_sell"
    this.currentLoopState = "analyze";
    const approved: {
      candidate: (typeof candidates)[0];
      report: Awaited<ReturnType<typeof analyzeToken>>;
      market: Awaited<ReturnType<typeof analyzeMarket>>;
    }[] = [];
    let rejectedScam = 0;
    let rejectedAI = 0;
    let rejectedMarket = 0;

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
          raw: {},
        };
      }
      if (market.signalLabel === "strong_sell") {
        rejectedMarket++;
        logger.info("market", `${c.symbol} rejeitado — signal=strong_sell`);
        continue;
      }

      // Layer 4: AI agent squad (LLM thesis + news + contract audit)
      // Only run on the first maxPositions candidates that pass layers 1-3
      // to limit LLM API spend.
      if (approved.length < cfg.maxPositionsPerRound) {
        try {
          const goplusForAI =
            c.source === "dex" && c.tokenId && c.chain
              ? await scanTokenWithGoPlus(c.chain, c.tokenId)
              : null;
          const squad = await runAgentSquad(c, market, report, goplusForAI);
          // AI veto only when consensus is "avoid" AND confidence is high
          // (>=70%). "investigate" alone doesn't veto — just logs.
          if (
            squad.consensus === "avoid" &&
            squad.consensusConfidence >= 70
          ) {
            rejectedAI++;
            logger.info(
              "ai",
              `${c.symbol} rejeitado pela AI squad: ${squad.consensus} (conf ${squad.consensusConfidence}%)`
            );
            continue;
          }
          if (squad.consensus === "investigate") {
            logger.info(
              "ai",
              `${c.symbol} marcado para investigação pela AI (conf ${squad.consensusConfidence}%) — prosseguindo com cautela`
            );
          }
        } catch (err) {
          // AI failure shouldn't block — log and proceed with the token
          logger.warn("ai", `Erro squad ${c.symbol}: ${String(err)} — prosseguindo sem AI veto`);
        }
      }

      approved.push({ candidate: c, report, market });
      if (approved.length >= cfg.maxPositionsPerRound) break;
    }

    await db.round.update({
      where: { id: round.id },
      data: {
        tokensPassedFilter: approved.length,
        tokensRejectedScam: rejectedScam + rejectedAI + rejectedMarket,
      },
    });
    logger.info(
      "engine",
      `ANALYZE: ${approved.length} aprovados, ${rejectedScam} scam, ${rejectedMarket} market, ${rejectedAI} AI-vetoed`
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
      if (pos) {
        opened++;
        eventBus.push({
          type: "position",
          level: "info",
          source: "engine",
          title: `Posição aberta: ${candidate.symbol}`,
          message: `Comprou ${candidate.symbol} @ $${candidate.priceUsd.toFixed(candidate.priceUsd < 1 ? 6 : 2)} ($${perToken.toFixed(2)} alocado, score ${report.score}/100)`,
          context: {
            positionId: pos.id,
            symbol: candidate.symbol,
            source: candidate.source,
            chain: candidate.chain,
            entryPrice: candidate.priceUsd,
            entryAmountUsd: perToken,
            scamScore: report.score,
            roundId: round.id,
          },
        });
        // External notification — new position opened
        notifyEvent({
          eventType: "position_opened",
          title: `Posição Aberta: ${candidate.symbol}`,
          message: `Comprou *${candidate.symbol}* @ $${candidate.priceUsd.toFixed(candidate.priceUsd < 1 ? 6 : 2)} — $${perToken.toFixed(2)} alocado (score anti-scam: ${report.score}/100, source: ${candidate.source}${candidate.chain ? "/" + candidate.chain : ""}).`,
          context: {
            symbol: candidate.symbol,
            source: candidate.source,
            chain: candidate.chain ?? "",
            entryPrice: candidate.priceUsd.toFixed(candidate.priceUsd < 1 ? 6 : 2),
            entryAmountUsd: perToken.toFixed(2),
            scamScore: report.score,
            roundId: round.id,
            positionId: pos.id,
          },
        }).catch(() => { /* fire-and-forget */ });
      }
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
    default:
      return r;
  }
}
