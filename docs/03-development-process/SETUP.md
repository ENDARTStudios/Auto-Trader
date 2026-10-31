# SETUP — Ambiente de Desenvolvimento

> **Versão:** 1.0 — 2026-09-23
> **Pré-requisito inegociável:** **Linux** nativo, WSL2 ou Docker (Decisão #21 — signer usa Unix domain sockets). No Windows puro, só com `SIGNER_SKIP_PRE_PUSH_HOOK=1` (escape, não garantia).

---

## 1. Requisitos

| Ferramenta | Versão | Para quê |
|---|---|---|
| Node.js | 20 LTS | CI/compat (`npm ci`, next) |
| Bun | recente | `npm start` (standalone) e alguns scripts |
| Docker + compose | recente | Postgres pgvector + ollama |
| Git | recente | hooks instalados via postinstall |

## 2. Passo a passo

```bash
# 1. Dependências (instala git hooks via postinstall)
npm ci

# 2. Variáveis de ambiente
cp .env.example .env
#   Defina no mínimo: SESSION_SECRET (>=32 chars), ENCRYPTION_KEY (base64 32 bytes),
#   DATABASE_URL (SQLite dev: file:./db/custom.db)

# 3. Schema no banco (dev = SQLite)
npx prisma db push
npx prisma generate

# 4. Seeds
npx tsx scripts/seed-auth.ts     # admin@local / trader@local / viewer@local
npx tsx scripts/seed-flags.ts    # 9 feature flags

# 5. Subir infra opcional (RAG local)
docker compose up -d             # pgvector + ollama
docker compose exec ollama ollama pull nomic-embed-text

# 6. Rodar
npm run dev                      # http://localhost:3000 (tee dev.log)
```

## 3. Verificação de saúde

```bash
curl -fsS localhost:3000/api/health          # 200
npm run lint && npx tsc --noEmit             # 0 erros
npm run test:run                             # vitest verde
npm run test:e2e                             # Playwright (sobe dev server sozinho)
```

Login dev: credenciais impressas por `scripts/seed-auth.ts` (`admin@local`, `trader@local`, `viewer@local`).

## 4. Modo testes de signer/gates (opcional, avançado)

`npm run test:ci` roda o gate completo (637 checks: vault, signer, H0/H1/H2, M3) e é o pre-push hook. Alguns precisam de Unix sockets — por isso a regra Linux. CI usa `DATABASE_URL=file:./prisma/test.db` + `SIGNER_TEST_HOOKS=1`.

## 5. Problemas comuns

| Sintoma | Causa/fix |
|---|---|
| `/api/health` 503 no e2e | Faltou `prisma db push` + seed no DB de teste (CI faz isso — veja job `e2e`) |
| Signer tests falham no Windows | Sem Unix sockets — use WSL2/Docker ou `SIGNER_SKIP_PRE_PUSH_HOOK=1` |
| `next build` falha em node-gyp | Use Node 20 e `npm ci` completo (Docker deps instala python3/make/g++) |
| 401 em toda rota | Cookie de sessão ausente — faça login; middleware protege páginas e APIs |

---

**Relacionados:** [DEVELOPMENT.md](./DEVELOPMENT.md) · [ONBOARDING.md](./ONBOARDING.md) · [PREVIEW_DEPLOYMENT.md](./PREVIEW_DEPLOYMENT.md)
