# Pendências do Operador — Auto Trader (2026-09-25)

> Estado da base: `main` verde (CI `36060538217` success — ci/e2e+axe/codeql/gitleaks).
> T069 outcome B registrado (node-tar no toolchain da imagem; Phase C proposta).
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

## 3. S34 fases B/C/D — Phase C proposta (aguardando decisão Thinker/Operador)

- Phase B encerrada outcome B: `node-tar` HIGH/CRITICAL mora no npm embarcado
  de `node:20-slim`, sem fix não-breaking (ver plano §10).
- PROPOSTA: branch `feature/s34-tar7-toolchain`, opção (a) `npm@latest` no
  build, staging + rollback; só então decidir `continue-on-error` do Trivy.
- Majors npm seguem proibidos em `main` sem staging. T073 prepara harness T058.
