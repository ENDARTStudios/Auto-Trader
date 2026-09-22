export interface PaletteEntry {
  id: string;
  label: string;
  detail?: string;
  keywords?: string[];
}

function matches(entry: PaletteEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [entry.label, entry.detail ?? "", ...(entry.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function filterCommands(entries: PaletteEntry[], query: string): PaletteEntry[] {
  return entries.filter((e) => matches(e, query));
}

export function filterActions(entries: PaletteEntry[], query: string): PaletteEntry[] {
  return entries.filter((e) => matches(e, query));
}

export function filterSymbols(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (!matches(e, query)) return false;
    const key = `${e.label}::${e.detail ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isShortcutEvent(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
}
