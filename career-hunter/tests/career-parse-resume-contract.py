# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                  | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.72.0 (Roger, 2026-11-21: "making sure there is a version of the resume that fills their stuff accurately .. we keep getting offset .. for the input fields it needs to be clearly labeled"): the parse résumé's contract on a made-up person with six roles (one held by year only, one client engagement under its employer) and two schools. The format: no tab, table, text box, column, header, footer, drawing or theme font in any part. The structure: the six standard headings in order, labelled contact lines, every role exactly once with Job Title, Company, Location, Start Date and End Date in that order (the engagement's Company the client, Through its employer), MM/YYYY or a year alone everywhere, schools as School, Degree, Field of Study, Start Date, End Date. The real parse: the plain line reader of tests/helpers/resume_line_parser.py over the Word paragraphs and over pdftotext of the LibreOffice PDF recovers every role exactly from the parse résumé, and not from the executive Word résumé of the same person.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Lane CAREER-LOCATION: the location is the recorded role's, as Work history saves it: a location the generated entry carries never replaces the record's (Madison, WI is printed, not the entry's) or stands in for one the record does not hold (no Location line), and an entry no record anchors (other experience) keeps its own.
"""Parse résumé contract: Resume_Parse.docx is laid out for an employer's résumé parser."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT / "engine"))
sys.path.insert(0, str(PACKAGE_ROOT / "tests" / "helpers"))

from jobhunter import docx_resume, role_hierarchy  # noqa: E402
import resume_line_parser as reader  # noqa: E402

CHECKS: list = []
SECTIONS = ["Contact Information", "Summary", "Experience", "Education", "Certifications", "Skills"]


def check(name: str, condition, detail: str = "") -> None:
    """@description Record one named check. @param name - The check. @param condition - Its outcome.
    @param detail - Shown when it fails. @returns None."""
    CHECKS.append((f"{name} ({detail})" if detail and not condition else name, bool(condition)))


def contact() -> dict:
    """@description The made-up person's profile block, as Career keeps it. @returns The profile."""
    return {"name": "Riley J Sample, MBA", "email": "riley.sample@example.test", "phone": "555-0142",
            "linkedin": "https://www.linkedin.com/in/riley-sample-example", "location": "Madison, WI",
            "application_contact": {"address1": "42 Fixture Lane", "address2": "Unit 3", "city": "Madison",
                                    "state": "Wisconsin", "state_abbrev": "WI", "postal_code": "53703",
                                    "country": "United States"}}


def recorded_roles() -> list:
    """@description The made-up person's recorded roles: six, one by year only, one a client engagement of r2.
    @returns The roles as career_db.json keeps them."""
    return [
        {"id": "r1", "title": "Director of Operations", "org": "Example Harbor Freight", "start": "2021-03", "end": None, "location": "Madison, WI"},
        {"id": "r2", "title": "Principal Consultant", "org": "Sample Advisory Group", "start": "2016-05", "end": "2021-02",
         "location": "Chicago, IL", "engagements_heading": "Selected Client Engagements"},
        {"id": "r3", "title": "Program Lead", "org": "Northwind Bank", "start": "2018-01", "end": "2020-06", "location": "Remote",
         "parent_role_id": "r2"},
        {"id": "r4", "title": "Operations Manager", "org": "Contoso Logistics, Inc.", "start": "2012-08", "end": "2016-04", "location": "Milwaukee, WI"},
        {"id": "r5", "title": "Logistics Analyst", "org": "Fabrikam Supply - Midwest Division", "start": "2009", "end": "2012", "location": "Green Bay, WI"},
        {"id": "r6", "title": "Shift Supervisor", "org": "Tailspin Distribution", "start": "2006-06", "end": "2009-07", "location": "Appleton, WI"},
    ]


def resume() -> dict:
    """@description The job's generated résumé as generation leaves it: spans from the record, hierarchy pinned, the
    dash cleanup's ", " in r5's employer. @returns The résumé."""
    two = ["Cut dock-to-stock time from 3 days to 1 across 4 sites.", "Ran a 60-person team through a WMS cutover."]
    return {
        "headline": "Director of Operations | Logistics and Supply Chain",
        "summary": "Operations leader who runs multi-site logistics, vendor programs and system cutovers.",
        "competencies": ["Logistics Strategy", "Vendor Management", "P&L Ownership"],
        "skills": ["Operations: Warehouse Management, Lean, Kaizen", "Systems: SAP, Oracle WMS, SQL"],
        "experience": [
            {"id": "r1", "title": "Director of Operations", "org": "Example Harbor Freight", "span": "Mar 2021 to Present",
             "bullets": two + ["Saved $1.2M a year in carrier spend."]},
            {"id": "r2", "title": "Principal Consultant", "org": "Sample Advisory Group", "span": "May 2016 to Feb 2021",
             "engagements_heading": "Selected Client Engagements", "bullets": ["Led eleven operations assessments.", "Built the practice's playbook."]},
            {"id": "r3", "parent_role_id": "r2", "title": "Program Lead", "org": "Northwind Bank", "span": "Jan 2018 to Jun 2020",
             "bullets": ["Moved 14 branches onto one\tprocurement process.", "Closed the audit findings on time."]},
            {"id": "r4", "title": "Operations Manager", "org": "Contoso Logistics, Inc.", "span": "Aug 2012 to Apr 2016", "bullets": two},
            {"id": "r5", "title": "Logistics Analyst", "org": "Fabrikam Supply, Midwest Division", "span": "2009 to 2012",
             "bullets": ["Built the weekly freight cost report."]},
            {"id": "r6", "title": "Shift Supervisor", "org": "Tailspin Distribution", "span": "Jun 2006 to Jul 2009",
             "bullets": ["Supervised a 20-person night shift."]},
        ],
        "education": ["MBA, Operations Management | Example State University | 2010 - 2012",
                      "BS in Business Administration, Sample College, 2002 - 2006"],
        "certifications": ["Certified Supply Chain Professional (CSCP)", "Lean Six Sigma Green Belt"],
    }


EXPECTED = [
    {"title": "Director of Operations", "company": "Example Harbor Freight", "location": "Madison, WI", "start": "03/2021", "end": "Present", "bullets": 3},
    {"title": "Principal Consultant", "company": "Sample Advisory Group", "location": "Chicago, IL", "start": "05/2016", "end": "02/2021", "bullets": 2},
    {"title": "Program Lead", "company": "Northwind Bank", "through": "Sample Advisory Group", "location": "Remote", "start": "01/2018", "end": "06/2020", "bullets": 2},
    {"title": "Operations Manager", "company": "Contoso Logistics, Inc.", "location": "Milwaukee, WI", "start": "08/2012", "end": "04/2016", "bullets": 2},
    {"title": "Logistics Analyst", "company": "Fabrikam Supply, Midwest Division", "location": "Green Bay, WI", "start": "2009", "end": "2012", "bullets": 1},
    {"title": "Shift Supervisor", "company": "Tailspin Distribution", "location": "Appleton, WI", "start": "06/2006", "end": "07/2009", "bullets": 1},
]


def render(out: Path, data: dict | None = None, roles: list | None = None) -> Path:
    """@description The parse résumé of the made-up person through the engine's own renderer. @param out - Folder.
    @param data - The résumé (default: resume()). @param roles - Recorded roles (default: recorded_roles()). @returns The file."""
    from jobhunter import docx_parse
    return docx_parse.render_parse_resume(contact(), data or resume(), out / docx_parse.FILE_NAME,
                                          roles=recorded_roles() if roles is None else roles)


def executive(out: Path) -> Path:
    """@description The same person's executive Word résumé, as the packet's Resume_ATS.docx is made. @param out - Folder.
    @returns The file."""
    data = resume()
    data["experience"] = role_hierarchy.ordered(data["experience"])  # as generate._packet_files hands it over
    candidate, spec = docx_resume.packet_to_candidate_and_spec(contact(), data)
    return docx_resume.render_resume_docx(candidate, spec, out / "Resume_ATS.docx", family="Professional")


def test_format(out: Path) -> None:
    """@description No tab, table, text box, column, header, footer, drawing or theme font in any part."""
    path = render(out)
    with ZipFile(path) as archive:
        parts = {name: archive.read(name).decode("utf-8") for name in archive.namelist() if name.endswith(".xml") or name.endswith(".rels")}
    joined = "\n".join(parts.values())
    check("format: no w:tab or w:tabs anywhere", not re.search(r"<w:tabs?\b", joined))
    check("format: no w:tbl", "<w:tbl" not in joined)
    check("format: no text box", not re.search(r"txbxContent|<v:textbox|wps:txbx", joined))
    cols = [int(n) for n in re.findall(r'<w:cols\b[^>]*w:num="(\d+)"', joined)]
    check("format: no w:cols greater than 1", all(n <= 1 for n in cols), str(cols))
    check("format: no header or footer part", not any(re.match(r"word/(header|footer)\d*\.xml$", n) for n in parts), str(list(parts)))
    check("format: no header or footer reference", not re.search(r"headerReference|footerReference", joined))
    check("format: no drawing, picture or frame", not re.search(r"<w:drawing|<w:pict|<w:framePr|<w:object", joined))
    check("format: no theme fonts", not re.search(r"(ascii|hAnsi|eastAsia|cs)Theme", joined))
    fonts = set(re.findall(r'w:ascii="([^"]+)"', joined))
    check("format: one standard font", fonts == {"Arial"}, str(fonts))
    check("format: two renders are the same bytes", render(out).read_bytes() == path.read_bytes())


def _blocks(lines: list[str]) -> list[list[str]]:
    """Experience lines grouped into one list per Job Title."""
    start, end = lines.index("Experience") + 1, lines.index("Education")
    blocks: list[list[str]] = []
    for line in lines[start:end]:
        if line.startswith("Job Title: "):
            blocks.append([])
        if blocks:
            blocks[-1].append(line)
    return blocks


def test_structure(out: Path) -> None:
    """@description Standard headings, labelled contact lines, each role once with its labelled lines in order."""
    from jobhunter import docx_parse
    path = render(out)
    lines = [line for line in reader.docx_lines(str(path)) if line]
    heads = [line for line in lines if line in SECTIONS]
    check("structure: the six standard headings, in order, once each", heads == SECTIONS, str(heads))
    check("structure: SECTIONS is the engine's list", list(docx_parse.SECTIONS) == SECTIONS)
    contact_lines = lines[lines.index("Contact Information") + 1:lines.index("Summary")]
    check("structure: contact lines", contact_lines == [
        "Name: Riley J Sample", "Email: riley.sample@example.test", "Phone: 555-0142",
        "Address: 42 Fixture Lane, Unit 3, Madison, WI 53703, United States",
        "LinkedIn: https://www.linkedin.com/in/riley-sample-example"], str(contact_lines))
    check("structure: the name is the first line", lines[0] == "Riley J Sample", lines[0])
    blocks = _blocks(lines)
    check("structure: six roles", len(blocks) == 6, str(len(blocks)))
    for role in EXPECTED:
        mine = [b for b in blocks if b[0] == "Job Title: " + role["title"]]
        check(f"structure: {role['title']} appears exactly once", len(mine) == 1, str(len(mine)))
        if len(mine) != 1:
            continue
        head = [line for line in mine[0] if not line.startswith("• ")]
        want = ["Job Title: " + role["title"], "Company: " + role["company"]]
        want += ["Through: " + role["through"]] if role.get("through") else []
        want += ["Location: " + role["location"], "Start Date: " + role["start"], "End Date: " + role["end"]]
        check(f"structure: {role['title']} labelled lines in order", head == want, str(head))
        bullets = [line for line in mine[0] if line.startswith("• ")]
        check(f"structure: {role['title']} keeps its {role['bullets']} bullets after its dates",
              len(bullets) == role["bullets"] and mine[0][len(head):] == bullets, str(mine[0]))
    dates = [line.split(": ", 1)[1] for line in lines if line.startswith(("Start Date: ", "End Date: "))]
    check("structure: every date is MM/YYYY, a year alone or Present",
          dates and all(re.fullmatch(r"\d{2}/\d{4}|\d{4}|Present", d) for d in dates), str(dates))
    schools = lines[lines.index("Education") + 1:lines.index("Certifications")]
    check("structure: schools as labelled lines", schools == [
        "School: Example State University", "Degree: MBA", "Field of Study: Operations Management", "Start Date: 2010", "End Date: 2012",
        "School: Sample College", "Degree: BS", "Field of Study: Business Administration", "Start Date: 2002", "End Date: 2006"], str(schools))
    certs = lines[lines.index("Certifications") + 1:lines.index("Skills")]
    check("structure: one certification per line", certs == resume()["certifications"], str(certs))
    skills = lines[lines.index("Skills") + 1:]
    check("structure: skills keep their groups", skills == ["Core Competencies: Logistics Strategy, Vendor Management, P&L Ownership",
                                                           "Operations: Warehouse Management, Lean, Kaizen", "Systems: SAP, Oracle WMS, SQL"], str(skills))
    summary = lines[lines.index("Summary") + 1:lines.index("Experience")]
    check("structure: summary keeps the headline and summary", summary == [resume()["headline"], resume()["summary"]], str(summary))
    check("structure: a tab inside a bullet is a space", "• Moved 14 branches onto one procurement process." in lines)
    check("structure: no label is printed empty", not any(re.fullmatch(r"[A-Za-z ]+:", line) for line in lines))


def test_edges(out: Path) -> None:
    """@description A repeated role prints once; a role with no recorded location has no Location line; a role no
    record anchors reads its dates from its span."""
    data = resume()
    data["experience"].append(dict(data["experience"][3]))
    lines = reader.docx_lines(str(render(out, data)))
    check("edges: an exact repeat of a role prints once", lines.count("Job Title: Operations Manager") == 1)
    plain = [dict(role, location="") if role["id"] == "r6" else role for role in recorded_roles()]
    lines = reader.docx_lines(str(render(out, resume(), plain)))
    block = lines[lines.index("Job Title: Shift Supervisor"):lines.index("Job Title: Shift Supervisor") + 4]
    check("edges: no recorded location, no Location line", block == ["Job Title: Shift Supervisor", "Company: Tailspin Distribution",
                                                                      "Start Date: 06/2006", "End Date: 07/2009"], str(block))
    lines = reader.docx_lines(str(render(out, resume(), [])))
    check("edges: without the record, dates come from the résumé's span", "Start Date: 2009" in lines and "End Date: Present" in lines)
    check("edges: without the record, no Location line", not any(line.startswith("Location:") for line in lines))


def _head(lines: list[str], title: str) -> list[str]:
    """One role's labelled lines (its block up to its first bullet)."""
    start = lines.index("Job Title: " + title)
    end = next((n for n in range(start + 1, len(lines)) if lines[n].startswith(("• ", "Job Title: ")) or lines[n] in SECTIONS), len(lines))
    return lines[start:end]


def test_location(out: Path) -> None:
    """@description The location is the recorded role's, as Work history saved it: a location the generated entry
    carries never replaces it or stands in for one the record does not hold; an entry no record anchors keeps its own."""
    data = resume()
    data["experience"][0]["location"] = "Somewhere Else, ZZ"   # r1 records Madison, WI
    data["experience"][3]["location"] = "Guessed City, QQ"     # r4's record holds none below
    roles = [dict(role, location="") if role["id"] == "r4" else role for role in recorded_roles()]
    lines = reader.docx_lines(str(render(out, data, roles)))
    check("location: the recorded location is printed, not one the résumé entry carries",
          _head(lines, "Director of Operations")[2:3] == ["Location: Madison, WI"], str(_head(lines, "Director of Operations")))
    check("location: a recorded role with no location prints none, even when the résumé entry carries one",
          _head(lines, "Operations Manager") == ["Job Title: Operations Manager", "Company: Contoso Logistics, Inc.",
                                                 "Start Date: 08/2012", "End Date: 04/2016"], str(_head(lines, "Operations Manager")))
    data = resume()
    data["additional_experience"] = [{"title": "Volunteer Coordinator", "org": "Example Food Bank", "span": "2019 to 2020",
                                      "location": "Madison, WI", "bullets": ["Scheduled 40 volunteers a week."]}]
    lines = reader.docx_lines(str(render(out, data)))
    check("location: an entry no record anchors keeps the location it carries",
          _head(lines, "Volunteer Coordinator")[:3] == ["Job Title: Volunteer Coordinator", "Company: Example Food Bank", "Location: Madison, WI"],
          str(_head(lines, "Volunteer Coordinator")))


def _truth() -> list[dict]:
    return [{key: role[key] for key in ("title", "company", "start", "end")} for role in EXPECTED]


def test_real_parse(out: Path) -> dict:
    """@description The plain line reader over both résumés' Word paragraphs and over pdftotext of their PDFs.
    @returns The comparison."""
    parse, exe = render(out), executive(out)
    result = {"word": {"parse": reader.compare(_truth(), reader.parse_roles(reader.docx_lines(str(parse)))),
                       "executive": reader.compare(_truth(), reader.parse_roles(reader.docx_lines(str(exe))))}}
    check("real parse (Word paragraphs): every role's title, company and dates recovered exactly from the parse résumé",
          result["word"]["parse"] == {"exact": 6, "of": 6, "read": 6, "missed": []}, json.dumps(result["word"]["parse"]))
    check("real parse (Word paragraphs): the executive résumé through the same reader is not recovered",
          result["word"]["executive"]["exact"] < 6, json.dumps(result["word"]["executive"]))
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    check("real parse: LibreOffice and pdftotext are installed", soffice and shutil.which("pdftotext"))
    if not soffice or not shutil.which("pdftotext"):
        return result
    pdfs = {name: docx_resume.soffice_convert(path, out / "pdf", "pdf") for name, path in (("parse", parse), ("executive", exe))}
    check("real parse: both PDFs rendered", all(pdfs.values()), str(pdfs))
    if all(pdfs.values()):
        result["pdf"] = {name: reader.compare(_truth(), reader.parse_roles(reader.pdf_lines(str(pdf)), wrapped=True)) for name, pdf in pdfs.items()}
        check("real parse (pdftotext of its PDF): every role recovered exactly from the parse résumé",
              result["pdf"]["parse"]["exact"] == 6 and result["pdf"]["parse"]["read"] == 6, json.dumps(result["pdf"]["parse"]))
        check("real parse (pdftotext of its PDF): the executive résumé is not recovered",
              result["pdf"]["executive"]["exact"] < 6, json.dumps(result["pdf"]["executive"]))
    return result


def test_cli(out: Path) -> None:
    """@description export-packet --kind parse renders the same bytes from a packet's application.json."""
    packet = {"company": "Example Harbor Freight", "title": "Director of Operations", "template_family": "Professional",
              "generated": {"resume": resume(), "cover": {}}, "profile_snapshot": {"profile": contact(), "roles": recorded_roles()}}
    source = out / "application.json"
    source.write_text(json.dumps(packet), encoding="utf-8")
    run = subprocess.run([sys.executable, "-m", "jobhunter.docx_resume", "export-packet", "--packet-json", str(source),
                          "--out-dir", str(out / "cli"), "--kind", "parse", "--format", "docx"],
                         capture_output=True, text=True, timeout=60, cwd=str(PACKAGE_ROOT / "engine"),
                         env={**os.environ, "PYTHONPATH": str(PACKAGE_ROOT / "engine")})
    answer = json.loads(run.stdout.strip().splitlines()[-1]) if run.stdout.strip() else {}
    check("cli: export-packet --kind parse answers ok", run.returncode == 0 and answer.get("ok") is True, run.stderr[-400:])
    if answer.get("ok"):
        check("cli: the same bytes as the engine's render", Path(answer["path"]).read_bytes() == render(out).read_bytes())
        check("cli: named Resume_Parse.docx", Path(answer["path"]).name == "Resume_Parse.docx", answer["path"])
    refused = subprocess.run([sys.executable, "-m", "jobhunter.docx_resume", "export-packet", "--packet-json", str(source),
                              "--out-dir", str(out / "cli"), "--kind", "parse", "--format", "pdf"],
                             capture_output=True, text=True, timeout=60, cwd=str(PACKAGE_ROOT / "engine"),
                             env={**os.environ, "PYTHONPATH": str(PACKAGE_ROOT / "engine")})
    check("cli: the parse résumé is Word only", refused.returncode == 1 and '"ok": false' in refused.stdout, refused.stdout[-200:])


def main() -> int:
    """@description Run every check and print one JSON summary line. @returns 0 when every check passed, else 1."""
    comparison: dict = {}
    with tempfile.TemporaryDirectory(prefix="career-parse-resume-") as tmp:
        for fn in (test_format, test_structure, test_edges, test_location, test_real_parse, test_cli):
            folder = Path(tmp) / fn.__name__
            folder.mkdir()
            try:
                value = fn(folder)
                if isinstance(value, dict):
                    comparison = value
            except Exception as err:  # a raised error is a failed check, named, never swallowed
                check(f"{fn.__name__} raised {type(err).__name__}: {err}", False)
    failed = [name for name, ok in CHECKS if not ok]
    print(json.dumps({"checks": len(CHECKS), "failed": failed, "comparison": comparison}))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
