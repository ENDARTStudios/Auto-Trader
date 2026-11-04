# BACKUP_DR — Backup e Disaster Recovery

> **Versão:** 1.0 — 2026-09-23
> **Runbook de incidentes:** [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md). Segredos/vault: [SECRETS.md](./SECRETS.md).

---

## 1. O que precisa de backup (por criticidade)

| Ativo | Onde | Criticidade | Estratégia |
|---|---|---|---|
| DB (SQLite `db/custom.db` dev / Postgres pgdata prod) | Prisma | **Alta** — posições, P&L, auditoria | Snapshot diário + antes de migrate; restore testado |
| Vault + chaves signer (H0) | `src/signer/`, segredos | **Crítica** — perda = fundos irrecuperáveis | Backup offline criptografado, 2 mídias; KDF versionado (`kdf.ts`, `key-rotation.ts`) |
| Envelope humano (`config/*.json`, `state/*.json`) | git | Alta | Versionado no git — nunca reescrever à mão fora de commit |
| Logs de episódios/audit (`logs/*.jsonl`) | disco | Média (aprendizado) | Rotação com `.prior-*`; arquivar antes de apagar |
| Código | git (GitHub) | Alta | Remote + CI verde como referência de bom estado |

## 2. RPO / RTO

| Cenário | RPO alvo | RTO alvo |
|---|---|---|
| Perda de DB dev/paper | 24h (aceitável — paper) | 1h (`db:push` + restore snapshot) |
| Perda de vault/chaves | 0 (backup offline obrigatório antes de qualquer live) | 4h (restore + teste de assinatura) |
| Deploy ruim em produção | 0 (rollback de imagem/commit) | 30min (rollback + `/api/health/ready`) |

## 3. DR operacional do engine (primeira linha de defesa)

O sistema tem **auto-defesa antes de backup**: kill switches (`risk_config.json`) e precedência de estados (`mode.json`):

- Feed stale → `close_neutralize` (posição neutralizada, não reabre).
- Drawdown diário/semanal → kill switch de drawdown.
- Regime desconhecido → `unknown_regime`; falha de modelo → `model_miscalibration_switch` (Brier).
- Humano sempre pode: **kill switch manual** (`/api/kill-switch`) e sair de `crisis_lock` (só humano sai — [RULES.md](./RULES.md) §1.2).

## 4. Procedimento de restore (DB)

```bash
# 1. Parar o app / engine
# 2. Restaurar snapshot
#    SQLite: copiar backup para db/custom.db
#    Postgres: pg_restore / restore do volume pgdata (docker-compose.yml)
# 3. Alinhar schema: npx prisma db push (ou migrate deploy)
# 4. Subir e validar: curl /api/health/ready + conferir Position/Resume/TradingBalance
# 5. Registrar o incidente em docs/05-security-compliance/INCIDENT_RESPONSE.md (postmortem curto)
```

## 5. Testes de DR (obrigatório antes do live)

- [ ] Restore de DB executado ao menos 1× em staging com dados reais de paper.
- [ ] Restore de vault executado + assinatura de transação de teste validada (sem gastar fundos).
- [ ] Rollback de deploy ensaiado ([PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md) §rollback).
- [ ] Kill switch manual testado em paper ([MANUAL_DO_OPERADOR.md](../MANUAL_DO_OPERADOR.md)).

---

**Relacionados:** [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md) · [MONITORING.md](./MONITORING.md) · [RULES.md](./RULES.md)


---

## 6. Backup e restore executáveis — Postgres (2026-11-03)

Os scripts antigos eram SQLite-only (`sqlite3 .dump`); o provider atual é
Postgres. O par abaixo é o caminho suportado:

```bash
# 0. Sanidade (não escreve nada): valida DATABASE_URL, alvo e binários
DATABASE_URL=... node scripts/backup-full.mjs --check
# 1. Imprime o plano (host/porta/banco, sem senha)
DATABASE_URL=... node scripts/backup-full.mjs --dry-run
# 2. Executa: pg_dump --format=custom + sha256 + retenção
DATABASE_URL=... node scripts/backup-full.mjs
#    BACKUP_DIR=backups  BACKUP_RETENTION_DAYS=7  (defaults)

# 3. Restore: valida alvo/dump antes (nada escrito)
DATABASE_URL=... node scripts/restore-full.mjs --check --file backups/auto-trader-<ts>.dump
# 4. Restore real (destrutivo): exige --yes
DATABASE_URL=... node scripts/restore-full.mjs --file backups/auto-trader-<ts>.dump --yes
```

Garantias implementadas:

- a **senha nunca vai para a linha de comando** (vai via `PGPASSWORD`), então não
  aparece em `ps`, histórico de shell ou log de CI;
- `pg_dump` com `--format=custom` → restore seletivo e `pg_restore` (não é um dump
  SQL de texto);
- dump vazio falha com erro (não deixa backup falso no diretório);
- checksum `*.dump.sha256` ao lado de cada backup;
- retenção **nunca** apaga o backup mais recente;
- `restore-full.mjs` recusa alvo que pareça produção (nome com `prod`,
  `railway.internal`, `neon.tech`, `supabase`, `rds.amazonaws`) ou `NODE_ENV=production`
  sem `--allow-production`, e exige `--yes`.

### Teste de DR (executável, sem tocar produção)

1. `DATABASE_URL=<dev> node scripts/backup-full.mjs --check` → deve dizer `check ok`
   (se faltar `pg_dump`: instalar `postgresql-client`).
2. Gerar dump do banco de dev/paper.
3. Restaurar num banco descartável (`createdb autotrader_dr_test`) apontando
   `DATABASE_URL` para ele e rodar `restore-full.mjs --yes`.
4. Subir o app contra o banco restaurado e validar `/api/health/ready` (200) +
   `Config`/`TradingBalance`/`Position` com as contagens esperadas.
5. Registrar data/resultado no `INCIDENT_RESPONSE.md` (postmortem curto).

## 7. Windows / Docker — backup e restore sem cliente PostgreSQL (rodada 9)

O host de desenvolvimento Windows **não tem** `pg_dump`/`pg_restore` nativos. Duas
formas suportadas:

### 7.1 E2E real via Docker (recomendado para validar)

```bash
node scripts/backup-restore-e2e.mjs            # dump + restore + comparação; limpa tudo
node scripts/backup-restore-e2e.mjs --json     # saída para automação
node scripts/backup-restore-e2e.mjs --keep     # preserva banco descartável + tmp
node scripts/backup-restore-e2e.mjs --image postgres:16
```

O que ele faz (sem tocar em produção): lê `DATABASE_URL` do `.env` (senha nunca
impressa), cria `autotrader_restore_e2e_<pid>`, roda `pg_dump -Fc` **dentro** do
container `postgres:16` apontando para o host via `host.docker.internal`, restaura
num segundo container no banco descartável e compara a contagem de **todas** as
tabelas. `--add-host=host.docker.internal:host-gateway` cobre também Linux.

Evidência real (2026-11-04):

```
[backup-e2e] docker server: 29.8.1
[backup-e2e] dump ok: 2113925 bytes
[backup-e2e] restore ok
[backup-e2e] tabelas: origem=34 restaurado=34
[backup-e2e] linhas: origem=2410 restaurado=2410
[backup-e2e] PASS: restore íntegro — 34 tabelas / 2410 linhas idênticas
```

Notas de fidelidade:

- o dump usa `--no-owner --no-acl`; o restore usa `--no-owner --exit-on-error`.
  GRANTs para roles efêmeras de teste (ex.: `autotrader_rls_test`) não existem no
  cluster de destino e fariam o restore falhar — em DR real, provisione os roles
  (`autotrader_app` + grants) **antes/depois** e rode o restore como owner.
- se a origem tiver a extensão `vector`, o E2E troca a imagem para
  `pgvector/pgvector:pg16` automaticamente (a imagem `postgres:16` não traz pgvector).
- tabelas que mudam durante o teste (fonte viva: app/engine escrevendo) são
  detectadas como **voláteis** e reportadas; as demais são comparadas linha a linha.
  Para um teste 100% determinístico, rode com o app parado.

### 7.2 Scripts normais com binário apontado por env

```bash
# defina o binário (caminho do pg_dump.exe ou wrapper) — evita depender do PATH
PG_DUMP_BIN='C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe' \
  node --env-file=.env scripts/backup-full.mjs --check
PG_RESTORE_BIN='C:\\Program Files\\PostgreSQL\\16\\bin\\pg_restore.exe' \
  node --env-file=.env scripts/restore-full.mjs --check --file backups/<dump>.dump
```

Sem o binário, os scripts falham com mensagem clara apontando para o E2E/Docker
(validado: `PG_RESTORE_BIN=C:\\nao\\existe\\pg_restore.exe` → exit 1 com instrução).

### 7.3 RPO/RTO com este caminho

| Cenário | RPO alvo | RTO alvo | Comando |
|---|---|---|---|
| Perda do banco de dev/paper | 24h (aceitável) | 1h | `node scripts/backup-restore-e2e.mjs` valida o caminho; restore real com `scripts/restore-full.mjs` (binário local) |
| Deploy ruim em produção | 0 (rollback de imagem) | 30min | Railway → Deployments → Redeploy + `curl /api/health/ready` |
| Corrupção/perda de dados em produção | último dump agendado | 2-4h | dump `pg_dump -Fc` do owner → `pg_restore` no banco novo → apontar `DATABASE_URL` → smoke `/api/health/ready` |
| Perda de vault/chaves | 0 (backup offline) | 4h | ver §1 (não coberto por dump do banco) |

### 7.4 Teste de restore (checklist executável)

1. `node scripts/backup-restore-e2e.mjs` → **PASS** (exit 0, tabelas e linhas idênticas).
2. Rodar o mesmo com o app **parado** para exigir comparação exata (sem voláteis).
3. Restore num banco descartável a partir de um dump **real** de produção:
   `createdb`, `pg_restore --no-owner --exit-on-error`, comparar contagens, subir o app
   apontando `DATABASE_URL` para ele e validar login + `/api/health/ready`.
4. Registrar data/resultado no `INCIDENT_RESPONSE.md` (postmortem curto).

### 7.5 Rollback

- **Dados**: manter o dump anterior; restore pelo caminho acima para um banco novo e
  trocar `DATABASE_URL` (nunca sobrescrever produção no lugar).
- **App**: Railway → Deployments → deploy anterior → Redeploy.
- **RLS/role**: se o restore foi para um cluster cujo role de app não tem grants, o app
  falha com permissão negada — execute os GRANTs de `docs/05-security-compliance/RLS.md` §9.1.
