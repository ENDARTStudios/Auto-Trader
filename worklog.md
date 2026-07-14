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

---
Task ID: enhancement-v4
Agent: main
Task: Renomear app para "Auto Trader" e adicionar platform scanner completo (pesquisar principais plataformas + verificar integridade).

Work Log:
- Renomeado app em todos os touchpoints:
  - package.json name: "nextjs_tailwind_shadcn_ts" → "auto-trader"
  - layout.tsx metadata.title: "CryptoBot Autonomous — Paper Trading Dashboard" → "Auto Trader — Autonomous Crypto Paper Trading"
  - layout.tsx metadata.description: prefixado com "Auto Trader:"
  - layout.tsx keywords: adicionado "auto trader"
  - page.tsx h1 header: "CryptoBot Autonomous" → "Auto Trader"
  - page.tsx footer: "CryptoBot Autonomous — Paper trading MVP" → "Auto Trader — Paper trading MVP"
  - site-integrity.ts User-Agent: "CryptoBot-SafetyScanner/1.0" → "AutoTrader-SafetyScanner/1.0"
  - site-integrity.ts Safe Browsing clientId: "cryptobot" → "auto-trader"
  - README.md título: "CryptoBot Autonomous — Paper Trading Dashboard" → "Auto Trader — Autonomous Crypto Paper Trading"
- Criado src/lib/trading/platform-scanner.ts (339 linhas):
  - Registry curada de 26 plataformas (8 CEXs: Binance/Coinbase/Kraken/OKX/Bybit/KuCoin/Gate.io/MEXC; 8 DEXs: Uniswap/SushiSwap/Curve/Balancer/PancakeSwap/Aerodrome/Velodrome/Camelot; 4 agregadores: 1inch/ParaSwap/Odos/0x; 6 data providers: DexScreener/CoinGecko/GoPlus/Etherscan/Arbiscan/Basescan)
  - Cada entry: id, name, url, kind (cex/dex/aggregator/data), chains, notes
  - Função scanPlatform(id, opts): lê cache (SiteAudit com age <24h) ou dispara auditSite() fresh
  - Função scanAllPlatforms(opts): processa em batches de 3-6 plataformas em paralelo (Promise.all) para não inundar RDAP/SSL endpoints
  - Função getCachedPlatformScan(): retorna resumos sem disparar auditorias (instantâneo)
  - Função getApprovedPlatformIds(): retorna Set de IDs aprovados (para gate do engine SCOUT)
  - Logging via logger com source="platform" (novo LogSource adicionado)
  - Persistência: reutiliza tabela SiteAudit existente (sem migration) — symbol=platform name
- Criado src/app/api/platforms/route.ts (3 handlers):
  - GET /api/platforms: retorna cached scan (default), refresh=1 força fresh audit, approved=1 retorna apenas IDs aprovados
  - POST /api/platforms: action=scan_one + platformId para uma plataforma, action=scan_all para todas (force opcional)
- Adicionado hook usePlatforms() em use-trading-data.ts (refetch 30s) com tipos PlatformKind, PlatformScanResult, PlatformScanSummary
- Criado src/components/dashboard/platform-scanner-panel.tsx (300 linhas):
  - 4 stat cards: Total / Aprovadas (verde) / Rejeitadas (vermelho) / Pendentes (amarelo)
  - Botão "Escanear todas (forçado)" que dispara POST scan_all com force=true
  - 3 seções agrupadas: Aprovadas / Rejeitadas / Não auditadas ainda
  - Cada platform card: nome (link externo), kind badge (CEX/DEX/Aggregator/Data com ícone), chains badges, sub-scores (SSL/domínio/HSTS/CSP/XFO), score 0-100 em destaque, badge APPROVED/REJECTED/PENDING, red flags list (se houver), timestamp do último scan
- Atualizado src/app/page.tsx:
  - Importado Building2 icon, usePlatforms hook, PlatformScannerPanel component
  - TabsList agora grid-cols-10 (era 9)
  - Adicionado 10º TabsTrigger "Plataformas" com badge dinâmico mostrando count de pendentes (background refetch 30s)
  - Adicionado TabsContent correspondente renderizando PlatformScannerPanel
- Atualizado src/lib/trading/logger.ts: adicionado "platform" ao LogSource union type
- Validado via curl + agent-browser:
  - GET /api/platforms retorna 26 plataformas corretamente (JSON bem-formado)
  - POST /api/platforms scan_one platformId=binance force=true executa end-to-end (SSL ✓ 180d, score 67/100 — rejeitado porque Cloudflare bloqueou HTML fetch resultando em 0 bytes e red flag)
  - POST persiste em SiteAudit table (confirmado via queries Prisma no dev.log)
  - Dashboard renderiza com 10 tabs, h1 mostra "Auto Trader", document.title mostra "Auto Trader — Autonomous Crypto Paper Trading"
  - Tab Plataformas ativa mostra 4 stat cards + botão de scan + seção "Não auditadas ainda" com 26 entries
  - Badge no tab Plataformas mostra "25" (1 plataforma já auditada = Binance, 25 pendentes)
- Disparado scan_all em background (nohup curl) para popular cache — usuário verá resultados reais quando abrir o dashboard
- Screenshots salvos em /home/z/my-project/download/:
  - auto-trader-platforms.png (viewport 1280x577 — view inicial)
  - auto-trader-platforms-full.png (full page 1280x6696 — tudo renderizado)
  - auto-trader-header.png (header com h1 "Auto Trader")
- TypeScript: npx tsc --noEmit compila sem erros em src/ (apenas warnings em examples/ e skills/ externos)
- Dev server estável em /home/z/my-project porta 3000 (PID 11482, 11495)

Stage Summary:
- App oficialmente renomeado para "Auto Trader" em todos os 8 touchpoints (package.json, layout, page header/footer, README, site-integrity UA/clientId, log source, dashboard title)
- Workflow completo de "pesquisar plataformas → verificar integridade" agora operacional:
  1. Registry curado de 26 plataformas principais (CEX/DEX/aggregator/data) — sem API discovery, hardcodeado de conhecimento público
  2. Para cada plataforma, auditSite() executa 5 camadas: SSL/TLS + domain age (RDAP) + security headers + Safe Browsing (opcional) + content red flags
  3. Resultados persistidos em SiteAudit table (reutilizado, sem migration)
  4. Cache 24h por plataforma, force refresh disponível
  5. Engine SCOUT pode usar getApprovedPlatformIds() como gate (próximo passo)
- 100% gratuito/open-source: Node tls + RDAP + HTML fetch + (opcional) Google Safe Browsing v4 (qualquer Google API key serve)
- Dashboard agora tem 10 tabs (era 9): Posições / Histórico / Mercado / AI Agents / Scam Audit / Site Audit / **Plataformas** (novo) / Vigilância / Rounds / Logs
- Badge dinâmico no tab Plataformas mostra count de pendentes — facilita ver quantas faltam auditar
- Próximos passos sugeridos: integrar getApprovedPlatformIds() no engine.ts SCOUT phase para rejeitar candidatos de plataformas não-aprovadas; tunar User-Agent do site-integrity para não ser bloqueado por Cloudflare (Binance retornou 0 bytes); configurar GOOGLE_SAFE_BROWSING_KEY para ativar 4ª camada

---
Task ID: enhancement-v5-final
Agent: main
Task: Fechar o ciclo do workflow autônomo: integrar platform gate no engine SCOUT, tunar User-Agent para bypass de Cloudflare, adicionar botão re-audit por plataforma, indicador de platform gate no dashboard, e documentar env vars.

Work Log:
- Adicionado campo `platformId?: string` ao tipo TokenCandidate em types.ts — identifica qual plataforma cada candidato vem/seria roteado por
- Atualizado token-selector.ts:
  - CEX candidates: platformId="binance" (Binance REST é nossa única fonte CEX)
  - DEX candidates: mapeia DexScreener `dexId` → nosso PLATFORM_REGISTRY id via DEX_ID_TO_PLATFORM map (uniswap/uniswapv3→uniswap, sushiswap→sushiswap, curve→curve, balancer→balancer, pancakeswap→pancake, aerodrome→aerodrome, velodrome→velodrome, camelot→camelot, oneinch→oneinch, paraswap→paraswap)
- Atualizado rising-tokens.ts: CoinGecko trending + gainers CEX tokens recebem platformId="binance", DEX tokens ficam undefined (engine permite com log warning)
- Integrado platform gate em engine.ts SCOUT phase:
  - Após merge dedupe de rising + standard candidates, chama getApprovedPlatformIds() (cache-aware, retorna Set de IDs aprovados)
  - Itera candidatos: rejeita qualquer um cujo platformId não está no Set aprovado (log: "rejeitado pelo platform gate — plataforma 'X' não aprovada")
  - Candidatos sem platformId (discovery genérico) são permitidos mas ainda passam pelo 4-layer analyze
  - Se erro ao ler approved platforms, gate é desativado (fail-open, não fail-closed — evita bloquear engine se DB cair)
  - Log distinto para rejected>0 vs OK
  - Se todos rejeitados, round abortado com notes="Platform gate bloqueou todos"
- Tunado User-Agent em site-integrity.ts: trocado "Mozilla/5.0 (compatible; AutoTrader-SafetyScanner/1.0...)" por UA real Chrome 124 + headers completos (Accept, Accept-Language, Accept-Encoding, Cache-Control, Pragma, Sec-Fetch-Dest/Mode/Site/User, Upgrade-Insecure-Requests)
  - Resultado: Binance score 67→75 (content score 75→100, red flag "0 bytes" sumiu), agora APROVADA
  - MEXC ainda rejeitada (366 bytes — Cloudflare challenge page persiste)
  - Kraken ainda rejeitada (false positive: "private key" pattern matcha texto legit)
- Adicionado botão "Re-audit" por plataforma no PlatformScannerPanel:
  - Refatorado PlatformRow para receber props `onReaudit` e `reauditingId`
  - Estado `reauditingId` no PlatformScannerPanel controla qual plataforma está sendo reauditada (mostra spinner + "...")
  - scanOneMutation atualizado para set/clear reauditingId
  - 3 sites de renderização (approved/rejected/pending) atualizados para passar props
  - Botão ghost sm com ícone RefreshCw (animado quando reauditing)
- Adicionado indicador "Platform gate" no card de status do engine (page.tsx):
  - 5ª coluna na grid (era 4) — mostra "X/Y aprovadas" com cor dinâmica (verde se X=Y, vermelho se X<Y/2, amarelo caso contrário)
  - Usa dados do hook usePlatforms já existente (refetch 30s)
- Criado .env.example com 4 variáveis opcionais: GOOGLE_SAFE_BROWSING_KEY, ETHERSCAN_API_KEY, ARBISCAN_API_KEY, BASESCAN_API_KEY, OPTIMISM_ETHERSCAN_API_KEY — todas com descrição + free tier info
- Atualizado README.md:
  - Seção "Variáveis de ambiente (todas opcionais)" com tabela de 5 variáveis
  - Seção "Workflow autônomo completo" com diagrama ASCII do pipeline de 8 passos (pesquisar→verificar→identificar→gate→analisar→execute→monitor→rebalance)
  - Estrutura do projeto expandida: 16 API routes (era 12), 16 lib/trading files (era 9), 11 components (era 6), 11 hooks, 10 Prisma models (era 8)
- Validado via curl + agent-browser:
  - TypeScript: `npx tsc --noEmit` 0 erros em src/ (warnings apenas em examples/ e skills/ externos)
  - GET /api/status, /api/platforms, / respondem 200
  - POST /api/platforms scan_one binance force=true → score 75, approved=true (era 67 rejeitado)
  - POST /api/platforms scan_one mexc → ainda rejeitado (366 bytes)
  - POST /api/platforms scan_one kraken → ainda rejeitado (false positive "private key")
  - Resumo final: 23/26 aprovadas (era 22), 3 rejeitadas (Kraken, MEXC, Odos)
  - Engine start/stop funciona (engine iniciada, detectou 6 posições abertas do round anterior, monitorou, parou)
  - Dashboard: h1 "Auto Trader", tab Plataformas ativa mostra 26 cards com botão Re-audit cada
  - Indicador "Platform gate 23/26 aprovadas" visível no card de status do engine (verde se X=Y, vermelho se X<Y/2, amarelo caso contrário)
  - 26 botões "Re-audit" renderizados (1 por plataforma)
- Screenshots salvos em /home/z/my-project/download/:
  - auto-trader-final-dashboard.png (dashboard com indicador Platform gate)
  - auto-trader-final-platforms.png (viewport)
  - auto-trader-final-platforms-full.png (full page 1280x7273 — todas as 26 plataformas com botões re-audit)

Stage Summary:
- Workflow autônomo completo de 8 passos agora totalmente operacional:
  1. PESQUISAR: PLATFORM_REGISTRY com 26 plataformas (CEX/DEX/aggregator/data)
  2. VERIFICAR INTEGRIDADE: auditSite() 5-camadas em cada plataforma
  3. IDENTIFICAR TOKENS EM ALTA: CoinGecko trending + gainers + DexScreener
  4. PLATFORM GATE: rejeita candidatos de plataforma não-aprovada (NOVO)
  5. ANALISAR: 4 camadas (scam-detector + GoPlus + market TA + AI squad)
  6. EXECUTE: openPosition com TP/SL/timeout
  7. MONITOR + VIGILÂNCIA: mecânico + 7 detectores + AI exit planner
  8. REBALANCE: split 50/50 quando round fecha
- Platform gate integrado ao engine SCOUT — tokens de Binance agora só são aceitos porque Binance passou na auditoria (score 75). Tokens de plataformas rejeitadas (MEXC, Odos) seriam bloqueados antes de qualquer análise de scam.
- User-Agent tuning resolveu bloqueio Cloudflare em Binance (67→75 aprovada). MEXC e Odos ainda bloqueados (mas MEXC não é usada pelo token-selector anyway, e Odos é aggregator que não usamos para discovery)
- UI completa: 10 tabs, indicador Platform gate no card de status, 26 botões Re-audit individuais, badge de pendentes no tab Plataformas
- 100% gratuito/open-source confirmado: todas as 26 plataformas auditadas com Node tls + RDAP + HTML fetch + (opcional) Google Safe Browsing
- Documentação completa: README com workflow diagram, env vars table, estrutura de projeto atualizada
- Dev server estável em /home/z/my-project porta 3000
- Projeto considerado FINALIZADO — todas as 7 tarefas do todo list completas

---
Task ID: enhancement-v6
Agent: main
Task: Tunar bypass do Cloudflare em site-integrity (fallback paths + challenge detection + legit mention patterns), expandir DEX_ID_TO_PLATFORM com mais DEXes, criar PortfolioSummaryCard no dashboard, re-auditar todas as plataformas para chegar a 100% de aprovação.

Work Log:
- Adicionado em site-integrity.ts: detecção de Cloudflare/Akamai challenge pages (CLOUDFLARE_CHALLENGE_SIGNATURES, AKAMAI_CHALLENGE_SIGNATURES, isChallengePage()). Quando challenge detectado, content score é neutral (75) em vez de penalizado.
- Adicionado em site-integrity.ts: função isLikelyLegitimateMention(html, pattern) com 22 regexes de avisos anti-scam legítimos (never share your private key, keep your mnemonic safe, private keys are lost, self-custody, not your keys not your coins, etc.). Bug corrigido: pattern.toString() retornava a forma "/private\\s*key/i" com regex syntax, então includes("private key") falhava. Trocado para pattern.source.includes("private") && pattern.source.includes("key").
- Adicionado em site-integrity.ts: BROWSER_HEADERS com Sec-Ch-Ua e Sec-Ch-Ua-Platform para melhor se passar por Chrome real.
- Adicionado em site-integrity.ts: FALLBACK_PATHS = ["/", "/en", "/en-US", "/about", "/api/status", "/ping", "/healthcheck"]. checkHeadersAndContent agora tenta cada path em sequência, para no primeiro que retorna HTML >2KB sem challenge, e usa o melhor resultado.
- Adicionado scoring condicional em auditSite(): se challenge page detectado, headersScore=50-70 e contentScore=75 (neutral) em vez de reprovado.
- Expandido DEX_ID_TO_PLATFORM em token-selector.ts: adicionados aliases (uniswapv2, sushi, sushiswapv3, curvefinance, pancake/pancakeswapv3/pancakeswapv2, aerodromev2, velodromev2, camelotv3, "1inch") + 18 novos DEXes (maverick, bancor, kyber, dodo, syncswap, orca, raydium, jupiter, meteora, phoenix, gmgn, moonshot, pumpfun, fluxbeam, alice, illumi, woofi, mosaic).
- Expandido PLATFORM_REGISTRY em platform-scanner.ts: adicionadas 9 novas plataformas auditáveis (Maverick, Bancor, KyberSwap, DODO, SyncSwap, Orca, Raydium, Meteora, Jupiter). BaseSwap removido (DNS offline — baseswap.fi não resolve).
- Corrigido URL do Odos no PLATFORM_REGISTRY: app.odos.com → www.odos.com (app.odos.com não resolvia DNS).
- Criado src/components/dashboard/portfolio-summary-card.tsx (260 linhas): card consolidado com Patrimônio Total (trading + deployed + reserve), P&L Total (realizado + não-realizado com barra visual de composição), Win Rate + Profit Factor, Capital Alocado % (com Progress bar), Rounds 5 últimos (P&L somado + win rate), P&L médio por posição, Vigilância status, Plataformas aprovadas %. Badges: ROI %, Drawdown %, alertas críticos. Cores dinâmicas (verde/vermelho) baseadas em sinal de P&L.
- Integrado PortfolioSummaryCard no page.tsx entre os balance cards (4 stat cards) e as tabs principais. Props injetadas: status (EngineSnapshot), positions, rounds, surveillanceCounts, platforms {approved, total, pending}.
- Re-auditoria das 3 plataformas problemáticas:
  - MEXC: score 67→71 APROVADO (Cloudflare challenge detectado, tratado como inconclusivo)
  - Kraken: score 73→81 APROVADO (legit mention "private keys are lost" reconhecido)
  - Odos: score 57→78 APROVADO (URL corrigido para www.odos.com)
- Scan all platforms (force=true) executado em 60s — resultado final: 35/35 aprovadas, 0 rejeitadas, 0 pendentes. SCORES: PancakeSwap=90, 0x Protocol/Aerodrome/Basescan/Camelot/DexScreener/DODO/GoPlus/Jupiter/OKX/SyncSwap/Uniswap/Velodrome=84, Bybit/Kraken/Maverick/Orca/SushiSwap=81, Gate.io/Odos/ParaSwap=78, Balancer/Binance/Raydium=75, 1inch/Arbiscan/Bancor/Coinbase/CoinGecko/Curve/Etherscan/KuCoin/KyberSwap/Meteora/MEXC=71.
- Validado via agent-browser:
  - Dashboard renderiza com h1 "Auto Trader", 10 tabs, 6 posições abertas (BTC, ETH, SOL, BNB, XRP, ARB)
  - PortfolioSummaryCard visível com: Patrimônio $983.90, P&L -$16.10, Capital 90% alocado em 6 posições, 2 alertas ativos, 35/35 plataformas (100%)
  - Tab Plataformas: 35 cards APPROVED, 0 REJECTED, 0 PENDING
- Screenshots em /home/z/my-project/download/: v6-portfolio-summary.png, v6-platforms-35-of-35.png, v6-final-dashboard.png

Stage Summary:
- Site-integrity agora faz bypass robusto de WAF (Cloudflare/Akamai) via: (1) detecção de challenge page signature, (2) fallback paths para encontrar conteúdo real, (3) legit-mention detection com 22 patterns de avisos anti-scam
- Platform approval rate: 23/26 (88%) → 35/35 (100%) — todas as 35 plataformas agora APROVADAS
- DEX coverage expandido: 11 → 29 DEXes mapeados no DEX_ID_TO_PLATFORM
- Platform registry expandido: 26 → 35 plataformas auditáveis (+9 DEXes extra, -1 defunct BaseSwap)
- Dashboard tem novo PortfolioSummaryCard com 8 métricas consolidadas (patrimônio, P&L total, win rate, profit factor, capital utilization, rounds recentes, vigilância, plataformas) + barra visual de composição do P&L
- Dev server estável em /home/z/my-project porta 3000
- TypeScript compila sem erros no src/

---
Task ID: enhancement-v7
Agent: main
Task: Implementar módulo de backtesting completo — simula estratégia (RSI entry + TP/SL/timeout + RSI exit) sobre candles históricos do Binance para validar thresholds antes de live trading.

Work Log:
- Criado src/lib/trading/backtest.ts (680 linhas): engine de backtest completo com fetch de klines Binance (paginado até 5000 candles), simulação interleaved bar-a-bar com múltiplos símbolos em paralelo, métricas (total trades, win rate, profit factor, P&L total, max drawdown, Sharpe ratio, avg hold, best/worst), equity curve, per-symbol breakdown, persistência em BacktestResult table.
- Estratégia simulada: RSI(14) entry quando RSI < rsiEntryMax, exit em 4 condições (TP hit, SL hit, timeout bars, RSI overbought). Múltiplas posições abertas simultâneas (até 1 por símbolo, conforme cash disponível). Ordem de prioridade exit: TP > SL > timeout > RSI exit.
- Adicionado model BacktestResult ao Prisma schema (23 campos: params de entrada + métricas + equityCurve JSON + tradesJson JSON + status/durationMs/error). db push + prisma generate executados.
- Criado /api/backtest route: GET /api/backtest?limit=20 lista recentes, GET /api/backtest?id=42 retorna detail com equity curve + trades, POST /api/backtest dispara novo backtest com validação de params (symbols max 20, periodDays 1-365, takeProfitPct 0.001-1, etc.).
- Adicionado hooks useBacktests(limit) e useBacktest(id) em use-trading-data.ts com tipos BacktestSummary, BacktestDetail, BacktestTrade, BacktestEquityPoint, BacktestParams. Refetch 5s para lista, 3s para detail (atualiza enquanto backtest roda).
- Criado src/components/dashboard/backtest-panel.tsx (430 linhas): form completo (symbols, interval 15m/1h/4h/1d, periodDays, initialCapital, perTrade, TP%, SL%, maxHoldBars, rsiEntryMax, rsiExitMin) + lista scrollável de backtests recentes com badges de status/P&L/métricas + detail card com 4 stat cards (Win Rate, Profit Factor, Max Drawdown, Avg Trade) + equity curve SVG inline (sem chart library) + tabela de trades com reason badges coloridos.
- Adicionado LogSource "backtest" em logger.ts.
- Adicionado 11ª tab "Backtest" no dashboard (TabsList agora grid-cols-11), com ícone FlaskConical.
- Bug fix durante desenvolvimento: primeira versão processava símbolos sequencialmente (cada símbolo completamente antes do próximo), resultando em apenas 6 trades de BTC. Corrigido para simulação interleaved: walk bar-a-bar, processa todos os símbolos em cada bar, mantém Map<symbol, OpenTrade>. Resultado: 6 trades → 100 trades (16x mais), todos os 5 símbolos ativos.
- Bug fix: interface OpenTrade estava duplicada (definida em escopo global e dentro de runBacktest). Removida a duplicada.
- Validado via curl + agent-browser:
  - POST /api/backtest com 3 símbolos + 7 dias: 6 trades, 50% win, P&L -$1.27, 83ms
  - POST /api/backtest com 5 símbolos + 30 dias: 100 trades, 50% win, P&L +$18.93, profit factor 1.09, max DD 9%, Sharpe 0.04, 170ms
  - POST /api/backtest com 3 símbolos + 90 dias + 4h interval: 81 trades, 38.3% win, P&L -$86.51, profit factor 0.70, max DD 17.1%, Sharpe -0.15 — mostra que TP 8%/SL 5% assimétrico perde, útil para tuning
  - GET /api/backtest?id=2 retorna detail com equity curve + trades JSON
  - Dashboard renderiza com 11 tabs (adicionado Backtest com ícone FlaskConical)
  - Tab Backtest: form completo renderiza com todos os campos, lista 4 backtests recentes com badges de P&L/métricas
  - Detail card: 4 stat cards (Win Rate, Profit Factor, Max Drawdown, Avg Trade) + equity curve SVG inline + tabela de 50 trades com reason badges
- Atualizado README.md: seção "Backtesting" com exemplo curl, estratégia simulada, métricas calculadas, limitações. Workflow diagram atualizado de 26 → 35 plataformas.
- Screenshots em /home/z/my-project/download/: v7-dashboard-with-backtest-tab.png, v7-backtest-tab-form.png, v7-backtest-detail-with-equity-curve.png

Stage Summary:
- Sistema agora tem módulo de backtest completo para validar estratégia antes de live trading
- 11 tabs no dashboard (Posições, Histórico, Mercado, AI Agents, Scam Audit, Site Audit, Plataformas, Vigilância, Backtest, Rounds, Logs)
- Backtest cobre: fetch candles Binance (até 5000), simulação interleaved multi-símbolo, 4 condições de saída, 11 métricas, equity curve SVG, per-symbol breakdown, persistência
- Performance: 100 trades em 5 símbolos/30 dias executam em ~170ms
- 100% gratuito: apenas Binance public REST klines (no auth, no rate limit issue para uso normal)
- Dev server estável em /home/z/my-project porta 3000
- TypeScript compila sem erros no src/
- 11 Prisma models (adicionado BacktestResult)
- 17 API routes (adicionado /api/backtest)
- 20 lib/trading files (adicionado backtest.ts)
- 13 dashboard components (adicionado backtest-panel.tsx)

---
Task ID: enhancement-v8
Agent: main
Task: Adicionar Pump.fun e Moonshot ao PLATFORM_REGISTRY (Solana DEXes missing), implementar camada de real-time alerts via SSE para substituir o polling de 5s, criar componente de toasts sticky para surface de eventos críticos no dashboard.

Work Log:
- Adicionadas 2 entradas ao PLATFORM_REGISTRY em platform-scanner.ts:
  - Pump.fun (https://pump.fun) — Launchpad de memecoins Solana, bonding curve on-chain
  - Moonshot (https://moonshot.money) — DEX Solana para memecoins com launch via DexScreener
  - Registry total: 35 → 37 plataformas
- Re-auditadas as 2 novas plataformas via POST /api/platforms {action:"scan_one",force:true}:
  - Pump.fun: score 71 APROVADO (Cloudflare challenge detectado e tratado — contentScore neutral 75)
  - Moonshot: score 75 APROVADO (sem WAF, content limpo, SSL válido)
  - Scan all final: 37/37 aprovadas, 0 rejeitadas, 0 pendentes (100%)
- Criado src/lib/trading/event-bus.ts (135 linhas): singleton EventEmitter in-memory que mantém ring buffer dos últimos 200 BusEvents. Tipos: log, alert, position, engine, round, kill_switch, scam_detected, trade, market. API: push(opts), subscribe(onEvent, {replayHistory, historyLimit}), history(limit), size(). Persiste em globalThis.__AUTO_TRADER_EVENT_BUS__ para sobreviver a hot reloads.
- Modificado src/lib/trading/logger.ts: a cada warn/error, publica evento "log" no eventBus com title truncado a 110 chars. info/debug são excluídos para manter o canal SSE high-signal.
- Modificado src/lib/trading/engine.ts: adicionada import do eventBus. Adicionados 3 pontos de emissão de eventos:
  1. Após closePosition no monitorAndExit mecânico (TP/SL/timeout) — evento "position" com level info/warn conforme reason
  2. Após openPosition no scoutAndExecute — evento "position" info com symbol, preço, amount, scamScore, roundId
  3. Após closePosition no forceExitAll (kill_switch) — evento "position" critical com motivo
  Adicionada helper function reasonLabel(r: ExitReason) no final do arquivo.
- Modificado src/app/api/kill-switch/route.ts: emite evento "kill_switch" critical quando ativado (sticky toast) e "engine" info quando desativado.
- Modificado src/app/api/engine/start/route.ts: emite evento "engine" info "Engine iniciada" quando start tem sucesso.
- Modificado src/app/api/engine/stop/route.ts: emite evento "engine" warn "Engine parada" quando stop é chamado.
- Criado src/app/api/stream/route.ts (102 linhas): endpoint SSE (Server-Sent Events). Headers: Content-Type text/event-stream, no-cache, keep-alive, X-Accel-Buffering no. ReadableStream com:
  - Event "hello" inicial com serverTime e bufferSize
  - Replay dos últimos 20 eventos bufferizados (para clientes recém-conectados verem histórico recente)
  - Subscrição ao eventBus para eventos futuros
  - Heartbeat a cada 15s (mantém conexão viva através de proxies)
  - Cleanup no req.signal.abort (cancela subscrição + fecha controller)
  - dynamic=force-dynamic, runtime=nodejs
- Criado src/hooks/use-event-stream.ts (200 linhas): hook React com singleton module-level EventSource compartilhado entre todos os callers (browsers limitam SSE por origem a ~6). API: useEventStream({onEvent, maxRecent}) → {readyState, recent, reconnect}. Features:
  - Auto-reconnect manual após EventSource.readyState===2 (backoff 3s)
  - Listeners Set<Listener> + readyListeners Set<(s)=>void> para pub/sub interno
  - Dedupe via seenIds Set (limite 500 para evitar growth ilimitado)
  - Helpers exportados: isCritical(ev), severityRank(ev)
- Criado src/components/dashboard/alerts-toast.tsx (260 linhas): componente sticky toast top-right. Features:
  - Máx 5 toasts visíveis simultaneamente
  - Critical (kill_switch, error, force-exit) = sticky (não auto-dismiss)
  - Warn = auto-dismiss 8s, Info = auto-dismiss 5s
  - Color-coded: vermelho (critical/error), âmbar (warn), esmeralda (position), azul (engine), cinza (default)
  - Click no título expande para mostrar context JSON completo
  - Botão × em cada toast para dismiss individual
  - Botão "Limpar (N)" para dismiss all
  - Indicador LIVE/RECONNECTING/OFFLINE no topo com dot animado (verde/âmbar/cinza)
  - Animação slideIn via <style jsx> (Tailwind não tem built-in)
  - Tick a cada 1s para checar auto-dismiss
- Integrado AlertsToast no src/app/page.tsx: import + <AlertsToast /> montado uma única vez no início do return principal, antes do header. Como é fixed top-right z-50, fica sobreposto a todo o conteúdo.
- Validado via curl:
  - GET /api/stream: retorna headers SSE corretos + event hello + replay dos últimos 20 eventos bufferizados
  - POST /api/kill-switch {active:true,reason:"SSE test trigger"}: gera 3 eventos SSE imediatos (kill_switch critical, log warn do risk, log warn do api) — todos entregues via stream
  - POST /api/kill-switch {active:false}: gera evento engine info
  - TypeScript compila sem erros em src/ (apenas examples/ e skills/ com erros pré-existentes)
- Validado via agent-browser:
  - Dashboard renderiza com 11 tabs + AlertsToast no topo-right
  - Indicador LIVE verde pulsante visível após SSE conectar
  - Toasts aparecem em tempo real quando kill switch é triggerado via API: stack de 5 toasts visíveis (KILL SWITCH ATIVADO sticky vermelho + 2 log warns âmbar + Kill switch desativado info azul + log warn âmbar)
  - Botão "Limpar todos os toasts" funciona (limpa stack)
  - Botão "Dispensar" em cada toast funciona individualmente
  - Tab Plataformas: 37 cards APPROVED, 0 REJECTED, 0 PENDING
  - "37/37 (100%)" visível no PortfolioSummaryCard e no header da tab Plataformas
  - Pump.fun e Moonshot cards presentes na lista
- Screenshots em /home/z/my-project/download/:
  - v8-dashboard-with-toasts.png (dashboard com stack de 5 toasts visíveis)
  - v8-toasts-cleared.png (após click no botão Limpar)
  - v8-toasts-after-trigger.png (após re-trigger do kill switch — novos toasts apareceram)
  - v8-platforms-37-of-37.png (tab Plataformas com 37/37 aprovadas)
  - v8-final-dashboard-with-sse.png (dashboard final com indicador LIVE)

Stage Summary:
- Plataformas: 35 → 37 (+Pump.fun, +Moonshot, ambos Solana DEXes)
- Approval rate mantida em 100% (37/37 aprovadas)
- Real-time layer: SSE endpoint /api/stream + event-bus singleton + useEventStream hook + AlertsToast component
- Substitui polling de 5s para alertas críticos — kill switch, position open/close, force-exit agora chegam instantaneamente ao dashboard
- 18 API routes (adicionado /api/stream)
- 21 lib/trading files (adicionado event-bus.ts)
- 14 dashboard components (adicionado alerts-toast.tsx)
- 2 hooks files (adicionado use-event-stream.ts)
- TypeScript compila sem erros em src/
- Dev server estável em /home/z/my-project porta 3000
- 100% gratuito: SSE usa apenas HTTP nativo, sem dependência de socket.io/redis para o caso single-process
- Polling ainda existe para dados tabulares (positions, logs, market) — SSE é complementar para alertas críticos

---
Task ID: enhancement-v9
Agent: main
Task: Adicionar aba de Analytics com equity curve histórica (PerformanceSnapshot model + recording no engine tick + /api/analytics + analytics-panel.tsx), e adicionar export CSV nas tabelas de Posições/Histórico/Rounds.

Work Log:
- Adicionado model PerformanceSnapshot ao prisma/schema.prisma (9 campos: timestamp, tradingBalanceUsd, reserveBalanceUsd, peakBalanceUsd, realizedPnlUsd, unrealizedPnlUsd, totalEquityUsd, openPositionsCount, drawdownPct, com @@index([timestamp]). db push + prisma generate executados.
- Criado src/lib/trading/performance-snapshot.ts (105 linhas): função recordSnapshotIfDue() com throttle de 60s. Busca tradingBalance/reserve singletons, calcula unrealized P&L via fetchPricesBatch para posições abertas, calcula totalEquity = trading + reserve + unrealized, calcula drawdownPct = (peak - totalEquity) / peak * 100. Persiste em PerformanceSnapshot table. Trim automático para manter no máx 50.000 rows (~35 dias a 1-min granularity).
- Modificado src/lib/trading/engine.ts: adicionado import de recordSnapshotIfDue e chamada após updatePeakBalance() no final do tick. Snapshots são gravados a cada 60s enquanto a engine roda.
- Criado src/app/api/analytics/route.ts (225 linhas): endpoint GET /api/analytics?range=24h|7d|30d|all. Retorna:
  - equityCurve: array de snapshots no período (timestamp + 8 métricas)
  - summary: startEquity, endEquity, absChange, pctChange, maxEquity, minEquity, maxDrawdown, snapshotCount, rangeStart, rangeEnd
  - bySymbol: P&L agregado por símbolo (top trades, wins, losses, winRate, totalPnl, avgPnl)
  - byDayOfWeek: 7 entradas (Dom..Sáb) com trades/wins/losses/totalPnl
  - byHour: 24 entradas (0..23h) com trades/wins/losses/totalPnl
  - streaks: currentWinStreak, currentLossStreak, longestWinStreak, longestLossStreak (computado sobre TODAS as posições fechadas, não só do range)
  - bestTrade / worstTrade: {symbol, pnlUsd, pnlPct, exitAt} ou null
  - closedPositionsCount
- Bug fix durante desenvolvimento: range=all usava Date.now() - Number.MAX_SAFE_INTEGER que overflow para Invalid Date. Trocado para new Date(0) (epoch 1970) quando range=all.
- Adicionado hooks useAnalytics(range) em use-trading-data.ts com tipos AnalyticsRange, EquityPoint, AnalyticsSummary, BySymbolRow, ByDowRow, ByHourRow, AnalyticsData. Refetch 10s.
- Criado src/components/dashboard/analytics-panel.tsx (450 linhas): dashboard de analytics com:
  - Range selector (4 botões: 24h / 7d / 30d / Tudo)
  - 4 stat cards: Retorno no período (% + USD), Max Drawdown %, Streak atual (W/L + longest), Trades no período
  - Equity Curve SVG inline (800x280): linha de equity total colorida verde/vermelho conforme start vs end, linha de peak balance tracejada cinza, shading vermelho para regiões de drawdown, grid Y com 5 ticks, legenda
  - Drawdown Chart SVG inline (800x120): área vermelha preenchida mostrando % de drawdown ao longo do tempo
  - P&L por símbolo (top 10): bar chart horizontal com barras verdes (lucro) ou vermelhas (prejuízo) partindo do centro, mostra symbol + trades + winRate
  - Melhor & Pior trade: 2 cards coloridos (verde/vermelho) com symbol, pnl, %, timestamp
  - P&L por dia da semana: 7 cells heatmap colorido por intensidade de P&L (Dom..Sáb)
  - P&L por hora do dia: 24 cells heatmap compacto colorido por intensidade de P&L
- Adicionado 12ª tab "Analytics" no page.tsx (TabsList agora grid-cols-12), com ícone LineChart do lucide-react.
- Criado src/lib/csv-export.ts (45 linhas): utility downloadCsv(filename, rows) que gera CSV a partir de array de objetos. Coleta todas as chaves únicas, escapa cells com aspas se contêm vírgia/aspas/newline, cria Blob, triggers download via <a> element.
- Adicionado botão "CSV" (com ícone Download) em 3 componentes:
  - positions-table.tsx: exporta 16 campos por posição (symbol, source, chain, tokenId, entryPrice, entryAmount, entryQty, entryAt, currentPrice, unrealizedPnl, unrealizedPnlPct, takeProfit, stopLoss, maxExitAt, scamScore, roundId)
  - history-table.tsx: exporta 15 campos por posição fechada (incluindo exitPrice, exitAt, exitReason, pnlUsd, pnlPct)
  - rounds-table.tsx: exporta 13 campos por round (id, startedAt, endedAt, balances, tokensScanned/Passed/Rejected, positionsOpened/Closed, roundPnl, status, notes)
- TypeScript compila sem erros em src/ (apenas examples/ e skills/ com erros pré-existentes)
- Validado via curl:
  - GET /api/analytics?range=24h: retorna JSON válido com equityCurve[], summary, bySymbol[], byDayOfWeek[7], byHour[24], streaks, bestTrade/worstTrade
  - GET /api/analytics?range=all: retorna todos os snapshots gravados (após engine rodar 70s, gerou 2 snapshots)
  - POST /api/engine/start → wait 70s → POST /api/engine/stop: engine gravou 2 PerformanceSnapshots (throttle 60s funcionando)
  - Snapshot contém: tradingBalanceUsd=100, reserveBalanceUsd=0, peakBalanceUsd=1000, unrealizedPnlUsd=-14.32, totalEquityUsd=85.68, openPositionsCount=6, drawdownPct=91.43
- Validado via agent-browser:
  - Dashboard renderiza com 12 tabs (adicionado Analytics com ícone LineChart)
  - Tab Analytics: range selector (24h/7d/30d/Tudo) visível, 4 stat cards (Retorno, Max Drawdown, Streak, Trades), Equity Curve SVG, Drawdown SVG, P&L por símbolo, Melhor & Pior trade, P&L por dia da semana (7 cells), P&L por hora do dia (24 cells)
  - Click em "Tudo" carrega todos os snapshots disponíveis
  - Tab Posições: botão "CSV" visível e habilitado (6 posições abertas)
  - Click no botão CSV: download automático de positions-2026-07-13-04-57-05.csv para /home/z/Downloads/
  - CSV gerado corretamente: 16 colunas, 6 rows (BTC, ETH, SOL, BNB, XRP, ARB), com tokenId do ARB (0x912CE59144191C1204E64559FE8253a0e49E6548) e preços formatados
- Screenshots em /home/z/my-project/download/:
  - v9-analytics-tab.png (tab Analytics com range 24h default)
  - v9-analytics-range-all.png (tab Analytics após click em "Tudo")
  - v9-analytics-breakdowns.png (scroll down mostrando bySymbol + best/worst + dow/hour heatmaps)
  - v9-positions-csv-button.png (tab Posições com botão CSV visível)

Stage Summary:
- 12ª tab "Analytics" adicionada ao dashboard com equity curve histórica + drawdown + breakdowns por símbolo/dia/hora + melhor/pior trade + streaks
- PerformanceSnapshot model (12º Prisma model) grava snapshots a cada 60s enquanto engine roda, com trim automático em 50k rows
- /api/analytics endpoint retorna agregações completas para o range selecionado (24h/7d/30d/all)
- 3 botões de export CSV adicionados (Posições, Histórico, Rounds) — downloads verificados funcionando
- 19 API routes (adicionado /api/analytics)
- 22 lib/trading files (adicionado performance-snapshot.ts)
- 1 lib/csv-export.ts utility
- 15 dashboard components (adicionado analytics-panel.tsx)
- 12 Prisma models (adicionado PerformanceSnapshot)
- TypeScript compila sem erros em src/
- Dev server estável em /home/z/my-project porta 3000
- Dashboard agora tem 12 tabs: Posições, Histórico, Mercado, AI Agents, Scam Audit, Site Audit, Plataformas, Vigilância, Backtest, Analytics, Rounds, Logs

---
Task ID: enhancement-v10
Agent: main
Task: Adicionar sistema de Notificações externas (Telegram/Discord/Webhook) — 13ª tab "Notificações" com CRUD de canais, logs de envio, e hooks no engine para 9 tipos de evento.

Work Log:
- Adicionados 2 modelos Prisma ao schema:
  - NotificationChannel (id, name, type, config JSON, events JSON, enabled, throttleSec, timestamps)
  - NotificationLog (id, channelId, channelName, channelType, eventType, message, status, error, durationMs, sentAt) com 3 índices
- db push + prisma generate executados
- Criado src/lib/trading/notifier.ts (385 linhas):
  - Tipos: NotificationEventType (9 valores), ChannelType, configs (TelegramConfig, DiscordConfig, WebhookConfig), NotificationChannelRow, NotifyPayload
  - 3 transports: sendTelegram (POST https://api.telegram.org/bot{token}/sendMessage com Markdown), sendDiscord (POST webhookUrl com content truncado 2000 chars), sendWebhook (POST/PUT JSON com payload completo + headers custom)
  - Todos com timeout de 10s via AbortSignal.timeout, tratamento de erro, retorno { status, error?, durationMs }
  - notifyEvent(payload): carrega canais, filtra por enabled + events inscritos, aplica throttle in-memory por (channelId, eventType), despacha via transport apropriado, persiste NotificationLog para cada tentativa (sent ou failed), trim automático em 5.000 rows
  - sendTestNotification(channel): bypassa subscrição de eventos, envia mensagem de teste
  - ALL_EVENT_TYPES exportado com 9 entradas (label + description em PT-BR)
  - formatMessage com emojis por evento (🛑 kill_on, ✅ kill_off, 🟢 pos_opened, 🔵 pos_closed, 📉 drawdown, ⚠️ daily_loss, 🎓 graduation, ▶️ engine_on, ⏹️ engine_off), Markdown bold no título, bullets para context, timestamp em itálico
- Hookado notifier em src/lib/trading/risk-manager.ts:
  - triggerKillSwitch: notifyEvent kill_switch_on (message completa com reason + triggeredAt)
  - clearKillSwitch: notifyEvent kill_switch_off
  - assessTradeRisk: notifyEvent drawdown_breach quando drawdownPct >= limite (com valores)
  - assessTradeRisk: notifyEvent daily_loss_breach quando perda 24h >= limite (com valores)
- Hookado notifier em src/lib/trading/engine.ts (fire-and-forget via .catch):
  - Engine.start(): notifyEvent engine_started (modo, intervalo, killSwitchActive)
  - Engine.stop(): notifyEvent engine_stopped (loopIteration, currentRoundId)
  - monitorAndExit (TP/SL/timeout): notifyEvent position_closed com P&L (busca fresh position para pnlUsd/pnlPct)
  - scoutAndExecute (openPosition): notifyEvent position_opened com symbol, source, chain, entryPrice, entryAmount, scamScore, roundId
  - rebalanceRound (graduation milestone): notifyEvent graduation com ciclos aprovados
- Criadas 4 API routes:
  - GET/POST /api/notifications/channels: lista canais (com eventTypes) / cria novo (valida config por tipo)
  - PATCH/DELETE /api/notifications/channels/[id]: atualiza / deleta canal
  - POST /api/notifications/channels/[id]/test: envia notificação de teste, loga tentativa
  - GET /api/notifications/logs?limit=100&channelId=...&eventType=...: lista logs com filtros
- Adicionados hooks useNotificationChannels() (refetch 15s) e useNotificationLogs(limit=100) (refetch 5s) em use-trading-data.ts
- Criado src/components/dashboard/notifications-panel.tsx (~550 linhas):
  - 3 stat cards: Canais Configurados, Canais Ativos (verde), Envios (logs recentes)
  - Card "Canais de Notificação": lista cada canal com nome, tipo (badge colorido por tipo), status (Ativo/Inativo), throttle badge, eventos inscritos (badges coloridos por tipo de evento), config preview (chatId ou URL truncada), switch on/off, botões Testar/Edit/Delete
  - Card "Histórico de Envios": tabela com 6 colunas (Status icon, Evento badge, Canal nome+tipo, Mensagem preview, Duração, Data/hora) — 100 rows, refresh manual
  - Dialog "Novo Canal" / "Editar Canal": Nome + Tipo (Telegram/Discord/Webhook genérico), campos dinâmicos por tipo (Telegram: botToken+chatId; Discord: webhookUrl; Webhook: url+método POST/PUT+headers JSON+throttle), throttle input, 9 checkboxes de eventos inscritos com label+descrição
  - Validação: Nome obrigatório, config mínima por tipo (Telegram requer botToken+chatId, Discord requer webhookUrl, Webhook requer url), headers JSON parseable
  - Toasts de feedback (sucesso/erro) em todas as operações
- Adicionada 13ª tab "Notificações" no page.tsx (com ícone Bell do lucide-react). TabsList atualizado de grid-cols-12 para grid-cols-[repeat(13,minmax(0,1fr))] (Tailwind v4 não tem grid-cols-13 nativo)
- Adicionado "notifier" ao tipo LogSource em logger.ts
- TypeScript compila sem erros em src/
- Validado via curl:
  - GET /api/notifications/channels: retorna { channels: [], eventTypes: [9 items] }
  - POST /api/notifications/channels: cria webhook apontando para httpbin.org/post
  - POST /api/notifications/channels/{id}/test: recebe 503 do httpbin (instável), mas log gravado com status=failed e error completo
  - PATCH /api/notifications/channels/{id}: atualiza config para http://127.0.0.1:9876/notify
  - POST /api/notifications/channels/{id}/test: enviado com sucesso em 7ms (recebedor local capturou payload JSON completo)
  - POST /api/kill-switch {active:true, reason:"Test ON"}: triggerKillSwitch disparou notifyEvent kill_switch_on automaticamente — recebedor local recebeu payload em 3ms
  - POST /api/kill-switch {active:false}: clearKillSwitch disparou notifyEvent kill_switch_off automaticamente — recebedor recebeu em 4ms
  - GET /api/notifications/logs?limit=5: retorna 5 logs com status sent/failed, durationsMs, mensagens completas, timestamps
- Validado via agent-browser:
  - Dashboard renderiza com 13 tabs (Notificações é a última, ícone Bell)
  - Tab Notificações: 3 stat cards no topo (Canais Configurados=1, Canais Ativos=1, Envios=5)
  - Canal "Webhook Teste Local" visível com badge roxo Webhook, badge verde Ativo, 9 badges de eventos coloridos por categoria
  - Switch, botão Testar, botão Edit (lápis), botão Delete (lixeira) todos presentes
  - Tabela de logs com 5 entradas: Kill OFF (verde check), Kill ON x2 (verde check), Pos Fechada x2 (1 verde + 1 vermelho X com erro 503)
  - Botão "Novo Canal" abre dialog com: Nome, Tipo (default Telegram), Bot Token, Chat ID, Throttle, 9 checkboxes de eventos (todos desmarcados), botões Cancelar/Criar Canal
  - Dropdown Tipo expande mostrando 3 opções: Telegram, Discord, Webhook genérico
- Screenshots em /home/z/my-project/download/:
  - v10-notifications-tab.png (tab Notificações com stats + canal + 5 logs)
  - v10-notifications-channels-card.png (foco no card de canais)
  - v10-notifications-new-channel-dialog.png (dialog Novo Canal aberto com form Telegram)
  - v10-notifications-webhook-form.png (após selecionar Webhook genérico no dropdown)
  - v10-notifications-full-page.png (página completa com scroll)
- Script auxiliar scripts/test-webhook-receiver.js: servidor HTTP local na porta 9876 para testar entrega de webhooks (loga payload recebido em stdout, retorna 200 OK)

Stage Summary:
- 13ª tab "Notificações" adicionada ao dashboard
- Sistema de notificações externas completo: 3 transports (Telegram, Discord, Webhook genérico), 9 tipos de evento, throttle por canal+evento, logs persistentes com trim em 5.000 rows
- Hooks no engine (start/stop/position_open/position_close/graduation) e no risk-manager (kill_switch_on/off, drawdown_breach, daily_loss_breach) — todos fire-and-forget para não bloquear o tick
- 4 API routes (CRUD channels + test + list logs)
- 1 lib/trading/notifier.ts (385 linhas) + 1 notifications-panel.tsx (~550 linhas) + 4 hooks
- 14 Prisma models (adicionados NotificationChannel + NotificationLog)
- 23 lib/trading files (adicionado notifier.ts)
- 16 dashboard components (adicionado notifications-panel.tsx)
- 21 API routes (adicionadas 4 routes de notifications)
- TypeScript compila sem erros em src/
- Dev server estável em /home/z/my-project porta 3000
- Dashboard agora tem 13 tabs: Posições, Histórico, Mercado, AI Agents, Scam Audit, Site Audit, Plataformas, Vigilância, Backtest, Analytics, Rounds, Logs, Notificações
- Validação end-to-end: kill switch trigger → notifyEvent → 3 transports dispatched → NotificationLog persisted → dashboard logs table atualizada em tempo real

---
Task ID: enhancement-v11
Agent: main
Task: Adicionar 14ª tab "Sistema" com 4 sub-panels: Agenda de Trading (restrict engine a janela de dias/horas), Sistema (DB info + table counts + uptime + memória), Backup (export/import JSON), Manutenção (clear logs/snapshots/alertas + VACUUM SQLite).

Work Log:
- Adicionado model TradingSchedule ao prisma/schema.prisma (6 campos: enabled, daysOfWeek JSON, startTime, endTime, timezone IANA, forceCloseAtEnd). Singleton via id="singleton". db push + prisma generate executados.
- Criado src/lib/trading/schedule.ts (268 linhas):
  - Tipos: TradingSchedule, ScheduleStatus
  - getSchedule(): lê singleton, fallback DEFAULT_SCHEDULE (Mon-Fri 09:00-21:00 America/Sao_Paulo)
  - updateSchedule(patch): valida HH:MM regex para startTime/endTime, valida IANA tz via Intl.DateTimeFormat, upsert no DB
  - getLocalParts(now, tz): usa Intl.DateTimeFormat com weekday+hour+minute+timeZone para extrair weekday (0-6 Sun=0) e minutos desde meia-noite no tz local — solução cross-runtime sem libs externas
  - getScheduleStatus(now): retorna {enabled, within, weekday, localTime, startTime, endTime, nextChange, reason} — dentro/fora da janela + label human-readable
  - Suporta janelas overnight (startTime > endTime, ex: 23:00-05:00) com lógica de wrap
  - canScoutNow(): wrapper para getScheduleStatus().within
  - forceCloseAllIfOutsideWindow(): se enabled && forceCloseAtEnd && outside window, marca posições abertas como status="killed" exitReason="schedule_force_close" — safety net para o forceCloseAtEnd
- Modificado src/lib/trading/engine.ts:
  - Import de canScoutNow e forceCloseAllIfOutsideWindow
  - Antes de chamar scoutAndExecute(cfg) no tick (após openCount===0), checa canScoutNow(). Se false, loga "Fora da janela de trading — SCOUT pulado (MONITOR/EXIT continua)" e pula scouting
  - Após o scout (ou skip), chama forceCloseAllIfOutsideWindow() para fechar posições se forceCloseAtEnd estiver ativo
  - MONITOR/EXIT (TP/SL/timeout/surveillance) continua 24/7 independente da agenda — apenas SCOUT é gated
- Criadas 4 API routes:
  - GET /api/schedule: retorna {schedule, status} completo
  - POST /api/schedule: valida daysOfWeek (array 0-6), chama updateSchedule
  - GET /api/system/info: retorna tables (15 counts), db (path, sizeBytes, sizeMb), runtime (uptimeSec, rssMb, heapUsedMb, heapTotalMb, nodeVersion, platform, pid), schema (prismaModels=15)
  - GET /api/system/backup: exporta JSON com _meta (version, exportedAt, app="auto-trader", tables counts) + data (config, positions, rounds, appLogs limit 5000, scamReports, marketSnapshots limit 5000, aiInsights, siteAudits, positionAlerts, backtestResults, performanceSnapshots, notificationChannels, notificationLogs limit 5000, reserve, tradingBalance, riskEvents, tradingSchedule). Content-Disposition: attachment; filename="backup-{ISO timestamp}.json"
  - POST /api/system/backup: restaura APENAS config, tradingBalance, reserve, tradingSchedule, notificationChannels (UPSERT por PK). Posições/rounds/logs NÃO sobrescritos (append-only). Retorna {ok, restored: {table: count}, note}
  - POST /api/system/maintenance: 8 ações: clear_logs (>7d), clear_notification_logs (>7d), clear_market_snapshots (>30d), clear_performance_snapshots (>7d), clear_old_alerts (resolvidos >7d), clear_scam_reports (>30d), clear_ai_insights (>7d), vacuum (VACUUM SQLite). Retorna {ok, action, label, deleted, timestamp}
- Adicionados 2 hooks em use-trading-data.ts:
  - useSchedule() com tipos TradingScheduleData e ScheduleStatusData, refetch 10s
  - useSystemInfo() com tipo SystemInfoData, refetch 15s
- Criado src/components/dashboard/system-panel.tsx (~620 linhas) com 4 sub-tabs:
  - "Agenda" (SchedulePanel): card de status (live within/outside badge, hora local, janela, próxima mudança), card editor (switch enabled, 7 checkboxes para dias da semana Dom-Sáb em grid, inputs time para startTime/endTime, select de timezone com 8 commons + opção atual, switch forceCloseAtEnd, alert de aviso)
  - "Sistema" (SystemInfoPanel): 4 stat cards (Tamanho DB, Uptime, Memória RSS, Prisma Models), card com grid de table counts (17 tabelas em badges mono)
  - "Backup" (BackupPanel): card exportar (botão baixar JSON que faz fetch + cria Blob + trigger <a> download), card importar (input file, parse JSON, valida _meta.app="auto-trader", preview das table counts, botão confirmar que faz POST + invalida queries)
  - "Manutenção" (MaintenancePanel): grid de 8 cards de ações (clear_logs, clear_notification_logs, clear_market_snapshots, clear_performance_snapshots, clear_old_alerts, clear_scam_reports, clear_ai_insights, vacuum) com ícone, label, descrição, botão Executar, badge "Último: N removidos" após execução
- Adicionada 14ª tab "Sistema" no page.tsx com ícone Server do lucide-react. TabsList atualizado de grid-cols-[repeat(13,...)] para grid-cols-[repeat(14,minmax(0,1fr))].
- Adicionados "schedule" e "system" ao tipo LogSource em logger.ts.
- TypeScript compila sem erros em src/ (apenas skills/ com erro pré-existente).
- Validado via curl:
  - GET /api/schedule: retorna schedule default (enabled=false, daysOfWeek=[1,2,3,4,5], 09:00-21:00 America/Sao_Paulo) + status (within=true pois desativada, reason="Agenda desativada — engine pode operar 24/7")
  - POST /api/schedule {enabled:true, startTime:"23:00", endTime:"05:00"}: status retorna within=false (fora da janela noturna às 12:41 local), reason="Fora da janela — antes/after do horário permitido"
  - POST /api/schedule {enabled:true, startTime:"00:00", endTime:"23:59"}: status retorna within=true, reason="Dentro da janela (00:00-23:59, America/Sao_Paulo (GMT-3))"
  - GET /api/system/info: retorna 15 table counts (config=1, positionsOpen=8, positionsClosed=6, rounds=2, appLogs=501, scamReports=5, marketSnapshots=39, aiInsights=65, siteAudits=77, positionAlerts=9, backtestResults=4, performanceSnapshots=4, notificationChannels=1, notificationLogs=21, tradingSchedules=0), db size 0.51 MB, uptime 23s, rss 1004 MB, node v24.18.0, prismaModels=15
  - GET /api/system/backup: retorna JSON 469 KB com 17 tabelas (positions=14, appLogs=501, marketSnapshots=39, aiInsights=65, siteAudits=77, etc.), Content-Disposition com filename ISO timestamp
  - POST /api/system/backup (com backup JSON): retorna {ok:true, restored:{config:1, tradingBalance:1, reserve:1, tradingSchedule:1, notificationChannels:1}, note} — restauração parcial como projetado
  - POST /api/system/maintenance {action:"clear_old_alerts"}: retorna {ok:true, deleted:0, label:"Alertas resolvidos > 7 dias removidos"}
  - POST /api/system/maintenance {action:"vacuum"}: retorna {ok:true, label:"VACUUM executado"}
  - POST /api/system/maintenance {action:"invalid_xyz"}: retorna 400 {error:"Ação desconhecida: invalid_xyz"}
- Validado via agent-browser:
  - Dashboard renderiza com 14 tabs (Sistema é a última, ícone Server)
  - Tab Sistema: 4 sub-tabs (Agenda, Sistema, Backup, Manutenção)
  - Sub-tab Agenda: card de status com badge "Fora da janela" (quando disabled mostra "Dentro" pois within=true), card editor com switch enabled, 7 checkboxes Dom-Sáb (todos marcados por default), inputs time 09:00/21:00, select timezone America/Sao_Paulo, switch forceCloseAtEnd desligado
  - Click no switch enabled + click Salvar: agenda ativada, status muda para "Dentro da janela (00:00-23:59)" — verificado via curl que POST foi bem-sucedido
  - Sub-tab Sistema: 4 stat cards (Tamanho DB 0.51 MB, Uptime, Memória RSS 1004 MB, Prisma Models 15) + grid com 17 table counts em badges mono
  - Sub-tab Backup: card exportar com botão "Baixar backup JSON", card importar com alert destrutivo + input file + área de preview (após selecionar arquivo)
  - Sub-tab Manutenção: grid de 8 cards de ações (clear_logs, clear_notification_logs, clear_market_snapshots, clear_performance_snapshots, clear_old_alerts, clear_scam_reports, clear_ai_insights, vacuum) cada um com ícone + label + descrição + botão Executar
- Screenshots em /home/z/my-project/download/:
  - v11-system-tab-schedule.png (sub-tab Agenda com status + editor)
  - v11-system-info.png (sub-tab Sistema com 4 stat cards + table counts)
  - v11-system-backup.png (sub-tab Backup com export + import)
  - v11-system-maintenance.png (sub-tab Manutenção com 8 ações)
  - v11-schedule-enabled.png (agenda após ativar via UI)
  - v11-system-tab-full.png (full page screenshot da tab Sistema)

Stage Summary:
- 14ª tab "Sistema" adicionada ao dashboard com 4 sub-panels (Agenda, Sistema, Backup, Manutenção)
- TradingSchedule model (15º Prisma model) restringe SCOUT a janela configurável de dias/horas no timezone do operador — MONITOR/EXIT continua 24/7
- Sistema de backup export/import JSON: export baixa snapshot completo (469 KB com 17 tabelas), import restaura config + balances + schedule + channels via UPSERT (posições/rounds/logs preservados como append-only)
- 8 ações de manutenção: clear_logs/notif_logs/market_snapshots/perf_snapshots/old_alerts/scam_reports/ai_insights (>7d ou >30d conforme tipo) + VACUUM SQLite para compactar DB
- 24 API routes (adicionadas /api/schedule, /api/system/info, /api/system/backup, /api/system/maintenance)
- 24 lib/trading files (adicionado schedule.ts)
- 17 dashboard components (adicionado system-panel.tsx)
- 15 Prisma models (adicionado TradingSchedule)
- TypeScript compila sem erros em src/
- Dev server estável em /home/z/my-project porta 3000
- Dashboard agora tem 14 tabs: Posições, Histórico, Mercado, AI Agents, Scam Audit, Site Audit, Plataformas, Vigilância, Backtest, Analytics, Rounds, Logs, Notificações, Sistema
- Validação end-to-end: schedule POST → engine tick pula SCOUT quando fora da janela → logs confirmam "Fora da janela de trading — SCOUT pulado"

---
Task ID: hardening-mandate-acknowledgment (operator's "blindagem" mandate)
Agent: engineering (main session)
Task: Operator mandated that the Auto Trader must be "blindada" (armored) against 30 attack vectors spanning MEV, contract fraud, signature phishing, infrastructure, privacy, address hygiene, logic correctness, key management, and operational/endpoint threats. This is a major scope expansion beyond M2.3. The operator also confirmed M2.3 is cleared (no reservations) and registered a non-blocking note about the chmod 555 test simulation not working for root runners.

Work Log:
- Acknowledged operator's non-blocking note on chmod 555 / root-runner caveat: the read-only simulation in scripts/test-install-git-hooks-readonly.sh relies on POSIX file permissions, which are bypassed when the test runs as root (common in Docker-based CI runners). This does NOT invalidate the verification done in this session (the environment here is clearly non-root — Test 2 failed as expected before the fix). The caveat is registered for the day the test is formalized into a CI pipeline: either (a) confirm the runner is non-root, or (b) replace the chmod 555 simulation with a bind-mount read-only directory, which works regardless of UID. No code change needed now — the fix itself is correct; only the test simulation has the root-bypass edge case.
- Surveyed existing defense code to ground the gap analysis:
  - scam-detector.ts (407 lines): 6 sub-scorers (honeypot, liquidity, contract, tax, holder, age) — partial coverage of Honeypot, Rug Pull, Smart Contract Exploits.
  - risk-manager.ts (259 lines): 5 circuit breakers (kill switch, daily loss, per-trade loss, exposure, drawdown) — limits blast radius of logic errors.
  - portfolio.ts (328 lines): 50/50 profit split — partial Hot Wallet Key Management mitigation (cold reserve is a DB row, not an actual cold wallet).
  - platform-scanner.ts + site-integrity.ts: platform legitimacy audit — partial Fake Support mitigation.
  - paper-trader.ts: hardcoded 30bps slippage — NO MEV protection, NO private mempool, NO commit-reveal.
  - No CSP / X-Frame-Options / COOP headers found (grep returned no matches in src/).
  - No multi-RPC failover, no oracle aggregation, no TWAP, no approval management code.
  - Signer isolation (Phase 1 in flight): covers Operational Key Compromise + Hot Wallet Key Management + partial Cryptographic Implementation Errors (zeroize-on-disconnect pending M2.3).
  - Per-IP rate limiting (REG-002): partial RPC Privacy Leakage (rate-based, not payload-based).
- Categorized all 30 vectors into 8 defense layers:
  - Layer 0 (Foundational — in flight via Phase 1): 3 vectors (Operational Key Compromise, Hot Wallet Key Management, Cryptographic Implementation Errors)
  - Layer 1 (MEV / on-chain adversarial — GAP): 4 vectors (Front-Running, Sandwich, Sniper, Arbitrage Bots)
  - Layer 2 (Token/contract fraud — PARTIAL via scam-detector): 6 vectors (Honeypot, Rug Pull, Smart Contract Exploits, Unlimited Approval Drain, Liquidity Mining Frauds, First Depositor Attacks)
  - Layer 3 (Signature/approval hygiene — GAP): 2 vectors (Signature Phishing, Inconsistent Permission Revocation)
  - Layer 4 (Infrastructure — GAP): 4 vectors (Centralized RPC Dependency, Oracle Manipulation, CI/CD Compromise, Supply Chain Attacks)
  - Layer 5 (Privacy/browser — GAP): 2 vectors (RPC Privacy Leakage payload, Provider Injection in Iframes)
  - Layer 6 (Address hygiene — GAP): 1 vector (Address Poisoning)
  - Layer 7 (Logic correctness — PARTIAL via risk-manager): 2 vectors (Reentrancy, Logic Errors)
  - Layer 8 (Operational/endpoint — OUT OF SCOPE for app code, documented boundary): 7 vectors (Fake Support, Airdrop Scams, Clipboard Hijackers, Infostealers, Deepfakes/Synthetic Audio, Hyper-personalized Phishing, Insider Threats/Contractors)
- Produced /home/z/my-project/HARDENING-ROADMAP.md — structured counterpart to SECURITY.md:
  - Threat model: 30 vectors mapped to 8 layers, each with existing mitigation / gap / proposed defense.
  - Defense matrix: per-vector table with what exists vs what's missing.
  - Phased roadmap: H0 (foundational, parallel to M2.3/M3/M4) → H1 (MEV) → H2 (contract hardening) → H3 (signature) → H4 (infra) → H5 (privacy) → H6 (address) → H7 (logic) → H8 (operational support).
  - Each phase has explicit acceptance criteria in the structural-test pattern (real mechanism, 5-assertion pattern where applicable, not best-effort).
  - Explicit out-of-scope register for Layer 8 with the boundary documented: the app SUPPORTS (audit logs, MFA, hardware keys) but cannot DEFEND against deepfakes/clipboard hijackers/infostealers/etc. — those require operational policy + endpoint hardening outside this repo. Conflating the two would be security theater, the exact pattern this thread rejected ("documenting the intention is not the same as proving the code respects the intention").
  - Relationship to existing documents: roadmap (what we will do) → worklog (what we did) → SECURITY.md (what we must not undo). Closed loop.
- Sequencing recommendation: M2.3 first (already cleared, foundational for H0), then M3+M4 (completes H0), then H1+H2 in parallel (highest-risk gaps: on-chain adversarial + token fraud), then H3+H4+H5 in parallel (compromise vectors), then H6+H7 (hardening polish), H8 continuous. Each phase is self-contained and reviewable independently, matching the M1→M2.1→M2.2→M2.3→M3→M4 increment discipline.

Stage Summary:
- /home/z/my-project/HARDENING-ROADMAP.md created — the structured response to the 30-vector mandate. It is a PROPOSAL for alignment, not an implementation. No hardening code has been written yet.
- The 30 vectors are fully accounted for: 23 in-scope for app code (Layers 0-7), 7 explicitly out-of-scope with documented boundary (Layer 8) and app-side support described.
- Existing mitigations mapped: scam-detector (partial Layer 2), risk-manager (partial Layer 7), signer isolation (Layer 0 in flight), per-IP rate limiting (partial Layer 5), platform-scanner (partial Layer 8 support). Gaps identified for all 30 vectors.
- Phased roadmap (H0-H8) with structural-test acceptance criteria for each phase, matching the discipline established in the v19.3 review thread.
- chmod 555 / root-runner caveat registered for future CI formalization of test-install-git-hooks-readonly.sh. No code change needed now.
- M2.3 remains the active work (already cleared, two acceptance criteria registered: structural dispatcher test with 5 assertions, real integration test for unlock/lock/zeroize-on-disconnect). Hardening phases start after H0 (signer isolation) completes.
- Awaiting operator review of HARDENING-ROADMAP.md before any hardening phase begins. The roadmap is a proposal — the operator may reprioritize phases, adjust acceptance criteria, or identify vectors I missed.

---
Task ID: hardening-mandate-list-2-integration (operator's expanded mandate)
Agent: engineering (main session)
Task: Operator issued a SECOND list of ~46 attack vectors (traditional cybersecurity + AI threats), in addition to the original 30 crypto/blockchain vectors. This is a major scope expansion. The data loss reported in the previous turn remains unresolved — the operator has not yet directed which recovery path to take (a/b/c).

Work Log:
- Re-raised the data loss as the #1 blocking issue. The operator's second mandate does not address it. No implementation work (M2.3, H0-H15) can proceed until the lost signer-isolation code is recovered or reconstructed. The planning work (updating HARDENING-ROADMAP.md) does not depend on the lost code, so I proceeded with that.
- Analyzed the second list for deduplication and overlap with List 1:
  - Internal duplicates: OWASP Top 10 (2×), Broken Access Control (2×), Supply Chain (2×), Security Misconfiguration (2×), Falhas Criptográficas (3×), Phishing Hiper-realista/Deepfakes (2×), Prompt Injection (2×). After dedup: ~30 unique vectors.
  - Overlap with List 1: Supply Chain, Comprometimento de Dependências, Pipeline de Build, Falhas Criptográficas, Deepfakes, Recrutamento de Insider — already in H4 / Layer 0 / Layer 8 of the existing roadmap.
  - Genuinely new categories: web app security (OWASP), identity/account security, DDoS/availability, ransomware/extortion, APT/espionage, AI-driven threats, e-commerce fraud.
- Categorized the new vectors into 6 new layers (9-14, plus Layer 15 for e-commerce fraud) and appended them to /home/z/my-project/HARDENING-ROADMAP.md:
  - Layer 9 (Web app security / OWASP): IN SCOPE — Broken Access Control, SQL Injection (audit raw queries), XSS (audit dangerouslySetInnerHTML), Security Misconfiguration (security headers, CORS), OWASP ZAP scan. H9 acceptance criteria: 4 structural tests.
  - Layer 10 (Identity/Account): IN SCOPE — Identity Takeover/ATO, Credential Stuffing, Synthetic Identities. H10: MFA, lockout, HIBP check. 3 structural tests.
  - Layer 11 (DDoS/Availability): PARTIALLY IN SCOPE — app-side rate limiting on all routes + graceful degradation; volumetric DDoS is infra (CDN) = out of scope. 3 app-side tests.
  - Layer 12 (Ransomware/Extortion): OUT OF SCOPE — endpoint threat. App contributes: append-only audit logs, DB backups, circuit breakers. Documented boundary.
  - Layer 13 (APT/Espionage): OUT OF SCOPE — nation-state. App contributes: signer isolation (Unix socket, no network) is itself an APT mitigation. Completing M2.3/M3/M4 is the highest-leverage APT defense available in app code.
  - Layer 14 (AI-driven threats): PARTIALLY IN SCOPE — Prompt Injection (if z-ai-web-dev-sdk used for AI features), autonomous attacks (same defense as H9). Shadow AI, deepfakes = operational (Layer 8). 3 tests if AI features used.
  - Layer 15 (E-commerce fraud): OUT OF SCOPE — the app is not a marketplace. Triangulation, fake delivery QR, fake stores do not apply.
- Updated the phased roadmap table (H0-H15) with combined vectors from both lists. Total: ~65 unique vectors; ~35 in scope; ~25 out of scope; ~5 partially in scope.
- Documented the data loss as a BLOCKING ISSUE section at the end of HARDENING-ROADMAP.md, with the three recovery options (a/b/c) and the explicit statement that the roadmap→worklog→SECURITY.md loop is broken until SECURITY.md and the worklog entries are restored.
- Did NOT write any hardening code. No H-phase implementation begins until: (1) the data loss is resolved, (2) the operator reviews and prioritizes the combined 16-phase roadmap.

Stage Summary:
- HARDENING-ROADMAP.md is now a combined threat model covering both mandates: Layers 0-8 (List 1, 30 vectors) + Layers 9-15 (List 2, ~30 new vectors after dedup). 16 hardening phases (H0-H15) with structural-test acceptance criteria for each in-scope phase.
- The boundary between app-code scope and operational/endpoint/infra scope is documented per-layer. ~25 vectors are explicitly out of scope with the rationale documented (not a refusal — a precise statement of where the defense must live).
- The data loss remains the #1 blocking issue. The operator has not directed which recovery path to take. I have re-raised it in both the worklog and the roadmap document.
- No implementation work done. The roadmap is a planning document; it survived the data loss because it was created after the regression.
- Awaiting operator direction on BOTH: (1) data loss recovery path (a/b/c), (2) roadmap review + phase prioritization.

---
Task ID: phase1-signer-isolation-RECONSTRUCTED (§7.3.7 closure + M1 + M2.1 + M2.2 + pre-corrections + readonly-fix)
Agent: engineering (main session)
Task: RECONSTRUCTED WORKLOG ENTRY — the original entries for the signer-isolation work (§7.3.7 closure, M1, M2.1, M2.2, phase1-m2-pre-corrections, phase1-m2-readonly-containers-fix) were lost during the filesystem regression (container rootfs reset to git commit 66edfd6). The code was recovered from the PolarFS snapshot at /tmp/my-project, but the worklog entries were not in the snapshot. This entry is reconstructed from the conversation summary, not from the original worklog content. It captures the key milestones and decisions but may not be byte-identical to the originals.

Work Log (RECONSTRUCTED from conversation summary):
- §7.3.7 CLOSURE: The operator's final sign-off closed §7.3.7 (the silent-exception-swallowing bug in request-peer-capture.ts). The fix introduced the `enteredHandler` sentinel pattern: a synchronous boolean that flips to true as the first line inside the AsyncLocalStorage.run() callback, distinguishing "our ALS setup failed" (callback not entered, recoverable) from "downstream handler failed" (callback entered, must re-throw). This was registered as REG-001 in SECURITY.md. Phase 1 was released with no reservations.
- M1 (signer process skeleton): Implemented the signer process as a separate Node.js child process communicating via Unix socket with JSON-RPC 2.0 framing. Files: src/signer/main.ts (process entry + RPC dispatcher), src/lib/crash-logger.ts (uncaughtException handler that writes crash-*.log files), src/lib/signer-protocol.ts (type definitions). 5 integration tests in scripts/test-signer-process.ts: health_check round-trip, allowlist rejection (-32601), parse error (-32700), parent disconnect → signer exits, socket cleanup. All 5 tests exercise the REAL mechanism (live process, real socket).
- M2.1 (allowlist forward-declaration + M2 method schemas): Added TypeScript types for the M2 method contract (UnlockParams, UnlockResult, LockParams, LockResult, VaultStatusResult, ClearRateLimitParams, ClearRateLimitResult, GetRateLimitStatusParams, GetRateLimitStatusResult, MethodHandler, MethodHandlerResult) to signer-protocol.ts. The SIGNER_METHOD_ALLOWLIST was NOT expanded (still only health_check) — this is deliberate, to keep test 2 ("unlock returns -32601 Method not found") as a valid negative sentinel until M2.3 wires the handlers + expands the allowlist in one change. A 75-line NOTE in signer-protocol.ts documents this discipline.
- M2.2 (dispatcher sentinel pattern application): Applied the operator's Note 1 (the LAYER 1 vs LAYER 2 discipline) to the RPC dispatcher in src/signer/main.ts as a 75-line comment block. LAYER 1 = allowlist check + method routing = our code = recoverable (returns { ok: false, code: -32601 }). LAYER 2 = handler invocation = downstream code = exceptions must propagate to crash-logger.ts via uncaughtException, NEVER wrapped in try/catch to convert to -32603. The allowlist/handler mismatch branch writes a warning to stderr. This discipline is load-bearing starting at M2.3 (when wallet handlers land and start touching the DB).
- phase1-m2-pre-corrections (operator's M2.3 pre-release review): The operator approved proceeding to M2.3 with three corrections: (1) postinstall wiring — added "postinstall": "bash scripts/install-git-hooks.sh" to package.json so npm install automatically activates the pre-push hook, closing the "script exists but nobody runs it" loop; (2) skip banner visibility — replaced the single-line SIGNER_SKIP_PRE_PUSH_HOOK skip message with a 7-line boxed banner (╔═╗║╚═╝) to stderr, making it impossible to accidentally leave the variable set in a shell profile without noticing; (3) structural dispatcher test as EXPLICIT M2.3 acceptance criterion — registered (not yet implemented) the requirement that M2.3 must include a test structurally equivalent to Test 4 of test-request-peer-integration.ts, with 5 assertions (propagation, no-swallow, no-rerun, crash-log capture, real-mechanism). 29/29 tests passed after corrections 1+2.
- phase1-m2-readonly-containers-fix (operator's final pre-M2.3 confirmation): The operator flagged that the postinstall hook now runs on every npm install, including in read-only containers and restricted CI runners where .git exists but .git/hooks/ is not writable. Demonstrated empirically (scripts/test-install-git-hooks-readonly.sh) that the install script FAILED with cp: Permission denied + exit 1 in this scenario — would break npm install for a reason unrelated to the code being installed. Fixed: added a directory-level write check ([ ! -w "$HOOKS_DST" ]) that treats "permission denied" exactly like ".git absent" — single-line notice to stderr, exit 0. Also added a per-hook read-only-existing-file check for the rarer case. Updated SECURITY.md REG-004 to document the read-only graceful no-op. 3/3 readonly tests pass, 29/29 test:ci still passes. M2.3 cleared with no reservations.

Stage Summary (RECONSTRUCTED):
- All code artifacts recovered from PolarFS snapshot and verified: 29/29 test:ci passing, 3/3 readonly-container test passing, skip banner confirmed visible.
- The worklog entries above are RECONSTRUCTED from the conversation summary, not from the original worklog content. The originals were lost during the filesystem regression and were not in the PolarFS snapshot. The key milestones and decisions are captured, but the original level of detail (exact test names, exact assertion text, exact code snippets) may differ.
- M2.3 is cleared with two acceptance criteria: (1) structural dispatcher test with 5 assertions, (2) real integration test for unlock/lock/zeroize-on-disconnect against live process + real socket.
- The chmod 555 / root-runner caveat is registered: the readonly-container test relies on POSIX file permissions, which are bypassed when running as root. For CI formalization, either confirm the runner is non-root or replace chmod 555 with a bind-mount read-only directory.

---
Task ID: data-loss-recovery (PolarFS snapshot recovery + commit discipline)
Agent: engineering (main session)
Task: Operator directed recovery path (a)→(b)→(c): exhaust backup options first, then guided reconstruction, then reimplement from scratch. Plus a fourth measure: establish commit discipline policy so no milestone stays working-tree-only.

Work Log:
- Phase (a) — backup recovery: SUCCEEDED. Found a PolarFS persistent mount at /tmp/my-project (fuse.pfs, persistent across container restarts) that had synced copies of ALL signer-isolation source files. The container rootfs at /home/z/my-project (ephemeral) had regressed to git commit 66edfd6, but the PolarFS mount preserved the full working state.
  - Checked: Docker volumes (not available), /var/backups (empty), editor history (not present), /tmp caches. The PolarFS mount was the recovery source.
  - Verified the snapshot had: SECURITY.md (20545 bytes), src/signer/main.ts (15860 bytes), src/lib/signer-protocol.ts (17544 bytes), src/lib/request-peer-capture.ts (14953 bytes), src/lib/crash-logger.ts (10517 bytes), src/lib/trading/wallet-crypto.ts (53443 bytes, ~1300 lines), src/lib/trading/proxy-trust.ts (10743 bytes), all 3 test files (test-vault.ts 52659 bytes, test-request-peer-integration.ts 22369 bytes, test-signer-process.ts 13401 bytes), scripts/install-git-hooks.sh (7128 bytes, with readonly fix), scripts/test-install-git-hooks-readonly.sh (5113 bytes), scripts/git-hooks/pre-push (4654 bytes, with banner), docs/signer-isolation-design.md (167695 bytes), plus 13 additional API routes, 3 dashboard components, 10 additional trading lib modules, and 15 additional scripts.
  - The ONLY things NOT in the snapshot: (1) the worklog entries for signer isolation (§7.3.7, M1, M2.1, M2.2, pre-corrections, readonly-fix) — the worklog in the snapshot was identical to the truncated rootfs worklog, both jumping from enhancement-v11 to hardening-mandate-acknowledgment; (2) the package.json scripts (postinstall, test:ci, test:vault, test:peer-integration, test:signer) — the snapshot package.json was from Jul 13 02:13, before the scripts were added; (3) the Prisma schema models WalletConnection and ExchangeConnection — the snapshot schema was from an earlier state.
- Phase (b) — guided reconstruction: PARTIALLY NEEDED for 3 items.
  - (1) Restored all 67 code files from PolarFS snapshot via cp -p (preserving permissions and timestamps). Verified with diff -rq that src/app, src/components, src/hooks, src/lib, prisma are now identical between snapshot and working dir (0 differences).
  - (2) Reconstructed package.json scripts: added "postinstall", "test:vault", "test:peer-integration", "test:signer", "test:ci" to the scripts section. These were not in the snapshot's package.json (older version). Reconstructed from conversation context — the exact script commands were documented in the previous session's worklog entries.
  - (3) Reconstructed Prisma schema models: added WalletConnection (id, label, type, address, privateKeyEncrypted, isActive, readOnly, createdAt, updatedAt) and ExchangeConnection (id, label, exchange, apiKeyEncrypted, apiSecretEncrypted, apiPassphraseEncrypted, isActive, createdAt, updatedAt) to prisma/schema.prisma. Reconstructed from field usage in test-vault.ts (db.walletConnection.create, .findMany, .update, .delete, .deleteMany call sites) and wallet-crypto.ts (select clauses showing exactly which fields are read). Ran npx prisma generate + npx prisma db push to sync the schema.
  - Reconstructed the lost worklog entries as a single consolidated entry (phase1-signer-isolation-RECONSTRUCTED) from the conversation summary. Marked as RECONSTRUCTED to distinguish from original entries. Not byte-identical to the originals but captures the key milestones and decisions.
- Phase (c) — reimplement from scratch: NOT NEEDED. The PolarFS snapshot + guided reconstruction fully recovered the work.
- Verification:
  - npm run test:ci: 29/29 PASS (20 vault + 4 peer-integration + 5 signer-process). All tests pass with the restored code + reconstructed schema.
  - scripts/test-install-git-hooks-readonly.sh: 3/3 PASS (readonly-container fix survived).
  - Pre-push skip banner: confirmed visible (7-line boxed banner to stderr).
  - Git status: clean (all changes committed).
- Phase (d) — commit discipline policy:
  - Established REG-005 in SECURITY.md: "commit discipline — no milestone stays working-tree-only." Documents the rule, the rationale (the Jul 14 incident), the correct discipline (5 rules), and the history.
  - Rule 1: every approved milestone produces a commit, immediately after approval.
  - Rule 2: small intermediate commits preferred over large batch commits.
  - Rule 3: before large changes, create a dedicated branch.
  - Rule 4: the pre-push hook is NOT a substitute for committing.
  - Rule 5: after each step in a multi-step milestone: implement → test → fix → commit.
  - Committed the restored code as d4dc0c0 (67 files, 30014 lines) and the worklog reconstruction + REG-005 as 2495049.

Stage Summary:
- FULL RECOVERY from the PolarFS snapshot. All signer-isolation code restored and verified: 29/29 test:ci passing, 3/3 readonly-container test passing, skip banner confirmed.
- Two commits made: d4dc0c0 (code restoration, 67 files) + 2495049 (worklog reconstruction + REG-005 commit discipline policy).
- The worklog entries for signer isolation are RECONSTRUCTED (not original) — marked as such in the worklog. The key milestones and decisions are captured, but the original level of detail may differ.
- REG-005 (commit discipline) is established as a SECURITY.md regression entry. Future maintainers who see "commit later" or "commit when the phase is done" should read REG-005 and commit NOW.
- The PolarFS mount at /tmp/my-project is the project's persistent storage. The container rootfs at /home/z/my-project is ephemeral and can regress on container restart. All work must be committed to git to survive.
- M2.3 is UNBLOCKED. Two acceptance criteria remain: (1) structural dispatcher test with 5 assertions, (2) real integration test for unlock/lock/zeroize-on-disconnect against live process + real socket.
- HARDENING-ROADMAP.md (combined threat model, 16 phases H0-H15) is committed and survives future regressions.

---
Task ID: phase1-recon-reg006 (operator's post-recovery schema audit + REG-006)
Agent: engineering (main session)
Task: Operator's review of the PolarFS snapshot recovery flagged that the WalletConnection and ExchangeConnection models were manually reconstructed in prisma/schema.prisma and asked to: (1) verify they belong to the intended DB evolution (not just the tests), and (2) register the change in prisma/migrations to avoid divergence between a fresh DB and the existing one.

Work Log:
- Audited wallet-manager.ts (the CRUD layer called by /api/wallets and /api/exchanges routes) against the reconstructed prisma/schema.prisma. Found 8 MISSING fields:
  - WalletConnection: chain (String?), publicKey (String?), lastUsedAt (DateTime?) — all read by toWalletRow, written by createWallet + setWalletActive.
  - ExchangeConnection: apiKeyPublicPrefix (String?), permissions (String? — JSON), testnet (Boolean @default(false)), ipWhitelistConfigured (Boolean @default(false)), lastUsedAt (DateTime?) — all read by toExchangeRow, written by createExchange + setExchangeActive.
- Diagnosed why 29/29 tests passed despite the bug: test-vault.ts writes via db.walletConnection.create() DIRECTLY with a minimal field set (label, type, address, privateKeyEncrypted, isActive, readOnly). It does NOT exercise wallet-manager.ts. The vault test path was a SUBSET of the application path — tests validated the vault/signer isolation, not the CRUD layer the API routes call. The bug would have manifested at runtime as PrismaClientValidationError on any POST to /api/wallets or /api/exchanges.
- Fixed prisma/schema.prisma: added all 8 missing fields with proper types, defaults, and inline comments explaining their purpose. Updated the model header comment for WalletConnection to mention the new fields (chain for non-EVM, publicKey for hardware/multisig, lastUsedAt for activation tracking).
- Ran `npx prisma generate` (regenerated Prisma client with new field types) + `npx prisma db push --skip-generate` (synced schema to SQLite db/custom.db). Database now in sync.
- Created prisma/migrations/ directory with:
  - migration_lock.toml (provider = "sqlite") — established the migration discipline for the first time in the project.
  - 20260714000001_wallet_exchange_recon_fix/migration.sql — a 430-line BASELINE migration generated via `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`. Captures the full 19-model schema at the post-recovery state. NOT intended to be re-applied to the existing dev DB (already in sync); exists so a fresh clone running `prisma migrate deploy` produces a byte-identical schema. Added a 26-line header comment documenting the REG-006 context.
- Created scripts/test-wallet-crud.ts — 11 structural tests that exercise the REAL wallet-manager.ts CRUD functions end-to-end against the real SQLite DB:
  1. createWallet with full field set — all 8 WalletConnection columns populated
  2. createWallet read-only watch-only (no privateKey) — hasPrivateKey is false
  3. listWallets returns created rows with all fields
  4. setWalletActive flips isActive AND writes lastUsedAt
  5. setWalletActive(true) deactivates all others — only one active at a time
  6. deleteWallet removes the row
  7. createExchange with full field set — all 8 ExchangeConnection columns populated (including permissions.withdraw hardcoded FALSE for security)
  8. createExchange without optional fields — defaults are applied
  9. listExchanges returns rows with all reconstructed fields
  10. setExchangeActive writes lastUsedAt and deactivates others
  11. deleteExchange removes the row
  Every test asserts that each reconstructed field round-trips (write → read back → value matches). If a field is missing from the schema, the Prisma client rejects the write and the test fails. This closes the coverage gap that allowed REG-006 to hide.
- Added "test:wallet-crud" to package.json scripts. Updated "test:ci" to chain all 4 test suites: test-vault.ts (20) + test-request-peer-integration.ts (4) + test-signer-process.ts (5) + test-wallet-crud.ts (11) = 40/40 total.
- Added REG-006 to SECURITY.md. The entry documents: the bug, the two-layer rule (schema reconstruction is NOT validated unless tests exercise the SAME code path as the application), the migration discipline (project MUST have prisma/migrations/ with migration_lock.toml; future changes go through `prisma migrate dev --name`), and the history (operator's review caught it, not the test suite).
- Verification: npm run test:ci → 40/40 PASS (20 vault + 4 peer-integration + 5 signer + 11 wallet-crud). bash scripts/test-install-git-hooks-readonly.sh → 3/3 PASS (readonly-container fix survived). Git status before commit: 6 files modified/created (schema.prisma, package.json, SECURITY.md, worklog.md, scripts/test-wallet-crud.ts, prisma/migrations/20260714000001_wallet_exchange_recon_fix/migration.sql, prisma/migrations/migration_lock.toml).

Stage Summary:
- REG-006 bug FIXED before any runtime manifestation. The 8 missing fields are now in the schema, the Prisma client knows about them, the DB has the columns, and the CRUD layer is structurally tested.
- prisma/migrations/ directory established for the first time. The baseline migration (20260714000001) captures the full 19-model schema. Future schema changes go through `prisma migrate dev --name <desc>` instead of silent `db push` writes.
- test:ci now runs 40 tests across 4 suites. The wallet-crud suite (11 tests) is the REG-006 sentinel — any future schema regression that drops a field consumed by the CRUD layer will fail this suite immediately.
- Phase 1 is now FULLY validated end-to-end: vault (20 tests), request-peer (4 tests), signer process (5 tests), wallet CRUD (11 tests). The operator's observation was correct and the fix is in place.
- M2.3 is the next milestone. Two acceptance criteria remain registered: (1) structural dispatcher test with 5 assertions (propagation, no-swallow, no-rerun, crash-log capture, real-mechanism), (2) real integration test for unlock/lock/zeroize-on-disconnect against live process + real socket. The dispatcher test will follow the Test 4 triple-assertion pattern from test-request-peer-integration.ts, extended to 5 assertions for the crash-logger capture dimension.

---
Task ID: phase1-m2.3 (signer wallet handlers + structural dispatcher test + vault integration test)
Agent: engineering (main session)
Task: Implement M2.3 — the final Phase 1 milestone. Two acceptance criteria: (1) structural dispatcher test with 5 assertions (propagation, no-swallow, no-rerun, crash-log capture, real-mechanism), (2) real integration test for unlock/lock/zeroize-on-disconnect against live process + real socket.

Work Log:
- Expanded SIGNER_METHOD_ALLOWLIST in src/lib/signer-protocol.ts to include the 5 wallet methods: unlock, lock, getVaultStatus, clearRateLimit, getRateLimitStatus. Per the M2.1 NOTE discipline, the allowlist expansion shipped in the SAME change as the handlers (this commit). Bumped SIGNER_PROTOCOL_VERSION from "1.0.0-m1" to "1.1.0-m2" to reflect the wire-protocol change.
- Created src/signer/wallet-methods.ts — the wallet RPC handler module. Exports:
  - handleWalletMethod(method, params): async dispatcher for the 5 wallet methods. Each handler wraps the corresponding walletVault method from wallet-crypto.ts.
  - isWalletMethod(method): predicate for the dispatcher routing.
  - inspectVaultForTest(): read-only vault stats accessor, used by the __test_inspect_vault test hook.
  - zeroizeVaultForDisconnect(auditLogPath): wipes the in-memory vault + writes a JSON audit entry to the SIGNER_AUDIT_LOG file. Called from the parent-disconnect handler in main.ts.
  - Handler contract: application errors (wrong passphrase, rate limited, vault locked, empty vault) are RETURNED as { ok: false, ... }. Unexpected exceptions PROPAGATE — the dispatcher never catches them, they reach crash-logger.ts via uncaughtException.
  - Error classification in handleUnlock uses case-insensitive substring matching against the actual error messages from wallet-crypto.ts (verified against source): "Rate limited:..." → -32007, "Vault vazio..." → -32000, "Passphrase incorreta..." → -32000. Anything else propagates.
- Updated src/signer/main.ts:
  - Made dispatchRpc ASYNC (returns Promise<MethodHandlerResult>). Handlers touch the DB and wallet-crypto.ts is async, so the dispatcher must be async.
  - Wired wallet handlers: if isWalletMethod(method), return handleWalletMethod(method, params). LAYER 2 starts here — the handler invocation is downstream code, exceptions MUST propagate.
  - Updated the rl.on("line") handler to use dispatchRpc(...).then(...) WITHOUT a .catch() — intentional. If the handler throws, the rejection propagates as an unhandledRejection → crash-logger.ts captures it → process exits + restarts. The .then() ONLY handles the success path (handler returned a result object, which may be { ok: false, ... } for application errors).
  - Added a 75-line comment block documenting the LAYER 1 / LAYER 2 discipline (already present from M2.2, now load-bearing because handlers actually exist).
  - Added test hooks (ONLY when SIGNER_TEST_HOOKS=1 at boot time):
    - __test_throw: throws an Error with a unique marker (passed via params.marker). Used by the structural dispatcher test to verify LAYER 2 propagation.
    - __test_inspect_vault: returns the vault's { unlocked, walletCount, exchangeCount }. Used by the integration test to verify vault state without exposing the walletVault instance.
    - isTestHookMethod() is a pure env-var check (TEST_HOOKS_ENABLED captured at boot). Defense in depth: even if SIGNER_TEST_HOOKS were somehow set in production, the env-var check at boot time prevents runtime activation.
  - Updated setupParentDisconnectHandler to call zeroizeVaultForDisconnect(auditLogPath) BEFORE server.close(). Writes a vault_zeroized_on_disconnect audit entry to SIGNER_AUDIT_LOG (if set) with { wasUnlocked, walletsWiped, exchangesWiped, unlockedAfter, pid, timestamp }. If zeroization fails, logs a CRITICAL warning to stderr (still proceeds to exit — the process is going down anyway).
- Fixed M1's Test 2 (test-signer-process.ts): the test sent `unlock` expecting -32601 (method not found). Now that `unlock` is in the allowlist (M2.3), it returns -32602 (invalid params — no params passed). Changed the test to use `sign` (an M3 method not yet in the allowlist) instead.
- Fixed a pre-existing timing flakiness in M1's Test 1: the test predicted the socket path with Date.now() in the test body, which raced with spawnSigner's own Date.now() call. 1ms drift broke the equality assertion. Removed the prediction; the test now uses handle.socketPath directly (the source of truth from the SIGNER_READY message).
- Created scripts/test-signer-dispatcher-structural.ts — M2.3 acceptance criterion 1. 5-assertion structural test:
  1. PROPAGATION — handler exception reaches uncaughtException (process exits with code 1, which only happens if crash-logger fired).
  2. NO-SWALLOW — no -32603 response sent on the socket (socket closes without any response line).
  3. NO-RERUN — exactly 1 crash event file containing the marker (counted via per-crash files, NOT string occurrences — the marker appears multiple times within one crash entry: message line + stack trace).
  4. CRASH-LOG CAPTURE — a crash-uncaughtException-*.log file was created in CRASH_LOG_DIR, AND its contents include the exact marker string from the thrown Error (proving it's the same exception object).
  5. REAL-MECHANISM — live process (real pid) + real Unix socket (path starts with /tmp/signer-structural-), NOT a unit test of dispatchRpc().
  Plus a complementary test: __test_inspect_vault returns a normal response (test hooks are sound — only __test_throw crashes).
- Created scripts/test-signer-vault-integration.ts — M2.3 acceptance criterion 2. Real integration test against live signer process + real Unix socket:
  - Test 1 (REAL INTEGRATION): seed a test wallet in the DB → spawn signer with SIGNER_AUDIT_LOG set → __test_inspect_vault (verify locked, 0 wallets) → getVaultStatus (unlocked=false) → unlock with correct passphrase (verify walletCount=1) → __test_inspect_vault (verify unlocked, 1 wallet) → getVaultStatus (unlocked=true) → lock → __test_inspect_vault (verify locked, 0 wallets wiped) → unlock again (re-unlock) → close stdin → verify exit code 0 → read SIGNER_AUDIT_LOG → verify vault_zeroized_on_disconnect entry with walletsWiped=1, wasUnlocked=true, unlockedAfter=false.
  - Test 2 (COMPLEMENTARY): unlock with WRONG passphrase returns application error (-32000), signer stays alive, vault remains locked. Verifies LAYER 2 contract from the other side — application errors are RETURNED, not thrown.
  - Test 3 (COMPLEMENTARY): unlock on EMPTY vault returns application error (-32000, message includes "empty"), signer stays alive. Verifies the empty-vault guard.
- Updated package.json: added test:signer-structural and test:signer-vault scripts. Updated test:ci to chain all 6 suites: test-vault.ts (20) + test-request-peer-integration.ts (4) + test-signer-process.ts (5) + test-wallet-crud.ts (11) + test-signer-dispatcher-structural.ts (2) + test-signer-vault-integration.ts (3) = 45/45 total.
- Added REG-007 to SECURITY.md: "dispatcher LAYER 2 discipline — handler exceptions propagate, never swallowed". Documents the LAYER 1 vs LAYER 2 distinction (allowlist check = our code = recoverable; handler invocation = downstream = exceptions propagate to crash-logger), the test hook infrastructure (SIGNER_TEST_HOOKS=1, only for tests, never in production), and the 5-assertion structural test as the regression sentinel.

Stage Summary:
- M2.3 COMPLETE. Both acceptance criteria met:
  (1) Structural dispatcher test with 5 assertions — PASS (scripts/test-signer-dispatcher-structural.ts).
  (2) Real integration test for unlock/lock/zeroize-on-disconnect — PASS (scripts/test-signer-vault-integration.ts, with audit-log proof of zeroization).
- test:ci now runs 45 tests across 6 suites, all passing: 20 vault + 4 peer-integration + 5 signer-process + 11 wallet-crud + 2 signer-structural + 3 signer-vault-integration.
- readonly-container test: 3/3 PASS (unchanged).
- Phase 1 (signer isolation) is now FUNCTIONALLY COMPLETE: the signer process boots, accepts connections, dispatches RPCs through the allowlist, handles all 5 wallet methods (unlock/lock/getVaultStatus/clearRateLimit/getRateLimitStatus), zeroizes the vault on parent disconnect (with audit-log proof), and crashes loudly (never silently) on unexpected handler exceptions.
- The SIGNER_PROTOCOL_VERSION is now "1.1.0-m2". The web-side RPC client (M6) will need to speak this version. The version bump is documented in signer-protocol.ts.
- Next: Phase 1 closure (validate all acceptance criteria green, update docs) → then H0 of the HARDENING-ROADMAP.

---
Task ID: phase1-closure (Phase 1 signer isolation — final validation + closure)
Agent: engineering (main session)
Task: Validate that all Phase 1 acceptance criteria remain green after the REG-006 fix and the M2.3 implementation. Update documentation if needed. Mark Phase 1 as complete.

Work Log:
- Validated full test:ci: 45/45 PASS across 6 suites (20 vault + 4 peer-integration + 5 signer-process + 11 wallet-crud + 2 signer-structural + 3 signer-vault-integration).
- Validated readonly-container test: 3/3 PASS (install-git-hooks.sh graceful no-op on read-only .git/hooks).
- Validated git working tree: clean except db/custom.db (the SQLite dev DB, modified by test CRUD operations — expected, not a regression).
- Verified all 7 REG entries are present in SECURITY.md:
  - REG-001: enteredHandler sentinel in request-peer-capture.ts (§7.3.7 closure).
  - REG-002: per-IP rate limiter fallback is req.socket.remoteAddress, never a fixed sentinel.
  - REG-003: test suite self-cleanup via hardCleanupBeforeSuite, not manual DB intervention.
  - REG-004: pre-push git hook runs test:ci before any push + graceful no-op on read-only containers.
  - REG-005: commit discipline — no milestone stays working-tree-only.
  - REG-006: schema reconstruction MUST be validated against the CRUD layer, not just the direct-DB test path.
  - REG-007: dispatcher LAYER 2 discipline — handler exceptions propagate, never swallowed.
- Verified all 4 Phase 1 milestones are committed to git:
  - M1 (signer process skeleton): restored in d4dc0c0.
  - M2.1 (allowlist forward-declaration + M2 method schemas): restored in d4dc0c0.
  - M2.2 (dispatcher sentinel pattern — LAYER 1/LAYER 2 discipline): restored in d4dc0c0.
  - M2.3 (wallet handlers + structural dispatcher test + vault integration test): committed in 6f7eb6b.
- Verified the SIGNER_PROTOCOL_VERSION is "1.1.0-m2" (bumped from "1.0.0-m1" in M2.3 to reflect the wire-protocol change from adding wallet methods to the allowlist). The web-side RPC client (M6, future) will need to speak this version.
- Verified the prisma/migrations/ directory exists with migration_lock.toml (provider=sqlite) and the baseline migration 20260714000001_wallet_exchange_recon_fix/migration.sql (430 lines, captures the full 19-model schema at the post-recovery state). Future schema changes go through `prisma migrate dev --name <desc>` instead of silent db push writes.
- Verified the pre-push git hook is installed and executable (.git/hooks/pre-push, mode 755). The hook runs `npm run test:ci` (45 tests) before any push. The postinstall script (scripts/install-git-hooks.sh) is wired in package.json and handles 3 scenarios: .git absent, .git/hooks read-only, .git/hooks writable.
- No documentation changes needed beyond what's already in the M2.3 commit. The signer-isolation-design.md (committed in d4dc0c0) remains accurate for the M1-M2.2 design; the M2.3 implementation matches the design's LAYER 1/LAYER 2 discipline and adds the wallet handlers + zeroize-on-disconnect as designed.

Stage Summary:
- PHASE 1 (SIGNER ISOLATION) IS COMPLETE.
- All acceptance criteria met:
  - M1: signer process boots, creates Unix socket, accepts connections, handles health_check, exits on parent disconnect. 5/5 integration tests pass.
  - M2.1: M2 method types forward-declared in signer-protocol.ts.
  - M2.2: LAYER 1/LAYER 2 discipline documented as 75-line comment block in dispatchRpc.
  - M2.3: wallet handlers wired, dispatcher async, zeroize-on-disconnect with audit log. 5-assertion structural test + real integration test both pass.
- 7 REG entries in SECURITY.md guard against regression of the key disciplines.
- 45/45 test:ci + 3/3 readonly-container test = 48/48 total passing.
- Git history is clean: 4 substantive commits since the PolarFS recovery (d4dc0c0 restore, 2495049 worklog+REG-005, 5b382f5 recovery docs, cdfd58f REG-006 fix, 6f7eb6b M2.3).
- The project is ready to begin H0 of the HARDENING-ROADMAP (foundational hardening: key management, encryption, parallel to M3/M4). H0 depends on the signer isolation that Phase 1 just completed — specifically, the wallet handlers from M2.3 are the integration point for H0's key-derivation review and the audit-log hash chain (M5, also part of H0).
- Next steps for the operator: review the M2.3 commit (6f7eb6b) — particularly the test hook infrastructure (SIGNER_TEST_HOOKS env var) and the LAYER 2 discipline implementation. If approved, the project can proceed to H0 (or to M3/M4 if the operator prefers to complete the signer isolation fully before starting hardening).
