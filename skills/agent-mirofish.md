---
name: agent-mirofish
description: MiroFish-ES como gerador de cenários por simulação de enxame — milhares de agentes com persona/memória em mundo digital paralelo, injeção divina de variáveis, ReportAgent. Fonte de cenários/teses (challenger), nunca de probabilidade.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/DragonJAR/MiroFish-ES (acessado 2026-09-13; fork de 666ghj/MiroFish 72k★; este fork 17★, Python, motor OASIS CAMEL-AI)
license: AGPL-3.0 (via API GitHub) — SPEC-ONLY, nenhum código copiado (copyleft com cláusula de rede)
---

# Skill agent-mirofish — Gerador de cenários por enxame

## 1. Função (evidência do repo + API)
Motor de predição por inteligência de enxame: sementes do mundo real (notícias, políticas, sinais financeiros) → **GraphRAG** (memória individual/coletiva) → personas + parâmetros por agente → **simulação paralela** com memória temporal dinâmica → **ReportAgent** (relatório + conversa pós-sim) → interação profunda com qualquer agente. **Injeção divina**: variáveis alteradas mid-sim para deduzir trajetórias ("ensaiar o futuro"). Memória Zep Cloud ou local Graphiti+Neo4j. Stack própria (frontend :3000 + Python :5001 + Docker). Previsão financeira listada como **"próximamente"** (imaturo — ver §5).

## 2. Papel no projeto/skill v1.6
- **Gerador de cenários (challenger, M_lang):** enxame produz *narrativas de "e se"* (ex: "e se o Fed corta 50bps com DXY em alta?") → entram como **teses candidatas** no debate (§4.5) e como choques no gerador de cenários (§5.4b). Calibração do gerador contra cauda empírica continua obrigatória — simulação aprova candidato, cauda real dá a palavra final.
- **Injeção divina → stress discipline:** equivale aos nossos `scripts/load-test-k6.mjs:1`, `test-m5-*` chaos e `weeklyPromotionCycle` sob `mode.json:1` — variáveis forçadas, medir recuperação, nunca operar no escuro.
- **GraphRAG + personas com memória:** precede nosso `KnowledgeGraph` + `logs/episodes.jsonl:1` + debate Bull/Bear; ReportAgent precede nosso postmortem (§5.3).
- **Precedente negativo útil:** "prediz qualquer coisa" sem calibração declarada = exatamente o erro que §0.5/§5.12 proíbem (confiança de LLM ≠ probabilidade).

## 3. Guardrails vinculantes
- Simulação gera **cenário/tese**, nunca `P` (só `M_param`, §0.5); sem `forward_prediction` verificável, a tese morre em NO_TRADE (§5.12).
- Divergência enxame-vs-`M_param` aplica §0.5b/0.5c (estável sem drift veta; virada/drift reduz + `divergence_as_signal`).
- Stack isolada se um dia executada (job externo, artefatos JSON → ETL); nada no processo Next; chaves LLM só do operador.

## 4. Contrato (status: SPEC-ONLY)
Sem runtime acoplado. Adoção = padrão "enxame como challenger de cenários" + injeção divina como disciplina de stress. Se ativado: `challenger_swarm` promovido **só** por `forward_hit_rate` OOS (§5.4), como qualquer `challenger_lang`.

## 5. O que NÃO incorporar
Código (**AGPL-3.0**: copyleft com cláusula de rede — toque contamina até hospedagem), execução live, "previsão financeira" deles (imaturo, "próximamente"), Zep Cloud com dados do projeto, dependência do fork pequeno (17★, último push 2026-04-16 — preferir o upstream ativo em caso de uso real).

## 6. Licença
**AGPL-3.0 — spec/doutrina apenas. Cláusula de rede: nem hospedar derivado sem abrir código.**
