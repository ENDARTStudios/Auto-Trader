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

## 8. Verificação desta tarefa (planejamento)

```sh
cat docs/s34-remediation-plan.md | grep -E 'CVE|Major|Staging|Rollback'
```

> Critério T051: inventário + classificação + ordem segura + branch/staging +
> rollback + matriz de pins + higiene CI + decisão Trivy — todos acima, sem
> execução de upgrades.
