# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.15: deterministic resume typography normalizer (strips inline <b>/<strong>/** bold and numeric '+' suffixes while preserving C++, Security+, A+, etc.), deterministic post-checks/auditor, and thin Career worker rail client invoking the dynamically-loaded career-resume-reviewer Swarm bot (personas/career-resume-reviewer.yaml, cb000000-0000-0000-0000-000000000006) with 1-shot targeted repair and structured application.json receipt.
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.76.1 (Roger, 2026-11-25: the job page said "Conflicting year claims for Java (summary: '2 years')" on a résumé whose final summary said 11 years): the review receipt records which remaining items its own checks found (deterministic_remaining), and settle() judges those again on the final packet after the years and term passes, so the page names only what the sent résumé still holds.
"""Deterministic resume normalizer, auditor, and rail client for the career-resume-reviewer Swarm bot."""
from __future__ import annotations

import copy
import functools
import json
import re
import sys
from pathlib import Path

from . import claims_check, claims_fix, config, enrich, role_plan, skill_tenure

VERSION = 1
REVIEWER_BOT = "career-resume-reviewer"
_DEFAULT_RUBRIC_VERSION = "1.0.0"
_PERSONA_PATH = Path(__file__).resolve().parents[2] / "personas" / "career-resume-reviewer.yaml"
_MAX_REVIEW_PROMPT_BYTES = 56000

_RUBRIC_VERSION_RE = re.compile(r"Rubric Version:\s*([0-9A-Za-z._-]+)")
_HTML_BOLD_RE = re.compile(r"</?(?:b|strong)(?:\s[^>]*)?>", re.I)
_MD_BOLD_RE = re.compile(r"(?<![A-Za-z0-9_])\*\*([^*\n]+?)\*\*(?![A-Za-z0-9_])")
_MD_UNDER_RE = re.compile(r"(?<!\w)__([^_\n]*\s[^_\n]*?)__(?!\w)")

_PRIOR_QUAL = r"(?:over|more than|exceeding|at least|up to|nearly|almost|about|around|roughly|to|from)"
_CURRENCY_PLUS_RE = re.compile(
    r"(?P<pre>\b" + _PRIOR_QUAL + r"\s+)?(?P<val>\$\s?\d[\d,]*(?:\.\d+)?\s?[KMB]?)\+(?![A-Za-z0-9+])"
)
_PERCENT_PLUS_RE = re.compile(
    r"(?P<pre>\b(?:" + _PRIOR_QUAL + r"|by)\s+)?(?P<val>\d[\d,]*(?:\.\d+)?%)\+(?![A-Za-z0-9+])",
    re.I,
)
_HYPHEN_PLUS_RE = re.compile(r"(\b\d[\d,]*(?:\.\d+)?)\+(?=-)")
_PAREN_YEARS_PLUS_RE = re.compile(r"\((\s*\d{1,2})\+(\s*(?:years?|yrs?)\s*)\)", re.I)
_YEARS_PLUS_RE = re.compile(
    r"(?P<pre>\b" + _PRIOR_QUAL + r"\s+)?(?P<num>\b\d{1,2})\+(?P<unit>\s*(?:years?|yrs?)\b)",
    re.I,
)
_MAG_PLUS_RE = re.compile(r"(?P<val>\b\d[\d,]*(?:\.\d+)?[KMB])\+(?![A-Za-z0-9+])")
_PLAIN_NUM_PLUS_RE = re.compile(r"(?P<val>\b\d[\d,]*(?:\.\d+)?)\+(?![A-Za-z0-9+])")
_AUDIT_NUMERIC_PLUS_RE = re.compile(
    r"(?:\$\s?\d[\d,]*(?:\.\d+)?\s?[KMB]?|\b\d[\d,]*(?:\.\d+)?(?:%|[KMB])?)\+(?![A-Za-z0-9+])"
)

_AI_CLICHES = (
    "proven track record",
    "rare combination",
    "results-driven",
    "seasoned visionary",
    "uniquely positioned",
    "dynamic leader",
    "passionate self-starter",
    "drove synergies",
    "synergies",
    "thought leader",
    "go-getter",
    "outside the box",
)
_CLICHE_RE = re.compile(r"\b(?:" + "|".join(re.escape(c) for c in _AI_CLICHES) + r")\b", re.I)
_STAT_RE = re.compile(
    r"(?:\$\s?\d[\d,]*(?:\.\d+)?\s?[KMB]?|\b\d[\d,]*(?:\.\d+)?%|\b\d[\d,]*-person\b|\b\d[\d,]+\b)",
    re.I,
)


@functools.lru_cache(maxsize=1)
def _persona_text() -> str:
    """Read the declared career-resume-reviewer persona YAML once as the single source of truth."""
    return _PERSONA_PATH.read_text(encoding="utf-8") if _PERSONA_PATH.is_file() else ""


def rubric_version() -> str:
    """@description Version declared inside personas/career-resume-reviewer.yaml. @returns Semver string."""
    match = _RUBRIC_VERSION_RE.search(_persona_text())
    return match.group(1) if match else _DEFAULT_RUBRIC_VERSION


def _standalone_perspective() -> str:
    """Extract perspective text from personas/career-resume-reviewer.yaml for non-rail standalone runs."""
    raw = _persona_text()
    marker = "\nperspective: |\n"
    if marker not in raw:
        return ""
    body = raw.split(marker, 1)[1]
    lines = []
    for line in body.splitlines():
        if line and not line.startswith("  "):
            break
        lines.append(line[2:] if line.startswith("  ") else "")
    return "\n".join(lines).strip()


def strip_inline_bold(text: str) -> str:
    """@description Remove stray HTML <b>/<strong> tags and markdown **...**/__...__ bold wrappers."""
    if not isinstance(text, str) or not text:
        return text
    value = _HTML_BOLD_RE.sub("", text)
    value = _MD_BOLD_RE.sub(r"\1", value)
    value = _MD_UNDER_RE.sub(r"\1", value)
    return value


def _replace_currency_plus(match: re.Match) -> str:
    pre, val = match.group("pre") or "", match.group("val")
    return f"{pre}{val}" if pre else f"over {val}"


def _replace_percent_plus(match: re.Match) -> str:
    pre, val = match.group("pre") or "", match.group("val")
    if pre and pre.strip().lower() == "by":
        return f"{pre}over {val}"
    return f"{pre}{val}" if pre else f"over {val}"


def _replace_years_plus(match: re.Match) -> str:
    pre, num, unit = match.group("pre") or "", match.group("num"), match.group("unit")
    if pre:
        return f"{pre}{num}{unit}"
    before = match.string[:match.start()].rstrip()
    at_start = not before or before[-1] in ".!?:;"
    return f"{'Over' if at_start else 'over'} {num}{unit}"


def strip_numeric_plus(text: str) -> str:
    """@description Replace numeric '+' suffixes with clean executive phrasing while preserving C++, Security+, A+, etc."""
    if not isinstance(text, str) or "+" not in text:
        return text
    value = _CURRENCY_PLUS_RE.sub(_replace_currency_plus, text)
    value = _PERCENT_PLUS_RE.sub(_replace_percent_plus, value)
    value = _HYPHEN_PLUS_RE.sub(r"\1", value)
    value = _PAREN_YEARS_PLUS_RE.sub(r"(\1\2)", value)
    value = _YEARS_PLUS_RE.sub(_replace_years_plus, value)
    value = _MAG_PLUS_RE.sub(r"\g<val>", value)
    value = _PLAIN_NUM_PLUS_RE.sub(r"\g<val>", value)
    return re.sub(r"[ \t]{2,}", " ", value)


def normalize_text(text: str) -> str:
    """@description Strip inline bold wrappers and disallowed numeric '+' suffixes from one text value."""
    if not isinstance(text, str) or not text:
        return text
    return strip_numeric_plus(strip_inline_bold(text))


def normalize_packet(obj):
    """@description Recursively normalize inline bold and numeric '+' suffixes across a resume/cover JSON structure."""
    if isinstance(obj, str):
        return normalize_text(obj)
    if isinstance(obj, list):
        return [normalize_packet(item) for item in obj]
    if isinstance(obj, dict):
        return {key: normalize_packet(val) for key, val in obj.items()}
    return obj


def _resume_text_segments(resume: dict) -> list:
    out = []
    for key in ("headline", "summary", "clearance"):
        val = str((resume or {}).get(key) or "").strip()
        if val:
            out.append((key, val))
    for field in ("competencies", "skills", "certifications", "education"):
        for idx, item in enumerate((resume or {}).get(field) or []):
            if isinstance(item, str) and item.strip():
                out.append((f"{field}[{idx}]", item))
    for sec in ("experience", "open_source", "additional_experience"):
        for r_idx, entry in enumerate((resume or {}).get(sec) or []):
            if not isinstance(entry, dict):
                continue
            for b_idx, bullet in enumerate(entry.get("bullets") or []):
                if isinstance(bullet, str) and bullet.strip():
                    out.append((f"{sec}[{r_idx}].bullets[{b_idx}]", bullet))
    return out


def _audit_summary(summary: str) -> list:
    issues = []
    clean = str(summary or "").strip()
    if not clean:
        return [{"kind": "summary_length", "section": "summary", "message": "Executive summary is empty."}]
    sentences = claims_check.split_sentences(clean)
    word_count = len(clean.split())
    if word_count > 150 or len(sentences) > 5:
        issues.append({"kind": "summary_length", "section": "summary",
                       "message": f"Summary is too long ({word_count} words, {len(sentences)} sentences); target 3-4 crisp sentences (~65-100 words)."})
    seen_stats: dict[str, int] = {}
    for idx, sent in enumerate(sentences):
        for match in _STAT_RE.finditer(sent):
            token = re.sub(r"\s+", "", match.group(0)).lower()
            if re.fullmatch(r"(?:19|20)\d{2}", token):
                continue
            if token in seen_stats and seen_stats[token] != idx:
                issues.append({"kind": "summary_repeated_stat", "section": f"summary[{idx}]", "stat": match.group(0),
                               "message": f"Summary repeats metric '{match.group(0)}' across multiple sentences."})
            else:
                seen_stats[token] = idx
    return issues


def _audit_duplicate_bullets(resume: dict) -> list:
    issues = []
    for sec in ("experience", "open_source", "additional_experience"):
        for r_idx, entry in enumerate((resume or {}).get(sec) or []):
            if not isinstance(entry, dict):
                continue
            seen = set()
            for b_idx, bullet in enumerate(entry.get("bullets") or []):
                norm = re.sub(r"[^a-z0-9]+", " ", str(bullet or "").lower()).strip()
                if len(norm) >= 20 and norm in seen:
                    issues.append({"kind": "duplicate_bullet", "section": f"{sec}[{r_idx}].bullets[{b_idx}]",
                                   "message": f"Duplicate bullet in {entry.get('org') or sec}[{r_idx}]."})
                seen.add(norm)
    return issues


def audit_resume(resume: dict, tenure: dict, rec: dict | None = None) -> list:
    """@description Deterministic executive/ATS post-check of an assembled resume.
    @param resume - Generated resume dict. @param tenure - skill_tenure.compute_tenure() dict.
    @param rec - Optional claims_check.records() dict. @returns List of issue dicts."""
    issues = []
    for section, text in _resume_text_segments(resume or {}):
        if _HTML_BOLD_RE.search(text) or _MD_BOLD_RE.search(text) or _MD_UNDER_RE.search(text):
            issues.append({"kind": "inline_bold", "section": section,
                           "message": f"{section} contains stray inline bold markup."})
        plus_hits = _AUDIT_NUMERIC_PLUS_RE.findall(text)
        if plus_hits:
            issues.append({"kind": "numeric_plus", "section": section, "matches": plus_hits[:5],
                           "message": f"{section} contains disallowed '+' numeric suffix ({', '.join(plus_hits[:3])})."})
        cliche = _CLICHE_RE.search(text)
        if cliche:
            issues.append({"kind": "ai_cliche", "section": section, "phrase": cliche.group(0),
                           "message": f"{section} uses banned cliché '{cliche.group(0)}'."})
    issues += skill_tenure.find_year_contradictions(resume or {}, tenure or {}, rec)
    issues += _audit_summary(str((resume or {}).get("summary") or ""))
    issues += _audit_duplicate_bullets(resume or {})
    return issues


def _review_payload(resume: dict, posting: dict, prof_doc: dict, tenure: dict,
                    det_issues: list, repair_mode: bool = False) -> str:
    """Build bounded review input for the dynamically-loaded career-resume-reviewer Swarm bot (<= 56 KiB)."""
    title, company = posting.get("title") or "", posting.get("company") or ""
    jd = (posting.get("description") or "(none)")[:8000]
    tenure_text = skill_tenure.prompt_block(tenure, claims_check.posting_terms(title, jd))
    issue_lines = "\n".join(f"- {item['message']}" for item in det_issues) if det_issues else "- (none detected deterministically)"
    mode = (
        "REPAIR PASS (mandatory): Rewrite ONLY the affected sections of the resume below into clean, cohesive "
        "executive prose that eliminates EVERY issue listed above. Return revised_resume with the full resume object."
        if repair_mode else
        "FINAL PRE-RETURN AUDIT: Review the assembled resume below against your playbook and the Verified "
        "Experience Tenure Table. If ANY issue exists, set passed=false and return a clean revised_resume."
    )
    resume_json = json.dumps(resume, ensure_ascii=False, indent=1)
    head = (
        f"{mode}\n\nTARGET ROLE: {title} at {company}\nJOB DESCRIPTION:\n{jd}\n"
        f"{tenure_text}\nDETERMINISTIC AUDIT FINDINGS:\n{issue_lines}\n\n"
    )
    tail = f"\n\nASSEMBLED RESUME TO REVIEW:\n{resume_json}\n"
    budget = max(2000, _MAX_REVIEW_PROMPT_BYTES - len(head.encode("utf-8")) - len(tail.encode("utf-8")) - 120)
    profile_json = json.dumps(prof_doc, ensure_ascii=False, separators=(",", ":"))[:budget]
    return f"{head}CANDIDATE PROFILE (source of truth; never invent beyond this):\n{profile_json}{tail}"


def _invoke_reviewer_bot(resume: dict, posting: dict, prof_doc: dict, tenure: dict,
                         det_issues: list, repair_mode: bool, complete_fn) -> dict | None:
    """Dispatch the review turn to the declared career-resume-reviewer Swarm bot via the worker rail."""
    # On the OSHAL worker rail, oshald injects personas/career-resume-reviewer.yaml as the bot's system prompt.
    system = "" if config.MULTIUSER else _standalone_perspective()
    prompt = _review_payload(resume, posting, prof_doc, tenure, det_issues, repair_mode)
    try:
        raw = complete_fn(system, prompt, max_tokens=6000, bot=REVIEWER_BOT)
        parsed = enrich.parse_json(raw)
    except Exception:
        import traceback
        print("career resume reviewer bot call failed:\n" + traceback.format_exc(limit=3), file=sys.stderr, flush=True)
        return None
    if not isinstance(parsed, dict) or not isinstance(parsed.get("passed"), bool):
        return None
    return parsed


def _usable_revised(candidate, original: dict) -> dict | None:
    if not isinstance(candidate, dict):
        return None
    if not str(candidate.get("summary") or "").strip() or not isinstance(candidate.get("experience"), list):
        return None
    merged = copy.deepcopy(original)
    for key in ("headline", "summary", "competencies", "experience", "skills",
                "certifications", "education", "clearance", "open_source", "additional_experience"):
        if key in candidate and candidate[key] is not None:
            merged[key] = candidate[key]
    return merged


def _guard_revised(revised: dict, data: dict, prof_doc: dict, selected, posting: dict,
                   roles: list, embargo: tuple, ranked: list, today) -> dict:
    """Re-apply deterministic normalization, required roles, and claims verification to a revised resume."""
    cleaned = normalize_packet(revised)
    role_plan.carry(cleaned, roles, prof_doc, embargo)
    trial = {"resume": cleaned, "cover": data.get("cover") or {}}
    job = {"title": posting.get("title") or "", "company": posting.get("company") or "",
           "terms": claims_check.posting_terms(posting.get("title") or "", posting.get("description") or "")}
    rec = claims_check.records(prof_doc, selected, job["terms"], today)
    problems = [p for p in claims_check.check(trial, rec, job, ranked) if p["document"] == "resume"]
    if problems:
        fixed, _actions = claims_fix.fix(trial, problems, rec, job, claims_check.allowed(rec, ranked), prof_doc)
        cleaned = normalize_packet(fixed["resume"])
    return cleaned


def _dedup_messages(items: list) -> list:
    out = []
    for item in items:
        msg = str(item.get("message") if isinstance(item, dict) else item or "").strip()
        if msg and msg not in out:
            out.append(msg)
    return out


def _normalize_diff_messages(before: dict, after: dict) -> list:
    notes = []
    raw_before = json.dumps(before, ensure_ascii=False)
    raw_after = json.dumps(after, ensure_ascii=False)
    if raw_before != raw_after:
        if _HTML_BOLD_RE.search(raw_before) or _MD_BOLD_RE.search(raw_before):
            notes.append("Removed stray inline bold formatting from resume copy.")
        if _AUDIT_NUMERIC_PLUS_RE.search(raw_before):
            notes.append("Removed '+' suffixes from years and numeric quantities.")
    return notes


def _run_reviewer_bot(out: dict, prof_doc: dict, selected, posting: dict,
                      roles: list, embargo: tuple, ranked: list, tenure: dict, rec: dict,
                      det_initial: list, today, caller) -> tuple[int, bool, list, str]:
    """Run the career-resume-reviewer Swarm bot audit and at most 1 targeted repair pass."""
    verdict = _invoke_reviewer_bot(out["resume"], posting, prof_doc, tenure, det_initial, False, caller)
    if verdict is None:
        return 1, False, [], ""
    notes = str(verdict.get("reviewer_notes") or "").strip()[:300]
    llm_issues = _dedup_messages(verdict.get("issues") or [])
    revised = _usable_revised(verdict.get("revised_resume"), out["resume"])
    if revised is not None and (not verdict["passed"] or det_initial):
        out["resume"] = _guard_revised(revised, out, prof_doc, selected, posting, roles, embargo, ranked, today)
        det_after = audit_resume(out["resume"], tenure, rec)
    else:
        det_after = det_initial
    if (not verdict["passed"] and revised is None) or det_after:
        repair_issues = det_after or [{"message": msg} for msg in llm_issues]
        repair = _invoke_reviewer_bot(out["resume"], posting, prof_doc, tenure, repair_issues, True, caller)
        if repair is not None:
            notes = str(repair.get("reviewer_notes") or notes).strip()[:300]
            repaired = _usable_revised(repair.get("revised_resume"), out["resume"])
            if repaired is not None:
                out["resume"] = _guard_revised(repaired, out, prof_doc, selected, posting, roles, embargo, ranked, today)
        return 2, True, llm_issues, notes
    return 1, True, llm_issues, notes


def review_resume(data: dict, prof_doc: dict, selected, posting: dict, roles: list,
                  embargo: tuple, ranked: list, today=None, complete_fn=None) -> tuple[dict, dict]:
    """@description Mandatory Pre-Return Resume Review: deterministic normalize + audit, dispatch to the declared
    career-resume-reviewer Swarm bot (with at most 1 targeted prose repair pass), safety re-verification, and
    structured receipt for application.json. @returns (updated data dict, resume_review receipt dict)."""
    out = copy.deepcopy(data)
    raw_resume = copy.deepcopy(out.get("resume") or {})
    norm_resume = normalize_packet(raw_resume)
    out["resume"] = norm_resume
    job_terms = claims_check.posting_terms(posting.get("title") or "", posting.get("description") or "")
    rec = claims_check.records(prof_doc, selected, job_terms, today)
    tenure = skill_tenure.compute_tenure(prof_doc, selected, today)
    det_initial = audit_resume(out["resume"], tenure, rec)
    issues_found = _normalize_diff_messages(raw_resume, norm_resume) + _dedup_messages(det_initial)
    caller = complete_fn if complete_fn is not None else enrich.complete
    attempts, bot_reviewed, llm_issues, notes = _run_reviewer_bot(
        out, prof_doc, selected, posting, roles, embargo, ranked, tenure, rec, det_initial, today, caller)
    issues_found = _dedup_messages(issues_found + llm_issues)
    remaining = _dedup_messages(audit_resume(out["resume"], tenure, rec))
    if bot_reviewed and attempts == 2 and not remaining and out["resume"] == norm_resume and llm_issues:
        remaining = llm_issues
    fixed = [msg for msg in issues_found if msg not in remaining]
    status = "passed" if not remaining else "needs_review"
    notes = notes or ("Resume passed automated executive and ATS quality review."
                      if status == "passed" else "Resume has unresolved quality items that need review.")
    receipt = {
        "deterministic_remaining": [msg for msg in remaining if msg in _dedup_messages(audit_resume(out["resume"], tenure, rec))][:20],
        "version": VERSION, "bot": REVIEWER_BOT, "rubric_version": rubric_version(), "status": status,
        "attempts": attempts, "llm_reviewed": bot_reviewed, "issues_found": issues_found[:30],
        "issues_fixed": fixed[:30], "remaining_issues": remaining[:20],
        "skill_tenure": skill_tenure.compact_summary(tenure), "reviewer_notes": notes,
    }
    return out, receipt


def settle(receipt: dict, data: dict, prof_doc: dict, selected, posting: dict, today=None) -> dict:
    """@description Judge the review's own checks again on the final packet. The years pass (years_truth.enforce) and
    the term pass run after review_resume, so an item the review found in the draft ("Conflicting year claims for
    Java") may be gone from what is sent; an item the reviewer bot raised stays, and a check that now fails is added.
    @param receipt - review_resume()'s receipt. @param data - The final packet. @param prof_doc - The person's profile.
    @param selected - Additional experience chosen for the packet. @param posting - {title, company, description}.
    @param today - Date override for tests. @returns The receipt, judged on the final packet."""
    if not isinstance(receipt, dict) or not isinstance((data or {}).get("resume"), dict):
        return receipt
    job_terms = claims_check.posting_terms(posting.get("title") or "", posting.get("description") or "")
    rec = claims_check.records(prof_doc, selected, job_terms, today)
    tenure = skill_tenure.compute_tenure(prof_doc, selected, today)
    final = _dedup_messages(audit_resume(data["resume"], tenure, rec))
    ours = set(receipt.get("deterministic_remaining") or [])
    before = list(receipt.get("remaining_issues") or [])
    remaining = [msg for msg in before if msg not in ours or msg in final] + [msg for msg in final if msg not in before]
    out = dict(receipt)
    out["remaining_issues"] = remaining[:20]
    out["deterministic_remaining"] = [msg for msg in final][:20]
    out["issues_fixed"] = (list(receipt.get("issues_fixed") or []) + [msg for msg in before if msg not in remaining])[:30]
    out["status"] = "passed" if not remaining else "needs_review"
    if out["status"] != receipt.get("status"):
        out["reviewer_notes"] = ("Resume passed automated executive and ATS quality review." if out["status"] == "passed"
                                 else "Resume has unresolved quality items that need review.")
    return out
