# CHOOSE_TECH_STACK — Decisões de Stack

> **Versão:** 1.0 — 2026-09-23
> **Critério:** custo zero de APIs, operação solo (1 dev/agente), segurança de capital > conveniência. ADRs relacionados: [ADR.md](./ADR.md).

---

## Escolhas e por quê

| Camada | Escolha | Por quê | Alternativa rejeitada |
|---|---|---|---|
| Framework | **Next.js 16 (App Router) + React 19** | Dashboard SSR/streaming + API routes no mesmo processo; engine in-process sem serviço extra | Microserviço separado do engine (overhead de rede/ops para 1 operador) |
| Linguagem | **TypeScript 5 (strict)** | Um idioma para UI, API e engine; tipos como rede de segurança em código de dinheiro | Python para o engine (duplicaria stack; FinRL etc. ficam advisory-only) |
| UI | **Tailwind + shadcn/ui (Radix)** | Componentes acessíveis e donos do código; motion controlado | UI kit fechado |
| DB | **SQLite via Prisma (dev) → Postgres 16 + pgvector (prod)** | Zero-fricção local; pgvector para RAG quando escala | Mongo (sem transações fortes p/ auditoria) |
| ORM | **Prisma 6** | Schema tipado + migrations; RLS no app (`rlsWhere`) | SQL cru (menos seguro p/ iterar) |
| Runtime prod | **Bun** (`.next/standalone`) + Node 20 no CI | Start rápido; CI no Node 20 LTS estável | Deno (ecosistema menor p/ deps atuais) |
| Testes | **Vitest 3 + Playwright** | Rápido, coverage nativo; E2E chromium+mobile | Jest (mais lento p/ esta base) |
| Auth | **Sessão opaca + bcrypt 12 + TOTP (própria)** | Controle total p/ kill switch/revogação; sem dependência externa de identidade | Auth SaaS (SaaS cai = operador trancafora fora do próprio bot) |
| RAG | **pgvector + ollama (`nomic-embed-text`)** | 100% local, custo zero, dados não saem da máquina | API de embeddings paga |
| Deploy | **Docker standalone + docker-compose (+Fly.io staging)** | Reproduzível; signer precisa Linux (Unix sockets) | Vercel (engine long-running in-process não cabe em serverless) |
| Borda | **Caddy (TLS) + rate-limit + headers HSTS/CSP** | TLS automático simples | nginx (mais config p/ o mesmo resultado) |
| CI | **GitHub Actions** (lint, typecheck, gitleaks, audit, test:ci, coverage, Trivy, ZAP) | Um só lugar; gate de pre-push espelha CI | — |
| Contexto de código | **graft** (grafo indexado, $0) | Navegação barata p/ humano+agente | Grep puro |

## Restrições que moldaram tudo

1. **APIs 100% gratuitas** (Binance public, DexScreener, GoPlus, Etherscan, CoinGecko) — nenhuma fonte paga no caminho crítico.
2. **Linux obrigatório** (Decisão #21) — Unix domain sockets do signer.
3. **External systems advisory-only** — nada de copyleft no código.
4. **Processo signer isolado** — chaves nunca no processo Next ([signer-isolation-design.md](./signer-isolation-design.md)).

## Quando reavaliar

- Escala multi-operador real → Postgres vira default dev+prod.
- Latência de execução real (S14) → reavaliar engine in-process vs serviço separado.
- Qualquer troca de framework/DB exige ADR nova + migração testada ([TASK_BREAKING_DOWN.md](./TASK_BREAKING_DOWN.md)).

---

**Relacionados:** [ARCHITECTURE.md](./ARCHITECTURE.md) · [ADR.md](./ADR.md) · [INTEGRATIONS.md](./INTEGRATIONS.md)
