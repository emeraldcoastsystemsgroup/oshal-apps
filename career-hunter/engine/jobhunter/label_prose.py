# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | A cover letter read "In my own open-source work on <project> | independent product, I designed and operate ...": the person's Other experience entry is labelled "<project> | independent product", the model copied the label whole into a sentence, and no pass after the model looked at it. name() is a recorded label as a sentence names it (the text before its first " | "), and rewrite() is a last pass over a generated packet, decided by code: in the letter's paragraphs and the résumé's summary and bullets, a label the person's own records hold with a " | descriptor" tail is written as that name. A line of columns separated by bars (a role's "title | organization | dates" heading, the contact line), a résumé entry's own title, organization and dates, the headline and the skill lists are never touched, and a packet with no such label in a sentence is handed back itself.
"""A recorded organization or project label written in a sentence: the name before the bar, never "name | descriptor".

The labels are read from the person's records every time (their jobs, client engagements, the Other experience chosen
for the application and a saved portfolio); nothing about any one person or project is written in this file.
"""
from __future__ import annotations

import copy
import re

from . import letter_evidence

_BAR = re.compile(r"\s+\|\s+")
# The résumé sections whose entries carry bullets; an entry's title, org and span are a heading's columns, not sentences.
_BULLET_SECTIONS = ("experience", "additional_experience", "open_source")


def name(label) -> str:
    """@description A recorded label as a sentence names it: the text before its first " | ", or the label itself
    when it carries no bar.
    @param label - A recorded title, employer, project or organization. @returns The name ('' for no label)."""
    text = str(label or "").strip()
    return _BAR.split(text, 1)[0].strip()


def _recorded(prof, selected) -> list:
    """@description Every title and organization label the person's records hold: each job, each client engagement,
    each Other experience entry chosen for this application (letter_evidence.entries) and the saved portfolio.
    @param prof - The profile the packet was generated from. @param selected - The chosen Other experience entries.
    @returns The labels as recorded."""
    found = [row[key] for row in letter_evidence.entries(prof, selected) for key in ("title", "org")]
    portfolio = (prof or {}).get("oss_portfolio") if isinstance(prof, dict) else None
    if isinstance(portfolio, dict):
        entry = portfolio.get("entry") if isinstance(portfolio.get("entry"), dict) else {}
        found += [portfolio.get("name"), portfolio.get("label"), entry.get("org"), entry.get("title")]
    return [value for value in found if isinstance(value, str) and value.strip()]


def labels(prof, selected=(), fold=None) -> list:
    """@description The person's recorded labels that carry a " | descriptor" tail, each split at its bars, the
    longest first and each once. With `fold`, a label is also taken the way the packet's text cleanup would have left
    it (a dash in a recorded name reaches a sentence as a comma).
    @param prof - The profile. @param selected - The chosen Other experience entries.
    @param fold - The packet's text cleanup (generate._dewash), or None. @returns [[name, tail part, ...], ...]."""
    seen, out = set(), []
    for raw in _recorded(prof, selected):
        for text in ((raw, fold(raw)) if fold else (raw,)):
            parts = [part.strip() for part in _BAR.split(str(text or "").strip())]
            key = " | ".join(parts).casefold()
            if len(parts) < 2 or not all(parts) or not re.search(r"\w", parts[0]) or key in seen:
                continue
            seen.add(key)
            out.append(parts)
    return sorted(out, key=lambda parts: (-len(" | ".join(parts)), parts))


def _words(text: str) -> str:
    """@description A regular expression for a piece of a label, its words separated by any white space.
    @param text - The piece. @returns The expression."""
    return r"\s+".join(re.escape(word) for word in text.split())


def _pattern(found: list):
    """@description One expression that finds any of the labels in a line: the name (captured, in a group named for
    the label's place) followed by its tail, whole or cut short after any of its parts, in any capitals.
    @param found - labels(). @returns The compiled expression."""
    choices = []
    for index, parts in enumerate(found):
        tail = ""
        for part in reversed(parts[1:]):
            tail = r"\s*\|\s*" + _words(part) + (f"(?:{tail})?" if tail else "")
        choices.append(f"(?P<n{index}>{_words(parts[0])}){tail}")
    return re.compile(r"(?<!\w)(?:" + "|".join(choices) + r")(?!\w)", re.I)


def _plain(text: str, pattern, path: str, changes: list) -> str:
    """@description One string with each recorded label in a sentence written as its name. A line that still holds a
    bar once the labels are taken out is a line of columns, and a line that holds nothing else is the label itself:
    both are left as they are.
    @param text - A paragraph, the summary or a bullet. @param pattern - _pattern(). @param path - Where it sits.
    @param changes - The list each rewrite is appended to. @returns The string."""
    if "|" not in text:
        return text
    lines = text.split("\n")
    for index, line in enumerate(lines):
        rest = pattern.sub("", line)
        if rest == line or "|" in rest or not re.search(r"\w", rest):
            continue
        hits = []
        lines[index] = pattern.sub(lambda match: hits.append(match) or match.group(match.lastgroup), line)
        changes += [{"path": path, "from": match.group(0), "to": match.group(match.lastgroup)} for match in hits]
    return "\n".join(lines)


def _plain_list(items, pattern, path: str, changes: list):
    """@description A list with each of its strings passed through _plain. @param items - The list (or anything else,
    handed back). @param pattern - _pattern(). @param path - Where the list sits. @param changes - The rewrites.
    @returns The list."""
    if not isinstance(items, list):
        return items
    return [_plain(item, pattern, f"{path}.{index}", changes) if isinstance(item, str) else item
            for index, item in enumerate(items)]


def _plain_resume(resume: dict, pattern, changes: list) -> None:
    """@description The résumé's sentences: its summary and each entry's bullets. The headline, the skill lists and an
    entry's title, organization and dates are columns and stay.
    @param resume - The résumé, changed in place. @param pattern - _pattern(). @param changes - The rewrites.
    @returns None."""
    if isinstance(resume.get("summary"), str):
        resume["summary"] = _plain(resume["summary"], pattern, "resume.summary", changes)
    for section in _BULLET_SECTIONS:
        entries = resume.get(section)
        for index, entry in enumerate(entries if isinstance(entries, list) else []):
            if isinstance(entry, dict) and "bullets" in entry:
                entry["bullets"] = _plain_list(entry["bullets"], pattern, f"resume.{section}.{index}.bullets", changes)


def rewrite(data, prof, selected=(), fold=None) -> tuple:
    """@description The last pass over a generated packet's sentences: a label the person's records hold with a
    " | descriptor" tail is written as the name before the bar in the letter's paragraphs and the résumé's summary and
    bullets. Decided by code, after every model pass; heading lines and heading fields are left alone.
    @param data - The generated packet {resume, cover}. @param prof - The profile it was generated from.
    @param selected - The Other experience chosen for the packet. @param fold - The packet's text cleanup, or None.
    @returns (packet, [{path, from, to}]); the packet itself, untouched, when no sentence held such a label."""
    found = labels(prof, selected, fold) if isinstance(data, dict) else []
    if not found:
        return data, []
    pattern, changes, out = _pattern(found), [], copy.deepcopy(data)
    cover = out.get("cover")
    if isinstance(cover, dict) and "paragraphs" in cover:
        cover["paragraphs"] = _plain_list(cover["paragraphs"], pattern, "cover.paragraphs", changes)
    if isinstance(out.get("resume"), dict):
        _plain_resume(out["resume"], pattern, changes)
    return (out, changes) if changes else (data, [])
