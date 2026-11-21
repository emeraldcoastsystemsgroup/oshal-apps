# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                  | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.72.0 (Roger, 2026-11-21: "making sure there is a version of the resume that fills their stuff accurately .. we keep getting offset"): the yardstick of the parse résumé. A plain line-based résumé reader of the kind an upload form runs over a résumé's text: one Word paragraph (or one line of pdftotext output) is one line; inside the Experience section a line that names its field ("Job Title:", "Company:", "Start Date:") fills that field, and a line that names none is read by its place (a block's first line is the title, the next one the company, a line holding only a date range the dates). It knows nothing about either résumé's layout, so the same reader is run over the parse résumé and over the executive Word résumé.
"""A plain line-based résumé reader: what an employer's form recovers from a résumé's text."""
from __future__ import annotations

import json
import re
import subprocess
import sys
import zipfile
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
HEADINGS = {
    "contact information", "contact", "summary", "professional summary", "experience", "professional experience",
    "work experience", "education", "certifications", "certifications and training", "skills", "core skills",
    "selected project", "selected projects",
}
EXPERIENCE = {"experience", "professional experience", "work experience"}
LABELS = {"job title": "title", "title": "title", "position": "title", "company": "company", "employer": "company",
          "through": "through", "location": "location", "start date": "start", "end date": "end"}
MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
DATE = r"(?:\d{1,2}/\d{4}|(?:19|20)\d{2}(?:-\d{1,2})?|[A-Za-z]{3,9}\.? (?:19|20)\d{2})"
RANGE = re.compile(rf"^({DATE})\s*(?:-|–|—|to)\s*({DATE}|present|current)$", re.I)
LABEL = re.compile(r"^([A-Za-z][A-Za-z ]{1,20}):\s*(.+)$")


def docx_lines(path: str) -> list[str]:
    """@description Each body paragraph of a Word file as one line, as python-docx's Paragraph.text reads it (a tab
    is a tab character, a break a newline), a list paragraph shown with the bullet a text export gives it.
    @param path - The .docx file. @returns The lines."""
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    lines = []
    for paragraph in root.iter(W + "p"):
        parts = []
        for run in paragraph.iter(W + "r"):
            for node in run:
                if node.tag == W + "t":
                    parts.append(node.text or "")
                elif node.tag == W + "tab":
                    parts.append("\t")
                elif node.tag in (W + "br", W + "cr"):
                    parts.append("\n")
        text = "".join(parts)
        lines.append("• " + text if paragraph.find(f"{W}pPr/{W}numPr") is not None else text)
    return lines


def pdf_lines(path: str) -> list[str]:
    """@description The text pdftotext gives for a PDF, line by line. @param path - The .pdf file. @returns The lines."""
    out = subprocess.run(["pdftotext", path, "-"], capture_output=True, text=True, timeout=60, check=True)
    return out.stdout.splitlines()


def normal_date(value: str) -> str:
    """@description A date as the reader keeps it: MM/YYYY when it names a month, the year alone when it names only a
    year, Present for a current one, else the text as written. @param value - The date text. @returns The date."""
    text = value.strip()
    if re.fullmatch(r"present|current", text, re.I):
        return "Present"
    if re.fullmatch(r"\d{1,2}/\d{4}", text):
        month, year = text.split("/")
        return f"{int(month):02d}/{year}"
    found = re.fullmatch(r"((?:19|20)\d{2})-(\d{1,2})", text)
    if found:
        return f"{int(found[2]):02d}/{found[1]}"
    named = re.fullmatch(r"([A-Za-z]{3,9})\.? ((?:19|20)\d{2})", text)
    if named and named[1][:3].lower() in MONTHS:
        return f"{MONTHS.index(named[1][:3].lower()) + 1:02d}/{named[2]}"
    return text


def _label(line: str):
    found = LABEL.match(line)
    if not found or found[1].strip().casefold() not in LABELS:
        return None
    field = LABELS[found[1].strip().casefold()]
    value = found[2].strip()
    return field, normal_date(value) if field in ("start", "end") else value


def parse_roles(lines: list[str], wrapped: bool = False) -> list[dict]:
    """@description The roles a plain reader recovers from the Experience section. A labelled line fills its field (a
    Job Title starts a role); an unlabelled line starts a role when none is open or a bullet came before it, is the
    company when the open role has none, and is the dates when it holds only a date range. With `wrapped` (page text,
    where a long bullet runs onto the next line), an unlabelled line right after a bullet continues that bullet.
    @param lines - The résumé's lines. @param wrapped - Whether lines are page text that wraps.
    @returns [{title, company, start, end, through?, location?, bullets}]."""
    roles, role, inside, after_bullet = [], None, False, False
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if line.casefold() in HEADINGS:
            inside, role, after_bullet = line.casefold() in EXPERIENCE, None, False
            continue
        if not inside:
            continue
        if line.startswith("•"):
            if role is not None:
                role["bullets"] += 1
            after_bullet = True
            continue
        labelled = _label(line)
        if labelled:
            if labelled[0] == "title" or role is None:
                role = {"bullets": 0}
                roles.append(role)
            role[labelled[0]], after_bullet = labelled[1], False
            continue
        if after_bullet and wrapped:
            continue
        dates = RANGE.match(line)
        if dates and role is not None and not after_bullet:
            role["start"], role["end"] = normal_date(dates[1]), normal_date(dates[2])
        elif role is None or after_bullet:
            role = {"bullets": 0, "title": line}
            roles.append(role)
        elif "company" not in role:
            role["company"] = line
        after_bullet = False
    return roles


def compare(expected: list[dict], parsed: list[dict]) -> dict:
    """@description How many recorded roles the reader recovered exactly: title, company, start and end each equal.
    @param expected - [{title, company, start, end}]. @param parsed - parse_roles output.
    @returns {exact, of, read, missed: [titles]}."""
    keys = ("title", "company", "start", "end")
    found = [role for role in expected if any(all(p.get(k) == role[k] for k in keys) for p in parsed)]
    return {"exact": len(found), "of": len(expected), "read": len(parsed),
            "missed": [role["title"] for role in expected if role not in found]}


if __name__ == "__main__":
    # python3 resume_line_parser.py <file.docx|file.pdf> : the roles the reader recovers, as JSON.
    target = sys.argv[1]
    print(json.dumps(parse_roles(pdf_lines(target), wrapped=True) if target.endswith(".pdf")
                     else parse_roles(docx_lines(target))))
