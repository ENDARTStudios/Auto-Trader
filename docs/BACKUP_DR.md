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
# 5. Registrar o incidente em docs/INCIDENT_RESPONSE.md (postmortem curto)
```

## 5. Testes de DR (obrigatório antes do live)

- [ ] Restore de DB executado ao menos 1× em staging com dados reais de paper.
- [ ] Restore de vault executado + assinatura de transação de teste validada (sem gastar fundos).
- [ ] Rollback de deploy ensaiado ([PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md) §rollback).
- [ ] Kill switch manual testado em paper ([MANUAL_DO_OPERADOR.md](../MANUAL_DO_OPERADOR.md)).

---

**Relacionados:** [PRODUCTION_DEPLOY.md](./PRODUCTION_DEPLOY.md) · [MONITORING.md](./MONITORING.md) · [RULES.md](./RULES.md)
