# Auto Trader — Autonomous Crypto Paper Trading

Sistema autônomo de trade de criptomoedas com **scam detection multicamada**, **circuit breakers**, e **split 50/50 de lucro** (50% para reserva cold em USDC, 50% reinvestido). Modo **paper trading** como default — live mode só libera após N ciclos paper lucrativos (graduação).

## ⚠️ Aviso de risco — leia antes de qualquer coisa

Este sistema **reduz** risco de scam e perdas, mas **não elimina**. Rug pulls sofisticados (honeypot com delayed re-lock, mint hidden in modifier, blacklist seletiva) podem passar pelas heurísticas automatizadas. Operações em capital real podem causar perda total. **Nunca invista mais do que pode perder.** Este código não é aconselhamento financeiro.

## Stack

- **Frontend**: Next.js 16 + TypeScript + Tailwind CSS + shadcn/ui
- **Database**: SQLite via Prisma ORM (`db/custom.db`)
- **Engine**: TypeScript in-process (singleton no Next.js dev server)
- **APIs externas 100% gratuitas**:
  - Binance public REST (`api.binance.com/api/v3`) — preços CEX
  - DexScreener (`api.dexscreener.com`) — candidatos + preços DEX
  - Arbiscan / Basescan / Optimistic Etherscan — contract source verification

## Arquitetura

```
┌──────────────────────────────────────────────────────────┐
│              Dashboard Next.js (porta 3000)              │
│  Saldo · Posições · P&L · Histórico · Scam Audit · Logs  │
│             Kill Switch · Config Editor                  │
└──────────────────────────┬───────────────────────────────┘
                           │ REST API (JSON)
┌──────────────────────────┴───────────────────────────────┐
│                Engine (TypeScript singleton)             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │   Loop   │→ │ Selector │→ │   Scam   │→ │  Risk    │ │
│  │  Engine  │  │ (CEX+DEX)│  │ Detector │  │ Manager  │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
│  ┌──────────────────────────────────────────────────────┐│
│  │    Portfolio Manager (open / close / rebalance 50/50)││
│  └──────────────────────────────────────────────────────┘│
│  ┌────────────────┐    ┌────────────────────────────────┐│
│  │ Paper Trader   │    │ SQLite via Prisma              ││
│  │ (simula ordem) │    │ (state + audit log)            ││
│  └────────────────┘    └────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

## Máquina de estados do loop

```
SCOUT → ANALYZE → EXECUTE → MONITOR → EXIT → REBALANCE → (loop)
```

1. **SCOUT** — `selectCandidates()` busca top N tokens por volume 24h (CEX via Binance + DEX via DexScreener)
2. **ANALYZE** — `analyzeToken()` roda 6 sub-scorers para cada candidato DEX (CEX bypass com score 100)
3. **EXECUTE** — `assessTradeRisk()` valida circuit breakers; `openPosition()` abre posição com TP/SL calculados
4. **MONITOR** — `fetchPricesBatch()` busca preços atuais; verifica TP/SL/timeout
5. **EXIT** — `closePosition()` fecha posição com reason (take_profit / stop_loss / timeout / kill_switch)
6. **REBALANCE** — `rebalanceRound()` quando round termina: 50% do lucro → USDC cold reserve, 50% fica em trading balance

## Scam Detection — 6 sub-scorers (DEX tokens)

| Sub-score | Peso | O que verifica |
|-----------|------|----------------|
| **Honeypot** | 0.30 | Turnover 24h/liquidez — se >= 1.0x, vende ativo (sells estão funcionando) |
| **Liquidity** | 0.20 | Liquidez >= $500k (excelente), $250k (boa), $100k (mínimo). Bonus se idade > 7d |
| **Contract** | 0.20 | Source code verificado no explorer. Penalidades: mint() exposta (-25), blacklist (-20), pause() (-15), proxy upgradeable (-20) |
| **Tax** | 0.10 | Taxa real requer simulação de swap (não executada no MVP) — score neutro |
| **Holder** | 0.10 | Holder count >= 1000 (excelente), 500 (bom), 100 (modesto), <100 (perigoso) |
| **Age** | 0.10 | Idade do token: >= 30d (maduro), 7d (jovem), 1d (alto risco), <1d (extremo) |

Score final = média ponderada. **Rejeita abaixo de 70** (configurável). CEX tokens (BTC, ETH, etc) recebem score 100 — listados em exchange regulada, isentos de checks de contrato.

## Circuit Breakers

| Breaker | Default | Ação |
|---------|---------|------|
| Kill switch (manual) | — | Para engine + força-fecho todas as posições no próximo tick |
| Perda diária máx | 10% | Bloqueia novos trades até próximo dia |
| Perda por trade máx | 5% | Pré-valida stop-loss antes de abrir |
| Exposição por token máx | 15% | Bloqueia novo trade se já exposto |
| Drawdown máx | 20% | Computado contra perdas realizadas (não capital alocado) |

## Loop de capital (regra 50/50)

```
Round 1: $1000 → 10 tokens × $100 cada
         ↓ (TP/SL/timeout fecha posições)
         P&L = $200 (exemplo)
         ↓
         Reserve += $100 (50% → USDC cold)
         Trading balance = $1050 + $100 = $1100 (50% reinvestido + capital original)
         ↓
Round 2: $1100 → 10 tokens × $110 cada
         ↓ ...
```

**Reserva só sai via saque manual explícito** no dashboard — nunca é auto-negociada.

## Graduação Paper → Live

- Default: 50 ciclos paper lucrativos requeridos
- Live mode requer `graduatedToLive = true`
- Switch no config editor fica desabilitado até atingir graduação
- Live mode NÃO está implementado no MVP (paper trader apenas) — `liveBuy/liveSell` são stubs que retornam erro

## Como rodar localmente

```bash
# Instalar dependências
bun install

# Push do schema Prisma → SQLite
bun run db:push

# Copiar variáveis de ambiente (opcional — tem defaults)
cp .env.example .env
# Edite .env se quiser configurar GOOGLE_SAFE_BROWSING_KEY, Etherscan keys, etc.

# Iniciar dev server
bun run dev
# → http://localhost:3000
```

## Variáveis de ambiente (todas opcionais)

O app funciona out-of-the-box com paper trading + APIs 100% gratuitas. As variáveis abaixo desbloqueiam camadas extras de segurança:

| Variável | Default | Descrição |
|----------|---------|-----------|
| `DATABASE_URL` | `file:.../db/custom.db` | Caminho do SQLite |
| `GOOGLE_SAFE_BROWSING_KEY` | (vazio) | Ativa 4ª camada do site-integrity (Google Safe Browsing v4). Qualquer Google API key serve. Free tier: 10k req/dia. |
| `ETHERSCAN_API_KEY` | (vazio) | Aumenta rate limit do contract source verification no Ethereum mainnet |
| `ARBISCAN_API_KEY` | (vazio) | Mesmo para Arbitrum |
| `BASESCAN_API_KEY` | (vazio) | Mesmo para Base |
| `OPTIMISM_ETHERSCAN_API_KEY` | (vazio) | Mesmo para Optimism |

Veja `.env.example` para referência.

## Como usar

1. Abra o dashboard — DB é inicializado automaticamente na primeira visita (capital inicial $1000 paper)
2. Configure parâmetros na seção "Configuração da Engine" se quiser ajustar TP/SL/exposição
3. Clique **Iniciar** — engine começa o loop (intervalo default 60s)
4. Acompanhe posições abertas, scam audits e logs nas abas
5. Em emergência, clique **KILL SWITCH** — engine para e posições fecham no próximo tick
6. Após rounds completarem, reserve accumulation aparece no card "Reserva USDC (cold)"

## Workflow autônomo completo

Cada tick do engine executa o pipeline de 7 passos pedido pelo usuário:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. PESQUISAR plataformas      → PLATFORM_REGISTRY (35 plataformas)     │
│  2. VERIFICAR integridade       → auditSite() em cada plataforma        │
│     └─ resultado: SiteAudit table, getApprovedPlatformIds() Set         │
│  3. IDENTIFICAR tokens em alta  → getRisingCandidates() (CoinGecko)     │
│     └─ merge com selectCandidates() (Binance + DexScreener)             │
│  4. PLATFORM GATE              → rejeita tokens de plataforma não-aprovada │
│  5. ANALISAR (4 camadas):                                                │
│     a. scam-detector (regex + Etherscan source)                         │
│     b. GoPlus (honeypot/tax/holders on-chain real)                      │
│     c. market-analysis (RSI/MACD/EMA/Bollinger + Fear&Greed)            │
│     d. AI agent squad (LLM thesis + news sentiment + contract audit)    │
│  6. EXECUTE                     → openPosition() com TP/SL/timeout      │
│  7. MONITOR + VIGILÂNCIA:                                                 │
│     a. mecânico: TP/SL/timeout                                           │
│     b. surveillance: 7 detectores (GoPlus re-scan, liquidity drain,     │
│        price dump, holder concentration, tax spike, price anomaly,      │
│        timeout approaching) — roda a cada 5min por posição              │
│     c. AI exit planner: hold/tighten_sl/raise_tp/scale_out/exit_now     │
│  8. REBALANCE                   → split 50/50 (50% reserve USDC, 50%    │
│                                  reinvestido) quando round fecha        │
└─────────────────────────────────────────────────────────────────────────┘
```

## Backtesting

Antes de ir para live trading, valide os thresholds da estratégia (TP/SL/RSI
entry/exit/max hold) rodando um backtest sobre candles históricos do Binance.

```bash
# API: POST /api/backtest
curl -X POST http://localhost:3000/api/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "symbols": ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
    "interval": "1h",
    "periodDays": 30,
    "initialCapitalUsd": 1000,
    "perTradeUsd": 150,
    "takeProfitPct": 0.05,
    "stopLossPct": 0.04,
    "maxHoldBars": 48,
    "rsiEntryMax": 70,
    "rsiExitMin": 75
  }'
```

**Estratégia simulada:**
1. Para cada candle (1h, 4h, ou 1d), calcula RSI(14)
2. Se RSI < `rsiEntryMax` e há cash disponível → abre LONG
3. Em candles subsequentes, checa 4 condições de saída em ordem:
   - TP: high ≥ entry × (1 + TP%) → win
   - SL: low ≤ entry × (1 − SL%) → loss
   - Timeout: bars held ≥ maxHoldBars → exit at close
   - RSI overbought: RSI ≥ `rsiExitMin` → exit at close

**Métricas calculadas:** total trades, win rate, profit factor, P&L total,
max drawdown, Sharpe ratio per trade, avg hold bars, best/worst trade,
equity curve (SVG no dashboard), per-symbol breakdown.

**Limitações:**
- Não modela fees/slippage (could add 0.1% per side)
- Não simula scam-filter (tokens históricos precisariam de GoPlus histórico)
- Apenas LONG positions (matches paper-trading engine)
- Múltiplas posições abertas simultâneas (até 1 por símbolo, conforme cash disponível)

**Dashboard → tab "Backtest"** tem form completo + lista de backtests recentes
+ detail card com equity curve SVG e tabela de trades.

## Estrutura do projeto

```
src/
├── app/
│   ├── page.tsx                       # Dashboard principal (11 tabs + AlertsToast SSE)
│   ├── layout.tsx                     # Root layout + Providers
│   ├── providers.tsx                  # QueryClient provider
│   └── api/                           # REST endpoints
│       ├── status/                    # GET: engine snapshot
│       ├── positions/                 # GET: open positions + live prices
│       ├── history/                   # GET: closed positions
│       ├── logs/                      # GET: recent app logs
│       ├── config/                    # GET/POST: read/update config
│       ├── engine/start/              # POST: start engine
│       ├── engine/stop/               # POST: stop engine
│       ├── kill-switch/               # POST: activate/deactivate
│       ├── reserve/                   # GET/POST: balance + manual withdraw
│       ├── scam-reports/              # GET: recent scam analyses
│       ├── rounds/                    # GET: round history
│       ├── market/                    # GET/POST: market snapshots + on-demand analysis
│       ├── ai-insights/               # GET: AI agent outputs
│       ├── site-audit/                # GET/POST: site integrity audits
│       ├── platforms/                 # GET/POST: platform scanner (37 curated)
│       ├── surveillance/              # GET/POST: position alerts + scan_now
│       ├── backtest/                  # GET/POST: backtest runner + history
│       ├── stream/                    # GET: SSE real-time event stream
│       └── initialize/                # POST: init DB singletons
├── lib/
│   ├── db.ts                          # Prisma client
│   └── trading/
│       ├── types.ts                   # Shared types (TokenCandidate.platformId)
│       ├── config.ts                  # Config manager (wraps Prisma Config)
│       ├── logger.ts                  # AppLog persistence (15 LogSources)
│       ├── risk-manager.ts            # Circuit breakers (5)
│       ├── scam-detector.ts           # 6 sub-scorers (regex + Etherscan)
│       ├── goplus-scanner.ts          # GoPlus Security API (honeypot/tax/holders)
│       ├── site-integrity.ts          # 5-layer site audit (SSL/RDAP/headers/SafeBrowsing/content) com WAF bypass
│       ├── platform-scanner.ts        # 37-platform registry + scanAll/getApprovedPlatformIds
│       ├── token-selector.ts          # CEX (Binance) + DEX (DexScreener) with platformId
│       ├── rising-tokens.ts           # CoinGecko trending + gainers discovery
│       ├── price-feed.ts              # Live price fetching (Binance + DexScreener)
│       ├── market-analysis.ts         # RSI/MACD/EMA/Bollinger + Fear&Greed
│       ├── ai-agent.ts                # LLM squad (thesis + news + contract audit)
│       ├── exit-planner.ts            # LLM risk advisor (hold/tighten/raise/scale/exit)
│       ├── position-surveillance.ts   # 7 risk detectors for open positions
│       ├── paper-trader.ts            # Simulated order execution
│       ├── portfolio.ts               # Position lifecycle + 50/50 split
│       ├── backtest.ts                # Backtesting engine (Binance klines, RSI strategy)
│       ├── event-bus.ts               # In-memory event bus singleton for SSE push
│       └── engine.ts                  # Main loop state machine (with platform gate)
├── components/
│   └── dashboard/
│       ├── positions-table.tsx        # Open positions table
│       ├── history-table.tsx          # Closed positions table
│       ├── scam-reports.tsx           # Scam audit cards
│       ├── rounds-table.tsx           # Round history
│       ├── logs-feed.tsx              # Activity logs
│       ├── config-editor.tsx          # Config form
│       ├── market-panel.tsx           # Technical indicators + sentiment
│       ├── ai-insights-panel.tsx      # AI agent outputs (4 roles)
│       ├── site-audit-panel.tsx       # Manual URL audit + history
│       ├── platform-scanner-panel.tsx # 37-platform scanner with re-audit button
│       ├── surveillance-panel.tsx     # Position alerts + scan_now button
│       ├── backtest-panel.tsx         # Backtest form + results + equity curve
│       ├── portfolio-summary-card.tsx # Consolidated 8-metric portfolio card
│       └── alerts-toast.tsx           # Real-time sticky toasts (SSE-driven)
└── hooks/
    ├── use-trading-data.ts            # TanStack Query hooks (13)
    └── use-event-stream.ts            # SSE singleton hook (shared EventSource)

prisma/
└── schema.prisma                      # 11 models: Config, Position, Reserve,
                                        #   TradingBalance, RiskEvent, ScamReport,
                                        #   Round, AppLog, MarketSnapshot, AIInsight,
                                        #   SiteAudit, PositionAlert, BacktestResult

scripts/
└── reset-db.js                        # Reset DB for testing
```

## Limitações conhecidas do MVP

1. **Live trading NÃO implementado** — `liveBuy/liveSell` são stubs. Para produção, integrar CCXT (CEX) e ethers.js Uniswap V3 router (DEX). Vault/KMS para chave privada.
2. **Tax score é heurística** — taxa real de buy/sell requer simulação de swap via `eth_call` em RPC archive node. No MVP, usa score neutro.
3. **Honeypot check é indireto** — usa turnover 24h/liquidez como proxy. Honeypot detection real requer simulação local de swap (comprar → vender → ver se vende).
4. **Engine roda in-process** — sobrevive ao hot reload do Next.js dev, mas em produção precisa ser um worker separado (BullMQ + Redis ou processo Node standalone).
5. **Sem autenticação** — dashboard é aberto. Para produção, adicionar NextAuth + role-based access.
6. **SSE é in-process** — funciona porque engine + API rodam no mesmo processo Next.js. Em produção com worker separado, trocar por Redis Pub/Sub → SSE bridge.
7. **Event bus não persiste** — reiniciar o processo Next.js limpa o ring buffer de eventos. Histórico completo continua em AppLog/PositionAlert/etc tables.

## Roadmap para produção

- [ ] Worker separado para engine (BullMQ + Redis) + Redis Pub/Sub → SSE bridge
- [ ] Vault/KMS integration para chave privada (HashiCorp Vault dev mode em Docker)
- [ ] CCXT integration para live CEX orders (Binance)
- [ ] ethers.js Uniswap V3 router para live DEX orders (Base/Arbitrum/Optimism)
- [ ] Honeypot detection real via `eth_call` simulation em archive node
- [ ] Tax simulation via swap router static call
- [x] ~~WebSocket (socket.io) para real-time updates~~ → feito via SSE (sem dependência extra)
- [x] ~~Backtesting UI com dados históricos~~ → feito (Binance klines + RSI strategy)
- [ ] NextAuth + role-based access control
- [ ] Alertas Telegram/Discord para eventos críticos (consumir do event-bus)

## Licença

MIT. Use por sua conta e risco. Sem garantias.
