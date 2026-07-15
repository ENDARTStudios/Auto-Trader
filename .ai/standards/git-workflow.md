# `standards/git-workflow.md` — Padrões de Git

> Regras detalhadas de commits, branches, PRs. Aplica-se a todo
> repositório do projeto.

---

## Conventional Commits

Toda mensagem de commit segue o padrão Conventional Commits 1.0.0:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types permitidos

| Type       | Quando usar                                              |
| ---------- | -------------------------------------------------------- |
| `feat`     | Nova feature (para o usuário final).                     |
| `fix`      | Bug fix (para o usuário final).                          |
| `docs`     | Mudança em documentação apenas.                          |
| `style`    | Formatação, ponto e vírgula, etc. (não muda lógica).     |
| `refactor`| Refatoração que não adiciona feature nem corrige bug.    |
| `perf`     | Mudança que melhora performance.                         |
| `test`     | Adição/correção de testes.                               |
| `build`    | Mudança em build system, dependências.                   |
| `ci`       | Mudança em CI/CD.                                        |
| `chore`    | Tarefa de manutenção (não classificável acima).          |
| `revert`   | Reverte commit anterior.                                 |

### Scopes permitidos

Scopes são opcionais mas recomendados. Scopes vigentes:

| Scope        | Abrangência                                             |
| ------------ | ------------------------------------------------------- |
| `audit`      | `src/lib/audit/` (H0)                                   |
| `chain`      | `src/lib/chain/` (H1, H2, M3, M4)                       |
| `signer`     | `src/signer/` (M3.2)                                    |
| `runtime`    | `src/lib/runtime/` (M5.0-M5.6)                          |
| `observability` | `src/lib/observability/` (M5.5)                     |
| `trading`    | `src/lib/trading/` (camada de trading não-hardening)    |
| `api`        | `src/app/api/`                                          |
| `ui`         | `src/components/` ou `src/app/`                         |
| `docs`       | `.ai/` ou `docs/` ou `README.md`                        |
| `prisma`     | `prisma/schema.prisma` ou migrations                    |
| `deps`       | `package.json`, lock files                              |
| `ci`         | `.github/workflows/`, scripts de CI                     |

### Exemplos

```
feat(chain): add WriterLease fencing token verification

LeasedBroadcaster now verifies the fencing token before delegating
to Broadcaster. Implements Kleppmann pattern (DEC-003, REG-015/016/017/018).

ADR: .ai/decisions/ADR-0001.md
```

```
fix(signer): prefix signer errors with BROADCAST_SIGNER_*

Without prefix, LeasedBroadcaster misclassified signer errors as
lease errors. Fix preserves public contract (DEC-005).
```

```
docs(ai): expand .ai/ with standards/, contracts/, INDEX.md

Adds 7 architecture files, 4 contracts, 5 standards, 4 context,
4 memory, ADR-0001, INDEX.md. Migrates PROJECT_STATE history to
implementation-history.md.
```

```
chore(deps): bump ethers from 6.10.0 to 6.11.0
```

### Regras

- **Descrição:** imperative mood ("add", não "added" ou "adds").
  Minúscula. Sem ponto final. Máx 72 chars.
- **Body:** explica **o quê** e **por quê**, não **como** (código
  mostra como). Wrap em 72 chars.
- **Footer:** referências a ADRs, DEC-NNN, REG-NNN, issues, PRs.
- **Breaking changes:** footer `BREAKING CHANGE: <descrição>` ou
  `!` após scope (ex.: `feat(api)!: remove v1 endpoints`).

---

## Branches

### Naming

```
<type>/<scope>/<short-description>
```

Exemplos:
- `feat/chain/m4-writer-lease`
- `fix/signer/broadcast-error-prefix`
- `docs/ai/expand-project-os`
- `chore/deps/bump-ethers`

### Branches canônicas

| Branch      | Uso                                              |
| ----------- | ------------------------------------------------ |
| `main`      | Produção. Sempre deployable.                     |
| `develop`   | (opcional) Integração de features antes de main. |
| `feat/*`    | Features em desenvolvimento.                     |
| `fix/*`     | Bug fixes em desenvolvimento.                    |
| `docs/*`    | Documentação apenas.                             |
| `release/*` | Preparação de release (ex.: `release/v1.2.0`).   |
| `hotfix/*`  | Hotfix urgente para produção.                    |

### Regras

- **Nunca** commitar direto em `main`. Sempre via PR.
- **Branches pessoais** (ex.: `joao/feat/...`) são permitidas
  para experimentação; não devem ser mergeadas direto.
- **Branches stale** (sem commit há > 30 dias) devem ser
  deletadas.

---

## Pull Requests

### Tamanho

- **Ideal:** < 400 linhas alteradas.
- **Aceitável:** < 1000 linhas.
- **Bloqueado:** > 1000 linhas sem justificativa explícita no PR
  (ex.: migration automática, rename projetado).

### Estrutura do PR

```markdown
## O quê

<1-2 parágrafos descrevendo a mudança.>

## Por quê

<motivação. Referenciar ADR/DEC/REG se aplicável.>

## Como

<resumo da implementação. Não copiar o diff — explicar decisão.>

## Validação

- [ ] `npm run typecheck` passa
- [ ] `npm run lint` passa
- [ ] `npm run test` passa
- [ ] Testes adversariais relevantes passam (listar REG-NNN)
- [ ] `npm run build` passa
- [ ] Documentação atualizada (`.ai/` quando aplicável)
- [ ] `worklog.md` atualizado

## Riscos

<lista de riscos residuais e mitigações.>

## Rollback

<como reverter se algo der errado.>

## Issue

Fixes #NNN
```

### Reviewers

- **1 reviewer** mínimo para PR < 100 linhas.
- **2 reviewers** para PR > 100 linhas ou que toque arquivos FROZEN.
- **Aprovação explícita do operador** para PRs que tocam arquivos
  FROZEN (Regra 8 CORE_RULES.md).

### CI checks obrigatórios

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run build`
- Testes adversariais do módulo afetado (`npx tsx scripts/test-*.ts`)

PR não pode ser mergeado enquanto qualquer check falhar.

---

## Tags e releases

### Versionamento

Semantic Versioning 2.0.0:

```
MAJOR.MINOR.PATCH
  │     │     │
  │     │     └── bug fixes (backwards compatible)
  │     └──────── features (backwards compatible)
  └────────────── breaking changes
```

### Tags

- Formato: `v1.0.0`, `v1.1.0`, `v1.2.0-beta.1`, etc.
- **Annotated tags** (não lightweight): `git tag -a v1.0.0 -m "..."`.

### Release notes

- Geradas a partir de Conventional Commits (usar
  `conventional-changelog` ou similar).
- Incluem link para ADRs novos, DEC-NNN novos, REG-NNN novos.

---

## Reverts

### Quando reverter

- Bug em produção que não tem fix rápido.
- Feature que causou regressão inesperada.
- Hotfix urgente (reverter depois de aplicar fix correto).

### Mensagem de commit

```
revert: feat(chain): add WriterLease fencing token verification

This reverts commit abc12345.

Reason: REG-017 regression detected in production — lease renew
fails after 4h. Rolling back until fix is validated.

Tracking issue: #NNN
```

### Após revert

- Criar issue para investigar causa raiz.
- Registrar em `memory/known-problems.md` (KP-NNN).
- Não re-aplicar sem fix validado.

---

## Hooks

### Pre-commit (husky)

- `lint-staged`: roda Prettier + ESLint no staged.
- `tsc --noEmit` em staged TypeScript.

### Pre-push (husky)

- `npm run test` (unidade apenas — integração é em CI).

### Commit-msg (husky)

- Valida Conventional Commits via `commitlint`.

---

## Secrets

### Proibições

- **Nunca** commitar `.env.local`, `.env.production`, chaves,
  mnemonics, passwords.
- **Nunca** commitar arquivos com segredos hard-coded.
- **Sempre** usar placeholders em exemplos (ex.: `MNEMONIC=your_mnemonic_here`).

### Se segredo foi commitado por engano

1. **NÃO** fazer `git push --force` para apagar (já está no
   history se foi pushed).
2. **Rotacionar** o segredo imediatamente (assumir comprometido).
3. **Remover** do history via `git filter-repo` ou BFG Repo-Cleaner.
4. **Notificar** operador e registrar incidente em
   `memory/known-problems.md`.

### Pre-commit secret scanning

- Usar `gitleaks` ou similar no pre-commit hook.
- Configurar patterns para: mnemonics Ethereum (12/24 palavras),
  private keys (0x + 64 hex), API keys Binance, etc.

---

## Merge strategy

- **Squash and merge:** para features com múltiplos commits de
  WIP — cria history limpa.
- **Rebase and merge:** para branches que devem preservar commits
  individuais (ex.: bug fix com commit de teste + commit de fix).
- **Create merge commit:** para release branches ou merges
  significativos (preserva contexto de merge).

Default: **squash and merge** para features; **rebase** para fixes.
