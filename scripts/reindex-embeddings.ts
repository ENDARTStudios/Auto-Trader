// scripts/reindex-embeddings.ts — reindexa o índice RAG com embeddings REAIS
//
// Uso:
//   npx tsx scripts/reindex-embeddings.ts --yes
//
// O que faz:
//   1. exige --yes (operação destrutiva: apaga TODOS os Embedding);
//   2. aborta se nenhum provider de IA estiver configurado (embedding real);
//   3. apaga Embedding e roda ensureRagSeed() para reindexar do zero;
//   4. imprime contagem antes/depois.
//
// Requer AI_PROVIDER + credencial (AI_API_KEY/OPENAI_API_KEY) OU AI_PROVIDER=ollama.
// Em produção, NUNCA use o fallback hash (RAG_ALLOW_HASH_FALLBACK deve ficar 0).
import 'dotenv/config';
import { getAIStatus } from '../src/lib/ai/provider';
import { db } from '../src/lib/db';
import { ensureRagSeed } from '../src/lib/rag/pipeline';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.includes('--yes')) {
    console.error('[reindex-embeddings] ABORTADO: operação apaga todos os embeddings.');
    console.error('[reindex-embeddings] rode com --yes para confirmar:');
    console.error('  npx tsx scripts/reindex-embeddings.ts --yes');
    process.exitCode = 1;
    return;
  }

  const status = getAIStatus();
  if (!status.configured) {
    console.error(
      '[reindex-embeddings] ABORTADO: nenhum provider de IA configurado ' +
        '(AI_PROVIDER/AI_API_KEY/OPENAI_API_KEY/OLLAMA_URL). Reindexar sem provider ' +
        'gravaria embeddings hash degradados — proibido em produção.'
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[reindex-embeddings] provider=${status.provider} chatModel=${status.model} embeddingModel=${status.embeddingModel}`
  );

  const before = await db.embedding.count();
  console.log(`[reindex-embeddings] embeddings atuais: ${before}`);

  const deleted = await db.embedding.deleteMany({});
  console.log(`[reindex-embeddings] apagados: ${deleted.count}`);

  await ensureRagSeed();

  const after = await db.embedding.count();
  console.log(`[reindex-embeddings] reindexados: ${after}`);
  if (after === 0) {
    console.error('[reindex-embeddings] AVISO: nenhum embedding criado (sem ScamReport/MarketSnapshot? seed base vazio?)');
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('[reindex-embeddings] FALHOU:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
