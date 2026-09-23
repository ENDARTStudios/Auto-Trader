# ROADMAP — Auto Trader

> **Versão:** 1.0 — 2026-09-23
> **Fonte viva:** `PLANO_MESTRE.md` (fases) + `SPRINT.md` (sprints) + `HARDENING-ROADMAP.md` (segurança).
> Este doc é o resumo navegável; os arquivos-fonte prevalecem.

---

## Passado — concluído (S01–S32 + CI hardening)

| Fase | Entregas |
|---|---|
| Foundation (S01) | Wiring docs→runtime: FeatureFlag table, headers HSTS/CSP, SEO canonical/OG, ErrorBoundary, rate-limit, vitest/playwright. |
| Auth & RBAC (S02–S04) | `User/Session/AuditLog`, bcrypt 12, sessão opaca, RBAC 4×24, RLS por `ownerId`, login UI, MFA TOTP, admin UI users. |
| Engine & skill (S05–S12) | Loop SCOUT→…→REBALANCE, paper trader, scam detector multicamada, circuit breakers, skill bubble/macro 5 camadas, envelope write-fence. |
| ETL crypto-only (S13b) | CoinGecko + DexScreener + GoPlus + Etherscan (remoção de escopo errado futebol). |
| pgvector + ollama (S13) | RAG local com `nomic-embed-text`, `Embedding`/`KnowledgeGraph`. |
| Signer isolation (H0–M4) | Vault KDF versionado, hash-chain audit, rotação de chaves, RPC resilience, sim gates, MEV baseline, broadcaster — **frozen**. |
| Compliance (S28–S30) | privacy/terms, pricing, billing Stripe, auditoria. |
| i18n + graft (S31) | `messages/{pt-BR,en-US,es-ES}.json`, grafo de contexto graft. |
| Qualidade (S32) | Lint 57→0, audit 29→9, docs verificados, 0 pendências. |
| CI hardening (T050–T054) | Chain de coverage fechada, skip condicional Unix-socket no Windows, docker fixes (node-gyp, install-git-hooks), causa raiz Trivy `continue-on-error` (CVEs node-tar) documentada. |

## Presente — estabilização (setembro/2026)

- **CI verde e honesto:** Trivy sem `continue-on-error` mascarando CVEs; triagem de CVEs restantes (node-tar e dependências transitivas).
- **Coverage baseline:** manter thresholds do Vitest + Codecov; chain de coverage T050-T054 fechada.
- **Envelope humano em operação:** review T_sla 30d de `risk_config.json`/`dag_edges.json` ativo (SLO, não decorativo).

## Futuro — próximas fases

| Fase | Escopo | Gate de saída |
|---|---|---|
| **F: Graduação paper→live** | N ciclos paper lucrativos → liberação controlada de live (`graduation.ts`), começando por 1 ativo/1 thesis. | Equity curve positiva + kill switches testados em paper. |
| **S14: Execução real** | Execução com envelope humano ativo; external systems ainda advisory-only. | Aprovação explícita do operador + `mode.json = ok`. |
| **Multi-chain** | Ampliar scanner para além de Arbiscan/Basescan/Optimistic (Base, Solana via fontes gratuitas). | Scam detection com FP igual ou menor. |
| **Staging real** | Ativar job `deploy-staging` (Fly.io) — hoje é stub (`vars.STAGING_ENABLED`). | `/api/health/ready` verde em staging. |
| **Evolução autônoma madura** | Challenger-loop promovendo `model_param_v18+`/`model_lang_v11+` com forward OOS obrigatório. | Brier 30d melhor que champion. |
| **Escalabilidade DB** | SQLite dev → PostgreSQL+pgvector como default de produção. | Migrations + backup/DR validados. |

## Princípios de priorização

1. **Segurança de capital > feature.** Nada entra na frente de kill switches / envelope funcionando.
2. **Gate antes de escopo:** cada fase tem critério de saída mensurável.
3. **Paper é produção:** mudanças no engine passam pelo mesmo rigor de CI/review.
4. Sem `stop/invalidação/forward` definível para uma fase = ela não começa (regra da skill, `§3`).

---

**Relacionados:** [TASKS.md](./TASKS.md) · [ITERATION.md](./ITERATION.md) · [../PLANO_MESTRE.md](../PLANO_MESTRE.md) · [../SPRINT.md](../SPRINT.md)
