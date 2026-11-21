# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                  | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.72.0 (Roger, 2026-11-21: "making sure there is a version of the resume that fills their stuff accurately .. we keep getting offset .. we have a tabbed resume and for the input fields it needs to be clearly labeled"): the parse résumé, Resume_Parse.docx. The job's own tailored résumé (the same roles, bullets and dates, after the years truth and role rules) laid out for an employer's résumé parser such as Workday's Autofill with Resume: one column, no table, tab, text box, column, header, footer or picture, one standard font, the headings Contact Information, Summary, Experience, Education, Certifications and Skills, and every value on its own labelled line (Job Title, Company, Through, Location, Start Date, End Date; School, Degree, Field of Study, Start Date, End Date), each date MM/YYYY, a year alone when only the year is recorded, or Present. The same content renders to the same bytes.
"""Parse résumé: the job's tailored résumé laid out for an employer's résumé parser."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from . import role_hierarchy, role_plan
from .docx_ooxml import (
    CT_NS, DOC_MIME, REL_NS, _core_props_xml, _member, _root_rels_xml, build_rpr, in_twips, line_240, make_paragraph,
    make_run, pt_twips, w_el,
)
from .docx_resume import clean_candidate_name

FILE_NAME = "Resume_Parse.docx"
SECTIONS = ("Contact Information", "Summary", "Experience", "Education", "Certifications", "Skills")
FONT = "Arial"
_MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
_CURRENT = re.compile(r"\b(present|current|now|today)\b", re.I)
_DEGREE = re.compile(
    r"^(master of business administration|(?:bachelor|master|doctor|associate) of (?:applied science|fine arts|science|"
    r"arts|engineering|education|laws|philosophy)|(?:bachelor|master|associate)'?s(?: degree)?|mba|ph\.?\s?d\.?|"
    r"b\.?\s?sc\.?|m\.?\s?sc\.?|b\.?\s?eng\.?|m\.?\s?eng\.?|b\.?\s?s\.?|b\.?\s?a\.?|m\.?\s?s\.?|m\.?\s?a\.?|bba|"
    r"j\.?\s?d\.?)(?=[\s,]|$)", re.I)
_SCHOOL = re.compile(r"universit|college|institut|school|academy|polytechnic", re.I)


def _text(value: Any) -> str:
    """One line of text: control characters and tabs become spaces, so no value can ever carry a tab stop."""
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]+", " ", str(value or ""))).strip()


def parse_date(value: Any) -> str:
    """@description One date as the parse résumé writes it: MM/YYYY when it names a month, the year alone when it
    names only a year, Present for a current one, '' when it names neither. Reads 2019-03, 2019-03-01, 03/2019,
    Mar 2019, March 2019 and 2019. @param value - A recorded date or one side of a span. @returns The date."""
    text = _text(value)
    if not text:
        return ""
    if _CURRENT.search(text):
        return "Present"
    for pattern, year_first in ((r"\b((?:19|20)\d{2})[-/.](\d{1,2})\b", True), (r"\b(\d{1,2})[-/.]((?:19|20)\d{2})\b", False)):
        found = re.search(pattern, text)
        if found:
            year, month = (found[1], found[2]) if year_first else (found[2], found[1])
            if 1 <= int(month) <= 12:
                return f"{int(month):02d}/{year}"
    named = re.search(r"\b([A-Za-z]{3,9})\.?,?\s+((?:19|20)\d{2})\b", text)
    if named and named[1][:3].lower() in _MONTHS:
        return f"{_MONTHS.index(named[1][:3].lower()) + 1:02d}/{named[2]}"
    years = re.findall(r"\b(?:19|20)\d{2}\b", text)
    return years[0] if len(years) == 1 else ""


def span_dates(span: Any) -> tuple[str, str]:
    """@description Start and end from a résumé span ("Apr 2019 to Present", "2012 to 2015", "2012-2015"); a span of
    one date is that date for both, as role_plan writes a role that began and ended in it. @param span - The span.
    @returns (start, end)."""
    text = _text(span)
    years = re.fullmatch(r"((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})", text)
    if years:
        return years[1], years[2]
    parts = re.split(r"\s+(?:to|through|until|-)\s+|\s*[–—]\s*", text, maxsplit=1, flags=re.I)
    start = parse_date(parts[0])
    if len(parts) == 1:
        return start, start
    return start, parse_date(parts[1])


def _recorded(item: dict, roles: list) -> dict | None:
    """The one recorded role a résumé entry is, by its exact title and employer words, else None."""
    found = [role for role in roles if isinstance(role, dict)
             and role_hierarchy.anchor(role.get("title")) == role_hierarchy.anchor(item.get("title"))
             and role_hierarchy.anchor(role.get("org")) == role_hierarchy.anchor(item.get("org") or item.get("employer"))]
    return found[0] if len(found) == 1 else None


def _role_lines(item: dict, parent: dict | None, roles: list) -> list[tuple[str, str]]:
    """One role's labelled lines in order: Job Title, Company, Through (a client engagement), Location, Start Date,
    End Date. Dates come from the recorded role when one is this entry, else from the entry's span."""
    record = _recorded(item, roles)
    if record is not None:
        start = parse_date(record.get("start"))
        end = "Present" if role_plan.is_current(record) else parse_date(record.get("end"))
    else:
        start, end = span_dates(item.get("span") or item.get("dates"))
    lines = [("Job Title", _text(item.get("title"))), ("Company", _text(item.get("org") or item.get("employer")))]
    if parent is not None:
        lines.append(("Through", _text(parent.get("org") or parent.get("employer"))))
    location = _text(item.get("location")) or _text((record or {}).get("location"))
    lines += [("Location", location), ("Start Date", start), ("End Date", end)]
    return [(label, value) for label, value in lines if value]


def _experience(resume: dict) -> list[tuple[dict, dict | None]]:
    """Every role once, in the order the executive résumé shows it (role_hierarchy.ordered), each client engagement
    with its employer entry, then the chosen additional experience and open-source work; an exact repeat of an entry
    already printed is left out."""
    ordered = role_hierarchy.ordered([item for item in (resume.get("experience") or []) if isinstance(item, dict)])
    for key in ("additional_experience", "open_source"):
        ordered += [{k: v for k, v in item.items() if k not in ("id", *role_hierarchy.FIELDS, "group_heading")}
                    for item in (resume.get(key) or []) if isinstance(item, dict)]
    by_id = {item.get("id"): item for item in ordered if item.get("id") and not item.get("parent_role_id")}
    seen, out, root = set(), [], None
    for item in ordered:
        if not item.get("parent_role_id"):
            root = item
        key = tuple(role_hierarchy.anchor(item.get(k)) for k in ("title", "org", "span"))
        if key in seen:
            continue
        seen.add(key)
        out.append((item, by_id.get(item.get("parent_role_id"), root) if item.get("parent_role_id") else None))
    return out


def _school(entry: Any) -> list[tuple[str, str]] | str:
    """One school as labelled lines (School, Degree, Field of Study, Start Date, End Date), or its statement as written
    when neither a school nor a degree can be read from it."""
    if isinstance(entry, dict):
        item = {"School": _text(entry.get("school") or entry.get("institution")), "Degree": _text(entry.get("degree")),
                "Field of Study": _text(entry.get("field") or entry.get("major")),
                "Start Date": parse_date(entry.get("start") or entry.get("from")),
                "End Date": parse_date(entry.get("end") or entry.get("to") or entry.get("year"))}
        return [(k, v) for k, v in item.items() if v] if item["School"] or item["Degree"] else _text(entry.get("details"))
    statement = _text(entry)
    years = re.findall(r"\b(?:19|20)\d{2}\b", statement)
    parts = [p for p in (_text(x) for x in re.split(r"\s+\|\s+|\s+[—–]\s+|,\s+", statement)) if p and not re.match(r"^\D{0,3}(19|20)\d{2}", p)]
    degree_part = next((p for p in parts if _DEGREE.match(p)), "")
    found = _DEGREE.match(degree_part)
    rest = re.sub(r"^\s*(?:in|of)\s+", "", degree_part[found.end():], flags=re.I).strip(" ,") if found else ""
    after = parts[parts.index(degree_part) + 1] if degree_part and parts.index(degree_part) + 1 < len(parts) else ""
    field = rest or (after if after and not _SCHOOL.search(after) and not _DEGREE.match(after) else "")
    item = {"School": next((p for p in parts if _SCHOOL.search(p) and p != degree_part), ""), "Degree": found[0] if found else "",
            "Field of Study": field, "Start Date": years[0] if len(years) > 1 else "", "End Date": years[-1] if years else ""}
    return [(k, v) for k, v in item.items() if v] if item["School"] or item["Degree"] else statement


def _address(contact: dict) -> str:
    """Street, city, state and ZIP, country from profile.application_contact; the location line when none is kept."""
    held = contact.get("application_contact") if isinstance(contact.get("application_contact"), dict) else {}
    state = _text(held.get("state_abbrev") or held.get("state"))
    state_zip = " ".join(part for part in (state, _text(held.get("postal_code") or held.get("zip"))) if part)
    parts = [_text(held.get(k)) for k in ("address1", "address2", "city")] + [state_zip, _text(held.get("country"))]
    return ", ".join(part for part in parts if part) or _text(contact.get("location"))


def _contact_lines(contact: dict, resume: dict) -> list[tuple[str, str]]:
    name = clean_candidate_name(contact.get("name"))
    lines = [("Name", "" if name == "Candidate" else name), ("Email", _text(contact.get("email"))),
             ("Phone", _text(contact.get("phone"))), ("Address", _address(contact)),
             ("LinkedIn", _text(contact.get("linkedin"))), ("Citizenship", _text(contact.get("citizenship"))),
             ("Clearance", _text(resume.get("clearance") or contact.get("clearance")))]
    return [(label, value) for label, value in lines if value]


def _skill_lines(resume: dict) -> list[str]:
    """Competencies, then each skills group as 'Group: items', then any plain skills under Technical Skills."""
    lines, plain = [], []
    competencies = [_text(c) for c in (resume.get("competencies") or []) if _text(c)]
    if competencies:
        lines.append("Core Competencies: " + ", ".join(competencies))
    for skill in (_text(s) for s in (resume.get("skills") or [])):
        label, _, items = skill.partition(":")
        if items.strip() and 0 < len(label.strip()) <= 52:
            lines.append(f"{label.strip()}: {items.strip()}")
        elif skill:
            plain.append(skill)
    return lines + (["Technical Skills: " + ", ".join(plain)] if plain else [])


def _para(text: str, style: str = "Normal", *, bold: bool = False, size: float = 11.0) -> ET.Element:
    return make_paragraph(style, [make_run(_text(text), FONT, size_pt=size, color_hex="000000", bold=bold)],
                          num_id="1" if style == "ListBullet" else None, keep_next=style == "Heading1")


def _labelled(label: str, value: str) -> ET.Element:
    return make_paragraph("Normal", [make_run(f"{label}: ", FONT, size_pt=11.0, color_hex="000000", bold=True),
                                     make_run(_text(value), FONT, size_pt=11.0, color_hex="000000")])


def _sections(contact: dict, resume: dict, roles: list) -> list[list[ET.Element]]:
    """Each section's paragraphs, in SECTIONS order."""
    experience = []
    for item, parent in _experience(resume):
        experience += [_labelled(label, value) for label, value in _role_lines(item, parent, roles)]
        experience += [_para(b, "ListBullet") for b in (item.get("bullets") or []) if _text(b)]
    education = []
    for entry in resume.get("education") or []:
        school = _school(entry)
        education += [_labelled(k, v) for k, v in school] if isinstance(school, list) else ([_para(school)] if school else [])
    return [[_labelled(label, value) for label, value in _contact_lines(contact, resume)],
            [_para(text) for text in (resume.get("headline"), resume.get("summary")) if _text(text)],
            experience, education,
            [_para(c) for c in (resume.get("certifications") or []) if _text(c)],
            [_para(line) for line in _skill_lines(resume)]]


def _body(contact: dict, resume: dict, roles: list) -> list[ET.Element]:
    """The name, then each section that has something in it under its standard heading."""
    name = clean_candidate_name(contact.get("name"))
    paras = [_para(name, "Title", bold=True, size=16.0)] if name != "Candidate" else []
    for heading, content in zip(SECTIONS, _sections(contact, resume, roles)):
        if content:
            paras += [_para(heading, "Heading1", bold=True, size=12.0), *content]
    return paras


def _styles_xml() -> bytes:
    """Normal, Title, Heading1 and List Bullet in one standard font, with no tab stop, border, shading or theme font."""
    root = w_el("w:styles")
    defaults = w_el("w:docDefaults")
    rpr_default = w_el("w:rPrDefault")
    rpr_default.append(build_rpr(FONT, 11.0))
    defaults.append(rpr_default)
    root.append(defaults)
    for style_id, name, size, bold, before, after in (("Normal", "Normal", 11.0, False, 0, 2), ("Title", "Title", 16.0, True, 0, 6),
                                                      ("Heading1", "heading 1", 12.0, True, 12, 4), ("ListBullet", "List Bullet", 11.0, False, 0, 2)):
        attrs = {"w:type": "paragraph", "w:styleId": style_id, **({"w:default": "1"} if style_id == "Normal" else {})}
        style = w_el("w:style", attrs)
        style.append(w_el("w:name", {"w:val": name}))
        if style_id != "Normal":
            style.append(w_el("w:basedOn", {"w:val": "Normal"}))
        style.append(w_el("w:qFormat"))
        ppr = w_el("w:pPr")
        ppr.append(w_el("w:spacing", {"w:before": pt_twips(before), "w:after": pt_twips(after), "w:line": line_240(1.1), "w:lineRule": "auto"}))
        style.append(ppr)
        style.append(build_rpr(FONT, size, "000000", bold=bold))
        root.append(style)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _numbering_xml() -> bytes:
    """One bullet list whose bullet is followed by a space, not a tab."""
    root = w_el("w:numbering")
    abstract = w_el("w:abstractNum", {"w:abstractNumId": "1"})
    level = w_el("w:lvl", {"w:ilvl": "0"})
    for tag, val in (("start", "1"), ("numFmt", "bullet"), ("suff", "space"), ("lvlText", "•"), ("lvlJc", "left")):
        level.append(w_el(f"w:{tag}", {"w:val": val}))
    ppr = w_el("w:pPr")
    ppr.append(w_el("w:ind", {"w:left": "360", "w:hanging": "180"}))
    level.append(ppr)
    level.append(build_rpr(FONT))
    abstract.append(level)
    root.append(abstract)
    num = w_el("w:num", {"w:numId": "1"})
    num.append(w_el("w:abstractNumId", {"w:val": "1"}))
    root.append(num)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _document_xml(paragraphs: list[ET.Element]) -> bytes:
    """One section, one column, Letter with 0.75 inch margins, and no header or footer reference."""
    root, body = w_el("w:document"), w_el("w:body")
    for paragraph in paragraphs:
        body.append(paragraph)
    sect = w_el("w:sectPr")
    sect.append(w_el("w:pgSz", {"w:w": "12240", "w:h": "15840"}))
    margin = in_twips(0.75)
    sect.append(w_el("w:pgMar", {"w:top": margin, "w:right": margin, "w:bottom": margin, "w:left": margin,
                                 "w:header": "0", "w:footer": "0", "w:gutter": "0"}))
    body.append(sect)
    root.append(body)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _package_parts() -> dict[str, bytes]:
    style_type = "application/vnd.openxmlformats-officedocument.wordprocessingml"
    rel_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    types = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="{CT_NS}">'
             '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
             '<Default Extension="xml" ContentType="application/xml"/>'
             f'<Override PartName="/word/document.xml" ContentType="{DOC_MIME}"/>'
             f'<Override PartName="/word/styles.xml" ContentType="{style_type}.styles+xml"/>'
             f'<Override PartName="/word/numbering.xml" ContentType="{style_type}.numbering+xml"/>'
             '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>')
    rels = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="{REL_NS}">'
            f'<Relationship Id="rId1" Type="{rel_type}/styles" Target="styles.xml"/>'
            f'<Relationship Id="rId2" Type="{rel_type}/numbering" Target="numbering.xml"/></Relationships>')
    return {"[Content_Types].xml": types.encode("utf-8"), "_rels/.rels": _root_rels_xml(),
            "word/_rels/document.xml.rels": rels.encode("utf-8"), "word/styles.xml": _styles_xml(),
            "word/numbering.xml": _numbering_xml()}


def render_parse_resume(contact: dict | None, resume: dict | None, output_path: Path | str, roles: list | None = None) -> Path:
    """@description Write the parse résumé of one job: the job's tailored résumé as labelled lines for a résumé parser.
    @param contact - The person's profile block (name, email, phone, linkedin, location, application_contact).
    @param resume - The job's generated résumé (headline, summary, experience, education, certifications, skills).
    @param output_path - Where to write it (Resume_Parse.docx in the job's folder).
    @param roles - The recorded roles (profile_snapshot.roles): a role's recorded dates and location, matched by its
        exact title and employer; without them the dates come from the résumé's spans and no location is printed.
    @returns The written path."""
    src, data = contact or {}, resume or {}
    name = clean_candidate_name(src.get("name"))
    parts = {**_package_parts(), "docProps/core.xml": _core_props_xml(name, f"{name} Resume", ""),
             "word/document.xml": _document_xml(_body(src, data, [r for r in (roles or []) if isinstance(r, dict)]))}
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(out, "w", ZIP_DEFLATED) as archive:
        for member, payload in parts.items():
            archive.writestr(_member(member), payload)
    return out
