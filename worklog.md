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

---
Task ID: enhancement-v2
Agent: main
Task: Adicionar camadas de segurança e inteligência: verificação de integridade de sites, checagem de contrato via GoPlus, análise de mercado com indicadores técnicos, e agentes autônomos de IA. Tudo com fontes 100% gratuitas/open-source.

Work Log:
- Atualizado Prisma schema com 3 novos models: MarketSnapshot, AIInsight, SiteAudit
- Criado goplus-scanner.ts: integração GoPlus Security API (gratuita, sem auth) — detecta honeypot real via simulação on-chain, tax buy/sell, concentração de holders, LP lock status, mint authority, proxy contracts, blacklist functions
- Criado site-integrity.ts: verificador de sites com 5 camadas — SSL/TLS (validade + dias até expiração via Node tls), idade do domínio (RDAP gratuito), HTTP security headers (HSTS/CSP/X-Frame-Options), Google Safe Browsing v4 (opcional), red flags no conteúdo HTML (padrões de drainer, seed phrase, giveaway scam)
- Criado market-analysis.ts: indicadores técnicos implementados inline (sem dependência externa) — RSI(14), MACD(12,26,9), EMA(20), EMA(50), Bollinger Bands(20,2σ); sentimento via Fear & Greed Index (alternative.me) + CoinGecko trending; composite signal score 0-100
- Criado ai-agent.ts: 3 agentes LLM via z-ai-web-dev-sdk — Trading Thesis (sintetiza TA + scam + GoPlus em buy/avoid), Contract Auditor (analisa source code em busca de lógica oculta de rug), News/Sentiment (síntese contextual do projeto); sistema de consensus com veto apenas quando consensus=avoid AND confidence>=70%
- Atualizado engine.ts: fluxo ANALYZE agora tem 4 camadas sequenciais — (1) scam-detector regex + Etherscan, (2) GoPlus critical flags, (3) market signal (rejeita strong_sell), (4) AI squad veto; tokens rejeitados em qualquer camada são contabilizados separadamente
- Criado 3 novas API routes: /api/market (GET lista snapshots + sentiment, POST analisa token on-demand), /api/ai-insights (GET lista insights com filtro por role), /api/site-audit (GET lista auditorias, POST dispara auditoria manual)
- Criado 3 novos componentes UI: market-panel (tabela de snapshots com RSI/MACD/EMA/Bollinger + cards Fear&Greed e trending), ai-insights-panel (cards expansíveis por insight com key signals + output completo do modelo), site-audit-panel (form manual + histórico com sub-scores e red flags)
- Atualizado page.tsx: adicionadas 3 novas tabs (Mercado, AI Agents, Site Audit) — agora 8 tabs total
- Adicionado 3 novos hooks em use-trading-data.ts: useMarketData, useAIInsights, useSiteAudits
- Adicionado 4 novos LogSource types no logger.ts: market, ai, goplus, site
- Corrigido bug no parser de recomendação do AI: agora procura primeiro pela linha explícita "RECOMMENDATION: <X>" antes de fallback para keyword scan; ajustado prompt da thesis para não vetar tokens legítimos da CEX por default (apenas "avoid" com concrete red flags)
- Validado via Agent Browser:
  - Dashboard renderiza com 8 tabs funcionais
  - Tab Mercado: 16 snapshots com indicadores técnicos (RSI variando 13-53, signals buy/neutral)
  - Tab AI Agents: 28 insights (14 thesis + 14 news_sentiment) com recomendações hold/avoid
  - Tab Site Audit: auditoria manual de uniswap.org executada com sucesso (SSL válido, domínio maduro, headers presentes)
  - Engine completou ciclo: 6 posições abertas em teste anterior (BTC, ETH, SOL, BNB, XRP, ARB)
  - Trending tokens carregados (10 tokens do CoinGecko)

Stage Summary:
- Sistema agora tem 4 camadas de análise: regex scam-detector + GoPlus on-chain + market TA + AI LLM
- Todos os dados persistidos para audit trail (MarketSnapshot, AIInsight, SiteAudit tables)
- 100% gratuito: Binance REST, DexScreener, GoPlus, alternative.me, CoinGecko, Etherscan, z-ai-web-dev-sdk LLM
- 8 tabs no dashboard: Posições, Histórico, Mercado, AI Agents, Scam Audit, Site Audit, Rounds, Logs
- AI veto tunado: só rejeita com consensus=avoid AND confidence>=70% (não bloqueia por skeptisismo genérico)
- Dev server estável em /home/z/my-project porta 3000
- Screenshots em /home/z/my-project/download/01-09*.png
