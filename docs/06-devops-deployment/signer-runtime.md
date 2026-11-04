# Signer runtime (round 3) — processo real, socket Unix 0600, supervisor fail-safe

O signer é um PROCESSO SEPARADO do web (trust boundary): guarda as chaves
descriptografadas em memória própria e só assina via JSON-RPC sobre Unix socket.
Este documento cobre como ele sobe em produção, a política aplicada, o
supervisor, limitações e rollback.

## TL;DR

- **Desligado por padrão.** Sem `SIGNER_SPAWN=1`, nada é spawnado. A execução
  live continua fail-closed (gating de 6 condições + credenciais resolvidas em
  `src/lib/trading/live-credentials.ts`).
- Build: `npm run build` = `next build` + `scripts/build-signer.mjs` (esbuild) →
  `.next/standalone/signer.js` + runtime deps em `.next/standalone/node_modules`.
- Boot: `src/instrumentation.ts` chama `startSignerSupervisor()` (nunca lança;
  falha do signer não derruba o app).
- Health: `GET /api/signer/health` (auth `system:read`) inclui
  `supervisor: { enabled, spawned, ready, pid, restarts, socketPathMasked, lastError }`
  — o caminho completo do socket **nunca** é retornado.
- Rollback: `SIGNER_SPAWN=0` (ou remover a variável) + redeploy. Nada mais muda.

## 1. Habilitar

Pré-requisitos (o operador faz DEPOIS do deploy, explicitamente):

1. `SIGNER_SPAWN=1` no ambiente do serviço web.
2. (Opcional) `SIGNER_SOCKET_PATH` — se ausente, o supervisor usa
   `os.tmpdir()/auto-trader-signer-<pid-do-web>.sock` e exporta a variável para
   o processo filho e para o health/adapter do processo web.
3. (Opcional) `SIGNER_PROTOCOL_VERSION` — versão esperada; default = constante
   `SIGNER_PROTOCOL_VERSION` do protocolo.

> **Atenção:** habilitar o spawn NÃO liga a execução live. `live-gating` exige
> `mode=live` + `graduatedToLive` + `LIVE_TRADING_ENABLED=1` + `S14_APPROVED=1`
> + kill switch off + feature flag. O signer só fica *disponível*.

## 2. Política (env do filho, defaults aplicados se ausentes)

O supervisor aplica defaults **sem sobrescrever** valores explícitos:

| Variável | Default | Função |
|---|---|---|
| `SIGNER_MAX_TX_USD` | `100` | teto por transação (§7.3.1) |
| `SIGNER_MAX_WINDOW_USD` | `500` | teto agregado na janela (§7.3.2) |
| `SIGNER_WINDOW_SEC` | `3600` | tamanho da janela de gasto |
| `SIGNER_AUDIT_LOG` | `<tmp>/auto-trader-signer-<pid>.audit.jsonl` | audit log hash-chained |

Outras variáveis do signer (`SIGNER_DEST_ALLOWLIST`, price feeds, writer lease)
seguem em `src/lib/signer-protocol.ts` (`SIGNER_ENV`) e devem ser definidas pelo
operador quando o fluxo de assinatura real for ligado.

## 3. Socket 0600

- O signer cria o socket e roda `chmod 0600` (só o mesmo usuário conecta). Se o
  `chmod` falhar, o signer loga WARN e continua — o isolamento de SO fica
  degradado; verifique o log do supervisor.
- Diretório recomendado: `/tmp` (tmpfs em runtime; nunca no rootfs read-only do
  container). O Dockerfile garante `/tmp` gravável (1777) e o Dockerfile/README
  recomendam `--tmpfs /tmp`.
- O web process e o signer compartilham o mesmo `/tmp` (mesmo container/UID
  `node`). Para isolamento maior, montar `/run/signer` 0700 e apontar
  `SIGNER_SOCKET_PATH` para lá.

## 4. Supervisor (src/lib/signer-supervisor.ts)

- Gate: `SIGNER_SPAWN=1`. Sem isso: log `desligado` e retorna.
- Bundle ausente: log de erro + `lastError=SIGNER_BUNDLE_MISSING`; **não spawna e
  não derruba o web** (rode `npm run build`/`build:signer`).
- Spawn: `process.execPath .next/standalone/signer.js`, `stdio: [pipe,pipe,pipe]`.
  O stdin fica aberto: quando o web morre, o EOF faz o signer zeroizar chaves e
  sair (die-detection do `src/signer/main.ts`).
- Prontidão: lê o stdout até a linha JSON `{"type":"SIGNER_READY",...}`
  (valida `type`, `socketPath` igual ao combinado e `version` string) com
  timeout de 10s. Linha inválida é ignorada; mismatch de socket/versão ou timeout
  mata o filho (SIGTERM) e reagenda.
- Restart: em exit/erro, limpa `SIGNER_SOCKET_PATH` do env, e reagenda com
  backoff exponencial 1s → 30s (sem limite de tentativas; `attempts` zera após
  um READY). `restarts` no status conta os reagendamentos.
- Shutdown: `SIGTERM`/`SIGINT` chamam `stopSignerSupervisor()` (SIGTERM →
  SIGKILL após 2s → remove socket); no evento `exit` do web, mata o filho e
  remove o socket de forma síncrona/best-effort.

## 5. Limitações conhecidas (fail-closed)

1. **Cofre bloqueado**: o signer não tem chaves até `unlock` (passphrase do
   operador). Sem unlock, métodos de assinatura retornam `SIGNER_VAULT_LOCKED`.
2. **Sem wallets/exchanges no banco de produção**: o unlock não tem o que
   descriptografar; a execução live falha antes (credenciais `VAULT_LOCKED` /
   `LIVE_CREDS_NOT_CONFIGURED`).
3. **DEX via signer**: exige `DEX_USE_SIGNER=1` + `SIGNER_SOCKET_PATH` +
   `DEX_SIGNER_WALLET_ID` (fail-closed sem wallet id:
   `DEX_SIGNER_WALLET_ID_REQUIRED`) **e** suporte no adaptador DEX. O adaptador
   atual (`dex-adapter.ts`) ainda não assina via RPC do signer — nesse intervalo
   ele falha `DEX_SIGNER_UNAVAILABLE` em vez de cair para chave local.
4. **Mainnet**: `LIVE_ALLOW_MAINNET=1` é exigido por CEX mainnet e por DEX.
5. **Uma instância por container**: o socket é derivado do PID do web. Múltiplas
   réplicas teriam um signer cada (não há signer compartilhado/remoto nesta fase).

## 6. Verificação e rollback

```bash
# 1) bundle gerado no build
ls -l .next/standalone/signer.js
# 2) health (autenticado, system:read)
curl -s -b "session=<cookie>" https://<host>/api/signer/health | jq
#    esperado com SIGNER_SPAWN=1: supervisor.enabled=true, ready=true,
#    socketPathMasked="…/auto***ock", lastError=null
# 3) logs do supervisor: "[signer-supervisor] signer pronto (pid=..., version=...)"
```

Rollback: `SIGNER_SPAWN=0` (ou remover) e redeploy. O supervisor desliga; o web
continua funcionando; a execução live (já desligada) permanece fail-closed.
Nenhum artefato/credencial a limpar: o socket e o audit log ficam em `/tmp`
(tmpfs, descartado no restart do container).

## 7. Arquivos

- `scripts/build-signer.mjs` — bundle esbuild + closure de runtime no standalone.
- `src/lib/signer-supervisor.ts` — supervisor (gate, backoff, status).
- `src/instrumentation.ts` — chama o supervisor no boot (try/catch).
- `src/app/api/signer/health/route.ts` — probe + status do supervisor.
- `src/signer/main.ts` — processo signer (socket, dispatch JSON-RPC, READY).
- `tests/signer-supervisor.test.ts` — spawn fake, ready, backoff, stop, status.
