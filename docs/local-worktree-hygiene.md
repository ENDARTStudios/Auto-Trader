# Higiene da Working Tree (T089/T093 — 2026-09-28)

> Triagem read-only dos resíduos da working tree após o merge do PR #33. Nenhum segredo commitado; nenhum arquivo sensível versionado. PR #34 fechado na T093 (contaminação: árvore com `.env` herdado + artefatos locais); substituído por PR limpo.

## Classificação (T089)

| Caminho | Categoria | Ação tomada | Justificativa | Risco |
|---|---|---|---|---|
| `.ai/**` (28 arquivos, tracked) | REMOVER_DO_PR | Removidos do PR limpo | Artefatos de contexto de agente local; sem valor de governança clara | Baixo |
| `.github/pull_request_template.md` (tracked) | MANTER | Versionado no PR limpo | Correções de links; template útil para governnança | Baixo |
| `AGENT_GUIDE.md` (tracked) | REMOVER_DO_PR | Removido do PR limpo | Correções de links residuais; já coberto pelo reorg principal | Baixo |
| `HARDENING-ROADMAP.md` (tracked) | REMOVER_DO_PR | Removido do PR limpo | Correções de links residuais | Baixo |
| `MANUAL_DO_OPERADOR.md` (tracked) | REMOVER_DO_PR | Removido do PR limpo | Correções de links residuais | Baixo |
| `download/port-collision-investigation.md` (tracked) | REMOVER_DO_PR | Removido do PR limpo | Artefato local de investigação | Baixo |
| `skills/EXTERNAL_SYSTEMS_INDEX.md` (tracked) | REMOVER_DO_PR | Removido do PR limpo | Skills são artefato de ferramenta local | Baixo |
| `skills/agent-diagram-design.md` (tracked) | REMOVER_DO_PR | Removido do PR limpo | Skills são artefato de ferramenta local | Baixo |
| `worklog.md` (tracked) | REMOVER_DO_PR | Removido do PR limpo | Worklog pessoal | Baixo |
| `AGENT_AUTONOMO_DOER.md` (untracked) | MANTER | Versionado no PR limpo | Referenciado pelo `docs/README.md` no main; auditado: 0 segredos, 0 paths locais, 0 PII, 0 injeção; comandos destrutivos apenas em contexto de proibição | Baixo |
| `SECURITY.md` (`D` residual) | JA_TRATADO | `git restore SECURITY.md` | Resíduo do merge; movido para `docs/05-security-compliance/SECURITY.md` no PR #33 | Médio — duplicação |
| `.env` (tracked) | CONTIDO_T092 | `git rm --cached` no PR #35 | SECURITY_FINDING; valores reais suspeitos; histórico exposto (decisão do Operador) | Alto |
| `AGENTS.md` (tracked, modificado por processo externo) | NEUTRALIZADO_T092 | Restore HEAD + backup ignorado | Conteúdo não confiável; não obedecido | Médio |
| `skills-lock.json` (untracked) | IGNORAR_LOCAL | `.git/info/exclude` | Artefato local de skills | Baixo |
| `.agents/**` (untracked) | IGNORAR_LOCAL | `.git/info/exclude` | Artefato local de agente | Baixo |

## Pendências do Operador

- **`.env` histórico**: rotação de `DATABASE_URL` e `TYPESAFE_API_KEY` (P0); decisão sobre purge/reescrita de histórico.
- **`AGENTS.md`**: decisão final sobre a modificação externa (reverter já feito localmente; versionar ou ignorar).
- **Duplicação `SECURITY.md`**: raiz + `docs/05-security-compliance/SECURITY.md` (artefato do squash merge).

## Reconciliação de Contagem do Validator

- T091 reportou **41/41** na branch `docs/worktree-hygiene-t089` (não mergeada).
- T092 reportou **40/40** em `main` (branch criada de main pós-merge do PR #33, antes do evento T091 ser commitado na branch do PR #34).
- Diferença: o evento T091 existe apenas na branch não mergeada do PR #34. O PR limpo T093 deve registrar o evento T093 e a contagem final refletirá o estado de main.

## Evidência

- `git status --porcelain=v1 -uall` executado; 42 resíduos classificados individualmente.
- Nenhum segredo, token, PII ou dado real do Operador commitado.
- `.git/info/exclude` atualizado (skills-lock.json, .agents/).
- Sem alteração de código, runtime, CI ou dependências.
