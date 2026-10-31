---
name: agent-agentmemory
description: Agentmemory como doutrina de memória persistente — captura por hooks, fusão BM25+vetor+grafo (RRF), consolidação 4-tier, privacy-first, proveniência. Espelha §5.2 com um nível a mais.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/rohitg00/agentmemory (acessado 2026-09-12; 28.4k★, Apache-2.0; LongMemEval-S R@5 95.2%)
license: Apache-2.0 — doutrina (memória própria em logs/*.jsonl; nada a instalar)
---

# Skill agent-agentmemory — Doutrina de memória

## 1. Função (evidência do repo)
Memória persistente p/ coding agents: auto-captura via hooks (zero esforço), recall BM25+vetor+grafo com fusão RRF, **consolidação 4-tier** (working→episodic→semantic→procedural, com decay Ebbinghaus + auto-forget + detecção de contradição), privacy filter (strip secrets antes de armazenar), proveniência de escrita imutável, viewer :3113, session replay, keyless (BM25) ou local embeddings.

## 2. Papel no projeto/skill v1.6
- **§5.2 Memórias (3 níveis):** episodic (`logs/episodes.jsonl:1`), semantic (regras extraídas), procedural (`model_registry.json:1`) = o 4-tier deles menos o working (nosso working = contexto da sessão). Precedente para **decay + auto-forget + contradição** nos nossos logs (hoje append-only puro — evoluir com TTL por severidade).
- **Proveniência:** `origin channel` imutável = nosso `decision_source` + `lang_filter_applied` + owner (§5.3b).
- **Privacy-first:** strip de secrets antes de persistir = nosso `redact` (observability) + `sanitize` RLS.

## 3. Guardrails vinculantes
- Memória **nunca** contém secrets/chaves (`ENCRYPTION_KEY`, `SESSION_SECRET`, `mfaSecret`, `privateKeyEncrypted`) — fence igual ao de risco.
- Recall alimenta contexto, nunca decide (memória é percepção, não Camada 4).

## 4. Contrato (status: DOCTRINE)
Sem servidor externo. Adoção = evoluir `logs/*.jsonl` com consolidação (episodic→semantic) + TTL + replay de sessão em tooling futuro.

## 5. O que NÃO incorporar
Daemon externo, embeddings obrigatórios, dependência de rede para lembrar.

## 6. Licença
**Apache-2.0 — doutrina apenas.**
