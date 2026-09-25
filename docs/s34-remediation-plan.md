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

### 11.3 Entrypoint corrigido (T074) — era bug pré-existente, agora provado

- `CMD ["npm","start"]` invocava script com **`bun` ausente** na imagem
  (`sh: 1: bun: not found`) — a imagem nunca inicializava, com npm 10 ou 11.
- Fix (só Dockerfile, sem `package.json`): `CMD ["node",
  ".next/standalone/server.js"]` — runtime oficial suportado do standalone
  (docs escolhem bun como ideal, mas node é o fallback validado; sem bun
  pinado para não ampliar supply chain sem necessidade).
- Prova via CMD real (sem `--entrypoint`): rebuild verde; `docker run` sobe;
  logs `✓ Ready`; `/api/health` → **200** em banco efêmero sqlite.
  Container/imagem de teste removidos após evidência.

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


### 11.5 T076 — container serve UI/estáticos/public (prova via CMD real)

Auditoria prévia: runner copia `.next` (inclui `standalone/` + `static/` via
build script), `public`, `prisma`, `.prisma`/`@prisma`; `.dockerignore` NÃO
exclui nenhum deles. `public/` existe (logo.svg, manifest.json, og-image.png,
robots.txt).
Script reutilizável: `scripts/validate-docker-static-t076.mjs`
(`--base-url`, stdlib, timeouts curtos, sem segredos).
Evidência (rebuild + `docker run` via CMD, sqlite efêmero, depois removidos):
- `health-200` PASS (status=200); `login-html` PASS (19KB, Next);
- `static-asset` PASS (`/_next/static/chunks/*.css`, 200, `text/css`);
- `public-asset` PASS (`/robots.txt`, 200).
- Logs: sem `ENOENT`/`MODULE_NOT_FOUND`/missing static. Observação benigna:
  aviso Prisma sugerindo OpenSSL, mas queries executam (`db.reachable=true`).
Nenhuma correção Dockerfile/.dockerignore necessária — cópias já corretas.

## 8. Verificação desta tarefa (planejamento)

```sh
cat docs/s34-remediation-plan.md | grep -E 'CVE|Major|Staging|Rollback'
```

> Critério T051: inventário + classificação + ordem segura + branch/staging +
> rollback + matriz de pins + higiene CI + decisão Trivy — todos acima, sem
> execução de upgrades.

## 12. T075 — triagem OS Debian bookworm + reclassificação do Trivy (2026-09-25)

> Fonte: tabela Trivy do CI run `36065096390` (imagem Phase C): 61 linhas
> CVE-2026 + 4 de outros anos = Total 65 (HIGH 59 / CRITICAL 6). Inventário
> extraído por pacote/CVE/severidade/status; node-tar com ZERO ocorrências.

### 12.1 Inventário por pacote (contagem de CVEs)

- `perl-base` 8 (3 CRITICAL: CVE-2026-13221/42496/8376 — affected/deferred)
- `util-linux*` 35 no conjunto (bsdutils, libblkid1, libmount1, libsmartcols1,
  libuuid1, mount, util-linux, util-linux-extra — 5 cada; mount/nsenter/login)
- `libgnutls30` 5 (2 CRITICAL CVE-2026-33845/42010 + 3 HIGH — **fixed**)
- `libpcre2-8-0` 3 HIGH (**fixed**); `libcap2` 1 HIGH (**fixed**)
- `gzip`, `libsystemd0`, `libudev1`, `libacl1` 1 cada (affected/deferred)

### 12.2 Classificação

- **Remediáveis via update de base (9)**: libcap2×1, libgnutls30×5,
  libpcre2-8-0×3 — status `fixed` (existe versão corrigida no bookworm).
  Candidatos a Phase C2: `apt-get upgrade` no Dockerfile + rescan + staging.
- **Sem fix disponível (52)**: `affected` 45 + `fix_deferred` 7 (Debian
  adiou) — caminho é aceite formal de risco, não patch.
- **Aplicabilidade em runtime (app Node, sem shell-out)**: o app NÃO executa
  mount/nsenter/login (util-linux), perl, gzip binário, nem linka
  gnutls/pcre2 do sistema (Node usa crypto próprio). Exposição direta baixa;
  risco residual existe em superfície compartilhada (kernel-adjacent libs).
- **Gap de controle**: imagem roda como **root** (sem `USER` no Dockerfile),
  FS gravável. Controles propostos: usuário non-root, FS read-only,
  `no-new-privileges`, scan contínuo, janela de remediação.

### 12.3 Reclassificação obrigatória do gate Trivy

- ANTES (T054–T071): exit-1 = "exceção node-tar".
- AGORA (pós-merge #29): node-tar zerado; exit-1 restante = **backlog OS
  Debian bookworm**. `continue-on-error` mantido até T075 virar decisão
  (Phase C2 ou aceite formal). **CI verde ≠ imagem totalmente segura.**
- NÃO recomendado agora: migração Node 24 em produção (sem evidência de
  compatibilidade), distroless (só hipótese futura), `npm@latest` solto.

## 13. T079 — Phase C2 resultado: 9 remediados, 52 restantes (2026-09-25)

> Branch `chore/s34-phase-c2-base-update`, draft PR #30, run `36089136711` success.

- **Antes/depois Trivy**: Total 65 (HIGH 59/CRITICAL 6) → **56 (HIGH 52/CRITICAL 4)**.
- **Zerados os 9 alvos**: CVE-2026-4878, 33845, 33846, 3833, 42009, 42010
  (gnutls+cap), 86145, 89157, 89161 (pcre2) — zero ocorrências, incluindo os
  2 critical do gnutls.
- **Restantes 52**: sem fix upstream (affected/deferred) — caminho é T080
  (hardening) + T081 (aceite formal com Operador).
- Runtime/UI/static provados localmente antes do PR; lockfile intocado;
  digest pinado; sem Node 22/24/distroless.

## 14. T082 — Merge PR #30 e fechamento da Phase C2 (2026-09-25)

> D040 registrada (DECISOES.md #42). Squash merge `77b5e7e`; main pós-merge
> run `36156480225` success (ci 7m40s / e2e 4m14s / codeql 1m51s).

- **Auditoria pré-merge**: `gh pr diff 30 --name-only` = apenas `Dockerfile`,
  `docs/s34-remediation-plan.md`, `logs/episodes.jsonl` (sem package*.json,
  src/, e2e/, workflows, auth/RBAC/chain/signer/audit/wallet-crypto ou schema
  Prisma).
- **Prova imagem vs runner efêmero**: o diff mostra o `apt-get install`
  dentro do **stage runner do Dockerfile** (`FROM node:20-slim@sha256:2cf067…
  AS runner`) e o digest pin nas 3 stages — remediação da imagem distribuída,
  não step temporário de CI. Branch deletada após merge.
- **Estado pós-Phase C2**: node-tar **mitigado** (tar 7.5.22); 9 CVEs OS
  tratáveis **zerados** (Trivy 65→56); **52 achados OS bookworm permanecem
  abertos sem fix upstream** (T080 hardening → T081 aceite formal).
- `continue-on-error` do Trivy **mantido**; CI verde **≠** imagem totalmente
  segura; sem Node 22/24/distroless nesta cadeia.

## 15. T080 — Hardening compensatório implementado e validado (2026-09-26)

> Branch `chore/s34-docker-hardening`, PR draft (não mergear sem REVIEW).
> Runbook completo: `docs/docker-hardening.md`.

- **Build-time (imagem):** `USER node` (non-root padrão, uid 1000),
  `NEXT_TELEMETRY_DISABLED=1`, `HOSTNAME=0.0.0.0` (corrige bind só-no-eth0
  causado por `HOSTNAME=<container-id>` do Docker, que quebrava healthcheck
  intra-container em localhost).
- **Runtime/orquestração:** `--read-only` + `--tmpfs /tmp` +
  `--security-opt no-new-privileges:true` + `--cap-drop ALL` + `--init`;
  serviço `app` no compose (profile `app`, fluxo `up -d` original intacto)
  com os mesmos controles + healthcheck.
- **Validação:** `docker run` hardening → health/login/robots/css 200;
  `next-server` `Uid 1000` / `CapEff 0` / `NoNewPrivs 1`; bind `0.0.0.0:3000`;
  **zero** erros de escrita (EACCES/EROFS/EPERM/ENOENT) nos logs; compose
  `app` `healthy` com flags inspecionados.
- **O que NÃO muda:** 52 achados OS bookworm **permanecem abertos** (hardening
  reduz explotabilidade, não corrige); `continue-on-error` mantido; imagem
  não declarada segura; db/ollama do compose não endurecidos (escopo).
- Próximo: T078 (docs) → T081 (aceite formal com Operador, só após T080 merge).

## 16. T083 - Merge PR #31 e fechamento do T080 (2026-09-26)

- **Audit pre-merge:** `gh pr diff 31 --name-only` = apenas `Dockerfile`, `docker-compose.yml`, `docs/docker-hardening.md`, `docs/s34-remediation-plan.md`, `SECURITY.md`, `logs/episodes.jsonl` (sem `package*`/`src/`/`e2e/`/workflows). Hunk audit: Dockerfile apenas `ENV NEXT_TELEMETRY_DISABLED=1`, `ENV HOSTNAME=0.0.0.0`, `USER node`; SECURITY.md apenas paragrafo T080 (quebra de linha do `continue-on-error` mantida).
- **Merge:** squash `efb07fa` (`ci(docker): hardening compensatory controls (t080) (#31)`); branch `chore/s34-docker-hardening` deletada; `origin/main` = `efb07fa`.
- **CI main pos-merge:** run `36195981127` success - ci 7m32s (lint/typecheck/gitleaks/audit/tests 637/coverage/build/arch/knip/docker build/trivy) / e2e 4m3s / codeql 1m45s / deploy-staging skipped.
- **Estado:** hardening em main; 52 achados OS bookworm **permanecem abertos, com risco mitigado** (nao corrigidos); `continue-on-error` mantido; imagem nao declarada totalmente segura.
- **Decisao:** D042 (`DECISOES.md` #43) - T078 (docs) imediatamente apos; T081 (aceite formal) condicionada a T078.
