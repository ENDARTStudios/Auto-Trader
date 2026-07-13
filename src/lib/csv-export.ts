"use client";

// CSV export utility for dashboard tables.
// Triggers a browser download with the given filename.

export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    // Still create an empty file with headers if provided separately
    const blob = new Blob([""], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, filename);
    return;
  }

  // Collect all unique keys across rows to handle sparse objects
  const keySet = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) keySet.add(k);
  }
  const headers = Array.from(keySet);

  const escapeCell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    // Escape quotes and wrap in quotes if contains comma/quote/newline
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csvLines = [
    headers.map(escapeCell).join(","),
    ...rows.map((r) => headers.map((h) => escapeCell(r[h])).join(",")),
  ];
  const csv = csvLines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
