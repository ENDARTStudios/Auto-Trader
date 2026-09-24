# Pendências do Operador — Auto Trader (2026-09-24)

> Estado da base: `main` verde (CI `36052370734` success — ci/e2e+axe/codeql/gitleaks).
> A11y automatizada sem exceção solta (T066). Sem bloqueio técnico interno restante.
> NÃO misturar T058 (validação visual) com S14 (live): são decisões separadas.

## 1. T058 — verificação visual/funcional (ESCALADA, aguardando input)

Para executar, o Operador precisa fornecer:

- [ ] URL de staging/demo (ou instruções para subir ambiente local equivalente).
- [ ] Credenciais de teste (viewer/trader), se login for exigido — **nunca credenciais reais de produção**.
- [ ] Confirmação de que tráfego/interação de teste é permitido no ambiente.
- [ ] Janela de disponibilidade para demo/aceite (quando aplicável).

Escopo da verificação (pelo Doer, após input): dashboard, Command Palette (⌘K),
News Panel, Onboarding Wizard, pricing, auth/MFA, fluxos críticos — com
screenshots sanitizados e sem dados reais.

## 2. S14 — live trading (BLOQUEADO, fora do caminho de T058)

Requer, separadamente e só após T058:

- [ ] `BINANCE_TESTNET_API_KEY` + `BINANCE_TESTNET_SECRET`.
- [ ] `ALCHEMY_RPC_URL` (ETH_SEPOLIA) + `ETH_SEPOLIA_PRIVATE_KEY`.
- [ ] `vars.STAGING_ENABLED=true` + aprovação explícita por escrito do Operador.

Sem chaves, `ORCAMENTO_ESTOURADO` mantém live desabilitado por design.

## 3. S34 fases B/C/D — decisão futura (NÃO urgente)

- CVEs HIGH/CRITICAL em `node-tar` (Trivy non-blocking) + majors npm seguem
  abertos e rastreados em `docs/s34-remediation-plan.md`.
- Execução só em branch/staging com rollback, após T058. Operador será
  consultado sobre janela e aceitação de risco antes de qualquer upgrade.
