// src/lib/rag/ollama.ts — Ollama nomic-embed-text with fallback to hash mock
import { generateEmbedding } from './embeddings';

export async function generateEmbeddingOllama(text: string): Promise<number[]> {
  const url = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  const model = process.env.OLLAMA_MODEL ?? 'nomic-embed-text';
  try {
    const res = await fetch(`${url}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}`);
    const data = (await res.json()) as { embeddings: number[][] };
    const emb = data.embeddings?.[0];
    if (emb && emb.length > 0) {
      // Ollama nomic-embed-text is 768 dims, pad or truncate to 1536 for compatibility with mock
      if (emb.length === 1536) return emb;
      if (emb.length === 768) {
        // Duplicate to 1536 for mock compatibility
        return [...emb, ...emb];
      }
      return emb;
    }
    throw new Error('No embeddings');
  } catch {
    // Fallback to hash mock (dev without ollama)
    return generateEmbedding(text);
  }
}
