# Deploy — arquitetura de hosts (canônica: Railway)

Decisão: **Railway é o host de produção** (app + engine + Redis + banco); **Vercel serve o
mesmo app apenas como preview/espelho**. Motivo: o engine de trading usa `setInterval` em
processo (`src/lib/trading/engine.ts`) e precisa de container contínuo; serverless congela a
instância e a flag `engineRunning` passaria a mentir.

## Mapa

| Papel | Onde | Observação |
|---|---|---|
| App (UI + API) | Railway `auto-trader` | container do `Dockerfile`, porta 3000 |
| Engine de trading | mesmo container | retoma no boot com `ENGINE_RESUME_ON_BOOT=1` |
| Banco | Neon Postgres | `DATABASE_URL` = conexão **unpooled** |
| Redis | Railway `Redis` | usado apenas por rate-limit (opcional) |
| Backup | Railway `db-backup` | mantém cópia do Postgres legado |
| Previews | Vercel | mesmo banco; engine bloqueado por `process.env.VERCEL` |

## Variáveis no serviço `auto-trader`

```env
DATABASE_URL=<neon unpooled>
SESSION_SECRET=<existente>
ENCRYPTION_KEY=<existente>
GOOGLE_CLIENT_ID=<...>
GOOGLE_CLIENT_SECRET=<...>
GOOGLE_REDIRECT_URI=https://<domínio-railway>/api/auth/google/callback
NEXT_PUBLIC_APP_URL=https://<domínio-railway>
ENGINE_RESUME_ON_BOOT=1
```

`ENGINE_RESUME_ON_BOOT` fica **fora** da Vercel de propósito: preview não deve retomar loop.

## Deploy

```bash
git archive origin/main | tar -x -C /tmp/deploy
cd /tmp/deploy
railway link -p auto-trader -s auto-trader -e production
railway up --service auto-trader --environment production
```

Auto-deploy por Git exigiria conectar o serviço ao GitHub no dashboard (hoje o serviço não
tem `repo` associado — o último deploy foi via CLI em 01/11).

## Pós-deploy (checklist)

1. `/login` mostra Meridian e **não** mostra credenciais de teste.
2. Login `admin@local` cai em `/overview`.
3. Google: `/api/auth/google` → consentimento → `/overview` (URI de callback cadastrada no
   console do Google para o domínio do Railway).
4. `/api/health` = 200 com `db.reachable`.
5. Engine: iniciar → `GET /api/engine/status` running=true → logs com ticks → parar.

## Segurança

- A tela de login só exibe conta de teste em desenvolvimento ou com
  `NEXT_PUBLIC_SHOW_DEMO_CREDS=1`.
- Remover o Postgres legado do Railway só depois de validar o Neon (o `db-backup` cobre a
  janela).

## Vercel: apenas preview

`vercel.json` desliga deploy de `main` (`git.deploymentEnabled.main=false`). Previews de PR
continuam; produção é só Railway.

Os aliases de produção da Vercel foram **removidos** (`vercel alias rm`):

- `auto-trader-snowy.vercel.app` → 404
- `auto-trader-end-art-studios.vercel.app` → 404
- `auto-trader.vercel.app` → 404

URLs diretas de deployment (`auto-trader-<hash>-end-art-studios.vercel.app`) ainda existem
como artefato de builds antigos; podem ser apagadas com `vercel remove <url>` quando não
forem mais necessárias.

## Auto-deploy do Railway

Hoje o serviço não tem repositório conectado (`repo: null`) e o repo não tem `RAILWAY_TOKEN`
como secret — deploy é manual:

```bash
railway up --service auto-trader --environment production
```

Para automatizar: conectar o serviço ao GitHub no dashboard do Railway **ou** criar um project
token e adicionar `RAILWAY_TOKEN` nos secrets do GitHub; aí um job em `ci.yml` pode rodar
`railway up --ci` no push para `main`.

## Armadilha de CRLF

`git archive` no Windows converters `.sh` para CRLF e o container morria com
`docker-entrypoint.sh: No such file or directory`. `.gitattributes` fixa `eol=lf` para
`.sh`/`Dockerfile`; qualquer deploy manual deve conferir os scripts antes do upload.

## Deploy automático (opcional, já preparado)

`.github/workflows/deploy-railway.yml` roda `railway up` no push para `main`, mas só quando
`RAILWAY_DEPLOY_ENABLED=true` (variable) e `RAILWAY_TOKEN` (secret) existirem. Sem isso, o
workflow fica pulado e o deploy continua manual.

Passos: Railway → Project Settings → Tokens → *project token*; GitHub → Secrets →
`RAILWAY_TOKEN`; GitHub → Variables → `RAILWAY_DEPLOY_ENABLED=true`.

## Alerta de falha de cobrança

O webhook do Stripe publica no `eventBus` (`level=error`, `source=stripe-webhook`) quando o
processamento falha, então a falha aparece no card Activity além de ficar no `AppLog`.
