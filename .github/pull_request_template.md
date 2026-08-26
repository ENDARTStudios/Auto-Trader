<!--
  PR TEMPLATE — Auto Trader
  Regra: toda PR fecha uma Issue. Sem Issue, sem merge.
  Preencha todos os campos. CI deve estar verde antes de pedir review.
-->

## Issue

Closes #<!-- número da issue, ex: #42 -->

> Se esta PR corrige múltiplas issues: `Closes #42, Closes #43`
> Se é rascunho: troque `Closes` por `Relates to` até estar pronta.

## Tipo

- [ ] `feat:` nova funcionalidade
- [ ] `fix:` correção de bug
- [ ] `security:` correção de segurança (atualizar SECURITY.md REG-XXX se aplicável)
- [ ] `chore:` manutenção / refator / docs / deps
- [ ] `docs:` apenas documentação

## O que muda

<!-- 1-3 frases objetivas. O que entra, o que sai, por quê. -->

## Como testar

<!-- Comando(s) concreto(s) que o revisor roda para verificar. Nunca "funciona corretamente". -->

```bash
# ex:
npm run test:ci
npm run test:coverage  # ≥80%
npx playwright test e2e/watchlist.spec.ts
curl -X POST http://localhost:3000/api/watchlist -H "Content-Type: application/json" -d '{"symbol":"BTC/USDT"}' | jq .
```

## Evidências

<!-- Cole saída real de teste, screenshot, log, ou link para CI run. "funcionou" não é evidência. -->

- [ ] `npm run test:ci` verde (cole resumo: `637 checks` / `X files`)
- [ ] `npm run test:coverage` ≥80% (ou justificativa em DECISOES.md)
- [ ] `gitleaks detect --no-git` limpo
- [ ] `npm audit --audit-level=high` limpo
- [ ] Screenshot / gravação se mudou UI (arraste aqui)

## Checklist — Segurança

- [ ] Sem segredo em código, log ou commit (`.env` não commitado, `gitleaks` passou)
- [ ] Inputs validados com Zod na fronteira
- [ ] RBAC verificado (`requirePermission(...)` onde precisa)
- [ ] RLS verificado (`withRLS` / `assertOwner` onde tem `ownerId`)
- [ ] Rate limit aplicado se nova rota
- [ ] Sem `dangerouslySetInnerHTML` sem DOMPurify
- [ ] Sem `any` novo sem justificativa

## Checklist — Qualidade

- [ ] Sem placeholder / TODO / stub (ou linkado a issue)
- [ ] Lint + typecheck passam (`npm run lint`, `npx tsc --noEmit`)
- [ ] Build passa (`npm run build`)
- [ ] Docs atualizados (`docs/*.md`, `README.md`, `CHANGELOG.md` se aplicável)
- [ ] `SECURITY.md` atualizado se introduziu novo REG
- [ ] Feature flag adicionada se feature é opcional (ver `docs/ARCHITECTURE.md` §4)

## Risco

- [ ] baixo — mudança isolada, sem migração, sem auth
- [ ] medio — toca auth/RBAC/RLS/chain/signer — requer review de segurança
- [ ] alto — toca vault/crypto/signer/broadcast — requer `/redteam` antes de merge

> Se `medio` ou `alto`: preencha `risco_motivo` e marque reviewer de segurança.

## Screenshots / Gravação (se UI)

<!-- Arraste imagens aqui. Para motion/skeleton, grave 5s mostrando loading → conteúdo com animação. -->
