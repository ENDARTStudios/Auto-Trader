# PRD — Auto Trader: Autonomous Crypto Paper Trading

> **Versão:** 1.0 — 2026-08-26
> **Status:** Ativo — base para SPRINT.md e PLANO_MESTRE.md
> **Owner:** Operador (Doer implementa, Thinker revisa)
> **Stack:** Next.js 16 + TypeScript + Prisma (SQLite/PostgreSQL) + Tailwind + shadcn/ui

---

## 1. Visão do Produto

**Em uma frase:** Sistema autônomo de trading de cripto que descobre candidatos (CEX + DEX), filtra scams em 6 camadas, aplica circuit breakers e executa paper-trading com split 50/50 de lucro (reserva cold USDC / reinvestimento), com graduação controlada para live trading.

**Problema que resolve:**
- Trader manual não consegue monitorar 35+ plataformas e milhares de tokens 24/7.
- 90%+ de memecoins em L2 são honeypot/rug — detecção manual é impraticável.
- Sem disciplina de risco, perdas superam ganhos (sem kill-switch, sem drawdown cap).

**Proposta de valor:**
- Loop 100% autônomo: SCOUT → ANALYZE → EXECUTE → MONITOR → EXIT → REBALANCE
- Scam detection multicamada (turnover, liquidez, contrato, holders, idade + GoPlus + site-integrity + AI squad)
- Circuit breakers defensivos (kill switch, perda diária, por trade, exposição, drawdown)
- Observabilidade total: equity curve, logs, scam audits, surveillance alerts, SSE realtime

---

## 2. Personas & Jobs

| Persona | Job principal | Dor | Critério de sucesso |
|---|---|---|---|
| **Operador Solo** (atual) | Configurar e deixar rodar; intervir só em kill-switch | Medo de rug, medo de perder tudo em live | Paper trading lucrativo por 50 ciclos antes de liberar live |
| **Power Trader** (futuro) | Fine-tune de TP/SL, watchlist, backtest de estratégia | Sem dados para validar thresholds | Backtest com Sharpe + equity curve antes de mudar param |
| **Auditor** (futuro) | Verificar o que o bot fez e por quê | Falta de trilha auditável | Cada decisão tem ScamReport + MarketSnapshot + AIInsight + AppLog |

---

## 3. Escopo — MVP Atual (já implementado)

### 3.1 Já Entregue (verificar com `npm run test:ci`)

- [x] Engine singleton com state machine (engine.ts)
- [x] Token selector CEX (Binance) + DEX (DexScreener) + platform gate (platform-scanner.ts)
- [x] Scam detector 6 sub-scorers (scam-detector.ts) + GoPlus scanner + site-integrity (5 layers)
- [x] Market analysis (RSI/MACD/EMA/Bollinger + Fear&Greed) + AI agent squad (thesis/news/contract)
- [x] Position surveillance (7 detectors) + exit planner (LLM advisor)
- [x] Portfolio manager (open/close/rebalance 50/50) + Paper trader (simulação)
- [x] Risk manager (5 breakers) + Graduation (paper → live gate)
- [x] Dashboard Next.js 16: 12+ tabs, workspace-header, equity curve, SSE AlertsToast
- [x] Backtesting engine (Binance klines + RSI strategy) + Analytics panel
- [x] Notification channels (Telegram/Discord/webhook) + Trading schedule
- [x] Wallet/Exchange CRUD com AES-256-GCM (wallet-crypto.ts, KDF versioning, audit hash-chain)
- [x] Signer isolation (Unix socket, vault, writer lease, signer-adapter, broadcaster)
- [x] Hardening H0/H1/H2/H2.6 + 637 checks no CI gate

### 3.2 Fora do Escopo do MVP (roadmap)

- Live CEX (CCXT) / DEX (Uniswap V3 router) execution — stubs apenas
- Vault HSM / Infisical — DB row hoje
- Multi-usuário / Auth / RBAC — single operator hoje
- Fila BullMQ + Redis — in-process hoje

---

## 4. Requisitos Funcionais

| ID | Requisito | Prioridade | Critério de Aceite |
|---|---|---|---|
| **F-01** | Loop autônomo SCOUT→REBALANCE | P0 | Engine.tick() avança state machine; Round row criada/fechada; test:ci verde |
| **F-02** | Scam filter ≥70 bloqueia token | P0 | Token <70 rejeitado, ScamReport com passed=false, 6 sub-scores visíveis |
| **F-03** | Circuit breakers bloqueiam trade | P0 | Kill switch / daily loss / per-trade / exposure / drawdown cada um testado |
| **F-04** | Split 50/50 ao fechar round | P0 | Reserve += 50% lucro, balance = saldo + 50%; invariante soma = initial+realizedPnl |
| **F-05** | Dashboard realtime via SSE | P0 | /api/stream entrega evento em <2s; AlertsToast renderiza |
| **F-06** | Backtest validável | P1 | POST /api/backtest retorna equityCurve + tradesJson + Sharpe; panel exibe |
| **F-07** | Graduação paper→live | P1 | graduatedToLive só true após 50 ciclos lucrativos; toggle desabilitado antes |
| **F-08** | Watchlist + rising tokens | P1 | getRisingCandidates merge com selectCandidates; watchlist CRUD |
| **F-09** | Surveillance + AI exit planner | P1 | 7 detectors rodam a cada 5min; exit-planner recomenda hold/tighten/raise/scale/exit |
| **F-10** | Notifications (TG/Discord) | P2 | Canal subscribed recebe evento; throttle respeitado |
| **F-11** | Trading schedule (janela) | P2 | Fora da janela: SCOUT skip, MONITOR/EXIT continuam |
| **F-12** | Multi-RPC quorum + simulation gate | P1 | Gates H1/H2 rodam antes de signer; Pipeline audit exatamente 1x |
| **F-13** | Auth + RBAC (futuro) | P1 | Ver docs/RBAC.md — 4 papéis, 24 permissões |

---

## 5. Requisitos Não-Funcionais

| Categoria | Requisito | Métrica |
|---|---|---|
| **Performance** | Dashboard LCP <2.5s, p95 API <500ms @1k concorrentes | Lighthouse >90, k6 |
| **Segurança** | OWASP Top10, zero secret em log/repo, RLS em tabelas sensíveis | SECURITY.md REG-001..008, SAST CodeQL, gitleaks |
| **Confiabilidade** | Engine sobrevive a hot reload, crash logger síncrono, backup diário | instrumentation.ts, crash-logger.ts, rollback |
| **Observabilidade** | Logs estruturados, Sentry OTEL, métricas Prometheus | docs/OBSERVABILITY.md |
| **Testes** | Unit ≥80% services, integração por rota, E2E Playwright nos fluxos críticos | docs/TESTING.md, codecov |
| **Acessibilidade** | WCAG 2.1 AA, teclado, ARIA, contraste | Lighthouse a11y >90 |
| **SEO/AEO/AIO/GEO** | Title/description/canonical/OG/JSON-LD/sitemap/robots | docs/SEO.md |
| **Deploy** | Blue-green, health check, rollback automático, HSTS Full Strict | docs/DEPLOY.md |

---

## 6. Arquitetura (resumo — detalhe em docs/ARCHITECTURE.md)

```
Dashboard (Next.js 16) ──REST/SSE──► Engine (singleton) ──► Pipeline (H1+H2 gates) ──► Signer (Unix socket) ──► Broadcaster (RPC quorum)
                                          │                        │
                                          ▼                        ▼
                                   Prisma (SQLite/PostgreSQL)  Audit hash-chain
```

- **Monolito modular** — não microsserviços (escala 100→50k, monolito cabe)
- **Feature flags** — tabela `FeatureFlag` + helper `isEnabled(flag)` + Redis cache
- **Error boundary** — root + por painel + Sentry capture
- **Rate limit** — por IP + por user + por rota (memória dev, Redis prod)
- **Security headers** — Helmet/CSP/HSTS/X-Frame-Options via next.config + middleware

---

## 7. Métricas de Sucesso (KPIs)

| KPI | Alvo MVP | Como medir |
|---|---|---|
| Ciclos paper completados | ≥50 para graduação | Config.paperCyclesPassed |
| Win rate paper | >50% | TradingBalance.wins/tradesClosed |
| Profit factor | >1.2 | sum wins / |sum losses| |
| Max drawdown | <20% | Peak vs trough equity curve |
| Scam block rate | >95% de tokens honeypot sintéticos | test-h2-adversarial |
| p95 latência API | <500ms @1k users | k6 |
| Cobertura testes | ≥80% services | codecov |
| Lighthouse | >90 perf/a11y/SEO | CI |

---

## 8. Riscos & Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Honeypot delayed re-lock passa no filtro | Média | Alto | H2.4 sell simulation + surveillance re-scan a cada 5min |
| RPC único censura/falha | Alta | Alto | H1.1 QuorumRpcClient + failover + health score |
| Operador perde chave / vault corrompe | Baixa | Crítico | KDF versioning + key-rotation + backup audit hash-chain |
| Engine in-process morre com Next restart | Média | Médio | Roadmap: BullMQ+Redis worker separado; hoje crash-logger síncrono |
| Secret vaza em log/commit | Média | Crítico | gitleaks pre-commit + CI + redact em logger Pino |

---

## 9. Roadmap por Marcos

| Marco | Fases | Critério (DoD) |
|---|---|---|
| **Beta Fechada (100 usuários)** | 0–5 parcial, 6.1–6.3 | Pesquisa + login + área usuário |
| **Open Beta (1k)** | 0–8 parcial, 9.1–9.6 | + rankings + billing + observabilidade |
| **v1.0 público** | Todas | + IA RAG + ETL + DAST + hardening completo |
| **Hardening atual** | H0/H1/H2/H2.6 M3.1-3.3 | 637 checks, frozen base, signer pronto |

---

## 10. Anexos

- `docs/UML.md` — classes + sequência
- `docs/RBAC.md` — matriz de acesso
- `docs/RLS.md` — Row Level Security
- `docs/ARCHITECTURE.md` — catálogo modular + feature flags
- `docs/SECRETS.md` — gestão de segredos
- `docs/TESTING.md` — pirâmide de testes
- `docs/SECURITY_AUDIT.md` — gate de deploy
- `HARDENING-ROADMAP.md` — 30 vetores
- `SECURITY.md` — REG-001..008 regression inventory
