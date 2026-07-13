---
Task ID: full-project
Agent: main
Task: Desenvolver app de trade autônoma de criptomoedas com scam detection, circuit breakers, split 50/50 de lucro, e paper trading como default.

Work Log:
- Carregado skill fullstack-dev e inicializado projeto Next.js 16 + TypeScript + Tailwind + shadcn/ui
- Discutido e renegotiated escopo com usuário: removido requisito "irrastreável" (incompatível com AML/KYC), trocado "100% seguro" por "scam-resistente"
- Confirmado escopo via AskUserQuestion: Ethereum L2s (Base/Arbitrum/Optimism) para DEX, Binance para CEX, volume+liquidez como critério de seleção, TP+SL fixo como saída, dashboard mínimo
- Atualizado Prisma schema com 8 models: Config, Position, Reserve, TradingBalance, RiskEvent, ScamReport, Round, AppLog
- Implementado engine TypeScript modular:
  - config.ts: Config manager com defaults seguros
  - logger.ts: Persistência em AppLog + console
  - risk-manager.ts: 5 circuit breakers (kill switch, daily loss, per-trade loss, exposure per token, drawdown)
  - scam-detector.ts: 6 sub-scorers (honeypot via turnover, liquidity, contract audit via Etherscan API, tax, holders, age) com weighted score 0-100
  - token-selector.ts: CEX (Binance REST direta, sem CCXT) + DEX (DexScreener)
  - price-feed.ts: Binance + DexScreener com cache 15s
  - paper-trader.ts: Simula ordens com slippage 0.3%
  - portfolio.ts: open/close position + rebalance 50/50 (50% USDC cold reserve, 50% reinvestido)
  - engine.ts: Loop state machine (SCOUT → ANALYZE → EXECUTE → MONITOR → EXIT → REBALANCE) com setInterval
- Construído 11 API routes REST: status, positions, history, logs, config, engine/start, engine/stop, kill-switch, reserve, scam-reports, rounds, initialize
- Construído dashboard Next.js com 6 componentes: positions-table, history-table, scam-reports, rounds-table, logs-feed, config-editor
- Refatorado CEX adapter para usar Binance REST direta (removido CCXT devido a protobufjs/Turbopack issue)
- Corrigido 3 bugs críticos no risk manager:
  1. perToken allocation não capped por maxExposurePerTokenPct
  2. maxPerTokenUsd calculado contra current balance (caía quando posições abriam) → mudado para peak balance
  3. Drawdown calculado contra current balance (caía quando capital alocado) → mudado para realized P&L
- Verificado via Agent Browser:
  - Dashboard renderiza corretamente com todos os componentes
  - Engine inicia/para via botão
  - 6 posições abertas simultaneamente (BTC, ETH, SOL, BNB, XRP, ARB)
  - Scam Audit tab mostra breakdown completo do ARB com 6 sub-scores
  - Kill switch ativa via API e mostra banner vermelho
  - Rounds tab mostra histórico com P&L
  - Logs tab mostra feed em tempo real
- Screenshots salvos em /home/z/my-project/download/dashboard-*.png
- README.md escrito com arquitetura, roadmap, limitações e disclaimer de risco

Stage Summary:
- Sistema funcional de trade autônomo em paper mode
- 6 posições abertas em round de teste (capital $1000 → $900 alocado, $100 restante)
- Scam detection multicamada operacional (ARB score 75/100 com sub-scores detalhados)
- Circuit breakers validados (kill switch testado via API)
- Split 50/50 implementado (aguardando rounds fecharem para ver reserva acumular)
- Live trading é stub — para produção precisa Vault/KMS + CCXT/ethers.js integration
- Dev server em /home/z/my-project rodando na porta 3000
- 8 screenshots do dashboard em /home/z/my-project/download/
- README em /home/z/my-project/README.md
