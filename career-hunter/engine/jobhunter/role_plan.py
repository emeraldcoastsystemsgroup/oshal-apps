# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.3 (Roger, 2026-11-16: "the system isnt using my most recent expierence to generate the resume ... it would leave out my active role"): which recorded roles every generated résumé carries, in which order, and the check that holds each generation to it. The model was handed the whole profile with the current role first and left it out (5 of the 6 packets made since it was added), because the prompt let it drop roles for relevance and nothing after the model call looked. Now the prompt lists the roles to carry, and carry() puts back any the model left out, from the role's own recorded title, employer, dates and bullets, most recent first.
"""Which recorded roles a generated résumé carries, in which order, and the check that holds every generation to it.

The model writes the words; this module decides which roles are on the page. A role the candidate holds now (no end
month, or an end that says Present or current) and every role that ended within YEARS_CARRIED years is its own entry
in the résumé's experience, most recent first, with the title and employer the main résumé records. Older roles stay
the model's choice (condensed or left out, as the prompt asks). lib/career-resume-roles.js applies the same rules to
packets made before this check, and tests/career-resume-roles-parity.test.mjs holds the two to one answer.
"""
from __future__ import annotations

import datetime
import re

YEARS_CARRIED = 20
RESTORED_BULLETS = 4          # a current role the model left out comes back with up to this many recorded bullets
RESTORED_OLDER_BULLETS = 2    # an ended one with fewer: the prompt condenses older roles
_CURRENT_WORDS = ("present", "current", "currently", "now", "today", "ongoing")
_SAYS_CURRENT = re.compile(r"\b(present|current|currently|now|today|ongoing)\b", re.I)
_MONTH_NAMES = (("jan", "january"), ("feb", "february"), ("mar", "march"), ("apr", "april"), ("may",),
                ("jun", "june"), ("jul", "july"), ("aug", "august"), ("sep", "sept", "september"),
                ("oct", "october"), ("nov", "november"), ("dec", "december"))
_MONTHS = {name: number for number, names in enumerate(_MONTH_NAMES, start=1) for name in names}
_ORG_NOISE = {"inc", "llc", "ltd", "corp", "corporation", "co", "company", "the", "plc", "gmbh", "lp", "llp"}
_UNPLACED = (1, (9999, 12), (0, 0))   # an undatable first entry: after recorded current roles, before ended ones
_LAST = (-1, (0, 0), (0, 0))           # an undatable entry after every datable one stays at the end


def _text(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def month(value, last: bool = False):
    """
    @description The (year, month) a recorded date names, or None. A year alone is its January as a start and its
    December as an end, so 2019 to 2019-05 still orders. Reads 2019-03, 2019-03-01, 03/2019, Mar 2019 and 2019.
    @param value - A role's start or end as recorded.
    @param last - Whether the date ends a span (a bare year then means December, and the last year wins).
    @returns (year, month) or None.
    """
    text = _text(value).lower()
    for pattern, year_first in ((r"\b(\d{4})[-/.](\d{1,2})\b", True), (r"\b(\d{1,2})[-/.](\d{4})\b", False)):
        found = re.search(pattern, text)
        if found:
            year, number = (found.group(1), found.group(2)) if year_first else (found.group(2), found.group(1))
            if 1900 <= int(year) <= 2100 and 1 <= int(number) <= 12:
                return int(year), int(number)
    named = re.search(r"\b([a-z]{3,9})\.?,?\s+(\d{4})\b", text)
    if named and named.group(1) in _MONTHS:
        return int(named.group(2)), _MONTHS[named.group(1)]
    years = re.findall(r"\b(19\d{2}|20\d{2})\b", text)
    if not years:
        return None
    return (int(years[-1]), 12) if last else (int(years[0]), 1)


def is_current(role: dict) -> bool:
    """@description A role the candidate holds now: no end recorded, or an end that says Present or current.
    @param role - One profile role. @returns Whether it is current."""
    end = role.get("end")
    if end is None:
        return True
    text = _text(end).lower()
    return not text or any(text == word or text.startswith(word + " ") for word in _CURRENT_WORDS)


def _span(role: dict, current: bool) -> str:
    start = month(role.get("start"))
    end = None if current else month(role.get("end"), last=True)
    first = str(start[0]) if start else ""
    final = "Present" if current else (str(end[0]) if end else "")
    if not first:
        return final
    if not final or first == final:
        return first
    return f"{first} to {final}"


def _rank(role: dict, current: bool):
    end = (9999, 12) if current else (month(role.get("end"), last=True) or (0, 0))
    return (1 if current else 0, end, month(role.get("start")) or (0, 0))


def _required(role: dict, current: bool, year: int) -> bool:
    if current:
        return True
    dated = month(role.get("end"), last=True) or month(role.get("start"))
    return bool(dated) and dated[0] >= year - YEARS_CARRIED


def plan(prof: dict, today: datetime.date | None = None) -> list:
    """
    @description Every recorded role with a title or employer, most recent first: a current role first, then the
    latest end, then the latest start. `required` marks the roles every generated résumé must carry.
    @param prof - The loaded career profile (roles as the main résumé and Work history record them).
    @param today - The date "within YEARS_CARRIED years" is measured from (today when omitted).
    @returns [{key, index, title, org, span, current, required, rank}], where key is R<place in the profile>.
    """
    year = (today or datetime.date.today()).year
    entries = []
    for index, role in enumerate((prof or {}).get("roles") or []):
        if not isinstance(role, dict) or not (_text(role.get("title")) or _text(role.get("org"))):
            continue
        current = is_current(role)
        entries.append({"key": f"R{index + 1}", "index": index, "title": _text(role.get("title")),
                        "org": _text(role.get("org")), "span": _span(role, current), "current": current,
                        "required": _required(role, current, year), "rank": _rank(role, current)})
    entries.sort(key=lambda entry: entry["rank"], reverse=True)
    return entries


def prompt_block(entries: list) -> str:
    """
    @description The generation prompt's ROLES TO CARRY block: each required role with its key, title, employer and
    dates, current roles marked, in the order the résumé shows them. '' when the profile records no such role.
    @param entries - plan() output.
    @returns The prompt text.
    """
    required = [entry for entry in entries if entry["required"]]
    if not required:
        return ""
    lines = [f'- {e["key"]}: {e["title"]} | {e["org"]} | {e["span"] or "dates not recorded"}'
             + (" | CURRENT ROLE" if e["current"] else "") for e in required]
    return (
        "\n\nROLES TO CARRY (hard rule; from the candidate's main résumé and Work history, most recent first):\n"
        + "\n".join(lines)
        + "\nEvery role listed above MUST be its own entry in \"experience\", in this order, with that title and that "
        "employer. A CURRENT ROLE is work the candidate does today: it comes first and its span ends in Present. Never "
        "leave a listed role out to save space, for relevance, or because another rule keeps some of its wording out: "
        "keep the role and leave out only that wording. Its bullets come only from that role's own recorded bullets. "
        "Roles not listed may be condensed or left out as described above. Add \"role\": \"<its key, e.g. R1>\" to "
        "each experience entry you write for a listed role.\n"
    )


def _words(value) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", _text(value).lower().replace("&", " and ")).split())


def _org_words(value) -> str:
    return " ".join(word for word in _words(value).split() if word not in _ORG_NOISE)


def same_org(first, second) -> bool:
    """@description Whether two employer names are the same employer, spacing, case, punctuation and company
    suffixes aside, or one names the other whole. @param first - A name. @param second - A name. @returns bool"""
    a, b = _org_words(first), _org_words(second)
    if not a or not b:
        return False
    return a == b or f" {a} " in f" {b} " or f" {b} " in f" {a} "


def roles_of(item: dict, entries: list, strict: bool = False) -> list:
    """
    @description The planned roles one generated entry stands for: the key it names; else, for each role, the same
    employer (when either side names no employer, the same title). A current role also needs the same title or a
    span that runs to the present, so an older job at the same employer never stands in for it. `strict` needs the
    title too.
    @param item - One generated experience entry. @param entries - plan() output. @param strict - Require the title.
    @returns The matching plan entries.
    """
    key = _text(item.get("role")).upper()
    named = [entry for entry in entries if key and entry["key"] == key]
    if named:
        return named
    title = _words(item.get("title"))
    found = []
    for entry in entries:
        titled = bool(title) and title == _words(entry["title"])
        both_named = bool(entry["org"]) and bool(_text(item.get("org")))
        employer = same_org(item.get("org"), entry["org"]) if both_named else titled
        if not employer or (strict and not titled):
            continue
        if entry["current"] and not (titled or _SAYS_CURRENT.search(_text(item.get("span")))):
            continue
        found.append(entry)
    return found


def missing(resume: dict, entries: list) -> list:
    """@description The required roles a résumé's experience does not carry. @param resume - A generated résumé.
    @param entries - plan() output. @returns plan entries, most recent first."""
    carried = {entry["key"] for item in (resume or {}).get("experience") or [] if isinstance(item, dict)
               for entry in roles_of(item, entries)}
    return [entry for entry in entries if entry["required"] and entry["key"] not in carried]


def _span_rank(span):
    text = _text(span)
    if not text:
        return None
    if _SAYS_CURRENT.search(text):
        return (1, (9999, 12), month(re.split(r"\s+to\s+|[-–—]", text)[0]) or (0, 0))
    end, start = month(text, last=True), month(text)
    return (0, end, start) if end else None


def _ordered(experience: list, entries: list, written: int):
    """Most recent first, by each entry's recorded role (or its own span). An entry Career cannot date keeps its place
    after the entry before it; one the model wrote (the first `written` entries) after every datable entry it wrote,
    such as an "Early career" line, stays last."""
    found = []
    for item in experience:
        roles = roles_of(item, entries)
        found.append(max(entry["rank"] for entry in roles) if roles else _span_rank(item.get("span")))
    last = max((position for position, rank in enumerate(found[:written]) if rank is not None), default=-1)
    ranks, previous = [], _UNPLACED
    for position, rank in enumerate(found):
        rank = rank if rank is not None else (previous if position < last else _LAST)
        ranks.append(rank)
        previous = rank
    order = sorted(range(len(experience)), key=lambda position: ranks[position], reverse=True)
    return [experience[position] for position in order], order != list(range(len(experience)))


def _restored(entry: dict, role: dict, embargo) -> dict:
    bullets = [_text(item) for item in role.get("deliverables") or [] if _text(item)]
    if embargo:
        bullets = [item for item in bullets if not any(term in item.lower() for term in embargo)]
    count = RESTORED_BULLETS if entry["current"] else RESTORED_OLDER_BULLETS
    return {"title": entry["title"], "org": entry["org"], "span": entry["span"], "bullets": bullets[:count]}


def _take_misplaced(resume: dict, entries: list, carried: set) -> list:
    """A required role the model wrote under another section (by its key, or its employer and title) moves back."""
    moved = []
    for section in ("additional_experience", "open_source"):
        items = resume.get(section)
        if not isinstance(items, list):
            continue
        kept = []
        for item in items:
            found = roles_of(item, entries, strict=True) if isinstance(item, dict) else []
            if any(entry["required"] and entry["key"] not in carried for entry in found):
                moved.append(item)
                carried.update(entry["key"] for entry in found)
            else:
                kept.append(item)
        resume[section] = kept
    return moved


def _present_spans(experience: list, entries: list) -> list:
    """A current role's entry that names an end year says Present again, from the recorded dates."""
    fixed = []
    for item in experience:
        for entry in roles_of(item, entries):
            if entry["current"] and entry["span"] and not _SAYS_CURRENT.search(_text(item.get("span"))):
                item["span"] = entry["span"]
                fixed.append(entry["key"])
    return fixed


def carry(resume: dict, entries: list, prof: dict, embargo=()) -> dict:
    """
    @description Hold one generated résumé to the plan: every required role is an experience entry (a role the model
    wrote elsewhere moves back; one it left out is restored from the recorded title, employer, dates and up to
    RESTORED_BULLETS recorded bullets, without any that name an embargoed term), a current role's span runs to the
    present, and the entries are most recent first. The `role` keys the prompt asked for are removed. Nothing is
    invented: every restored word is the candidate's own record.
    @param resume - The generated résumé, changed in place.
    @param entries - plan() output for the profile the résumé was generated from.
    @param prof - That profile (the roles restored entries are read from).
    @param embargo - Lower-case terms a restored bullet may not contain (the open-source embargo, when it applies).
    @returns {required, restored, moved, reordered, spans}: what the check found and did, by role key.
    """
    experience = [item for item in resume.get("experience") or [] if isinstance(item, dict)]
    written = len(experience)
    carried = {entry["key"] for item in experience for entry in roles_of(item, entries)}
    moved = _take_misplaced(resume, entries, carried)
    experience += moved
    roles = (prof or {}).get("roles") or []
    restored = [entry for entry in entries if entry["required"] and entry["key"] not in carried]
    experience += [_restored(entry, roles[entry["index"]], embargo) for entry in restored]
    spans = _present_spans(experience, entries)
    experience, reordered = _ordered(experience, entries, written)
    for section in ("experience", "additional_experience", "open_source"):
        for item in experience if section == "experience" else resume.get(section) or []:
            if isinstance(item, dict):
                item.pop("role", None)
    resume["experience"] = experience
    return {"required": [entry["key"] for entry in entries if entry["required"]],
            "restored": [entry["key"] for entry in restored], "moved": len(moved),
            "reordered": reordered, "spans": spans}
