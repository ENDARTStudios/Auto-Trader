# E2E local — runner standalone (canônico) · dev server (iteração) · CI

> Atualizado na rodada 13. Este doc responde: **como rodar E2E de verdade na máquina local**,
> por que o `next dev` não serve como sinal de release e como o CI roda as duas suítes.

## TL;DR — qual caminho usar

| Situação | Caminho | Comando |
|---|---|---|
| Validar release/PR localmente (recomendado) | **runner standalone + DB descartável** | `node scripts/e2e-standalone.mjs` |
| Rebuild do artefato antes de validar | runner com build | `node scripts/e2e-standalone.mjs --build` |
| Só a suíte principal (porta 3000) | runner | `node scripts/e2e-standalone.mjs --main-only` |
| Só o smoke Meridian (porta 3100) | runner | `node scripts/e2e-standalone.mjs --meridian-only` |
| Debug de um spec/UI com hot reload | `next dev` (NÃO é gate) | `npm run dev` + `npx playwright test e2e/arquivo.spec.ts` |
| Gate automático | GitHub Actions | jobs `e2e` e `e2e-meridian` em `.github/workflows/ci.yml` |

## Pré-requisitos

- Node.js + dependências instaladas (`npm ci`); nada de `npm install` extra.
- `DATABASE_URL` no `.env` apontando para o Postgres **local** com permissão `CREATEDB`
  (o runner cria e dropa `autotrader_e2e_<pid>`; o banco de dev NUNCA é tocado).
- Portas **3000** e **3100** livres. O runner falha com mensagem clara se estiverem ocupadas.
- Chromium do Playwright instalado (`npx playwright install chromium` se necessário).

## Runner: `scripts/e2e-standalone.mjs`

Sem dependências novas (usa `pg`/`dotenv` e os CLIs `prisma`, `tsx`, `playwright` de `node_modules`).

```bash
node scripts/e2e-standalone.mjs                 # main + meridian, reusa .next/standalone
node scripts/e2e-standalone.mjs --build         # força npm run build antes
node scripts/e2e-standalone.mjs --main-only     # 52 testes (chromium+mobile) na 3000
node scripts/e2e-standalone.mjs --meridian-only # setup + 13 testes na 3100
node scripts/e2e-standalone.mjs --keep          # mantém DB + logs p/ debug
node scripts/e2e-standalone.mjs --json          # resumo JSON no fim
node scripts/e2e-standalone.mjs --workers 2     # paralelismo da main (default: 2)
```

### O que ele faz (nessa ordem)

1. **Preflight**: valida `DATABASE_URL`, CLIs e portas 3000/3100 livres (aborta claro se ocupadas).
2. **Build**: se `.next/standalone/server.js` não existe ou `--build`, roda `npm run build`
   (next build + build-signer + `copy-standalone-assets` — sem os assets o standalone serve HTML sem CSS/JS).
3. **Banco descartável**: `CREATE DATABASE autotrader_e2e_<pid>` no Postgres de `DATABASE_URL`.
4. **Schema + seeds**: `prisma migrate deploy`, depois `scripts/seed-auth.ts`, `seed-flags.ts`
   (se existir) e `seed-demo.ts` (o Meridian depende dos dados demo).
5. **Dois standalone**: `.next/standalone/server.js` em `PORT=3000` (main) e `PORT=3100` (meridian),
   com `HOSTNAME=127.0.0.1`; espera `/api/health` 200 nos dois (timeout 120s, log do server se morrer).
6. **Playwright main**: `npx playwright test --reporter=line` com `PLAYWRIGHT_BASE_URL=http://localhost:3000`.
7. **Playwright meridian**: `npx playwright test --config playwright.meridian.config.ts` na 3100
   (o `setup` cria `.auth/meridian.json`; o runner apaga o storage state antigo antes, para não usar sessão de DB morto).
8. **Cleanup SEMPRE** (sucesso, falha, Ctrl+C, exceção):
   - mata os servers (SIGTERM e, no Windows, `taskkill /PID <pid> /T /F` para árvore/filhos);
   - dropa o DB (`DROP DATABASE ... WITH (FORCE)` — conexões abertas não travam);
   - remove tmp (`%TEMP%/autotrader-e2e-<pid>`, inclui `UPLOAD_DIR`) e `.auth/meridian.json`;
   - confere e reporta as portas no resumo.

### Flakiness e paralelismo (por que default 2 workers)

Com 4 workers no Windows + standalone observamos falhas esporádicas de transporte
(ERR_CONNECTION_RESET/ERR_EMPTY_RESPONSE em page.goto) e 1 corrida de clique no pricing —
não são regressão de app: o mesmo teste passa isolado e em rodadas seguintes. Por isso o runner
usa --workers 2 por default (override: --workers N; --workers 1 = mais lento e mais estável).
retries continua 0 de propósito: falha real deve aparecer como falha, não como flaky.

### Exit codes

| Código | Significado |
|---|---|
| `0` | ambas as suítes passaram (cleanup pode ter logado aviso, mas não muda o código) |
| `1` | **falha de teste** (Playwright retornou não-zero) — é o código que interessa em gate |
| `2` | falha de infra do runner (porta ocupada, build/migrate/seed/health) — nada de teste rodou |

`--json` imprime no fim um objeto com `db`, `build`, `main {passed, failed, skipped, exitCode}`,
`meridian {...}`, `cleanup {serversStopped, dbDropped, tmpRemoved, portsFree}` e `ok`.

## Envs de teste (o que o runner seta e por quê)

| Env | Valor | Por quê |
|---|---|---|
| `DATABASE_URL` | URL do `autotrader_e2e_<pid>` | isola o E2E do banco de dev/produção |
| `NODE_ENV` | `production` (servers) / `test` (migrate+seeds) | server roda como o artefato real |
| `SESSION_SECRET`, `ENCRYPTION_KEY` | valores de TESTE fixos | nunca usar segredo real em teste; sessão/cofre funcionam |
| `E2E_RATE_LIMIT_BYPASS` | `1` | sobe os limites do rate-limit (senão login 429 derruba dezenas de testes) |
| `SIGNER_TEST_HOOKS` | `1` | evita side-effects do signer real no boot |
| `UPLOAD_DIR` | pasta tmp do runner | uploads não sujam o repo |
| `CI` | vazio | força `reuseExistingServer` nas configs do Playwright (o runner gerencia os servers) |
| `PLAYWRIGHT_BASE_URL` | `http://localhost:3000` / `:3100` | aponta a suíte para o standalone |

As configs `playwright.config.ts` e `playwright.meridian.config.ts` já usam
`reuseExistingServer: !process.env.CI` e `baseURL: process.env.PLAYWRIGHT_BASE_URL ?? default`;
**nenhuma alteração de config é necessária** para o runner.

## Por que standalone e não `next dev`

- O standalone é **o mesmo artefato do deploy** (`next build`, `NODE_ENV=production`, static/public
  copiados). O que passa nele é o que o operador recebe; o dev server não é.
- `next dev` tem HMR/watcher: quando outros processos escrevem no workspace (ex.: `vitest --coverage`
  em paralelo, outro agente, editor), o Turbopack dispara **full reload em loop** das páginas.
  Sintoma medido: 10–13 document requests a cada 4s em `/login` e `/welcome`; o form de login
  nunca chega a disparar `POST /api/auth/login` e **todos** os testes de UI falham por motivo falso.
- Rate limit, cold-compile e HMR também tornam o dev lento/flaky para E2E. Use-o só para iteração
  visual de um teste específico, nunca como gate.

## Dev server (iteração manual)

```bash
# banco de dev (aceitável para olhar a UI; NUNCA é o gate)
npm run dev                     # Next dev na 3000
PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test e2e/s41-validation.spec.ts
```

Windows (PowerShell): `$env:PLAYWRIGHT_BASE_URL='http://localhost:3000'; npx playwright test e2e/...`

### Troubleshooting do loop de reload no dev

1. Feche processos concorrentes que escrevem no repo (vitest coverage, outro `next dev`, geradores).
2. Reinicie o dev (Ctrl+C e `npm run dev`); se persistir, apague `.next/dev` (cache de dev) e repita.
3. Confirme que só UM dev server roda no diretório (Next 16 recusa o segundo:
   "Another next dev server is already running").
4. Se o loop continuar, **use o runner standalone** — ele não tem watcher e é o sinal correto.

## CI (GitHub Actions)

- `.github/workflows/ci.yml` → job **`e2e`**: Postgres service, `prisma migrate deploy`, `seed-auth`,
  `npx playwright install --with-deps`, `npx playwright test` com `PLAYWRIGHT_BASE_URL`,
  `E2E_RATE_LIMIT_BYPASS=1` e `SESSION_SECRET` de teste. O webServer do config sobe `npm run dev`.
- Job **`e2e-meridian`**: mesmo setup + `seed-demo`, roda `--config playwright.meridian.config.ts` na 3100.
- Ambos rodam em push para `main` ou PR com label `e2e` (controle de custo).
- O CI não usa o runner local (Linux, runner efêmero, sem escritores concorrentes); o runner é o
  caminho **local canônico** e reproduz o artefato de produção. Em caso de divergência local×CI,
  compare primeiro o artefato (build) e o DB usado.

## Troubleshooting do runner

| Sintoma | Causa | Ação |
|---|---|---|
| `porta(s) ocupada(s): 3000` | dev server/standalone órfão | `Get-NetTCPConnection -LocalPort 3000 -State Listen` + `Stop-Process -Id <pid> -Force` |
| `42501` ao criar DB | role sem `CREATEDB` | operador: `ALTER ROLE <user> CREATEDB;` (ou use Postgres local do docker compose) |
| `npm run build falhou` | erro de build/type | rode `npm run build` direto para ver o log completo |
| health timeout 120s | server morreu no boot | veja `%TEMP%/autotrader-e2e-<pid>/<label>.server.log` (o runner imprime o tail) |
| meridian falha no setup | `.auth/meridian.json` velho | o runner apaga; manualmente: apague `.auth/meridian.json` |
| `--keep` esquecido | DB de teste fica | `DROP DATABASE "autotrader_e2e_<pid>" WITH (FORCE)` |
| build antigo | artefato stale | `node scripts/e2e-standalone.mjs --build` |

## Resultados de referência (rodada 13)

- `node scripts/e2e-standalone.mjs` (defaults): **main 52/52 PASS**, **meridian 13/13 PASS**, build
  reaproveitado, DB dropado, portas livres — exit 0.
- `node scripts/e2e-standalone.mjs --main-only --json` com `--workers 2` (default): 52/52 em 1m26s.
- Com 4 workers na mesma máquina: 49/52 — 2-3 falhas de transporte/clique (ERR_CONNECTION_RESET,
  URL presa em /pricing); reexecução isolada passa. Default 2 workers existe por isso.
- O build (`npm run build`) roda typecheck do projeto inteiro, incluindo `tests/`: um arquivo de
  teste WIP de outra tarefa com erro de TS derruba o build (exit 2 do runner). Rode o runner com o
  workspace quiescente, ou após o dono da tarefa corrigir o tipo.
## Limites e segurança

- Escrita só no banco **descartável** e em `%TEMP%`; nenhuma escrita no banco de dev/produção.
- Nada de `git`, deploy ou registry: o runner é read-only no repo (exceto `.auth/` e `test-results/`,
  ambos gitignored).
- Segredos de produção nunca são usados: o runner seta segredos de teste fixos.

## Referências

- `scripts/e2e-standalone.mjs` — implementação do runner.
- `scripts/run-test-ci.mjs` — mesmo padrão de DB descartável para o gate `test:ci`.
- `playwright.config.ts` / `playwright.meridian.config.ts` — suítes main e Meridian.
- `.github/workflows/ci.yml` — jobs `e2e` e `e2e-meridian`.