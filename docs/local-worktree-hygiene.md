# Higiene da Working Tree (T089 — 2026-09-28)

> Triagem read-only dos resíduos da working tree após o merge do PR #33. Nenhum segredo commitado; nenhum arquivo sensível versionado.

## Classificação

| Caminho | Categoria | Ação tomada | Justificativa | Risco |
|---|---|---|---|---|
| `.ai/**` (28 arquivos, tracked) | VERSIONAR_SEGURO | PR separado | Correções de paths legítimas (script T087) | Baixo — docs/agente |
| `.github/pull_request_template.md` (tracked) | VERSIONAR_SEGURO | PR separado | Correções de links; útil para governnança | Baixo |
| `AGENT_GUIDE.md` (tracked) | VERSIONAR_SEGURO | PR separado | Correções de links | Baixo |
| `HARDENING-ROADMAP.md` (tracked) | VERSIONAR_SEGURO | PR separado | Correções de links | Baixo |
| `MANUAL_DO_OPERADOR.md` (tracked) | VERSIONAR_SEGURO | PR separado | Correções de links | Baixo |
| `download/port-collision-investigation.md` (tracked) | VERSIONAR_SEGURO | PR separado | Correções de links | Baixo |
| `skills/EXTERNAL_SYSTEMS_INDEX.md` (tracked) | VERSIONAR_SEGURO | PR separado | Correções de links | Baixo |
| `skills/agent-diagram-design.md` (tracked) | VERSIONAR_SEGURO | PR separado | Correções de links | Baixo |
| `worklog.md` (tracked) | VERSIONAR_SEGURO | PR separado | Correções de links | Baixo |
| `AGENT_AUTONOMO_DOER.md` (untracked) | VERSIONAR_SEGURO | PR separado | Referenciado pelo `docs/README.md` no main — link quebrado se não versionado | Baixo |
| `SECURITY.md` (`D` residual) | JA_TRATADO | `git restore SECURITY.md` | Resíduo do merge; arquivo movido para `docs/05-security-compliance/SECURITY.md` no PR #33. Nota: o squash merge manteve ambos (raiz + docs/05) — duplicação a resolver em tarefa futura | Médio — duplicação |
| `.env` (tracked) | ESCALAR_OPERADOR | Não commitado | Contém segredos; `.gitignore` já cobre `.env*` mas o arquivo está tracked. Requer decisão: `git rm --cached` + rotação de segredos se houver exposição | Alto |
| `AGENTS.md` (tracked, modificado por processo externo) | ESCALAR_OPERADOR | Não commitado | Modificação externa não autorizada; não commitar sem aprovação do Operador | Médio |
| `skills-lock.json` (untracked) | IGNORAR_LOCAL | `.git/info/exclude` | Artefato local de skills | Baixo |
| `.agents/**` (untracked) | IGNORAR_LOCAL | `.git/info/exclude` | Artefato local de agente | Baixo |

## Pendências do Operador

- **`.env` tracked**: decidir se remove do versionamento (`git rm --cached .env`) e rotaciona segredos caso tenham sido expostos em histórico.
- **`AGENTS.md` externo**: modificação externa pendente de aprovação para versionar ou descartar.
- **Duplicação `SECURITY.md`**: raiz + `docs/05-security-compliance/SECURITY.md` (artefato do squash merge). Decidir qual manter.

## Evidência

- `git status --porcelain=v1 -uall` executado; 42 resíduos classificados individualmente.
- Nenhum segredo, token, PII ou dado real do Operador commitado.
- `.git/info/exclude` atualizado (skills-lock.json, .agents/).
- Sem alteração de código, runtime, CI ou dependências.
