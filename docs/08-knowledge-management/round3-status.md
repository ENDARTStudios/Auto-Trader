# Rodada 3 — status de reprodutibilidade, demo data e docs (2026-11-03)

> Escopo: rodada 3 (branch `feat/signer-runtime-round3`). Regra mantida: **execução
> live continua desligada/fail-closed**; signer só sobe com `SIGNER_SPAWN=1` e está
> desligado por padrão. Nada aqui habilita ordem real.

## 1. `npm run test:ci` reproduzível sem destruir o banco de dev

**Problema:** o gate legado de 22 scripts (`npm run test:ci`) roda contra `DATABASE_URL`
e é destrutivo — `scripts/test-vault.ts` trunca `WalletConnection`/`ExchangeConnection`
no início da suíte (`deleteMany({})`). Rodá-lo na máquina de dev apaga dados e, sem
env, os scripts caem em `file:./prisma/dev.db` e quebram com
`PrismaClientInitializationError` (adapter SQLite vs provider postgres).

**Solução:** `scripts/run-test-ci.mjs` (`npm run test:ci:local`):

1. carrega `.env` via dotenv;
2. cria um **banco dedicado** `autotrader_test_<pid>` conectando no MESMO servidor
   (DB `postgres`) — recusa se o nome for o banco de trabalho e, sem permissão
   `CREATE DATABASE` (erro 42501), aborta com instrução explícita em vez de usar o
   banco de dev;
3. aplica o schema com `prisma migrate deploy` (baseline versionado);
4. roda a **mesma lista de 22 scripts** do `test:ci` via `tsx` local, com
   `DATABASE_URL` do banco de teste, `SIGNER_TEST_HOOKS=1`, `NODE_ENV=test` e
   `SESSION_SECRET`/`ENCRYPTION_KEY` de teste;
5. imprime PASS/FAIL + duração por script, `PASS=n FAIL=n`, e **dropa o banco**
   (`DROP DATABASE ... WITH (FORCE)`) salvo `--keep`.

Flags: `--only <substr>` (repetível), `--keep`, `--list`, `--db-name <nome>`,
`--timeout <seg>`. O runner também avisa se a lista local divergir do `test:ci` do
`package.json`.

**Evidência (executado nesta máquina):**

| Comando | Resultado |
|---|---|
| `node scripts/run-test-ci.mjs --only test-vault` | banco `autotrader_test_<pid>` criado, migrations aplicadas, **PASS test-vault.ts (44.8s)**, banco dropado |
| `--only h0-kdf` | **PASS test-h0-kdf-versioning.ts (14.8s)** |
| `--only token-authority` | **PASS test-h2-token-authority.ts (2.0s)** |
| `node scripts/run-test-ci.mjs` (completo) | ver §5 do relatório da rodada (job em background) |

## 2. Limpeza de demo data (`npm run db:demo:clear`)

`scripts/clear-demo-data.mjs` + helper puro `scripts/lib/demo-ids.mjs`:

- IDs vêm de `scripts/seed-demo.ts` (fonte única): `Position/PaperOrder` com
  `demo-pos-*`, `MarketSnapshot` 7001–7010, `PerformanceSnapshot` 8001–8030,
  `Round` 9001–9005, `AppLog` 6001–6006. `AIInsight` **não** é criado pelo seed
  (verificado) — nada a limpar lá;
- **default é dry-run** (só conta); apaga apenas com `--yes`;
- exige `DATABASE_URL`; `NODE_ENV=production` exige `--allow-production`;
- imprime contagens antes/depois por tabela e avisa se sobrar demo.

**Evidência (banco descartável `autotrader_demo_probe3_<pid>`, 100% isolado):**
seed-demo criou `{positions:9, orders:9, market:6, curve:30, rounds:5, logs:6}` = 65
linhas; dry-run manteve 65 (nada apagado); `--yes` apagou 65 e deixou **0** demo;
banco dropado. Nenhuma escrita no banco de dev.

## 3. Docs

- `README.md`: scripts `test:ci:local`, `build:signer`, `db:demo:clear`; seção de
  testes atualizada (60 arquivos/766 testes); status do signer (empacotado em
  `.next/standalone/signer.js`, **default desligado**, `configured=false` em prod).
- `.env.example`: `SIGNER_SPAWN=0`, `DEX_SIGNER_WALLET_ID=`,
  `SIGNER_MAX_TX_USD=100`, `SIGNER_MAX_WINDOW_USD=500`, `SIGNER_WINDOW_SEC=3600`
  (valores default conferem com `tests/signer-supervisor.test.ts`).
- `tests/demo-cleanup.test.ts`: 11 casos cobrindo prefixos/faixas/SQL parametrizado
  do helper (se o seed mudar a numeração, o teste falha).

## 4. Pendências / riscos (honestos)

1. O gate completo (`test:ci:local` sem `--only`) leva ~10 min; em máquina de dev é
   melhor rodar por subconjunto. No CI o script continua sendo `test:ci` (com
   Postgres de service) — `test:ci:local` é ferramenta de dev, não substitui o CI.
2. `scripts/test-*.ts` continuam assumindo um banco que podem truncar; a proteção
   agora é o runner (banco dedicado). Se alguém rodar `npm run test:ci` direto, o
   risco de apagar dados do `DATABASE_URL` apontado permanece.
3. `test:ci` e `test:ci:local` compartilham a lista de 22 scripts em dois lugares
   (package.json e runner) — há um aviso automático de divergência, não um único
   arquivo de configuração.
4. Redis real não é exercitado nestes testes (sem service); ver rodada 2.
5. Deploy automático de produção continua inexistente; o signer em produção segue
   desligado até `SIGNER_SPAWN=1` ser habilitado após o deploy.
