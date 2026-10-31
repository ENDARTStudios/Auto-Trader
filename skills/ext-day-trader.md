# Skill ext-day-trader — Disciplina de day trading (pipeline risk-first)

> **Adição:** 2026-10-31 (Parte 3 do índice — a pedido do Operador). Evidência: fetch do README/repo em 2026-10-31 (~4k★).
> **Regra-mãe:** advisory-only (`src/lib/trading/external-systems.ts:1`).

## 1. Função (evidência do repo)

Pacote **MIT** com **11 skills Claude** (Python 3.8+ stdlib, zero deps, dados gratuitos: Yahoo Finance, Nasdaq Trader, SEC EDGAR, House Clerk) que ensina um pipeline de day trading risk-first:

```
scanner → news → entry → exit → timemachine → budget → risk → broker (+alerts)
```

| Skill | O que faz |
|---|---|
| trader-scanner | Varre ~5.900 ações US por setups (opening-range breakout, flags, oversold bounce) |
| trader-news | Manchetes + filings 8-K das watchadas |
| trader-entry | Observa o setup bar-a-bar: `waiting / triggered / expired` |
| trader-exit | **Define stop E target antes do entry** |
| trader-timemachine | **Monte-Carlo: 10.000 sessões simuladas + todo passado em que o setup disparou** |
| trader-budget | Sizing: max loss por trade ÷ risco por unidade = quantidade |
| trader-risk | **PASS/BLOCK** contra limites (max-loss, daily-loss, trades/dia, R:R mínimo, cash) |
| trader-broker | Envia ordem aprovada (Alpaca MCP, **paper default**) |
| trader-alerts | Preço/stop/target/closing bell |
| trader-analyst | Earnings + fundamentos XBRL |
| trader-pelosi | Divulgações de trades do Congresso (STOCK Act) |

Metodologia (exemplo TSLA ORB): setup = 1º close 5min acima do range de 15min; stop no meio do range; alvo 1R; flat às 15h55. **Nada executa sem "yes" humano**; sem opções/margin/short/leverage por default.

## 2. Papel na arquitetura v1.6

**Espelho metodológico** — quase tudo aqui já existe na skill v1.6, e o day-trader **valida por precedência externa** as mesmas doutrinas:

| Day-trader | Já temos | Absorver por spec |
|---|---|---|
| exit.py: stop/target ANTES do entry | skill §3 item 10 (sem stop/invalidação = NO_TRADE) | Checklist de ticket: ticket sem stop+alvo pré-definidos = rejeitar no gerador (§9) |
| trader-risk PASS/BLOCK | `risk-manager.ts` + kill_switches | Formato de gate binário pré-ordem: max-loss, perda diária, nº de trades/sessão, R:R mínimo, capital — checklist objetivo antes de qualquer EXECUTE |
| trader-timemachine (MC 10k + replay) | `mc-posterior.ts` + forward OOS | Replay histórico de setups: "quantas vezes ESTA tese disparou antes e qual o desfecho" como insumo do debate (§5) |
| trader-budget (max loss ÷ risco/unidade) | `sizing-fixed-point.ts` (0.5% ponto-fixo) | Sanity-check de sizing legível: o sizing calculado deve poder ser expresso como "max loss $X ÷ risco por unidade Y = N" |
| trader-broker (paper default + "yes") | paper-first + envelope humano (T_sla) | Confirmação textual explícita em qualquer futura execução real (S14) |
| trader-alerts / flat-by-close | `notifier.ts` + `schedule.ts` | Flat-by-deadline → análogo ao TradingSchedule (sessão encerra tese aberta) |

## 3. Guardrails vinculantes

1. **Zero código copiado** — MIT é permissive, mas a doutrina da casa é spec-only exceto CCXT (§0: externo não é o cérebro). Os scripts Python nem rodam no nosso stack TS.
2. **Domínio divergente**: ações US em sessão regular ≠ crypto 24/7 CEX+DEX. Setups (ORB, flags) são **padrões de tese** a mapear para o nosso token-selector — não portar literalmente.
3. Nada aqui toca P/EV/sizing — o pipeline deles NUNCA decide; nossa P vem de `M_param` (§0.5).
4. O trader-broker é S14-gated: nenhuma ordem real, nem paper via MCP externo — o nosso paper trader é o único executor.

## 4. Contrato de integração (status: SPEC-ONLY)

| Conceito | Onde vira spec no Auto Trader |
|---|---|
| Gate PASS/BLOCK pré-ordem | Checklist objetivo no `risk-manager.ts` (subconjunto objetivo dos kill switches) |
| Replay histórico de setup | Feature do `mc-posterior.ts`/`backtest.ts`: dado um tese-snapshot, listar episódios passados similares + desfechos (forward OOS) |
| Ticket com exit obrigatório | Reforço no `exit-planner.ts`: ticket gerado sem stop+alvo = inválido por construção |
| Sizing expresso em max-loss | Formato de log/episódio: sizing sempre acompanhado de "max loss $ = risco por unidade × N" |

## 5. O que NÃO incorporar

- Qualquer script Python (mesmo MIT — domínio/stack diferentes).
- Yahoo Finance/SEC EDGAR/House Clerk como fontes (nosso ETL é crypto: DexScreener/GoPlus/Etherscan/CoinGecko/Binance).
- Cadência day-trade (flat diário) — nossa janela é thesis-driven com `TradingSchedule` próprio.
- O fork de execução Alpaca MCP.

## 6. Licença

MIT → classe `permissive` → uso direto permitido; por doutrina, **SPEC-ONLY** (mesma classe do FinRL/Hummingbot).
