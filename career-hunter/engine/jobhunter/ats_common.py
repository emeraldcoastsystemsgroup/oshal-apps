# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Keep the existing common readers in a bounded provider module; ats retains their registry and public names.
from __future__ import annotations
import re
from html import unescape

_TAG = re.compile(r"<[^>]+>")

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

