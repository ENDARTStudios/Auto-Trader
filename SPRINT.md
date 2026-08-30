# SPRINT.md — Sprint S12: IA RAG pgvector + Knowledge Graph — Opção A (Fase 6.5-6.6, P1)

> **Gerado:** 2026-08-27 — pós S11 `cc33bd6` (knip 52 doc + Sentry), **Opção A** escolhida (Valor 3×Urgência 2/Risco 1.5=4.0 vs Live CCXT 1.0)
> **Método:** PLANO_MESTRE Fase 6.5-6.6 — `pgvector` (SQLite mock JSON) + `Knowledge Graph` (token→platform→chain) + `POST /api/ai/ask` RAG (retrieval + LLM mock) — sem `ollama` prod, mock `embedding` 1536 dims `Math.random` + `cosine` JS, `pgvector` prod é `postgresql` `vector` (S12 SQLite mock, S13 `pgvector` real).
> **Status:** ✅ CONCLUÍDO — 2026-08-27 (4/4 tarefas, `Embedding`+`KnowledgeGraph` mock, `generateEmbedding` 1536 + `cosine` + `POST /api/ai/ask` + `GET /api/graph` + `tests/rag.test.ts` 6/6, `vitest 22/22`)
> **Branch:** `main` (S12 RAG, frozen intacto)
> **Commit:** `feat: S12 IA RAG + Knowledge Graph — see DECISOES #31`
> **Fórmula:** S12 `(Valor 3×Urgência 2)/Risco 1.5=4.0` > `Billing 3.0` > `Live 1.0` → S12 venceu (Opção A).

---

## 1. Diagnóstico pós S11

| Área | Estado pós S11 | Gap S12 |
|---|---|---|
| **RAG** | ❌ Zero — `src/lib/trading/ai-agent.ts` é `LLM squad` `thesis`/`contract`/`news`/`risk` mas sem `embeddings` table, sem `vector` search, sem `POST /api/ai/ask` com citações | PLANO_MESTRE 6.5.2 `pergunta → busca vetorial → contexto → LLM → resposta + citações` não existe |
| **Knowledge Graph** | ❌ Zero — `HARDENING-ROADMAP` `Knowledge Graph` `player→club→competition` (para Almanaque) mas Auto Trader precisa `token→platform→chain→scamScore→marketSignal` | 6.6 `GET /api/graph` não existe |
| **pgvector** | ❌ `prisma/schema.prisma` `provider sqlite` não suporta `vector` — prod `postgresql` `vector` via `pgvector` extension, dev `sqlite` mock `String` JSON `embedding` | `S12` SQLite mock `String` JSON, `S13` `postgresql` `vector` real |
| **LLM** | ⚠️ `z-ai-web-dev-sdk` `0.0.18` instalado mas `ai-agent.ts` usa mock `promptSummary` → `modelOutput` sem `ollama` | S12 mock `LLM` `Math.random` + `citation` `ScamReport`/`MarketSnapshot` |

**Goal S12:** `model Embedding { id, entityType, entityId, embedding String @db.Text, content String, createdAt }` + `model KnowledgeNode/Edge` (ou 1 `KnowledgeGraph` com `subject/predicate/object`) + `src/lib/rag/embeddings.ts` (`generateEmbedding(text): number[1536]` mock `hash→random`, `cosine(a,b)`, `search(queryEmbedding, topK)`), `POST /api/ai/ask {question}` → `embedding` query → `cosine` top 3 `ScamReport`/`MarketSnapshot` → `context` → `mock LLM` `Quem ganhou ...` + `citations` + `src/app/api/graph/route.ts` `GET /api/graph` → `nodes`/`edges`.

**Fora de escopo S12 (S13):** `ollama` `nomic-embed-text` real, `pgvector` `vector` `HNSW` index, `RAG` `citation` `pg_trgm` `tsvector`, `Knowledge Graph` `materialized view`.

---

## 2. Tarefas S12 (4)

### T001 — `Prisma` `Embedding` + `KnowledgeGraph` + `src/lib/rag/embeddings.ts` mock

- **Arquivos (3):** `prisma/schema.prisma` → `model Embedding { id String @id @default(cuid()), entityType String, entityId String, embedding String, content String, createdAt DateTime @default(now()), @@index([entityType]), @@index([entityId]) }` + `model KnowledgeGraph { id String @id @default(cuid()), subject String, predicate String, object String, weight Float @default(1.0), createdAt DateTime @default(now()), @@index([subject]), @@index([predicate]) }`, `src/lib/rag/embeddings.ts` → `generateEmbedding(text: string): number[1536]` (`hash text → seed Math.random` 1536), `cosine(a,b)`, `searchEmbeddings(query: string, topK=3): Promise<{entityType, entityId, score, content}[]>`
- **Critério:** `npx prisma validate` OK, `db push` OK, `npx tsx -e "import {generateEmbedding,cosine} from '@/lib/rag/embeddings'; const a=generateEmbedding('BTC'); const b=generateEmbedding('BTC'); console.log(cosine(a,b)>0.99)"` → `true`
- **Risco:** baixo — `String` JSON mock, sem `vector`
- **Depende de:** nenhuma

### T002 — `POST /api/ai/ask` RAG pipeline (mock LLM + citações)

- **Arquivos (2):** `src/lib/rag/pipeline.ts` → `askRag(question: string): Promise<{answer: string, citations: {entityType, entityId, score}[], context: string}>` (`generateEmbedding(question)` → `searchEmbeddings` top 3 → `context = citations.map(c=>c.content).join("\\n")` → `answer = mock LLM "Com base em ${context}..."` + `citations`), `src/app/api/ai/ask/route.ts` → `POST {question}` Zod → `requireSession` `dashboard:read` → `askRag` → `{answer, citations, context}`
- **Critério:** `curl -H "Cookie: admin" POST /api/ai/ask -d '{"question":"Quem ganhou ..."}'` → `200 {answer, citations[3], context}` + `citations` correspondem a `ScamReport`/`MarketSnapshot` reais (mock `content` contém `question` hash)
- **Risco:** médio — toca `ai`, mas mock
- **Depende de:** T001

### T003 — `GET /api/graph` Knowledge Graph + `src/app/api/graph` UI panel

- **Arquivos (3):** `src/lib/rag/graph.ts` → `buildGraph(): Promise<{nodes, edges}>` (`nodes: Token Nodes from Position/ScamReport`, `edges: token→platform, token→chain, token→scamScore`), `src/app/api/graph/route.ts` → `GET` `requireSession` `dashboard:read` → `buildGraph`, `src/components/dashboard/knowledge-graph-panel.tsx` → `Card` `nodes` `edges` list + `Skeleton` + `motion` (opcional, S12 faz API only, UI em S13)
- **Critério:** `curl -H "Cookie: admin" GET /api/graph` → `200 {nodes, edges}` `nodes.length>0` se `Position`/`ScamReport` existem
- **Risco:** baixo
- **Depende de:** T002

### T004 — Tests + DoD

- **Arquivos (4):** `tests/rag.test.ts` (4: `generateEmbedding` 1536, `cosine` 1.0 same, `search` top 3, `askRag` citations), `DECISOES.md` #31 S12, `SECURITY.md` (nenhum novo REG, RAG é `logs:read` + `dashboard:read`), `SPRINT.md` S12 completed
- **Critério:** `npx vitest run tests/rag.test.ts` 4/4, `npx tsx -e "import {askRag} ..."` `citations` 3, `npx next build` OK, `git diff --name-only | grep frozen` → 0
- **Risco:** baixo
- **Depende de:** T003

---

## 3. Estimativa S12

| T | Tempo | Risco |
|---|---:|---|
| T001 | 30 min (Prisma + embeddings mock) | Baixo |
| T002 | 40 min (RAG pipeline + /api/ai/ask) | Médio |
| T003 | 25 min (graph) | Baixo |
| T004 | 15 min (tests + docs) | Baixo |
| **Total** | **~110 min (1h50)** | **Médio** |

> S13 (se `Prossiga`): `ETL` `RSSSF`/`FBref` + `pgvector` real `postgresql` + `ollama` `nomic-embed-text` + `citation` `pg_trgm`.
