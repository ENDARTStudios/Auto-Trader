# Pacote de Decisão do Operador — Auto Trader (T094 — 2026-09-28)

> **Status:** Dossiê decision-grade. Todas as pendências abaixo exigem autoridade externa (Operador). O Doer não decide nenhuma delas.
> **Como usar:** cada bloco é independente. O Operador pode responder bloco a bloco.

---

## BLOCO 1 — SEC-ENV: Incidente `.env` (P0 — URGENTE)

**Status:** ABERTO. `.env` fora do tree atual (T092), mas **histórico de 4 commits permanece exposto**.

| Item | Detalhe |
|---|---|
| Arquivo | `.env` (160 bytes, hash prefixo `2487E391BEAB75D1…`) |
| Chaves suspeitas | `DATABASE_URL`, `TYPESAFE_API_KEY` (valores reais suspeitos) |
| Commits expostos | `6bed930`, `84a70d3`, `8d48f64`, `417f6c6` |
| Contido no tree | Sim (T092, PR #35, merge `799ae4f`) |
| Contido no histórico | **NÃO** — requer decisão do Operador |

**Ações obrigatórias do Operador:**

1. **Rotacionar imediatamente** `DATABASE_URL` e `TYPESAFE_API_KEY` no provedor de origem.
2. **Inspecionar manualmente** o `.env` local para identificar outros segredos reais.
3. **Revogar/rotacionar** qualquer chave, token, senha ou conexão encontrada.
4. **Confirmar** se algum segredo foi usado em produção, staging, CI, Vercel, banco externo ou serviço de terceiros.
5. **Decidir** se autoriza purge/reescrita de histórico Git (ação destrutiva/coordenada — o Doer não executa sem aprovação explícita).

**Critérios para encerrar o incidente:**

- Rotação das chaves confirmada pelo Operador;
- Decisão formal sobre histórico documentada;
- Varredura de segredos no histórico recente sem achados adicionais (ou escalada).

**Efeito enquanto aberto:** o projeto **não** deve ser considerado pronto para produção, deploy sensível ou S14.

---

## BLOCO 2 — T081: Risco OS Debian Bookworm (P1)

**Status:** proposta entregue, decisão pendente.

| Item | Detalhe |
|---|---|
| Achados | 52 sem fix upstream (HIGH 52 / CRITICAL 4), mitigados por hardening (não corrigidos) |
| Proposta | `docs/05-security-compliance/risk-acceptance-proposal.md` |
| Inventário | 65→56 (Phase C→C2); 52 residuais; controles validados; monitoramento/expiry 90 dias |

**Opções (marcar uma):**

- **(A)** Aceitar risco mitigado apenas para staging/demo, com monitoramento e expiry.
- **(B)** Rejeitar; exigir staging isolado com remediação adicional.
- **(C)** Rejeitar; adiar deploy até fixes upstream ou nova base image.
- **(D)** Autorizar nova fase de remediação/base image/toolchain com PR isolado.

---

## BLOCO 3 — T058: Verificação Visual/Funcional (P1)

**Status:** BLOQUEADA externamente.

| Item | Detalhe |
|---|---|
| Site | `https://auto-trader-snowy.vercel.app/` → **404** (DEPLOYMENT_NOT_FOUND) |
| Vercel | build-rate-limit ativo em deployments de PR |
| Última verificação | T091/T094 — 404 |

**Inputs necessários do Operador:**

- [ ] URL base válida de demo/staging ou confirmação de redeploy.
- [ ] Resolução do build-rate-limit ou uso de ambiente alternativo.
- [ ] E-mail de teste descartável.
- [ ] Senha temporária ou link mágico/OAuth de teste.
- [ ] Papel da conta: viewer, trader ou admin.
- [ ] MFA/secret temporário, se aplicável.
- [ ] Confirmação de dataset sanitizado ou ausência de dado real sensível.
- [ ] Consentimento para smoke não destrutivo.

---

## BLOCO 4 — S14: Live Trading (P2)

**Status:** BLOQUEADO. Não confundir com T058.

**Pré-requisitos (todos):**

- [ ] SEC-ENV encerrado.
- [ ] T081 decidido.
- [ ] T058 validada em ambiente controlado.
- [ ] Chaves/API credentials reais ou vault/KMS aprovado.
- [ ] Aprovação explícita para transição paper → live.
- [ ] Limites financeiros máximos.
- [ ] Kill-switch operacional validado.
- [ ] Observabilidade e alerta de incidentes.
- [ ] Plano de rollback e resposta a incidentes.

---

## BLOCO 5 — GOVERNANCA: Branch Protection (P1)

**Status:** proposta entregue, aplicação pendente.

| Item | Detalhe |
|---|---|
| Proposta | `docs/branch-protection-policy.md` (T090) |
| Estado atual | main **sem proteção formal** (evidência: HTTP 404) |
| Regra mínima | PR obrigatório; ci/codeql/gitleaks verdes; sem force push/deleção; e2e condicional; Vercel monitorado; Trivy non-blocking até T081; anti-regressão .env/segredos; escalonamento ao Operador |

**Decisão necessária:** aprovar, ajustar ou rejeitar a política antes de aplicação. O Doer não aplica configuração no GitHub sem aprovação explícita.

---

## BLOCO 6 — WORKING_TREE: Estado Pós-T093

| Item | Estado |
|---|---|
| PR #34 | Fechado (contaminado: árvore com `.env` herdado + artefatos locais) |
| PR #36 | Mergeado (5 arquivos seguros, squash `8ff6be0`) |
| PR #35 | Mergeado (containment `.env`, squash `799ae4f`) |
| PR #37 | Mergeado (proposta branch protection, squash `b44afd1`) |
| `.env` | Fora do tree; local preservado; histórico exposto (Bloco 1) |
| `AGENTS.md` | Em HEAD; modificação externa neutralizada (backup ignorado) |
| Artefatos locais | Removidos dos PRs; `.ai/**`, `download/`, `skills/`, `worklog.md` fora do repo |
| Working tree | Limpa |

---

## BLOCO 7 — HIGIENE_OPCIONAL: T067 e T086

| Tarefa | Descrição | Risco | Condição |
|---|---|---|---|
| T067 | Cleanup de `terminal-header` (dead code) | Baixo | Executar se não houver bloqueio maior |
| T086 | Integrar validator de `episodes.jsonl` ao CI/pre-push | Baixo | Executar se não houver bloqueio maior; exige autorização do Thinker |

---

## Resumo de Prioridades

| Prioridade | Bloco | Ação |
|---|---|---|
| **P0** | SEC-ENV | Rotacionar `DATABASE_URL` + `TYPESAFE_API_KEY`; decidir sobre histórico |
| **P1** | T081 | Marcar opção A/B/C/D |
| **P1** | T058 | Fornecer URL válida + credenciais de teste + resolver Vercel |
| **P1** | GOVERNANCA | Aprovar/ajustar/rejeitar política de branch protection |
| **P2** | S14 | Após T058 + T081 + SEC-ENV; fornecer chaves + aprovação |
| **Opcional** | T067/T086 | Higiene, sem bloqueio |

---

*O Doer não decide nenhum dos blocos acima. Este dossiê é o pacote único de decisão para o Operador.*
