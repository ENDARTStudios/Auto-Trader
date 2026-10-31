# Skill ext-openstock — Referência UI/UX de dashboard de mercado

> **Adição:** 2026-10-31 (Parte 3 do índice — levantamento a pedido do Operador). Evidência: fetch do README/repo em 2026-10-31.
> **Regra-mãe:** advisory-only (`src/lib/trading/external-systems.ts:1`).

## 1. Função (evidência do repo)

OpenStock (Open-Dev-Society) é dashboard web open-source de mercados (8 mercados: EUA, Índia, Alemanha, Canadá, Austrália, Arábia, Crypto, Forex) — "alternativa gratuita a plataformas caras". **Não é corretora nem engine**: monitoramento. Stack: Next.js 15 App Router + React 19 + Tailwind v4 + shadcn/ui + Better Auth + MongoDB + Finnhub + widgets TradingView + Inngest (jobs) + Nodemailer.

Funcionalidades relevantes como referência: heatmap setorial, index pulse, top stories, páginas por ativo (gráficos TradingView com SMA/RSI/MACD), watchlists (50 ativos), alertas de preço por email, **agregação de sentimento (Reddit/X/news/Polymarket)**, cache de cotações (horário; 15s em modo realtime).

## 2. Papel na arquitetura v1.6

**Referência de UX/visual para o dashboard vNext** (camada `docs`, como diagram-design):
- Heatmap setorial → candidato para painel de bolha/7 pilares (visual, não decisório).
- Watchlist com análise por ativo → espelha `WatchlistToken` + `/api/watchlist/[id]/analyze` já existentes.
- Agregação de sentimento multi-fonte (Reddit/X/news) → padrão para pilares N/R/M (§2.2) — mesmo papel que Agent-Reach, lado UI.
- Alertas de preço → precede `PositionAlert`/NotificationChannel (já implementado).

## 3. Guardrails vinculantes

1. **Zero código copiado** — AGPL-3.0 (copyleft): ver componente/widget que gostar? Descreve-se o padrão num skill e reimplementa-se do zero em TS próprio.
2. Não adotar Better Auth/MongoDB/Inngest — stack divergente (Prisma/SQLite/Postgres, sessão própria).
3. Finnhub como fonte de dados: exige chave e tem tier free limitado — passa pelo checklist de [INTEGRATIONS](../docs/04-api-integrations/INTEGRATIONS.md) §5 antes de qualquer adoção.
4. Nada daqui toca P/EV/sizing — é UI.

## 4. Contrato de integração (status: SPEC-ONLY)

| Importável | Referência spec-only |
|---|---|
| Layout de heatmap/painéis | Reimplementar com shadcn/ui + Tailwind próprios |
| TradingView widgets (embed) | Widgets são embed público do TradingView — usar direto é permitido pelo próprio TradingView (não depende do código do OpenStock) |
| Padrão de alerta agendado (Inngest job) | Equivalente: cron-evolution.ts / scheduler próprio |

## 5. O que NÃO incorporar

- Qualquer arquivo-fonte do repo (AGPL contamina).
- Modelo de dados deles (Mongoose) — schema Prisma é a fonte.
- "Realtime 15s" contra Finnhub free (rate-limit/billing) — nosso ETL é batch.

## 6. Licença

AGPL-3.0 → classe `copyleft` → **SPEC-ONLY** por definição da regra-mãe.
