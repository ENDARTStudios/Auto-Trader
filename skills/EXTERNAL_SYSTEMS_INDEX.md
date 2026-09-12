# Índice de Sistemas Externos — Auto Trade

> 9 repos acessados e analisados em 2026-09-12 (evidência, não memória). Cada um virou uma skill com **papel único** na arquitetura v1.6, guardrails e status de integração. Regra-mãe: **advisory-only por default** — nenhum sistema externo decide, dimensiona ou executa; decisão/risco fluem só da skill v1.6 (`AGENTS.md:1`).

| # | Skill | Sistema (★ em 2026-09-12) | Função em uma frase | Camada v1.6 | Status | Licença |
|---|-------|---------------------------|---------------------|-------------|--------|---------|
| 1 | `ext-tradingagents-tauric.md` | TradingAgents fork vongchu (84★) | Debate multi-agente como M_lang | M_lang + perception | **WIRED** (Fases 1–4) | Apache-2.0 |
| 2 | `ext-backtrader.md` | Backtrader (23.2k★) | Metodologia de backtest (Cerebro/analyzers/sizers) | Validação | SPEC-ONLY | **GPL-3.0** |
| 3 | `ext-nautilus-agents.md` | Nautilus Agents SDK (45★) | Fronteira de autoridade advisory-only | Doutrina §0/§8c | SPEC-ONLY | LGPL-3.0 |
| 4 | `ext-freqtrade.md` | Freqtrade (54.3k★) | Playbook operacional (dry-run/pairlist/protections) | Operação | SPEC-ONLY | **GPL-3.0** |
| 5 | `ext-ccxt.md` | CCXT (44k★) | Transporte unificado 100+ exchanges | Perception + S14 | **DEPENDENCY** | MIT |
| 6 | `ext-vectorbt.md` | VectorBT (9.1k★) | Varredura vetorizada 10k configs + métricas | Evolução/validação | SPEC-ONLY | Fair-code |
| 7 | `ext-lumibot.md` | Lumibot (2.1k★) | Precedente híbrido (read-only + gates + memória) | Doutrina §0.5 | SPEC-ONLY | **GPL-3.0** (badge) |
| 8 | `ext-hummingbot.md` | Hummingbot (20k★) | Taxonomia de execução + Condor + triple-barrier | Execução (S14-gated) | SPEC-ONLY | Apache-2.0 |
| 9 | `ext-finrl.md` | FinRL (16.3k★) | Disciplina DRL train→test→trade + turbulence | Evolução/regime | SPEC-ONLY | MIT |

**Classes de licença (constraint vinculante):**
- `permissive` (MIT/Apache): uso direto permitido; mesmo assim só spec exceto CCXT.
- `copyleft` (GPL/LGPL): **SPEC-ONLY — nenhum código copiado** (contaminação de repo proprietário).
- `fair-code` (Commons Clause): spec apenas; revenda baseada é proibida.

**Mapa de cobertura (sem lacuna, sem sobreposição decisória):**
perception (TA analysts, CCXT público, Lumibot SEC/FRED) · debate (TA, Lumibot, FinRL ensemble) · backtest (Backtrader, Freqtrade, VectorBT) · risco/operação (Freqtrade protections, Nautilus boundary, Hummingbot triple-barrier/keystore) · evolução (VectorBT grade, FinRL gates, Freqtrade hyperopt) · execução (CCXT+Hummingbot, **ambos S14-gated**).
