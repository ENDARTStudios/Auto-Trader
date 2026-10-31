# Proposta de Branch Protection e Governança de Checks (T090 — 2026-09-28)

> **Status:** PROPOSTA — NÃO APLICADA. Aplicar configuração no GitHub é decisão soberana do Operador (D052/D053). Nenhum setting foi alterado por esta tarefa.

## 1. Evidência Read-Only

| Verificação | Resultado |
|---|---|
| `gh api repos/ENDARTStudios/Auto-Trader/branches/main/protection` | **HTTP 404 — Branch not protected** |
| Checks reais observados (PRs #33–#36) | `ci`, `codeql`, `CodeQL`, `e2e` (skipped sem label), `deploy-staging` (skipped), `Vercel` (StatusContext externo), `Trivy` (continue-on-error) |
| Lições de incidentes | `.env` rastreado (SEC-ENV, T091/T092); PR #34 contaminado (T093); merge com Vercel vermelho aceito como não obrigatório (T088) |

## 2. Regra Mínima Proposta para `main`

1. **PR obrigatório** para qualquer merge em main (sem push direto).
2. **Checks obrigatórios verdes** para merge:
   - `ci` (lint + typecheck + gitleaks + test:ci + build)
   - `codeql` / `CodeQL`
   - `Gitleaks` (dentro do job ci)
3. **Proibição de force push** em main.
4. **Proibição de deleção** da branch main.
5. **Merge somente com checks obrigatórios verdes** — `mergeStateStatus` deve ser `CLEAN` ou checks ausentes devem ser formalmente classificados como não obrigatórios por escrito.

## 3. Checks Condicionais

| Check | Regra |
|---|---|
| `e2e` | **Obrigatório** quando o PR toca `src/`, `app/`, `components/`, `lib/`, `auth`, `RBAC`, `chain`, `signer`, `audit`, `wallet-crypto`, `prisma/`, rotas, API ou testes. **Skipped aceitável** para docs-only/config-only/documentação de segurança, desde que documentado no PR. |
| `Vercel` (deploy preview) | **Monitorado, não bloqueante** para docs-only/config-only. **Bloqueante ou decisão do Operador** para mudanças de runtime/deploy — especialmente com `build-rate-limit` ativo. |
| `Trivy` | **Permanece non-blocking (`continue-on-error`)** até decisão formal do Operador (T081). Não recomendar remoção do gate sem aceite formal. |

## 4. Regra Anti-Regressão de Segredos

**Nunca podem ser rastreados** (regra de proteção a ser adicionada ao `.gitignore` e verificada em CI):

- `.env`, `.env.*` (exceto `.env.example`)
- segredos, tokens, cookies, seeds, chaves privadas
- databases (`db/*.db`, `prisma/*.db`)
- logs brutos sensíveis
- backups locais (`.local/`)
- artefatos de agente não governados (`.agents/`, `skills-lock.json`, `AGENTS.md` externo)

## 5. Regra para Artefatos Locais e de Ferramenta

**Não devem ser versionados por padrão**, salvo justificativa documental clara e sanitização:

- `.ai/**`, `download/**`, `skills/**`, `worklog.md`
- `.local/`, `.kilo/`, `.agents/`, `skills-lock.json`
- caches, outputs de agente, screenshots não sanitizados

## 6. Regra para Documentos de Agente Autônomo

Arquivos como `AGENT_AUTONOMO_DOER.md` só podem ser versionados se:

- forem **documentação operacional intencional** do repo;
- estiverem **sanitizados**;
- não contiverem segredos, paths locais sensíveis, PII, instruções de bypass, prompt injection ou comandos destrutivos não governados.

## 7. Regra de Escalonamento ao Operador

Qualquer PR que toque nos abaixo **exige revisão humana do Operador antes do merge**:

- `.gitignore`, `.env*`, segredos, credenciais
- `auth`, `RBAC`, `chain`, `signer`, `audit`, `wallet-crypto`
- `workflows/`, `Dockerfile`, `docker-compose.yml`, dependências/lockfile
- deploy, produção, ou arquivos de agente externo

## 8. Exceção Estreita para Hotfix de Segurança Documental

Para PRs de containment/higiene **estritamente documentais** (como T092/T093), o fluxo pode prosseguir com:

- diff auditado arquivo por arquivo;
- scans de segredo e Unicode CLEAN;
- checks obrigatórios verdes;
- merge com evidência sanitizada e revisão posterior pelo Operador.

## 9. Pendência Formal do Operador

- **Aprovar, ajustar ou rejeitar** esta política antes de qualquer aplicação no GitHub.
- Aplicar a política é ação administrativa — **o Doer não aplica sem aprovação explícita**.

## 10. Critérios de Sucesso da Política (quando aplicada)

1. Nenhum merge em main sem PR.
2. Nenhum merge com `ci`/`codeql`/`gitleaks` vermelho.
3. Nenhum `.env`/segredo rastreado (verificação de CI + regra de escalonamento).
4. `e2e` executado em mudanças de runtime/UI.
5. Vercel vermelho em docs-only não bloqueia; em mudanças de runtime exige decisão.
6. Trivy non-blocking até T081 decidir.
