# Pendências do Operador — Auto Trader (2026-09-27)

> Estado da base: `main` verde (CI `36261942375` success — ci/e2e/codeql pós-merge PR #32, T085).
> node-tar HIGH/CRITICAL **mitigado** (PR #29, tar 7.5.22), Phase C2 **concluída** (PR #30, Trivy 65→56) e hardening **mergeado** (PR #31, D042).
> `logs/episodes.jsonl` **parseável 36/36** (T084/T085, D043/D044) com ressalva estrutural L8/L14 documentada.
> NÃO misturar T058 (validação visual) com S14 (live): são decisões separadas.

## 1. T058 — verificação visual/funcional (BLOQUEADA: URL inválida)

Auditoria T070 (2026-09-24): `https://auto-trader-snowy.vercel.app/` retorna
**`DEPLOYMENT_NOT_FOUND`** em `/`, `/api/health` e `/login`. Não é falha do app.

Para executar, o Operador precisa fornecer:

- [ ] URL válida (redeploy/restauração do Vercel ou novo endereço) respondendo 200.
- [ ] Credenciais de teste (viewer/trader), se login for exigido — **nunca credenciais reais de produção**. Seeds `@local` servem só ao banco local.
- [ ] Confirmação de dataset sanitizado vs dados reais + MFA aplicável.
- [ ] Confirmação de que tráfego/interação de teste é permitido no ambiente.

Escopo da verificação (pelo Doer, após input): dashboard, Command Palette (⌘K),
News Panel, Onboarding Wizard, pricing, auth/MFA, fluxos críticos — com
screenshots sanitizados e sem dados reais.

## 2. S14 — live trading (BLOQUEADO, fora do caminho de T058)

Requer, separadamente e só após T058:

- [ ] `BINANCE_TESTNET_API_KEY` + `BINANCE_TESTNET_SECRET`.
- [ ] `ALCHEMY_RPC_URL` (ETH_SEPOLIA) + `ETH_SEPOLIA_PRIVATE_KEY`.
- [ ] `vars.STAGING_ENABLED=true` + aprovação explícita por escrito do Operador.

Sem chaves, `ORCAMENTO_ESTOURADO` mantém live desabilitado por design.

## 3. S34 — Hardening T080 mergeado (PR #31); episodes.jsonl saneado (PR #32); 52 achados OS bookworm abertos com risco mitigado

- node-tar HIGH/CRITICAL: **mitigado** (PR #29 em main; tar 7.5.22; zero ocorrências).
- Phase C2: **concluída** (PR #30, merge `77b5e7e`; D040) — 9 CVEs OS remediáveis zerados (Trivy 65→56); `continue-on-error` mantido.
- Hardening: **validado e mergeado** (PR #31, merge `efb07fa`; R061 APPROVED; D042) — non-root, read-only/tmpfs/no-new-privileges/cap_drop/init, fix de bind `HOSTNAME`; `/proc` `Uid=1000`/`CapEff=0`/`NoNewPrivs=1`, endpoints 200, write_errors=0.
- Episodes: **saneado e mergeado** (PR #32, merge `4caf78b`; R063 APPROVED; D043/D044) — trilha 36/36 parseável, ressalva estrutural L8/L14 documentada em `docs/episodes-integrity.md`; validator local (não em CI — backlog T086).
- OS Debian bookworm: **52 achados sem fix upstream permanecem abertos** — risco **mitigado por controles validados, não corrigido**; aceite formal pendente. Exit-1 do Trivy = backlog OS, NÃO exceção node-tar. Imagem NÃO declarada totalmente segura.
- Pendências internas (não do Operador, sem bloquear T058): T078 docs bun vs Node standalone + narrativa hardening + risco residual (**liberada — T085 merged**), T081 aceite formal **somente após T078 + decisão explícita do Operador**.
