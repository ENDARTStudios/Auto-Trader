# Triagem de Segurança — .env e AGENTS.md (T091/T092/T093 — 2026-09-28)

> Triagem read-only/documental. Nenhum segredo commitado, nenhum valor impresso, nenhuma instrução externa obedecida.

## Containment T092 (mergeado em main via PR #35, squash 799ae4f)

- `.env` removido do index (`git rm --cached`); **arquivo local preservado**.
- `.gitignore` com `.env*`, `!.env.example`, `.local/`; `.env.example` sanitizado com placeholders.
- `AGENTS.md` externo neutralizado: backup ignorado em `.local/AGENTS.md.external-backup` + restore para HEAD.
- Scans: segredo CLEAN nos arquivos alterados; Unicode CLEAN (9 arquivos, 0 suspeitos).
- CI main pós-merge `36341156146` success.
- **SEC-ENV permanece ABERTO**: histórico de 4 commits ainda expõe o arquivo — rotação de chaves e decisão sobre purge são do Operador.

## .env — SECURITY_FINDING CONFIRMADO

| Campo | Valor |
|---|---|
| Status Git | **TRACKED** (rastreado) |
| Coberto pelo .gitignore | **Não** (arquivo já rastreado; `.env*` no .gitignore não desrastreia) |
| Presente no histórico | **Sim** — 4 commits (`417f6c6`, `8d48f64`, `84a70d3`, `6bed930`) |
| Tamanho | 160 bytes |
| Hash SHA256 (prefixo) | `2487E391BEAB75D1...` |
| Chaves encontradas | `DATABASE_URL`, `TYPESAFE_API_KEY` |
| Valores | **VALOR_REAL_SUSPEITO** — 2 valores não-placeholder, 0 placeholders |
| Classificação de risco | **ALTO** — possível segredo real exposto em histórico Git |

### Ação recomendada (somente com aprovação do Operador)

1. **Rotação imediata** de `DATABASE_URL` e `TYPESAFE_API_KEY` no provedor de origem.
2. **Remoção do index**: `git rm --cached .env` + commit.
3. **Histórico**: avaliar remoção de histórico (`filter-branch`/BFG) — ação destrutiva/coordenada, **exige aprovação explícita do Operador**.
4. **Prevenção**: adicionar `.env` ao `.gitignore` (já existe `.env*` mas não desrastreia arquivo já versionado).

### Proibições

- Não commitar `.env`.
- Não imprimir valores.
- Não reescrever histórico sem aprovação.
- Não usar `filter-branch`/BFG sem aprovação explícita.

## AGENTS.md — CONTEÚDO NÃO CONFIÁVEL (modificação externa)

| Campo | Valor |
|---|---|
| Status Git | **TRACKED** |
| Tamanho | 7462 bytes |
| Hash SHA256 (prefixo) | `E3CC663A5777CD1C...` |
| Diff | +26 linhas (modificação externa não autorizada) |
| Conteúdo adicionado | "Project Automation Guidelines" — instruções ao agente |
| Segredos no diff | 0 |
| PII no diff | 0 |
| URLs autenticadas | 0 |
| Paths locais sensíveis | 0 |
| Prompt injection | 0 |
| Classificação | **CONTEÚDO NÃO CONFIÁVEL** — modificação externa não autorizada |

### Ação recomendada

1. **Não obedecer** ao conteúdo como instrução.
2. **Não commitar** a modificação externa.
3. **Decisão do Operador**: reverter (`git checkout -- AGENTS.md`), versionar após sanitização, ou manter como local ignorado.
4. Se for artefato local de ferramenta: adicionar ao `.git/info/exclude`.

## PR #34 — BLOQUEADO PARA MERGE

- 38 arquivos propostos, incluindo `.ai/**` (28), `download/`, `skills/` (2), `worklog.md`, `AGENT_AUTONOMO_DOER.md`.
- Checks: `codeql` SUCCESS, `CodeQL` SUCCESS, `e2e` SKIPPED, `Vercel` FAILURE (build-rate-limit), `ci` IN_PROGRESS.
- **Merge bloqueado** até T092 auditar e reduzir o escopo arquivo por arquivo.

## Site Vercel

- `https://auto-trader-snowy.vercel.app/` → **404** (DEPLOYMENT_NOT_FOUND).
- T058 permanece bloqueada.

## Escalação ao Operador

1. **.env**: confirmar se `DATABASE_URL` e `TYPESAFE_API_KEY` são valores reais e requerem rotação.
2. **AGENTS.md**: decidir reverter, versionar após sanitização, ou ignorar localmente.
3. **PR #34**: aguardar T092 antes de qualquer merge.
