---
name: ext-ccxt
description: CCXT como transporte unificado de exchanges (100+ venues, REST+WS, TS nativo) — única dependência viva entre as 9. Uso restrito a S14 com flag + envelope; até lá, leitura pública/testnet.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/ccxt/ccxt (acessado 2026-09-12; 44k★, MIT, TS/Python/C#/PHP/Go/Java/Rust)
license: MIT — dependência viva (`ccxt@^4.5.64` em package.json:1)
---

# Skill ext-ccxt — Transporte unificado

## 1. Função (evidência do repo)
API unificada para 100+ exchanges cripto + prediction markets (Polymarket, Kalshi, Hyperliquid): REST + WebSocket públicos e privados, dados normalizados cross-exchange (arbitragem), mesma chamada em 7 linguagens, "ideal for AI agents". Exchanges certificadas incluem Binance/Bybit/OKX/Gate/KuCoin/Bitget/Hyperliquid.

## 2. Papel na arquitetura v1.6
- **Camada 1 (perception):** tickers/OHLCV/order-book normalizados alimentam `price-feed.ts:1` e `MarketSnapshot` (leitura pública, sem chaves).
- **S14 (execução):** `live-trader.ts:1` (stubs testados 9/9) + `ExchangeConnection` (AES-256-GCM) + `leased-broadcaster`/`writer-lease` — CCXT é o transporte quando S14 desbloquear.
- **Cross-exchange:** normalização nativa sustenta arbitragem/XEMM e `Divergence_Crypto_Equity` (§3.5) sem adaptador por venue.

## 3. Guardrails vinculantes
- **S14 bloqueado** (`ORCAMENTO_ESTOURADO`, `live_trading.enabled=false`): sem `BINANCE_TESTNET_API_KEY`/`ALCHEMY_RPC_URL`/`ETH_SEPOLIA_PRIVATE_KEY` + aprovação, só leitura pública e mocks.
- Respeitar rate-limit do venue (OTT §4.6b/6.9): throttle + `checkRateLimit`; breach → degradar, nunca forçar.
- Testnet primeiro (`testnet:true` default); chaves só via secrets, nunca em código/docs (SECRETS.md).
- Divergência venue-vs-broker > tolerância → `feed_stale` (emergência §4.4d), como em `perception-enrichment.ts:1`.

## 4. Contrato de integração (status: DEPENDENCY, leitura + S14-gated)
`ccxt` já instalado. Uso permitido hoje: `fetchTicker/fetchOHLCV/fetchOrderBook` públicos. Uso com chave (balance/order) **só** em S14 com `FeatureFlag live_trading` + `mode.json:1` permitindo + humano.

## 5. O que NÃO incorporar
Ordem live sem envelope, chaves hardcoded, polling agressivo sem backoff.

## 6. Licença
**MIT — uso direto permitido.** Respeitar `exchanges.json` (venues suportadas) e certificação por exchange.
