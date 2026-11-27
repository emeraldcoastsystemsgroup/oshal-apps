# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Authoritative candidate-confirmed skill and total-career years overlay, prompt block renderer, over-claim allowance hook, deterministic post-generation years claim enforcer, and application receipt builder.
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.68.23: a career total counted from the roles is a floor for a person who stated none (a lower number is corrected, "over 20 years" stands); years "of experience in <a field>" are left as written because no record confirms a field; a titled claim that matches neither figure takes the nearer true one; a corrected "1 year" reads "4 years".
# 3 | maintainer@emeraldcoastsystemsgroup.com | 1.68.24: the reader takes every figure Work history's Years by skill form can save: a skill's years up to and including 60 (60 itself was refused) and a total up to and including 70 (was under 60), so nothing the form saves is ignored by generation.
# 4 | maintainer@emeraldcoastsystemsgroup.com | 1.76.1 (Roger, 2026-11-25: a generated résumé said "Machine Learning (4 years)", "SAP HANA (5 years)", "AWS GovCloud (5 years)" and "over 25 years" / "26 years" of experience, none of them his figures): a person who has stated years of their own gets a years count only where they stated one. In the summary, headline, competencies, skills and cover letter, a years claim that names none of their figures, and a career total when they stated no total, is taken out by code after the last model pass ("Kubernetes (2 years)" reads "Kubernetes", "over 25 years of experience in X" reads "experience in X"); a claim that names one of their figures is still corrected to it. A person with no figures of their own keeps the roles' floor.
# 5 | maintainer@emeraldcoastsystemsgroup.com | The claims check (claims_check, claims_fix) ran before this pass with a rule of its own: it judged "11 years of Java and Spring" by the tool with the fewest recorded years and wrote that count in ("2 years of Java and Spring"), on a person who states Java 11 years; the notice read "your records support about 2" and the résumé reviewer then refused the conflict it made. The claims check now asks this module: own_figure() says whether the number a claim writes is the person's own for what it names (it is then left as written), sets_own() and reads() say whether this pass will write the person's figure over a claim that names one of theirs, and without() takes a figure out of a sentence the way enforce() does, also a count of decades and an "N-year" form this pass leaves alone. stated_overlay() keeps the person's figures on the records for those questions. enforce() itself is unchanged.
"""Authoritative candidate-confirmed per-skill and total-career years truth."""
from __future__ import annotations

import copy
import math
import re

from . import claims_check, skill_tenure

# Roles' bullets are role-scoped (a lower number there can be true of that role), and the over-claim check already
# covers them; the two-sided correction below applies to what is said of the person as a whole.
_PERSON_KEYS = ("headline", "summary", "competencies", "skills")
_NUMBER = r"\d{1,2}(?:\.\d)?|" + "|".join(sorted(claims_check._NUMBER_WORDS, key=len, reverse=True))
_CLAIM_RE = re.compile(
    r"(?<![\w.$-])(?:(?P<mod>over|more than|nearly|almost|about|around|roughly|close to|at least)\s+)?"
    r"(?P<n>" + _NUMBER + r")(?P<gap>\s*)(?P<plus>\+)?(?P<sep>-|\s*)(?P<unit>years?|yrs?)(?P<poss>['’]s?)?(?![\w-])",
    re.I,
)
_SKIP_AFTER = re.compile(r"\s*(?:ago|old|later|earlier|prior|before|after|from now)\b", re.I)
_SKIP_BEFORE = re.compile(r"\b(?:in|within|every|each|per|past|last|next|first|recent|another|additional)\s+(?:the\s+)?$", re.I)
_FOR_BEFORE = re.compile(r"\bfor\s+$", re.I)
_LINK_BEFORE = re.compile(r"\b(?:with|having|has|have|offering|offers|bringing|brings|possess(?:es|ing)?|spanning)\s+$", re.I)
_LIST_BEFORE = re.compile(r"(?:[(:–—]|\s-)\s*$")  # a label for the number; "|" separates, it does not label
_TENURE_AFTER = re.compile(
    r"\s*(?:of|in|with|as|experience|hands-on|professional|progressive|combined|total|working|building|developing|"
    r"leading|delivering|designing|managing|supporting|using|writing|architecting)\b", re.I)
_CAREER_CUE = re.compile(r"\b(?:experience|expertise|career|background|track record|industry)\b", re.I)
_HYPHEN_CUE = re.compile(r"\s*((?:[\w+#./-]+\s+){0,4}?)(?:career|veteran|track record|background|experience)\b", re.I)
_CLAUSE_END = re.compile(r"[,;)\n]|\.(?!\w)|\b(?:who|that|which|where|while|when|but)\b", re.I)
_LEAD = re.compile(
    r"^\s*(?:(?:of|in|with|as)\s+)?(?:(?:hands-on|professional|progressive|combined|total|industry)\s+)?"
    r"(?:experience\b\s*)?(?:(?:of|in|with|as)\s+)?", re.I)
_FILLER = frozenset({"the", "a", "an", "hands-on", "enterprise", "professional", "commercial", "production", "core",
                     "advanced", "modern", "full-stack"})
# Words that name a whole career, not a field of work: "20 years of total professional experience".
_GENERIC = frozenset({"experience", "professional", "total", "overall", "combined", "industry", "career", "work",
                      "working", "relevant", "progressive", "expertise", "background"})
_LOWER_BOUND = frozenset({"over", "more than", "at least"})
# Words that put a skill at a distance from the number: "experience leading Java teams", "services in Java".
_BETWEEN = frozenset({"in", "with", "for", "on", "across", "of", "at", "to", "using", "and", "or", "plus", "via",
                      "through", "over", "under", "into"})
_WHOLE_CAREER = re.compile(r"\b(?:total|overall|combined)\b", re.I)
# A count of decades ("two decades", "a decade"), with _CLAIM_RE's group names so _claim_context and _cut read it the
# same way. enforce() does not correct decades; without() takes one out for the claims check.
_DECADE_RE = re.compile(
    r"(?<![\w.$-])(?:(?P<mod>over|more than|nearly|almost|about|around|roughly|close to|at least)\s+)?"
    r"(?P<n>an?|" + _NUMBER + r")(?P<gap>\s*)(?P<plus>\+)?(?P<sep>-|\s*)(?P<unit>decades?)(?P<poss>['’]s?)?(?![\w-])",
    re.I,
)


def _valid_years(value, most: float = 60.0) -> float | None:
    """@description Parse a positive years figure of at most `most`, rejecting booleans and malformed values. The
    bounds are the ones Work history's Years by skill form saves within (years_edit): 60 for a skill, 70 in total.
    @param value - Raw value from profile. @param most - The largest figure read. @returns Float years or None."""
    if value is None or isinstance(value, bool):
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num) or num <= 0 or num > most:
        return None
    return num


def _fmt_years(value: float) -> str:
    """@description Format a years count as an integer string when whole, else without trailing .0.
    @param value - Numeric years count. @returns Formatted number string."""
    num = float(value)
    return str(int(num)) if num.is_integer() else str(round(num, 1))


def figures(prof: dict) -> dict:
    """@description Extract validated person-confirmed career and per-skill year figures from a profile dict.
    @param prof - Candidate profile dict. @returns {'career': float|None, 'skills': list[dict]}."""
    if not isinstance(prof, dict):
        return {"career": None, "skills": []}
    career = _valid_years(prof.get("career_years"), 70.0)
    skills = []
    raw_list = prof.get("years_by_skill")
    if isinstance(raw_list, list):
        for item in raw_list:
            if not isinstance(item, dict):
                continue
            name = str(item.get("skill") or "").strip() if isinstance(item.get("skill"), str) else ""
            yrs = _valid_years(item.get("years"))
            tokens = tuple(claims_check.words(name)) if name else ()
            if not tokens or yrs is None:
                continue
            skills.append({"name": name, "tokens": tokens, "key": "-".join(tokens), "years": yrs})
    skills.sort(key=lambda entry: (-len(entry["tokens"]), entry["name"]))
    return {"career": career, "skills": skills}


def overlay(tenure: dict, prof: dict) -> dict:
    """@description Overlay person-confirmed skill and career year figures onto a compute_tenure() result dict.
    @param tenure - Output of skill_tenure.compute_tenure(). @param prof - Candidate profile dict.
    @returns Tenure dict with person-confirmed figures applied."""
    figs = figures(prof)
    if not isinstance(tenure, dict) or (not figs["skills"] and figs["career"] is None):
        return tenure
    out = dict(tenure)
    skills = dict(out.get("skills") or {})
    for fig in figs["skills"]:
        if len(fig["tokens"]) == 1:
            tok = fig["tokens"][0]
            key = skill_tenure._SKILL_ALIASES.get(tok, tok)
        else:
            key = fig["key"]
        rec = dict(skills[key]) if key in skills else {
            "skill": key,
            "display": fig["name"],
            "months": int(fig["years"] * 12),
            "years": fig["years"],
            "floor_years": int(fig["years"]),
            "earliest_year": None,
            "latest_year": None,
            "current": True,
            "recent": True,
            "roles": [],
        }
        rec.update({
            "skill": rec.get("skill") or key,
            "display": fig["name"],
            "years": fig["years"],
            "floor_years": int(fig["years"]),
            "months": int(fig["years"] * 12),
            "source": "person",
        })
        skills[key] = rec
    out["skills"] = skills
    if figs["career"] is not None:
        c_val = figs["career"]
        out["total_career_years"] = int(c_val)
        out["total_career_years_exact"] = float(c_val)
        out["total_career_months"] = int(c_val * 12)
        out["career_source"] = "person"
    return out


def prompt_lines(tenure: dict) -> str:
    """@description Render the YEARS THE PERSON CONFIRMED prompt block when any person figure is present.
    @param tenure - Tenure dict from compute_tenure(). @returns Prompt block string or empty string."""
    if not isinstance(tenure, dict):
        return ""
    person_skills = [item for item in (tenure.get("skills") or {}).values()
                     if isinstance(item, dict) and item.get("source") == "person"]
    has_career = tenure.get("career_source") == "person"
    if not person_skills and not has_career:
        return ""
    lines = [
        "\n\nYEARS THE PERSON CONFIRMED (these are exact; when you state years for one of these, "
        "state exactly this number and never another; never round, never add '+'):"
    ]
    for item in person_skills:
        lines.append(f"- {item['display']}: {_fmt_years(item['years'])} years")
    if has_career:
        c_val = tenure.get("total_career_years_exact") or tenure.get("total_career_years") or 0
        lines.append(f"- Total professional experience: {_fmt_years(c_val)} years")
    return "\n".join(lines)


def stated_overlay(rec: dict, prof: dict) -> None:
    """@description Lay person-confirmed skill and career years into claims_check.records() output.
    @param rec - claims_check.records() dict to mutate in place. @param prof - Candidate profile dict.
    @returns None."""
    if not isinstance(rec, dict):
        return
    figs = figures(prof)
    rec["figures"] = figs  # the person's own figures, for own_figure(): a claim that states one is theirs
    stated = rec.setdefault("stated", {})
    for fig in figs["skills"]:
        for token in fig["tokens"]:
            stated[token] = max(stated.get(token, 0), fig["years"])
    if figs["career"] is not None:
        rec["stated_career"] = max(rec.get("stated_career", 0), figs["career"])


def _matches(clause: str, figs) -> list:
    """@description Every person figure whose tokens all appear in a clause, most specific first, then earliest.
    @param clause - Text. @param figs - figures(prof) dict or a list of figure dicts.
    @returns List of (figure, index of its first token among the clause's words)."""
    skills = (figs.get("skills") or []) if isinstance(figs, dict) else list(figs or [])
    present = [word for word in claims_check.words(clause or "") if word not in _FILLER]
    found = []
    for fig in skills:
        tokens = fig.get("tokens") or ()
        if tokens and all(token in present for token in tokens):
            found.append((fig, min(present.index(token) for token in tokens)))
    found.sort(key=lambda pair: (-len(pair[0]["tokens"]), pair[1], pair[0].get("name") or ""))
    # "SAP NetWeaver Java" also holds the word Java: the wider figure is the one named, not the narrower.
    return [pair for pair in found
            if not any(set(pair[0]["tokens"]) < set(other["tokens"]) for other, _ in found)]


def subject(clause: str, figs) -> dict | None:
    """@description The most specific person figure a clause names (every token present; ties go to the one named
    first). @param clause - Text clause of a years claim. @param figs - figures(prof) dict or list of figures.
    @returns The figure, or None."""
    found = _matches(clause, figs)
    return found[0][0] if found else None


def _before_phrase(before: str, limit: int) -> str:
    """@description The words just before a claim, back to the clause start, at most `limit` words.
    @param before - Text before the claim (its linking word already removed). @param limit - Most words kept.
    @returns The phrase."""
    clause = re.split(r"[,;:(\n•|]|\.(?!\w)", before)[-1]
    return " ".join(clause.split()[-limit:])


def _time_expression(text: str, match: re.Match) -> bool:
    """@description Whether a years match is a length of time and not anyone's tenure: "5 years ago", "in 3 years",
    "every 2 years", "the last 5 years". @param text - The string. @param match - A _CLAIM_RE or _DECADE_RE match.
    @returns True when it is."""
    before, after = text[:match.start()], text[match.end():]
    return bool(claims_check._YEARS_NOT_CLAIM.search(before[-12:]) or _SKIP_AFTER.match(after)
                or _SKIP_BEFORE.search(before[-24:]))


def _claim_context(text: str, match: re.Match) -> dict | None:
    """@description What a years match is a claim about, or None when it is not a statement of the person's tenure
    (a project's length, "5 years ago", "in 3 years", a range).
    @param text - The string. @param match - A _CLAIM_RE match.
    @returns {"subject": text, "tight": bool, "career": bool, "title": bool} or None."""
    before, after = text[:match.start()], text[match.end():]
    tail = before[-24:]
    if _time_expression(text, match):
        return None
    if _LIST_BEFORE.search(before):  # "Java (11 years)", "Java: 11 years", "Java - 11 yrs"
        head = re.split(r"[,;:\n•|(]", _LIST_BEFORE.sub("", before))[-1]
        return {"subject": head, "tight": True, "career": bool(_CAREER_CUE.search(head)), "title": False}
    if match.group("sep") == "-":  # "11-year Java veteran"; a bare "3-year migration" is a project's length
        cue = _HYPHEN_CUE.match(after)
        return {"subject": cue.group(1), "tight": True, "career": True, "title": False} if cue else None
    if _FOR_BEFORE.search(tail):  # "has led DevOps for 2 years": the subject comes first, and is never the career
        return {"subject": _before_phrase(_FOR_BEFORE.sub("", before), 8), "tight": False, "career": False,
                "title": False, "before": True}
    if not (match.group("poss") or _TENURE_AFTER.match(after)):
        return None
    following = _CLAIM_RE.search(after)  # "2 years of Python and 14 years of ABAP": each claim keeps its own words
    raw = _CLAUSE_END.split(after[:following.start()] if following else after, maxsplit=1)[0]
    raw = re.sub(r"\s*(?:\band\b|\bplus\b|&|/)\s*$", "", raw, flags=re.I)
    cleaned = _LEAD.sub("", raw, count=1)
    if claims_check.words(cleaned):
        return {"subject": cleaned, "tight": False, "career": bool(_CAREER_CUE.search(raw)), "title": False}
    if _LINK_BEFORE.search(before):  # "Senior ABAP developer with 14 years of experience"
        return {"subject": _before_phrase(_LINK_BEFORE.sub("", before), 6), "tight": False, "career": True, "title": True,
                "whole": bool(_WHOLE_CAREER.search(raw))}
    return {"subject": "", "tight": False, "career": True, "title": False}


def _roles_career(prof: dict, selected=()) -> float | None:
    """@description The length of the person's career as their roles' dates give it, for a person who has stated no
    total of their own. @param prof - The person's profile. @param selected - Additional experience chosen for this
    packet. @returns Years (one decimal), or None when the roles give under a year."""
    try:
        tenure = skill_tenure.compute_tenure(prof, selected)
    except (TypeError, ValueError, KeyError, AttributeError):
        return None
    exact = float((tenure or {}).get("total_career_years_exact") or 0.0)
    return exact if exact >= 1 else None


def _career(figs: dict, claimed: float, hedged: bool):
    """@description The career total a claim must state, and whether the claim as written already agrees with it.
    The person's own total is exact. A total counted from the roles is a floor: a lower number is wrong, "over 20
    years" stands when 20 is the roles' total rounded down to five, and a higher number is the over-claim check's.
    @param figs - figures(prof), with roles_career when the person stated no total. @param claimed - The number
    written. @param hedged - Whether it was written as a lower bound ("over", "+").
    @returns (years or None, agrees)."""
    if figs["career"] is not None:
        return figs["career"], abs(figs["career"] - claimed) < 1e-6
    exact = figs.get("roles_career")
    if not exact:
        return None, False
    floor = float(int(exact))
    band = float(int(exact) // 5 * 5)
    return floor, claimed >= floor or (hedged and band > 0 and abs(claimed - band) < 1e-6)


def _scoped(context: dict) -> bool:
    """@description Whether a claim's own words name a field of work ("experience in retail management"): years of
    that field, which no record here can confirm, not of the whole career. A title before the claim is not its scope.
    @param context - _claim_context() output. @returns True when the words go past the generic words for a career."""
    if context["title"]:
        return False
    return any(word not in _FILLER and word not in _GENERIC for word in claims_check.words(context["subject"]))


def _target(context: dict, claimed: float, figs: dict):
    """@description The figure a claim must state, or None to leave it as written. Only a claim that is certainly
    about one of the person's figures is changed; a number loosely attached to a skill named later is left alone.
    @param context - _claim_context() output. @param claimed - The number written. @param figs - figures(prof).
    @returns (years, label) or None."""
    found = _matches(context["subject"], figs)
    career, agrees = _career(figs, claimed, context.get("hedged", False))
    if not found:
        if career is None or not context["career"] or _scoped(context):
            return None  # no career total, not a statement of experience, or years in a field no record confirms
        return None if agrees and figs["career"] is None else (career, "career")
    fig, position = found[0]
    stated = next((other for other, _ in found if abs(other["years"] - claimed) < 1e-6), None)
    if stated:
        return stated["years"], stated["name"]  # the number is right; only a "+" or "over" is dropped
    if context["title"]:  # "Senior ABAP developer with N years of experience": the skill's years or the career's
        if agrees:
            return None
        if context.get("whole") and career is not None:  # "... with N years of total experience"
            return career, "career"
        nearer_career = career is not None and abs(career - claimed) < abs(fig["years"] - claimed)
        return (career, "career") if nearer_career else (fig["years"], fig["name"])
    before = context.get("before", False)  # "has led DevOps for N years": the words come first, one skill only
    if context["tight"] or (len(found) == 1 if before else _named_first(context["subject"], position)):
        return fig["years"], fig["name"]
    return None


def _named_first(subject: str, position: int) -> bool:
    """@description Whether a figure is what a claim's words name first: nothing stands before it but at most two
    plain modifiers ("server-side Java"), never an action or a joining word ("leading Java teams", "services in Java").
    @param subject - The claim's words. @param position - The figure's place among them (fillers not counted).
    @returns True when the years are that skill's."""
    lead = [word for word in claims_check.words(subject) if word not in _FILLER][:position]
    return len(lead) <= 2 and not any(word in _BETWEEN or word.endswith("ing") for word in lead)


def _unit(unit: str, years: float, hyphen: bool) -> str:
    """@description The unit word for a corrected number: "1 year", "4 years"; "11-year" keeps its form.
    @param unit - The unit as written. @param years - The corrected number. @param hyphen - "N-year" form.
    @returns The unit word."""
    if hyphen:
        return unit
    base = unit[:-1] if unit.lower().endswith("s") else unit
    if abs(years - 1) < 1e-6:
        return base
    return base + ("S" if base.isupper() else "s")


def _number(match: re.Match) -> float:
    """@description The number a claim states. @param match - A _CLAIM_RE match. @returns The number."""
    raw = match.group("n").lower()
    return float(raw) if raw[0].isdigit() else float(claims_check._NUMBER_WORDS.get(raw, 0))


_EXPERIENCE_NEXT = re.compile(r"(?:[\w-]+\s+){0,2}?experience\b", re.I)
_OF_NEXT = re.compile(r"\s+of\s+", re.I)
_LABEL_BEFORE = re.compile(r"\s*(?:\(\s*|:\s*|\s-\s*|[–—]\s*)$")
_SENTENCE_START = re.compile(r"(?:^|[.!?|•\n])\s*$")
_LONE_EXPERIENCE = re.compile(r"\s*experience\b\s*(?=$|[|•;\n])", re.I)
_SEPARATOR_BEFORE = re.compile(r"\s*[|•;]\s*$")


def _stated(figs: dict) -> bool:
    """@description Whether the person stated years of their own: then a years count appears only where they stated
    one, and a total only when they stated a total. @param figs - figures(prof). @returns True when they did."""
    return bool(figs.get("skills")) or figs.get("career") is not None


def _cut(text: str, match: re.Match, context: dict, last: int):
    """@description The span to take out of a string for a years claim the person never stated, and whether the words
    that follow now open a sentence. "Kubernetes (2 years)" loses " (2 years)", "a 26-year career" loses "26-year ",
    "led DevOps for 2 years" loses " for 2 years", "over 25 years of experience in X" keeps "experience in X",
    "with over 10 years leading teams" reads "with experience leading teams", and a headline part left as the bare word
    "experience" goes with its separator. @param text - The string. @param match - The _CLAIM_RE match.
    @param context - _claim_context() output. @param last - Where the text not yet copied begins (nothing before it
    is taken). @returns (start, end, replacement, capitalize the next word)."""
    start, end, head = match.start(), match.end(), text[last:match.start()]
    if match.group("sep") == "-":
        space = re.match(r"\s+", text[end:])
        return start, end + (space.end() if space else 0), "", False
    if context["tight"]:
        label = _LABEL_BEFORE.search(head)
        opened = bool(label) and "(" in label.group(0)
        start = last + label.start() if label else start
        close = re.match(r"\s*\)", text[end:]) if opened else None
        return start, end + (close.end() if close else 0), "", False
    if context.get("before"):
        lead = re.search(r"\s*\bfor\s+$", head, re.I)
        return (last + lead.start() if lead else start), end, "", False
    rest = text[end:]
    lone = _LONE_EXPERIENCE.match(rest)
    separator = _SEPARATOR_BEFORE.search(head)
    if lone and separator:  # "Java Architect | 20+ years' experience" reads "Java Architect"
        return last + separator.start(), end + lone.end(), "", False
    of = _OF_NEXT.match(rest)
    spaces = len(rest) - len(rest.lstrip())
    follows = rest[of.end():] if of else rest[spaces:]
    filler = "" if of or _EXPERIENCE_NEXT.match(follows) else "experience "
    opens = bool(_SENTENCE_START.search(head)) and not text[last:start].strip() or bool(_SENTENCE_START.search(text[:start]))
    return start, end + (of.end() if of else spaces), filler, opens


def _agrees(context: dict, claimed: float, figs: dict) -> bool:
    """@description Whether a claim's number is one of the person's own figures for what it names: their total for a
    statement of experience, or a figure of a skill it names. Such a claim is theirs and stays as written.
    @param context - _claim_context() output. @param claimed - The number written. @param figs - figures(prof).
    @returns True when the number is theirs."""
    career = figs.get("career")
    if career is not None and context.get("career") and abs(career - claimed) < 1e-6:
        return True
    return any(abs(fig["years"] - claimed) < 1e-6 for fig, _ in _matches(context.get("subject") or "", figs))


def _capital(segment: str) -> str:
    """@description A segment with its first letter capitalised, for words that now open a sentence.
    @param segment - Text. @returns The text."""
    return segment[:1].upper() + segment[1:] if segment[:1].isalpha() else segment


def _claim_at(text: str, start: int, end: int) -> tuple:
    """@description The years figure written at [start, end) of a string, as this module reads one: a count of years,
    or of decades. @param text - The string. @param start - Where the figure begins. @param end - Where it ends.
    @returns (match, _claim_context() of it) or (None, None) when no figure is written there."""
    for pattern in (_CLAIM_RE, _DECADE_RE):
        for match in pattern.finditer(text or ""):
            if match.start() < end and start < match.end():
                return match, _claim_context(text, match)
    return None, None


def own_figure(figs, text: str, start: int, end: int, claimed: float, subject: str = "") -> bool:
    """@description Whether the number a years claim writes is the person's own figure for what the claim names: their
    total for a statement of experience, or their figure for a skill named with it (_agrees). Such a claim is theirs.
    It is supported as written whatever the roles' dates add up to, and no check may change it.
    @param figs - figures(prof), as stated_overlay() keeps it on the records. @param text - The string the claim is
    in. @param start - Where its figure begins. @param end - Where the figure ends. @param claimed - The number
    written, without its "over" or "+" (a decade is 10). @param subject - The words another reader bound the figure
    to, read as well as this module's own reading. @returns True when the number is theirs."""
    if not isinstance(figs, dict) or not _stated(figs):
        return False
    _match, context = _claim_at(text, start, end)
    readings = [context] if context else []
    if (subject or "").strip():
        readings.append({"subject": subject, "career": bool(_CAREER_CUE.search(subject))})
    return any(_agrees(reading, claimed, figs) for reading in readings)


def reads(document: str, section: str) -> bool:
    """@description Whether enforce() reads a string of a packet: every string of the cover letter, and the résumé's
    headline, summary, competencies and skills (never a role's bullets, which are that role's own).
    @param document - "cover" or "resume". @param section - The résumé key the string sits under.
    @returns True when the last pass reads it."""
    return document == "cover" or section in _PERSON_KEYS


def sets_own(figs, text: str, start: int, end: int) -> bool:
    """@description Whether the years figure written at [start, end) is certainly about one of the person's own
    figures while stating another number (_target): enforce() writes their figure there ("9 years of Java" reads "12
    years of Java" for a person who states 12), so an earlier check leaves the claim for it where reads() holds.
    @param figs - figures(prof). @param text - The string. @param start - Where the figure begins.
    @param end - Where it ends. @returns True when enforce() sets the figure to the person's own."""
    if not isinstance(figs, dict) or not _stated(figs):
        return False
    match, context = _claim_at(text, start, end)
    if not context or match.re is not _CLAIM_RE:
        return False
    context["hedged"] = bool(match.group("plus")) or (match.group("mod") or "").lower() in _LOWER_BOUND
    return _target(context, _number(match), figs) is not None


def without(text: str, start: int, end: int) -> str | None:
    """@description A string without the years figure written at [start, end), its words kept a sentence the way
    enforce() takes out a figure the person never stated (_cut): "Kubernetes (2 years)" reads "Kubernetes", "over 25
    years of experience in X" reads "experience in X", "a 26-year career" reads "a career", "two decades of Java" reads
    "Java". No number is written in its place.
    @param text - The string. @param start - Where the figure begins. @param end - Where it ends.
    @returns The string without it, or None when this module cannot take that figure out and leave a sentence (no
    figure is written there, it is a length of time such as "in 3 years", or nothing says what the years are of)."""
    match, context = _claim_at(text, start, end)
    if match is None:
        return None
    if context is None:  # "a 5-year migration": the hyphen form comes out whatever follows; nothing else unread does
        if match.group("sep") != "-" or _time_expression(text, match):
            return None
        context = {"tight": False}
    cut_from, cut_to, filler, opens = _cut(text, match, context, 0)
    rest = text[cut_to:]
    return text[:cut_from] + (_capital(filler) if opens and filler else filler) + (_capital(rest) if opens and not filler else rest)


def _enforce_text(text: str, path: str, figs: dict, changes: list) -> str:
    """@description Rewrite the years claims of one string that differ from the person's figures, and, for a person
    who stated figures, take out the claims that name none of them (a career total too, when they stated no total).
    @param text - String value. @param path - Dotted path in the packet. @param figs - figures(prof).
    @param changes - List the corrections are appended to. @returns The string, corrected."""
    out, last, capital = [], 0, False
    for match in _CLAIM_RE.finditer(text):
        if match.start() < last:
            continue
        context = _claim_context(text, match)
        if context:
            context["hedged"] = bool(match.group("plus")) or (match.group("mod") or "").lower() in _LOWER_BOUND
        target = _target(context, _number(match), figs) if context else None
        if target is None and context and _stated(figs) and not _agrees(context, _number(match), figs):
            start, end, filler, opens = _cut(text, match, context, last)
            piece = text[last:start]
            out.extend([_capital(piece) if capital else piece, _capital(filler) if opens and filler else filler])
            capital, last = opens and not filler, end
            changes.append({"path": path, "from": text[start:end], "to": filler.strip(), "skill": "not stated"})
            continue
        if target is None:
            continue
        years, label = target
        gap = match.group("sep") or match.group("gap")
        unit = _unit(match.group("unit"), years, match.group("sep") == "-")
        new_phrase = f"{_fmt_years(years)}{gap}{unit}{match.group('poss') or ''}"
        if new_phrase == match.group(0):
            continue
        piece = text[last:match.start()]
        out.extend([_capital(piece) if capital else piece, new_phrase])
        capital, last = False, match.end()
        changes.append({"path": path, "from": match.group(0), "to": new_phrase, "skill": label})
    if not last:
        return text
    tail = text[last:]
    return "".join(out) + (_capital(tail) if capital else tail)


def _walk_enforce(node, path: str, figs: dict, changes: list):
    """@description Visit every string inside a value and enforce the person's figures on it.
    @param node - A JSON value. @param path - Dotted path. @param figs - figures(prof).
    @param changes - List the corrections are appended to. @returns The value, corrected."""
    if isinstance(node, str):
        return _enforce_text(node, path, figs, changes)
    if isinstance(node, list):
        return [_walk_enforce(item, f"{path}.{idx}", figs, changes) for idx, item in enumerate(node)]
    if isinstance(node, dict):
        return {key: _walk_enforce(value, f"{path}.{key}", figs, changes) for key, value in node.items()}
    return node


def enforce(data: dict, prof: dict, selected=()) -> tuple[dict, list]:
    """@description The last pass over a generated packet: what it says of the person as a whole (the résumé's
    headline, summary, competencies and skills, and the cover letter) states the person's own years, never another
    number, and never a career total below what their roles' dates give. Decided by code, after every model pass.
    Role bullets are left to the over-claim check.
    @param data - Generated packet. @param prof - The person's profile. @param selected - Additional experience
    chosen for this packet. @returns (packet, corrections); the packet itself when nothing changed."""
    figs = figures(prof)
    if figs["career"] is None and not _stated(figs) and isinstance(prof, dict):
        figs["roles_career"] = _roles_career(prof, selected)  # a total only they stated, once they state any figure
    if not isinstance(data, dict) or not (figs["skills"] or figs["career"] is not None or figs.get("roles_career")):
        return data, []
    new_data, changes = copy.deepcopy(data), []
    resume = new_data.get("resume")
    if isinstance(resume, dict):
        for key in _PERSON_KEYS:
            if key in resume:
                resume[key] = _walk_enforce(resume[key], f"resume.{key}", figs, changes)
    if "cover" in new_data:
        new_data["cover"] = _walk_enforce(new_data["cover"], "cover", figs, changes)
    return (new_data, changes) if changes else (data, [])


def receipt(tenure: dict, changes: list) -> dict:
    """@description Build the application.json years_truth receipt summarizing top 24 figures and corrections made.
    @param tenure - compute_tenure() output. @param changes - Change list from enforce().
    @returns Receipt dict."""
    skills = list(((tenure or {}).get("skills") or {}).values())
    ranked = sorted(skills, key=lambda item: (-float(item.get("years") or 0.0), str(item.get("display") or "")))[:24]
    fig_rows = []
    for item in ranked:
        yrs = float(item.get("years") or 0.0)
        fig_rows.append({
            "skill": item.get("display") or item.get("skill") or "",
            "years": int(yrs) if yrs.is_integer() else round(yrs, 1),
            "source": item.get("source") or "roles",
        })
    c_raw = (tenure or {}).get("total_career_years_exact")
    if c_raw is None:
        c_raw = (tenure or {}).get("total_career_years") or 0
    c_num = float(c_raw)
    return {
        "figures": fig_rows,
        "career_years": int(c_num) if c_num.is_integer() else round(c_num, 1),
        "career_source": (tenure or {}).get("career_source") or "roles",
        "corrected": list(changes or []),
    }
