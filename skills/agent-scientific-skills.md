---
name: agent-scientific-skills
description: Scientific-agent-skills como disciplina de falsificação — 165 skills validadas com teste por skill, time-series forecasting, métodos bayesianos, FRED macro, evidence-traceable writing. Padrão-ouro de validação empírica.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/K-Dense-AI/scientific-agent-skills (acessado 2026-09-12; 44.5k★, MIT; paper arXiv:2609.00065)
license: MIT — disciplina + fontes de dados (FRED), sem copiar skills
---

# Skill agent-scientific-skills — Padrão de validação

## 1. Função (evidência do repo)
165 skills científicas validadas (SKILL.md + exemplos + **test suite por skill que shippa scripts — CI bloqueia sem teste**), 100+ DBs (PubChem/ChEMBL/UniProt/**FRED**/SEC EDGAR...), time-series (aeon, **TimesFM** zero-shot), bayesianos (**PyMC**), RL (**Stable-Baselines3**), escrita evidence-traceable, scanner de segurança semanal, paper descritivo.

## 2. Papel no projeto/skill v1.6
- **Falsificação (§5.12):** "CI bloqueia skill sem teste" = nosso `forward_prediction` obrigatório — sem forward, NO_TRADE. Evidence-traceable writing = nossas citações RAG.
- **Métodos p/ M_param:** TimesFM (forecasting zero-shot) e PyMC (bayesiano) = candidatos a `challenger_param` sob §5.4 (promoção só por forward OOS + MC sizing real).
- **FRED macro:** skill de DB com FRED = fonte candidata p/ `macro_context` (Camada 3: juros/curva/crédito) — via ETL com proveniência `DataSource`.
- **Segurança de skills:** scanner semanal + "não instale tudo" = nossa postura com dependências (`npm audit`, allowlist).

## 3. Guardrails vinculantes
- Método novo entra como **challenger**, nunca direto no champion (§5.4/5.11 canary+kill).
- Dados externos sempre com proveniência + timestamp (`DataSource`, §6.4.3); sem fonte, sem trade direcional.
- Clínico/diagnóstico: fora de escopo total (eles mesmos delimitam; nós nem tocamos).

## 4. Contrato (status: SPEC-ONLY)
Sem instalação do acervo. Adoção = FRED via ETL (quando priorizado) + TimesFM/PyMC como challengers documentados.

## 5. O que NÃO incorporar
Acervo inteiro (bloat), execução clínica, dependência de API paga sem orçamento.

## 6. Licença
**MIT — disciplina e fontes; skills específicas só sob necessidade, uma a uma.**
