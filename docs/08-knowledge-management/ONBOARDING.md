# ONBOARDING — Trilha de Entrada

> **Versão:** 1.0 — 2026-09-23
> **Para quem:** dev ou agente novo no repo Auto Trader. Tempo estimado: 60–90 min até o primeiro PR.

---

## 0. Regra zero (antes de tudo)

Leia `AGENT_GUIDE.md` (padrão Issues→PRs→CI). Novos agentes **não** abrem Issue/PR antes de lê-lo. O aviso de risco do `README.md` (raiz) é leitura obrigatória — este projeto lida com trading e a prioridade é **proteger capital**.

## 1. Entenda o produto (15 min)

1. [PRD.md](./PRD.md) — visão, personas, escopo.
2. [DEFINE_THE_USER.md](./DEFINE_THE_USER.md) — quem usa e o que é sucesso.
3. [RULES.md](./RULES.md) — as regras vinculantes (skill 5 camadas, envelope humano, frozen).

## 2. Configure o ambiente (20 min)

Siga [SETUP.md](./SETUP.md). Resumo:
- **Linux obrigatório** (nativo/WSL2/Docker — Decisão #21; signer usa Unix sockets).
- Node 20 + Bun; `npm ci`; `cp .env.example .env`.
- `npx prisma db push` + `npx tsx scripts/seed-auth.ts` + `npx tsx scripts/seed-flags.ts`.
- `npm run dev` → http://localhost:3000 (login `admin@local` — credenciais em `scripts/seed-auth.ts`).

## 3. Aprenda o mapa do código (20 min)

- [ARCHITECTURE.md](./ARCHITECTURE.md) — monolito modular, apps, feature flags.
- `src/lib/trading/` — o engine (loop, portfolio, scam detector, envelope, graduation).
- `src/signer/` + [signer-isolation-design.md](./signer-isolation-design.md) — processo isolado de chaves (**frozen**).
- Use `graft ask "<pergunta>" --source` para navegar — é mais barato que grep (ver `AGENTS.md`).

## 4. Convenções de trabalho (15 min)

- [DEVELOPMENT.md](./DEVELOPMENT.md) — fluxo diário e pre-push gate (`test:ci`, 637 checks).
- [STYLE_GUIDE.md](./STYLE_GUIDE.md) + [LINT.md](./LINT.md) — código e lint (0 erros).
- [CODE_REVIEW.md](./CODE_REVIEW.md) — o que esperamos num review.
- Commits: Conventional Commits (`commitlint`).

## 5. Seu primeiro PR (checklist)

1. Escolha uma tarefa em [TASKS.md](./TASKS.md) marcada como boa para início.
2. Quebre em passos validáveis ([TASK_BREAKING_DOWN.md](./TASK_BREAKING_DOWN.md)).
3. Branch a partir de `main`; nada de push direto em `main`.
4. Confirme que `git diff --name-only | grep -E 'chain|signer|audit'` está vazio.
5. Valide local: `npm run lint && npx tsc --noEmit && npm run test:run`.
6. PR descrevendo problema/solução/validação (formato das ADRs em `DECISOES.md`).
7. CI verde → review ([CODE_REVIEW.md](./CODE_REVIEW.md)) → merge squash.

## 6. Armadilhas conhecidas (leia, economize horas)

- Windows sem WSL2: testes de signer falham (Unix sockets) — use `SIGNER_SKIP_PRE_PUSH_HOOK=1` só como escape, trabalhe em WSL2/Docker.
- `/api/health` 503 sem seed: rode `prisma db push` + seeds antes de e2e (o CI faz isso no job e2e).
- `next dev` regenera o bloco Next.js do `AGENTS.md` — é esperado; commite junto se mudar.
- Nunca escreva em `config/risk_config.json`, `state/mode.json`, `config/dag_edges.json` por código — write-fence ([RULES.md](./RULES.md) §2).

---

**Dúvida sistêmica?** Procure em [README.md](./README.md) (índice) ou pergunte citando o doc relevante.
