---
name: agent-agent-reach
description: Agent-Reach como camada de coleta social/sentimento — Twitter/Reddit/YouTube/GitHub/Bilibili/Xiaohongshu/RSS/Exa, grátis, cookies locais, roteamento preferido+fallback com doctor. Alimenta pilares N/R/M da bolha.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/Panniantong/Agent-Reach (acessado 2026-09-12; 79.5k★, MIT; capability layer, não ferramenta)
license: MIT — spec de coleta (credenciais só locais do operador, nunca no repo)
---

# Skill agent-agent-reach — Olhos sociais da bolha

## 1. Função (evidência do repo)
Capability layer que dá ao agente "olhos na internet": Twitter/X, Reddit, YouTube (legendas), GitHub (`gh`), Bilibili, Xiaohongshu, Facebook/Instagram (login local), LinkedIn, RSS (`feedparser`), busca semântica (Exa), V2EX/雪球; **roteamento preferido+fallback por plataforma** + `doctor` (diz o que funciona e por onde); cookies só locais (`~/.agent-reach`, 0600); grátis.

## 2. Papel no projeto (Camada 1–2, pilares N/R/M §2.2)
- **N (Narrative Power):** ubiquidade da tese em Twitter/YouTube/Bilibili → `narrativeHeat` (`perception-enrichment.ts:1`).
- **R (Retail Inflow Late):** buscas/downloads/"como comprar X" → `retailInflowZ`.
- **M (Reflexivity/Media):** lead-lag notícia↔preço → `mediaLeadLag`.
- **Roteamento com fallback + doctor** = nosso `enrichmentQuality` (cobertura/frescura/consistência) + degradar sem travar (TA opcional).

## 3. Guardrails vinculantes
- Coleta **pública ou com conta descartável do operador**; credenciais nunca no repo/env commitado; cookies 0600 locais.
- Anti-ban: respeitar ToS/rate-limit das plataformas; sem scraping agressivo (OTT moral: breach → degrada fonte, não força).
- Sinais sociais entram como **pilares N/R/M**, nunca como probabilidade (debate só modula sizing via conviction, §0.5).
- Divergência social-vs-preço em virada = `divergence_as_signal` (§0.5b), não veto cego.

## 4. Contrato (status: SPEC-ONLY)
Sem daemon acoplado hoje. Se ativado: job isolado, artefatos JSON → ETL com `DataSource` + timestamp, `data_quality_score` por fonte.

## 5. O que NÃO incorporar
Credenciais em repo, bypass de paywall/login, dependência de fonte social para operar (social é opcional, como sentimento).

## 6. Licença
**MIT — spec de coleta; operação segue ToS das plataformas + LGPD.**
