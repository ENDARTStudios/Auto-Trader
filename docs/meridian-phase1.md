# Meridian — Fase 0 + Overview (implementação real)

Branch: **`feat/ui-meridian-shell`**, empilhada em `design/uiux-concept-v2` (worktree `D:\PROJETOS\Auto Trader\at-impl`). Nada foi alterado no checkout dos outros agentes.

## Rotas implementadas

| Rota | Fonte de dados | Ações |
|---|---|---|
| `/overview` | status, positions, analytics, rounds, graduation, ai-insights | start/pause engine, export CSV, range |
| `/markets` | `/api/market` (snapshots + fear&greed + trending) | refresh, filtro por par |
| `/portfolio` | analytics 30d, positions, reserve | export CSV, refresh, fechar posição (com nota) |

## O que entrou

| Área | Arquivo | Papel |
|---|---|---|
| Tokens (escopo `.mrd`) | `src/app/(meridian)/meridian-tokens.css` | Gerado de `design/tokens.css`; não vaza para o app legado |
| Componentes do shell | `src/app/(meridian)/meridian.css` | Rail, topbar, telemetria, cards, KPI, tabela, empty/skeleton |
| Shell | `src/components/meridian/shell.tsx` | Rail (colapsável), topbar, telemetria, ⌘K, tema |
| Ícones | `src/components/meridian/icons.tsx` | Lucide mapeado por nome |
| Primitivos | `src/components/meridian/ui.tsx` | Badge, Card, Kpi, Meter, Ring, Empty, Skeleton, Delta |
| Gráfico | `src/components/meridian/area-chart.tsx` | Área em SVG puro, crosshair + tooltip |
| Overview | `src/components/meridian/overview-view.tsx` | Dados reais + loading/empty/error |
| Rota | `src/app/(meridian)/overview/page.tsx` | `/overview` |
| Guard | `src/app/(meridian)/layout.tsx` | Sessão obrigatória → `/login` |
| Chrome legado | `src/components/legacy-chrome.tsx` + `src/app/layout.tsx` | Esconde barra de idioma/footer em `/overview` |

## Dados (endpoints existentes, sem mock)

`/api/runtime/status` · `/api/positions` · `/api/analytics?range=24h|7d|30d|all` · `/api/rounds` · `/api/graduation` · `/api/ai-insights?limit=1`, com TanStack Query (15–60 s de refetch) e estados de carregamento/vazio/erro.

Ações: **Start/Pause engine** (`POST /api/engine/start|stop` com invalidação), **Export CSV** das posições abertas, troca de período do gráfico, tema claro/escuro e paleta ⌘K.

## Navegação

Os 13 itens de rail existem, mas só **Overview** está roteado; os demais aparecem como `soon` e `aria-disabled` em vez de levar a 404 — navegação quebrada é pior que navegação incompleta.

## Como rodar

```powershell
cd "D:\PROJETOS\Auto Trader\at-impl"
npx next dev -p 3100        # abra http://localhost:3100/overview
```

> Use `localhost`, não `127.0.0.1`: o Next 16 bloqueia assets de dev em origens não listadas (`allowedDevOrigins`), o que impede a hidratação. Foi a causa do sintoma “tela em skeleton” durante a validação.

## Correção de segurança encontrada no caminho

O proxy (`src/proxy.ts`) exige `x-csrf-token` em POST/PUT/PATCH/DELETE, mas nenhuma rota emitia o token — todas as ações de escrita do app (start engine, salvar config, kill switch) respondiam **403**. Adicionado `GET /api/auth/csrf` (token HMAC ligado à sessão + cookie `csrf`) e o `apiPost` do Meridian passa a buscá-lo e enviar o header. Sem isso, nenhuma ação do produto funcionava.

## Verificado

- `npx tsc --noEmit` — sem erros.
- `npx eslint` nos arquivos novos — sem erros (1 warning resolvido com `role="option"`).
- Login real (`admin@local`) → `/overview` renderiza seis KPIs, curva de 45 snapshots, 3 posições, 5 rounds e telemetria; `POST /api/engine/start` responde.
- Capturas: `docs/ui-meridian-overview.png` e `docs/ui-meridian-mobile.png`.

## Pendências conhecidas

1. `page.tsx` legado (39 KB) segue em `/` — a troca acontece na fase 1, com redirect depois de paridade.
2. Marketing `/pricing`, `/login`, `/signup`, `/reset` ainda são as telas antigas.
3. O guard de sessão no layout consulta o banco a cada navegação; cache curto por request é o próximo passo.
4. Falta `next build` completo (exige `.env` e banco de produção) — rodar no CI da PR.
5. Dados de demonstração do banco local foram semeados apenas no worktree; não estão versionados.

## Estado final da implementação

| Rota | Estado |
|---|---|
| `/` | redireciona: sessão → `/overview`, anônimo → `/welcome` |
| `/welcome` | landing pública (tokens Meridian, sem chrome legado) |
| `/overview` `/markets` `/portfolio` `/strategy` `/risk` | implementadas com dados reais |
| `/analytics` `/journal` `/backtest` `/copilot` | implementadas |
| `/alerts` `/data` `/settings` `/billing` `/admin` | implementadas |
| `/terminal` | dashboard antigo preservado (sem link na navegação) |
| `/login` `/signup` `/pricing` `/privacy` `/terms` | telas legadas ainda em uso |

### Achados de infraestrutura corrigidos

1. **CSRF**: o proxy exigia `x-csrf-token` e nenhuma rota emitia — toda escrita respondia 403. Adicionado `GET /api/auth/csrf` + envio no `apiPost`.
2. **Tokens ausentes**: `--brand-solid`, `--crit-solid`, `--ease-out-strong` eram usados pelo CSS e não gerados; botões primários ficavam transparentes. Aliases adicionados em `meridian.css`.
3. **Guard da raiz**: o proxy bloqueava `/` antes do roteador; agora só `/dashboard` é protegido e a raiz decide sozinha.
4. **Hidratação**: tempos relativos e `isFetching` removidos do HTML servido; preferências via `useSyncExternalStore`.

### Build

`npx next build` — concluído com sucesso (exit 0), 61 rotas compiladas, incluindo as 14 páginas do shell.

### Pendências conscientes

- `/login`, `/signup` e `/pricing` continuam no design antigo; o fluxo de auth funciona, mas não foi redesenhado nesta fase.
- MFA setup, convite de usuários e portal de assinatura estão desabilitados com aviso explícito.
- `page.test`/e2e do repositório não cobrem as rotas novas ainda.

## Páginas públicas (redesign)

- `/login` — split screen Meridian, MFA condicional, erro inline, credenciais de teste; fluxo real validado (login → `/overview`).
- `/pricing` — planos reais de `lib/billing/plans` (Free/Pro/Elite), assinatura via `/api/billing/subscription` quando autenticado, CTA para login quando anônimo.
- `/signup` — acesso por convite (não existe self-signup no backend); explica o fluxo em vez de prometer cadastro.
- `/welcome` — landing pública.

## Fluxos de recuperação de senha

`/forgot` e `/reset` **não existiam** (o link em /login levava a 404). Agora existem no design Meridian, ligados a `/api/auth/forgot` e `/api/auth/reset`: resposta idêntica para conta inexistente (anti-enumeração), aviso de link expirado em 15 min, validação de 8+ caracteres e confirmação, e encerramento de todas as sessões ao trocar a senha.

## Onboarding

`/onboarding` (item "Primeiros passos" no rail) monta um checklist a partir do estado real: modo paper, kill switch já exercitado, rounds, posições, curva de equity e progresso de graduação — cada passo leva para a tela onde a ação acontece.
