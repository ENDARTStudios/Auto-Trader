# Proposta Formal de Aceite / Rejeição de Risco — Achados OS Debian Bookworm (T081)

> **Status:** PROPOSTA — NÃO ACEITA pelo Doer em nome do Operador. Decisão soberana do Operador obrigatória (D045).  
> **Versão:** 2026-09-27  
> **Relacionada:** T075 (triagem OS), T079 (Phase C2), T080 (hardening), T083 (merge PR #31), T078 (docs), T085 (integridade JSONL).  
> **Não altera:** código (`src/`), testes (`tests/`, `e2e/`), `package.json`/`lock`, Dockerfile, `docker-compose.yml`, `.github/workflows`, auth/RBAC/chain/signer/audit, schema Prisma, contratos de API.  
> **Não declara:** imagem totalmente segura; CVEs corrigidos; `continue-on-error` removido.

---

## 1. Operator Decision Box (decisão do Operador — não do Doer)

Escolha **uma e apenas uma** (marcar com `X`):

| Opção | Significado | Condição mínima para validade |
|---|---|---|
| **(A)** Aceitar risco mitigado para **staging/demo apenas**, com monitoramento e expiração | Risco residual aceito temporariamente; deploy para S14 vivo exige revisão adicional | Monitoramento ativo (re-scan Trivy), expiry ≤ 90 dias ou antes de qualquer mudança de base image/deploy production (o que ocorrer primeiro), restrição a não-prod até nova decisão |
| **(B)** Rejeitar; exigir **staging isolado** com remediação adicional antes de qualquer deploy | Não aceitar 52 achados como aceitáveis no estado atual; exigir remoção via base image/distroless/novo pacote antes de exposição | Nova fase de remediação com escopo e risco próprios; não pressupõe correcção imediata por upstream |
| **(C)** Rejeitar; **adiar deploy** até fixes upstream | Nenhum deploy até os 52 achados terem fix disponível | Aguardar upstream Debian; sem controle do time; prazo indeterminado |
| **(D)** Autorizar **nova fase de remediação / base image / distroless** com escopo e risco próprios | Aceitar o esforço de nova image como projeto separado, não como continuação deste | Requer decisão separada de escopo, orçamento e revisão de risco da nova imagem |

**Recomendação técnica (não vinculante):** (A) apenas para staging/demo, com expiry explícito e monitoramento. **Nunca para S14 live sem revisão adicional.** Esta recomendação **não** é aceitação de risco.

---

## 2. Inventário Residual Reconciliado (do scan mais recente no repo)

Fonte reconciliada: `docs/05-security-compliance/s34-remediation-plan.md` §12/§13 (run `36065096390` Phase C) + §13 (run `36089136711` Phase C2) + `docs/06-devops-deployment/docker-hardening.md` §1 + `SECURITY.md`. Nenhum scan novo foi executado após T085 porque T085 e T078 foram documentais (não alteraram imagem/dependências); portanto o inventário citado é o último válido.

| Métrica | Phase C (`36065096390`) | Phase C2 (`36089136711`) | Residual pó-Hardening T080 (`4caf78b`) |
|---|---|---|---|
| **Total findings** | 65 (61 CVE-2026 + 4 outros anos) | **56** | **56** (imagem não alterada por T080/T085/T078) |
| **HIGH** | 59 | **52** | **52** |
| **CRITICAL** | 6 | **4** | **4** |
| **Remediados (9)** | — | 9 CVEs OS (libcap2, libgnutls30×5 incl. 2 critical, libpcre2-8-0×3) | — (já zerados na imagem do stage runner) |
| **Sem fix (52)** | 52 (45 `affected` + 7 `fix_deferred`) | **52** (mesmo conjunto, sem alteração de upstream) | **52** |

**Explicação da diferença:** 65 → 56 = 9 remediados via `apt-get upgrade` no **stage runner do Dockerfile** (imagem final, `sha256:2cf067...` nas 3 stages), não no runner efêmero de CI. Os 52 restantes permanecem `affected`/`fix_deferred` no Debian bookworm; **nenhum fix upstream foi publicado** para esses específicos desde o scan. Hardening T080 (`USER node`, `read-only`, `no-new-privileges`, `cap-drop`, `init`, `HOSTNAME` fix) **não corrige** vulnerabilidades de pacote; reduz explotabilidade (superfície, privilégios, bind, escrita). Isso é **mitigação**, não **correção**.

**Contagem residual reconciliada a usar nesta proposta:** 52 findings sem fix, sendo HIGH 52 / CRITICAL 4, distribuídos em pacotes do sistema operacional (`node:20-slim@sha256:2cf067...`). Não listar CVE IDs específicos neste documento (são muitos; consulta ao scan Trivy do repo disponível para operador via `docs/05-security-compliance/s34-remediation-plan.md` §12/§13 se desejar detalhes completos). Nenhum segredo, log bruto de scan ou caminho local exposto aqui.

---

## 3. Controles Compensatórios Realmente Implementados e Validados (T080 / Phase C2)

Confirmados por evidência rastreável (não por declaração genérica):

| Controle | Implementação | Validação | Limitação |
|---|---|---|---|
| **Non-root (`USER node`, uid 1000)** | `Dockerfile`; `docker-compose.yml` serviço `app` | `/proc` `Uid=1000` + `CapEff=0` | Não remove vulnerabilidades do pacote; só reduz impacto de exploração como root |
| **Read-only rootfs (`--read-only`)** | `docker-compose.yml`; `docs/06-devops-deployment/docker-hardening.md` §4 | Endpoints `200`; `write_errors=0`; `docker run` validado | `/tmp` ainda precisa de `tmpfs`; dados persistentes precisam de volume explícito |
| **`tmpfs /tmp`** | `docker-compose.yml`; runtime flag | Escrito em `docs/06-devops-deployment/docker-hardening.md` | Escopo limitado ao `/tmp`; não protege outros paths |
| **`no-new-privileges`** | `docker-compose.yml`; `docs/06-devops-deployment/docker-hardening.md` | `/proc` `NoNewPrivs=1` | Não impede escalada via kernel/host |
| **`cap-drop ALL`** | `docker-compose.yml` | `/proc` `CapEff=0` | Não remove vulnerabilidades; só limita capabilities disponíveis |
| **`--init`** | `docker-compose.yml` | Processo `1` = `tini`; container `healthy` | Não corrige CVEs |
| **`HOSTNAME=0.0.0.0`** | `Dockerfile` (`ENV HOSTNAME=0.0.0.0`) | Fix de bind só-eth0 (Docker injeta `<container-id>`); endpoints `200` intra-container | Não é hardening de segurança; é correção de rede |
| **`.dockerignore` + `npm pin 11.20.0` + `tar 7.5.22`** | `Dockerfile` stage runner + `.dockerignore` | Phase C2 `77b5e7e`; Trivy 65→56 | Só trata CVEs remediáveis do `node-tar`; não afeta 52 restantes |
| **`continue-on-error` mantido** | `.github/workflows/ci.yml` (não alterado) | Trivy ainda `exit-code:1` + `continue-on-error:true`; CI verde | **Não é remedição**; é decisão de não-bloqueio até T081 |

**O que NÃO está implementado / NÃO é controle válido para esta proposta:**
- Distroless / `scratch` / `chainguard` / Alpine / base image alternativa (não executado; seria nova fase, opção D se autorizar).
- `seccomp`, `AppArmor`, `SELinux` profiles específicos para este container (não validado neste repo).
- Kernel host endurecido (fora do container; não reportado aqui).
- Supply chain validation de cada pacote do `node:20-slim` (não executado; seria novo escopo).
- Scan contínuo automatizado pós-deploy (não implementado; seria parte do monitoramento, não do controle atual).
- Remediação dos 52 CVEs (não disponível upstream para esses específicos no bookworm; não pode ser inventada).

---

## 4. Limitações Honestas (não suavizadas)

1. **Hardening não corrige vulnerabilidades de pacote.** Os 52 findings permanecem no código binário da imagem; controle reduz superfície/explotabilidade, não remove o defeito.
2. **Base image `node:20-slim@sha256:2cf067...` ainda contém os 52 findings.** Nenhuma atualização de pacote resolveu esses específicos; nenhum fix upstream foi publicado.
3. **`continue-on-error` no Trivy** significa que um novo CVE crítico poderia ser introduzido sem bloquear CI. A proposta não altera isso (conforme restrição da tarefa); monitora-se, não se impede.
4. **`db/ollama` e serviços terceiros no compose** podem não estar endurecidos (não foram auditados neste escopo; mencionados em `docs/05-security-compliance/s34-remediation-plan.md` como risco residual não tratado pelo hardening do serviço `app`).
5. **Container escape / kernel host** permanecem riscos: hardening de container não protege contra vulnerabilidades no host, no runtime do Docker, ou em kernels não atualizados.
6. **Novos CVEs em futuras atualizações** do `node:20-slim` podem aumentar ou alterar o inventário; a proposta tem expiry (90 dias / antes de deploy production, o que ocorrer primeiro) justamente para forçar revisão.
7. **Não há prova de que a aplicação não é vulnerável a algum dos 52 achados** (ex.: `libgnutls`, `pcre2`, `libcap`, `glibc`). A mitigação assume que a explotabilidade via caminho de rede/app é limitada, mas **não prova** ausência de exploração viável.
8. **Evidência de scan é do run `36089136711` (Phase C2).** Nenhum scan foi executado após T085/T078. Se o operador quiser evidência do estado atual, pode solicitar re-scan (não parte desta proposta; não alteraria a conclusão enquanto a imagem não mudou).

---

## 5. Monitoramento Proposto (condicional à aceitação)

Se (A) for escolhida (aceitação mitigada temporária):

| Frequência | Ação | Gatilho de revisão antecipada |
|---|---|---|
| **Contínuo / a cada deploy** | Re-scan Trivy do `Dockerfile` (`npm ci` + `docker build` + Trivy) | Nenhum; só valida que não aumentou além do esperado |
| **A cada 30 dias** | Verificação de novos fixes upstream para os 52 pacotes afetados (Debian security tracker) | Se fix upstream publicado para algum dos afetados |
| **A cada 90 dias (expiry)** | Revisão completa desta proposta + nova decisão A/B/C/D | Expired por design |
| **Antes de qualquer deploy production / S14 live** | Nova decisão obrigatória (não automático; não presumir aceitação) | Sempre, independentemente do expiry |
| **Se base image mudar** (`node:20-slim` digest novo, `node:22`, `distroless`, etc.) | Nova proposta completa | Sempre |

**Monitoramento que NÃO é implementado (não parte desta proposta; depende de decisão de infraestrutura futura):**
- Scan automático em CI por mudança de base image (necessário configurar, não apenas documentar).
- Alerta de novos CVEs via feed externo (não implementado neste repo).
- Pipeline de remediação automática via `apt-get upgrade` automatizado (não implementado; Phase C2 foi manual, qualquer nova fase precisa decisão própria).

---

## 6. Expiração / Revisão (expiry)

- **Data de expiração proposta:** 90 dias após a decisão do Operador (ou antes de qualquer deploy para produção / S14 live, o que ocorrer primeiro).
- **Revisão obrigatória:** antes de qualquer deploy production / live; antes de qualquer mudança de base image (`node:20-slim` digest, versão, alternativa); quando fix upstream publicado para qualquer dos 52 achados; quando novo CVE crítico introduzido na base.
- **Consequência de expirar sem nova decisão:** a aceitação (A) **não** se renova automaticamente; o deploy para produção / live não pode prosseguir sem nova decisão documentada (não presumir aceitação).

---

## 7. Separação Absoluta de Outras Pendências (não misturar)

Esta proposta trata **apenas** do risco residual OS Debian bookworm (52 findings sem fix, mitigados por hardening). **Não trata:**

- **T058 (visual/funcional):** bloqueado externamente (`DEPLOYMENT_NOT_FOUND` em `https://auto-trader-snowy.vercel.app/`). Requer URL válida / redeploy + credenciais descartáveis + papel da conta + MFA / dataset sanitizado. **Não é substituído por esta proposta.**
- **S14 (live trading):** bloqueado externamente (chaves `BINANCE_TESTNET` / `ALCHEMY` / `ETH_SEPOLIA_PRIVATE_KEY` + aprovação explícita do Operador). Requer decisão de risco operacional adicional além desta proposta. **Não é substituído por esta proposta.**
- **T067 (terminal-header dead code):** backlog interno, sem bloqueio ativo; pode ser tratado independentemente.
- **T086 (validator no CI):** backlog opcional, fora do escopo de risco.
- **`continue-on-error` do Trivy:** mantido conforme restrição; esta proposta não pede alteração.

---

## 8. Evidência de Verificação (não inventada; do repo)

- `docs/05-security-compliance/s34-remediation-plan.md` §12/§13: run `36065096390` (Phase C, 65 total, HIGH 59 / CRITICAL 6) → `36089136711` (Phase C2, 56 total, HIGH 52 / CRITICAL 4, 9 remediados).
- `docs/06-devops-deployment/docker-hardening.md`: 52 achados sem fix continuam; hardening reduz superfície; não corrige.
- `SECURITY.md`: `continue-on-error` do Trivy mantido; imagem não declarada segura.
- `PENDENCIAS_OPERADOR.md` §3 (atual após T078): T078 liberada; T058/S14 preservados; T081 formal pendente.
- `README.md` (3174614): seção Runtime / Deploy registra Node standalone, hardening, risco residual, bloqueios T058/S14.
- `DECISOES.md` #45 (D044): T085 aprovado; T081 autorizado; não aceita risco; não altera runtime/CI/deps.
- `SPRINT.md` §25: T085 fechado; T081 seguinte.
- `PLANO_MESTRE.md` F11-s34-Episodes + F11-s34-Hardening: consolidados.
- `logs/episodes.jsonl`: 37/37 parseável (36 reparados + evento T085); `scripts/validate-episodes.mjs` exit 0.
- `commit 4caf78b`: merge PR #32 (T084); `commit 0f79579`: docs T085/D044; `commit 3174614`: docs T078.
- CI main: `36261942375` (pós-T084 merge) e `36262772109` (pós-T085/T078 docs) — ambas `success` (ci/e2e/codeql).
- Nenhum SHA histórico do Git alterado; nenhum `rebase`/`filter-branch`/`amend` em histórico; `force push` não usado.

---

## 9. Limitação do Documento (transparência)

- **Não contém lista completa de CVE IDs dos 52 findings.** Referência ao scan existente no repo (seção 2). Se o operador exigir lista completa, pode consultar `docs/05-security-compliance/s34-remediation-plan.md` §12/§13 ou solicitar re-execução do Trivy (fora do escopo desta proposta; não altera conclusão enquanto imagem não mudar).
- **Não contém output bruto do Trivy** (evita exposição de formato de scan, caminhos de build internos, ou dados que poderiam ser usados para inventário não autorizado).
- **Não contém credenciais, tokens, URLs autenticadas, dados do operante, ou caminhos locais sensíveis.**

---

## 10. Próximos Passos Autorizados (após esta proposta — sem parar para autorização, conforme D045 / Thinker)

1. **T081:** esta proposta apresentada (não aceita pelo Doer; aguarda decisão do Operador).
2. **T067:** se `terminal-header` ainda confirmado dead code, executar cleanup (não depende de T081).
3. **Varredura final de backlog:** verificar `AGENTS.md` / `.agents/` / `skills-lock.json` / `.kilo/` (artefatos externos, não tocar); checar issues abertos, TODOs críticos, CI warnings residuais (`knip` warn, `Node.js 20 deprecated`), testes moderados (`vitest moderate chain` — exige major, backlog); verificar se há drift em `SECURITY.md`, `docs/05-security-compliance/s34-remediation-plan.md`, `docs/06-devops-deployment/docker-hardening.md` após T078.
4. **Relatório autônomo:** estado técnico consolidado, decisões registradas (D04x), pendências separadas (T058, S14, T081 decida pelo operante).
5. **Não executar T058** sem inputs do Operador (URL + credenciais descartáveis + papel + MFA/dataset).
6. **Não executar S14** sem chaves + aprovação explícita.

---

*Documento preparado pelo Doer sob D045 (autorização Thinker, 2026-09-27). Nenhum risco aceito em nome do Operador. Nenhuma alteração de runtime, Dockerfile, workflow, dependência ou código de produção foi realizada nesta tarefa. Nenhum SHA histórico alterado.*
