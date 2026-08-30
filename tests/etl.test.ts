import { describe, it, expect } from 'vitest';
import { fetchRSSSF } from '@/lib/etl/rsssf';
import { fetchFBref } from '@/lib/etl/fbref';
import { fetchWikipedia } from '@/lib/etl/wikipedia';
import { runETL } from '@/lib/etl/run';

describe('ETL', () => {
  it('fetchRSSSF 20 clubs', async () => {
    const res = await fetchRSSSF();
    expect(res.clubs.length).toBe(20);
    expect(res.clubs[0].name).toBe('Flamengo');
  });

  it('fetchFBref 20 players', async () => {
    const res = await fetchFBref();
    expect(res.players.length).toBe(20);
    expect(res.players[0].name).toBe('Pelé');
  });

  it('fetchWikipedia', async () => {
    const res = await fetchWikipedia('Flamengo');
    expect(res.title).toBe('Flamengo');
    expect(res.summary.length).toBeGreaterThan(10);
  });

  it('runETL embeddings', async () => {
    const res = await runETL();
    expect(res.rsssf).toBe(20);
    expect(res.fbref).toBe(20);
    expect(res.embeddings).toBeGreaterThan(0);
  });
});
