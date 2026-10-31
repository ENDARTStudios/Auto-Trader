# QA_TESTING — Plano de QA por Release

> **Versão:** 1.0 — 2026-09-23
> **Base:** [TESTING.md](./TESTING.md) (estratégia) — este doc é o *plano de QA*: o que precisa estar verde e testado para algo contar como pronto.

---

## 1. Gates inegociáveis (qualquer release)

| Gate | Comando/onde | Critério |
|---|---|---|
| Lint | `npm run lint` | 0 erros |
| Tipos | `npx tsc --noEmit` | Limpo |
| Gate completo | `npm run test:ci` | **637 checks** verdes (vault, signer, H0/H1/H2, M3) |
| Unit/coverage | `npm run test:coverage` | Verde + sem regressão de cobertura (chain T050c) |
| Build | `npm run build` | 45 rotas, sem erro |
| Segurança | Gitleaks + `npm audit` + Trivy + ZAP | Verdes, sem CVE mascarada (lição T054) |
| E2E | `npm run test:e2e` | auth/mfa/s27 verdes (chromium + mobile) |

## 2. QA por tipo de mudança (matriz)

| Mudança | QA adicional |
|---|---|
| **Engine/risco** | Cenário paper: 1 ciclo scout→exit observado; episódios em `logs/episodes.jsonl` coerentes; kill switch de mesa testado (`/api/kill-switch` com admin e com viewer) |
| **Auth/RBAC** | Matriz 4 papéis × rotas críticas manual (admin ok, viewer 403); login/logout/TOTP no e2e |
| **DB/migration** | `db push` do zero + restore de backup ([BACKUP_DR.md](./BACKUP_DR.md)); queries de painel com dados |
| **UI/dashboard** | 3 idiomas ([CONTENT.md](./CONTENT.md)); teclado/zoom ([ACCESSIBILITY.md](./ACCESSIBILITY.md)); mobile (Playwright Pixel 7) |
| **API nova** | Exemplos curl na PR; erros com shape estável ([ERROR_HANDLING.md](./ERROR_HANDLING.md)); rate-limit se pública |
| **Infra/Docker** | Build da imagem; `docker compose up -d` + healthchecks (pgvector, ollama) |

## 3. Cenários de regressão prioritários (roda antes de release)

1. **Kill switch end-to-end:** admin aciona → engine para → posições protegidas → audit log com hash-chain cresceu.
2. **Escalonamento impossível:** viewer/trader tentam `/api/users`, kill-switch, config → 403, audit registra.
3. **Feed stale:** fonte externa mockada fora → `close_neutralize` + estado degradado visível.
4. **Envelope intacto:** após qualquer release, `git status` de `config/risk_config.json`/`state/mode.json` sem escrita por código.
5. **Graduação:** N ciclos paper incompletos → live segue bloqueado.

## 4. Bugs: triagem e prioridade

| Severidade | Definição | Ação |
|---|---|---|
| S1 | Perde/arrisca capital, kill switch falha, security | Hotfix imediato + [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md) |
| S2 | Funcionalidade central quebrada (engine parado, auth furada) | Fix antes de qualquer release |
| S3 | Painel/i18n/a11y quebrado sem risco | Backlog [TASKS.md](./TASKS.md) |
| S4 | Cosmético | Backlog baixa |

Bug de risco/securities vira episódio de aprendizado ([MEMORY.md](./MEMORY.md) §4) e, se aplicável, kill switch/critério novo.

## 5. Evidência de release

Anexe na PR de release: output do `test:ci`, cobertura, build, e2e — o mesmo padrão de validação de `DECISOES.md`. Sem evidência, não é release.

---

**Relacionados:** [TESTING.md](./TESTING.md) · [CODE_REVIEW.md](./CODE_REVIEW.md) · [SECURITY_REVIEW.md](./SECURITY_REVIEW.md)
