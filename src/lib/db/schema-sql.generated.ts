// GERADO AUTOMATICAMENTE por scripts/gen-schema-sql.mjs — não editar à mão.
// Fonte: prisma/schema.prisma (prisma migrate diff --from-empty --to-schema).
// Consumido por src/lib/db-init.ts para auto-inicializar bancos SQLite vazios
// em ambientes efêmeros (ex.: Vercel serverless).
export const SCHEMA_SQL = `-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "mode" TEXT NOT NULL DEFAULT 'paper',
    "loopIntervalSec" INTEGER NOT NULL DEFAULT 60,
    "initialCapitalUsd" DOUBLE PRECISION NOT NULL DEFAULT 1000.0,
    "maxPositionsPerRound" INTEGER NOT NULL DEFAULT 10,
    "capitalPctPerRound" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    "reservePct" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    "reinvestPct" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    "reserveAsset" TEXT NOT NULL DEFAULT 'USDC',
    "takeProfitPct" DOUBLE PRECISION NOT NULL DEFAULT 15.0,
    "stopLossPct" DOUBLE PRECISION NOT NULL DEFAULT 8.0,
    "maxHoldMinutes" INTEGER NOT NULL DEFAULT 180,
    "maxDailyLossPct" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "maxLossPerTradePct" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "maxExposurePerTokenPct" DOUBLE PRECISION NOT NULL DEFAULT 15.0,
    "maxDrawdownPct" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
    "scamScoreMin" INTEGER NOT NULL DEFAULT 70,
    "minLiquidityUsd" DOUBLE PRECISION NOT NULL DEFAULT 100000.0,
    "minVolume24hUsd" DOUBLE PRECISION NOT NULL DEFAULT 50000.0,
    "scanCex" BOOLEAN NOT NULL DEFAULT true,
    "scanDex" BOOLEAN NOT NULL DEFAULT true,
    "cexSymbols" TEXT NOT NULL DEFAULT '["BTC/USDT","ETH/USDT","SOL/USDT","BNB/USDT","XRP/USDT"]',
    "dexChains" TEXT NOT NULL DEFAULT '["base","arbitrum","optimism"]',
    "engineRunning" BOOLEAN NOT NULL DEFAULT false,
    "killSwitchActive" BOOLEAN NOT NULL DEFAULT false,
    "killSwitchReason" TEXT,
    "killSwitchAt" TIMESTAMP(3),
    "paperCyclesRequired" INTEGER NOT NULL DEFAULT 50,
    "paperCyclesPassed" INTEGER NOT NULL DEFAULT 0,
    "graduatedToLive" BOOLEAN NOT NULL DEFAULT false,
    "maxPositionsPerSymbol" INTEGER NOT NULL DEFAULT 2,
    "maxPositionsPerChain" INTEGER NOT NULL DEFAULT 5,
    "maxPositionsPerStrategy" INTEGER NOT NULL DEFAULT 5,
    "enabledStrategies" TEXT NOT NULL DEFAULT '["scalp","day","swing"]',
    "feeBps" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "slippageBps" DOUBLE PRECISION NOT NULL DEFAULT 30.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "tokenId" TEXT,
    "chain" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "entryPriceUsd" DOUBLE PRECISION NOT NULL,
    "entryAmountUsd" DOUBLE PRECISION NOT NULL,
    "entryQty" DOUBLE PRECISION NOT NULL,
    "entryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitPriceUsd" DOUBLE PRECISION,
    "exitAmountUsd" DOUBLE PRECISION,
    "exitAt" TIMESTAMP(3),
    "exitReason" TEXT,
    "pnlUsd" DOUBLE PRECISION,
    "pnlPct" DOUBLE PRECISION,
    "takeProfitPrice" DOUBLE PRECISION NOT NULL,
    "stopLossPrice" DOUBLE PRECISION NOT NULL,
    "maxExitAt" TIMESTAMP(3) NOT NULL,
    "scamScore" INTEGER NOT NULL DEFAULT 0,
    "scamBreakdown" TEXT,
    "strategy" TEXT NOT NULL DEFAULT 'day',
    "ownerId" TEXT NOT NULL,
    "roundId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reserve" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "asset" TEXT NOT NULL DEFAULT 'USDC',
    "balanceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "totalDepositedUsd" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "totalWithdrawnUsd" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reserve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingBalance" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "balanceUsd" DOUBLE PRECISION NOT NULL DEFAULT 1000.0,
    "peakBalanceUsd" DOUBLE PRECISION NOT NULL DEFAULT 1000.0,
    "realizedPnlUsd" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "tradesOpened" INTEGER NOT NULL DEFAULT 0,
    "tradesClosed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "message" TEXT NOT NULL,
    "context" TEXT,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScamReport" (
    "id" TEXT NOT NULL,
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
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScamReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Round" (
    "id" SERIAL NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "tradingBalanceUsd" DOUBLE PRECISION NOT NULL,
    "reserveBalanceUsd" DOUBLE PRECISION NOT NULL,
    "tokensScanned" INTEGER NOT NULL DEFAULT 0,
    "tokensPassedFilter" INTEGER NOT NULL DEFAULT 0,
    "tokensRejectedScam" INTEGER NOT NULL DEFAULT 0,
    "positionsOpened" INTEGER NOT NULL DEFAULT 0,
    "positionsClosed" INTEGER NOT NULL DEFAULT 0,
    "roundPnlUsd" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'running',
    "notes" TEXT,

    CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppLog" (
    "id" SERIAL NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "source" TEXT NOT NULL DEFAULT 'engine',
    "message" TEXT NOT NULL,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "chain" TEXT,
    "tokenId" TEXT,
    "priceUsd" DOUBLE PRECISION NOT NULL,
    "rsi14" DOUBLE PRECISION,
    "macdHist" DOUBLE PRECISION,
    "ema20" DOUBLE PRECISION,
    "ema50" DOUBLE PRECISION,
    "bollUpper" DOUBLE PRECISION,
    "bollLower" DOUBLE PRECISION,
    "bollPercent" DOUBLE PRECISION,
    "fearGreedIndex" INTEGER,
    "fearGreedClass" TEXT,
    "trendingRank" INTEGER,
    "signalScore" INTEGER NOT NULL DEFAULT 50,
    "signalLabel" TEXT NOT NULL DEFAULT 'neutral',
    "rawIndicators" TEXT,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIInsight" (
    "id" SERIAL NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteAudit" (
    "id" SERIAL NOT NULL,
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
    "auditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionAlert" (
    "id" SERIAL NOT NULL,
    "positionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "context" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "PositionAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestResult" (
    "id" SERIAL NOT NULL,
    "symbols" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "initialCapitalUsd" DOUBLE PRECISION NOT NULL,
    "perTradeUsd" DOUBLE PRECISION NOT NULL,
    "takeProfitPct" DOUBLE PRECISION NOT NULL,
    "stopLossPct" DOUBLE PRECISION NOT NULL,
    "maxHoldBars" INTEGER NOT NULL,
    "rsiEntryMax" DOUBLE PRECISION NOT NULL,
    "rsiExitMin" DOUBLE PRECISION NOT NULL,
    "totalTrades" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "profitFactor" DOUBLE PRECISION NOT NULL,
    "totalPnlUsd" DOUBLE PRECISION NOT NULL,
    "totalPnlPct" DOUBLE PRECISION NOT NULL,
    "maxDrawdownPct" DOUBLE PRECISION NOT NULL,
    "sharpeRatio" DOUBLE PRECISION NOT NULL,
    "avgTradePnlUsd" DOUBLE PRECISION NOT NULL,
    "avgHoldBars" DOUBLE PRECISION NOT NULL,
    "bestTradeUsd" DOUBLE PRECISION NOT NULL,
    "worstTradeUsd" DOUBLE PRECISION NOT NULL,
    "equityCurve" TEXT NOT NULL,
    "tradesJson" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,

    CONSTRAINT "BacktestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceSnapshot" (
    "id" SERIAL NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tradingBalanceUsd" DOUBLE PRECISION NOT NULL,
    "reserveBalanceUsd" DOUBLE PRECISION NOT NULL,
    "peakBalanceUsd" DOUBLE PRECISION NOT NULL,
    "realizedPnlUsd" DOUBLE PRECISION NOT NULL,
    "unrealizedPnlUsd" DOUBLE PRECISION NOT NULL,
    "totalEquityUsd" DOUBLE PRECISION NOT NULL,
    "openPositionsCount" INTEGER NOT NULL,
    "drawdownPct" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PerformanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "throttleSec" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" SERIAL NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "error" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingSchedule" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "daysOfWeek" TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
    "startTime" TEXT NOT NULL DEFAULT '09:00',
    "endTime" TEXT NOT NULL DEFAULT '21:00',
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "forceCloseAtEnd" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "onboardedAt" TIMESTAMP(3),
    "preferences" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "ip" TEXT,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletConnection" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'evm',
    "address" TEXT NOT NULL,
    "chain" TEXT,
    "publicKey" TEXT,
    "privateKeyEncrypted" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "readOnly" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPct" INTEGER NOT NULL DEFAULT 100,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Embedding" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "embedding" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Embedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeGraph" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "predicate" TEXT NOT NULL,
    "object" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeGraph_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "recordsCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeConnection" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
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
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistToken" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "chain" TEXT,
    "tokenId" TEXT,
    "notes" TEXT,
    "alertThresholdPct" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "addedPriceUsd" DOUBLE PRECISION,
    "lastPriceUsd" DOUBLE PRECISION,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchlistToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceHealth" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMsg" TEXT,
    "successCount24h" INTEGER NOT NULL DEFAULT 0,
    "errorCount24h" INTEGER NOT NULL DEFAULT 0,
    "rateLimited" BOOLEAN NOT NULL DEFAULT false,
    "rateLimitUntil" TIMESTAMP(3),
    "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowSuccessCount" INTEGER NOT NULL DEFAULT 0,
    "windowErrorCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SourceHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategicCapability" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "completionPct" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategicCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoutSkipStat" (
    "reason" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastAt" TIMESTAMP(3),

    CONSTRAINT "ScoutSkipStat_pkey" PRIMARY KEY ("reason")
);

-- CreateTable
CREATE TABLE "FeeAuditLog" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "grossAmountUsd" DOUBLE PRECISION NOT NULL,
    "executedPriceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeBps" DOUBLE PRECISION NOT NULL,
    "feeUsd" DOUBLE PRECISION NOT NULL,
    "slippageBps" DOUBLE PRECISION NOT NULL,
    "slippageUsd" DOUBLE PRECISION NOT NULL,
    "totalCostUsd" DOUBLE PRECISION NOT NULL,
    "netAmountUsd" DOUBLE PRECISION NOT NULL,
    "strategy" TEXT,
    "exchange" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperCycleAttempt" (
    "id" TEXT NOT NULL,
    "roundId" INTEGER NOT NULL,
    "pnlUsd" DOUBLE PRECISION NOT NULL,
    "tokensScanned" INTEGER NOT NULL DEFAULT 0,
    "positionsOpened" INTEGER NOT NULL DEFAULT 0,
    "positionsClosed" INTEGER NOT NULL DEFAULT 0,
    "profitable" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperCycleAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Position_ownerId_idx" ON "Position"("ownerId");

-- CreateIndex
CREATE INDEX "Position_status_idx" ON "Position"("status");

-- CreateIndex
CREATE INDEX "Position_roundId_idx" ON "Position"("roundId");

-- CreateIndex
CREATE INDEX "Position_symbol_idx" ON "Position"("symbol");

-- CreateIndex
CREATE INDEX "Position_strategy_idx" ON "Position"("strategy");

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
CREATE INDEX "NotificationChannel_ownerId_idx" ON "NotificationChannel"("ownerId");

-- CreateIndex
CREATE INDEX "NotificationLog_channelId_idx" ON "NotificationLog"("channelId");

-- CreateIndex
CREATE INDEX "NotificationLog_eventType_idx" ON "NotificationLog"("eventType");

-- CreateIndex
CREATE INDEX "NotificationLog_sentAt_idx" ON "NotificationLog"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

-- CreateIndex
CREATE INDEX "PasswordReset_tokenHash_idx" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_seq_key" ON "AuditLog"("seq");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "WalletConnection_ownerId_idx" ON "WalletConnection"("ownerId");

-- CreateIndex
CREATE INDEX "WalletConnection_address_idx" ON "WalletConnection"("address");

-- CreateIndex
CREATE INDEX "WalletConnection_isActive_idx" ON "WalletConnection"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- CreateIndex
CREATE INDEX "FeatureFlag_key_idx" ON "FeatureFlag"("key");

-- CreateIndex
CREATE INDEX "Embedding_entityType_idx" ON "Embedding"("entityType");

-- CreateIndex
CREATE INDEX "Embedding_entityId_idx" ON "Embedding"("entityId");

-- CreateIndex
CREATE INDEX "KnowledgeGraph_subject_idx" ON "KnowledgeGraph"("subject");

-- CreateIndex
CREATE INDEX "KnowledgeGraph_predicate_idx" ON "KnowledgeGraph"("predicate");

-- CreateIndex
CREATE INDEX "DataSource_name_idx" ON "DataSource"("name");

-- CreateIndex
CREATE INDEX "DataSource_startedAt_idx" ON "DataSource"("startedAt");

-- CreateIndex
CREATE INDEX "ExchangeConnection_ownerId_idx" ON "ExchangeConnection"("ownerId");

-- CreateIndex
CREATE INDEX "ExchangeConnection_exchange_idx" ON "ExchangeConnection"("exchange");

-- CreateIndex
CREATE INDEX "ExchangeConnection_isActive_idx" ON "ExchangeConnection"("isActive");

-- CreateIndex
CREATE INDEX "WatchlistToken_symbol_idx" ON "WatchlistToken"("symbol");

-- CreateIndex
CREATE INDEX "WatchlistToken_enabled_idx" ON "WatchlistToken"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "SourceHealth_source_key" ON "SourceHealth"("source");

-- CreateIndex
CREATE INDEX "SourceHealth_source_idx" ON "SourceHealth"("source");

-- CreateIndex
CREATE INDEX "StrategicCapability_status_idx" ON "StrategicCapability"("status");

-- CreateIndex
CREATE INDEX "StrategicCapability_category_idx" ON "StrategicCapability"("category");

-- CreateIndex
CREATE INDEX "FeeAuditLog_positionId_idx" ON "FeeAuditLog"("positionId");

-- CreateIndex
CREATE INDEX "FeeAuditLog_executedAt_idx" ON "FeeAuditLog"("executedAt");

-- CreateIndex
CREATE INDEX "FeeAuditLog_symbol_idx" ON "FeeAuditLog"("symbol");

-- CreateIndex
CREATE INDEX "PaperCycleAttempt_completedAt_idx" ON "PaperCycleAttempt"("completedAt");

-- CreateIndex
CREATE INDEX "PaperCycleAttempt_roundId_idx" ON "PaperCycleAttempt"("roundId");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletConnection" ADD CONSTRAINT "WalletConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeConnection" ADD CONSTRAINT "ExchangeConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

`;
