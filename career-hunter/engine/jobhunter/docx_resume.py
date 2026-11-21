# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                  | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Multi-user executive resume & cover-letter DOCX/DOTX/RTF/PDF pipeline built on pure-stdlib docx_ooxml with automatic family selection, LibreOffice headless conversion, progressive 2-page compaction guard, blank zero-PII template generator, and CLI helper for read-only packet/template export.
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.68.21: route shell-wrapper soffice binaries through /usr/bin/sh when /bin/sh is absent (as inside oshald's bwrap sandbox where /usr is mounted without /bin), keeping direct invocation when /bin/sh exists or for non-script binaries.
# 3 | maintainer@emeraldcoastsystemsgroup.com | 1.72.0: export-packet --kind parse --format docx renders the job's parse résumé (docx_parse, Resume_Parse.docx) from application.json, for a packet made before 1.72.0; it is Word only and needs no LibreOffice.
"""Multi-user ATS-safe and RTF-safe executive resume & cover-letter pipeline.

Zero hardcoded candidate PII, zero python-docx runtime dependency. Produces matched
.docx, .rtf, and .pdf artifacts across 4 template families (Standard, Professional,
Leadership, Technical) with automatic 2-page balance enforcement via LibreOffice.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from .docx_ooxml import (
    FAMILIES,
    make_paragraph,
    make_run,
    save_as_dotx,
    write_docx_zip,
)

VALID_FAMILIES: tuple[str, ...] = ("Standard", "Professional", "Leadership", "Technical")
_FAMILY_BY_LOWER = {name.lower(): name for name in VALID_FAMILIES}

_CREDENTIAL_SUFFIX_RE = re.compile(
    r"(?:\s*[,;|]\s*(?:MBA|M\.?B\.?A\.?|MS|M\.?S\.?|M\.?Eng\.?|MA|BS|B\.?S\.?|BA|B\.?A\.?|"
    r"Ph\.?D\.?|Ed\.?D\.?|J\.?D\.?|PMP|CISSP|CISM|CISA|CPA|PE|CSM|PMI-ACP|ITIL)\b[^,;|]*)+$",
    re.IGNORECASE,
)
_LEADERSHIP_RE = re.compile(
    r"\b(vp|vice president|director|head of|chief|cto|cio|ciso|svp|evp|executive|gm|general manager)\b",
    re.IGNORECASE,
)
_TECHNICAL_RE = re.compile(
    r"\b(engineer|architect|devops|sre|reliability|developer|software|platform|infrastructure|systems|cloud|security)\b",
    re.IGNORECASE,
)
_STANDARD_RE = re.compile(
    r"\b(program manager|project manager|scrum master|delivery manager|pmo|tpm|technical program)\b",
    re.IGNORECASE,
)
_EDU_SCHOOL_RE = re.compile(r"\b(university|college|institute|school|academy|polytechnic)\b", re.IGNORECASE)

COMPACT_TIERS: tuple[dict[str, Any], ...] = (
    {},
    dict(
        body_size=9.75, skills_size=9.5, role_size=10.25, emp_size=9.25,
        heading_size=10.0, headline_size=10.75, contact_size=9.0, name_size=21.5,
        line_spacing=1.06, space_after_bullet=2.0, space_before_role=4.8,
        space_before_heading=6.8, space_after_heading=3.0,
        margin_top=0.48, margin_bottom=0.46, margin_lr=0.56,
    ),
    dict(
        body_size=9.25, skills_size=9.0, role_size=9.75, emp_size=8.85,
        heading_size=9.5, headline_size=10.25, contact_size=8.75, name_size=19.5,
        line_spacing=1.04, space_after_bullet=1.4, space_before_role=3.6,
        space_before_heading=5.5, space_after_heading=2.4,
        margin_top=0.42, margin_bottom=0.40, margin_lr=0.50,
    ),
    dict(
        body_size=8.75, skills_size=8.5, role_size=9.25, emp_size=8.5,
        heading_size=9.1, headline_size=9.75, contact_size=8.5, name_size=18.0,
        line_spacing=1.02, space_after_bullet=1.0, space_before_role=2.6,
        space_before_heading=4.5, space_after_heading=2.0,
        margin_top=0.36, margin_bottom=0.35, margin_lr=0.44,
        omit_extra_competencies=True,
    ),
    dict(
        body_size=8.25, skills_size=8.0, role_size=8.75, emp_size=8.1,
        heading_size=8.75, headline_size=9.25, contact_size=8.25, name_size=17.0,
        line_spacing=1.00, space_after_bullet=0.6, space_before_role=2.0,
        space_before_heading=3.5, space_after_heading=1.5,
        margin_top=0.32, margin_bottom=0.30, margin_lr=0.40,
        omit_extra_competencies=True,
    ),
)


def normalize_family(requested: str | None) -> str | None:
    """Resolve a user-supplied family name case-insensitively, or None."""
    if not isinstance(requested, str):
        return None
    return _FAMILY_BY_LOWER.get(requested.strip().lower())


def choose_family(
    title: str = "",
    resume_data: dict[str, Any] | None = None,
    requested: str | None = None,
) -> str:
    """Select one of the 4 verified template families from request or role title/headline."""
    explicit = normalize_family(requested)
    if explicit:
        return explicit
    headline = str((resume_data or {}).get("headline") or "")
    target = str(title or "").strip()
    if target and _STANDARD_RE.search(target):
        return "Standard"
    if target and _LEADERSHIP_RE.search(target):
        return "Leadership"
    if target and _TECHNICAL_RE.search(target):
        return "Technical"
    if _LEADERSHIP_RE.search(headline):
        return "Leadership"
    if _TECHNICAL_RE.search(headline):
        return "Technical"
    if _STANDARD_RE.search(headline):
        return "Standard"
    return "Professional"


def clean_candidate_name(name: str | None) -> str:
    """Return a clean single-line candidate full name without appended degree/credential suffixes."""
    text = re.sub(r"\s+", " ", str(name or "")).strip()
    if not text:
        return "Candidate"
    cleaned = _CREDENTIAL_SUFFIX_RE.sub("", text).strip(" ,;|")
    return cleaned or text


def contact_lines_from_profile(
    contact: dict[str, Any] | None,
    resume_data: dict[str, Any] | None = None,
) -> list[str]:
    """Build 1-2 compact executive contact/eligibility lines from profile fields."""
    src = contact or {}
    resume = resume_data or {}
    line1 = " | ".join(
        str(src.get(k) or "").strip()
        for k in ("location", "phone", "email")
        if str(src.get(k) or "").strip()
    )
    clearance = str(resume.get("clearance") or src.get("clearance") or "").strip()
    line2_bits = [
        str(src.get("linkedin") or "").strip(),
        str(src.get("citizenship") or "").strip(),
        clearance,
    ]
    line2 = " | ".join(bit for bit in line2_bits if bit)
    return [line for line in (line1, line2) if line]


def _parse_skills(resume: dict[str, Any], omit_extra_competencies: bool) -> list[dict[str, str]]:
    raw_skills = [str(s).strip() for s in (resume.get("skills") or []) if str(s).strip()]
    raw_comp = [str(c).strip() for c in (resume.get("competencies") or []) if str(c).strip()]
    labeled: list[dict[str, str]] = []
    plain: list[str] = []
    for item in raw_skills:
        if ":" in item:
            lbl, txt = item.split(":", 1)
            if lbl.strip() and txt.strip() and len(lbl.strip()) <= 52:
                labeled.append({"label": lbl.strip(), "text": txt.strip()})
                continue
        plain.append(item)
    if plain:
        labeled.append({"label": "Technical Skills", "text": ", ".join(plain)})
    if raw_comp and (not labeled or not omit_extra_competencies):
        if not labeled:
            labeled.append({"label": "Core Competencies", "text": " | ".join(raw_comp)})
        elif len(" | ".join(raw_comp)) <= 420:
            labeled.insert(0, {"label": "Core Competencies", "text": " | ".join(raw_comp)})
    return labeled


def _parse_education_entry(entry: Any) -> dict[str, str] | None:
    if isinstance(entry, dict):
        deg = str(entry.get("degree") or "").strip()
        det = str(entry.get("details") or "").strip()
        return {"degree": deg, "details": det} if deg else None
    text = str(entry or "").strip()
    if not text:
        return None
    if "|" in text:
        deg, rest = text.split("|", 1)
        return {"degree": deg.strip(), "details": rest.strip()}
    parts = [p.strip() for p in text.split(",") if p.strip()]
    for idx, part in enumerate(parts):
        if idx > 0 and _EDU_SCHOOL_RE.search(part):
            return {"degree": ", ".join(parts[:idx]), "details": " | ".join(parts[idx:])}
    return {"degree": text, "details": ""}


def _map_role(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": str(item.get("title") or "").strip(),
        "employer": str(item.get("employer") or item.get("org") or "").strip(),
        "context": str(item.get("context") or "").strip(),
        "dates": str(item.get("dates") or item.get("span") or "").strip(),
        "bullets": [str(b).strip() for b in (item.get("bullets") or []) if str(b).strip()],
        "is_child": bool(item.get("parent_role_id")),
        "group_heading": str(item.get("group_heading") or "").strip(),
    }


def packet_to_candidate_and_spec(
    contact: dict[str, Any] | None,
    resume: dict[str, Any] | None,
    *,
    omit_extra_competencies: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Map career-hunter's contact + generated.resume JSON into (candidate, spec)."""
    src = contact or {}
    r = resume or {}
    education = [e for item in (r.get("education") or []) if (e := _parse_education_entry(item))]
    certs = [str(c).strip() for c in (r.get("certifications") or []) if str(c).strip()]
    candidate = {
        "name": clean_candidate_name(src.get("name")),
        "contact_lines": contact_lines_from_profile(src, r),
        "education": education,
        "certifications": certs,
    }
    roles = [_map_role(e) for e in (r.get("experience") or []) if isinstance(e, dict)]
    projects: list[dict[str, Any]] = []
    for key in ("open_source", "additional_experience"):
        for item in (r.get(key) or []):
            if isinstance(item, dict):
                projects.append(_map_role(item))
    spec = {
        "headline": str(r.get("headline") or "").strip(),
        "summary": str(r.get("summary") or "").strip(),
        "skills": _parse_skills(r, omit_extra_competencies),
        "roles": roles,
        "earlier": str(r.get("earlier") or "").strip() or None,
        "projects": projects,
    }
    return candidate, spec


def _append_role_paragraphs(
    paras: list[Any],
    role: dict[str, Any],
    c: dict[str, Any],
    *,
    is_first: bool = False,
) -> None:
    font = c["font"]
    indent = 240 if role.get("is_child") else None
    if role.get("group_heading"):
        paras.append(make_paragraph(
            "ResumeEmployer",
            [make_run(role["group_heading"], font, size_pt=c["emp_size"], color_hex=c["heading_hex"], bold=True)],
            space_before=3.5, space_after=1.5, keep_next=True, indent_left_dxa=240,
        ))
    paras.append(make_paragraph(
        "ResumeRole",
        [make_run(role.get("title") or "", font, size_pt=c["role_size"], color_hex="111111", bold=True)],
        space_before=2.0 if is_first else None, keep_next=True, indent_left_dxa=indent,
    ))
    employer = str(role.get("employer") or "")
    if role.get("context"):
        employer = f"{employer} | {role['context']}" if employer else str(role["context"])
    emp_runs = [
        make_run(employer, font, size_pt=c["emp_size"], color_hex=c["emp_hex"], italic=True),
        make_run("\t" + str(role.get("dates") or ""), font, size_pt=c["emp_size"], color_hex=c["date_hex"]),
    ]
    paras.append(make_paragraph("ResumeEmployer", emp_runs, keep_next=True, indent_left_dxa=indent))
    bullets = role.get("bullets") or []
    keep_intact = len(bullets) <= 3
    num_id = "81" if role.get("is_child") else "80"
    for idx, bullet in enumerate(bullets):
        paras.append(make_paragraph(
            "ResumeBullet",
            [make_run(bullet, font, size_pt=c["body_size"], color_hex="1A1A1A")],
            keep_next=(keep_intact and idx < len(bullets) - 1),
            num_id=num_id,
        ))


def _heading_para(title: str, c: dict[str, Any]) -> Any:
    label = title.upper() if c["upper"] else title
    return make_paragraph("Heading1", [make_run(label, c["font"], size_pt=c["heading_size"],
                                                color_hex=c["heading_hex"], bold=True)], keep_next=True)


def _append_resume_sections(paras: list[Any], candidate: dict[str, Any], spec: dict[str, Any], c: dict[str, Any]) -> None:
    font = c["font"]
    if spec.get("summary"):
        paras.append(_heading_para("Professional Summary", c))
        paras.append(make_paragraph("Normal", [make_run(spec["summary"], font, size_pt=c["body_size"], color_hex="1A1A1A")]))
    if spec.get("skills"):
        paras.append(_heading_para("Core Skills", c))
        for sk in spec["skills"]:
            runs = [
                make_run(f"{sk['label']}: ", font, size_pt=c["skills_size"], color_hex="111111", bold=True),
                make_run(sk["text"], font, size_pt=c["skills_size"], color_hex="1A1A1A"),
            ]
            paras.append(make_paragraph("ResumeSkills", runs))
    if spec.get("roles"):
        paras.append(_heading_para("Professional Experience", c))
        for idx, role in enumerate(spec["roles"]):
            _append_role_paragraphs(paras, role, c, is_first=(idx == 0))
    if spec.get("earlier"):
        txt = re.sub(r"^earlier experience:\s*", "", str(spec["earlier"]), flags=re.I)
        runs = [
            make_run("Earlier Experience: ", font, size_pt=c["skills_size"], color_hex="111111", bold=True),
            make_run(txt, font, size_pt=c["skills_size"], color_hex="222222"),
        ]
        paras.append(make_paragraph("ResumeEarlier", runs))
    projects = list(spec.get("projects") or [])
    if spec.get("project") and not projects:
        proj = spec["project"]
        projects.append({
            "title": proj.get("title", ""), "employer": proj.get("subtitle", ""),
            "dates": proj.get("dates", ""), "bullets": proj.get("bullets") or [],
        })
    if projects:
        paras.append(_heading_para("Selected Project" if len(projects) == 1 else "Selected Projects", c))
        for idx, proj in enumerate(projects):
            _append_role_paragraphs(paras, proj, c, is_first=(idx == 0))
    if candidate.get("education"):
        paras.append(_heading_para("Education", c))
        for ed in candidate["education"]:
            runs = [make_run(ed["degree"], font, size_pt=c["skills_size"], color_hex="111111", bold=True)]
            if ed.get("details"):
                runs.append(make_run(" | " + ed["details"].lstrip("| "), font, size_pt=c["skills_size"], color_hex="1A1A1A"))
            paras.append(make_paragraph("ResumeSkills", runs))
    if candidate.get("certifications"):
        paras.append(_heading_para("Certifications and Training", c))
        paras.append(make_paragraph(
            "ResumeSkills",
            [make_run(" | ".join(candidate["certifications"]), font, size_pt=c["skills_size"], color_hex="1A1A1A")],
        ))


def render_resume_docx(
    candidate: dict[str, Any],
    spec: dict[str, Any],
    output_path: Path | str,
    family: str = "Professional",
    overrides: dict[str, Any] | None = None,
    also_dotx: bool = False,
) -> Path:
    """Render candidate + spec into an ATS-safe, RTF-safe .docx (and optional .dotx)."""
    fam = normalize_family(family)
    if not fam:
        raise ValueError(f"Unknown template family {family!r}. Choose from {list(VALID_FAMILIES)}")
    c = dict(FAMILIES[fam])
    if overrides:
        c.update({k: v for k, v in overrides.items() if k in c})
    font = c["font"]
    name = clean_candidate_name(candidate.get("name"))
    paras: list[Any] = [
        make_paragraph("Title", [make_run(name, font, size_pt=c["name_size"], color_hex=c["name_hex"], bold=True)], keep_next=True),
    ]
    if spec.get("headline"):
        paras.append(make_paragraph(
            "ResumeHeadline",
            [make_run(str(spec["headline"]), font, size_pt=c["headline_size"], color_hex=c["headline_hex"], bold=True)],
            keep_next=True,
        ))
    lines = [ln for ln in (candidate.get("contact_lines") or []) if ln]
    for idx, ln in enumerate(lines):
        sid = "ResumeContactLast" if idx == len(lines) - 1 else "ResumeContact"
        paras.append(make_paragraph(sid, [make_run(ln, font, size_pt=c["contact_size"], color_hex=c["contact_hex"])], keep_next=True))
    _append_resume_sections(paras, candidate, spec, c)
    out = write_docx_zip(
        output_path, paras, c,
        footer_name=name, author=name, title=f"{name} Resume", subject=str(spec.get("headline") or ""),
    )
    if also_dotx:
        save_as_dotx(out, out.with_suffix(".dotx"))
    return out


def render_cover_docx(
    contact: dict[str, Any] | None,
    cover: dict[str, Any] | None,
    company: str,
    title: str,
    today: str,
    output_path: Path | str,
    family: str = "Professional",
    overrides: dict[str, Any] | None = None,
) -> Path:
    """Render a matching executive cover letter .docx in the same visual family."""
    fam = normalize_family(family) or "Professional"
    c = dict(FAMILIES[fam])
    c.update({"margin_top": 0.72, "margin_bottom": 0.72, "margin_lr": 0.78})
    if overrides:
        c.update({k: v for k, v in overrides.items() if k in c})
    font, src, cov = c["font"], contact or {}, cover or {}
    name = clean_candidate_name(src.get("name"))
    lines = contact_lines_from_profile(src)
    paras: list[Any] = [
        make_paragraph("Title", [make_run(name, font, size_pt=min(c["name_size"], 21.0), color_hex=c["name_hex"], bold=True)], keep_next=True),
    ]
    for idx, ln in enumerate(lines):
        sid = "ResumeContactLast" if idx == len(lines) - 1 else "ResumeContact"
        paras.append(make_paragraph(sid, [make_run(ln, font, size_pt=c["contact_size"], color_hex=c["contact_hex"])], keep_next=True))
    if today:
        paras.append(make_paragraph("Normal", [make_run(today, font, size_pt=c["body_size"], color_hex=c["contact_hex"])], space_before=10.0, space_after=6.0))
    if company:
        paras.append(make_paragraph("Normal", [make_run(company, font, size_pt=c["body_size"], color_hex=c["heading_hex"], bold=True)], space_after=1.5))
    if title:
        paras.append(make_paragraph("Normal", [make_run(f"Re: {title}", font, size_pt=c["body_size"], color_hex=c["headline_hex"])], space_after=10.0))
    greeting = str(cov.get("greeting") or "Dear Hiring Manager,").strip()
    paras.append(make_paragraph("Normal", [make_run(greeting, font, size_pt=c["body_size"], color_hex="1A1A1A")], space_after=8.0))
    for ptxt in (cov.get("paragraphs") or []):
        clean = str(ptxt or "").strip()
        if clean:
            paras.append(make_paragraph("Normal", [make_run(clean, font, size_pt=c["body_size"], color_hex="1A1A1A")], space_after=8.0))
    closing = str(cov.get("closing") or "Sincerely,").strip()
    paras.append(make_paragraph("Normal", [make_run(closing, font, size_pt=c["body_size"], color_hex="1A1A1A")], space_before=6.0, space_after=2.0, keep_next=True))
    paras.append(make_paragraph("Normal", [make_run(name, font, size_pt=c["body_size"], color_hex=c["heading_hex"], bold=True)]))
    return write_docx_zip(
        output_path, paras, c,
        footer_name=name, author=name, title=f"{name} Cover Letter", subject=f"{title} at {company}".strip(),
    )


def render_blank_template(family: str, output_path: Path | str, also_dotx: bool = True) -> Path:
    """Emit a reusable zero-PII blank template in the requested family (.docx and optional .dotx)."""
    fam = normalize_family(family)
    if not fam:
        raise ValueError(f"Unknown template family {family!r}")
    candidate = {
        "name": "[Full Name]",
        "contact_lines": [
            "[City, State] | [Phone] | [Email]",
            "[LinkedIn or Portfolio URL] | [Work Authorization or Clearance]",
        ],
        "education": [{"degree": "[Degree, Concentration]", "details": "[University Name] | [YYYY - YYYY]"}],
        "certifications": ["[Certification 1]", "[Certification 2]", "[Certification 3]"],
    }
    spec = {
        "headline": "[Target Role Headline]",
        "summary": "[3 to 4 concise sentences connecting leadership scope, domain expertise, and verified outcomes to the target role.]",
        "skills": [
            {"label": "[Primary Skill Category]", "text": "[Skill 1], [Skill 2], [Skill 3], [Skill 4]"},
            {"label": "[Secondary Skill Category]", "text": "[Platform 1], [Platform 2], [Tool 1], [Tool 2]"},
        ],
        "roles": [
            {
                "title": "[Most Recent Role Title]", "employer": "[Current Employer]",
                "context": "[Program or Practice Area]", "dates": "[Mon YYYY - Present]",
                "bullets": [
                    "[Lead with your strongest measurable outcome: action verb, scope, and verified metric.]",
                    "[Second accomplishment demonstrating leadership, architecture, or hands-on delivery.]",
                    "[Third accomplishment highlighting scale, cross-functional alignment, or business impact.]",
                ],
            },
            {
                "title": "[Previous Role Title]", "employer": "[Employer Name]",
                "context": "[Division or Client Context]", "dates": "[Mon YYYY - Mon YYYY]",
                "bullets": [
                    "[Highlight ownership, technology stack or governance scope, and verified results.]",
                    "[Keep bullets concise (1 to 2 lines); focus on outcomes rather than routine duties.]",
                ],
            },
        ],
        "earlier": "[Optional compact line summarizing early-career roles, titles, and dates.]",
        "projects": [{
            "title": "[Project Name]", "employer": "[Independent Product or Open-Source Project | URL]",
            "dates": "[YYYY - Present]",
            "bullets": ["[Optional section for technical roles: architecture, stack, scale, and verified results.]"],
        }],
    }
    return render_resume_docx(candidate, spec, output_path, family=fam, also_dotx=also_dotx)


def pdf_page_count(pdf_path: Path) -> int:
    """Count pages in a PDF using pdfinfo when available, else pure-Python PDF page markers."""
    pdfinfo = shutil.which("pdfinfo")
    if pdfinfo:
        proc = subprocess.run([pdfinfo, str(pdf_path)], capture_output=True, text=True, timeout=15)
        if proc.returncode == 0:
            m = re.search(r"^Pages:\s*(\d+)", proc.stdout, re.MULTILINE)
            if m:
                return int(m.group(1))
    raw = pdf_path.read_bytes()
    pages = len(re.findall(rb"/Type\s*/Page\b", raw))
    return max(1, pages)


def _is_shell_wrapper(binary_path: str) -> bool:
    """Return True when binary_path is a #! shell wrapper script rather than a compiled binary."""
    try:
        with open(binary_path, "rb") as fh:
            first_line = fh.readline(128)
    except OSError:
        return False
    return first_line.startswith(b"#!") and b"sh" in first_line


def _soffice_cmd(
    soffice: str,
    args: list[str],
    *,
    bin_sh_exists: bool | None = None,
    usr_bin_sh: str = "/usr/bin/sh",
) -> list[str]:
    """Build the LibreOffice argv, routing shell wrappers through /usr/bin/sh when /bin/sh is absent."""
    has_bin_sh = os.path.exists("/bin/sh") if bin_sh_exists is None else bin_sh_exists
    if not has_bin_sh and os.path.exists(usr_bin_sh) and _is_shell_wrapper(soffice):
        return [usr_bin_sh, soffice, *args]
    return [soffice, *args]


def soffice_convert(docx_path: Path, out_dir: Path, fmt: str) -> Path | None:
    """Convert a .docx to pdf or rtf via headless LibreOffice with an isolated user profile."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return None
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="career-lo-") as tmp_profile:
        env = dict(os.environ)
        env["HOME"] = tmp_profile
        args = [
            "--headless", "--nologo", "--nodefault", "--nofirststartwizard",
            f"-env:UserInstallation=file://{tmp_profile}",
            "--convert-to", fmt, "--outdir", str(out_dir), str(docx_path),
        ]
        cmd = _soffice_cmd(soffice, args)
        proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=60)
        target = out_dir / f"{docx_path.stem}.{fmt}"
        if proc.returncode == 0 and target.is_file() and target.stat().st_size > 0:
            return target
    return None


def _render_guarded_resume(
    out: Path,
    contact: dict[str, Any] | None,
    resume: dict[str, Any] | None,
    chosen: str,
) -> tuple[Path, Path | None, int, int, bool]:
    """Render Resume_ATS.docx with progressive compaction until <= 2 PDF pages when soffice is present."""
    resume_docx = out / "Resume_ATS.docx"
    resume_pdf: Path | None = None
    pages, winning_tier, soffice_used = 0, 0, False
    with tempfile.TemporaryDirectory(prefix="career-docx-guard-") as tmp_dir:
        tmp = Path(tmp_dir)
        for idx, tier in enumerate(COMPACT_TIERS):
            cand, spec = packet_to_candidate_and_spec(
                contact, resume, omit_extra_competencies=bool(tier.get("omit_extra_competencies")),
            )
            render_resume_docx(cand, spec, resume_docx, family=chosen, overrides=tier)
            winning_tier = idx
            trial_pdf = soffice_convert(resume_docx, tmp, "pdf")
            if trial_pdf is None:
                break
            soffice_used = True
            pages = pdf_page_count(trial_pdf)
            if pages <= 2 or idx == len(COMPACT_TIERS) - 1:
                resume_pdf = out / "Resume_ATS.pdf"
                shutil.copyfile(trial_pdf, resume_pdf)
                break
    return resume_docx, resume_pdf, pages, winning_tier, soffice_used


def build_packet_docx_artifacts(
    outdir: Path | str,
    contact: dict[str, Any] | None,
    resume: dict[str, Any] | None,
    cover: dict[str, Any] | None,
    company: str,
    title: str,
    today: str,
    family: str | None = None,
) -> dict[str, Any]:
    """Build matched Resume_ATS.{docx,rtf,pdf} (<= 2 pages) and CoverLetter.{docx,rtf,pdf}."""
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    chosen = choose_family(title=title, resume_data=resume, requested=family)
    resume_docx, resume_pdf, pages, winning_tier, soffice_used = _render_guarded_resume(out, contact, resume, chosen)
    resume_rtf = soffice_convert(resume_docx, out, "rtf") if soffice_used else None
    cover_docx = cover_rtf = cover_pdf = None
    if cover and (cover.get("paragraphs") or cover.get("greeting")):
        cover_docx = render_cover_docx(contact, cover, company, title, today, out / "CoverLetter.docx", family=chosen)
        if soffice_used:
            cover_pdf = soffice_convert(cover_docx, out, "pdf")
            cover_rtf = soffice_convert(cover_docx, out, "rtf")
    return {
        "family": chosen, "pages": pages, "tier": winning_tier, "soffice_used": soffice_used,
        "resume_docx": str(resume_docx), "resume_rtf": str(resume_rtf) if resume_rtf else None,
        "resume_pdf": str(resume_pdf) if resume_pdf else None,
        "cover_docx": str(cover_docx) if cover_docx else None,
        "cover_rtf": str(cover_rtf) if cover_rtf else None,
        "cover_pdf": str(cover_pdf) if cover_pdf else None,
    }


def _export_parse_cli(app_data: dict[str, Any], out_dir: Path, fmt: str) -> int:
    """Render the parse résumé from a packet's application.json: Word only, no LibreOffice."""
    from . import docx_parse  # docx_parse imports this module, so it is read here, when asked for
    if fmt != "docx":
        print(json.dumps({"ok": False, "error": "the résumé for upload forms is a Word file only"}))
        return 1
    snapshot = app_data.get("profile_snapshot") or {}
    path = docx_parse.render_parse_resume(snapshot.get("profile") or {}, (app_data.get("generated") or {}).get("resume") or {},
                                          out_dir / docx_parse.FILE_NAME, roles=snapshot.get("roles") or [])
    print(json.dumps({"ok": True, "path": str(path), "family": "Parse", "pages": 0}))
    return 0


def _export_packet_cli(args: argparse.Namespace) -> int:
    app_data = json.loads(Path(args.packet_json).read_text(encoding="utf-8"))
    if args.kind == "parse":
        return _export_parse_cli(app_data, Path(args.out_dir), args.format)
    gen = app_data.get("generated") or {}
    snap = (app_data.get("profile_snapshot") or {}).get("profile") or {}
    out_dir = Path(args.out_dir)
    res = build_packet_docx_artifacts(
        out_dir, snap, gen.get("resume") or {}, gen.get("cover") or {},
        str(app_data.get("company") or ""), str(app_data.get("title") or ""),
        "", family=args.family or app_data.get("template_family"),
    )
    key = f"{args.kind}_{args.format}"
    artifact = res.get(key)
    if not artifact or not Path(artifact).is_file():
        print(json.dumps({"ok": False, "error": f"{args.format} artifact unavailable"}))
        return 1
    print(json.dumps({"ok": True, "path": artifact, "family": res["family"], "pages": res["pages"]}))
    return 0


def _export_template_cli(args: argparse.Namespace) -> int:
    fam = normalize_family(args.family) or "Professional"
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    docx_path = render_blank_template(fam, out_dir / f"{fam}_Resume_Template.docx", also_dotx=(args.format == "dotx"))
    target = docx_path.with_suffix(".dotx") if args.format == "dotx" else docx_path
    if args.format == "rtf":
        target = soffice_convert(docx_path, out_dir, "rtf")
    if not target or not Path(target).is_file():
        print(json.dumps({"ok": False, "error": f"{args.format} template unavailable"}))
        return 1
    print(json.dumps({"ok": True, "path": str(target), "family": fam}))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="jobhunter.docx_resume")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("export-packet")
    p1.add_argument("--packet-json", required=True)
    p1.add_argument("--out-dir", required=True)
    p1.add_argument("--kind", choices=("resume", "cover", "parse"), default="resume")
    p1.add_argument("--format", choices=("docx", "rtf", "pdf"), default="docx")
    p1.add_argument("--family", default="")
    p2 = sub.add_parser("export-template")
    p2.add_argument("--out-dir", required=True)
    p2.add_argument("--family", default="Professional")
    p2.add_argument("--format", choices=("docx", "dotx", "rtf"), default="docx")
    ns = parser.parse_args(argv)
    return _export_packet_cli(ns) if ns.cmd == "export-packet" else _export_template_cli(ns)


if __name__ == "__main__":
    sys.exit(main())
