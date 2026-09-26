# Integridade de `logs/episodes.jsonl`

> Trilha de eventos do protocolo Thinker/Doer (append-only). Documento de
> governança criado na **T084** (branch `chore/episodes-jsonl-integrity`, D043),
> reparo aprovado em **R063** e mergeado na **T085** (PR #32, merge `4caf78b`,
> D044 em `DECISOES.md` #45).

## 1. Política

1. **Append-only.** Novos eventos são sempre anexados ao final, um JSON por linha.
2. **Reescrita de histórico Git é proibida.** Nada de `rebase`, `filter-branch`,
   `commit --amend` em commits históricos, `force push` ou qualquer operação que
   altere SHA de commits anteriores. O histórico permanece como evidência.
3. **Exceção: reparo sintático controlado.** Uma linha malformada pode ser
   reparada no working tree **somente** se o reparo for:
   - puramente sintático (chaves/vírgulas/aspas/BOM/serialização JSON);
   - lossless — nenhum caractere de dado é removido ou reescrito;
   - preservador de ordem e contagem de linhas;
   - registrado aqui com antes/depois e revisado em PR isolado (draft, sem
     merge sem revisão do Thinker).
4. **Inferência semântica é proibida.** Se o reparo exigir adivinhar o valor de
   um dado (status, commit, hash, etc.), a linha NÃO é reparada por suposição —
   emite-se STATUS BLOCKED com evidência sanitizada e a correção é proposta
   como novo evento append-only.
5. **Validação obrigatória** antes de qualquer merge que toque o arquivo:
   `node scripts/validate-episodes.mjs --file logs/episodes.jsonl` (exit 0).

## 2. Procedimento de validação

```bash
node scripts/validate-episodes.mjs --file logs/episodes.jsonl --report docs/episodes-integrity.md
```

- Lê linha a linha, faz `JSON.parse` de cada uma.
- Reporta total, válidas, inválidas e números das inválidas.
- Exit 0 = todas válidas; exit 1 = alguma inválida.
- `--report` atualiza apenas o bloco entre marcadores deste documento
  (falha se os marcadores não existirem — nunca sobrescreve texto manual).
- Sem rede, sem leitura de segredos, somente builtins do Node (Windows safe).

## 3. Reparos da T084 (2026-09-26)

Situação inicial: **6 de 36 linhas malformadas, todas pré-existentes**
(confirmado contra `git show HEAD:logs/episodes.jsonl` — nasceram inválidas nos
commits `7d4d939`, `1b298bb`, `e189de2` etc.; nenhuma versão válida existiu no
histórico). Nenhum job de CI consome o arquivo (verificado por grep), mas ele é
evidência do protocolo e deve ser parseável.

Provas do reparo (script de reparo com asserts + verificação exata pós-edição):

- 36 linhas antes → **36 linhas depois** (nenhuma removida, duplicada ou reordenada).
- **30/30 linhas não listadas byte-idênticas** ao HEAD.
- Os 6 reparos conferem byte a byte com o registro antes/depois.
- Ordem de `tarefa_id` preservada em 36/36.
- Todos os campos semânticos (`evento`, `status`, `tarefa_id`, `fase`,
  `commit`, `pr`, `emitido_em_utc`) extraídos do original e do reparado são iguais.

> **Contagem pós-T085:** o reparo em si manteve 36→36. O único aumento
> legítimo veio do **evento de merge T085 anexado ao final** (append-only,
> 1 linha nova) — total atual **37/37 parseável**. Nenhuma linha do reparo
> foi removida, reordenada ou duplicada.

| Linha | Defeito (antes, sanitizado) | Reparo (depois, sanitizado) | Classe |
|------|------------------------------|------------------------------|--------|
| 1 | `\uFEFF{"sync":...,"duracao_minutos":270}}}` — BOM + 1 `}` faltando | BOM removido; `...270}}}}` | sintático (serialização) |
| 4 | `"eslint_warnings":1_preexistente,` + 1 `}` faltando | `"eslint_warnings":"1_preexistente",` + `}` anexado | sintático (token não-JSON envolvido em aspas, **todos os caracteres preservados**; significado numérico `1` documentado em DECISOES.md #34 (D021)) |
| 5 | `...anotacao isolada"}}}` — 1 `}` faltando | `...anotacao isolada"}}}}` | sintático (chave faltante) |
| 8 | `"ci":"success-23-23-incl-gitleaks":"x"` | `"ci":{"success-23-23-incl-gitleaks":"x"}` | objeto malformado — `{ }` inseridos (**lossless**) |
| 13 | `...PR proprio"}}}` — 1 `}` extra | `...PR proprio"}}` | sintático (chave extra) |
| 14 | `"ci":"success-23-23-ubuntu-24.04":"x"` e `"codeql":"success-v4-1m7s":"x"` | `"ci":{...}` e `"codeql":{...}` — `{ }` inseridos | objeto malformado — **lossless** |

### Nota sobre as linhas 8 e 14 (decisão de estrutura)

O fragmento `:"x"` após um valor não tem reparo semântico único: as alternativas
eram (a) inserir `{ }` envolvendo a dupla chave-valor existente (**escolhida** —
adiciona 2 caracteres, não remove nem reescreve nenhum dado), (b) deletar o
fragmento `:"x"` (perderia conteúdo) ou (c) inventar um nome de chave. A opção
(a) é a única 100% lossless. O formato resultante difere da convenção de
outras linhas (ex. L10: `"ci":"success-23-23"` string simples), o que é
registrado aqui como **ressalva estrutural revisável no PR** — o Thinker pode
vetar a escolha na review. Cross-check externo: `gh run view` confirma os
`conclusion` reais das runs (`35927373492`: ci/codeql/e2e success;
`35936642382`: sucesso) — nenhum valor de `status` foi alterado.

## 4. Limitações

- As 6 linhas nasceram inválidas no histórico Git; o reparo altera o conteúdo
  do arquivo em main (novos blobs), **não** os SHAs históricos. O histórico
  antigo continua contendo as versões malformadas — rastreabilidade preservada.
- Nenhum job de CI valida o arquivo; o validator é local (uso manual, §2).
  A D044 (#45) **não autorizou** integrá-lo ao CI/pre-push — isso seria
  mudança de workflow/hook e fica como backlog opcional futuro (**T086**),
  sujeito a autorização explícita do Thinker em tarefa isolada.
- A remoção do BOM na linha 1 é a única alteração "de bytes não-JSON" (o BOM
  nunca foi dado do evento; é artefato de encoding).

## 5. Relatório do validador

<!-- episodes-validator-report -->
- Gerado por `scripts/validate-episodes.mjs` em `2026-09-26T18:27:04Z` (nao editar manualmente).
- Arquivo: `D:\PROJETOS\Auto Trader\Auto Trader\logs\episodes.jsonl`
- Linhas totais: **37** | validas: **37** | invalidas: **0**
- Resultado: **PASS** (exit 0)
<!-- /episodes-validator-report -->
