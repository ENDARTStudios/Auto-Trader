// src/lib/etl/fbref.ts — FBref connector (mock, 20 players)
export interface Player {
  name: string;
  club: string;
  position: string;
  goals: number;
}

const MOCK_PLAYERS: Player[] = [
  { name: "Pelé", club: "Santos", position: "FW", goals: 1281 },
  { name: "Zico", club: "Flamengo", position: "MF", goals: 508 },
  { name: "Romário", club: "Vasco", position: "FW", goals: 743 },
  { name: "Ronaldo", club: "Corinthians", position: "FW", goals: 352 },
  { name: "Neymar", club: "Santos", position: "FW", goals: 436 },
  { name: "Garrincha", club: "Botafogo", position: "FW", goals: 232 },
  { name: "Rivelino", club: "Corinthians", position: "MF", goals: 300 },
  { name: "Sócrates", club: "Corinthians", position: "MF", goals: 172 },
  { name: "Falcão", club: "Internacional", position: "MF", goals: 400 },
  { name: "Reinaldo", club: "Atlético Mineiro", position: "FW", goals: 310 },
  { name: "Dirceu Lopes", club: "Cruzeiro", position: "MF", goals: 400 },
  { name: "Ademir", club: "Vasco", position: "FW", goals: 300 },
  { name: "Bebeto", club: "Flamengo", position: "FW", goals: 300 },
  { name: "Careca", club: "São Paulo", position: "FW", goals: 300 },
  { name: "Edmundo", club: "Vasco", position: "FW", goals: 250 },
  { name: "Evair", club: "Palmeiras", position: "FW", goals: 200 },
  { name: "Marcelinho", club: "Corinthians", position: "MF", goals: 200 },
  { name: "Rogério Ceni", club: "São Paulo", position: "GK", goals: 132 },
  { name: "Dida", club: "Cruzeiro", position: "GK", goals: 0 },
  { name: "Taffarel", club: "Internacional", position: "GK", goals: 0 },
];

export async function fetchFBref(): Promise<{ players: Player[]; source: string }> {
  // Real: fetch https://fbref.com/en/comps/24, parse with cheerio
  return { players: MOCK_PLAYERS, source: "FBref mock" };
}
