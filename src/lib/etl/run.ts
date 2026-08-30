// src/lib/etl/run.ts — ETL orchestrator (RSSSF + FBref + Wikipedia -> embeddings + KnowledgeGraph)
import { fetchRSSSF } from './rsssf';
import { fetchFBref } from './fbref';
import { fetchWikipedia } from './wikipedia';
import { indexEntity } from '../rag/embeddings';
import { db } from '@/lib/db';

export async function runETL(): Promise<{ rsssf: number; fbref: number; wiki: number; embeddings: number }> {
  const rsssf = await fetchRSSSF();
  for (const club of rsssf.clubs) {
    await indexEntity('Club', club.name, `Club ${club.name} from ${club.country} founded ${club.founded} titles ${club.titles}`);
    await db.knowledgeGraph.upsert({
      where: { id: `club:${club.name}` } as never,
      create: { id: `club:${club.name}`, subject: club.name, predicate: 'country', object: club.country, weight: 1 },
      update: { object: club.country },
    }).catch(async () => {
      const existing = await db.knowledgeGraph.findFirst({ where: { subject: club.name, predicate: 'country' } });
      if (!existing) await db.knowledgeGraph.create({ data: { subject: club.name, predicate: 'country', object: club.country } });
    });
  }

  const fbref = await fetchFBref();
  for (const player of fbref.players) {
    await indexEntity('Player', player.name, `Player ${player.name} club ${player.club} position ${player.position} goals ${player.goals}`);
    await db.knowledgeGraph.create({ data: { subject: player.name, predicate: 'plays_for', object: player.club, weight: 1 } }).catch(() => {});
  }

  const wiki = await fetchWikipedia('Copa do Brasil');
  await indexEntity('Competition', wiki.title, wiki.summary);

  const embeddings = await db.embedding.count();
  return { rsssf: rsssf.clubs.length, fbref: fbref.players.length, wiki: 1, embeddings };
}
