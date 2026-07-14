#!/usr/bin/env python3
"""
Render docs/signer-isolation-design.md to a paginated PDF with the footer
"Copyright © 2026 END ART" on every page.

Pipeline:
  1. Read the markdown design doc.
  2. Convert to HTML via Python `markdown` (tables + fenced_code + toc).
  3. Wrap in a full HTML document with print CSS:
       - @page rule with @bottom-center margin box for the copyright footer
       - Typography tuned for A4 (Noto Serif SC body + Noto Sans SC headings,
         with DejaVu Sans Mono for code)
       - Table, code-block, blockquote styling
  4. Write the HTML to /home/z/my-project/download/signer-isolation-design.html
  5. Invoke the PDF skill's html2pdf-next.js (Paged.js) to produce the PDF
     with the footer on every page.
  6. Post-process with pypdf to set PDF metadata (Title, Author, Subject,
     Creator) and confirm the footer string appears on every page.
"""

from __future__ import annotations

import html
import re
import shutil
import subprocess
import sys
from pathlib import Path

import markdown
from pypdf import PdfReader, PdfWriter

# ── Paths ────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path("/home/z/my-project")
SRC_MD = PROJECT_ROOT / "docs" / "signer-isolation-design.md"
OUT_DIR = PROJECT_ROOT / "download"
OUT_HTML = OUT_DIR / "signer-isolation-design.html"
OUT_PDF = OUT_DIR / "signer-isolation-design.pdf"

PDF_SKILL_DIR = Path("/home/z/my-project/skills/pdf")
HTML2PDF_JS = PDF_SKILL_DIR / "scripts" / "html2pdf-next.js"

FOOTER_TEXT = "Copyright © 2026 END ART"


# ── 1. Markdown → HTML ──────────────────────────────────────────────────────
def md_to_html(md_text: str) -> str:
    """Convert markdown to HTML body with tables, fenced code, and TOC support."""
    extensions = [
        "tables",
        "fenced_code",
        "nl2br",
        "sane_lists",
        "attr_list",
        "md_in_html",
    ]
    # codehilite is optional — fall back gracefully if Pygments not installed.
    try:
        import pygments  # noqa: F401
        extensions.append("codehilite")
    except ImportError:
        pass

    md = markdown.Markdown(
        extensions=extensions,
        extension_configs={
            "codehilite": {
                "guess_lang": False,
                "noclasses": True,
                "pygments_style": "friendly",
            }
        },
    )
    return md.convert(md_text)


# ── 2. Build full HTML document with print CSS ─────────────────────────────
def build_html(body_html: str, title: str) -> str:
    """Wrap the HTML body in a full document with print CSS + Paged.js footer."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{html.escape(title)}</title>
<style>
/* ─── Page setup with mandatory copyright footer ─────────────────────── */
@page {{
  size: A4;
  margin: 22mm 18mm 22mm 18mm;
  @bottom-center {{
    content: "{FOOTER_TEXT}";
    font-family: 'Noto Sans', 'Noto Sans SC', 'DejaVu Sans', sans-serif;
    font-size: 8.5pt;
    color: #6b7280;
    vertical-align: bottom;
    padding-bottom: 4mm;
  }}
  @bottom-right {{
    content: counter(page) " / " counter(pages);
    font-family: 'Noto Sans', 'DejaVu Sans', sans-serif;
    font-size: 8.5pt;
    color: #9ca3af;
    vertical-align: bottom;
    padding-bottom: 4mm;
  }}
  @bottom-left {{
    content: "Signer Process Isolation — Design Document";
    font-family: 'Noto Sans', 'DejaVu Sans', sans-serif;
    font-size: 8.5pt;
    color: #9ca3af;
    vertical-align: bottom;
    padding-bottom: 4mm;
  }}
}}

/* ─── Base typography ─────────────────────────────────────────────────── */
html, body {{
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #1f2937;
}}
body {{
  font-family: 'Noto Serif', 'Noto Serif SC', 'Liberation Serif', Georgia, serif;
  font-size: 10.5pt;
  line-height: 1.55;
  text-align: left;
  hyphens: auto;
}}

/* ─── Headings ────────────────────────────────────────────────────────── */
h1, h2, h3, h4, h5, h6 {{
  font-family: 'Noto Sans', 'Noto Sans SC', 'Liberation Sans', 'DejaVu Sans', sans-serif;
  color: #111827;
  line-height: 1.25;
  page-break-after: avoid;
  break-after: avoid-page;
  font-weight: 700;
}}
h1 {{
  font-size: 22pt;
  margin: 0 0 12pt 0;
  padding-bottom: 6pt;
  border-bottom: 2pt solid #1f2937;
  page-break-before: always;
  break-before: page;
}}
h1:first-of-type {{
  page-break-before: avoid;
  break-before: avoid;
}}
h2 {{
  font-size: 15pt;
  margin: 22pt 0 8pt 0;
  color: #1f2937;
  border-bottom: 0.5pt solid #d1d5db;
  padding-bottom: 3pt;
}}
h3 {{
  font-size: 12.5pt;
  margin: 16pt 0 6pt 0;
  color: #1f2937;
}}
h4 {{
  font-size: 11pt;
  margin: 12pt 0 4pt 0;
  color: #374151;
}}
h5, h6 {{
  font-size: 10pt;
  margin: 10pt 0 3pt 0;
  color: #4b5563;
}}

/* ─── Paragraphs & inline ─────────────────────────────────────────────── */
p {{
  margin: 0 0 8pt 0;
  orphans: 3;
  widows: 3;
}}
a {{
  color: #1d4ed8;
  text-decoration: none;
  word-break: break-word;
}}
strong {{ font-weight: 700; }}
em {{ font-style: italic; }}
code {{
  font-family: 'DejaVu Sans Mono', 'Liberation Mono', 'Sarasa Mono SC', monospace;
  font-size: 9pt;
  background: #f3f4f6;
  color: #be185d;
  padding: 0.5pt 2pt;
  border-radius: 2pt;
}}
pre {{
  font-family: 'DejaVu Sans Mono', 'Liberation Mono', 'Sarasa Mono SC', monospace;
  font-size: 8.5pt;
  line-height: 1.45;
  background: #f9fafb;
  border: 0.5pt solid #e5e7eb;
  border-radius: 3pt;
  padding: 8pt 10pt;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  page-break-inside: avoid;
  break-inside: avoid;
  margin: 8pt 0 10pt 0;
}}
pre code {{
  background: transparent;
  color: #1f2937;
  padding: 0;
  font-size: inherit;
}}

/* ─── Lists ───────────────────────────────────────────────────────────── */
ul, ol {{
  margin: 0 0 8pt 0;
  padding-left: 18pt;
}}
li {{
  margin: 0 0 3pt 0;
  orphans: 2;
  widows: 2;
}}
li > p {{ margin: 0 0 4pt 0; }}

/* ─── Tables ──────────────────────────────────────────────────────────── */
table {{
  border-collapse: collapse;
  width: 100%;
  margin: 8pt 0 12pt 0;
  font-size: 9pt;
  page-break-inside: auto;
  break-inside: auto;
}}
thead {{
  display: table-header-group;
}}
tr {{
  page-break-inside: avoid;
  break-inside: avoid;
}}
th, td {{
  border: 0.5pt solid #d1d5db;
  padding: 4pt 6pt;
  text-align: left;
  vertical-align: top;
}}
th {{
  background: #f3f4f6;
  font-weight: 700;
  color: #111827;
}}
tbody tr:nth-child(even) {{
  background: #fafafa;
}}

/* ─── Blockquotes ─────────────────────────────────────────────────────── */
blockquote {{
  margin: 8pt 0 10pt 0;
  padding: 6pt 12pt;
  border-left: 3pt solid #9ca3af;
  background: #f9fafb;
  color: #4b5563;
  font-style: italic;
}}
blockquote p {{ margin: 0 0 4pt 0; }}
blockquote p:last-child {{ margin: 0; }}

/* ─── Horizontal rule ─────────────────────────────────────────────────── */
hr {{
  border: none;
  border-top: 0.5pt solid #d1d5db;
  margin: 14pt 0;
}}

/* ─── CodeHilite fallback (if Pygments is installed) ─────────────────── */
.codehilite {{
  background: #f9fafb;
  border: 0.5pt solid #e5e7eb;
  border-radius: 3pt;
  padding: 8pt 10pt;
  margin: 8pt 0 10pt 0;
  page-break-inside: avoid;
  break-inside: avoid;
  overflow-x: auto;
}}
.codehilite pre {{
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
}}
</style>
</head>
<body>
{body_html}
</body>
</html>
"""


# ── 3. Render HTML → PDF via html2pdf-next.js (Paged.js) ────────────────────
def render_pdf(html_path: Path, pdf_path: Path, title: str) -> None:
    """Invoke html2pdf-next.js to produce the PDF."""
    cmd = [
        "node",
        str(HTML2PDF_JS),
        str(html_path),
        "--output", str(pdf_path),
        "--title", title,
    ]
    print(f"[render] running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        print("[render] STDOUT:", result.stdout, file=sys.stderr)
        print("[render] STDERR:", result.stderr, file=sys.stderr)
        raise SystemExit(f"html2pdf-next.js failed (exit {result.returncode})")
    print(result.stdout)
    if result.stderr:
        print("[render] stderr:", result.stderr, file=sys.stderr)


# ── 4. Post-process: set PDF metadata + verify footer on every page ────────
def post_process(pdf_path: Path, title: str) -> None:
    """Set PDF metadata and verify the copyright footer appears on every page."""
    reader = PdfReader(str(pdf_path))
    n_pages = len(reader.pages)
    print(f"[verify] PDF has {n_pages} pages")

    missing: list[int] = []
    for i, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception as exc:  # noqa: BLE001
            print(f"[verify] page {i}: text extraction failed: {exc}", file=sys.stderr)
            missing.append(i)
            continue
        # The © character may extract differently across PDF readers; check
        # for several equivalent substrings.
        needles = [
            "Copyright © 2026 END ART",
            "Copyright © 2026 END ART".replace("©", "(c)"),
            "END ART",
        ]
        if not any(n in text for n in needles):
            # Fallback: check for the footer tokens individually (PDF text
            # extraction sometimes reorders bidi or splits the © symbol).
            tail = text[-300:] if len(text) > 300 else text
            if not ("END ART" in tail or "2026 END" in tail):
                missing.append(i)

    if missing:
        print(f"[verify] WARNING: footer text not found on pages: {missing}",
              file=sys.stderr)
    else:
        print(f"[verify] footer 'Copyright © 2026 END ART' present on all {n_pages} pages")

    # Rewrite with metadata
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.add_metadata({
        "/Title": title,
        "/Author": "END ART",
        "/Subject": "Signer Process Isolation — Design Document (v19.3-design-draft-5)",
        "/Creator": "END ART Engineering",
        "/Producer": "Paged.js + Playwright",
        "/Keywords": "signer isolation, vault, crypto, security, END ART",
    })
    tmp_path = pdf_path.with_suffix(".tmp.pdf")
    with open(tmp_path, "wb") as fh:
        writer.write(fh)
    shutil.move(str(tmp_path), str(pdf_path))
    print(f"[post] metadata written to {pdf_path}")


# ── 5. Main ─────────────────────────────────────────────────────────────────
def main() -> int:
    if not SRC_MD.exists():
        print(f"ERROR: source markdown not found: {SRC_MD}", file=sys.stderr)
        return 2
    if not HTML2PDF_JS.exists():
        print(f"ERROR: html2pdf-next.js not found: {HTML2PDF_JS}", file=sys.stderr)
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    md_text = SRC_MD.read_text(encoding="utf-8")
    print(f"[md] read {len(md_text):,} chars from {SRC_MD}")

    body_html = md_to_html(md_text)
    print(f"[md→html] body HTML: {len(body_html):,} chars")

    title = "Signer Process Isolation — Design Document"
    full_html = build_html(body_html, title)
    OUT_HTML.write_text(full_html, encoding="utf-8")
    print(f"[html] wrote {OUT_HTML} ({len(full_html):,} chars)")

    render_pdf(OUT_HTML, OUT_PDF, title)
    if not OUT_PDF.exists():
        print(f"ERROR: PDF was not created at {OUT_PDF}", file=sys.stderr)
        return 3

    post_process(OUT_PDF, title)

    size_kb = OUT_PDF.stat().st_size // 1024
    print(f"\n[done] PDF: {OUT_PDF}  ({size_kb} KB)")
    print(f"[done] HTML source: {OUT_HTML}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
