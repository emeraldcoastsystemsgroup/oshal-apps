# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.5 (Roger, 2026-11-16: "lies about my level of expertise on c# ... the cover letter is not acceptable"): what Career does with the problems claims_check finds, whichever model wrote the documents. A level the records do not state is toned down to experience with the tool; a years count is cut to what the recorded dates add up to; a résumé job's title goes back to the recorded one; a claim naming a tool the records never name, a tool under the wrong job, a title the records do not hold or a letter sentence drawn from work outside the letter's evidence is taken out. A letter that lost a sentence, or is too thin to send, is written again once with the problems named; a letter still too thin is marked needs your review, with the problems in words, and is never marked ready on its own.
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.68.15: never emit '+' suffixes when toning down years claims in _retime().
# 3 | maintainer@emeraldcoastsystemsgroup.com | A résumé made on 2026-11-26 carried the notice "The résumé claimed 11 years; your records support about 2. Career toned it down to what your records say", for a person who states Java 11 years; the résumé then said "2 years" twice beside "Java / J2EE (11 years)" and the reviewer refused it. _retime wrote a count Career worked out from the roles' dates in place of the figure. It is gone: Career never writes a number of years of its own. A years figure the person has not stated is taken out with the sentence kept (_untime, by years_truth.without, the way years_truth.enforce does it: "over 25 years of experience in X" reads "experience in X"); one that cannot be taken out and leave a sentence goes with its claim. The notice says "Career took the figure out", and the line for the letter's second writing tells the model to state no number of years there, with no count in it.
"""Hold a generated packet to the records: tone down or remove each unsupported claim, then judge the letter."""
from __future__ import annotations

import copy
import hashlib
import re

from . import claims_check, years_truth

VERSION = 1
MIN_LETTER_WORDS = 90
MAX_RECORDED = 40
_REMOVE = frozenset({"skill", "attribution", "evidence"})
_ADJ = (r"expert|expert-level|advanced|deep|extensive|strong|solid|seasoned|veteran|senior|senior-level|world-class|"
        r"master|masterful|proficient|skilled|accomplished|significant|substantial|in-depth|thorough|sophisticated|"
        r"proven|broad|unmatched|highly-skilled")
_LEVEL_NOUN = r"expertise|mastery|proficiency|fluency|command"
_PERSON = r"expert|experts|guru|specialist|ninja|wizard|master|authority|virtuoso"


def _tone_term(text: str, term: str) -> str:
    """Rewrite the level phrases that sit on one tool: 'expert in C#' -> 'experienced with C#', 'deep C# expertise' ->
    'C# experience', 'advanced C#' -> 'C#'. A tool written as an expert, guru or specialist is left for removal."""
    tool = claims_check.surface(term)
    value = re.sub(r"\b(?:(?:an?|the)\s+)?(?:(?:highly|very|deeply|truly)\s+)?(?:expert|proficient|skilled|fluent|adept|"
                   r"accomplished|well-versed|versed)\s+(?:in|with|at|on)\s+(?=(?:[\w.#+/-]+\s+){0,3}?" + tool + ")",
                   "experienced with ", text, flags=re.I)
    value = re.sub(r"\b(?:(?:" + _ADJ + r")\s+)*(?:" + _LEVEL_NOUN + r")\s+(?:in|of|with|at|on)\s+(?=(?:[\w.#+/-]+\s+){0,3}?"
                   + tool + ")", "experience with ", value, flags=re.I)
    value = re.sub(r"\b(?:" + _ADJ + r")\s+(experience|background|knowledge|understanding|skills?|foundation|track record)"
                   r"\s+(in|with|of|on)\s+(?=(?:[\w.#+/-]+\s+){0,3}?" + tool + ")", r"\1 \2 ", value, flags=re.I)
    value = re.sub(r"\b(?:(?:highly|very)\s+)?(?:(?:" + _ADJ + r")[\s-]+)+(?=" + tool + ")", "", value, flags=re.I)
    value = re.sub("(" + tool + r"(?:\s*(?:,|/|and|&)\s*[\w.#+-]+){0,3})\s+(?:" + _LEVEL_NOUN + r")\b", r"\1 experience",
                   value, flags=re.I)
    return value


def _tone_generic(text: str) -> str:
    value = re.sub(r"\b(?:(?:highly|very|deeply|truly)\s+)?expert\s+(?:in|with|at|on)\b", "experienced with", text, flags=re.I)
    value = re.sub(r"\b(?:(?:" + _ADJ + r")\s+)*(?:expertise|mastery)\b", "experience", value, flags=re.I)
    value = re.sub(r"\b(?:world-class|unmatched|expert-level)\s+", "", value, flags=re.I)
    return value


def _tidy(text: str) -> str:
    value = re.sub(r"\s{2,}", " ", text).strip()
    value = re.sub(r"\s+([,.;:!?])", r"\1", value)
    value = re.sub(r"\b(a|an)\s+(?=experience\b)", "", value, flags=re.I)
    value = re.sub(r"\b([Aa])n\s+(?=[BCDFGHJKLMNPQRSTVWXZbcdfghjklmnpqrstvwxz])", r"\1 ", value)
    value = re.sub(r"\b([Aa])\s+(?=[AEIOaeio])", r"\1n ", value)
    return value


def _untime(text: str, problem: dict) -> str | None:
    """A claim without a years figure the person has not stated ('15+ years of Java' -> 'Java', 'Kubernetes (15
    years)' -> 'Kubernetes'): years_truth.without takes it out the way years_truth.enforce does, and no number is ever
    written in its place. None when the figure cannot be taken out and leave a sentence; the claim then goes whole."""
    claim, at = problem.get("claim") or "", problem.get("at")
    if not claim:
        return None
    if not isinstance(at, int) or text[at:at + len(claim)] != claim:
        at = text.find(claim)
    return years_truth.without(text, at, at + len(claim)) if at >= 0 else None


def _rewrite(text: str, problems: list) -> str | None:
    """The claim with each years figure taken out (last first, so the places of the earlier ones hold) and each level
    toned down, or None when a years figure cannot be taken out of it."""
    value = text
    for problem in sorted((p for p in problems if p["kind"] == "years"), key=lambda p: -int(p.get("at") or 0)):
        value = _untime(value, problem)
        if value is None:
            return None
    for problem in problems:
        if problem["kind"] == "level":
            value = _tone_term(value, problem["term"]) if problem.get("term") else _tone_generic(value)
    value = _tidy(value)
    return value[:1].upper() + value[1:] if value and text[:1].isupper() else value


def _drop_tools(text: str, terms) -> str | None:
    """A skills or competencies item that lists tools ("Cloud: AWS, Azure, Kubernetes") without the ones the records
    never name, or None when nothing would be left or the list cannot be split cleanly."""
    head, _colon, body = text.rpartition(":") if ":" in text else ("", "", text)
    parts = [part.strip() for part in re.split(r"\s*(?:,|;|/|\|)\s*", body) if part.strip()]
    if len(parts) < 2 or any(part.count("(") != part.count(")") for part in parts):
        return None
    kept = [part for part in parts if not any(re.search(claims_check.surface(term), part, re.I) for term in terms)]
    if not kept or len(kept) == len(parts):
        return None
    return (head.strip() + ": " if head.strip() else "") + ", ".join(kept)


def _segment_fix(text: str, problems: list, recheck) -> tuple:
    """(new text or None to remove, action). A rewrite that still carries a problem is removed instead; a listed
    item loses only the tools the records never name."""
    if problems[0]["path"][0] in ("skills", "competencies") and all(p["kind"] == "skill" for p in problems):
        trimmed = _drop_tools(text, [p["term"] for p in problems])
        if trimmed and not recheck(trimmed):
            return trimmed, "taken out of the list"
    if any(p["kind"] in _REMOVE or (p["kind"] == "title" and p["path"][-1] != "title") or p["path"][0] == "headline"
           for p in problems):
        return None, "removed"
    rewritten = _rewrite(text, problems)
    if not rewritten or rewritten == text.strip() or recheck(rewritten):
        return None, "removed"
    return rewritten, "toned down"


def _done(problem: dict, action: str) -> str:
    """What was done about one problem of a claim that was rewritten: a level is toned down; a years figure is taken
    out, never changed to another number."""
    return "years taken out" if action == "toned down" and problem["kind"] == "years" else action


def _recorded_headline(prof: dict, rec: dict) -> str:
    stated = str(((prof or {}).get("profile") or {}).get("headline") or "").strip()
    if stated:
        return stated
    current = [row for row in rec["rows"] if row["key"][0] == "R" and row["current"]] or [r for r in rec["rows"] if r["key"][0] == "R"]
    return current[0]["title"] if current else ""


def _retitle(resume: dict, path: list, problems: list, removed_entries: set) -> str:
    problem = problems[0]
    entry = resume["experience"][path[1]]
    if problem.get("employer") is False:
        removed_entries.add(path[1])
        return "removed"
    entry["title"] = problem["recorded"]
    return "put back to the recorded title"


def _edit_lists(resume: dict, edits: dict, removed_entries: set) -> None:
    for field in ("competencies", "skills"):
        items = resume.get(field)
        if isinstance(items, list):
            resume[field] = [edits.get((field, i), item) for i, item in enumerate(items) if edits.get((field, i), item) is not None]
    for section in ("experience", "additional_experience", "open_source"):
        entries = resume.get(section)
        if not isinstance(entries, list):
            continue
        for e_index, entry in enumerate(entries):
            if isinstance(entry, dict) and isinstance(entry.get("bullets"), list):
                entry["bullets"] = [edits.get((section, e_index, "bullets", b), bullet) for b, bullet in enumerate(entry["bullets"])
                                    if edits.get((section, e_index, "bullets", b), bullet) is not None]
        resume[section] = [entry for e_index, entry in enumerate(entries) if not (section == "experience" and e_index in removed_entries)]


def _edit_resume(resume: dict, edits: dict, removed_entries: set, prof: dict, rec: dict) -> None:
    if ("headline",) in edits:
        resume["headline"] = edits[("headline",)] or _recorded_headline(prof, rec)
    sentences = claims_check.split_sentences(str(resume.get("summary") or ""))
    if any(("summary", i) in edits for i in range(len(sentences))):
        kept = [edits.get(("summary", i), sentence) for i, sentence in enumerate(sentences)]
        resume["summary"] = " ".join(s for s in kept if s) or str(((prof or {}).get("profile") or {}).get("experience_summary") or "")
    _edit_lists(resume, edits, removed_entries)


def _edit_cover(cover: dict, edits: dict) -> None:
    paragraphs = []
    for p_index, paragraph in enumerate(cover.get("paragraphs") or []):
        sentences = claims_check.split_sentences(paragraph if isinstance(paragraph, str) else "")
        kept = [edits.get(("paragraphs", p_index, s), sentence) for s, sentence in enumerate(sentences)]
        joined = " ".join(sentence for sentence in kept if sentence)
        if joined.strip():
            paragraphs.append(joined)
    cover["paragraphs"] = paragraphs


def fix(data: dict, problems: list, rec: dict, job: dict, allowed, prof: dict) -> tuple:
    """
    @description Apply every problem to a copy of the packet: tone down a level in place and take a years figure the
    person has not stated out of its sentence when the claim then holds (no number is ever written in its place), put
    a résumé job's title back to the recorded one, and take out everything else (a résumé headline taken out becomes
    the recorded headline, an emptied summary the recorded summary).
    @param data - The generation. @param problems - claims_check.check() output. @param rec - records().
    @param job - {title, company, terms}. @param allowed - Row keys the letter may draw on. @param prof - The profile.
    @returns (fixed copy, [problem + action]).
    """
    out, groups, actions = copy.deepcopy(data), {}, []
    for problem in problems:
        groups.setdefault((problem["document"], tuple(problem["path"])), []).append(problem)
    edits, removed_entries = {"cover": {}, "resume": {}}, set()
    for (document, path), items in groups.items():
        if document == "resume" and path[0] == "experience" and path[-1] == "title":
            action = _retitle(out["resume"], list(path), items, removed_entries)
        else:
            owners = claims_check.owners(rec, out.get("resume") or {}, path) if document == "resume" else []
            recheck = lambda value, d=document, p=path, o=owners: bool(claims_check.segment_problems(rec, job, d, p, value, o, allowed))
            new, action = _segment_fix(items[0]["text"], items, recheck)
            edits[document][path] = new
        actions += [{**problem, "action": _done(problem, action)} for problem in items]
    if edits["cover"]:
        _edit_cover(out.setdefault("cover", {}), edits["cover"])
    _edit_resume(out.setdefault("resume", {}), edits["resume"], removed_entries, prof, rec)
    return out, actions


def letter_words(cover: dict) -> int:
    """@description Words in a letter's paragraphs. @param cover - The letter. @returns The count."""
    return sum(len(str(p).split()) for p in (cover or {}).get("paragraphs") or [])


def usable(cover: dict) -> bool:
    """@description Whether a letter is still a letter: two or more paragraphs and MIN_LETTER_WORDS words.
    @param cover - The letter. @returns bool"""
    paragraphs = [p for p in (cover or {}).get("paragraphs") or [] if str(p).strip()]
    return len(paragraphs) >= 2 and letter_words(cover) >= MIN_LETTER_WORDS


def digest(cover: dict) -> str:
    """@description The letter's fingerprint: SHA-256 of its paragraphs joined by new lines (UTF-8), the same sum
    lib/career-letter-claims.js takes, so an edited letter no longer carries this check's verdict.
    @param cover - The letter. @returns Hex digest."""
    text = "\n".join(str(p) for p in (cover or {}).get("paragraphs") or [])
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


_ACTION_WORDS = {"removed": "Career took it out.", "toned down": "Career toned it down to what your records say.",
                 "years taken out": "Career took the figure out.",
                 "taken out of the list": "Career took it out of that list.",
                 "put back to the recorded title": "Career put back your recorded title."}


def instruction(problem: dict, rec: dict) -> str:
    """
    @description One line for the model writing the letter again: what the last draft did and what to do instead.
    @param problem - One problem. @param rec - records(). @returns The line.
    """
    kind, claim = problem["kind"], problem.get("claim") or ""
    rows = {row["key"]: row for row in rec["rows"]}
    if kind == "skill":
        return f"- The draft named {claim}. The candidate's records never mention {claim}: do not name it at all."
    if kind == "level":
        return f"- The draft said “{claim}”. The records do not state that level: say only what the records say."
    if kind == "years":
        return (f"- The draft said “{claim}”. The candidate has not stated that number of years: "
                "state no number of years there at all.")
    if kind == "attribution":
        where = "; ".join(claims_check._where(rows[k]) for k in problem.get("where", []) if k in rows)
        return f"- The draft put {claim} under the wrong job. The records name it only at: {where}."
    if kind == "evidence" and problem.get("term"):
        return (f"- The draft named {claim}, which the records show only at {problem.get('where')} "
                f"({problem.get('span') or 'undated'}), outside the COVER LETTER EVIDENCE: leave it out.")
    if kind == "evidence":
        return (f"- The draft drew on {claim} ({problem.get('span') or 'undated'}), which is not in the COVER LETTER "
                "EVIDENCE: draw only on the listed work.")
    return f"- The draft used the title “{claim}”. The records do not hold it: use only recorded titles."


def _second_letter(fixed, first, rec, job, ranked, letter_may, prof, regenerate) -> tuple:
    """Write the letter again once, the first draft's problems named; keep it when it holds better than the first."""
    lines = []
    for line in (instruction(p, rec) for p in first if p["document"] == "cover"):
        if line not in lines:
            lines.append(line)
    letter = regenerate(lines)
    if not isinstance(letter, dict) or not isinstance(letter.get("paragraphs"), list):
        return fixed, [], False
    trial = {"resume": fixed.get("resume") or {}, "cover": letter}
    second = [p for p in claims_check.check(trial, rec, job, ranked) if p["document"] == "cover"]
    held, more = fix(trial, second, rec, job, letter_may, prof)
    better = usable(held["cover"]) or (not usable(fixed.get("cover")) and letter_words(held["cover"]) > letter_words(fixed.get("cover")))
    if not better:
        return fixed, [], True
    return {**fixed, "cover": held["cover"]}, [{**a, "attempt": 2} for a in more], True


def _needs_second(actions: list, fixed: dict) -> bool:
    letter = [a for a in actions if a["document"] == "cover"]
    return any(a["action"] == "removed" for a in letter) or (bool(letter) and not usable(fixed.get("cover")))


def _receipt_problem(action: dict, rec: dict) -> dict:
    return {"document": action["document"], "kind": action["kind"], "claim": str(action.get("claim") or "")[:160],
            "action": action["action"], "attempt": action.get("attempt", 1),
            "words": f'{claims_check.describe(action, rec)} {_ACTION_WORDS.get(action["action"], "")}'.strip()}


def _unique(problems: list) -> list:
    seen, out = set(), []
    for problem in problems:
        key = (problem["document"], problem["kind"], problem["claim"].lower(), problem["action"])
        if key not in seen:
            seen.add(key)
            out.append(problem)
    return out


def hold(data: dict, prof: dict, selected, posting: dict, ranked, regenerate=None, today=None) -> tuple:
    """
    @description Hold one generated packet to the person's records: check, fix, write the letter again once when the
    fix took a sentence out of it or left it too thin, and judge the letter (clean, fixed, or needs your review).
    @param data - The generation {resume, cover}. @param prof - The profile it was generated from.
    @param selected - Selected Other experience entries. @param posting - {title, company, description}.
    @param ranked - letter_evidence.rank() output. @param regenerate - fn(problem lines) -> new letter or None.
    @param today - The date "now" means. @returns (held packet, receipt for application.json).
    """
    job = {"title": posting.get("title") or "", "company": posting.get("company") or "",
           "terms": claims_check.posting_terms(posting.get("title") or "", posting.get("description") or "")}
    rec = claims_check.records(prof, selected, job["terms"], today)
    letter_may = claims_check.allowed(rec, ranked)
    first = claims_check.check(data, rec, job, ranked)
    held, actions = fix(data, first, rec, job, letter_may, prof)
    regenerated = False
    if first and regenerate and _needs_second(actions, held):
        held, more, regenerated = _second_letter(held, first, rec, job, ranked, letter_may, prof, regenerate)
        actions += more
    touched = any(a["document"] == "cover" for a in actions)
    status = "clean" if not actions else "needs_review" if touched and not usable(held.get("cover")) else "fixed"
    review = (["The cover letter is too short to send after Career took out what your records do not support. "
               "Edit it, or add what is true to your main résumé and generate it again."] if status == "needs_review" else [])
    receipt = {"version": VERSION, "status": status, "regenerated": regenerated, "review": review,
               "problems": _unique([_receipt_problem(a, rec) for a in actions])[:MAX_RECORDED],
               "letter_evidence": [row["key"] for row in ranked if row.get("chosen")],
               "ranking": [{k: row[k] for k in ("key", "relevance", "recency", "score")} for row in ranked[:8]],
               "letter_draws_on": claims_check.letter_draws_on(rec, held.get("cover") or {}),
               "cover_digest": digest(held.get("cover"))}
    return held, receipt
