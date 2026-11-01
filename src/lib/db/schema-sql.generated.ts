// GERADO AUTOMATICAMENTE por scripts/gen-schema-sql.mjs — não editar à mão.
// Fonte: prisma/schema.prisma (prisma migrate diff --from-empty --to-schema).
// Consumido por src/lib/db-init.ts para auto-inicializar bancos SQLite vazios
// em ambientes efêmeros (ex.: Vercel serverless).
export const SCHEMA_SQL = `-- CreateTable
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
    "maxPositionsPerSymbol" INTEGER NOT NULL DEFAULT 2,
    "maxPositionsPerChain" INTEGER NOT NULL DEFAULT 5,
    "maxPositionsPerStrategy" INTEGER NOT NULL DEFAULT 5,
    "enabledStrategies" TEXT NOT NULL DEFAULT '["scalp","day","swing"]',
    "feeBps" REAL NOT NULL DEFAULT 10.0,
    "slippageBps" REAL NOT NULL DEFAULT 30.0,
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
    "strategy" TEXT NOT NULL DEFAULT 'day',
    "ownerId" TEXT NOT NULL,
    "roundId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Position_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "ownerId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "throttleSec" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationChannel_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "lastLoginAt" DATETIME,
    "onboardedAt" DATETIME,
    "preferences" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "ip" TEXT,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPct" INTEGER NOT NULL DEFAULT 100,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Embedding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "embedding" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "KnowledgeGraph" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subject" TEXT NOT NULL,
    "predicate" TEXT NOT NULL,
    "object" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1.0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "recordsCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ExchangeConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExchangeConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WatchlistToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "chain" TEXT,
    "tokenId" TEXT,
    "notes" TEXT,
    "alertThresholdPct" REAL NOT NULL DEFAULT 10.0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "addedPriceUsd" REAL,
    "lastPriceUsd" REAL,
    "lastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SourceHealth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "lastSuccessAt" DATETIME,
    "lastErrorAt" DATETIME,
    "lastErrorMsg" TEXT,
    "successCount24h" INTEGER NOT NULL DEFAULT 0,
    "errorCount24h" INTEGER NOT NULL DEFAULT 0,
    "rateLimited" BOOLEAN NOT NULL DEFAULT false,
    "rateLimitUntil" DATETIME,
    "windowStartedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowSuccessCount" INTEGER NOT NULL DEFAULT 0,
    "windowErrorCount" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "StrategicCapability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "completionPct" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ScoutSkipStat" (
    "reason" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastAt" DATETIME
);

-- CreateTable
CREATE TABLE "FeeAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "positionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "grossAmountUsd" REAL NOT NULL,
    "executedPriceUsd" REAL NOT NULL DEFAULT 0,
    "qty" REAL NOT NULL DEFAULT 0,
    "feeBps" REAL NOT NULL,
    "feeUsd" REAL NOT NULL,
    "slippageBps" REAL NOT NULL,
    "slippageUsd" REAL NOT NULL,
    "totalCostUsd" REAL NOT NULL,
    "netAmountUsd" REAL NOT NULL,
    "strategy" TEXT,
    "exchange" TEXT,
    "executedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PaperCycleAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roundId" INTEGER NOT NULL,
    "pnlUsd" REAL NOT NULL,
    "tokensScanned" INTEGER NOT NULL DEFAULT 0,
    "positionsOpened" INTEGER NOT NULL DEFAULT 0,
    "positionsClosed" INTEGER NOT NULL DEFAULT 0,
    "profitable" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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

`;
