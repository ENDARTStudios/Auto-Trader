---
name: agent-magpie
description: Magpie como gateway local de LLM para o operador — qualquer modelo com qualquer agente, failover de quota, privacy masking in-memory, tradução de protocolos; ferramenta do Operador para rodar o debate/squad mais barato, não dependência do repo. Não aceita PRs.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/yetone/magpie (acessado 2026-10-31; ~27k★; Go, MIT; ~5.8k commits; explicitamente não aceita PRs)
license: MIT — permissive; doutrina da casa → SPEC-ONLY (infra do operador)
---

# Skill agent-magpie — Gateway local de modelos p/ agentes (ferramenta do Operador)

## 1. Função (evidência do repo)
App desktop + gateway local (`127.0.0.1:3425`) que interpõe entre agentes e provedores: fala OpenAI Chat/Responses, Anthropic Messages e Gemini, **traduzindo entre os formatos** (streaming, tool calls, reasoning). Rewrites atômicos do config de cada agente para apontar ao modelo escolhido. **Failover/routing groups** (quota estourou → próxima conta/modelo, o agente nunca vê o erro; modos smart/order/rotate/usage/pace). **Privacy masking opt-in**: keys/tokens/emails substituídos por placeholders na máquina antes do egress, restaurados na resposta, em memória apenas. Plugins em Bun como middleware (model mapping, system prompts, filtro de palavras sensíveis). Go, MIT, builds multiplataforma + Docker.

## 2. Papel no projeto/skill v1.6
- **Infra do Operador para o debate/squad**: o `M_lang`/debate (§4.5) e os agentes (Doer/Thinker) consomem LLMs com quotas reais — failover transparente evita " IntegrationTimeout"/degradação por quota (cf. `tradingagents-adapter.ts` que já degrada com enrichmentQuality).
- **Privacy masking** valida o nosso poste de `sanitize.ts`/`env.ts`/SECRETS: segredos substituídos in-memory antes do egress é o mesmo princípio do Memory Defense (Hindsight) e do T092 — **nada de segredo real num provedor terceiro**.
- Precedente de arquitetura: gateway de protocolos (Anthropic↔OpenAI↔Gemini) = o que o `llm-extractor.ts` faz pontualmente, do lado deles com tradução completa.

## 3. Guardrails vinculantes
- Ferramenta **do Operador**, na máquina do Operador — o repo não declara dependência, não configura, não commita endpoints/gateways.
- Dados que NUNCA atravessam um gateway externo: `.env`, posições reais, chaves de vault, PII de usuários (`AuditLog`).
- O debate/squad continua **não-calibrando** nada (§0.5) — trocar de modelo não muda a fonte de `P` (`M_param`).
- Challengers de modelo promovidos só por forward OOS (§5.4) — failover de quota ≠ promoção de modelo.

## 4. Contrato (status: SPEC-ONLY)
Sem runtime acoplado e sem config no repo. Uso esperado: o Operador roda o gateway local e aponta seus CLIs (Claude Code/Codex) para ele — fora do git. Documentado aqui como doutrina de **resiliência de quota** + **masking de segredos** para qualquer setup de agentes.

## 5. O que NÃO incorporar
Código Go, o app, "subscription reuse" (usa credenciais de assinaturas para outros agentes — cinza de ToS; rejeitado), sincronização WebDAV/S3 de perfis (superfície de leak).

## 6. Licença
**MIT** — permissive; **SPEC-ONLY** (ferramenta pessoal do Operador; projeto não aceita PRs — feedback via Discord deles).
