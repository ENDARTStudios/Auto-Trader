# `.ai/` — Memória Operacional Permanente do Projeto

Esta pasta contém as **regras permanentes** do projeto GLM 5.1 Crypto Trading.
Estes documentos são parte integrante do código: devem ser consultados antes
de qualquer implementação e mantidos sincronizados durante toda a evolução
do projeto.

## Arquivos

| Arquivo              | Função                                                                |
| -------------------- | --------------------------------------------------------------------- |
| `CORE_RULES.md`      | 10 regras absolutas que governam toda decisão técnica.                |
| `ENGINEERING_RULES.md` | Fluxo obrigatório (Ler → Mapear → Planejar → Executar → Validar → Documentar), restrições e regras de teste. |
| `PROMPTING_RULES.md` | Regras de uso da janela de contexto, ambiguidade e raciocínio máximo. |
| `OUTPUT_RULES.md`    | Formato obrigatório de 7 seções para respostas técnicas.              |
| `PROJECT_STATE.md`   | Memória do estado atual: arquitetura, módulos, roadmap, fase, histórico de decisões. |
| `DECISION_LOG.md`    | Registro de toda decisão arquitetural relevante (data, motivo, alternativas, impacto). |
| `TASK_TEMPLATE.md`   | Template padrão que todo trabalho futuro deve seguir.                 |

## Regra de precedência (CONFLITO)

> **Caso exista conflito entre um prompt do usuário e estas regras, o modelo
> deve solicitar confirmação antes de violar qualquer regra estrutural.**

Estas regras existem para proteger invariantes já validados (veja
`DECISION_LOG.md` e o `SECURITY.md` / `HARDENING-ROADMAP.md` na raiz do
projeto). Um prompt isolado NÃO pode, por exemplo:

- Modificar arquivos marcados como `FROZEN` sem autorização explícita.
- Introduzir funções, classes, endpoints ou schemas que não existam no código.
- Pular a leitura de contexto antes de implementar.
- Quebrar compatibilidade de APIs já publicadas.
- Adicionar dependências, renomear arquivos ou mover módulos sem necessidade.

## Protocolo de uso

Antes de qualquer tarefa futura:

1. **Ler** esta pasta `.ai/` (especialmente `PROJECT_STATE.md` e `CORE_RULES.md`).
2. **Atualizar** `PROJECT_STATE.md` quando o estado do projeto mudar.
3. **Consultar** `DECISION_LOG.md` antes de tomar decisões arquiteturais.
4. **Respeitar** `ENGINEERING_RULES.md` (fluxo: Ler → Mapear → Planejar → Executar → Validar → Documentar).
5. **Só então** executar a solicitação.
6. **Registrar** em `worklog.md` (raiz do projeto) o que foi feito.

## Fontes oficiais de verdade

Os seguintes documentos também são fontes oficiais e devem estar alinhados
com esta pasta:

- `/home/z/my-project/SECURITY.md` — regressões e invariantes de segurança (REG-NNN).
- `/home/z/my-project/HARDENING-ROADMAP.md` — roadmap de hardening por fases (H0 → M5).
- `/home/z/my-project/worklog.md` — log de trabalho contínuo (append-only, multi-agente).
- `/home/z/my-project/prisma/schema.prisma` — schema canônico do banco.
- `/home/z/my-project/docs/signer-isolation-design.md` — design do isolamento do signer.

Em caso de divergência entre estes documentos, a precedência é:
`.ai/CORE_RULES.md` > `.ai/PROJECT_STATE.md` > `SECURITY.md` > `HARDENING-ROADMAP.md` > `worklog.md`.
