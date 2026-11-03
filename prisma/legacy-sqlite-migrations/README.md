# Migração legada (dialeto SQLite) — arquivada

`20260714000001_wallet_exchange_recon_fix/` foi a única migração do projeto entre
2026-07-14 e a troca de provider para PostgreSQL (2026-11-01). Ela é **dialeto
SQLite** (`PRIMARY KEY` inline, 19 modelos de uma era anterior) e não é
reproduzível em Postgres: `prisma migrate deploy` falhava com P3019
(`migration_lock.toml` dizia `sqlite` vs provider `postgresql`) antes de aplicar
qualquer coisa.

Foi movida para fora de `prisma/migrations/` para que o histórico aplicado seja o
baseline Postgres gerado de `prisma/schema.prisma`:

- `prisma/migrations/20260101000000_baseline/migration.sql` — snapshot completo
  (34 modelos) gerado com
  `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`.

O conteúdo original é preservado aqui apenas como registro histórico (REG-006).
Não é executável e não deve voltar para `prisma/migrations/`.
