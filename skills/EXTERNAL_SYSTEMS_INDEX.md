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
- `unverified` (ex: NOASSERTION via API): SPEC-ONLY por precaução até confirmação.

**Mapa de cobertura (sem lacuna, sem sobreposição decisória):**
perception (TA analysts, CCXT público, Lumibot SEC/FRED) · debate (TA, Lumibot, FinRL ensemble) · backtest (Backtrader, Freqtrade, VectorBT) · risco/operação (Freqtrade protections, Nautilus boundary, Hummingbot triple-barrier/keystore) · evolução (VectorBT grade, FinRL gates, Freqtrade hyperopt) · execução (CCXT+Hummingbot, **ambos S14-gated**).

---

## Parte 2 — Agent-infra (10 repos, 2026-09-12)

> Segunda leva: infraestrutura de agentes (memória, harness, coleta, diagramas, red-team) — a **meta-camada** que opera o agente/engenheiro, não o mercado. Nota honesta: `Agency-agents` e `Agency` da lista original são **a mesma URL** (`msitarzewski/agency-agents`) — 11 URLs → **10 skills**.

| # | Skill | Sistema (★ em 2026-09-12) | Função em uma frase | Toca o projeto em | Status | Licença |
|---|-------|---------------------------|---------------------|-------------------|--------|---------|
| 10 | `agent-codebase-memory-mcp.md` | codebase-memory-mcp (43k★) | Graph-first validado (gêmeo do graft/) | Doutrina GRAFT-FIRST | SPEC (doutrina) | MIT |
| 11 | `agent-agency-agents.md` | agency-agents (152k★) | Personas Finance/Security/Testing p/ debate/red-team | Debate/red-team | SPEC-ONLY | MIT |
| 12 | `agent-agentmemory.md` | agentmemory (28.4k★) | Memória 4-tier + RRF + privacy-first (≈ §5.2) | `logs/*.jsonl` | SPEC (doutrina) | Apache-2.0 |
| 13 | `agent-openviking-plugins.md` | openviking-plugins (17★) | Precedente mínimo recall/capture (menor) | Doutrina (menor) | SPEC (doutrina) | Apache-2.0 |
| 14 | `agent-browser-use.md` | browser-use (114k★) | Coleta web read-only sandboxed | Perception (ETL futuro) | SPEC-ONLY | MIT |
| 15 | `agent-harness-engineering.md` | awesome-harness-engineering (4.1k★) | Catálogo harness (loops/contexto/evals/HITL) | Doutrina harness | SPEC (doutrina) | **NOASSERTION** |
| 16 | `agent-diagram-design.md` | diagram-design (38.5k★) | 39 diagramas editoriais p/ docs | Docs (`docs/ARCHITECTURE.md`, `UML.md`) | SPEC (convenção) | MIT |
| 17 | `agent-scientific-skills.md` | scientific-agent-skills (44.5k★) | Falsificação validada + FRED + TimesFM/PyMC | Evolução/perception | SPEC-ONLY | MIT |
| 18 | `agent-agent-reach.md` | Agent-Reach (79.5k★) | Coleta social N/R/M (Twitter/Reddit/YT/Bili/Xiaohongshu) | Pilares N/R/M §2.2 | SPEC-ONLY | MIT |
| 19 | `agent-strix.md` | Strix (61.9k★) | Red-team PoC-validado + CI gate | Risco/CI (Fase 8) | SPEC (doutrina) | Apache-2.0 |

**Cobertura agent-infra:** perception (browser-use, agent-reach, scientific FRED) · debate (agency personas) · risco/operação (strix) · evolução (scientific challengers) · docs (diagram-design) · doutrina (codebase-memory, agentmemory, openviking, harness-catalog).
