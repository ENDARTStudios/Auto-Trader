---
name: agent-strix
description: Strix como doutrina red-team — pentest agêntico multi-agente com PoC real (não só scanner), skills p/ agentes, CI gate com exit code, auto-fix como PR. Padrão do nosso redteamx2 + CI security.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/usestrix/strix (acessado 2026-09-12; 61.9k★, Apache-2.0; OWASP Top 10, CVSS)
license: Apache-2.0 — doutrina (red-team próprio em CI; sem rodar contra terceiros)
---

# Skill agent-strix — Doutrina red-team

## 1. Função (evidência do repo)
Pentest agêntico autônomo: multi-agentes (recon/exploit/post-exploit colaborando), **validação com PoC real** (não só scanner — sem falso-positivo de legado), 9 skills p/ coding agents, **CI gate** (`strix -n`, exit não-zero com vuln, escopo em diff do PR), auto-fix como PR, OWASP Top 10 + CVSS, viewer local, aviso explícito de uso autorizado.

## 2. Papel no projeto/skill v1.6
- **Red-team (§5.8):** "PoC real, não scanner" = nosso `redteam_heuristic = causal_coherence_check` (Granger/base-rate nos dados, §5.8c) + LLM de família distinta (§5.8b) + métrica `overlap` anti-lobo-com-lobo.
- **CI security (Fase 8):** gate com exit code em diff de PR = nosso `npm audit --audit-level=high` + CodeQL + Trivy (`ci.yml:1`) + ZAP semanal (`zap.yml:1`). Strix-conceito valida a pilha.
- **Auto-fix como PR:** correção proposta como diff revisável = nosso fluxo Issue→PR (`AGENT_GUIDE.md:1`), nunca auto-merge em segurança.

## 3. Guardrails vinculantes
- Red-team filtra **plausibilidade**, não julga verdade (§5.12: verdade = forward OOS).
- Testes de segurança **só** contra o próprio repo/staging com autorização; nunca contra terceiros (ilegal na maioria das jurisdições).
- Finding sem PoC/reprodução = hipótese, não veto (anti-teatro §4.5).

## 4. Contrato (status: DOCTRINE + CI existente)
Sem CLI acoplado hoje. Adoção = disciplina red-team + gates já existentes; avaliar `strix -n` no próprio repo como job opcional futuro (requer `STRIX_LLM` + `LLM_API_KEY` — orçamento).

## 5. O que NÃO incorporar
Pentest contra terceiros, auto-fix sem review humano, cloud com código do projeto sem DPA.

## 6. Licença
**Apache-2.0 — doutrina; uso autorizado apenas.**
