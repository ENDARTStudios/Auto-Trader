---
name: agent-diagram-design
description: Diagram-design como padrão de visuais técnicos — 39 tipos editoriais (architecture/sequence/state/ER/timeline/UML) em HTML+SVG autocontido, com gates de validação. Para docs/ARCHITECTURE.md e UML.md.
version: 1.0.0
type: agent-skill
language: pt-BR
source: https://github.com/cathrynlavery/diagram-design (acessado 2026-09-12; 38.5k★, MIT)
license: MIT — padrão de diagramação (gerar nossos próprios SVGs)
---

# Skill agent-diagram-design — Visuais de docs

## 1. Função (evidência do repo)
Skill de diagramas editoriais p/ agentes: 39 tipos (architecture, flowchart, sequence, state machine, ER, timeline, swimlane, quadrant, deployment, dependency, UML class, DB schema...), HTML+SVG autocontido, sem Mermaid genérico; gates (lint-skin, geometria, a11y `role=img`+`<title>`, sem assets remotos/scripts inline); import de draw.io/Mermaid/Excalidraw com fidelity ledger; WCAG AA.

## 2. Papel no projeto (camada docs)
- **Padrão para `docs/ARCHITECTURE.md:1` e `docs/UML.md:1`:** architecture/sequence/state-machine/ER para DAG de decisão (§4.1), state machine (§8) e schema Prisma — em vez de Mermaid genérico.
- **A11y:** todo SVG com nome/descrição acessível; estático por default (sem JS) — eco da nossa postura (docs legíveis sem build).

## 3. Guardrails
- Diagramas documentam o **código real** (gerados após `graft`/leitura, nunca antes); drift doc↔código = bug.
- Sem assets remotos, sem scripts inline em docs (CSP-friendly, como nosso `next.config.ts:12`).
- Nossos `.md` continuam fonte de verdade; SVG é ilustração, não spec.

## 4. Contrato (status: SPEC-ONLY / convenção)
Sem instalação. Adoção = convenção quando um diagrama for pedido/atualizado.

## 5. O que NÃO incorporar
Dependência do skill deles, build de galeria, tracking de marca alheia.

## 6. Licença
**MIT — gerar nossos próprios diagramas no padrão.**
