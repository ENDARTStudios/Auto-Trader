-- Migration: 20260714000001_wallet_exchange_recon_fix
-- Date: 2026-07-14
-- Type: BASELINE (full schema snapshot post-recovery)
--
-- Context:
--   This file is the FIRST migration in the project. Prior to 2026-07-14 the
--   project used `prisma db push` exclusively (no migrations directory), which
--   meant a fresh DB clone and the existing dev DB could diverge silently.
--   This was flagged as a divergence risk during the PolarFS snapshot
--   recovery review, after the WalletConnection / ExchangeConnection models
--   were manually reconstructed with 8 fields missing (chain, publicKey,
--   lastUsedAt for Wallet; apiKeyPublicPrefix, permissions, testnet,
--   ipWhitelistConfigured, lastUsedAt for Exchange). The bug passed 29/29 CI
--   tests because test-vault.ts writes wallet rows directly via
--   db.walletConnection.create() with the minimal field set and does not
--   exercise the wallet-manager.ts CRUD layer called by the API routes.
--
-- Scope:
--   This baseline captures the FULL current schema (19 models) at the
--   post-recovery state. It is NOT intended to be re-applied to the existing
--   dev DB (already in sync via db push). It exists so that:
--     1. Fresh clones can run `prisma migrate deploy` for byte-identical schema.
--     2. Future changes go through `prisma migrate dev --name <desc>`.
--     3. The REG-006 missing-fields bug is documented in migration history.
--
-- Registered as REG-006 in SECURITY.md.

-- CreateTable
CREATE TABLE "Config" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "mode" TEXT NOT NULL DEFAULT 'paper',
    "loopIntervalSec" INTEGER NOT NULL DEFAULT 60,
    "initialCapitalUsd" REAL NOT NULL DEFAULT 1000.0,
    "maxPositionsPerRound" INTEGER NOT NULL DEFAULT 10,
    "capitalPctPerRound" REAL NOT NULL DEFAULT 100.0,
    "reservePct" REAL NOT NULL DEFAULT 50.0,
    "reinvestPct" REAL NOT NULL DEFAULT 50.0,
    "reserveAsset" TEXT NOT NULL DEFAULT 'USDC',
    "takeProfitPct" REAL NOT NULL DEFAULT 15.0,
    "stopLossPct" REAL NOT NULL DEFAULT 8.0,
    "maxHoldMinutes" INTEGER NOT NULL DEFAULT 180,
    "maxDailyLossPct" REAL NOT NULL DEFAULT 10.0,
    "maxLossPerTradePct" REAL NOT NULL DEFAULT 5.0,
    "maxExposurePerTokenPct" REAL NOT NULL DEFAULT 15.0,
    "maxDrawdownPct" REAL NOT NULL DEFAULT 20.0,
    "scamScoreMin" INTEGER NOT NULL DEFAULT 70,
    "minLiquidityUsd" REAL NOT NULL DEFAULT 100000.0,
    "minVolume24hUsd" REAL NOT NULL DEFAULT 50000.0,
    "scanCex" BOOLEAN NOT NULL DEFAULT true,
    "scanDex" BOOLEAN NOT NULL DEFAULT true,
    "cexSymbols" TEXT NOT NULL DEFAULT '["BTC/USDT","ETH/USDT","SOL/USDT","BNB/USDT","XRP/USDT"]',
    "dexChains" TEXT NOT NULL DEFAULT '["base","arbitrum","optimism"]',
    "engineRunning" BOOLEAN NOT NULL DEFAULT false,
    "killSwitchActive" BOOLEAN NOT NULL DEFAULT false,
    "killSwitchReason" TEXT,
    "killSwitchAt" DATETIME,
    "paperCyclesRequired" INTEGER NOT NULL DEFAULT 50,
    "paperCyclesPassed" INTEGER NOT NULL DEFAULT 0,
    "graduatedToLive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "tokenId" TEXT,
    "chain" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "entryPriceUsd" REAL NOT NULL,
    "entryAmountUsd" REAL NOT NULL,
    "entryQty" REAL NOT NULL,
    "entryAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitPriceUsd" REAL,
    "exitAmountUsd" REAL,
    "exitAt" DATETIME,
    "exitReason" TEXT,
    "pnlUsd" REAL,
    "pnlPct" REAL,
    "takeProfitPrice" REAL NOT NULL,
    "stopLossPrice" REAL NOT NULL,
    "maxExitAt" DATETIME NOT NULL,
    "scamScore" INTEGER NOT NULL DEFAULT 0,
    "scamBreakdown" TEXT,
    "roundId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Reserve" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "asset" TEXT NOT NULL DEFAULT 'USDC',
    "balanceUsd" REAL NOT NULL DEFAULT 0.0,
    "totalDepositedUsd" REAL NOT NULL DEFAULT 0.0,
    "totalWithdrawnUsd" REAL NOT NULL DEFAULT 0.0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TradingBalance" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "balanceUsd" REAL NOT NULL DEFAULT 1000.0,
    "peakBalanceUsd" REAL NOT NULL DEFAULT 1000.0,
    "realizedPnlUsd" REAL NOT NULL DEFAULT 0.0,
    "tradesOpened" INTEGER NOT NULL DEFAULT 0,
    "tradesClosed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RiskEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "message" TEXT NOT NULL,
    "context" TEXT,
    "triggeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ScamReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "tokenId" TEXT,
    "chain" TEXT,
    "score" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "honeypotScore" INTEGER NOT NULL DEFAULT 0,
    "liquidityScore" INTEGER NOT NULL DEFAULT 0,
    "contractScore" INTEGER NOT NULL DEFAULT 0,
    "taxScore" INTEGER NOT NULL DEFAULT 0,
    "holderScore" INTEGER NOT NULL DEFAULT 0,
    "ageScore" INTEGER NOT NULL DEFAULT 0,
    "findings" TEXT,
    "analyzedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Round" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "tradingBalanceUsd" REAL NOT NULL,
    "reserveBalanceUsd" REAL NOT NULL,
    "tokensScanned" INTEGER NOT NULL DEFAULT 0,
    "tokensPassedFilter" INTEGER NOT NULL DEFAULT 0,
    "tokensRejectedScam" INTEGER NOT NULL DEFAULT 0,
    "positionsOpened" INTEGER NOT NULL DEFAULT 0,
    "positionsClosed" INTEGER NOT NULL DEFAULT 0,
    "roundPnlUsd" REAL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "AppLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "source" TEXT NOT NULL DEFAULT 'engine',
    "message" TEXT NOT NULL,
    "context" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "symbol" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "chain" TEXT,
    "tokenId" TEXT,
    "priceUsd" REAL NOT NULL,
    "rsi14" REAL,
    "macdHist" REAL,
    "ema20" REAL,
    "ema50" REAL,
    "bollUpper" REAL,
    "bollLower" REAL,
    "bollPercent" REAL,
    "fearGreedIndex" INTEGER,
    "fearGreedClass" TEXT,
    "trendingRank" INTEGER,
    "signalScore" INTEGER NOT NULL DEFAULT 50,
    "signalLabel" TEXT NOT NULL DEFAULT 'neutral',
    "rawIndicators" TEXT,
    "analyzedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AIInsight" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "agentRole" TEXT NOT NULL,
    "symbol" TEXT,
    "tokenId" TEXT,
    "chain" TEXT,
    "promptSummary" TEXT NOT NULL,
    "modelOutput" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "keySignals" TEXT,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SiteAudit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "url" TEXT NOT NULL,
    "symbol" TEXT,
    "tokenId" TEXT,
    "chain" TEXT,
    "score" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "sslScore" INTEGER NOT NULL DEFAULT 0,
    "domainAgeScore" INTEGER NOT NULL DEFAULT 0,
    "headersScore" INTEGER NOT NULL DEFAULT 0,
    "safeBrowsingScore" INTEGER NOT NULL DEFAULT 0,
    "contentScore" INTEGER NOT NULL DEFAULT 0,
    "sslValid" BOOLEAN NOT NULL DEFAULT false,
    "sslDaysToExpiry" INTEGER,
    "domainAgeDays" INTEGER,
    "hstsPresent" BOOLEAN NOT NULL DEFAULT false,
    "cspPresent" BOOLEAN NOT NULL DEFAULT false,
    "xfoPresent" BOOLEAN NOT NULL DEFAULT false,
    "safeBrowsingFlagged" BOOLEAN NOT NULL DEFAULT false,
    "redFlags" TEXT,
    "findings" TEXT,
    "auditedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PositionAlert" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "positionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "context" TEXT,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "resolution" TEXT
);

-- CreateTable
CREATE TABLE "BacktestResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "symbols" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "initialCapitalUsd" REAL NOT NULL,
    "perTradeUsd" REAL NOT NULL,
    "takeProfitPct" REAL NOT NULL,
    "stopLossPct" REAL NOT NULL,
    "maxHoldBars" INTEGER NOT NULL,
    "rsiEntryMax" REAL NOT NULL,
    "rsiExitMin" REAL NOT NULL,
    "totalTrades" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "winRate" REAL NOT NULL,
    "profitFactor" REAL NOT NULL,
    "totalPnlUsd" REAL NOT NULL,
    "totalPnlPct" REAL NOT NULL,
    "maxDrawdownPct" REAL NOT NULL,
    "sharpeRatio" REAL NOT NULL,
    "avgTradePnlUsd" REAL NOT NULL,
    "avgHoldBars" REAL NOT NULL,
    "bestTradeUsd" REAL NOT NULL,
    "worstTradeUsd" REAL NOT NULL,
    "equityCurve" TEXT NOT NULL,
    "tradesJson" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT
);

-- CreateTable
CREATE TABLE "PerformanceSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tradingBalanceUsd" REAL NOT NULL,
    "reserveBalanceUsd" REAL NOT NULL,
    "peakBalanceUsd" REAL NOT NULL,
    "realizedPnlUsd" REAL NOT NULL,
    "unrealizedPnlUsd" REAL NOT NULL,
    "totalEquityUsd" REAL NOT NULL,
    "openPositionsCount" INTEGER NOT NULL,
    "drawdownPct" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "throttleSec" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "error" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TradingSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "daysOfWeek" TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
    "startTime" TEXT NOT NULL DEFAULT '09:00',
    "endTime" TEXT NOT NULL DEFAULT '21:00',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "forceCloseAtEnd" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WalletConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'evm',
    "address" TEXT NOT NULL,
    "chain" TEXT,
    "publicKey" TEXT,
    "privateKeyEncrypted" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "readOnly" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ExchangeConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT,
    "apiSecretEncrypted" TEXT,
    "apiPassphraseEncrypted" TEXT,
    "apiKeyPublicPrefix" TEXT,
    "permissions" TEXT,
    "testnet" BOOLEAN NOT NULL DEFAULT false,
    "ipWhitelistConfigured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Position_status_idx" ON "Position"("status");

-- CreateIndex
CREATE INDEX "Position_roundId_idx" ON "Position"("roundId");

-- CreateIndex
CREATE INDEX "Position_symbol_idx" ON "Position"("symbol");

-- CreateIndex
CREATE INDEX "ScamReport_symbol_idx" ON "ScamReport"("symbol");

-- CreateIndex
CREATE INDEX "ScamReport_passed_idx" ON "ScamReport"("passed");

-- CreateIndex
CREATE INDEX "AppLog_createdAt_idx" ON "AppLog"("createdAt");

-- CreateIndex
CREATE INDEX "MarketSnapshot_symbol_idx" ON "MarketSnapshot"("symbol");

-- CreateIndex
CREATE INDEX "MarketSnapshot_analyzedAt_idx" ON "MarketSnapshot"("analyzedAt");

-- CreateIndex
CREATE INDEX "AIInsight_agentRole_idx" ON "AIInsight"("agentRole");

-- CreateIndex
CREATE INDEX "AIInsight_symbol_idx" ON "AIInsight"("symbol");

-- CreateIndex
CREATE INDEX "AIInsight_createdAt_idx" ON "AIInsight"("createdAt");

-- CreateIndex
CREATE INDEX "SiteAudit_url_idx" ON "SiteAudit"("url");

-- CreateIndex
CREATE INDEX "SiteAudit_symbol_idx" ON "SiteAudit"("symbol");

-- CreateIndex
CREATE INDEX "SiteAudit_auditedAt_idx" ON "SiteAudit"("auditedAt");

-- CreateIndex
CREATE INDEX "PositionAlert_positionId_idx" ON "PositionAlert"("positionId");

-- CreateIndex
CREATE INDEX "PositionAlert_severity_idx" ON "PositionAlert"("severity");

-- CreateIndex
CREATE INDEX "PositionAlert_detectedAt_idx" ON "PositionAlert"("detectedAt");

-- CreateIndex
CREATE INDEX "PositionAlert_resolvedAt_idx" ON "PositionAlert"("resolvedAt");

-- CreateIndex
CREATE INDEX "BacktestResult_status_idx" ON "BacktestResult"("status");

-- CreateIndex
CREATE INDEX "BacktestResult_startedAt_idx" ON "BacktestResult"("startedAt");

-- CreateIndex
CREATE INDEX "PerformanceSnapshot_timestamp_idx" ON "PerformanceSnapshot"("timestamp");

-- CreateIndex
CREATE INDEX "NotificationLog_channelId_idx" ON "NotificationLog"("channelId");

-- CreateIndex
CREATE INDEX "NotificationLog_eventType_idx" ON "NotificationLog"("eventType");

-- CreateIndex
CREATE INDEX "NotificationLog_sentAt_idx" ON "NotificationLog"("sentAt");

-- CreateIndex
CREATE INDEX "WalletConnection_address_idx" ON "WalletConnection"("address");

-- CreateIndex
CREATE INDEX "WalletConnection_isActive_idx" ON "WalletConnection"("isActive");

-- CreateIndex
CREATE INDEX "ExchangeConnection_exchange_idx" ON "ExchangeConnection"("exchange");

-- CreateIndex
CREATE INDEX "ExchangeConnection_isActive_idx" ON "ExchangeConnection"("isActive");

