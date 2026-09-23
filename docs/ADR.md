# ADR — Architecture Decision Records

> **Versão:** 1.0 — 2026-09-23
> **Fonte viva:** `DECISOES.md` (raiz do repo) — este doc indexa e resume; o log completo prevalece.
> **Formato:** cada decisão = número, data, problema, solução, alternativa, arquivos afetados, risco.

---

## Como registrar uma nova ADR

1. Adicione entrada numerada em `DECISOES.md` (Decisão #N) com o formato acima.
2. Se mudar arquitetura/contrato, atualize o doc afetado em `docs/` (ver [README.md](./README.md)).
3. Referencie a ADR na descrição do PR.

## Índice de ADRs (resumo — detalhe em `DECISOES.md`)

### ADR #21 — Ambiente Linux obrigatório (2025-01-20)
O signer process usa Unix domain sockets (`/tmp/signer-*.sock`), sem suporte Windows. Dev/test/deploy em Linux nativo, WSL2 ou Docker. Windows: `SIGNER_SKIP_PRE_PUSH_HOOK=1` apenas como escape hatch (não garante correção). **Alternativa rejeitada:** pipes nomeados/named pipes (complexidade sem ganho).

### ADR #22 — S01 Foundation wiring (2026-08-26)
Docs Dev Skill estavam scaffoldados sem runtime. Solução: wire completo (FeatureFlag model, headers HSTS/CSP em `next.config.ts`, canonical/OG/JSON-LD, ErrorBoundary por painel, rate-limit em 5 rotas críticas, vitest/playwright scripts, seed 9 flags). Princípio: **doc sem código rodando é dívida, não documentação.**

### ADR #23 — Auth foundation: RBAC + RLS (2026-08-27)
Rotas críticas públicas (OWASP A01/A07) → `User/Session/AuditLog` + bcrypt cost 12 + sessão opaca SHA-256 HttpOnly + matriz RBAC 4×24 + `rlsWhere`/`assertOwner` por `ownerId` + audit log com hash-chain. **Alternativa rejeitada:** JWT stateless (revogação de sessão é requisito de kill switch operacional).

### ADR #24 — Frontend auth + route protection (2026-08-27)
Login UI (Zod + skeleton + motion), guard de páginas no `middleware.ts`, badge de usuário no dashboard, `/api/users` super_admin only, e2e `auth.spec.ts`. **Decisção:** guard em middleware (páginas) + `requireSession` (APIs) — dupla camada, sem depender só do client.

### ADR #25 — MFA TOTP + Position RLS + Admin UI (2026-08-27)
2FA TOTP obrigatório para papéis privilegiados; `Position.ownerId` para RLS de posições; UI de gestão de usuários. Detalhe completo em `DECISOES.md` #25.

### ADRs seguintes (#26+)
Ver `DECISOES.md` — incluem M3 signer adapter/handlers/broadcaster, H2 verificação contratual, S13b correção crypto-only ETL, S28–S30 compliance, S31 i18n+graft, S32 qualidade, T050–T054 CI.

## ADRs "constitucionais" (anteriores ao log, firmados no código)

| Decisão | Onde vive |
|---|---|
| Monolito modular (não microsserviços) | [ARCHITECTURE.md](./ARCHITECTURE.md) — escala 100→50k sem overhead de rede. |
| Paper-first com graduação | `src/lib/trading/graduation.ts` — live só após N ciclos lucrativos. |
| Envelope humano write-fence | `src/lib/trading/envelope.ts` — learner nunca escreve em `risk_config`/`mode`/`dag_edges`. |
| M_param e M_lang separados | `state/model_registry.json` — champion `model_param_v17` / `model_lang_v10`. |
| External systems advisory-only | `src/lib/trading/external-systems.ts:1` — zero código copiado de repos copyleft. |
| Signer isolado em processo | [signer-isolation-design.md](./signer-isolation-design.md) — chaves nunca no processo do Next. |
| SQLite dev, Postgres pgvector prod | `docker-compose.yml` + `prisma/schema.prisma`. |

---

**Relacionados:** [RULES.md](./RULES.md) · [CHOOSE_TECH_STACK.md](./CHOOSE_TECH_STACK.md) · [../DECISOES.md](../DECISOES.md)
