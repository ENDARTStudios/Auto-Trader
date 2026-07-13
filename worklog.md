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

---
Task ID: enhancement-v3
Agent: main
Task: Implementar pipeline autônomo completo: descoberta de tokens em ascensão, vigilância contínua de posições abertas (re-scan GoPlus + liquidity drain + price anomaly + holder concentration), e exit planner com IA que decide hold/tighten_sl/raise_tp/scale_out/exit_now.

Work Log:
- Criado rising-tokens.ts: descoberta de tokens em ascensão via 4 fontes gratuitas — DexScreener boosted (deprecado, no-op graceful), DexScreener trending (deprecado, no-op graceful), CoinGecko /search/trending (15 tokens globais), CoinGecko /coins/markets top gainers (top 250 por market cap com >5% gain 24h e momentum 1h positivo). Composite rising score 0-100 baseado em price change 24h (35%) + 1h (15%) + volume log-scaled (20%) + trending rank (15%) + boosted bonus (5%) + txns log-scaled (10%). Função getRisingCandidates retorna TokenCandidate[] para injetar no pipeline analyze.
- Criado position-surveillance.ts: 7 detectores de risco emergente em posições abertas — goplus_critical_flag (re-scan GoPlus busca flags críticas novas), liquidity_drain (DEX liquidity <$50k = crítico), price_dump_velocity (>12% drop desde entrada mas ainda acima do SL = warning), price_anomaly (>10% drop em 1h via DexScreener OU >80% sells em 1h = warning/critical), holder_concentration (GoPlus finding com top holders >50%), tax_spike (GoPlus sell tax >10%), timeout_approaching (<30min até maxExitAt = info). Dedupe de alertas: não cria novo alerta do mesmo tipo se já existe um não-resolvido nos últimos 30min. Persiste em PositionAlert table.
- Criado exit-planner.ts: agente LLM (z-ai-web-dev-sdk) com role "risk_advisor" que recebe position metrics + surveillance alerts + market snapshot (RSI/MACD/Bollinger/Fear&Greed) e decide entre 5 ações: hold, tighten_sl, raise_tp, scale_out_50, exit_now. Output parseado via ACTION:/CONFIDENCE:/SUGGESTED_NEW_SL:/SUGGESTED_NEW_TP:/REASONING:/KEY SIGNALS:. Quick path: sem alertas → hold sem chamar LLM. Ações só executam se alertSeverity=critical OU confidence>=70%. Persiste como AIInsight (agentRole=risk_advisor) para audit trail.
- Atualizado Prisma schema com novo model PositionAlert (positionId, symbol, type, severity, message, context JSON, detectedAt, resolvedAt, resolution). Índices em positionId, severity, detectedAt, resolvedAt. db push + prisma generate executados com sucesso.
- Atualizado engine.ts SCOUT phase: agora faz Promise.all de selectCandidates (standard watchlist) + getRisingCandidates (rising tokens) e faz merge dedup por tokenId/symbol preferindo rising (têm momentum). Log mostra composição "X rising + Y standard".
- Atualizado engine.ts monitorAndExit: agora tem 3 fases sequenciais — (1) mechanical exits TP/SL/timeout + resolveAlertsForPosition, (2) surveillance run a cada 5min (throttle para não queimar GoPlus/DexScreener API), (3) AI exit planner apenas para posições com alertas ativos. Exit planner pode fechar posição com reason="manual" (logged como AI-driven exit) ou atualizar TP/SL in-place.
- Atualizado forceExitAll para resolver alerts de todas as posições fechadas pelo kill switch.
- Criado API route /api/surveillance: GET retorna alerts recentes + counts por severity para badge do dashboard. POST com action=scan_now dispara surveillance imediato em todas as posições abertas (bypassa 5min throttle). POST com action=resolve resolve manualmente alertas de uma positionId.
- Adicionado hook useSurveillance(limit, onlyOpen) em use-trading-data.ts com refetch 5s. Tipos AlertType, AlertSeverity, SurveillanceAlertRow, SurveillanceData exportados.
- Criado componente SurveillancePanel em src/components/dashboard/surveillance-panel.tsx: 4 stat cards (Críticos/Avisos/Informativos/Total ativos), botão "Scan agora" que chama POST /api/surveillance, lista scrollável de alertas com ícone por tipo (ShieldAlert/Droplets/TrendingDown/Users/Percent/Clock/Bug), badge de severity colorido, expandable contexto JSON, badge de resolução quando resolvido, timeAgo em PT-BR.
- Atualizado page.tsx: adicionado import useSurveillance + SurveillancePanel + ShieldAlert icon, declarado hook surveillance, adicionado 9º TabsTrigger "Vigilância" com badge dinâmico mostrando count de alertas ativos, adicionado TabsContent com SurveillancePanel. TabsList agora grid-cols-9.
- Adicionado 3 novos LogSource no logger.ts: surveillance, exit_planner, rising, scout.
- Validado via Agent Browser:
  - Dashboard renderiza com 9 tabs (Posições, Histórico, Mercado, AI Agents, Scam Audit, Site Audit, Vigilância, Rounds, Logs)
  - Tab Vigilância mostra 4 stat cards zerados + mensagem "Nenhum alerta de vigilância ativo. Posições sob controle." + botão "Scan agora"
  - Botão "Scan agora" executa POST /api/surveillance com action=scan_now — retorna "Scan executado: 0 alerta(s) em 6 posições"
  - Engine iniciada: 6 posições abertas (BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, XRP/USDT, ARB) com $150 cada, $100 restantes
  - Round 13 criado, candidates: 7 (1 rising + 6 standard) — rising token da CoinGecko trending foi injetado no pipeline
  - AI insights: 5 insights persistidos (thesis + news_sentiment) com recomendações hold e confidence 75-85%
  - GoPlus re-scan funcionando para ARB (DEX token, score 50, liquidity $3.8M)
  - CEX tokens (BTC, ETH, SOL, BNB, XRP) corretamente não passam por GoPlus (apenas DEX)

Stage Summary:
- Pipeline autônomo completo: SCOUT (rising + standard) → ANALYZE (4-layer scam/GoPlus/market/AI) → EXECUTE → MONITOR (mecânico TP/SL/timeout + surveillance + AI exit planner) → EXIT → REBALANCE
- 100% gratuito: Binance REST, DexScreener, CoinGecko trending+markets, GoPlus, alternative.me, z-ai-web-dev-sdk LLM
- Vigilância contínua: 7 detectores de risco emergente rodando a cada 5min em todas as posições abertas
- Exit planner IA: decide hold/tighten_sl/raise_tp/scale_out/exit_now baseado em alerts + market snapshot, só executa com confiança alta (>=70%) ou severidade crítica
- 9 tabs no dashboard (adicionado Vigilância com badge dinâmico de alertas ativos)
- 6 screenshots em /home/z/my-project/download/: vigilancia-tab.png, vigilancia-after-scan.png, vigilancia-final.png, dashboard-full-v3.png, dashboard-final-v3.png, mercado-tab.png, ai-agents-tab.png
- Dev server estável em /home/z/my-project porta 3000
- TypeScript compila sem erros
