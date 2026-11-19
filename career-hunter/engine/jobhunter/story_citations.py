# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.15: extract ADR-141 D7 story citation helpers from generate.py into a dedicated module to keep generate.py well under the 1,000-line house limit; re-exported unchanged from generate.py.
"""Story evidence prompt block and citation verification (ADR-141 D7)."""
from __future__ import annotations

import re

_STORY_PROMPT_CHARS = 700
_STORY_PER_ROLE = 2


def _norm_key(text) -> str:
    """@description Comparison form for a title, org or citation: whitespace-collapsed lowercase."""
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def _usable_stories(role: dict) -> list:
    """@description Recorded, non-empty, non-weak stories on one role, bounded for the prompt."""
    items = role.get("stories")
    if not isinstance(items, list):
        return []
    usable = [s for s in items
              if isinstance(s, dict) and str(s.get("story") or "").strip() and not s.get("weak")]
    return usable[:_STORY_PER_ROLE]


def story_evidence_suffix(prof: dict) -> str:
    """@description The EVIDENCE block appended to the generation prompt, or '' when the profile holds no stories."""
    blocks = []
    for role in (prof or {}).get("roles") or []:
        if not isinstance(role, dict):
            continue
        usable = _usable_stories(role)
        if not usable:
            continue
        lines = [f"ROLE: {str(role.get('title') or '').strip()} at {str(role.get('org') or '').strip()}"]
        for story in usable:
            if story.get("title"):
                lines.append(f'  STORY "{str(story["title"])[:120]}"')
            if story.get("bullet"):
                lines.append(f'    supports the bullet: "{str(story["bullet"])[:300]}"')
            lines.append(f"    in the candidate's own words: {str(story['story'])[:_STORY_PROMPT_CHARS]}")
        blocks.append("\n".join(lines))
    if not blocks:
        return ""
    return (
        "\n\nEVIDENCE THE CANDIDATE TOLD YOU, role by role — their own words, recorded in the story "
        "review. This is the proof behind the bullets:\n"
        + "\n".join(blocks)
        + "\n\nUSE IT: for every role listed above, at least ONE of that role's resume bullets must be "
        "drawn from its story, and the cover letter's proof points must come from these stories where "
        "one fits. Add NOTHING the story does not say, and NEVER move a story to a different role. In "
        "each \"experience\" entry return ONE more key:\n"
        '  "story_evidence": ["the exact STORY title you drew from, copied from the list above — or '
        'that story\'s opening sentence when it has no title; [] when you drew from none"]\n'
    )


def _match_role(entry: dict, roles: list) -> dict:
    """@description The profile role a generated experience entry belongs to, by employer then title."""
    org, title = _norm_key(entry.get("org")), _norm_key(entry.get("title"))
    pool = [r for r in roles if org and _norm_key(r.get("org")) == org] or list(roles)
    exact = [r for r in pool if title and _norm_key(r.get("title")) == title]
    if exact:
        return exact[0]
    return pool[0] if len(pool) == 1 else {}


def _cited_story(citation, role: dict) -> dict:
    """@description The story a citation names, or {} when the role carries no such story."""
    wanted = _norm_key(citation)
    if not wanted:
        return {}
    for story in _usable_stories(role):
        title, text = _norm_key(story.get("title")), _norm_key(story.get("story"))
        if title and wanted == title:
            return story
        if text and (text.startswith(wanted[:200]) or wanted.startswith(text[:200])):
            return story
    return {}


def collect_story_citations(data: dict, prof: dict) -> list:
    """@description Verify the packet's story citations against the profile and remove the story_evidence key."""
    roles = [r for r in ((prof or {}).get("roles") or []) if isinstance(r, dict)]
    entries = ((data or {}).get("resume") or {}).get("experience")
    if not isinstance(entries, list):
        return []
    cited = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        claimed = entry.pop("story_evidence", None)
        if not isinstance(claimed, list) or not roles:
            continue
        role = _match_role(entry, roles)
        if not role:
            continue
        for citation in claimed[:_STORY_PER_ROLE]:
            story = _cited_story(citation, role)
            if story:
                cited.append({
                    "role": str(role.get("title") or ""),
                    "org": str(role.get("org") or ""),
                    "title": str(story.get("title") or ""),
                    "bullet": str(story.get("bullet") or ""),
                    "story": str(story.get("story") or ""),
                })
    return cited
