"""Loads the user's career_db.json and renders a compact profile for prompts."""
from __future__ import annotations
import json
import os
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from . import config


@lru_cache(maxsize=1)
def load() -> dict:
    if not config.CAREER_DB.exists():
        return {}
    return json.loads(config.CAREER_DB.read_text(encoding="utf-8"))


def summary(max_chars: int = 3500, include_oshal: bool = False) -> str:
    """A dense plain-text profile for AI scoring/generation prompts.

    include_oshal=True appends the user's independent open-source / R&D work (the
    `oss_portfolio` block) so the scorer credits their
    hands-on agentic / LLM / MCP / RAG depth. This is used for SCORING (private,
    never shown to an employer); resume/cover generation gates it separately. The
    OSHAL block is appended AFTER the base truncation so it always survives.
    """
    d = load()
    if not d:
        return "No career profile found."
    p = d.get("profile", {})
    lines = [f"CANDIDATE: {p.get('name','')} ({p.get('credential','')}) — {p.get('location','')}",
             f"Clearance: {p.get('clearance','')}; {p.get('citizenship','')}",
             f"Summary: {p.get('experience_summary','')}", ""]
    lines.append("EXPERIENCE:")
    for r in d.get("roles", [])[:12]:
        span = f"{r.get('start','')}–{r.get('end') or 'present'}"
        lines.append(f"- {r.get('title','')} @ {r.get('org','')} ({span})")
        for b in (r.get("deliverables") or [])[:3]:
            lines.append(f"    • {b}")
    skills = d.get("skills", {})
    flat = []
    for g in skills.values():
        flat.extend(g.get("items", []))
    lines.append("\nSKILLS: " + ", ".join(flat[:60]))
    lines.append("\nMETRICS: " + " | ".join(d.get("metrics_bank", [])[:8]))
    certs = d.get("certifications", [])
    if certs:
        lines.append("\nCERTS: " + ", ".join(certs))
    text = "\n".join(lines)[:max_chars]
    if include_oshal:
        oss = d.get("oss_portfolio") or {}
        blurb = oss.get("scoring_blurb")
        if blurb:
            extra = "\n\n" + blurb
            oss_skills = oss.get("skills") or []
            if oss_skills:
                extra += "\nOSS SKILLS: " + ", ".join(oss_skills)
            text += extra
    return text


_ENH_SYS = (
    "You maintain a candidate's structured career database. You merge NEW, candidate-confirmed "
    "TRUE facts into it NON-DESTRUCTIVELY and conservatively. Never invent facts beyond what the "
    "candidate states, never remove or weaken existing content, never exaggerate. Prefer adding to "
    "an EXISTING skill group or role rather than creating new ones. Return ONLY a strict JSON patch "
    "of ADDITIONS.")


def _low(xs):
    return {str(x).strip().lower() for x in xs}


def augment(facts: str) -> dict:
    """Merge candidate-provided TRUE facts into career_db.json so future tailoring can
    *pull* them. Backs up first, applies an AI-proposed ADD-ONLY patch deterministically
    in Python (so nothing existing is lost), writes atomically, and clears the cache.
    Returns {"changelog": [...]}. No-ops (and writes nothing) if there's nothing to add.
    """
    from . import enrich
    facts = (facts or "").strip()
    if not facts:
        return {"changelog": []}
    text = config.CAREER_DB.read_text(encoding="utf-8")
    raw = json.loads(text)

    groups = {g: (raw.get("skills", {}).get(g, {}) or {}).get("items", []) for g in raw.get("skills", {})}
    roles = raw.get("roles", [])
    ctx = (
        "CURRENT SKILL GROUPS (name: sample items):\n"
        + "\n".join(f"- {g}: {', '.join(items[:8])}" for g, items in groups.items())
        + "\n\nROLES (index | title @ org):\n"
        + "\n".join(f"{i} | {r.get('title','')} @ {r.get('org','')}" for i, r in enumerate(roles))
        + "\n\nNEW CANDIDATE-CONFIRMED FACTS TO MERGE:\n" + facts
        + "\n\nReturn STRICT JSON only:\n{\n"
        '  "skills_add": {"<existing group name, or a concise new group>": ["skill phrase", ...]},\n'
        '  "role_bullets_add": [{"role_index": <int from the list above — the BEST-matching role>, '
        '"bullets": ["achievement bullet, active voice, quantified only if the facts support it"]}],\n'
        '  "metrics_add": ["quantified metric phrase, only if the facts include one"],\n'
        '  "changelog": ["short human-readable line per addition"]\n}\n'
        "Only include additions clearly supported by the facts; do not duplicate existing content."
    )
    patch = enrich.parse_json(enrich.complete(_ENH_SYS, ctx, max_tokens=1500)) or {}

    changed, changelog = False, list(patch.get("changelog") or [])
    skills = raw.setdefault("skills", {})
    for g, items in (patch.get("skills_add") or {}).items():
        if not items:
            continue
        grp = skills.setdefault(g, {"items": []})
        grp.setdefault("items", [])
        have = _low(grp["items"])
        for it in items:
            if it and it.strip().lower() not in have:
                grp["items"].append(it.strip()); have.add(it.strip().lower()); changed = True
    for rb in (patch.get("role_bullets_add") or []):
        idx, bullets = rb.get("role_index"), (rb.get("bullets") or [])
        if isinstance(idx, int) and 0 <= idx < len(roles) and bullets:
            dl = roles[idx].setdefault("deliverables", [])
            have = _low(dl)
            for b in bullets:
                if b and b.strip().lower() not in have:
                    dl.append(b.strip()); have.add(b.strip().lower()); changed = True
    mb = raw.setdefault("metrics_bank", [])
    have = _low(mb)
    for m in (patch.get("metrics_add") or []):
        if m and m.strip().lower() not in have:
            mb.append(m.strip()); have.add(m.strip().lower()); changed = True

    if not changed:
        return {"changelog": changelog}

    # backup original, then atomic write
    bdir = config.CAREER_DB.parent / "backups"
    bdir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    (bdir / f"career_db.{stamp}.json").write_text(text, encoding="utf-8")
    tmp = config.CAREER_DB.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(raw, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, config.CAREER_DB)

    # audit log + drop the cache so the next load()/generate sees the new data
    try:
        with (config.CAREER_DB.parent / "enrichment_log.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"at": stamp, "facts": facts, "changelog": changelog}) + "\n")
    except Exception:
        pass
    load.cache_clear()
    return {"changelog": changelog}


# ── Resume ingest — build a NEW user's career_db.json from their uploaded resume ──
_INGEST_SYS = (
    "You convert a candidate's resume into a STRICT, structured career database as JSON. "
    "Use ONLY facts stated in the resume — never invent employers, dates, titles, metrics, "
    "clearances, or certifications. If the resume does not state something, leave it empty or omit it. "
    "Do not exaggerate. Return JSON only, no prose.")


def has_profile() -> bool:
    """True once the user has an indexed resume (a non-trivial career_db.json)."""
    try:
        if not config.CAREER_DB.exists():
            return False
        d = json.loads(config.CAREER_DB.read_text(encoding="utf-8"))
        return bool(d.get("roles") or (d.get("profile", {}) or {}).get("experience_summary"))
    except Exception:
        return False


def _extract_resume_text(file_path: str) -> str:
    """Pull plain text from a PDF/DOCX/txt resume."""
    p = file_path.lower()
    if p.endswith(".pdf"):
        from pypdf import PdfReader  # pure-python, in the image deps (Dockerfile.oshal)
        reader = PdfReader(file_path)
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    if p.endswith(".docx"):
        import docx  # python-docx (pure-python, uses lxml already installed)
        d = docx.Document(file_path)
        return "\n".join(par.text for par in d.paragraphs)
    return Path(file_path).read_text(encoding="utf-8", errors="ignore")


def build_from_resume(file_path: str) -> dict:
    """Parse an uploaded resume and write THIS user's career_db.json (the profile the
    scorer/generator read). Multi-tenant: config.CAREER_DB is the per-user path set by
    the oshal-jobhunter shim, so this never touches another user's profile.
    Returns {ok, roles, skills} or {ok:False, error}."""
    from . import enrich
    try:
        text = (_extract_resume_text(file_path) or "").strip()
    except Exception as exc:
        return {"ok": False, "error": f"could not read resume: {exc}"}
    if len(text) < 40:
        return {"ok": False, "error": "no readable text in the resume"}
    text = text[:24000]

    prompt = (
        "RESUME:\n" + text + "\n\n"
        "Return STRICT JSON only, exactly this shape:\n"
        "{\n"
        '  "profile": {"name":"","credential":"","location":"","clearance":"","citizenship":"","experience_summary":""},\n'
        '  "roles": [{"title":"","org":"","start":"YYYY-MM","end":"YYYY-MM or null","deliverables":["achievement bullet, active voice"]}],\n'
        '  "skills": {"<concise group name>": {"items": ["skill phrase"]}},\n'
        '  "metrics_bank": ["quantified achievement — only if the resume states a number"],\n'
        '  "certifications": ["certification name"]\n'
        "}\n"
        "experience_summary = a 2-3 sentence professional summary. Use only facts in the resume."
    )
    data = enrich.parse_json(enrich.complete(_INGEST_SYS, prompt, max_tokens=4000)) or {}
    if not isinstance(data, dict) or not (data.get("roles") or data.get("profile")):
        return {"ok": False, "error": "could not parse a profile from the resume"}

    data.setdefault("profile", {})
    data.setdefault("roles", [])
    data.setdefault("skills", {})
    data.setdefault("metrics_bank", [])
    data.setdefault("certifications", [])

    config.CAREER_DB.parent.mkdir(parents=True, exist_ok=True)
    tmp = config.CAREER_DB.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, config.CAREER_DB)
    load.cache_clear()
    return {
        "ok": True,
        "roles": len(data.get("roles", [])),
        "skills": sum(len((g or {}).get("items", [])) for g in data.get("skills", {}).values()),
    }


# ── Absorb an arbitrary career artifact (email, LinkedIn export, status report, work sample) ──
# The conversational career agent lets a user add MORE than a resume: it extracts TRUE facts from
# the artifact and merges them via augment() (non-destructive, backed up, audited). This is the
# non-resume sibling of build_from_resume — it never rebuilds/overwrites the profile.
_ABSORB_SYS = (
    "You extract ONLY TRUE, verifiable career facts about the candidate from an uploaded document. "
    "List concrete facts they can stand behind: roles/titles/employers/dates, skills and tools they "
    "actually used, responsibilities, and quantified achievements STATED in the document. Never invent, "
    "never infer beyond what is written, never add aspirational or third-party facts. If the document "
    "has nothing about the candidate's own career, return an empty list. Output a plain bullet list.")

_ARTIFACT_KINDS = {"resume-extra", "linkedin-export", "email", "status-report", "work-sample", "other"}


def _extract_artifact_text(file_path: str) -> str:
    """Plain text from a career artifact — reuses the resume extractor, adds csv/eml/html/json and
    the LinkedIn 'Download your data' zip (Positions/Profile/Skills/... members)."""
    p = file_path.lower()
    if p.endswith((".pdf", ".docx", ".txt", ".md")):
        return _extract_resume_text(file_path)
    if p.endswith(".zip"):
        import zipfile
        keep = ("position", "profile", "skill", "education", "project", "certification", "experience")
        out = []
        with zipfile.ZipFile(file_path) as z:
            for n in z.namelist():
                low = n.lower()
                if low.endswith((".csv", ".txt")) and any(k in low for k in keep):
                    try:
                        out.append(f"### {n}\n" + z.read(n).decode("utf-8", "ignore"))
                    except Exception:
                        pass
        return "\n\n".join(out)
    # csv / tsv / html / eml / json / log and anything else — read as text
    return Path(file_path).read_text(encoding="utf-8", errors="ignore")


def absorb(file_path: str, kind: str = "other") -> dict:
    """Absorb an uploaded career artifact into the profile: extract TRUE facts, then merge via
    augment() (add-only, backed up, audited to enrichment_log.jsonl). Requires an existing profile
    (upload a resume first). Returns {ok, kind, changelog} or {ok:False, error}."""
    from . import enrich
    if not has_profile():
        return {"ok": False, "error": "no career profile yet — upload a resume first, then add artifacts"}
    kind = kind if kind in _ARTIFACT_KINDS else "other"
    try:
        text = (_extract_artifact_text(file_path) or "").strip()
    except Exception as exc:
        return {"ok": False, "error": f"could not read artifact: {exc}"}
    if len(text) < 20:
        return {"ok": False, "error": "no readable text in the artifact"}
    prompt = (f"DOCUMENT KIND: {kind}\n\nDOCUMENT:\n{text[:24000]}\n\n"
              "List the candidate's TRUE career facts from this document (one per line).")
    facts = (enrich.complete(_ABSORB_SYS, prompt, max_tokens=1200) or "").strip()
    if len(facts) < 10:
        return {"ok": True, "kind": kind, "changelog": [], "note": "no new career facts found"}
    res = augment(facts)
    return {"ok": True, "kind": kind, "changelog": res.get("changelog", [])}
