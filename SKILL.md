---
name: redteam
description: Executa uma rodada de testes adversariais defensivos contra o projeto atual (esta aplicacao, seus endpoints, sua autenticacao e qualquer agente/LLM embutido). Use antes de deploy, ao fechar uma fase com item de risco medio/alto no PLANO_MESTRE.md, ou quando o Operador pedir uma auditoria de seguranca. Nunca mira sistemas de terceiros.
effort: high
---

# /redteam — Teste adversarial defensivo

## Escopo (limite rígido, não negociável)
- Alvo: **somente este projeto**, rodando localmente ou em ambiente de staging próprio. Nunca um sistema de terceiros, nunca um alvo sem autorização explícita do Operador registrada em `DECISOES.md`.
- Objetivo: encontrar fraqueza para corrigir antes do deploy. Todo achado vem acompanhado de uma correção proposta — nunca produza um payload funcional como entregável isolado, sem esse contexto.
- Se a tarefa parecer pedir ataque contra algo fora deste projeto, ou uma lista de exploits sem correção associada: pare, não prossiga, registre em `PENDENCIAS_OPERADOR.md` e aguarde esclarecimento.

## Checklist — AppSec clássico (OWASP Top 10)
Para cada rota/endpoint que recebe entrada externa, verifique e registre o resultado:
- Injeção (SQL, NoSQL, comando de SO) — a query é parametrizada? o input é validado na fronteira?
- XSS — a saída é escapada antes de renderizar?
- CSRF — token sincronizado, `SameSite` configurado?
- SSRF — chamada externa valida o destino antes de buscar?
- Autenticação quebrada — enumeração de usuário, força bruta sem lockout, sessão previsível?
- Autorização quebrada (IDOR) — um usuário consegue acessar recurso de outro trocando um ID?
- Exposição de dado sensível — segredo aparece em log, mensagem de erro ou payload de resposta da API?

## Checklist — se o projeto embute um agente/LLM (OWASP Top 10 para LLM, 2025)
- **Prompt Injection (LLM01):** uma entrada de usuário consegue fazer o agente ignorar a instrução original?
- **Exposição de informação sensível (LLM02):** o agente revela segredo, PII ou dado de outro usuário quando perguntado de forma indireta?
- **Cadeia de suprimentos (LLM03):** dependências e modelos de terceiros têm procedência verificada?
- **Tratamento inseguro de saída (LLM05):** a resposta do agente é tratada como dado (escapada) antes de virar HTML/SQL/comando, ou é confiada cegamente?
- **Agência excessiva (LLM06):** o agente pode executar ação irreversível sem confirmação? Se sim, é falha do sandbox/hook (Seção 2 do `PROMPT_DOER_MESTRE.md`), não só do texto do prompt.
- **Vazamento do system prompt (LLM07):** pedir ao agente para revelar suas instruções internas funciona? Lembrete: prompt nunca é controle de segurança suficiente sozinho — se um segredo depende só de "o prompt diz para não contar", ele já vazou estruturalmente.
- **Consumo ilimitado (LLM10):** existe rate limit real, ou um usuário pode gerar custo/carga sem limite?

## Formato do relatório
Para cada achado:
```
### [severidade: baixo|medio|alto|critico] <título curto>
Onde: <arquivo/rota/componente>
Como reproduzir: <passos objetivos que provam a falha, sem payload pronto para uso fora de contexto>
Impacto: <o que se ganha explorando isso>
Correção proposta: <mudança concreta>
```

Achado **crítico ou alto**: gera uma `TAREFA` de correção antes de fechar a fase, mesmo que atrase o deploy — registre isso no `PLANO_MESTRE.md`. Achado **médio ou baixo**: registra em `DECISOES.md` e entra no próximo ciclo se não bloquear o objetivo atual da fase.
