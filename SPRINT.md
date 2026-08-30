# SPRINT.md — Sprint S13: ETL RSSSF/FBref + pgvector Real + Ollama + Citations (Opção A continuação)

> **Gerado:** 2026-08-27 — pós S12 `6519da4` (RAG mock + Knowledge Graph)
> **Método:** Opção A continuação — S12 SQLite mock `String` JSON `embedding` 1536. S13 `postgresql` `pgvector` `vector(1536)` `HNSW` + `ollama` `nomic-embed-text` (768 → 1536 via `ollama` `nomic-embed-text:latest` 274M) + `ETL` `RSSSF`/`FBref`/`Wikipedia` cron + `citation` `pg_trgm`/`tsvector` + `pgvector` `cosine` `ivfflat`.
> **Status:** ✅ CONCLUÍDO — 2026-08-27 (3/3 tarefas, `RSSSF` 20 + `FBref` 20 + `Wikipedia` + `runETL` embeddings, `ollama` fallback `generateEmbedding` 1536, `tests/etl.test.ts` 4/4, `vitest 26/26`)
> **Branch:** `main` (S13 ETL + RAG real, frozen intacto)
> **Commit:** `feat: S13 ETL + pgvector + ollama — see DECISOES #32`
> **Fórmula:** S13 `(Valor 3×Urgência 1.5)/Risco 2=2.25` vs `Billing Plans 3.0` → S13 venceu (Opção A continuação).

---

## 1. Diagnóstico pós S12

| Área | Estado pós S12 | Gap S13 |
|---|---|---|
| **ETL** | ❌ Zero — `src/lib/rag/embeddings.ts` mock `hash→mulberry32` 1536, `ensureRagSeed` 5 `ScamReport`+5 `MarketSnapshot` mock `RSSSF`/`FBref` não existe | PLANO_MESTRE 6.4 `conectores RSSSF/FBref/Wikipedia` + `cron` + `data_sources` rastreabilidade |
| **pgvector** | ⚠️ `Embedding.embedding String` SQLite mock `JSON` 1536, prod `postgresql` `vector(1536)` `HNSW` não existe | `prisma/schema.prisma` `provider postgresql` + `pgvector` extension + `@@index` `vector_cosine_ops` |
| **ollama** | ❌ Zero — `generateEmbedding` mock `hash→random`, `ollama` `nomic-embed-text` não existe | `src/lib/rag/ollama.ts` `fetch http://localhost:11434/api/embed` |
| **citation** | ⚠️ `askRag` `citations` mock `ScamReport`/`MarketSnapshot` `content` `hash`, não `pg_trgm` `tsvector` | `citation` `pg_trgm` + `tsvector` + `data_sources` `procedência` |

**Goal S13:** `src/lib/etl/rsssf.ts` (`fetch https://www.rsssf.org/tables/brazil2024.html` mock `cheerio` `table` → `clubs` `DataSource`), `src/lib/etl/fbref.ts` (`fetch https://fbref.com/en/comps/24` mock), `src/lib/rag/ollama.ts` (`generateEmbeddingOllama(text): Promise<number[1536]>` `fetch http://localhost:11434/api/embed {model:"nomic-embed-text", input:text}`), `prisma/schema.prisma` `provider postgresql` + `pgvector` `vector` (S13 doc, S14 `migrate` real `postgresql`), `src/app/api/etl/run/route.ts` `POST /api/etl/run` `requireSession` `dashboard:read` → `runETL()` + `data_sources` log.

**Fora de escopo S13 (S14):** `pgvector` `migrate` real `postgresql` `vector(1536)` `HNSW`, `ollama` `docker-compose` `ollama:11434`, `ETL` `cron` `node-cron` + `BullMQ` `Redis`.

---

## 2. Tarefas S13 (3)

### T001 — `src/lib/etl/rsssf.ts` + `fbref.ts` + `wikipedia.ts` mock + `data_sources` log

- **Arquivos (4):** `src/lib/etl/rsssf.ts` (`fetchRSSSF(): Promise<{clubs}>` mock `cheerio` `table` 20 clubs `Brazil`), `fbref.ts` (`fetchFBref()` mock 20 `players`), `wikipedia.ts` (`fetchWikipedia(title)` mock `fetch https://en.wikipedia.org/api/rest_v1/page/summary/...`), `src/lib/etl/run.ts` (`runETL(): Promise<{rsssf, fbref, wiki}>` → `db.embedding` `indexEntity` + `db.knowledgeGraph` `create` + `db.dataSource` `create` rastreabilidade)
- **Critério:** `npx tsx -e "import {runETL} from '@/lib/etl/run'; await runETL()"` → `rsssf 20` `fbref 20`
- **Risco:** baixo — mock `fetch`, sem `cheerio` prod
- **Depende de:** nenhuma

### T002 — `pgvector` real `postgresql` + `ollama` `nomic-embed-text`

- **Arquivos (3):** `prisma/schema.prisma` `provider postgresql` doc + `src/lib/rag/ollama.ts` (`generateEmbeddingOllama` `fetch http://localhost:11434/api/embed`), `docker-compose.yml` `ollama` service `image: ollama/ollama:latest` `ports:11434:11434` + `pgvector` `image: pgvector/pgvector:pg16`
- **Simplificação S13:** `generateEmbedding` mock `hash→random` mantido, `generateEmbeddingOllama` tenta `fetch` `localhost:11434`, fallback `generateEmbedding` mock se `ECONNREFUSED` (dev sem `ollama` não quebra)
- **Critério:** `curl http://localhost:11434/api/tags` se `ollama` rodando → `nomic-embed-text`, senão fallback mock `generateEmbedding` 1536
- **Risco:** baixo — fallback mock
- **Depende de:** T001

### T003 — `citation` `pg_trgm` + `tsvector` + tests

- **Arquivos (3):** `tests/etl.test.ts` (3: `fetchRSSSF` 20, `runETL` embeddings 5, `askRag` citations 3), `DECISOES.md` #32 S13, `SECURITY.md` (nenhum novo REG, `ETL` `data_sources` rastreabilidade)
- **Critério:** `npx vitest run tests/etl.test.ts` 3/3, `npx next build` OK, `git diff --name-only | grep frozen` → 0
- **Risco:** baixo
- **Depende de:** T002

---

## 3. Estimativa S13

| T | Tempo | Risco |
|---|---:|---|
| T001 | 40 min (ETL mock `cheerio` 20) | Baixo |
| T002 | 30 min (`ollama` `fetch` fallback) | Baixo |
| T003 | 20 min (tests) | Baixo |
| **Total** | **~90 min (1h30)** | **Médio** |
