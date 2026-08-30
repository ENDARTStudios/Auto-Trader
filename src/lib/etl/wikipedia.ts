// src/lib/etl/wikipedia.ts — Wikipedia connector (mock)
export async function fetchWikipedia(title: string): Promise<{ title: string; summary: string; source: string }> {
  // Real: const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`); const data = await res.json();
  // Mock for S13 dev without external fetch (works offline)
  const summaries: Record<string, string> = {
    Flamengo: "Clube de Regatas do Flamengo is a Brazilian professional football club based in Rio de Janeiro, founded in 1895.",
    Palmeiras: "Sociedade Esportiva Palmeiras is a Brazilian professional football club based in São Paulo, founded in 1914.",
    "Copa do Brasil": "Copa do Brasil is a knockout football competition played by 92 teams, the Brazilian national cup.",
  };
  return { title, summary: summaries[title] ?? `Wikipedia summary for ${title} (mock)`, source: "Wikipedia mock" };
}
