# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.15: deterministic per-skill and total-career experience tenure calculator (non-overlapping date interval union from recorded roles, engagements, and dated additional experience), prompt truth table generator, and cross-section year-contradiction / skill-tenure-inflation detector.
"""Deterministic per-skill and total-career experience tenure calculator."""
from __future__ import annotations

import datetime
import re

from . import claims_check, letter_evidence, role_plan

_SKILL_ALIASES = {
    "j2ee": "java",
    "jakartaee": "java",
    "jee": "java",
    "k8s": "kubernetes",
    "postgres": "postgresql",
    "js": "javascript",
    "ts": "typescript",
    "go": "golang",
}

_SKILL_DISPLAY = {
    **letter_evidence.DISPLAY,
    "java": "Java",
    "python": "Python",
    "typescript": "TypeScript",
    "javascript": "JavaScript",
    "rust": "Rust",
    "abap": "ABAP",
    "sql": "SQL",
    "golang": "Go",
    "kubernetes": "Kubernetes",
    "docker": "Docker",
    "aws": "AWS",
    "azure": "Azure",
    "devops": "DevOps",
    "devsecops": "DevSecOps",
    "sre": "SRE",
    "sap": "SAP",
    "terraform": "Terraform",
    "ansible": "Ansible",
    "linux": "Linux",
    "microservices": "Microservices",
    "scada": "SCADA",
    "plc": "PLC",
    "ai": "AI",
    "llm": "LLM",
    "rag": "RAG",
    "argocd": "Argo CD",
    "gitlab": "GitLab",
    "jenkins": "Jenkins",
    "playwright": "Playwright",
    "splunk": "Splunk",
    "prometheus": "Prometheus",
    "grafana": "Grafana",
    "kafka": "Kafka",
}

_PAREN_YEARS = re.compile(
    r"(?P<before>[^,;:\n()]{1,60})\(\s*(?:(?P<mod>over|more than|nearly|almost|about|around|roughly)\s+)?"
    r"(?P<n>\d{1,2})\s*(?P<plus>\+)?\s*(?:years?|yrs?)\s*\)",
    re.I,
)


def _display_name(term: str) -> str:
    return _SKILL_DISPLAY.get(term) or (term.upper() if len(term) <= 3 else term.title())


def _interval(start_val, end_val, current: bool, today: datetime.date):
    start = role_plan.month(start_val)
    end = (today.year, today.month) if current else role_plan.month(end_val, last=True)
    if not start or not end or end < start:
        return None
    return start[0] * 12 + start[1] - 1, end[0] * 12 + end[1]


def _union_intervals(intervals: list) -> list:
    cleaned = sorted(item for item in intervals if item and item[1] > item[0])
    if not cleaned:
        return []
    merged = [cleaned[0]]
    for start, end in cleaned[1:]:
        prev_s, prev_e = merged[-1]
        if start <= prev_e:
            merged[-1] = (prev_s, max(prev_e, end))
        else:
            merged.append((start, end))
    return merged


def _union_months(intervals: list) -> int:
    return sum(end - start for start, end in _union_intervals(intervals))


def _flat_strings(value) -> list:
    if isinstance(value, dict):
        return [s for v in value.values() for s in _flat_strings(v)]
    if isinstance(value, list):
        return [s for item in value for s in _flat_strings(item)]
    text = str(value or "").strip()
    return [text] if text else []


def _role_texts(role: dict) -> tuple[str, str]:
    prose_parts = _flat_strings(role.get("title")) + _flat_strings(role.get("summary"))
    prose_parts += _flat_strings(role.get("deliverables")) + _flat_strings(role.get("bullets"))
    for story in role.get("stories") or []:
        if isinstance(story, dict):
            prose_parts += _flat_strings([story.get("title"), story.get("bullet"), story.get("story")])
    listed_parts = _flat_strings(role.get("skills")) + _flat_strings(role.get("tags")) + _flat_strings(role.get("tech"))
    return "\n".join(prose_parts), "\n".join(listed_parts)


def _extract_skills(prose: str, listed: str = "") -> set:
    vocab = claims_check.VOCAB | set(_SKILL_ALIASES)
    found = set()
    for text, is_prose in ((prose, True), (listed, False)):
        if not text:
            continue
        for word in claims_check.words(text):
            base = word if word in vocab else word[:-1] if word.endswith("s") and word[:-1] in vocab else None
            if not base:
                continue
            if is_prose and base in claims_check.AMBIGUOUS and not claims_check._named_as_tool(base, text):
                continue
            canon = _SKILL_ALIASES.get(base, base)
            if canon in claims_check.VOCAB:
                found.add(canon)
    expanded = set(found)
    for broader, narrower in claims_check.IMPLIED_BY.items():
        if any(item in found for item in narrower):
            expanded.add(broader)
    return expanded


def _dated_entries(prof: dict, selected, today: datetime.date) -> list:
    rows = []
    for idx, role in enumerate((prof or {}).get("roles") or []):
        if not isinstance(role, dict):
            continue
        current = role_plan.is_current(role)
        span_iv = _interval(role.get("start"), role.get("end"), current, today)
        if not span_iv:
            continue
        prose, listed = _role_texts(role)
        rows.append({
            "key": f"R{idx + 1}",
            "kind": "role",
            "title": str(role.get("title") or "").strip(),
            "org": str(role.get("org") or "").strip(),
            "span": role_plan._span(role, current),
            "current": current,
            "interval": span_iv,
            "skills": _extract_skills(prose, listed),
        })
    effective_selected = selected if selected else (prof or {}).get("additional_experience") or ()
    for entry in letter_evidence.entries(prof, effective_selected):
        if entry["key"][0] == "R":
            continue
        span_iv = _interval(entry.get("start"), entry.get("end"), bool(entry.get("current")), today)
        if not span_iv:
            continue
        rows.append({
            "key": entry["key"],
            "kind": "engagement" if entry["key"][0] == "E" else "additional",
            "title": entry["title"],
            "org": entry["org"],
            "span": role_plan._span(entry, bool(entry.get("current"))),
            "current": bool(entry.get("current")),
            "interval": span_iv,
            "skills": _extract_skills(entry.get("text") or ""),
        })
    return rows


def _recent_entry(row: dict, today: datetime.date) -> bool:
    if row["current"]:
        return True
    end_year = (row["interval"][1] - 1) // 12
    return end_year >= today.year - 5


def _skill_record(skill: str, rows: list, today: datetime.date) -> dict:
    intervals = [row["interval"] for row in rows]
    months = _union_months(intervals)
    years_exact = round(months / 12.0, 1)
    earliest = min(iv[0] // 12 for iv in intervals)
    latest_iv = max(iv[1] for iv in intervals)
    latest = (latest_iv - 1) // 12
    has_current = any(row["current"] for row in rows)
    return {
        "skill": skill,
        "display": _display_name(skill),
        "months": months,
        "years": years_exact,
        "floor_years": months // 12,
        "earliest_year": earliest,
        "latest_year": latest,
        "current": has_current,
        "recent": any(_recent_entry(row, today) for row in rows),
        "roles": [f'{row["key"]} ({row["org"] or row["title"]}, {row["span"]})' for row in rows[:5]],
    }


def compute_tenure(prof: dict, selected=(), today: datetime.date | None = None) -> dict:
    """@description Compute deterministic non-overlapping career and per-skill experience tenure from profile dates.
    @param prof - Candidate career_db profile. @param selected - Optional selected additional_experience.
    @param today - Reference date (defaults to today). @returns Tenure truth table dict."""
    now = today or datetime.date.today()
    entries = _dated_entries(prof or {}, selected, now)
    career_ivs = [row["interval"] for row in entries if row["kind"] in ("role", "engagement")]
    career_months = _union_months(career_ivs)
    by_skill: dict[str, list] = {}
    for row in entries:
        for skill in row["skills"]:
            by_skill.setdefault(skill, []).append(row)
    skills = {skill: _skill_record(skill, rows, now) for skill, rows in sorted(by_skill.items())}
    earliest = min((iv[0] // 12 for iv in career_ivs), default=None)
    latest = max(((iv[1] - 1) // 12 for iv in career_ivs), default=None)
    return {
        "as_of": now.isoformat(),
        "total_career_months": career_months,
        "total_career_years": career_months // 12,
        "total_career_years_exact": round(career_months / 12.0, 1),
        "earliest_year": earliest,
        "latest_year": latest,
        "skills": skills,
    }


def compact_summary(tenure: dict, limit: int = 24) -> dict:
    """@description Compact JSON-safe tenure summary for application.json receipts. @returns Dict."""
    ranked = sorted((tenure.get("skills") or {}).values(), key=lambda item: (-item["months"], item["skill"]))[:limit]
    return {
        "as_of": tenure.get("as_of"),
        "total_career_years": tenure.get("total_career_years", 0),
        "total_career_years_exact": tenure.get("total_career_years_exact", 0.0),
        "earliest_year": tenure.get("earliest_year"),
        "skills": {item["skill"]: item["years"] for item in ranked},
    }


def prompt_block(tenure: dict, posting_terms=frozenset(), max_skills: int = 18) -> str:
    """@description Render the VERIFIED EXPERIENCE TENURE TABLE block for Resume Writer & Reviewer prompts."""
    total = int(tenure.get("total_career_years") or 0)
    skills = tenure.get("skills") or {}
    if total <= 0 and not skills:
        return ""
    earliest = tenure.get("earliest_year")
    span_note = f" ({earliest} to Present)" if earliest else ""
    lines = [
        "\n\nVERIFIED EXPERIENCE TENURE TABLE (deterministic non-overlapping union of recorded role dates):",
        f"- Total career tenure: {total} years{span_note}. Use phrasing like 'over {(total // 5) * 5} years' "
        "or the verified figure for overall technology/career leadership ONLY. NEVER attribute total career years "
        "to an individual programming language or recent tool.",
    ]
    wanted = {(_SKILL_ALIASES.get(t, t)) for t in (posting_terms or ())}
    ordered = sorted(skills.values(), key=lambda s: (0 if s["skill"] in wanted else 1, -s["months"], s["skill"]))
    if ordered:
        lines.append("- Verified per-skill spans (cite at most the verified span; omit year counts when under 2 years):")
        for item in ordered[:max_skills]:
            end_lbl = "Present" if item["current"] else str(item["latest_year"])
            recency = "recent" if item["recent"] else f"earlier roles, ended {item['latest_year']}"
            cap = f"max {item['floor_years']} years" if item["floor_years"] >= 2 else "under 2 years (omit year count)"
            lines.append(f"  * {item['display']}: {item['years']} years ({item['earliest_year']} to {end_lbl}; {recency}) — {cap}")
    lines.append(
        "- STRICT CONSISTENCY RULE: Never state two different year counts for the same skill or for total career "
        "tenure across the headline, summary, and skills section. Never use '+' after any number."
    )
    return "\n".join(lines) + "\n"


def _skills_in_phrase(text: str, vocab) -> list:
    found = []
    for word in claims_check.words(text):
        base = word if word in vocab else word[:-1] if word.endswith("s") and word[:-1] in vocab else None
        if not base:
            continue
        canon = _SKILL_ALIASES.get(base, base)
        if canon in claims_check.VOCAB and canon not in found:
            found.append(canon)
    return found


def _extract_year_claims(section: str, text: str, vocab) -> list:
    claims, paren_spans = [], []
    for match in _PAREN_YEARS.finditer(text):
        val = float(match.group("n")) + (0.5 if match.group("plus") or (match.group("mod") or "").lower() in ("over", "more than") else 0.0)
        bound = _skills_in_phrase(match.group("before"), vocab)
        paren_spans.append((match.start(), match.end()))
        claims.append({"section": section, "phrase": match.group(0).strip(), "years": val,
                       "base": int(match.group("n")), "skills": bound, "text": text})
    for match in [*claims_check._YEARS.finditer(text), *claims_check._DECADE.finditer(text)]:
        if any(s <= match.start() < e for s, e in paren_spans):
            continue
        rest = match.group("rest") or ""
        phrase = text[match.start():match.start("rest")].strip()
        if claims_check._YEARS_NOT_CLAIM.search(text[max(0, match.start() - 12):match.start()]) or re.match(r"\s*(?:ago|old)\b", rest):
            continue
        clause = re.split(r"[,;)]|\b(?:who|that|which|where|while|when|whose|because|since|but|with|for)\b",
                          rest, maxsplit=1, flags=re.I)[0]
        bound = _skills_in_phrase(clause, vocab)
        raw_n = match.group("n").lower()
        unit = (match.groupdict().get("unit") or "decade").lower()
        base = (int(raw_n) if raw_n.isdigit() else claims_check._NUMBER_WORDS.get(raw_n, 1)) * (10 if unit.startswith("decade") else 1)
        claims.append({"section": section, "phrase": phrase, "years": claims_check._claimed_years(match),
                       "base": base, "skills": bound, "text": text})
    return claims


def find_year_contradictions(resume: dict, tenure: dict, rec: dict | None = None) -> list:
    """@description Detect cross-sentence / headline-vs-summary / skills year contradictions and inflated skill years.
    @param resume - Generated resume dict. @param tenure - compute_tenure() output. @param rec - Optional claims_check.records().
    @returns List of issue dicts ({kind, message, details})."""
    vocab = claims_check.VOCAB | set(_SKILL_ALIASES)
    all_claims = []
    if str((resume or {}).get("headline") or "").strip():
        all_claims += _extract_year_claims("headline", str(resume["headline"]), vocab)
    for idx, sentence in enumerate(claims_check.split_sentences(str((resume or {}).get("summary") or ""))):
        all_claims += _extract_year_claims(f"summary[{idx}]", sentence, vocab)
    for idx, item in enumerate((resume or {}).get("skills") or []):
        if isinstance(item, str) and item.strip():
            all_claims += _extract_year_claims(f"skills[{idx}]", item, vocab)
    issues, by_scope = [], {}
    skill_map = tenure.get("skills") or {}
    total_exact = max(float(tenure.get("total_career_years_exact") or 0.0), float((rec or {}).get("stated_career") or 0.0))
    for claim in all_claims:
        scopes = [("skill", s) for s in claim["skills"]] if claim["skills"] else [("career", "career")]
        for scope in scopes:
            by_scope.setdefault(scope, []).append(claim)
            if scope[0] == "skill":
                info = skill_map.get(scope[1])
                stated = float(((rec or {}).get("stated") or {}).get(scope[1], 0))
                supported = max(float(info["years"]) if info else 0.0, stated)
                if (supported > 0 or total_exact > 0) and claim["years"] > supported + 0.5:
                    issues.append({"kind": "skill_tenure_inflation", "section": claim["section"], "skill": scope[1],
                                   "claim": claim["phrase"], "supported": int(supported),
                                   "message": f"{claim['section']} claims '{claim['phrase']}' for {_display_name(scope[1])}, "
                                              f"but verified role dates support {supported:.1f} years."})
            elif total_exact > 0 and claim["years"] > total_exact + 0.5:
                issues.append({"kind": "career_tenure_inflation", "section": claim["section"], "claim": claim["phrase"],
                               "supported": int(total_exact),
                               "message": f"{claim['section']} claims '{claim['phrase']}' overall tenure, "
                                          f"but verified career dates support {total_exact:.1f} years."})
    for scope, group in by_scope.items():
        distinct_bases = sorted({item["base"] for item in group})
        if len(distinct_bases) >= 2:
            label = _display_name(scope[1]) if scope[0] == "skill" else "overall career tenure"
            mentions = ", ".join(f"{item['section']}: '{item['phrase']}'" for item in group[:4])
            issues.append({"kind": "year_contradiction", "scope": scope[1], "values": distinct_bases,
                           "message": f"Conflicting year claims for {label} ({mentions})."})
    return issues
