# CryptoBot Autonomous — Paper Trading Dashboard

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

# Iniciar dev server
bun run dev
# → http://localhost:3000
```

## Como usar

1. Abra o dashboard — DB é inicializado automaticamente na primeira visita (capital inicial $1000 paper)
2. Configure parâmetros na seção "Configuração da Engine" se quiser ajustar TP/SL/exposição
3. Clique **Iniciar** — engine começa o loop (intervalo default 60s)
4. Acompanhe posições abertas, scam audits e logs nas abas
5. Em emergência, clique **KILL SWITCH** — engine para e posições fecham no próximo tick
6. Após rounds completarem, reserve accumulation aparece no card "Reserva USDC (cold)"

## Estrutura do projeto

```
src/
├── app/
│   ├── page.tsx                       # Dashboard principal
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
│       └── initialize/                # POST: init DB singletons
├── lib/
│   ├── db.ts                          # Prisma client
│   └── trading/
│       ├── types.ts                   # Shared types
│       ├── config.ts                  # Config manager (wraps Prisma Config)
│       ├── logger.ts                  # AppLog persistence
│       ├── risk-manager.ts            # Circuit breakers
│       ├── scam-detector.ts           # 6 sub-scorers
│       ├── token-selector.ts          # CEX (Binance) + DEX (DexScreener)
│       ├── price-feed.ts              # Live price fetching
│       ├── paper-trader.ts            # Simulated order execution
│       ├── portfolio.ts               # Position lifecycle + 50/50 split
│       └── engine.ts                  # Main loop state machine
├── components/
│   └── dashboard/
│       ├── positions-table.tsx        # Open positions table
│       ├── history-table.tsx          # Closed positions table
│       ├── scam-reports.tsx           # Scam audit cards
│       ├── rounds-table.tsx           # Round history
│       ├── logs-feed.tsx              # Activity logs
│       └── config-editor.tsx          # Config form
└── hooks/
    └── use-trading-data.ts            # TanStack Query hooks

prisma/
└── schema.prisma                      # 8 models: Config, Position, Reserve,
                                        #   TradingBalance, RiskEvent, ScamReport,
                                        #   Round, AppLog

scripts/
└── reset-db.js                        # Reset DB for testing
```

## Limitações conhecidas do MVP

1. **Live trading NÃO implementado** — `liveBuy/liveSell` são stubs. Para produção, integrar CCXT (CEX) e ethers.js Uniswap V3 router (DEX). Vault/KMS para chave privada.
2. **Tax score é heurística** — taxa real de buy/sell requer simulação de swap via `eth_call` em RPC archive node. No MVP, usa score neutro.
3. **Honeypot check é indireto** — usa turnover 24h/liquidez como proxy. Honeypot detection real requer simulação local de swap (comprar → vender → ver se vende).
4. **Engine roda in-process** — sobrevive ao hot reload do Next.js dev, mas em produção precisa ser um worker separado (BullMQ + Redis ou processo Node standalone).
5. **Sem WebSocket** — dashboard usa polling (3-10s por endpoint). Para produção, adicionar socket.io para updates em tempo real.
6. **Sem autenticação** — dashboard é aberto. Para produção, adicionar NextAuth + role-based access.

## Roadmap para produção

- [ ] Worker separado para engine (BullMQ + Redis)
- [ ] Vault/KMS integration para chave privada (HashiCorp Vault dev mode em Docker)
- [ ] CCXT integration para live CEX orders (Binance)
- [ ] ethers.js Uniswap V3 router para live DEX orders (Base/Arbitrum/Optimism)
- [ ] Honeypot detection real via `eth_call` simulation em archive node
- [ ] Tax simulation via swap router static call
- [ ] WebSocket (socket.io) para real-time updates
- [ ] NextAuth + role-based access control
- [ ] Backtesting UI com dados históricos
- [ ] Alertas Telegram/Discord para eventos críticos

## Licença

MIT. Use por sua conta e risco. Sem garantias.
