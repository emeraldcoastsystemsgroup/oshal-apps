# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Keep the existing common readers in a bounded provider module; ats retains their registry and public names.
# 2 | maintainer@emeraldcoastsystemsgroup.com | detail_text: join a posting's detail sections, HTML stripped as the Workday reader strips it, and give nothing for text longer than a saved copy may hold (job_context.MAX_CHARS) rather than a cut copy marked whole.
from __future__ import annotations
import re
from html import unescape

_TAG = re.compile(r"<[^>]+>")
DETAIL_MAX_CHARS = 64000  # job_context.MAX_CHARS: a saved copy is whole or absent, never cut.

def _strip_html(s: str | None) -> str | None:
    if not s:
        return s
    return unescape(_TAG.sub(" ", s)).strip()



def _jsonld_description(html: str | None) -> str | None:
    """Pull a JobPosting description from any schema.org JSON-LD block on a page.
    More tolerant than detail._from_jsonld (handles @graph, lists, and nested objects)."""
    import json as _json

    for m in re.finditer(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', html or "", re.S):
        try:
            # strict=False: some sites (e.g. SAIC) embed literal newlines in the description
            obj = _json.loads(m.group(1).strip(), strict=False)
        except Exception:
            continue
        stack = [obj]
        while stack:
            cur = stack.pop()
            if isinstance(cur, list):
                stack.extend(cur)
            elif isinstance(cur, dict):
                if "JobPosting" in str(cur.get("@type", "")) and cur.get("description"):
                    return _strip_html(cur["description"])
                stack.extend(cur.values())
    return None


def detail_text(*sections: str | None) -> str | None:
    """One posting's description from its detail sections in order, or None when empty or too long to keep whole."""
    text = _strip_html("\n\n".join(s for s in sections if isinstance(s, str) and s.strip()))
    if not text or len(text) > DETAIL_MAX_CHARS:
        return None
    return text
