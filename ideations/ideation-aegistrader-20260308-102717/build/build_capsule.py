#!/usr/bin/env python3
"""
Build script for AegisTrader ideation session PDFs.
Produces:
  1. RESULTS_aegistrader.pdf  - Print-friendly version of index.html
  2. CAPSULE_aegistrader.pdf  - Comprehensive session archive
"""

import os
import re
import sys
from pathlib import Path

SESSION_DIR = Path(__file__).resolve().parent.parent
SESSION_DATA = SESSION_DIR / "session"
OUTPUT_DIR = SESSION_DIR


# ---------------------------------------------------------------------------
# Utility: read a markdown file and return its contents
# ---------------------------------------------------------------------------
def read_md(path: Path) -> str:
    if path.exists():
        return path.read_text(encoding="utf-8")
    return f"*File not found: {path.name}*"


# ---------------------------------------------------------------------------
# Utility: very basic markdown -> HTML conversion (no external deps)
# ---------------------------------------------------------------------------
def md_to_html(md_text: str) -> str:
    """Minimal markdown to HTML. Handles headers, bold, italic, lists,
    tables, code blocks, horizontal rules, and paragraphs."""
    lines = md_text.split("\n")
    html_lines = []
    in_code_block = False
    in_table = False
    in_ul = False
    in_ol = False
    paragraph_buf = []

    def flush_paragraph():
        if paragraph_buf:
            text = " ".join(paragraph_buf)
            html_lines.append(f"<p>{inline(text)}</p>")
            paragraph_buf.clear()

    def flush_list():
        nonlocal in_ul, in_ol
        if in_ul:
            html_lines.append("</ul>")
            in_ul = False
        if in_ol:
            html_lines.append("</ol>")
            in_ol = False

    def flush_table():
        nonlocal in_table
        if in_table:
            html_lines.append("</tbody></table>")
            in_table = False

    def inline(text):
        # code spans
        text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
        # bold+italic
        text = re.sub(r'\*\*\*(.+?)\*\*\*', r'<strong><em>\1</em></strong>', text)
        # bold
        text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
        # italic
        text = re.sub(r'\*(.+?)\*', r'<em>\1</em>', text)
        # links
        text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
        # -- to em dash
        text = text.replace(" -- ", " &mdash; ")
        return text

    for line in lines:
        # Code blocks
        if line.strip().startswith("```"):
            if in_code_block:
                html_lines.append("</code></pre>")
                in_code_block = False
            else:
                flush_paragraph()
                flush_list()
                flush_table()
                lang = line.strip()[3:]
                html_lines.append(f'<pre><code class="lang-{lang}">')
                in_code_block = True
            continue
        if in_code_block:
            html_lines.append(line.replace("<", "&lt;").replace(">", "&gt;"))
            continue

        stripped = line.strip()

        # Horizontal rule
        if stripped in ("---", "***", "___"):
            flush_paragraph()
            flush_list()
            flush_table()
            html_lines.append("<hr>")
            continue

        # Table row
        if "|" in stripped and stripped.startswith("|"):
            flush_paragraph()
            flush_list()
            cells = [c.strip() for c in stripped.split("|")[1:-1]]
            # separator row
            if all(re.match(r'^[-:]+$', c) for c in cells):
                continue
            if not in_table:
                in_table = True
                html_lines.append('<table><thead><tr>')
                for c in cells:
                    html_lines.append(f'<th>{inline(c)}</th>')
                html_lines.append('</tr></thead><tbody>')
                continue
            html_lines.append('<tr>')
            for c in cells:
                html_lines.append(f'<td>{inline(c)}</td>')
            html_lines.append('</tr>')
            continue
        else:
            flush_table()

        # Headers
        m = re.match(r'^(#{1,6})\s+(.*)', stripped)
        if m:
            flush_paragraph()
            flush_list()
            level = len(m.group(1))
            html_lines.append(f'<h{level}>{inline(m.group(2))}</h{level}>')
            continue

        # Unordered list
        m = re.match(r'^[-*+]\s+(.*)', stripped)
        if m:
            flush_paragraph()
            flush_table()
            if not in_ul:
                flush_list()
                html_lines.append("<ul>")
                in_ul = True
            html_lines.append(f'<li>{inline(m.group(1))}</li>')
            continue

        # Ordered list
        m = re.match(r'^\d+\.\s+(.*)', stripped)
        if m:
            flush_paragraph()
            flush_table()
            if not in_ol:
                flush_list()
                html_lines.append("<ol>")
                in_ol = True
            html_lines.append(f'<li>{inline(m.group(1))}</li>')
            continue

        # End of list
        if (in_ul or in_ol) and stripped == "":
            flush_list()
            continue

        # Blank line ends paragraph
        if stripped == "":
            flush_paragraph()
            continue

        # Accumulate paragraph text
        paragraph_buf.append(stripped)

    flush_paragraph()
    flush_list()
    flush_table()
    return "\n".join(html_lines)


# ---------------------------------------------------------------------------
# PDF 1: Results PDF from index.html
# ---------------------------------------------------------------------------
def build_results_pdf():
    print("Building RESULTS_aegistrader.pdf ...")
    index_path = SESSION_DIR / "index.html"
    html_content = index_path.read_text(encoding="utf-8")

    # Strip <script> blocks
    html_content = re.sub(r'<script[\s\S]*?</script>', '', html_content, flags=re.IGNORECASE)

    # Inject print-friendly CSS before </head>
    print_css = """
<style>
/* --- PRINT-FRIENDLY OVERRIDES --- */
@page {
    size: Letter;
    margin: 1.5cm 2cm;
}

/* Remove fixed nav */
nav, .nav-inner { display: none !important; }

/* Remove any fixed/sticky positioning */
* {
    position: static !important;
}

/* Force visibility */
.reveal, [class*="reveal"], .hidden, [hidden],
details, details > *, .expandable, .collapsible,
[class*="hidden"], [class*="collapsed"] {
    opacity: 1 !important;
    transform: none !important;
    visibility: visible !important;
    display: block !important;
    max-height: none !important;
    overflow: visible !important;
}

/* Keep tables, flex, grid layouts */
table { display: table !important; }
thead { display: table-header-group !important; }
tbody { display: table-row-group !important; }
tr { display: table-row !important; }
td, th { display: table-cell !important; }
.grid, [class*="grid"] { display: grid !important; }

/* Disable transitions/animations */
*, *::before, *::after {
    transition: none !important;
    animation: none !important;
}

/* Readable fonts for print */
body {
    font-size: 11pt !important;
    line-height: 1.5 !important;
    color: #1a1a2e !important;
    background: white !important;
}

h1 { font-size: 22pt !important; color: #1a1a2e !important; }
h2 { font-size: 17pt !important; color: #1a1a2e !important; }
h3 { font-size: 14pt !important; color: #1a1a2e !important; }
h4 { font-size: 12pt !important; color: #1a1a2e !important; }
p, li, td, th, span, div, a { color: #1a1a2e !important; }

/* Background overrides for readability */
section, div, main, article, header, footer,
[class*="card"], [class*="bg-"], [class*="hero"],
[class*="section"], [class*="container"] {
    background: white !important;
    border-color: #ccc !important;
}

/* Cards and bordered elements */
[class*="card"] {
    border: 1px solid #ddd !important;
    padding: 12px !important;
    margin-bottom: 12px !important;
    page-break-inside: avoid;
}

/* Page breaks at major sections */
section {
    page-break-before: auto;
    page-break-inside: avoid;
}
section + section {
    page-break-before: always;
}

/* Keep tables together */
table {
    page-break-inside: avoid;
    border-collapse: collapse !important;
    width: 100% !important;
}
th, td {
    border: 1px solid #ccc !important;
    padding: 6px 10px !important;
    background: white !important;
}
th {
    background: #f0f0f0 !important;
    font-weight: bold !important;
}

/* Accent colors become print-friendly */
[class*="soul"] { color: #2563eb !important; }
[class*="counter"] { color: #7c3aed !important; }
[class*="coach"] { color: #059669 !important; }

/* Links in print */
a { color: #2563eb !important; text-decoration: underline !important; }

/* Code blocks */
pre, code {
    background: #f5f5f5 !important;
    color: #1a1a2e !important;
    border: 1px solid #ddd !important;
    font-size: 9pt !important;
}

/* Remove decorative elements */
[class*="glow"], [class*="gradient"], [class*="blur"],
[class*="backdrop"], [class*="overlay"] {
    display: none !important;
}

/* Images */
img {
    max-width: 100% !important;
    page-break-inside: avoid;
}

/* Ensure proper page flow */
.hero, [class*="hero"] {
    min-height: auto !important;
    height: auto !important;
    padding: 2rem 0 !important;
}
</style>
"""
    html_content = html_content.replace('</head>', print_css + '\n</head>')

    output_path = OUTPUT_DIR / "RESULTS_aegistrader.pdf"

    try:
        from weasyprint import HTML
        HTML(string=html_content, base_url=str(SESSION_DIR)).write_pdf(str(output_path))
        size_kb = output_path.stat().st_size / 1024
        print(f"  -> {output_path} ({size_kb:.0f} KB)")
        return True
    except Exception as e:
        print(f"  WeasyPrint failed: {e}")
        print("  Falling back to markdown-based PDF ...")
        return build_results_pdf_fallback()


def build_results_pdf_fallback():
    """Fallback: build a clean PDF from the vision document markdown."""
    vision_md = read_md(SESSION_DATA / "VISION_aegistrader.md")
    body_html = md_to_html(vision_md)

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>AegisTrader - Ideation Results</title>
<style>
@page {{ size: Letter; margin: 2cm; }}
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
       font-size: 11pt; line-height: 1.6; color: #1a1a2e; max-width: 100%; }}
h1 {{ font-size: 22pt; margin-top: 1em; border-bottom: 2px solid #2563eb; padding-bottom: 0.3em; }}
h2 {{ font-size: 17pt; margin-top: 1.5em; color: #2563eb; }}
h3 {{ font-size: 14pt; margin-top: 1.2em; }}
table {{ width: 100%; border-collapse: collapse; margin: 1em 0; page-break-inside: avoid; }}
th, td {{ border: 1px solid #ccc; padding: 6px 10px; text-align: left; }}
th {{ background: #f0f0f5; }}
pre {{ background: #f5f5f5; padding: 12px; border-radius: 6px; font-size: 9pt; overflow-x: auto; }}
code {{ background: #f0f0f5; padding: 2px 4px; border-radius: 3px; font-size: 9.5pt; }}
hr {{ border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }}
a {{ color: #2563eb; }}
</style></head><body>
<h1>Project AegisTrader: Ideation Results</h1>
<p style="color:#666; margin-bottom:2em;">Session: ideation-aegistrader-20260308-102717 | Date: 2026-03-08</p>
{body_html}
</body></html>"""

    output_path = OUTPUT_DIR / "RESULTS_aegistrader.pdf"
    try:
        from weasyprint import HTML
        HTML(string=html).write_pdf(str(output_path))
        size_kb = output_path.stat().st_size / 1024
        print(f"  -> {output_path} ({size_kb:.0f} KB) [fallback]")
        return True
    except Exception as e:
        print(f"  Fallback also failed: {e}")
        return False


# ---------------------------------------------------------------------------
# PDF 2: Session Capsule PDF
# ---------------------------------------------------------------------------

CAPSULE_CSS = """
@page {
    size: Letter;
    margin: 2cm 2.2cm;
    @bottom-center {
        content: counter(page);
        font-size: 9pt;
        color: #888;
    }
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.6;
    color: #1a1a2e;
}

/* Cover page */
.cover {
    page-break-after: always;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 85vh;
    text-align: center;
    background: #0f172a;
    color: white;
    margin: -2cm -2.2cm 0 -2.2cm;
    padding: 4cm 3cm;
}
.cover h1 {
    font-size: 32pt;
    font-weight: 700;
    margin-bottom: 0.3em;
    letter-spacing: -0.5px;
}
.cover .subtitle {
    font-size: 14pt;
    color: #94a3b8;
    margin-bottom: 2em;
    max-width: 500px;
}
.cover .thesis {
    font-size: 12pt;
    color: #60a5fa;
    font-style: italic;
    margin-bottom: 2em;
    max-width: 450px;
    line-height: 1.5;
}
.cover .date {
    font-size: 11pt;
    color: #64748b;
}

/* Section dividers */
.divider {
    page-break-before: always;
    page-break-after: always;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 60vh;
    text-align: center;
    background: #1e293b;
    color: white;
    margin: 0 -2.2cm;
    padding: 3cm;
}
.divider h2 {
    font-size: 26pt;
    font-weight: 700;
    margin-bottom: 0.3em;
    color: white;
}
.divider .layer-label {
    font-size: 11pt;
    color: #60a5fa;
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-bottom: 0.5em;
}
.divider .layer-desc {
    font-size: 11pt;
    color: #94a3b8;
    max-width: 400px;
}

/* Content styling */
h1 { font-size: 20pt; margin-top: 1.2em; margin-bottom: 0.4em; border-bottom: 2px solid #2563eb; padding-bottom: 0.2em; }
h2 { font-size: 16pt; margin-top: 1.5em; margin-bottom: 0.3em; color: #1e40af; }
h3 { font-size: 13pt; margin-top: 1.2em; margin-bottom: 0.2em; color: #334155; }
h4 { font-size: 11pt; margin-top: 1em; margin-bottom: 0.2em; color: #475569; }

p { margin: 0.5em 0; }
ul, ol { margin: 0.4em 0 0.4em 1.5em; }
li { margin: 0.15em 0; }

table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.8em 0;
    page-break-inside: avoid;
    font-size: 9.5pt;
}
th, td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; }
th { background: #f1f5f9; font-weight: 600; color: #334155; }

pre {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 14px;
    font-size: 8.5pt;
    line-height: 1.4;
    overflow-x: auto;
    page-break-inside: avoid;
}
code {
    background: #f1f5f9;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 9pt;
}
pre code { background: none; padding: 0; }

hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.2em 0; }

a { color: #2563eb; text-decoration: none; }

blockquote {
    border-left: 3px solid #2563eb;
    margin: 0.8em 0;
    padding: 0.3em 1em;
    color: #475569;
    background: #f8fafc;
}

.artifact-header {
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 8px 14px;
    margin: 1.5em 0 0.5em 0;
    font-weight: 600;
    font-size: 9pt;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 1px;
}

.page-break { page-break-before: always; }

strong { color: #0f172a; }
"""


def build_capsule_pdf():
    print("Building CAPSULE_aegistrader.pdf ...")

    # Read all source files
    vision = read_md(SESSION_DATA / "VISION_aegistrader.md")
    session_summary = read_md(SESSION_DATA / "SESSION_SUMMARY.md")
    ideation_graph = read_md(SESSION_DATA / "ideation-graph.md")
    manifest = read_md(SESSION_DATA / "sources" / "manifest.md")
    request = read_md(SESSION_DATA / "sources" / "request.md")

    # Briefs
    briefs = []
    for f in sorted((SESSION_DATA / "briefs").glob("BRIEF_*.md")):
        briefs.append((f.stem, read_md(f)))

    # Research
    research = []
    for f in sorted((SESSION_DATA / "research").glob("*.md")):
        research.append((f.stem, read_md(f)))

    # Snapshots
    snapshots = []
    for f in sorted((SESSION_DATA / "snapshots").glob("SNAPSHOT_*.md")):
        snapshots.append((f.stem, read_md(f)))

    # Idea reports
    idea_reports = []
    for f in sorted((SESSION_DATA / "idea-reports").glob("IDEA_*.md")):
        idea_reports.append((f.stem, read_md(f)))

    # Build HTML
    sections = []

    # --- COVER ---
    sections.append("""
<div class="cover">
    <h1>Project AegisTrader</h1>
    <div class="subtitle">Ideation Session Capsule</div>
    <div class="thesis">"Soul powered by backtest." &mdash; AegisTrader is a platform for growing,
    experimenting on, and coaching trading personalities.</div>
    <div class="date">Session: ideation-aegistrader-20260308-102717<br>Date: 2026-03-08</div>
</div>
""")

    # --- LAYER 1: OVERVIEW ---
    sections.append("""
<div class="divider">
    <div class="layer-label">Layer 1</div>
    <h2>Overview</h2>
    <div class="layer-desc">Table of contents and content inventory</div>
</div>
""")

    toc_html = """
<h1>Table of Contents</h1>
<h3>Layer 1: Overview</h3>
<ul>
    <li>Table of Contents</li>
    <li>Content Inventory</li>
</ul>
<h3>Layer 2: Vision</h3>
<ul>
    <li>Full Vision Document</li>
</ul>
<h3>Layer 3: Exploration</h3>
<ul>
    <li>Idea Briefs (3)</li>
    <li>Competitive Landscape Research (2 reports)</li>
</ul>
<h3>Layer 4: Origins</h3>
<ul>
    <li>Original User Request</li>
    <li>Source Materials Manifest</li>
</ul>
<h3>Layer 5: Process</h3>
<ul>
    <li>Ideation Graph</li>
    <li>Session Snapshots (5)</li>
    <li>Idea Reports (5)</li>
    <li>Session Summary</li>
</ul>

<div class="page-break"></div>
<h1>Content Inventory</h1>
<table>
<tr><th>Category</th><th>Artifact</th><th>Description</th></tr>
<tr><td>Vision</td><td>VISION_aegistrader.md</td><td>Consolidated vision document &mdash; source of truth for production</td></tr>
<tr><td>Brief</td><td>BRIEF_soul-as-product.md</td><td>Soul as the Product positioning and onboarding</td></tr>
<tr><td>Brief</td><td>BRIEF_counterfactual-forking.md</td><td>Counterfactual Soul Forking with Trauma Test MVP</td></tr>
<tr><td>Brief</td><td>BRIEF_coaching-ux.md</td><td>User-as-Coach with Soul Studio</td></tr>
<tr><td>Research</td><td>COMPETITIVE_LANDSCAPE.md</td><td>Initial competitive analysis</td></tr>
<tr><td>Research</td><td>RESEARCH_competitive-landscape.md</td><td>Deep competitive landscape with sources</td></tr>
<tr><td>Idea Report</td><td>IDEA_soul-as-product.md</td><td>Full idea report: Soul as the Product</td></tr>
<tr><td>Idea Report</td><td>IDEA_counterfactual-forking.md</td><td>Full idea report: Counterfactual Forking (early)</td></tr>
<tr><td>Idea Report</td><td>IDEA_counterfactual-soul-forking.md</td><td>Full idea report: Counterfactual Soul Forking (detailed)</td></tr>
<tr><td>Idea Report</td><td>IDEA_coaching-ux.md</td><td>Full idea report: Coaching UX</td></tr>
<tr><td>Idea Report</td><td>IDEA_user-as-coach-soul-studio.md</td><td>Full idea report: User-as-Coach with Soul Studio</td></tr>
<tr><td>Process</td><td>ideation-graph.md</td><td>Thread registry, connections, tensions, convergence signals</td></tr>
<tr><td>Process</td><td>SNAPSHOT_01-05.md</td><td>5 session snapshots capturing dialogue state</td></tr>
<tr><td>Process</td><td>SESSION_SUMMARY.md</td><td>Final session summary</td></tr>
<tr><td>Source</td><td>request.md</td><td>Original user request</td></tr>
<tr><td>Source</td><td>manifest.md</td><td>Source materials manifest</td></tr>
</table>
"""
    sections.append(toc_html)

    # --- LAYER 2: VISION ---
    sections.append("""
<div class="divider">
    <div class="layer-label">Layer 2</div>
    <h2>Vision</h2>
    <div class="layer-desc">The consolidated vision document &mdash; source of truth for production</div>
</div>
""")
    sections.append(md_to_html(vision))

    # --- LAYER 3: EXPLORATION ---
    sections.append("""
<div class="divider">
    <div class="layer-label">Layer 3</div>
    <h2>Exploration</h2>
    <div class="layer-desc">Idea briefs and competitive research</div>
</div>
""")

    for name, content in briefs:
        sections.append(f'<div class="artifact-header">Brief: {name}</div>')
        sections.append(md_to_html(content))
        sections.append('<div class="page-break"></div>')

    for name, content in research:
        sections.append(f'<div class="artifact-header">Research: {name}</div>')
        sections.append(md_to_html(content))
        sections.append('<div class="page-break"></div>')

    # --- LAYER 4: ORIGINS ---
    sections.append("""
<div class="divider">
    <div class="layer-label">Layer 4</div>
    <h2>Origins</h2>
    <div class="layer-desc">Original request and source materials</div>
</div>
""")

    sections.append('<div class="artifact-header">Original Request</div>')
    sections.append(md_to_html(request))
    sections.append('<div class="page-break"></div>')

    sections.append('<div class="artifact-header">Source Materials Manifest</div>')
    sections.append(md_to_html(manifest))

    # --- LAYER 5: PROCESS ---
    sections.append("""
<div class="divider">
    <div class="layer-label">Layer 5</div>
    <h2>Process</h2>
    <div class="layer-desc">Ideation graph, snapshots, idea reports, and session summary</div>
</div>
""")

    sections.append('<div class="artifact-header">Ideation Graph</div>')
    sections.append(md_to_html(ideation_graph))
    sections.append('<div class="page-break"></div>')

    for name, content in snapshots:
        sections.append(f'<div class="artifact-header">Snapshot: {name}</div>')
        sections.append(md_to_html(content))
        sections.append('<div class="page-break"></div>')

    for name, content in idea_reports:
        sections.append(f'<div class="artifact-header">Idea Report: {name}</div>')
        sections.append(md_to_html(content))
        sections.append('<div class="page-break"></div>')

    sections.append('<div class="artifact-header">Session Summary</div>')
    sections.append(md_to_html(session_summary))

    # Assemble full HTML
    body = "\n".join(sections)
    full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AegisTrader Ideation Capsule</title>
<style>
{CAPSULE_CSS}
</style>
</head>
<body>
{body}
</body>
</html>"""

    output_path = OUTPUT_DIR / "CAPSULE_aegistrader.pdf"

    try:
        from weasyprint import HTML
        HTML(string=full_html).write_pdf(str(output_path))
        size_kb = output_path.stat().st_size / 1024
        print(f"  -> {output_path} ({size_kb:.0f} KB)")
        return True
    except Exception as e:
        print(f"  Failed: {e}")
        return False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print(f"Session directory: {SESSION_DIR}")
    print(f"Output directory:  {OUTPUT_DIR}")
    print()

    ok1 = build_results_pdf()
    print()
    ok2 = build_capsule_pdf()
    print()

    if ok1 and ok2:
        print("Both PDFs produced successfully.")
    else:
        print("Some PDFs failed. Check output above.")
        sys.exit(1)
