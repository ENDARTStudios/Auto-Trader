---
name: premortem
description: Analise de pre-morte antes de decisao arquitetural, deploy ou fechamento de fase de risco alto — assume que o projeto falhou catastroficamente no futuro e trabalha de tras pra frente ate achar a causa raiz. Use antes de aprovar uma decisao irreversivel ou de grande escopo.
effort: high
---

# /premortem — Análise de pré-morte

Assuma que, daqui a alguns meses, este projeto falhou de forma catastrófica — caiu em produção, vazou dado sensível, ou ficou impossível de manter. Trabalhe de trás para frente:

1. Liste de 3 a 7 causas-raiz plausíveis para essa falha. Não só as óbvias — inclua caso extremo, gargalo de performance sob carga real, dependência crítica que quebra, inconsistência lógica entre módulos, e decisão de escopo que parecia boa isoladamente mas cria dívida ao se combinar com outra.
2. Para cada causa, classifique impacto (baixo/médio/alto/crítico) e probabilidade (baixo/médio/alto).
3. Para as de impacto alto/crítico: proponha a mudança concreta que remove ou mitiga a causa agora, antes de prosseguir.
4. Registre o resultado em `DECISOES.md` — inclusive as causas descartadas, com o motivo do descarte, para não serem reanalisadas do zero na próxima vez.

Use isto antes de: aprovar uma mudança de arquitetura, fazer o primeiro deploy em produção, ou fechar uma fase que tenha item `risco: alto` no `PLANO_MESTRE.md`.
