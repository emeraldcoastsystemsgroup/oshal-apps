"""Writes applications/INDEX.html + INDEX.csv: every generated packet tied to its
REQUISITION NUMBER + title, with links that open on ANY computer the applications
folder syncs to (OneDrive). Links are RELATIVE to the applications folder, so they
resolve regardless of where OneDrive mounts. Open INDEX.html from the applications
folder (double-click) and the Resume/Cover links open the PDFs.

Re-run anytime with `python make_index.py`; the dashboard also refreshes it on each
Generate.
"""
from __future__ import annotations
import csv
import html
import os
import re
import urllib.parse

from . import config, db

APP = config.ROOT / "applications"


def _clean_req(ats, pid) -> str:
    """Human-facing requisition id. Referral/manual rows store the real req number;
    scraped SuccessFactors rows store a /job/.../<id>/ URL — pull the trailing id."""
    a = str(ats or "").strip()
    if a.isdigit():
        return a
    m = re.search(r"/(\d+)/?$", a)
    if m:
        return m.group(1)
    return f"(id {pid})"


def _rel(path):
    if not path:
        return None
    try:
        rp = os.path.relpath(path, APP)
    except Exception:
        return None
    return None if rp.startswith("..") else rp


def _href(relpath):
    if not relpath:
        return None
    return "/".join(urllib.parse.quote(p) for p in relpath.replace("\\", "/").split("/"))


def _rows():
    """Every posting this user has generated a packet for, newest first.

    Dual-mode with no changes needed, and deliberately so — this is the shape a ported
    reader is SUPPOSED to end up in:

      - `postings` must stay the compat VIEW (097) in postgres mode, never career_postings.
        ai_fit_score, generated_at, status, resume_path and cover_path are all per-user
        columns that exist only through the RLS-filtered joins. Reading the base table here
        would fail on undefined columns — and the index is per-person by definition: it
        lists the packets THIS user generated.
      - `resume_path IS NOT NULL` needs no dialect work; it is the join reaching (or not)
        career_user_applications, and RLS makes "not mine" indistinguishable from "not
        generated", which is the correct answer to give.
      - `generated_at` comes back as the same ISO-8601 TEXT SQLite stored (097 casts
        TIMESTAMPTZ with to_char), so `[:10]` in build() still slices a date and the string
        ORDER BY is still chronological.
      - `NULLS LAST` is explicit standard syntax in both engines (SQLite >= 3.30).
      - No `?` and no literal `%`, so it executes verbatim.

    The one real difference is row ORDER within a tie: `c.name` sorts under the database's
    collation, byte-order in SQLite vs the cluster's locale in Postgres, so mixed-case
    company names can interleave differently. Cosmetic — this is a filterable listing, and
    nothing downstream depends on the tie order.
    """
    with db.connect() as conn:
        return conn.execute(
            """SELECT p.id, p.ats_job_id, p.title, p.location, p.ai_fit_score,
                      p.generated_at, p.status, p.resume_path, p.cover_path, c.name AS company
               FROM postings p JOIN companies c ON c.id = p.company_id
               WHERE p.resume_path IS NOT NULL
               ORDER BY p.generated_at DESC NULLS LAST, c.name"""
        ).fetchall()


_TPL = """<!doctype html><html><head><meta charset="utf-8">
<title>Generated Resumes - index</title>
<style>
 body{font-family:Segoe UI,Arial,sans-serif;margin:18px;color:#1b2330}
 h1{font-size:19px;margin:0 0 4px} .sub{color:#6b7785;font-size:12px;margin-bottom:10px}
 #q{width:380px;padding:8px;font-size:14px;border:1px solid #c5ccd6;border-radius:6px}
 table{border-collapse:collapse;width:100%;margin-top:12px;font-size:13px}
 th,td{border-bottom:1px solid #e6e9ef;padding:6px 8px;text-align:left;vertical-align:top}
 th{position:sticky;top:0;background:#0f2741;color:#fff}
 .req{font-weight:700;color:#0a7a33;white-space:nowrap} .t{max-width:430px}
 .c{text-align:center;white-space:nowrap} a{color:#1763c6;text-decoration:none}
 a:hover{text-decoration:underline} tr:hover{background:#f4f8ff}
 .miss{color:#fff;background:#c0392b;font-size:10px;padding:1px 5px;border-radius:4px;margin-left:6px}
 .note{background:#fff6e0;border:1px solid #e8d28a;padding:8px 10px;border-radius:6px;font-size:12px;margin:8px 0}
</style></head><body>
<h1>Generated Resume Packets</h1>
<div class="sub">__COUNT__ packets &middot; keep this file in the <b>applications</b> folder so links resolve &middot; relative links work on any synced computer</div>
<div class="note">Filter by <b>req #</b>, company, or title. Click <b>Resume</b> / <b>Cover</b> to open the PDF, or <b>all</b> for every variant (ATS, Premium, 1-page).</div>
<input id="q" placeholder="filter by req #, title, company, location..." autofocus>
<table><thead><tr><th>Req&nbsp;#</th><th>Company</th><th>Title</th><th>Location</th><th>Fit</th><th>Gen</th><th>Resume</th><th>Cover</th><th>All</th></tr></thead>
<tbody id="b">__ROWS__</tbody></table>
<script>
 var q=document.getElementById('q'),b=document.getElementById('b');
 q.addEventListener('input',function(){var v=q.value.toLowerCase().trim(),rs=b.rows,i;
  for(i=0;i<rs.length;i++){rs[i].style.display=(!v||rs[i].getAttribute('data-s').indexOf(v)>-1)?'':'none';}});
</script></body></html>"""


def build():
    """Write INDEX.html + INDEX.csv. Returns (count, html_path)."""
    APP.mkdir(parents=True, exist_ok=True)
    rows = _rows()

    with open(APP / "INDEX.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Req", "Company", "Title", "Location", "Fit", "Generated",
                    "Folder", "ResumeRel", "CoverRel", "ResumeExists"])
        for r in rows:
            rp, cp = _rel(r["resume_path"]), _rel(r["cover_path"])
            folder = os.path.dirname(rp) if rp else ""
            exists = bool(r["resume_path"]) and os.path.exists(r["resume_path"])
            w.writerow([_clean_req(r["ats_job_id"], r["id"]), r["company"], r["title"],
                        r["location"], r["ai_fit_score"], r["generated_at"], folder,
                        rp or "", cp or "", "yes" if exists else "MISSING"])

    trs = []
    for r in rows:
        rp, cp = _rel(r["resume_path"]), _rel(r["cover_path"])
        folder = os.path.dirname(rp) if rp else ""
        exists = bool(r["resume_path"]) and os.path.exists(r["resume_path"])
        req = html.escape(_clean_req(r["ats_job_id"], r["id"]))
        comp = html.escape(r["company"] or "")
        title = html.escape(r["title"] or "")
        loc = html.escape(r["location"] or "")
        fit = r["ai_fit_score"] if r["ai_fit_score"] is not None else ""
        gen = html.escape((r["generated_at"] or "")[:10])
        res = f'<a href="{_href(rp)}">Resume</a>' if rp else "&mdash;"
        cov = f'<a href="{_href(cp)}">Cover</a>' if cp else "&mdash;"
        fold = f'<a href="{_href(folder)}">all</a>' if folder else "&mdash;"
        warn = "" if exists else '<span class="miss">MISSING</span>'
        s = html.escape(f"{req} {comp} {title} {loc}".lower(), quote=True)
        trs.append(
            f'<tr data-s="{s}"><td class="req">{req}</td><td>{comp}</td>'
            f'<td class="t">{title}{warn}</td><td>{loc}</td><td class="c">{fit}</td>'
            f'<td class="c">{gen}</td><td class="c">{res}</td><td class="c">{cov}</td>'
            f'<td class="c">{fold}</td></tr>')

    out = _TPL.replace("__COUNT__", str(len(rows))).replace("__ROWS__", "\n".join(trs))
    (APP / "INDEX.html").write_text(out, encoding="utf-8")
    return len(rows), str(APP / "INDEX.html")
