# Pendências do Operador — Auto Trader (2026-09-25)

> Estado da base: `main` verde (CI `36156480225` success — ci/e2e/codeql pós-merge PR #30).
> node-tar HIGH/CRITICAL **mitigado** (PR #29, tar 7.5.22) e Phase C2 **concluída** (PR #30, Trivy 65→56, 9 CVEs OS tratáveis zerados).
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

## 3. S34 — Phase C2 concluída (T082/PR #30); 52 achados OS bookworm abertos

- node-tar HIGH/CRITICAL: **mitigado** (PR #29 em main; tar 7.5.22; zero ocorrências).
- Phase C2: **concluída** (PR #30, merge `77b5e7e`; D040) — 9 CVEs OS remediáveis zerados (Trivy 65→56); `continue-on-error` mantido.
- OS Debian bookworm: **52 achados sem fix upstream permanecem abertos** — risco residual sem aceite. Exit-1 do Trivy = backlog OS, NÃO exceção node-tar. Imagem NÃO declarada totalmente segura.
- Pendências internas (não do Operador, sem bloquear T058): T080 hardening compensatório (próximo caminho crítico), T078 docs bun vs Node (após T080), T081 aceite formal **somente após T080 + decisão explícita do Operador**.
