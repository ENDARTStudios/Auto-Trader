---
name: agent-browser-use
description: Browser-use como coletor web read-only e sandboxed para ETL/sentimento — agentes que usam browser com output estruturado. Leitura, nunca ação; credenciais nunca no repo.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/browser-use/browser-use (acessado 2026-09-12; 114k★, MIT; lib + CLI + cloud)
license: MIT — spec de coleta (execução futura só isolada e read-only)
---

# Skill agent-browser-use — Coleta web sandboxed

## 1. Função (evidência do repo)
Agentes que operam browser como humano: lib Python (`Agent(task, llm)`), CLI p/ agentes existentes, cloud hospedada; output estruturado, custom tools, auth por perfil, CAPTCHA/stealth no cloud; benchmark BU Bench V2; uso gratuito local (modelo/navegador por conta própria).

## 2. Papel no projeto (Camada 1 — perception)
- **Coletor de sentimento/notícias:** páginas de notícias, filings, tendências → `sentiment_vector` + pilares N/R/M (`perception-enrichment.ts:1`) — mesma função dos analysts TA, por outra via.
- **Regra de containment:** job isolado, **read-only** (sem login, sem formulários, sem escrita), allowlist de domínios, timeout + `data_quality_score`; divergência vs primário → penaliza (§4.4d), nunca contamina.

## 3. Guardrails vinculantes
- Sem credenciais em código/docs (SECRETS.md); sem CAPTCHA-bypass em produção; respeitar ToS/robots dos domínios.
- Output sempre passa por `sanitizeHtml` (`sanitize.ts:1`) antes de qualquer render (DOMPurify 5.8).
- Custo de LLM sob `ORCAMENTO_ESTOURADO`: coleta web com modelo só com orçamento aprovado; default = parsers determinísticos.

## 4. Contrato (status: SPEC-ONLY)
Sem runtime acoplado hoje. Se ativado: job isolado fora do processo Next, artefatos JSON → ETL (`src/lib/etl/*:1`), nunca direto no engine.

## 5. O que NÃO incorporar
Cloud com credenciais do projeto, escrita em sites, automação de login, dependência de coleta para operar (TA é opcional — coleta web também).

## 6. Licença
**MIT — spec de coleta apenas.**
