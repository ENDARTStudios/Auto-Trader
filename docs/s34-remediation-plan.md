# S34 — Dependency Remediation Plan (T051, 2026-09-24)

> **Status:** PLAN ONLY — nenhum upgrade aplicado nesta tarefa. Nenhum `package.json`,
> `package-lock.json` ou workflow foi alterado. Execução só em branch/staging isolada
> com rollback, após aprovação do Operador.
> **Evidência de entrada:** `npm audit` local (3 moderates, 0 high/critical);
> forense Trivy T054 (CVEs HIGH/CRITICAL em `node-tar`, runs CI 35780453613+).

## 1. Inventário de vulnerabilidades

### 1.1 `npm audit` (2026-09-24, 971 deps: 366 prod / 543 dev)

| Pacote | Range afetado | Severidade | Via | Fix disponível | Classe |
|---|---|---|---|---|---|
| `@vitest/coverage-v8` | 2.1.0-beta.1 – 4.1.10 | moderate | vitest | 5.0.1 (**major**) | dev-only |
| `@vitest/mocker` | 2.1.0 – 4.1.10 | moderate | (transitiva) | 5.0.1 (**major**) | dev-only |
| `vitest` | 2.1.0-beta.1 – 4.1.10 | moderate | @vitest/mocker | 5.0.1 (**major**) | dev-only |

**Leitura:** zero high/critical no `npm audit`. Os 3 moderates colapsam em **um único
upgrade major (vitest 3.x → 5.x)**, dev-only — sem impacto em runtime/prod.

### 1.2 Trivy image scan (CI, `.github/workflows/ci.yml`)

- Pacote: `node-tar` (transitiva na imagem Docker) — CVEs **HIGH/CRITICAL**:
  `CVE-2026-31802`, `CVE-2026-59874`, `CVE-2026-73566`, `CVE-2026-24842`,
  `CVE-2026-26960`, `CVE-2026-59873` (CRITICAL).
- Step opera com `exit-code: "1"` + `continue-on-error: true` (exceção documentada
  D021/DECISOES #34) — **risco aberto, não resolvido**.
- `node-tar` chega via cadeia npm (empacotamento/extração em build). Candidatos a
  fix: bump da dependência raiz que a puxa (a identificar via `npm ls node-tar`
  em staging) ou `overrides` cirúrgico — ambos exigem validação de build/teste.

## 2. Classificação breaking / non-breaking

| Grupo | Ação | Risco | Onde executar |
|---|---|---|---|
| Quick wins non-breaking | `npm audit fix` sem major (se surgir), `overrides` pontual p/ `node-tar` se compatível | baixo–médio | branch `feature/s34-upgrades` + staging |
| Vitest 3.x → 5.x (+ coverage-v8/mocker) | Major dev-only; quebra possível em config de coverage, reporters, API de mocks | médio | branch isolada; rodar `vitest run` full + `test:ci` + CI |
| Majors de runtime (avaliar em staging) | Next, Prisma, React, ESLint, Tailwind — **não mapear versão aqui sem `npm outdated`**; levantar em staging | alto | **nunca direto em `main`** |
| GitHub Actions pins | Ver matriz §4; upgrades só após changelog + PR isolado | baixo–médio | PRs isolados por action |

## 3. Ordem segura de execução (fases)

1. **Fase A — conter o conhecido:** identificar raiz de `node-tar` (`npm ls node-tar`),
   testar `overrides`/bump mínimo em branch; re-rodar Trivy local (`npx trivy fs`)
   ou via CI da branch. Critério: HIGH/CRITICAL zerados sem quebrar `next build`.
2. **Fase B — dev-only majors:** vitest 5.x em branch; gates `vitest run` + `test:ci`
   + chain coverage ≥40% + CI verde.
3. **Fase C — runtime majors:** `npm outdated` completo em staging; um major por vez
   (Prisma → Next → restante), cada um com migração formal (`prisma migrate`,
   codemods) e suíte verde antes do próximo.
4. **Fase D — higiene CI:** Node 20 deprecation + migração `ubuntu-latest` → 26
   (avisos já presentes nos runs); pins §4; remover `continue-on-error` do Trivy
   **somente** após Fase A verde ou aceitação formal de risco (D-nova).

## 4. Matriz de GitHub Actions pins (estado atual)

| Action | Pin atual | Nota S34 |
|---|---|---|
| `actions/checkout` | v4 | acompanhar v5 (Node 24 runtime) — PR isolado |
| `actions/setup-node` | v4 | idem; alinhar com upgrade Node CI |
| `oven-sh/setup-bun` | v2 | manter; revisar changelog antes de bump |
| `gitleaks/gitleaks-action` | v2 | **não mexer** sem motivo (T056 estabilizou) |
| `codecov/codecov-action` | v4 | manter (`fail_ci_if_error: false` já) |
| `aquasecurity/trivy-action` | v0.36.0 | manter até Fase A concluir |
| `github/codeql-action/*` | v3 | **deprecação dez/2026** → migrar p/ v4 em PR isolado (Fase D) |
| `zaproxy/action-baseline` | v0.12.0 (zap.yml) | revisar em Fase D |

## 5. Estratégia de branch/staging/rollback

- Branch: `feature/s34-upgrades` a partir de `main` verde; PRs pequenos por fase.
- Staging: validar `next build` + `test:ci` + e2e + codeql + Trivy + smoke T058 antes
  de qualquer merge em `main`. Deploy staging já stubado (`deploy-staging`,
  requer `STAGING_ENABLED=true` + aprovação do Operador).
- Rollback: `git revert` do PR de upgrade; imagem Docker anterior tagueada;
  `fly releases rollback` (docs/DEPLOY); lockfile nunca editado à mão.
- Proibido: majors direto em `main`; desabilitar Trivy/Gitleaks/CodeQL/audit/hooks;
  remover `continue-on-error` do Trivy sem D-nova.

## 6. Impacto em base frozen

`src/lib/chain/*`, `src/signer/*`, `src/lib/audit/*`, `src/lib/trading/wallet-crypto.ts`
**não são tocados** por upgrades de deps salvo incompatibilidade comprovada
(ex.: major do Node mudando `spawn`/sockets, Prisma mudando client). Qualquer toque
exige tarefa própria com evidência de quebra real.

## 7. Decisão pendente do Operador

- [ ] Autorizar branch `feature/s34-upgrades` + staging (Fase A).
- [ ] Aceitar risco temporário dos CVEs `node-tar` até Fase A, ou exigir contenção imediata.
- [ ] Cronograma: Fase A estimada curta (dias); Fases B–D conforme carga de T052.

## 9. Phase A — status de execução (T061, branch `chore/s34-phase-a-ci-hygiene`)

> Aplicado (não-breaking, com leitura de changelog):
> - `ubuntu-latest` → `ubuntu-24.04` em todos os jobs de `ci.yml` (ci, codeql,
>   deploy-staging, e2e) e `zap.yml` — elimina migração surpresa p/ Ubuntu 26.
> - CodeQL `v3` → `v4` (init/autobuild/analyze) — migração oficial GitHub
>   (blog 2025-10-28); nosso uso só tem input `languages` (inputs removidos
>   `add-snippets`/`cleanup-level` não usados); v4 roda em Node24, suportado
>   nos runners hospedados.
> - `fetch-depth: 0` do job ci e `continue-on-error` do Trivy **preservados**.
>
> Avaliado e ADIADO com justificativa (fora da Phase A):
> - `actions/checkout v4→v5` / `setup-node v4→v5`: v5 exige runner ≥v2.327.1 e
>   muda runtime p/ Node24; setup-node v5 ainda liga cache automático por
>   padrão (mudança de comportamento em workflow com segredos) e checkout v5
>   teve incidente de compat (#2240). v4 segue funcional (só warnings).
>   Reavaliar após estabilização do ecossistema, em PR próprio.
> - `codecov-action v4`, `setup-bun v2`, `trivy-action 0.36.0`,
>   `gitleaks-action v2`, `zaproxy v0.12.0`: mantidos — sem depreciação
>   bloqueante; gitleaks estabilizado em T056 (não mexer).
>
> Verificação T061: PR da branch + CI verde (ci/e2e/codeql/gitleaks) antes do merge.

## 10. Phase B — resultado: BLOCKED sem fix não-breaking (T069, branch `chore/s34-phase-b-nonbreaking`)

> Nenhum `package.json`/`lockfile`/`Dockerfile`/workflow foi alterado.
> Evidência abaixo; conclusão: outcome (B) do critério T069.

### 10.1 Baseline

- `npm audit --audit-level=high`: só 3 moderates (cadeia vitest → fix exige
  major 5.0.1 = breaking, proibido). **Zero high/critical no audit.**
- `npm ls node-tar` e `npm ls tar`: **vazios** — o pacote vulnerável NÃO está
  na árvore npm do projeto.

### 10.2 Causa raiz provada (comando reproduzível)

`node:20-slim` recém-puxado (`sha256:2cf067...`) embarca **npm 10.8.2 com
`tar@6.2.1`** em `/usr/local/lib/node_modules/npm/node_modules/`:

```sh
docker run --rm node:20-slim ls /usr/local/lib/node_modules/npm/node_modules/ | grep tar
# tar
docker run --rm node:20-slim cat /usr/local/lib/node_modules/npm/node_modules/tar/package.json | grep version
# "version": "6.2.1"
```

O Trivy escaneia a imagem e encontra esse `tar` do npm embarcado — fora do
alcance de `overrides`/lockfile do app.

### 10.3 Por que não há fix não-breaking

- Maintainer (`isaacs/node-tar#449`, 2026-01-17): **recusa backport para 6.x**,
  recomenda `tar@7`, vai depreciar tudo pré-v7. O "workaround 6.2.2" citado em
  outro projeto foi desmentido como conselho errôneo.
- Fixes exigem `tar@7.5.11+` (até 7.5.22), i.e. **major + troca de licença
  ISC → BlueOak-1.0.0**. Não existe patch 6.x seguro.
- Opções reais tocam `Dockerfile`/toolchain e estão FORA do escopo T069
  (arquivos afetados não incluem `Dockerfile`):
  - (a) `npm install -g npm@latest` no build (npm 11 embarca tar 7);
  - (b) bump de base `node:20-slim` → `node:22/24-slim` (runtime major);
  - (c) remover npm do stage runner (entrypoint `node` direto).
- Exposição real: `src/` nunca importa `tar`; o pacote é exercido só via npm
  embarcado (build `npm ci`/`prune`, `npm start`). Isso **contextualiza, sem
  rebaixar** o veredicto HIGH/CRITICAL do scanner.

### 10.4 PROPOSTA (Phase C isolada, para decisão do Thinker/Operador)

1. Branch `feature/s34-tar7-toolchain` a partir de main verde; aplicar UMA
   opção ((a) preferida: menor diff) com rebuild + Trivy + suíte verde.
2. Validar em staging (smoke T058-like) antes de qualquer merge.
3. Só então decidir sobre `continue-on-error` do Trivy (manter até verde ou
   aceitação formal de risco).
4. Rejeitado: `overrides tar@7` no app (tar nem está na árvore; override
   fantasma não remove o tar do npm embarcado), patch 6.x (inexistente),
   major npm em main sem staging.

## 11. Phase C — diagnóstico hipótese (a): npm@11.20.0 pinado (T072)

> Branch `feature/s34-tar7-toolchain`. Status: diagnóstico local VERDE;
> veredicto Trivy delegado ao CI do PR (sem Trivy local).

### 11.1 Implementação (mínima, pinada)

- `Dockerfile`: `RUN npm install -g npm@11.20.0 --no-audit --no-fund` nas 3
  stages que usam npm (deps/builder/runner). Node runtime permanece 20.
  **NÃO** usado `npm@latest` solto; versão exata pinada.
- `.dockerignore` criado (não existia): contexto caiu de **~1.8GB para build
  de 66s**. Exclui node_modules/.next/.git/*.db/secrets/logs — também fecha
  vazamento de segredos/DB para o contexto de build.

### 11.2 Evidência local (docker 29.8.0, base `node:20-slim` digest `2cf067`)

- Imagem `autotrader-phasec` (2.43GB): `npm -v` → 11.20.0,
  `tar` embarcado → **7.5.22** (linha corrigida), `node -v` → v20.20.2.
- `npm ci` + `prisma generate` + `next build` + `npm prune` verdes no build.
- Runtime: `/api/health` → **200** via `node .next/standalone/server.js`.
- Lockfile do repo **intocado** (`git status` limpo para package*.json).

### 11.3 Achado adicional (pré-existente, fora do escopo do fix)

- `CMD ["npm","start"]` → script `start` invoca **`bun`**, ausente na imagem
  (`sh: 1: bun: not found`). A imagem atual **nunca inicializa** por esse
  entrypoint, com npm 10 ou 11. Requer follow-up próprio (trocar CMD para
  `node`, com validação de staging) — NÃO corrigido aqui para manter o diff
  mínimo e revisável.

### 11.4 Trivy — veredicto CONFIRMADO no CI do PR (run `36065096390`)

Hipótese (a) **confirmada end-to-end**: zero ocorrências dos 7 CVEs node-tar
rastreados (`CVE-2026-31802/59874/73566/24842/26960/59873/23745`) e zero linhas
de pacote `node-tar` na tabela Trivy da imagem do branch. Jobs ci/e2e/codeql/
gitleaks verdes no mesmo run.
- Restam 65 achados (HIGH 59 / CRITICAL 6) em pacotes **OS Debian bookworm**
  (util-linux, gzip, libacl, libblkid, libcap2…) — backlog distinto (patch de
  SO via `apt upgrade` ou base atualizada), fora do escopo node-tar.
- Recomendação: merge da Phase C + follow-up para OS patching + entrypoint
  `bun` (achado §11.3), com staging/smoke antes de qualquer `continue-on-error`
  do Trivy ser revisto.

## 8. Verificação desta tarefa (planejamento)

```sh
cat docs/s34-remediation-plan.md | grep -E 'CVE|Major|Staging|Rollback'
```

> Critério T051: inventário + classificação + ordem segura + branch/staging +
> rollback + matriz de pins + higiene CI + decisão Trivy — todos acima, sem
> execução de upgrades.
