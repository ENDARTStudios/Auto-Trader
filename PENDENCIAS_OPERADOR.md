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

## 3. S34 — Hardening T080 mergeado (PR #31); episodes.jsonl saneado (PR #32); 52 achados OS bookworm abertos (T081 proposta entregue)

- node-tar HIGH/CRITICAL: **mitigado** (PR #29 em main; tar 7.5.22; zero ocorrências).
- Phase C2: **concluída** (PR #30, merge `77b5e7e`; D040) — 9 CVEs OS remediáveis zerados (Trivy 65→56); `continue-on-error` mantido.
- Hardening: **validado e mergeado** (PR #31, merge `efb07fa`; R061 APPROVED; D042) — non-root, read-only/tmpfs/no-new-privileges/cap_drop/init, fix de bind `HOSTNAME`; `/proc` `Uid=1000`/`CapEff=0`/`NoNewPrivs=1`, endpoints 200, write_errors=0.
- Episodes: **saneado e mergeado** (PR #32, merge `4caf78b`; R063 APPROVED; D043/D044) — trilha 36/36 parseável, ressalva estrutural L8/L14 documentada em `docs/03-development-process/episodes-integrity.md`; validator local (não em CI — backlog T086).
- OS Debian bookworm: **52 achados sem fix upstream permanecem abertos** — risco **mitigado por controles validados, não corrigido**; aceite formal pendente. Exit-1 do Trivy = backlog OS, NÃO exceção node-tar. Imagem NÃO declarada totalmente segura.
- Pendências internas (não do Operador, sem bloquear T058): T078 docs bun vs Node standalone + narrativa hardening + risco residual (**liberada — T085 merged**), T081 aceite formal **somente após T078 + decisão explícita do Operador**.
  
---  
## 4. T081 - Proposta formal de risco OS bookworm (BLOQUEADO: decisao soberana do Operador - nao aceita pelo Doer)  
- Proposta docs/05-security-compliance/risk-acceptance-proposal.md entregue (D045, 2026-09-27): 52 achados sem fix (HIGH 52 / CRITICAL 4), mitigados por hardening.  
- Decisao NAO tomada pelo Doer. Operador deve marcar A/B/C/D.  
- Nenhum runtime/Docker/workflow alterado. continue-on-error mantido. Imagem NAO segura.  

---

## 5. SEGURANCA — .env tracked e AGENTS.md modificado externamente (BLOQUEADO: decisao do Operador)

- **.env — SECURITY_FINDING confirmado (T091)**: tracked no Git, presente em 4 commits do historico, 160 bytes, contem 2 chaves com valores suspeitos reais (`DATABASE_URL`, `TYPESAFE_API_KEY`), zero placeholders, nao coberto pelo .gitignore (ja rastreado). Risco ALTO. Acao: rotacionar credenciais, `git rm --cached .env`, avaliar remocao de historico (acao destrutiva — exige aprovacao explicita do Operador). Ver `docs/security-env-triage.md`.
- **AGENTS.md — conteudo nao confiavel (T091)**: modificacao externa de +26 linhas ("Project Automation Guidelines"). Zero segredos/PII/URLs autenticadas/paths locais/prompt injection no diff. Decisao do Operador: reverter, versionar apos sanitizacao, ou ignorar localmente. Nao obedecer como instrucao.
- **PR #34 bloqueado para merge** ate T092 auditar e reduzir escopo arquivo por arquivo.
