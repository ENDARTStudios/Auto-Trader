# Incidente de Segurança — `.env` Rastreado (T092 — 2026-09-28)

> **Status:** INCIDENTE ABERTO — containment do tree executado; **histórico continua exposto** e requer decisão do Operador.
> **Classificação:** SECURITY_FINDING / SECURITY_INCIDENT_ENV.

## Linha do Tempo Sanitizada

| Data | Evento |
|---|---|
| 2026-09-25 | `.env` commitado pela primeira vez no histórico (commit `6bed930` "Initial commit") |
| 2026-09-27 | Mais 2 commits com `.env` (`84a70d3`, `8d48f64`) |
| 2026-09-27 | `417f6c6` — último commit com `.env` no histórico |
| 2026-09-28 | T091 detecta `.env` rastreado com valores reais suspeitos — SECURITY_FINDING |
| 2026-09-28 | T092 — `.env` removido do index (`git rm --cached`); arquivo local preservado; `.gitignore` e `.env.example` criados |

## Achado

- `.env` estava **rastreado** no Git, presente em **4 commits** do histórico.
- Contém 2 chaves com **valores reais suspeitos**: `DATABASE_URL` e `TYPESAFE_API_KEY`.
- Zero placeholders; 160 bytes; hash SHA256 (prefixo) `2487E391BEAB75D1…`.
- O `.gitignore` continha `.env*`, mas o arquivo já estava rastreado (ignore não desrastreia).

## Ações Imediatas Executadas (containment do tree)

1. `git rm --cached .env` — removido do index; **arquivo local preservado** (não apagado).
2. `.gitignore` — confirmado `.env*` + `!.env.example`; adicionado `.local/`.
3. `.env.example` — criado com placeholders inequívocos (sem valores reais).
4. `AGENTS.md` externo não confiável — backup em `.local/AGENTS.md.external-backup` (ignorado) + restore para HEAD.
5. Scans de segredo e Unicode — ver resultados abaixo.

## Ações PENDENTES do Operador (não executadas — exigem autoridade)

1. **Rotação imediata** de `DATABASE_URL` e `TYPESAFE_API_KEY` no provedor de origem.
2. **Decisão sobre histórico**: os 4 commits com `.env` continuam expostos. Opções:
   - (a) Aceitar exposição histórica (se os valores forem placeholders/teste);
   - (b) Remoção de histórico (`filter-branch`/BFG) — ação **destrutiva/coordenada**, exige aprovação explícita;
   - (c) Reescrita de histórica com force push — **proibida sem aprovação**.
3. Confirmar que nenhum outro segredo está exposto em arquivos rastreados.

## Critérios para Encerrar o Incidente

- `.env` fora do index e do tree atual ✓ (executado);
- `.env*` no `.gitignore` ✓ (executado);
- Rotação das chaves confirmada pelo Operador;
- Decisão formal sobre histórico documentada;
- Varredura de segredos no histórico recente sem achados adicionais (ou escalada).

## Evidência Segura (sem valores)

- Commits com `.env`: `6bed930`, `84a70d3`, `8d48f64`, `417f6c6`.
- Tamanho: 160 bytes; hash prefixo: `2487E391BEAB75D1…`.
- Chaves: `DATABASE_URL`, `TYPESAFE_API_KEY` (valores NUNCA impressos neste doc).
- Arquivo local preservado: sim (`Test-Path .env` = True).
