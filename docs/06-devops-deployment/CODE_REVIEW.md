# CODE_REVIEW — Guia de Code Review

> **Versão:** 1.0 — 2026-09-23
> **Princípio:** review protege capital e futuro do código — não é formalidade. CI já cobre o mecânico; humano cobre intenção.

---

## 1. O que o autor entrega (antes de pedir review)

- [ ] Descrição no formato problema/solução/validação (comandos executados + resultado).
- [ ] CI verde (lint, typecheck, gitleaks, audit, test:ci, coverage).
- [ ] Diff sem arquivos frozen (ou ADR anexada).
- [ ] Testes novos/ajustados cobrindo a mudança.
- [ ] Docs atualizados se comportamento documentado mudou.

PR sem validação descrita volta para o autor — não é tecnicismo: `DECISOES.md` inteiro segue esse formato e é o que torna o histórico auditável.

## 2. Checklist do revisor (ordem de leitura)

1. **Intenção:** a Issue/tarefa combina com o diff? Escopo cresceu?
2. **Segurança:** checklist da [SECURITY_REVIEW.md](./SECURITY_REVIEW.md) §2 se sensível.
3. **Domínio:** regras da skill respeitadas? (ex.: nenhum caminho novo escrevendo no envelope; P só de `M_param`).
4. **Design:** handler fino, service puro, interfaces — [STYLE_GUIDE.md](./STYLE_GUIDE.md) §2.
5. **Testes:** cobrem o caminho de falha, não só o feliz?
6. **Rigor:** nomes, i18n, a11y, docs — [STYLE_GUIDE.md](./STYLE_GUIDE.md), [ACCESSIBILITY.md](./ACCESSIBILITY.md).

## 3. Tom e prática

- Comente no **código** com sugestão concreta; aponte linha; explique o "por quê" (risco, não gosto).
- `nit:` para preferência sem impacto; bloqueante só com justificativa de risco/correção.
- Divergiu? Decisão vai para `DECISOES.md` — não se re-discute a cada PR.
- Aprovar ≠ testar tudo de novo; CI cobre. Aprovar = "eu assumo isso em produção".

## 4. Critérios de bloqueio (request changes)

- Arquivo frozen tocado sem ADR.
- Escrita (direta ou indireta) no envelope humano (`risk_config`, `mode`, `dag_edges`) fora do write-fence.
- Rota sem auth/validação/rate-limit quando aplicável.
- Teste frouxo (assert vazio, skip silencioso, `continue-on-error` em CI).
- Regressão de cobertura sem justificativa.

## 5. Pós-merge

- Squash com mensagem convencional; referencie a Issue.
- Se houve decisão, entrada em `DECISOES.md` (quem mergeou registra).
- Monitorar CI em `main` — quebra em main é incidente ([INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md)).

---

**Relacionados:** [DEVELOPMENT.md](./DEVELOPMENT.md) · [SECURITY_REVIEW.md](./SECURITY_REVIEW.md) · [QA_TESTING.md](./QA_TESTING.md)
