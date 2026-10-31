---
name: ext-nautilus-agents
description: Nautilus Agents SDK como doutrina de fronteira de autoridade — policies advisory-only (só ReducePosition), engine dona das decisões, shadow evaluation, traces JSONL. Gêmeo filosófico da skill v1.6.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/nautechsystems/nautilus_agents (acessado 2026-09-12; 45★, early alpha Rust, LGPL-3.0 — "Agents SDK for NautilusTrader")
license: LGPL-3.0 — SPEC-ONLY, nenhum código copiado
---

# Skill ext-nautilus-agents — Fronteira de autoridade

## 1. Função (evidência do repo)
SDK Rust para policies de agentes sobre a NautilusTrader: tipos protocolares versionados (identidade, quantidade, digest, observation, proposal, receipt), **uma única** proposta live semântica (`ReducePosition { position_id, instrument_id, quantity }`), `ProposalPolicy` com timeout cooperativo, `AdvisoryValidator` (checks locais que **não decidem** — relatório usa `finding/clear`), `TraceRecorder` JSONL (ReferenceOnly/Redacted/Full + `RetentionClass`), `ShadowEvaluator` (duas policies, mesma observation, sem simular venue), `AgentClient` transport-neutral. **Authority boundary explícita:** "NautilusTrader owns every production decision; may reject a proposal even when every local check is clear."

## 2. Papel na arquitetura v1.6
- **Doutrina §0/§8c:** é a nossa separação M_lang/M_param escrita por terceiros — agente propõe, engine dispõe. Referência normativa para `tradingagents-adapter.ts:1` (`DebateAux` sem `place_order`) e `bootstrap.ts:1` (superfície sem decisão).
- **Taxonomia de vetos (§5.7b/5.7c):** `AdvisoryReport` (evidência local) vs `DecisionReceipt` (resultado público) = nosso `coherence_log` vs `shadow_valid` vs `rejected_thesis` em `logs/*.jsonl:1`.
- **Shadow (§5.10):** `ShadowEvaluator` lado-a-lado sem simular venue = nosso `shadow_valid` + `COWARDICE` só em regime estável.
- **Protocolo versionado:** `ProtocolVersion { major, minor }` viajando com observation/traces = precedente para versionar `MarketSnapshot`/`DebateAux` (`model_registry.json:1`).

## 3. Guardrails vinculantes
- Agente **nunca** recebe autoridade de engine/venue; proposta é semântica e redutora por default (reduzir risco > abrir risco).
- Checks locais advisory nunca viram decisão de produção; rejeição da engine mesmo com tudo `clear` é comportamento **esperado**.
- Recording com retenção explícita (`ReferenceOnly` default) — eco do nosso `sanitize`/RLS.

## 4. Contrato de integração (status: SPEC-ONLY / doutrina)
Sem crate Rust acoplada. Adoção = padrões: tipos versionados, `NoProposal` como default válido, traces por run, shadow lado-a-lado. Se houver bridge futura, só via `AgentClient`-like HTTP com `mode.json:1` gateando.

## 5. O que NÃO incorporar
Código Rust (LGPL + early alpha, "not ready for production"), qualquer execução a partir de policy.

## 6. Licença
**LGPL-3.0 + early alpha — spec/doutrina apenas.**
