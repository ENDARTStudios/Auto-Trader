# Deploy — Vercel (produção)

Projeto: `end-art-studios/auto-trader` · https://auto-trader-snowy.vercel.app
Framework: Next.js · Node 24.x · Root: `.`

## Banco de dados

A produção usa **Neon Postgres** via Marketplace (`neon-emerald-flask`), conectado ao
projeto nas três envs (production, preview, development). O valor antigo de
`DATABASE_URL` apontava para `127.0.0.1:5432` e derrubava qualquer login com
`internal_error`; foi removido antes de conectar o Neon.

Aplicar schema e dados:

```bash
vercel env pull .env.vercel.production --environment production --yes
# DATABASE_URL do Neon está nesse arquivo
DATABASE_URL="$(grep '^DATABASE_URL=' .env.vercel.production | cut -d= -f2- | tr -d '"')" npx prisma db push
DATABASE_URL="…" npx tsx scripts/seed-auth.ts
DATABASE_URL="…" npx tsx scripts/seed-demo.ts
rm .env.vercel.production   # contém segredo; nunca commitar
```

> Prisma 7: `db push` não aceita mais `--skip-generate`.

## Deploy de produção

O merge em `main` dispara deploy automático pela integração Git. Para forçar um
deploy do `main` sem carregar `.env` local:

```bash
git archive origin/main | tar -x -C /tmp/deploy
cp -r .vercel /tmp/deploy/.vercel
cd /tmp/deploy && vercel --prod --yes
```

## Env vars necessárias

| Variável | Situação |
|---|---|
| `DATABASE_URL` | ✅ Neon (Marketplace) |
| `SESSION_SECRET`, `ENCRYPTION_KEY` | ✅ já configuradas |
| `NEXT_PUBLIC_APP_URL` | ⚠️ sensível; conferir se é o domínio público |
| `GOOGLE_CLIENT_ID/SECRET` | ❌ ausentes — botão Google retorna `google_not_configured` |
| `STRIPE_*` | ❌ ausentes — billing aparece como não configurado |

## Verificação

- `https://auto-trader-snowy.vercel.app/login` → login `admin@local` / `Admin123!` →
  `/overview` com 3 posições abertas e a curva de 30 dias.
- Vercel Security Checkpoint: `curl` recebe 429 com desafio; navegador real passa.
  Não é falha do app.

## Custos

Neon Free (`free_v3`), sem cobrança. Se o banco for removido, o projeto perde o
`DATABASE_URL` e o login volta a falhar.
