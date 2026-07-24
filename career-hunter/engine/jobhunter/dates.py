"""Normalize the many posting-date formats employers use into a clean ISO date.

Handles: ISO timestamps, 'June 2, 2026', 'Posted 4 Days Ago', 'Posted 30+ Days Ago',
'Posted Today/Yesterday'. Relative dates anchor on when we first saw the posting.
"""
from __future__ import annotations
import re
from datetime import date, timedelta

from dateutil import parser as _dp

_REL_DAYS = re.compile(r"(\d+)\s*\+?\s*day", re.I)
_REL_WEEKS = re.compile(r"(\d+)\s*\+?\s*week", re.I)
_REL_MONTHS = re.compile(r"(\d+)\s*\+?\s*month", re.I)


def normalize(posted_at, anchor_iso: str | None = None) -> str | None:
    """Return a 'YYYY-MM-DD' string, or None if unparseable."""
    if not posted_at:
        return None
    s = str(posted_at).strip()
    low = s.lower()

    anchor = None
    if anchor_iso:
        try:
            anchor = date.fromisoformat(str(anchor_iso)[:10])
        except Exception:
            anchor = None
    if anchor is None:
        anchor = date.today()

    if "today" in low or "just posted" in low:
        return anchor.isoformat()
    if "yesterday" in low:
        return (anchor - timedelta(days=1)).isoformat()
    if "ago" in low or low.startswith("posted"):
        m = _REL_DAYS.search(low)
        if m:
            return (anchor - timedelta(days=int(m.group(1)))).isoformat()
        m = _REL_WEEKS.search(low)
        if m:
            return (anchor - timedelta(weeks=int(m.group(1)))).isoformat()
        m = _REL_MONTHS.search(low)
        if m:
            return (anchor - timedelta(days=30 * int(m.group(1)))).isoformat()

    # ISO fast path
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return m.group(0)
    # absolute named/standard dates
    try:
        d = _dp.parse(s, fuzzy=True)
        return d.date().isoformat()
    except Exception:
        return None
