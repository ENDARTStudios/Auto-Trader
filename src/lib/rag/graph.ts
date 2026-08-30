// src/lib/rag/graph.ts — Knowledge Graph builder (token → platform → chain)
import { db } from '@/lib/db';

export async function buildGraph(): Promise<{ nodes: Array<{ id: string; label: string; type: string }>; edges: Array<{ from: string; to: string; label: string; weight: number }> }> {
  const positions = await db.position.findMany({ take: 20, select: { symbol: true, chain: true, source: true, scamScore: true } });
  const scams = await db.scamReport.findMany({ take: 10, select: { symbol: true, chain: true, score: true, passed: true } });
  const market = await db.marketSnapshot.findMany({ take: 10, select: { symbol: true, chain: true, signalLabel: true } });

  const nodes = new Map<string, { id: string; label: string; type: string }>();
  const edges: Array<{ from: string; to: string; label: string; weight: number }> = [];

  const addNode = (id: string, label: string, type: string) => {
    if (!nodes.has(id)) nodes.set(id, { id, label, type });
  };

  for (const p of positions) {
    addNode(p.symbol, p.symbol, 'token');
    if (p.chain) {
      addNode(p.chain, p.chain, 'chain');
      edges.push({ from: p.symbol, to: p.chain, label: 'on_chain', weight: 1 });
    }
    addNode(p.source, p.source, 'platform');
    edges.push({ from: p.symbol, to: p.source, label: 'listed_on', weight: 1 });
    const scoreId = `score:${p.scamScore}`;
    addNode(scoreId, `score ${p.scamScore}`, 'scam');
    edges.push({ from: p.symbol, to: scoreId, label: 'scam_score', weight: p.scamScore / 100 });
  }

  for (const s of scams) {
    addNode(s.symbol, s.symbol, 'token');
    if (s.chain) {
      addNode(s.chain, s.chain, 'chain');
      edges.push({ from: s.symbol, to: s.chain, label: 'chain', weight: 0.5 });
    }
    addNode(`scam:${s.score}`, `scam ${s.score}`, 'scam');
    edges.push({ from: s.symbol, to: `scam:${s.score}`, label: s.passed ? 'passed' : 'failed', weight: s.score / 100 });
  }

  for (const m of market) {
    addNode(m.symbol, m.symbol, 'token');
    addNode(m.signalLabel, m.signalLabel, 'signal');
    edges.push({ from: m.symbol, to: m.signalLabel, label: 'signal', weight: 0.7 });
  }

  // Also include FeatureFlag nodes
  const flags = await db.featureFlag.findMany({ take: 5 });
  for (const f of flags) {
    addNode(f.key, f.key, 'flag');
    edges.push({ from: f.key, to: String(f.enabled), label: 'enabled', weight: f.enabled ? 1 : 0.2 });
  }

  return { nodes: Array.from(nodes.values()), edges };
}
