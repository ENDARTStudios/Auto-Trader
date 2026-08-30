// src/lib/etl/rsssf.ts — RSSSF connector (mock, 20 clubs Brazil)
export interface Club {
  name: string;
  country: string;
  founded: number;
  titles: number;
}

const MOCK_CLUBS: Club[] = [
  { name: "Flamengo", country: "Brazil", founded: 1895, titles: 8 },
  { name: "Palmeiras", country: "Brazil", founded: 1914, titles: 12 },
  { name: "Corinthians", country: "Brazil", founded: 1910, titles: 7 },
  { name: "São Paulo", country: "Brazil", founded: 1930, titles: 6 },
  { name: "Santos", country: "Brazil", founded: 1912, titles: 8 },
  { name: "Grêmio", country: "Brazil", founded: 1903, titles: 2 },
  { name: "Internacional", country: "Brazil", founded: 1909, titles: 3 },
  { name: "Cruzeiro", country: "Brazil", founded: 1921, titles: 4 },
  { name: "Vasco", country: "Brazil", founded: 1898, titles: 4 },
  { name: "Botafogo", country: "Brazil", founded: 1904, titles: 2 },
  { name: "Fluminense", country: "Brazil", founded: 1902, titles: 4 },
  { name: "Atlético Mineiro", country: "Brazil", founded: 1908, titles: 3 },
  { name: "Athletico Paranaense", country: "Brazil", founded: 1924, titles: 1 },
  { name: "Bahia", country: "Brazil", founded: 1931, titles: 2 },
  { name: "Fortaleza", country: "Brazil", founded: 1918, titles: 0 },
  { name: "Ceará", country: "Brazil", founded: 1914, titles: 0 },
  { name: "Sport", country: "Brazil", founded: 1905, titles: 1 },
  { name: "Santa Cruz", country: "Brazil", founded: 1914, titles: 0 },
  { name: "Náutico", country: "Brazil", founded: 1901, titles: 0 },
  { name: "Coritiba", country: "Brazil", founded: 1909, titles: 1 },
];

export async function fetchRSSSF(): Promise<{ clubs: Club[]; source: string }> {
  // Real would be: const res = await fetch("https://www.rsssf.org/tables/brazil2024.html"); const html = await res.text(); parse with cheerio
  // Mock for S13 dev without cheerio
  return { clubs: MOCK_CLUBS, source: "RSSSF mock" };
}
