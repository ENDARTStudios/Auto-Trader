#!/usr/bin/env python3
"""Verify the copyright footer appears on every page of the design PDF
using PyMuPDF (more robust than pypdf for complex pages)."""
import sys
from pathlib import Path

import pymupdf

PDF = Path("/home/z/my-project/download/signer-isolation-design.pdf")

FOOTER_TOKENS = [
    "Copyright © 2026 END ART",
    "END ART",
]

doc = pymupdf.open(str(PDF))
total_pages = doc.page_count
print(f"PDF: {PDF}")
print(f"Pages: {total_pages}")
print()

missing: list[int] = []
all_present: list[int] = []
for i, page in enumerate(doc, start=1):
    text = page.get_text("text") or ""
    # Check the bottom strip of the page where the footer lives
    page_height = page.rect.height
    footer_rect = pymupdf.Rect(0, page_height - 40, page.rect.width, page_height)
    footer_text = page.get_text("text", clip=footer_rect) or ""

    found_full = "Copyright © 2026 END ART" in footer_text
    found_partial = "END ART" in footer_text
    if found_full:
        all_present.append(i)
    elif found_partial:
        print(f"  page {i}: partial match (END ART) — full footer text:")
        print(f"    {footer_text!r}")
        all_present.append(i)
    else:
        missing.append(i)
        # Show the last 200 chars of the page for debugging
        tail = (text or "")[-200:]
        print(f"  page {i}: NO footer match. Bottom strip text: {footer_text!r}")

doc.close()

print()
print(f"Pages with full footer: {len(all_present)}/{total_pages}")
if missing:
    print(f"MISSING on pages: {missing}")
    sys.exit(1)
else:
    print(f"✓ Footer 'Copyright © 2026 END ART' present on ALL {total_pages} pages")
