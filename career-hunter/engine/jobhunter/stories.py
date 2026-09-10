"""Role-anchored story review — one defensible story per job title (ADR-141 D7).

A resume bullet asserts; a story proves. This walks the candidate's OWN roles, asks about the
one they can still speak to, and turns the answer into a story ATTACHED to that role and to the
bullet it supports, so the resume and cover generators can cite evidence instead of an adjective.

Two things keep it honest:

  * It never invents. The story text is the candidate's own answer, distilled at most into
    tighter prose; a bullet is only attached when it is one the role already carries.
  * It works with no AI. When no provider is reachable the answer is stored verbatim and the
    supporting bullet is chosen by word overlap, so the review is never blocked on a key. The
    record says which path wrote it (`source`), so nothing later has to guess.

The unit of work is the ROLE, not the skill gap: gaps.py already owns the skill-theme axis
(`gap_themes`), and this deliberately does not touch it.
"""
from __future__ import annotations

import json
import re

from . import db, enrich, profile

SYS = (
    "You distil a candidate's spoken answer into ONE short, concrete STAR-shaped story for their "
    "resume. Use ONLY what the answer states — never add a metric, a technology, or an outcome "
    "that is not there. Prefer their own words. If the answer carries no real evidence, say so."
)

_MAX_RESPONSE_CHARS = 6000
_MAX_STORY_CHARS = 1200
_STOPWORDS = {
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'over', 'their', 'they', 'was',
    'were', 'have', 'has', 'had', 'our', 'its', 'his', 'her', 'been', 'are', 'not', 'but', 'all',
    'new', 'per', 'via', 'across', 'using', 'used', 'work', 'worked', 'team', 'teams',
}


def _roles(raw: dict) -> list:
    """@description The profile's role list, tolerating a profile that has none yet."""
    roles = raw.get("roles")
    return [r for r in roles if isinstance(r, dict)] if isinstance(roles, list) else []


def _stories_of(role: dict) -> list:
    """@description The stories already attached to one role (never None)."""
    items = role.get("stories")
    return [s for s in items if isinstance(s, dict)] if isinstance(items, list) else []


def _bullets_of(role: dict) -> list:
    """@description The role's resume bullets, which are the only bullets a story may cite."""
    items = role.get("deliverables")
    return [str(b) for b in items if str(b).strip()] if isinstance(items, list) else []


def _label(role: dict, index: int) -> str:
    """@description A human label for a role, for questions and audit lines."""
    title = str(role.get("title") or "").strip()
    org = str(role.get("org") or "").strip()
    if title and org:
        return f"{title} at {org}"
    return title or org or f"role {index + 1}"


def _words(text: str) -> set:
    """@description Content words used to match an answer to the bullet it supports."""
    return {w for w in re.findall(r"[a-z0-9]+", str(text).lower()) if len(w) > 2 and w not in _STOPWORDS}


def _best_bullet(response: str, bullets: list) -> str:
    """
    @description The role bullet an answer best supports, by content-word overlap. This is the
    no-AI path and the validator for the AI path: a cited bullet must be one the role carries,
    so a model can never attach a story to a bullet that does not exist.
    @param response - The candidate's answer.
    @param bullets - The role's own bullets.
    @returns The best-matching bullet, or '' when nothing overlaps.
    """
    answer_words = _words(response)
    if not answer_words or not bullets:
        return ""
    best, best_score = "", 0
    for bullet in bullets:
        score = len(answer_words & _words(bullet))
        if score > best_score:
            best, best_score = bullet, score
    return best


def state() -> dict:
    """
    @description The review's state: every role with its story count, and which role is next.
    Read-only — this is what the surface and the readiness probe render.
    @returns {roles: [...], total, withStory, complete, next}
    """
    raw = profile.load()
    roles = _roles(raw)
    out = []
    for index, role in enumerate(roles):
        stories = _stories_of(role)
        out.append({
            "index": index,
            "label": _label(role, index),
            "title": str(role.get("title") or ""),
            "org": str(role.get("org") or ""),
            "bullets": _bullets_of(role),
            "stories": stories,
            "hasStory": bool(stories),
        })
    pending = [r for r in out if not r["hasStory"]]
    with_story = len(out) - len(pending)
    return {
        "roles": out,
        "total": len(out),
        "withStory": with_story,
        "complete": bool(out) and not pending,
        "next": ({"index": pending[0]["index"], "label": pending[0]["label"],
                  "question": question_for(pending[0])} if pending else None),
    }


def question_for(role_state: dict) -> str:
    """
    @description The question asked about one role. Built from the role's OWN bullets so it is
    specific without spending a token — the generic "tell me about a challenge" prompt is what
    makes people abandon this kind of review.
    @param role_state - One entry from state()['roles'].
    @returns The question text.
    """
    label = role_state.get("label") or "this role"
    bullets = role_state.get("bullets") or []
    if bullets:
        lead = bullets[0].strip().rstrip('.')
        return (f"At {label} your resume says: \"{lead}\". Walk me through one time you actually did "
                f"that — what the situation was, what you personally decided or built, and how it "
                f"turned out. Numbers if you have them.")
    return (f"Tell me about one thing you did at {label} that you would want an interviewer to hear — "
            f"the situation, what you personally did, and the result.")


def _distil(response: str, role_state: dict) -> dict:
    """
    @description Ask the provider to tighten the answer into a story and name the bullet it
    supports. Returns {} when no provider is reachable or the reply is unusable, which is the
    signal to take the verbatim path.
    @param response - The candidate's answer.
    @param role_state - The role being reviewed.
    @returns The parsed model object, or {}.
    """
    bullets = role_state.get("bullets") or []
    prompt = (
        f"ROLE: {role_state.get('label')}\n"
        f"THE ROLE'S RESUME BULLETS:\n" + "\n".join(f"- {b}" for b in bullets[:12]) + "\n\n"
        f"THE CANDIDATE'S ANSWER:\n{response[:_MAX_RESPONSE_CHARS]}\n\n"
        "Return STRICT JSON only:\n{\n"
        '  "story": "3-5 sentences in the candidate\'s own voice: situation, what THEY did, result. '
        'Only facts present in the answer.",\n'
        '  "bullet": "the ONE bullet above this story supports, copied exactly, or \\"\\" if none fit",\n'
        '  "title": "a 3-6 word handle for this story",\n'
        '  "evidence": true|false  // false when the answer carries no concrete evidence\n}'
    )
    try:
        return enrich.parse_json(enrich.complete(SYS, prompt, max_tokens=900)) or {}
    except Exception:  # noqa: BLE001 — no provider is an ordinary state, not a failure
        return {}


def record(index: int, response: str) -> dict:
    """
    @description Attach one story to one role and persist the profile atomically.

    The answer is always kept. When a provider is reachable the story is its distilled form and
    the cited bullet is validated against the role's own bullets; otherwise the answer is stored
    verbatim with the best-overlapping bullet. Either way `source` records which happened and
    `answer` keeps what the candidate actually said.

    @param index - The role's index in the profile.
    @param response - The candidate's answer, non-empty.
    @returns {ok, role, story} or {ok: False, error}.
    """
    text = (response or "").strip()
    if not text:
        return {"ok": False, "error": "empty response"}
    raw = profile.load()
    roles = _roles(raw)
    if index < 0 or index >= len(roles):
        return {"ok": False, "error": f"no role at index {index}"}
    role = roles[index]
    role_state = {"label": _label(role, index), "bullets": _bullets_of(role)}

    distilled = _distil(text[:_MAX_RESPONSE_CHARS], role_state)
    story_text = str(distilled.get("story") or "").strip()
    source = "ai"
    if not story_text:
        story_text, source = text, "verbatim"
    # A model may only cite a bullet the role actually carries; anything else falls back to the
    # deterministic match, so a story can never point at a bullet that does not exist.
    bullet = str(distilled.get("bullet") or "").strip()
    if bullet not in role_state["bullets"]:
        bullet = _best_bullet(text, role_state["bullets"])

    story = {
        "at": db.now(),
        "title": str(distilled.get("title") or "").strip()[:120],
        "story": story_text[:_MAX_STORY_CHARS],
        "bullet": bullet,
        "answer": text[:_MAX_RESPONSE_CHARS],
        "source": source,
    }
    if distilled.get("evidence") is False:
        story["weak"] = True

    role.setdefault("stories", []).append(story)
    profile.save(raw)
    return {"ok": True, "role": _label(role, index), "index": index, "story": story}


def cited_for(role: dict, limit: int = 2) -> list:
    """
    @description The stories a generator may cite for one role, strongest first. A story the
    model flagged as carrying no real evidence is never offered as proof.
    @param role - One profile role.
    @param limit - Maximum stories to return.
    @returns Story records.
    """
    usable = [s for s in _stories_of(role) if s.get("story") and not s.get("weak")]
    return usable[:max(0, limit)]


def as_json(value) -> str:
    """@description Compact JSON for the CLI's single-line contract."""
    return json.dumps(value, ensure_ascii=False)
