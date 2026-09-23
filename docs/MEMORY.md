# MEMORY — Memória do Sistema e do Time

> **Versão:** 1.0 — 2026-09-23
> **Princípio (skill §12):** todo episódio gera aprendizado com owner + taxonomia. Memória sem escrita é amnésia; memória sem leitura é estoque morto.

---

## 1. Memória operacional do engine (viva, escrita em runtime)

| Arquivo | Conteúdo | Quem escreve |
|---|---|---|
| `state/mode.json` | Estado global (`ok\|lang_degraded\|unknown_regime\|crisis_lock\|frozen_autonomy`) + histórico de transições | Runtime/cron apenas |
| `state/model_registry.json` | Champion/challenger de `model_param` (v17) e `model_lang` (v10) | Challenger-loop |
| `config/risk_config.json` | Limites de risco + kill switches (envelope humano) | Só humano |
| `config/dag_edges.json` | DAG vivo de edges tese→feature | Humano (promove da quarentena) |
| `config/dag_edges_quarantine.json` | Edges propostos pelo learner, aguardando review | Learner |
| `logs/episodes.jsonl` | Episódios de decisão com `P_Mparam` sempre logado | Engine |
| `logs/shadow_valid.jsonl` | Validações em shadow | Engine |
| `logs/coherence.jsonl` | Vetos de coerência | Engine |
| `logs/rejected.jsonl` | Decisões rejeitadas (e por quê) | Engine |
| `logs/forward_collection.jsonl` | Coleta forward para OOS | Engine |

**Regra:** memória de estado é apend-only onde possível; `mode.json` carrega `history[]` — nunca sobrescrever sem transição registrada.

## 2. Memória de produto (persistida via Prisma)

`AIInsight`, `ScamReport`, `MarketSnapshot`, `BacktestResult`, `PerformanceSnapshot`, `KnowledgeGraph`, `Embedding` (RAG pgvector), `AuditLog` (hash-chain), `AppLog`, `ScoutSkipStat`, `FeeAuditLog`, `PaperCycleAttempt` — schema completo em `prisma/schema.prisma`.

## 3. Memória do time (humana, no repo)

| Fonte | O que preserva |
|---|---|
| `DECISOES.md` | Log de decisões com contexto (a memória de *por quê*). |
| `SPRINT.md` | Histórico de sprints S01–S32 e o que foi validado em cada uma. |
| `docs/CHANGELOG.md` | Versões de produto. |
| `graft/` | Memória estrutural do código (grafo de símbolos/arquivos, $0). |
| `SECURITY.md` | Registro de hardening (REGs). |
| `logs/*.prior-*` | Crashes/stress anteriores — não deletar sem registrar o aprendizado. |

## 4. Ciclo de aprendizado (obrigatório pós-episódio)

1. **Registrar:** episódio em `logs/episodes.jsonl` com owner e taxonomia (`§12`).
2. **Classificar:** o que falhou — percepção, causal, macro, policy ou feedback?
3. **Propor:** edge em quarentena ou peso novo — **nunca** escrita direta no envelope.
4. **Revisar:** humano avalia quarentena em T_sla 30d ([ITERATION.md](./ITERATION.md)).
5. **Promover ou rejeitar:** com registro; rejeição também é memória (`rejected.jsonl`).

## 5. Higiene de memória

- `.prior-*` e logs grandes: rotacionar, não apagar.
- `state/*.json`: mudança manual só com justificativa no commit/DECISOES.
- Backup de memória de estado entra no [BACKUP_DR.md](./BACKUP_DR.md).

---

**Relacionados:** [ITERATION.md](./ITERATION.md) · [RULES.md](./RULES.md) · [MONITORING.md](./MONITORING.md)
