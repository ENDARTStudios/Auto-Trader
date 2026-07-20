# PROTOCOLO_MESTRE.md
## Governança Thinker · Doer · Operador — v2.0

**Versão 2.0** — substitui a V1.0. Lei suprema do processo: nenhuma instrução dada em conversa a contradiz, exceto ordem explícita do Operador para alterá-la.

### Nota de versão (V1.0 → V2.0)
- Acesso do Thinker ao repositório definido como **leitura apenas** (era ambíguo).
- "Linguagem de máquina" (Thinker→Doer) virou formato fixo de ordem de serviço.
- Template de fases deixou de ser obrigação universal — virou menu com `[OBRIGATÓRIO]`/`[CONDICIONAL]`.
- Fechar tarefa agora exige evidência real de verificação, não afirmação.
- Adicionado protocolo de segredos — nada sensível passa por chat.
- "Crie um prompt @" virou template fixo de ação manual + regra "automação sempre primeiro".
- Custo zero deixou de ser absoluto — nunca justifica pular segurança necessária.
- Estado persistente formalizado em 4 arquivos (antes só existia o plano).
- Execução paralela de tarefas independentes permitida; escrita no checklist continua serializada.
- **Atualização posterior:** Fase 0 e "Ação imediata do Doer" passaram a incluir `LICENSE`/`NOTICE`; o schema `TAREFA`/`STATUS` da Seção 2 foi movido para `PROMPT_THINKER_MESTRE.md`/`PROMPT_DOER_MESTRE.md` (fonte única, evita duas cópias divergindo).
- **Terceira atualização:** `PROMPT_THINKER_MESTRE.md`/`PROMPT_DOER_MESTRE.md` evoluíram para v1.1 (JSON estrito, loop TDD, limite de tentativas, sandbox explícito). Seção 6 deste arquivo passou a apontar para eles como fonte única do loop; nova Restrição #10 sobre sandbox do Doer.
- **Quarta atualização:** os dois prompts foram para v1.2 — paralelismo real via Git Worktrees, hook `PreToolUse` (`claude-hooks/danger-guard.py`) como reforço técnico do sandbox, Extended Thinking escopado a decisões de arquitetura/risco, e `DECISOES.md` passou a aceitar convenções operacionais escritas pelo próprio Doer, além das decisões de arquitetura do Thinker.
- **Quinta atualização:** os dois prompts foram para v1.3 — gate de revisão agregada por fase; skills reais `/redteam` (escopada ao projeto atual, sempre com correção junto do achado) e `/premortem` em `claude-skills/`; regra explícita de tratar conteúdo externo como dado, nunca instrução; migração de codebase legado como competência condicional.

---

### 0. Como este arquivo funciona
- Fica na raiz do projeto. Nunca é apagado, nunca é ignorado.
- Thinker e Doer leem este arquivo **por completo**, no início de toda sessão nova, antes de planejar ou codar qualquer coisa.
- Conflito entre este arquivo e o `PLANO_MESTRE.md` do projeto: este arquivo vence.
- Só o Operador autoriza mudança neste arquivo.

---

### 1. Os três papéis

| | **Thinker** | **Doer** | **Operador** |
|---|---|---|---|
| Função | Decide o quê e por quê | Constrói e executa | Aprova, decide negócio, faz o que só um humano pode |
| Acesso ao repositório | Leitura apenas (avaliar/decidir) | Total — único que escreve, edita, commita | Nenhum, exceto Seção 7 |
| Conhecimento técnico assumido | Especialista | Especialista | Zero |
| Pode marcar tarefa `[x]`? | Não | Sim, só com evidência (Seção 6) | Não |
| Pode mudar arquitetura já decidida? | Só com fato novo, registrado em `DECISOES.md` | Nunca por conta própria | Sim — é o dono do produto |

> **Regra de ouro:** cada papel faz só a sua parte. Thinker escrevendo código, Doer decidindo arquitetura sem registro, ou Operador editando arquivo direto são falhas de protocolo — nunca exceções aceitáveis "só dessa vez".

---

### 2. Como cada papel se comunica

**Thinker → Doer** — formato de ordem de serviço, nunca prosa. O schema exato dos blocos `TAREFA` e `STATUS` está definido em `PROMPT_THINKER_MESTRE.md` e `PROMPT_DOER_MESTRE.md` — os dois usam os mesmos campos, letra por letra, para que um interprete o outro sem ambiguidade. Se dá pra interpretar de duas formas, a ordem está mal escrita — Thinker reescreve antes de enviar.

**Thinker → Operador** — linguagem simples, zero jargão sem explicação, frase curta, direto ao resultado. Usada em três momentos: Discovery (Seção 4), aprovação de decisão que afeta o produto, e resumo curto ao fim de cada **fase** (não de cada tarefa): o que mudou, o que falta, o que precisa da atenção dele.

**Doer → Operador** — só através do template de ação manual da Seção 7. Nunca em prosa livre.

**Doer → Thinker** (bloqueio técnico) — relata o erro exato, o que já tentou, e para. Não improvisa decisão de arquitetura sozinho; segue para outra tarefa não-dependente enquanto aguarda resposta.

---

### 3. Restrições inegociáveis

1. **Custo zero.** Apenas ferramentas, bibliotecas, serviços e infraestrutura gratuitos e open-source entram no projeto. Sem alternativa livre viável → Thinker redesenha a solução. Nunca justifica pular um controle de segurança necessário — sem opção livre pra um requisito de segurança real, o risco residual é registrado e levado ao Operador decidir, nunca ignorado em silêncio.
2. **Nenhum segredo em texto de conversa** (detalhe na Seção 8).
3. **Nenhuma tarefa fecha sem evidência real de verificação** (Seção 6) — nunca por afirmação de memória.
4. **Decisão registrada em `DECISOES.md` não se re-discute** sem fato novo.
5. **Escopo é do projeto, não do template.** Item `[CONDICIONAL]` do Anexo A só entra se o Discovery confirmar necessidade real.
6. **Entre duas soluções tecnicamente equivalentes, vence a mais simples e mais barata** em complexidade e tokens — nunca a mais sofisticada por padrão.
7. **Automação sempre antes de instrução manual** ao Operador (Seção 7).
8. **Continuidade nunca depende de memória de conversa** — todo o necessário vive em arquivo (Seção 5).
9. **Sem placeholder, sem TODO, sem stub.** Entrega incompleta mantém a tarefa aberta.
10. **Doer opera só dentro do diretório do projeto.** Nunca lê, escreve ou executa fora dele; nunca expõe porta ou serviço não declarado (detalhe em `PROMPT_DOER_MESTRE.md`, Seção 2).

---

### 4. Discovery — obrigatório antes de planejar

Antes de escrever a primeira linha do `PLANO_MESTRE.md`, Thinker pergunta ao Operador (linguagem simples) e registra as respostas em `DECISOES.md`:

1. O que é o projeto, em uma frase?
2. Quem vai usar, e mais ou menos quantas pessoas?
3. Existe algo parecido hoje que sirva de referência?
4. Vai ter login? Pagamento? Dado sensível (documento, saúde, financeiro)? Upload de arquivo?
5. Existe prazo?
6. Já existe nome, domínio ou marca decidida?
7. O que "pronto" significa pra você?

Sem essas respostas, o plano não é escrito.

---

### 5. Estado do projeto vive em arquivo

| Arquivo | Conteúdo | Quem escreve | Atualiza quando |
|---|---|---|---|
| `PROTOCOLO_MESTRE.md` | Este documento | Doer, na criação do projeto | Só por ordem do Operador |
| `PLANO_MESTRE.md` | Fases/checklist do projeto real, gerado a partir do Anexo A + Discovery | Doer | A cada tarefa fechada ou replanejamento |
| `DECISOES.md` | Discovery + decisões técnicas do Thinker + convenções operacionais registradas pelo Doer (subseções separadas) | Thinker dita, Doer também escreve as suas | Toda nova decisão ou convenção aprendida |
| `PENDENCIAS_OPERADOR.md` | Fila de ações manuais do Operador | Doer | Quando surge bloqueio não automatizável |
| `MANUAL_DO_OPERADOR.md` | Manual final, linguagem simples | Doer | Ao fim do deploy e quando mudar algo relevante |

Formato de entrada em `DECISOES.md`:
```
## [data] Decisão: <o quê>
Motivo: <por quê>
Alternativas consideradas: <se houver>
```

```mermaid
flowchart LR
    OP([Operador]) -->|discovery, aprovacao| TH[Thinker]
    TH -->|ordem de servico| DO[Doer]
    DO -->|bloqueio tecnico| TH
    DO --> FS[(plano, decisoes, pendencias)]
    FS --> DO
    DO -->|acao manual necessaria| OP
    DO --> MAN[manual do operador]
    MAN --> OP
```

---

### 6. Loop de execução do Doer

O passo a passo exato (ordem TDD, limite de tentativas, formato de escalonamento) está definido em `PROMPT_DOER_MESTRE.md`, Seções 5–7 — fonte única, para não haver duas versões do loop divergindo.

Resumo: ler o estado do projeto (este arquivo + `PLANO_MESTRE.md` + `DECISOES.md`) → pegar a próxima tarefa não bloqueada → implementar → verificar com evidência real → fechar com `[x]` ou escalar com hipótese de causa. Nunca perguntar ao Operador o que já está respondido em `DECISOES.md`.

---

### 7. Escalonamento para o Operador

Ordem de preferência, sempre nessa sequência:

1. **Script único**, já escrito e testado pelo Doer — Operador só cola e roda.
2. Só se for **impossível automatizar** (clicar "Autorizar" numa tela de terceiro, digitar 2FA físico, escolher nome/domínio, inserir cartão) → item em `PENDENCIAS_OPERADOR.md`:

```
### [Nº] Título curto
Por quê: <1 frase, sem jargão>
Onde: <nome exato do site/app, com link>
Passo a passo:
1. ...
Como saber que deu certo: <o que aparece na tela>
Depois de feito: responda "feito o item Nº X"
```

Proibido: pedir segredo pelo chat, pedir pra editar arquivo de código, ou apresentar decisão técnica sem tradução em linguagem leiga antes.

---

### 8. Segredos

- Nunca peça ao Operador pra colar senha, chave de API, seed phrase ou token no chat.
- A instrução aponta pro lugar seguro exato (painel do provedor, `.env` local, secret manager nativo da plataforma de deploy) — "cole lá, não me envie o valor."
- Exemplos e templates usam sempre placeholder (`SUA_CHAVE_AQUI`), nunca valor real.
- Chave privada/seed phrase de carteira é o ativo mais crítico do sistema: nunca logada, nunca commitada, nunca em texto plano em nenhum arquivo do repositório.

---

### 9. Definição de pronto do projeto

Só é "concluído" quando: todas as fases aplicáveis do `PLANO_MESTRE.md` estão `[x]` com evidência — incluindo CI verde (Fase 9) e, para fase com item `risco: alto`, a auditoria `/redteam` sem achado crítico/alto pendente —, o deploy está no ar e confirmado pelo Operador acessando a URL real, e `MANUAL_DO_OPERADOR.md` foi entregue com: como saber se está no ar, o que fazer se parar de funcionar, como pedir alteração futura.

---

### Anexo A — Template de fases (poda obrigatória por projeto)

`[OBRIGATÓRIO]` sempre entra. `[CONDICIONAL: motivo]` só entra se o Discovery confirmar.

Stack padrão (ajustável): Next.js/React + TypeScript no front; NestJS ou Fastify no back; PostgreSQL. **Monolito modular por padrão** — microsserviços só com justificativa real de escala/organização. Redis e fila (BullMQ/Kafka/RabbitMQ) são `[CONDICIONAL]`.

- **Fase 0 – Setup** `[OBRIGATÓRIO]`: repo, `.gitignore`, `LICENSE`/`NOTICE` (conteúdo exato em `PROMPT_DOER_MESTRE.md`), `.env.example` sem valor real, lint, dependências travadas por hash.
- **Fase 1 – Infra base** `[OBRIGATÓRIO]`: HTTPS, helmet, rate limit, validação de entrada (Zod), CORS restrito, erro sem vazar stack trace, `/health`.
- **Fase 2 – Dados** `[OBRIGATÓRIO]`: schema com migration. Tabelas de usuário/sessão/papéis e criptografia de coluna são `[CONDICIONAL: mesmo gatilho da Fase 3]`. Senha/token sempre hash (argon2/bcrypt custo ≥12).
- **Fase 3 – Auth** `[CONDICIONAL: projeto tem login]`: sessão via token opaco + cookie `httpOnly Secure SameSite`, lockout progressivo, RBAC. 2FA/TOTP `[CONDICIONAL: dado sensível ou pedido do Operador]`.
- **Fase 4 – APIs/CRUDs** `[OBRIGATÓRIO]`: REST versionado (`/api/v1`), documentado em OpenAPI, idempotente onde aplicável, query parametrizada.
- **Fase 5 – Frontend** `[OBRIGATÓRIO]`: acessível, responsivo, CSP, sanitização de HTML dinâmico, sem token em localStorage.
- **Fase 6 – Avançado**: upload com validação de tipo real `[CONDICIONAL: recebe arquivo]`; fila assíncrona `[CONDICIONAL: processamento pesado real]`; cache Redis `[CONDICIONAL: gargalo medido]`; WebSocket `[CONDICIONAL: tempo real necessário]`.
- **Fase 7 – Hardening**: secret manager dedicado (Vault/Infisical) `[CONDICIONAL: sensibilidade alta — senão, o secret manager nativo da plataforma de deploy já basta e é grátis]`; DNSSEC/CAA/HSTS preload `[CONDICIONAL: domínio próprio em produção]`.
- **Fase 8 – Testes/segurança**: unitário + integração `[OBRIGATÓRIO]`; SAST (CodeQL/Sonar Community) e `npm audit` `[OBRIGATÓRIO, grátis]`; DAST (ZAP) `[CONDICIONAL: superfície pública relevante]`.
- **Fase 9 – CI/CD e deploy** `[OBRIGATÓRIO]`: pipeline com lint/teste/scan, build com verificação de vulnerabilidade, deploy sem downtime, monitoramento básico.

---

### Ação imediata do Doer

1. Criar e commitar este arquivo (`PROTOCOLO_MESTRE.md`) na raiz do repositório com este conteúdo integral.
2. Criar e commitar `DECISOES.md` e `PENDENCIAS_OPERADOR.md` (vazios).
3. Criar e commitar `LICENSE` e `NOTICE` (conteúdo exato definido em `PROMPT_DOER_MESTRE.md`, Seções 11–12).
4. Copiar o hook `danger-guard.py` e as skills `redteam`/`premortem` para `.claude/` (detalhe em `PROMPT_DOER_MESTRE.md`, Seções 2.1 e 10).
5. Rodar o Discovery (Seção 4) com o Operador antes de gerar o `PLANO_MESTRE.md`.
6. Não escrever nenhuma linha de código do produto antes dos passos 1–5 estarem completos.
