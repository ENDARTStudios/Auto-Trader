# Current-State Audit — live (T070, 2026-09-24)

> Método: somente leitura em GitHub, Vercel, repo e protocolo. Sem execução de
> T069/T058/T067, sem alteração de código/workflow/deps. Fontes vivas:
> `origin/main`, CI runs, PRs, `https://auto-trader-snowy.vercel.app/`.

## 1. GitHub — repo `ENDARTStudios/Auto-Trader`

- `origin/main` = `e1a93eb` (docs T068/D030). Local estava na branch T069;
  auditoria escrita a partir de `main` limpa.
- Últimos 5 runs em `main`: **todos success** (`36053473100`, `36052370734`,
  `36006029048`, `36004898568`, `35943109164`).
- PRs merged e fechados: #24, #25, #26, #27. PR aberto relevante: **#28
  (draft, T069 diagnóstico, mergeable, CI success)** + Dependabots de rotina.
- Branches remotas reais (`ls-remote`): só `main` e
  `chore/s34-phase-b-nonbreaking`. Refs locais de branches já mergeadas/
  deletadas estão obsoletas — higiene: `git fetch --prune` (não executado
  nesta auditoria read-only).
- Worktree: `AGENTS.md` modificado por processo externo (26 linhas, Project
  Automation Guidelines) + untracked por design (`.agents/`,
  `skills-lock.json`). Não tocados pela auditoria.

## 2. T069 — estado real: BLOCKED com PROPOSTA (não iniciada de novo, não mergeada)

- Branch remota `chore/s34-phase-b-nonbreaking` @ `3184b30`; draft PR #28
  OPEN/MERGEABLE; CI `36056280921` success (docs-only).
- Outcome (B) confirmado no plano §10 + episodes: `tar@6.2.1` mora no npm
  embarcado de `node:20-slim` (fora do lockfile); maintainer recusa backport;
  fix exige major + Dockerfile → Phase C. **Nada para retomar sem decisão.**
- Próxima ação válida: Thinker/Operador decidem Phase C
  (`feature/s34-tar7-toolchain`, opção (a) preferida) ou mantêm risco aberto.

## 3. T058/site — DEPLOYMENT_NOT_FOUND (BLOQUEADO por ambiente)

- `GET /` → **404** `The deployment could not be found on Vercel.
  DEPLOYMENT_NOT_FOUND`; `/api/health` → 404 idem; `/login` → 404.
- Zero referências a `auto-trader-snowy`/Vercel no repo: ambiente é 100%
  operado pelo Operador. Contas seed (`admin/viewer/trader@local`) servem
  **só ao banco local de dev** — não existem credenciais de teste para Vercel
  em nenhum doc/seed do repo.
- **T058 não pode executar**: falta URL válida (redeploy ou novo endereço) e,
  depois, credenciais de teste/MFA do ambiente real. Input exato necessário
  do Operador: (1) URL válida respondendo 200; (2) conta de teste + MFA (se
  houver); (3) confirmação de smoke não destrutivo permitido.

## 4. T067 — backlog intacto

- `src/components/dashboard/terminal-header.tsx` presente, **zero imports**
  em `src/` — código morto confirmado, sem mudança desde T064. Baixa
  prioridade, sem bloqueio.

## 5. Riscos S34/node-tar/Trivy — inalterados

- Trivy non-blocking com CVEs HIGH/CRITICAL `node-tar`; `continue-on-error`
  mantido; `npm audit` high/critical limpo (só moderates vitest-major).
- Risco segue aberto e corretamente classificado; sem normalização.

## 6. Divergência de conhecimento — RESOLVIDA (a favor do repo live)

- `PLANO_MESTRE.md` **no repo** é crypto-only com negação explícita do
  Almanaque (“Não há relação com futebol…”). A descrição legada existe só no
  knowledge anexado — **não reabrir Fases 0-9**; fonte de verdade é o repo.
- `package.json` em main tem `@axe-core/playwright`; `ci.yml` tem
  `ubuntu-24.04`, `fetch-depth: 0`, CodeQL v4 — T061/T062/T064/T066 integradas.

## 7. Próxima ação (para decisão do Thinker, sem ambiguidade)

1. **Operador**: URL Vercel válida + credenciais de teste → destrava T058.
2. **Thinker**: decidir Phase C (tar7 toolchain) ou aceitar risco node-tar.
3. **Doer (baixo risco, sem Operador)**: T067 cleanup + `git fetch --prune`
   local + fechar documentações pendentes, se autorizado.

---

# Auditoria Geral — 2026-11-01 (pós-aceleração Railway/Vercel/UI-UX)

> Método: estado ao vivo (git/gh/railway/vercel CLIs), gates locais, screenshots
> Playwright de produção (`D:\tmp\ui-audit-prod\`), logs de runtime da Vercel
> e do Railway. Executada durante o turno "auditoria geral + equipe de bots".

## A. Produção — UP e funcional

| Item | Estado |
|---|---|
| **Plataforma** | **Railway** (migração concluída nesta data) — projeto `auto-trader`, serviço + **volume persistente `/data`** |
| **URL** | https://auto-trader-production-0cbc.up.railway.app (sem SSO/challenge — acesso direto) |
| **Deploy** | Dockerfile do repo (standalone Next), entrypoint com chown no volume + drop p/ node (non-root preservado) |
| **Login** | **FUNCIONANDO** — verificado por curl: POST /api/auth/login → 200 + cookie; GET /api/status autenticado → snapshot real. Screenshots confirmam dashboard + onboarding em pt-BR |
| **Banco** | SQLite no volume (persistente entre restarts/deploys); auto-init aplica schema (33 tabelas) + seed (3 usuários + 9 flags) no cold start (`src/lib/db-init.ts`, PR #51) |
| **Vercel** | Obsoleta (SQLite efêmero + SSO/challenge impossibilitavam login — `NEXT_PUBLIC_APP_URL` vazio derrubava SSR há 52 dias; fixes #50/#51). Projeto pode ser deletado pelo Operador |

## B. CI/CD — verde

- Gates locais: tsc 0 · eslint 0 · vitest **419/1sk** · build OK (validados neste turno).
- GitHub Actions: quota mensal esgotada em 31/10 (runs instantâneos zero-step) — **resetou 00:00 UTC 01/11**, runs normais desde então.
- PRs: **todas mergeadas** (#15 prisma 7, #18, #21, #45, #48, #49, #50, #51). Aberta: **#8 (TS 7)** — bloqueada por typescript-eslint (sem suporte a TS 7); reabre sozinha quando o upstream suportar.

## C. Pendências consolidadas (priorizadas)

| # | Pendência | Prioridade | Dono |
|---|---|---|---|
| 1 | **Banco durável em produção**: SQLite no volume é persistente mas single-instance — decidir Postgres hospedado (Neon/Supabase) × VPS (docker-compose pgvector) × manter efêmero | P1 | Operador (3 opções em `PENDENCIAS_OPERADOR.md`) |
| 2 | **#8 TS 7** — aguardar typescript-eslint suportar TS 7 (fechar se preferir; dependabot reabre quando houver suporte) | P2 | upstream/Operador |
| 3 | **Warning React** "Cannot update a component while rendering" — reproduzir com trace nomeado e corrigir | P2 | Builder |
| 4 | **401 noise** no console do login (`useAuth me` silencioso quando desautenticado) | P2 | Builder |
| 5 | **robots duplicado**: `public/robots.txt` estático × `src/app/robots.ts` (o dinâmico venceu no build) — remover o estático | P2 | Builder |
| 6 | **T058 smoke** — **AGORA DESBLOQUEADO no Railway** (sem SSO/challenge): executar checklist com credenciais de teste | P2 | Sentinela/Ops |
| 7 | **Spec-ports** ROADMAP Fase II: Day Trader PASS/BLOCK, Backtrader analyzers, replay de setup (Hindsight-style) | P2 | Builder/Pesquisador |
| 8 | **iFixAi**: 1 auditoria comportamental do Doer/squad com relatório anexado | P2 | Guardião |
| 9 | **CVEs npm** (moderates residuais) + Trivy `continue-on-error` (decisão formal pendente) | P3 | Guardião |
| 10 | **llms.txt** + sitemap ampliado (pricing/privacy/terms) | P3 | Builder |
| 11 | **Validator de episodes no CI** (T086) | P3 | Builder |
| 12 | **S14 live trading** — requer chaves/aprovação/Postgres durável primeiro | — | Operador |

## D. Riscos residuais

- SQLite por instância no Railway: dados persistentes entre restarts, mas **single-instance** (escalar para 2+ instâncias corrompe o SQLite — não fazer antes do item C.1).
- 52 CVEs OS Debian bookworm sem fix upstream (herdados; hardening compensatório validado — ver `docs/05-security-compliance/risk-acceptance-proposal.md`).
- `NEXT_PUBLIC_APP_URL` vazio na Vercel: corrigido no código (fallback VERCEL_URL); opcionalmente preencher a env com a URL do Railway se manter a Vercel.

## E. Equipe de bots

Criada: `docs/03-development-process/AGENT_TEAM.md` — 6 bots (Sentinela/Builder/Guardião/Pesquisador/Ops/Revisor), worktree por bot, lock por issue, automações diária/semanal.
