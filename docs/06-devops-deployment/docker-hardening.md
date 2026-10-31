# Docker Hardening — controles compensatórios (T080, S34)

> **Contexto S34:** node-tar mitigado (Phase C), 9 CVEs OS bookworm remediáveis
> zerados na imagem (Phase C2), **52 achados OS sem fix upstream permanecem
> abertos**. Estes controles reduzem a *explotabilidade* desses achados — **não
> os corrigem**. CI verde ≠ imagem totalmente segura. `continue-on-error` do
> Trivy mantido até decisão formal (T081 + Operador).

## 1. O que é garantido onde

| Controle | Onde vive | Garantia |
|---|---|---|
| Non-root (`USER node`, uid 1000) | **Dockerfile (imagem)** | Vale para qualquer execução da imagem, inclusive `docker run` sem flags |
| `NEXT_TELEMETRY_DISABLED=1` | **Dockerfile (imagem)** | Sem escrita de telemetria em `/home/node` |
| `HOSTNAME=0.0.0.0` | **Dockerfile (imagem)** | Standalone binda em todas as interfaces (sem isto, docker injeta `HOSTNAME=<container-id>` e o Next binda só no IP do eth0 — healthcheck intra-container falhava com `ECONNREFUSED` em `localhost`) |
| Read-only rootfs | **Runtime/orquestração** (`--read-only` / `read_only: true`) | Só quem passa o flag; a imagem sozinha não o impõe |
| `tmpfs /tmp` (64 MB) | **Runtime/orquestração** | Caminho de escrita controlado e efêmero |
| `no-new-privileges` | **Runtime/orquestração** | Sem escalada via setuid/exec de binários privilegiados |
| `cap_drop ALL` | **Runtime/orquestração** | `CapEff=0` no processo (validado em `/proc/<pid>/status`) |
| `init: true` / `--init` | **Runtime/orquestração** | docker-init (tini) como PID 1 (reaping de sinais/zumbis) |
| UID/GID fixo (1000:1000) | Imagem base (`node` user) | Sem usuário arbitrário; `docker exec id` = `uid=1000(node)` |

## 2. Runbook local

### 2.1 docker run (validação canônica)

```bash
docker build -t autotrader-hardened .
docker run -d --name autotrader-hardened -p 3100:3000 --init \
  --read-only --tmpfs /tmp:rw,size=64m \
  --security-opt no-new-privileges:true --cap-drop ALL \
  autotrader-hardened
sleep 15
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:3100/api/health   # 200
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:3100/login        # 200
# static (extrair CSS do HTML de /login) e /robots.txt também devem ser 200
docker exec autotrader-hardened sh -c 'for f in /proc/[0-9]*/comm; do if grep -q next-server $f; then p=${f%comm}; grep Uid $p/status; grep CapEff $p/status; grep NoNewPrivs $p/status; fi; done'
# Uid: 1000 1000 1000 1000 / CapEff: 0000000000000000 / NoNewPrivs: 1
docker logs autotrader-hardened   # sem EACCES/EROFS/EPERM/ENOENT
docker rm -f autotrader-hardened
```

### 2.2 docker compose (serviço `app`, profile `app`)

```bash
docker compose --profile app up -d --build app   # sobe só o app (db/ollama intactos)
docker compose --profile app ps                  # status + health (node fetch → /api/health)
docker compose --profile app down --remove-orphans
```

O serviço `app` está atrás de `profiles: ["app"]` de propósito: o fluxo
original `docker compose up -d` (db + ollama) **não muda de comportamento**.
Ele aplica os mesmos controles (`user: node`, `read_only: true`, `tmpfs`,
`security_opt`, `cap_drop`, `init`) e um healthcheck via `node -e fetch(...)`.

## 3. Evidência de validação (T080, 2026-09-26)

- Build da imagem final: verde.
- `docker run` com todos os flags: `health=200 login=200 robots=200 css=200`.
- Processo `next-server`: `Uid 1000`, `CapEff 0000000000000000`, `NoNewPrivs 1`.
- Bind: `0.0.0.0:3000` (`/proc/net/tcp`), uid 1000.
- Logs do container: **zero** ocorrências de `EACCES/EROFS/EPERM/ENOENT/denied`
  durante as validações; único aviso é o `prisma:warn` de OpenSSL **pré-existente**
  (monitorado, risco aberto conhecido).
- Compose serviço `app`: health `healthy`, mesmos flags inspecionados via
  `docker inspect` (`ReadonlyRootfs=true`, `CapDrop=[ALL]`,
  `SecurityOpt=[no-new-privileges:true]`, `Init=true`, `User=node`).

## 4. Limitações honestas (não declarar mais do que isto)

1. **52 achados OS bookworm sem fix** continuam na imagem. O hardening reduz
   superfície/explotabilidade; **não** é remediação e **não** fecha T081.
2. **Read-only/caps/privs dependem de quem sobe o container.** A imagem garante
   apenas non-root (+ telemetria/bind). `docker run autotrader-hardened` sem
   flags roda read-write com capabilities básicas do usuário.
3. **Serviços de terceiros do compose (db/ollama) não foram endurecidos** —
   fora do escopo T080; imagens upstream com suas próprias políticas.
4. **Escritas em runtime:** validado para health/login/static/public sob
   read-only. Se o app passar a escrever caminho novo (ex.: volume de dados),
   será preciso novo tmpfs/volume e revalidação — não assumir compatibilidade
   futura.
5. **Crash logs:** `src/lib/crash-logger.ts` usa `CRASH_LOG_DIR` se definida,
   senão fallback em `/tmp` (efêmero sob tmpfs) ou silencioso sob read-only.
   Para persistência real: definir `CRASH_LOG_DIR` + volume dedicado.
6. **Prisma/OpenSSL warning** persiste (backlog monitorado, ver `SECURITY.md`).
7. **UID 1000 fixo** vem da imagem base `node:20-slim` — não há usuário
   customizado nem `USERNS`/`no-new-privileges` do lado do daemon Docker
   (configuração do host, fora do alcance do repo).

## 5. Próximo

- **T078**: alinhar docs bun vs Node standalone + narrativa de hardening.
- **T081**: proposta formal de aceite/rejeição dos 52 achados ao Operador,
  sustentada por estes controles validados — somente após T080 merge + review.
