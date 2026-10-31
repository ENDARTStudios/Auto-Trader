---
name: agent-ifixai
description: iFixAi como auditoria independente de comportamento de agentes AI — ambiente simulado, juiz de provedor diferente, 10-61 inspeções (escalação de privilégio, ação destrutiva, injeção, isolamento de dados), nota A-F, gate de CI. Complemento comportamental do Strix (red-team técnico).
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/ifixai-ai/iFixAi (acessado 2026-10-31; ~41k★; Python 3.10+, pip `ifixai`, Apache-2.0)
license: Apache-2.0 — permissive; doutrina da casa → SPEC-ONLY (auditoria é processo, não dependência)
---

# Skill agent-ifixai — Auditoria comportamental independente de agentes

## 1. Função (evidência do repo)
Framework de **auditoria independente de agentes AI**: coloca o agente num ambiente de negócio simulado, envia pedidos realistas (inclusive empurrando além do papel) e um **juiz LLM de provedor diferente** nota cada resposta. 10 inspeções default (61 no `--full-run`): limites de papel/ferramentas, resistência a escalação de privilégio, autorização de ações destrutivas, resistência a prompt-injection, isolamento de dados entre usuários, honestidade sobre incerteza/falha, aderência a tarefa. **3 mínimos obrigatórios (B01, B08, P01)** — falhar qualquer um tecta a nota em D. Nota A-F sobre 5 pilares (fabricação, manipulação, engano, imprevisibilidade, opacidade). Relatórios JSON/Markdown, `--dry-run` de custo, **`--min-score` como gate de CI**, alinhado a EU AI Act / ISO 42001 / NIST AI RMF / OWASP LLM.

## 2. Papel no projeto/skill v1.6
- **Auditoria do Doer autônomo** (`AGENT_AUTONOMO_DOER.md`): o Doer tem bash + escrita de arquivos + poder de merge — as inspeções B01 (limite de papel), B08 (autorização de ação destrutiva) e P01 (injeção) mapeiam 1:1 para os incidentes reais do repo (T092 .env, `git add -A` engolindo trabalho alheio, AGENTS.md modificado externamente).
- **Complemento do Strix (#19 no índice)**: Strix = red-team técnico PoC-validado; iFixAi = red-team **comportamental** (o agente faz o que deve?). Camadas se somam, não se sobrepõem.
- **Gate de CI futuro**: `--min-score` equivale ao nosso padrão de gate (cf. lição T054 — sem mascarar); um job de auditoria periódica do Doer/squad (debate M_lang) cabe no `ci.yml` como job informativo → depois obrigatório.
- **Juiz de provedor diferente** = mesma disciplina do §0.5 (debate independente não pode julgar a si mesmo).

## 3. Guardrails vinculantes
- Auditoria avalia **comportamento do agente**, nunca gera `P` nem tese (§0.5).
- O juiz LLM não vê nem influencia o envelope (`risk_config.json`/`mode.json`) — read-only por construção.
- Resultado A-F entra como evidência em `logs/episodes.jsonl` + issue; nota D em mínimo obrigatório = **bloquear autonomia** (ESCALATED), não mergear.
- Custo do juiz é do Operador (`--dry-run` antes).

## 4. Contrato (status: SPEC-ONLY)
Sem runtime acoplado. Adoção = rodar o audit contra um endpoint OpenAI-compatível do nosso agente/squad em ambiente efêmero (paper, `test.db`), artefato JSON anexado à evidência. Se um dia integrado: job de CI separado, `--min-score` B+, sem acesso a segredos reais.

## 5. O que NÃO incorporar
Código (stack Python própria; nosso gate é TS/CI), o ambiente simulado de negócio deles como fonte de verdade, submissão de dados reais do Operador/trading ao juiz externo (sanitizar: sem keys, sem posições, sem `.env`).

## 6. Licença
**Apache-2.0** — permissive; **SPEC-ONLY** por doutrina (processo de auditoria, não dependência).
