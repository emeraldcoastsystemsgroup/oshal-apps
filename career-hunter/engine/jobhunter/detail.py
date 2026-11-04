# CHANGE LOG
# 2 | maintainer@emeraldcoastsystemsgroup.com | Keep explicit JSON-LD pay units/currency and raw evidence while leaving missing or unsupported fields unknown.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Resolve exact employer Workday details from its HTTPS posting URL even when the company feed is an aggregator.
"""Universal job-detail fetcher: pull a clean description (+ date + salary) for ONE
posting. Strategy:
  1. The connector's own detail() (Workday / SmartRecruiters) — most reliable.
  2. JSON-LD JobPosting embedded in the job page (schema.org, present on most career
     sites for Google Jobs) — gives description, datePosted, and baseSalary.
  3. Fallback: strip the main page text.
"""
from __future__ import annotations
import json
import re
from html import unescape
from urllib.parse import urlsplit

from . import http, ats
from .salary_text import normalize_currency, normalize_period

_TAG = re.compile(r"<[^>]+>")


def _clean(s):
    if not s:
        return None
    return unescape(_TAG.sub(" ", s)).replace("\xa0", " ").strip() or None


def _walk(obj):
    """Yield every dict in a possibly-nested JSON-LD structure."""
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


def _from_jsonld(html: str) -> dict:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = tag.string or tag.get_text() or ""
        try:
            data = json.loads(raw)
        except Exception:
            continue
        for obj in _walk(data):
            t = obj.get("@type")
            if t == "JobPosting" or (isinstance(t, list) and "JobPosting" in t):
                out = {"description": _clean(obj.get("description"))}
                if obj.get("datePosted"):
                    out["posted_at"] = obj["datePosted"]
                sal = obj.get("baseSalary") or {}
                val = sal.get("value") if isinstance(sal, dict) else None
                if isinstance(val, dict):
                    lo, hi = val.get("minValue"), val.get("maxValue") or val.get("value")
                    if lo or hi:
                        out["salary_min"] = float(lo) if lo else None
                        out["salary_max"] = float(hi) if hi else (float(lo) if lo else None)
                        out["salary_currency"] = normalize_currency(sal.get("currency"))
                        out["salary_period"] = normalize_period(val.get("unitText"))
                        out["salary_raw"] = json.dumps(sal, ensure_ascii=False, separators=(',', ':'))
                if out.get("description"):
                    return out
    return {}


def fetch(ats_type: str, ats_token: str, ats_job_id: str, url: str) -> dict:
    """Best clean detail for one posting. Returns {} or {description, [posted_at], [salary_*]}."""
    # Aggregator listings may point to an employer's Workday posting while the
    # company's feed remains Phenom. The URL carries the exact tenant/site/path.
    if url:
        parsed = urlsplit(url)
        host = re.fullmatch(r'([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com', parsed.hostname or '', re.I)
        parts = parsed.path.split('/job/', 1)
        if parsed.scheme == 'https' and host and len(parts) == 2 and not parsed.username and not parsed.password:
            site = parts[0].strip('/').split('/')[-1]
            external = '/job/' + parts[1].removesuffix('/apply').rstrip('/')
            if re.fullmatch(r'[a-zA-Z0-9_-]+', site):
                d = ats.fetch_detail('workday', ':'.join([host[1],host[2],site]), external, url)
                if d.get('description'):
                    return d
    # 1) structured connector detail (Workday / SmartRecruiters)
    d = ats.fetch_detail(ats_type, ats_token, ats_job_id, url)
    if d.get("description"):
        return d
    # 2) JSON-LD on the job page
    if url:
        try:
            r = http.get_once(url, timeout=12)
            if r.ok and r.text:
                d = _from_jsonld(r.text)
                if d.get("description"):
                    return d
        except Exception:
            pass
    return d or {}
