"""Connectors for the major Applicant Tracking Systems (ATS).

Each connector pulls postings straight from the employer's own ATS feed — the same
data that powers their corporate careers page. No aggregators.

A connector exposes:
    NAME
    fetch(token) -> list[dict]          # normalized postings
    detect(url)  -> token | None        # recognize this ATS from a careers URL
    probe(slug)  -> token | None        # best-effort: does `slug` resolve here?

Normalized posting dict:
    {ats_job_id, title, location, remote, department, url, description, posted_at}
"""
from __future__ import annotations
import re
from html import unescape

from . import http

_TAG = re.compile(r"<[^>]+>")


def _strip_html(s: str | None) -> str | None:
    if not s:
        return s
    return unescape(_TAG.sub(" ", s)).strip()


def _looks_remote(*parts) -> int:
    blob = " ".join(p for p in parts if p).lower()
    return int("remote" in blob or "work from home" in blob or "anywhere" in blob)


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


_MONEY = re.compile(r"\$?\s*([0-9]{2,3}(?:[,.][0-9]{3})*|[0-9]+(?:\.[0-9]+)?)\s*([kK])?")
_PERIOD = re.compile(r"\b(year|annual|yr|hour|hr|month|mo)\b", re.I)


def _parse_salary(text):
    """Best-effort parse of a salary string -> dict(min,max,currency,period,raw) or None."""
    if not text:
        return None
    raw = text.strip()
    nums = []
    for m in _MONEY.finditer(raw):
        val = float(m.group(1).replace(",", ""))
        if m.group(2):  # 'k'
            val *= 1000
        if val >= 1000:  # ignore stray small numbers
            nums.append(val)
    if not nums:
        return None
    pm = _PERIOD.search(raw)
    period = "year"
    if pm:
        p = pm.group(1).lower()
        period = "hour" if p in ("hour", "hr") else "month" if p in ("month", "mo") else "year"
    cur = "GBP" if "£" in raw else "EUR" if "€" in raw else "USD"
    return {"min": min(nums), "max": max(nums), "currency": cur, "period": period, "raw": raw}


# ── Greenhouse ───────────────────────────────────────────────────────────────
class Greenhouse:
    NAME = "greenhouse"
    _URL = re.compile(r"(?:boards|job-boards)\.greenhouse\.io/(?:embed/job_board\?for=)?([a-z0-9_-]+)", re.I)

    @classmethod
    def fetch(cls, token):
        data = http.get_json(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true")
        out = []
        for j in (data or {}).get("jobs", []):
            loc = (j.get("location") or {}).get("name")
            depts = ", ".join(d.get("name", "") for d in j.get("departments", []) if d.get("name"))
            out.append({
                "ats_job_id": j.get("id"),
                "title": j.get("title"),
                "location": loc,
                "remote": _looks_remote(loc, j.get("title")),
                "department": depts or None,
                "url": j.get("absolute_url"),
                "description": _strip_html(j.get("content")),
                "posted_at": j.get("updated_at"),
            })
        return out

    @classmethod
    def detect(cls, url):
        m = cls._URL.search(url or "")
        return m.group(1) if m else None

    @classmethod
    def probe(cls, slug):
        d = http.get_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs")
        return slug if d and d.get("jobs") else None


# ── Lever ────────────────────────────────────────────────────────────────────
class Lever:
    NAME = "lever"
    _URL = re.compile(r"jobs\.(?:eu\.)?lever\.co/([a-z0-9_-]+)", re.I)

    @classmethod
    def fetch(cls, token):
        data = http.get_json(f"https://api.lever.co/v0/postings/{token}?mode=json")
        out = []
        for j in (data or []):
            cat = j.get("categories") or {}
            loc = cat.get("location")
            rec = {
                "ats_job_id": j.get("id"),
                "title": j.get("text"),
                "location": loc,
                "remote": _looks_remote(loc, cat.get("commitment"), j.get("workplaceType")),
                "department": cat.get("team"),
                "url": j.get("hostedUrl"),
                "description": _strip_html(j.get("descriptionPlain") or j.get("description")),
                "posted_at": j.get("createdAt"),
            }
            sal = _parse_salary(j.get("salaryDescription") or (j.get("salaryRange") or {}).get("text"))
            if sal:
                rec.update(salary_min=sal["min"], salary_max=sal["max"],
                           salary_currency=sal["currency"], salary_period=sal["period"], salary_raw=sal["raw"])
            out.append(rec)
        return out

    @classmethod
    def detect(cls, url):
        m = cls._URL.search(url or "")
        return m.group(1) if m else None

    @classmethod
    def probe(cls, slug):
        d = http.get_json(f"https://api.lever.co/v0/postings/{slug}?mode=json")
        return slug if isinstance(d, list) and d else None


# ── Ashby ────────────────────────────────────────────────────────────────────
class Ashby:
    NAME = "ashby"
    _URL = re.compile(r"jobs\.ashbyhq\.com/([a-z0-9_.-]+)", re.I)

    @classmethod
    def fetch(cls, token):
        data = http.get_json(
            f"https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true"
        )
        out = []
        for j in (data or {}).get("jobs", []):
            loc = j.get("location")
            rec = {
                "ats_job_id": j.get("id"),
                "title": j.get("title"),
                "location": loc,
                "remote": int(bool(j.get("isRemote"))) or _looks_remote(loc),
                "department": j.get("departmentName") or j.get("teamName"),
                "url": j.get("jobUrl") or j.get("applyUrl"),
                "description": _strip_html(j.get("descriptionPlain") or j.get("descriptionHtml")),
                "posted_at": j.get("publishedDate") or j.get("publishedAt"),
            }
            comp = j.get("compensation") or {}
            sal = _parse_salary(comp.get("compensationTierSummary") or comp.get("summary"))
            if sal:
                rec.update(salary_min=sal["min"], salary_max=sal["max"],
                           salary_currency=sal["currency"], salary_period=sal["period"], salary_raw=sal["raw"])
            out.append(rec)
        return out

    @classmethod
    def detect(cls, url):
        m = cls._URL.search(url or "")
        return m.group(1) if m else None

    @classmethod
    def probe(cls, slug):
        d = http.get_json(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
        return slug if d and d.get("jobs") else None


# ── SmartRecruiters ──────────────────────────────────────────────────────────
class SmartRecruiters:
    NAME = "smartrecruiters"
    _URL = re.compile(r"(?:jobs|careers)\.smartrecruiters\.com/([a-z0-9_-]+)", re.I)

    @classmethod
    def fetch(cls, token):
        out, offset = [], 0
        while True:
            data = http.get_json(
                f"https://api.smartrecruiters.com/v1/companies/{token}/postings?limit=100&offset={offset}"
            )
            if not data:
                break
            for j in data.get("content", []):
                loc = j.get("location") or {}
                loc_str = ", ".join(x for x in [loc.get("city"), loc.get("region"), loc.get("country")] if x)
                out.append({
                    "ats_job_id": j.get("id"),
                    "title": j.get("name"),
                    "location": loc_str or None,
                    "remote": int(bool(loc.get("remote"))) or _looks_remote(loc_str),
                    "department": (j.get("department") or {}).get("label"),
                    "url": f"https://jobs.smartrecruiters.com/{token}/{j.get('id')}",
                    "description": None,  # full text needs a per-posting call; skipped for speed
                    "posted_at": j.get("releasedDate"),
                })
            total = data.get("totalFound", 0)
            offset += 100
            if offset >= total or not data.get("content"):
                break
        return out

    @classmethod
    def detect(cls, url):
        m = cls._URL.search(url or "")
        return m.group(1) if m else None

    @classmethod
    def probe(cls, slug):
        d = http.get_json(f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=1")
        return slug if d and d.get("content") else None

    @classmethod
    def detail(cls, token, job_id, url=None):
        """Fetch the full job-ad text for one posting (SmartRecruiters omits it from the list)."""
        d = http.get_json(f"https://api.smartrecruiters.com/v1/companies/{token}/postings/{job_id}")
        if not d:
            return {}
        sections = ((d.get("jobAd") or {}).get("sections") or {})
        parts = [(sections.get(k) or {}).get("text") for k in
                 ("jobDescription", "qualifications", "additionalInformation", "companyDescription")]
        desc = _strip_html("\n\n".join(p for p in parts if p))
        return {"description": desc or None}


# ── Workable ─────────────────────────────────────────────────────────────────
class Workable:
    NAME = "workable"
    _URL = re.compile(r"(?:apply\.workable\.com/([a-z0-9_-]+)|([a-z0-9_-]+)\.workable\.com)", re.I)

    @classmethod
    def fetch(cls, token):
        data = http.get_json(f"https://apply.workable.com/api/v1/widget/accounts/{token}?details=true")
        jobs = (data or {}).get("jobs", []) if isinstance(data, dict) else []
        out = []
        for j in jobs:
            loc = j.get("location") or {}
            loc_str = ", ".join(x for x in [loc.get("city"), loc.get("region"), loc.get("country")] if x) \
                if isinstance(loc, dict) else str(loc)
            out.append({
                "ats_job_id": j.get("shortcode") or j.get("id"),
                "title": j.get("title"),
                "location": loc_str or None,
                "remote": int(bool(j.get("remote"))) or _looks_remote(loc_str),
                "department": j.get("department"),
                "url": j.get("url") or j.get("application_url")
                       or f"https://apply.workable.com/{token}/j/{j.get('shortcode')}",
                "description": _strip_html(j.get("description")),
                "posted_at": j.get("published_on") or j.get("created_at"),
            })
        return out

    @classmethod
    def detect(cls, url):
        m = cls._URL.search(url or "")
        return (m.group(1) or m.group(2)) if m else None

    @classmethod
    def probe(cls, slug):
        d = http.get_json(f"https://apply.workable.com/api/v1/widget/accounts/{slug}")
        return slug if isinstance(d, dict) and d.get("jobs") is not None else None


# ── Workday ──────────────────────────────────────────────────────────────────
# Workday is per-tenant. token format = "tenant:dc:site"
#   e.g. nvidia:wd5:NVIDIAExternalCareerSite   ->
#        https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs
class Workday:
    NAME = "workday"
    _URL = re.compile(r"https?://([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com/(?:[a-z-]+/)?([^/?#]+)", re.I)

    @staticmethod
    def _parts(token):
        tenant, dc, site = token.split(":")
        return tenant, dc, site

    @classmethod
    def fetch(cls, token):
        tenant, dc, site = cls._parts(token)
        base = f"https://{tenant}.{dc}.myworkdayjobs.com"
        cxs = f"{base}/wday/cxs/{tenant}/{site}/jobs"
        out, offset, total = [], 0, None
        while True:
            r = http.post(cxs, json={"appliedFacets": {}, "limit": 20, "offset": offset, "searchText": ""})
            if not r.ok:
                break
            data = r.json()
            jobs = data.get("jobPostings", [])
            if not jobs:
                break
            for j in jobs:
                path = j.get("externalPath", "")
                loc = j.get("locationsText")
                out.append({
                    "ats_job_id": path or j.get("bulletFields", [None])[0] or j.get("title"),
                    "title": j.get("title"),
                    "location": loc,
                    "remote": _looks_remote(loc, j.get("title")),
                    "department": None,
                    "url": f"{base}/en-US/{site}{path}" if path else base,
                    "description": None,  # detail needs a per-job cxs call; skipped for speed
                    "posted_at": j.get("postedOn"),
                })
            # Workday only reports `total` on the FIRST page (0 thereafter) — capture it once.
            if total is None:
                total = data.get("total") or 0
            offset += len(jobs)
            if total and offset >= total:
                break
        return out

    @classmethod
    def detect(cls, url):
        m = cls._URL.search(url or "")
        if not m:
            return None
        tenant, dc, site = m.group(1), m.group(2), m.group(3)
        return f"{tenant}:{dc}:{site}"

    @classmethod
    def probe(cls, slug):
        return None  # tenant/dc/site can't be guessed from a name; use detect()

    _DCS = ["wd1", "wd5", "wd3"]
    _SITES = ["External", "External_Career_Site", "Careers"]

    @classmethod
    def probe_tenant(cls, slug):
        """Try {slug}.wdN.myworkdayjobs.com/.../{site}/jobs across common dc+site combos.
        Returns 'slug:dc:site' for the first that returns a non-empty board, else None."""
        for dc in cls._DCS:
            for site in cls._SITES:
                url = f"https://{slug}.{dc}.myworkdayjobs.com/wday/cxs/{slug}/{site}/jobs"
                try:
                    r = http.post_once(url, json={"appliedFacets": {}, "limit": 1, "offset": 0, "searchText": ""},
                                       timeout=6)
                except Exception:
                    continue
                if r.ok:
                    try:
                        if (r.json().get("total") or 0) > 0:
                            return f"{slug}:{dc}:{site}"
                    except ValueError:
                        pass
        return None

    @classmethod
    def detail(cls, token, job_id, url=None):
        """job_id is the externalPath; fetch the full posting description from cxs."""
        tenant, dc, site = cls._parts(token)
        cxs = f"https://{tenant}.{dc}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{job_id}"
        d = http.get_json(cxs)
        info = (d or {}).get("jobPostingInfo") or {}
        desc = _strip_html(info.get("jobDescription"))
        out = {"description": desc or None}
        sal = _parse_salary(info.get("payRangeDisplay") or info.get("basePayRangeDisplay"))
        if sal:
            out.update(salary_min=sal["min"], salary_max=sal["max"],
                       salary_currency=sal["currency"], salary_period=sal["period"], salary_raw=sal["raw"])
        return out


# ── Amazon (custom careers API) ──────────────────────────────────────────────
# Single-employer connector. token = "amazon" (ignored; endpoint is fixed).
class Amazon:
    NAME = "amazon"
    _URL = re.compile(r"amazon\.jobs", re.I)

    @classmethod
    def fetch(cls, token="amazon"):
        # token carries comma-separated keyword filters (each ANDs its own words):
        #   "amazon:SAP,DevOps,cloud architect,delivery manager"
        # Each filter runs separately and results are unioned. Empty = all roles.
        spec = token.split(":", 1)[1] if ":" in token else ""
        queries = [q.strip() for q in spec.split(",") if q.strip()] or [""]
        seen, out = set(), []
        for query in queries:
            offset, page = 0, 0
            while page < 30:
                params = {"result_limit": 100, "offset": offset, "sort": "recent"}
                if query:
                    params["base_query"] = query
                data = http.get_json("https://www.amazon.jobs/en/search.json", params=params)
                jobs = (data or {}).get("jobs", [])
                if not jobs:
                    break
                for j in jobs:
                    jid = j.get("id_icims") or j.get("id") or j.get("job_path")
                    if jid in seen:
                        continue
                    seen.add(jid)
                    out.append({
                        "ats_job_id": jid,
                        "title": j.get("title"),
                        "location": j.get("normalized_location") or j.get("location"),
                        "remote": _looks_remote(j.get("normalized_location"), j.get("title")),
                        "department": j.get("business_category") or j.get("job_family"),
                        "url": "https://www.amazon.jobs" + (j.get("job_path") or ""),
                        "description": _strip_html(j.get("description_short") or j.get("description")),
                        "posted_at": j.get("posted_date"),
                    })
                offset += 100
                page += 1
                if offset >= (data or {}).get("hits", 0):
                    break
        return out

    @classmethod
    def detect(cls, url):
        return "amazon" if cls._URL.search(url or "") else None

    @classmethod
    def probe(cls, slug):
        return "amazon" if slug in ("amazon", "amazoncom", "amazonjobs") else None


# ── Microsoft (custom careers API) ───────────────────────────────────────────
# token = "microsoft" (ignored). NOTE: verify reachability from your network —
# the gcsservices host returned an SSL hostname-mismatch from one sandbox.
class Microsoft:
    NAME = "microsoft"
    _URL = re.compile(r"careers\.microsoft\.com|jobs\.careers\.microsoft\.com", re.I)
    _API = "https://gcsservices.careers.microsoft.com/search/api/v1/search"

    @classmethod
    def fetch(cls, token="microsoft"):
        # comma-separated keyword filters, unioned: "microsoft:SAP,DevOps,cloud architect"
        spec = token.split(":", 1)[1] if ":" in token else ""
        queries = [q.strip() for q in spec.split(",") if q.strip()] or [""]
        seen, out = set(), []
        for query in queries:
            page = 1
            while page <= 30:
                params = {"l": "en_us", "pg": page, "pgSz": 20, "o": "Recent", "flt": "true"}
                if query:
                    params["q"] = query
                data = http.get_json(cls._API, params=params)
                result = (((data or {}).get("operationResult") or {}).get("result") or {})
                jobs = result.get("jobs", [])
                if not jobs:
                    break
                for j in jobs:
                    jid = j.get("jobId")
                    if jid in seen:
                        continue
                    seen.add(jid)
                    props = j.get("properties") or {}
                    locs = props.get("locations") or ([props.get("primaryLocation")] if props.get("primaryLocation") else [])
                    loc = ", ".join(l for l in locs if l)[:120] if locs else None
                    out.append({
                        "ats_job_id": jid,
                        "title": j.get("title"),
                        "location": loc,
                        "remote": _looks_remote(loc, j.get("title"), props.get("workSiteFlexibility")),
                        "department": props.get("discipline") or props.get("profession"),
                        "url": f"https://jobs.careers.microsoft.com/global/en/job/{jid}",
                        "description": _strip_html(props.get("description")),
                        "posted_at": j.get("postingDate") or props.get("postingDate"),
                    })
                total = result.get("totalJobs", 0)
                page += 1
                if page * 20 > total:
                    break
        return out

    @classmethod
    def detect(cls, url):
        return "microsoft" if cls._URL.search(url or "") else None

    @classmethod
    def probe(cls, slug):
        return None  # custom API; seed explicitly with ats_type=microsoft


# ── Radancy / TalentBrew (search-jobs/results) ───────────────────────────────
# Powers many defense/Fortune career sites (Lockheed, L3Harris, Northrop, ...).
# token = the careers host, e.g. "careers.l3harris.com" or "www.lockheedmartinjobs.com".
class Radancy:
    NAME = "radancy"
    _URL = re.compile(r"(?:https?://)?([a-z0-9.-]+)/(?:[a-z]{2}/)?search-jobs", re.I)
    _PARAMS = {
        "ActiveFacetID": 0, "RecordsPerPage": 100, "Distance": 0, "RadiusUnitType": 0,
        "Latitude": 0, "Longitude": 0, "ShowRadius": "False", "IsPagination": "true",
        "FacetType": 0, "SearchType": 5, "SortCriteria": 0, "SortDirection": 0,
        "SearchResultsModuleName": "Search Results", "SearchFiltersModuleName": "Search Filters",
        "OrganizationId": 0,
    }

    @classmethod
    def fetch(cls, token):
        from bs4 import BeautifulSoup
        host = token.replace("https://", "").replace("http://", "").strip("/")
        base = f"https://{host}"
        out, seen, page = [], set(), 1
        while page <= 120:  # safety cap (~12k)
            params = {**cls._PARAMS, "CurrentPage": page}
            r = http.get(f"{base}/search-jobs/results", params=params)
            if not r.ok:
                break
            try:
                data = r.json()
            except ValueError:
                break
            res = data.get("results", "")
            if not data.get("hasJobs") or not res:
                break
            cards = BeautifulSoup(res, "lxml").find_all("a", attrs={"data-job-id": True})
            new = 0
            for a in cards:
                jid = a.get("data-job-id")
                if jid in seen:
                    continue
                seen.add(jid); new += 1
                h2 = a.find("h2")
                loc = a.find("span", class_=re.compile("job-location"))
                cat = a.find("span", class_=re.compile("job-category"))
                loc_t = loc.get_text(strip=True) if loc else None
                title = h2.get_text(strip=True) if h2 else a.get_text(strip=True)
                out.append({
                    "ats_job_id": jid,
                    "title": title,
                    "location": loc_t,
                    "remote": _looks_remote(loc_t, title),
                    "department": cat.get_text(strip=True) if cat else None,
                    "url": base + a.get("href", ""),
                    "description": None,
                    "posted_at": None,
                })
            if not new:
                break
            page += 1
        return out

    @classmethod
    def detect(cls, url):
        if not url or "search-jobs" not in url.lower():
            return None
        m = cls._URL.search(url)
        host = m.group(1) if m else None
        return host if host and "." in host else None

    @classmethod
    def probe(cls, slug):
        return None  # host-based; resolved via careers-page discovery / detect()


# ── Apple — jobs.apple.com (server-rendered /details/ cards) ─────────────────
class Apple:
    NAME = "apple"
    _SKIP = {"see full role description", "where we're hiring", "apply", "submit resume",
             "view all", "learn more", "save"}

    @classmethod
    def fetch(cls, token="apple"):
        from bs4 import BeautifulSoup
        import time
        out, seen, page, fails = [], set(), 1, 0
        while page <= 200:
            try:
                r = http.get_once("https://jobs.apple.com/en-us/search",
                                  params={"page": page, "location": "united-states-USA", "sort": "newest"}, timeout=25)
            except Exception:
                fails += 1
                if fails >= 3:   # Apple is throttling — keep what we have
                    break
                time.sleep(3); continue
            if not r.ok:
                break
            time.sleep(0.6)      # be gentle — Apple rate-limits rapid pagination
            soup = BeautifulSoup(r.text, "lxml")
            links = soup.find_all("a", href=re.compile(r"/details/\d"))
            if not links:
                break
            byid = {}
            for a in links:
                m = re.search(r"/details/(\d+)", a["href"])
                if not m:
                    continue
                jid = m.group(1)
                txt = a.get_text(" ", strip=True)
                if txt and txt.lower() not in cls._SKIP and len(txt) > 5 and jid not in byid:
                    # grab a nearby location from the card
                    row = a.find_parent(["li", "tr", "div"])
                    loc = None
                    if row:
                        lt = row.find(attrs={"class": re.compile("location", re.I)})
                        loc = lt.get_text(" ", strip=True)[:80] if lt else None
                    byid[jid] = (txt, a["href"], loc)
            new = 0
            for jid, (title, href, loc) in byid.items():
                if jid in seen:
                    continue
                seen.add(jid); new += 1
                out.append({"ats_job_id": jid, "title": title, "location": loc or "United States",
                            "remote": _looks_remote(loc, title), "department": None,
                            "url": "https://jobs.apple.com" + href, "description": None, "posted_at": None})
            if not new:
                break
            page += 1
        return out

    @classmethod
    def detect(cls, url):
        return "apple" if "jobs.apple.com" in (url or "") else None

    @classmethod
    def probe(cls, slug):
        return None


# ── Eightfold AI (pcsx) — apply.{host}/api/pcsx/search ───────────────────────
# Powers Microsoft and other large employers. token = "apply_host|domain"
class Eightfold:
    NAME = "eightfold"

    @classmethod
    def fetch(cls, token):
        host, domain = (token.split("|", 1) + [""])[:2]
        out, start, total = [], 0, None
        while start < 10000:
            r = http.get_once(f"https://{host}/api/pcsx/search", timeout=22, params={
                "domain": domain, "query": "", "location": "", "start": start, "num": 50,
                "sort_by": "timestamp"})
            if not r.ok:
                break
            try:
                d = r.json()
            except ValueError:
                break
            data = d.get("data") or {}
            pos = data.get("positions") or d.get("positions") or []
            if total is None:
                total = (d.get("metadata") or {}).get("totalCount") or data.get("count") or 0
            if not pos:
                break
            for j in pos:
                locs = j.get("locations") or j.get("standardizedLocations") or []
                loc = locs[0] if isinstance(locs, list) and locs else (locs if isinstance(locs, str) else None)
                jid = j.get("id") or j.get("atsJobId")
                ts = j.get("postedTs") or j.get("creationTs")
                if isinstance(ts, (int, float)):  # epoch (s or ms) -> ISO date
                    import datetime
                    try:
                        ts = datetime.datetime.utcfromtimestamp(ts / 1000 if ts > 1e11 else ts).date().isoformat()
                    except Exception:
                        ts = None
                out.append({"ats_job_id": jid, "title": j.get("name"), "location": loc,
                            "remote": 1 if (j.get("workLocationOption") == "remote" or
                                            j.get("locationFlexibility") == "remote") else _looks_remote(loc),
                            "department": j.get("department"),
                            "url": f"https://{host}/careers?pid={jid}&domain={domain}",
                            "description": None, "posted_at": ts})
            start += 50
            if total and start >= total:
                break
        return out

    @classmethod
    def detect(cls, url):
        return None

    @classmethod
    def probe(cls, slug):
        return None


# ── Phenom People — careers.{company}.com/.../search-results ─────────────────
# POST /widgets returns the jobs. token = the careers host.
class Phenom:
    NAME = "phenom"
    _LOCALES = [("en_global", "global"), ("en_us", "us"), ("en", "us")]

    @classmethod
    def fetch(cls, token):
        host = token.replace("https://", "").replace("http://", "").strip("/").split("/")[0]
        url = f"https://{host}/widgets"

        def body(lang, country, frm):
            return {"lang": lang, "deviceType": "desktop", "country": country,
                    "pageName": "search-results", "ddoKey": "refineSearch", "sortBy": "Most Recent",
                    "subsearch": "", "from": frm, "jobs": True, "counts": True,
                    "all_fields": ["category", "country", "state", "city", "type"],
                    "pageType": "search-results", "size": 50, "clearAll": False, "jdsource": "facets",
                    "pageId": "page1", "siteType": "external", "keywords": "", "global": country == "global",
                    "selected_fields": {}, "locationData": {}}

        def jobs_of(d):
            for k in ("refineSearch", "eagerLoadRefineSearch"):
                blk = (d or {}).get(k) or {}
                data = blk.get("data") or {}
                if data.get("jobs"):
                    return data["jobs"], blk.get("totalHits") or data.get("totalHits")
            return None, None

        # pick the locale that returns jobs
        lang = country = None
        for la, co in cls._LOCALES:
            try:
                r = http.post(url, json=body(la, co, 0), timeout=25)
                js, _ = jobs_of(r.json()) if r.ok else (None, None)
            except Exception:
                js = None
            if js:
                lang, country = la, co
                break
        if not lang:
            return []

        out, seen, frm, total = [], set(), 0, None
        while frm < 8000:
            try:
                r = http.post(url, json=body(lang, country, frm), timeout=25)
                d = r.json() if r.ok else {}
            except Exception:
                break
            js, tot = jobs_of(d)
            if total is None:
                total = tot or 0
            if not js:
                break
            for j in js:
                jid = j.get("jobId") or j.get("jobSeqNo") or j.get("id")
                if jid in seen:
                    continue
                seen.add(jid)
                loc = j.get("cityState") or ", ".join(x for x in [j.get("city"), j.get("state"), j.get("country")] if x)
                jurl = j.get("applyUrl") or j.get("jobUrl") or f"https://{host}/job/{jid}"
                out.append({"ats_job_id": jid, "title": j.get("title") or j.get("ml_job_title"),
                            "location": loc or None, "remote": _looks_remote(loc, j.get("title")),
                            "department": j.get("category"), "url": jurl,
                            "description": _strip_html(j.get("descriptionTeaser") or j.get("description")),
                            "posted_at": j.get("postedDate") or j.get("dateCreated"),
                            "job_type_hint": j.get("type")})
            frm += 50
            if total and frm >= total:
                break
        return out

    @classmethod
    def detect(cls, url):
        return None

    @classmethod
    def probe(cls, slug):
        return None


# ── Oracle Recruiting Cloud (ORC) ────────────────────────────────────────────
# Powers a huge share of Fortune 500 (Honeywell, Amex, Cisco, Caterpillar, IBM...).
# token = "backend_oraclecloud_host|siteNumber|careers_host"
class OracleORC:
    NAME = "oracle_orc"

    @classmethod
    def fetch(cls, token):
        parts = token.split("|")
        backend, site = parts[0], parts[1]
        careers = parts[2] if len(parts) > 2 else backend
        api = f"https://{backend}/hcmRestApi/resources/latest/recruitingCEJobRequisitions"
        out, offset, total = [], 0, None
        while offset < (total if total is not None else 1) and offset < 12000:
            params = {"onlyData": "true", "expand": "requisitionList.secondaryLocations",
                      "finder": f"findReqs;siteNumber={site},limit=50,offset={offset},sortBy=POSTING_DATES_DESC"}
            r = http.get_once(api, params=params, timeout=25)
            if not r.ok:
                break
            try:
                it = (r.json().get("items") or [{}])[0]
            except ValueError:
                break
            if total is None:
                total = it.get("TotalJobsCount") or 0
            reqs = it.get("requisitionList") or []
            if not reqs:
                break
            for j in reqs:
                jid = j.get("Id")
                out.append({"ats_job_id": jid, "title": j.get("Title"),
                            "location": j.get("PrimaryLocation"),
                            "remote": _looks_remote(j.get("PrimaryLocation"), j.get("Title")),
                            "department": None,
                            "url": f"https://{careers}/en/sites/{site}/job/{jid}",
                            "description": _strip_html(j.get("ExternalDescriptionStr")),
                            "posted_at": j.get("PostedDate") or j.get("ExternalPostedStartDate")})
            offset += 50
        return out

    @classmethod
    def detect(cls, url):
        return None

    @classmethod
    def probe(cls, slug):
        return None


def resolve_orc(careers_host: str):
    """Given a careers host (or URL), extract the Oracle backend host + site code so
    OracleORC can scrape it. Returns 'backend|site|careers_host' or None."""
    careers_host = careers_host.replace("https://", "").replace("http://", "").strip("/").split("/")[0]
    try:
        r = http.get_once(f"https://{careers_host}/", timeout=20)
    except Exception:
        return None
    if not r.ok:
        return None
    blob = r.url + r.text
    hosts = re.findall(r"https?://([a-z0-9.-]*\.(?:fa\.[a-z0-9]+\.)?oraclecloud\.com)", blob)
    sites = re.findall(r"/sites/([A-Za-z0-9_]+)", blob) + re.findall(r"siteNumber[\"':=\s]+([A-Za-z0-9_]+)", blob)
    if not hosts or not sites:
        return None
    backend = max(set(hosts), key=hosts.count)
    site = max(set(sites), key=sites.count)
    return f"{backend}|{site}|{careers_host}"


# ── SuccessFactors (SAP) — jobs.{company}.com/search/ ────────────────────────
# Powers Exxon, SAP, and many large enterprises. token = the careers host.
class SuccessFactors:
    NAME = "successfactors"
    _URL = re.compile(r"(?:https?://)?([a-z0-9.-]+)/search/?", re.I)

    @classmethod
    def fetch(cls, token):
        from bs4 import BeautifulSoup
        host = token.replace("https://", "").replace("http://", "").strip("/").split("/")[0]
        base = f"https://{host}"
        out, seen, startrow = [], set(), 0
        while startrow < 6000:
            r = http.get_once(f"{base}/search/", params={"q": "", "startrow": startrow}, timeout=20)
            if not r.ok:
                break
            soup = BeautifulSoup(r.text, "lxml")
            links = soup.select("a.jobTitle-link") or [a for a in soup.find_all("a", href=True) if "/job/" in a["href"]]
            page_new = 0
            for a in links:
                href = a.get("href", "")
                if "/job/" not in href:
                    continue
                url = base + href if href.startswith("/") else href
                if url in seen:
                    continue
                seen.add(url); page_new += 1
                row = a.find_parent(["tr", "li", "div"])
                loc = row.find(class_=re.compile("jobLocation|job-location", re.I)) if row else None
                loct = loc.get_text(strip=True) if loc else None
                out.append({"ats_job_id": href, "title": a.get_text(strip=True), "location": loct,
                            "remote": _looks_remote(loct, a.get_text()), "department": None,
                            "url": url, "description": None, "posted_at": None})
            if not page_new:
                break
            startrow += 25
        return out

    @classmethod
    def detect(cls, url):
        # only claim it when the page is clearly a SuccessFactors search host
        return None

    @classmethod
    def probe(cls, slug):
        return None


# ── Google (custom careers SPA, server-rendered cards) ───────────────────────
class Google:
    NAME = "google"
    _BASE = "https://www.google.com/about/careers/applications/"

    @classmethod
    def fetch(cls, token="google"):
        from bs4 import BeautifulSoup
        out, seen, page = [], set(), 1
        while page <= 120:  # safety cap (~2400)
            r = http.get_once(cls._BASE + "jobs/results/", params={"page": page}, timeout=20)
            if not r.ok:
                break
            soup = BeautifulSoup(r.text, "lxml")
            cards = soup.find_all("h3", class_="QJPWVe")
            if not cards:
                break
            new = 0
            for t in cards:
                card, a = t, None
                for _ in range(7):
                    card = card.parent
                    if card is None:
                        break
                    a = card.find("a", href=re.compile(r"jobs/results/"))
                    if a:
                        break
                if not a:
                    continue
                href = a["href"]
                m = re.search(r"results/(\d+)", href)
                jid = m.group(1) if m else href
                if jid in seen:
                    continue
                seen.add(jid); new += 1
                loc = None
                for s in (card.find_all("span") if card else []):
                    txt = s.get_text(strip=True)
                    if txt.startswith("place"):
                        loc = txt[5:].split(";")[0].strip(); break
                url = href if href.startswith("http") else cls._BASE + href.lstrip("/")
                out.append({"ats_job_id": jid, "title": t.get_text(strip=True), "location": loc,
                            "remote": _looks_remote(loc, t.get_text()), "department": None,
                            "url": url, "description": None, "posted_at": None})
            if not new:
                break
            page += 1
        return out

    @classmethod
    def detect(cls, url):
        return "google" if "google.com/about/careers" in (url or "") else None

    @classmethod
    def probe(cls, slug):
        return None


# ── Web (universal) ──────────────────────────────────────────────────────────
# Last-resort connector: render the careers page in headless Chromium and extract
# jobs. Works on ANY site (custom/JS), just rougher. token = the careers URL.
# ── Pinpoint (pinpointhq) — careers board exposes /postings.json ──────────────
# token = the careers host (e.g. "jobs.aligntech.com"). One request returns every job.
class Pinpoint:
    NAME = "pinpoint"

    @classmethod
    def fetch(cls, token):
        host = token.replace("https://", "").replace("http://", "").strip("/").split("/")[0]
        r = http.get_once(f"https://{host}/postings.json", timeout=30)
        if not r.ok:
            return []
        try:
            data = r.json().get("data") or []
        except ValueError:
            return []
        out = []
        for j in data:
            loc = j.get("location") or {}
            if isinstance(loc, dict):
                loct = loc.get("name") or ", ".join(x for x in [loc.get("city"), loc.get("province")] if x)
            else:
                loct = str(loc) if loc else None
            wt = (j.get("workplace_type_text") or j.get("workplace_type") or "")
            cmin, cmax = j.get("compensation_minimum"), j.get("compensation_maximum")
            sal = None
            if (cmin or cmax) and j.get("compensation_visible") is not False:
                cur = j.get("compensation_currency") or "USD"
                sal = f"{cur} {cmin or ''}-{cmax or ''} {j.get('compensation_frequency') or ''}".strip()
            out.append({"ats_job_id": str(j.get("id")), "title": j.get("title"),
                        "location": loct or None,
                        "remote": _looks_remote(loct, wt, j.get("title")),
                        "department": (j.get("job") or {}).get("name") if isinstance(j.get("job"), dict) else None,
                        "url": j.get("url") or j.get("path"),
                        "description": _strip_html(j.get("description") or j.get("compensation") or sal),
                        "posted_at": j.get("published_at") or j.get("created_at")})
        return out

    @classmethod
    def detect(cls, url):
        return None

    @classmethod
    def probe(cls, slug):
        return None


# ── Jibe (iCIMS Career Sites front-end) — {code}.jibeapply.com/api/jobs ───────
# token = "clientcode" or "clientcode|careershost" (careers host only used for links).
class Jibe:
    NAME = "jibe"

    @classmethod
    def fetch(cls, token):
        code, _, careers = token.partition("|")
        code = code.strip()
        api = f"https://{code}.jibeapply.com/api/jobs"
        out, seen, page, total = [], set(), 1, None
        while page < 2000:
            r = http.get_once(api, params={"page": page, "internal": "false", "limit": 100}, timeout=25)
            if not r.ok:
                break
            try:
                d = r.json()
            except ValueError:
                break
            if total is None:
                total = d.get("totalCount") or 0
            jobs = d.get("jobs") or []
            if not jobs:
                break
            page_new = 0
            for j in jobs:
                j = j.get("data", j) if isinstance(j.get("data"), dict) else j
                jid = j.get("slug") or j.get("req_id")
                if jid in seen:
                    continue
                seen.add(jid); page_new += 1
                loc = j.get("location_name") or ", ".join(
                    x for x in [j.get("city"), j.get("state"), j.get("country")] if x)
                jurl = (f"https://{careers}/careers-home/jobs/{jid}" if careers
                        else f"https://{code}.jibeapply.com/jobs/{jid}")
                out.append({"ats_job_id": str(jid), "title": j.get("title"),
                            "location": loc or None,
                            "remote": _looks_remote(loc, j.get("location_type"), j.get("title")),
                            "department": j.get("department"), "url": jurl,
                            "description": _strip_html(j.get("description")),
                            "posted_at": j.get("posted_date") or j.get("create_date")})
            if not page_new:
                break
            if total and len(seen) >= total:
                break
            page += 1
        return out

    @classmethod
    def detect(cls, url):
        return None

    @classmethod
    def probe(cls, slug):
        return None


# ── Avature — {host}/careers/SearchJobs (server-rendered, advance by page size) ─
# token = the Avature host (e.g. "ally.avature.net").
class Avature:
    NAME = "avature"

    @classmethod
    def fetch(cls, token):
        from bs4 import BeautifulSoup
        host = token.replace("https://", "").replace("http://", "").strip("/").split("/")[0]
        base = f"https://{host}"
        out, seen, offset, empty = [], set(), 0, 0
        while offset < 8000:
            r = http.get_once(f"{base}/careers/SearchJobs", params={"jobOffset": offset}, timeout=25)
            if not r.ok:
                break
            soup = BeautifulSoup(r.text, "lxml")
            links = [a for a in soup.find_all("a", href=True) if "/careers/JobDetail/" in a["href"]]
            page_new = 0
            for a in links:
                href = a["href"]
                jid = href.rstrip("/").rsplit("/", 1)[-1]
                if jid in seen:
                    continue
                seen.add(jid); page_new += 1
                url = href if href.startswith("http") else base + href
                # Avature encodes the location into the JobDetail slug: .../City-State-Country-Title/{id}
                slug = href.split("/careers/JobDetail/")[-1].rsplit("/", 1)[0]
                title = a.get_text(strip=True)
                out.append({"ats_job_id": jid, "title": title,
                            "location": None, "remote": _looks_remote(slug, title),
                            "department": None, "url": url,
                            "description": None, "posted_at": None})
            if page_new == 0:
                empty += 1
                if empty >= 2:
                    break
                offset += 10
                continue
            empty = 0
            offset += max(page_new, len(links))  # advance by this tenant's page size
        return out

    @classmethod
    def detect(cls, url):
        return None

    @classmethod
    def probe(cls, slug):
        return None


# ── iCIMS (native careers-{co}.icims.com) — /jobs/search?pr=N&in_iframe=1 ─────
# token = the iCIMS host (e.g. "careers-americansystems.icims.com").
class ICIMS:
    NAME = "icims"
    _JOB = re.compile(r"/jobs/(\d+)/[^\"'?#]*?/job", re.I)

    @classmethod
    def fetch(cls, token):
        from bs4 import BeautifulSoup
        host = token.replace("https://", "").replace("http://", "").strip("/").split("/")[0]
        base = f"https://{host}"
        out, seen, pr, empty = [], set(), 0, 0
        while pr < 400:
            r = http.get_once(f"{base}/jobs/search",
                              params={"pr": pr, "searchRelation": "keyword_all", "in_iframe": 1},
                              timeout=25)
            if not r.ok:
                break
            soup = BeautifulSoup(r.text, "lxml")
            cards = soup.select("a.iCIMS_Anchor[href*='/jobs/']") or \
                [a for a in soup.find_all("a", href=True) if cls._JOB.search(a["href"])]
            page_new = 0
            for a in cards:
                href = a["href"]
                m = cls._JOB.search(href)
                if not m:
                    continue
                jid = m.group(1)
                if jid in seen:
                    continue
                title = a.get_text(" ", strip=True)
                # iCIMS prefixes a field label that varies by portal ("Title",
                # "Job Posting Title", "External Job Posting Title", …) — strip them all.
                title = re.sub(r"^(External\s+)?(Job\s+Posting\s+)?Title\s*", "", title, flags=re.I)
                if not title or "log back in" in title.lower():
                    continue
                seen.add(jid); page_new += 1
                url = (href if href.startswith("http") else base + href).split("?")[0]
                row = a.find_parent(class_=re.compile("iCIMS_JobCardItem|iCIMS_JobsTable", re.I))
                loc = None
                if row:
                    le = row.find(class_=re.compile("location|Location"))
                    loc = le.get_text(strip=True) if le else None
                out.append({"ats_job_id": jid, "title": title,
                            "location": loc, "remote": _looks_remote(loc, title),
                            "department": None, "url": url,
                            "description": None, "posted_at": None})
            if page_new == 0:
                empty += 1
                if empty >= 2:
                    break
            else:
                empty = 0
            pr += 1
        return out

    @classmethod
    def detect(cls, url):
        m = re.search(r"https?://([a-z0-9-]+\.icims\.com)", url or "", re.I)
        return m.group(1) if m else None

    @classmethod
    def probe(cls, slug):
        return None


# ── Brassring (IBM/Infinite Kenexa) — sjobs.brassring.com TGnewUI ────────────
# token = "partnerId|siteId" (e.g. "25416|5998"). Jobs come from a POST that returns
# JSON-in-text/html; each job's card fields live in a quirky `Questions` array.
class Brassring:
    NAME = "brassring"
    _BASE = "https://sjobs.brassring.com"

    @classmethod
    def fetch(cls, token):
        import json as _json
        pid, _, sid = token.partition("|")
        pid, sid = pid.strip(), sid.strip()
        home = f"{cls._BASE}/TGnewUI/Search/Home/Home?partnerid={pid}&siteid={sid}"
        try:
            http.get_once(home, timeout=20)  # prime session cookies
        except Exception:
            pass
        api = f"{cls._BASE}/TgNewUI/Search/Ajax/ProcessSortAndShowMoreJobs"
        hdrs = {"Content-Type": "application/json;charset=UTF-8", "Origin": cls._BASE,
                "Referer": home, "Accept": "application/json, text/plain, */*"}
        out, seen, page, total, empty = [], set(), 0, None, 0
        while page < 200:
            payload = _json.dumps({"partnerId": pid, "siteId": sid, "keyword": "",
                                   "pageNumber": page, "JobsPerPage": 50})
            try:
                r = http.post(api, data=payload, headers=hdrs, timeout=30)
                d = _json.loads(r.text) if r.ok else {}
            except Exception:
                break
            if total is None:
                total = d.get("JobsCount") or 0
            jobs = ((d.get("Jobs") or {}).get("Job")) or []
            if not jobs:
                break
            page_new = 0
            for j in jobs:
                q = {}
                for it in j.get("Questions") or []:
                    name = it.get("QuestionName") or it.get("Name")
                    val = it.get("Value") or it.get("AnswerValue") or it.get("Answer")
                    if name and val not in (None, ""):
                        q[name] = val
                jid = str(q.get("reqid") or "")
                link = j.get("Link") or ""
                if not jid:
                    m = re.search(r"jobid=(\d+)", link)
                    jid = m.group(1) if m else None
                if not jid or jid in seen:
                    continue
                seen.add(jid); page_new += 1
                loc = (q.get("location") or q.get("joblocation")
                       or ", ".join(x.strip() for x in [q.get("formtext8"), q.get("formtext9")] if x and x.strip())
                       or ", ".join(x.strip() for x in [q.get("city"), q.get("state")] if x and x.strip()))
                title = _strip_html(q.get("jobtitle"))
                out.append({"ats_job_id": jid, "title": title,
                            "location": loc or None, "remote": _looks_remote(loc, title),
                            "department": _strip_html(q.get("department")),
                            "url": link or f"{cls._BASE}/TGnewUI/Search/home/HomeWithPreLoad?partnerid={pid}&siteid={sid}&PageType=JobDetails&jobid={jid}",
                            "description": _strip_html(q.get("jobdescription")),
                            "posted_at": q.get("lastupdated") or q.get("posteddate")})
            page += 1
            if total and len(seen) >= total:
                break
            # Brassring's first show-more page duplicates page 0; tolerate a few empties.
            empty = empty + 1 if page_new == 0 else 0
            if empty >= 3:
                break
        return out

    @classmethod
    def detect(cls, url):
        return None  # handled by resolve.classify_url (needs both partnerid + siteid)

    @classmethod
    def probe(cls, slug):
        return None


# ── General Dynamics custom API — /API/Careers/CareerSearch?request={gzip+b64 JSON} ─
# token = the careers host (default www.gd.com). Paginates via a gzipped page param.
class GDCareers:
    NAME = "gdcareers"

    @classmethod
    def fetch(cls, token):
        import base64, gzip, json as _json
        host = (token or "www.gd.com").replace("https://", "").strip("/").split("/")[0]
        api = f"https://{host}/API/Careers/CareerSearch"

        def req(page):
            body = _json.dumps({"address": [], "facets": [], "page": page, "what": ""},
                               separators=(",", ":")).encode()
            return base64.b64encode(gzip.compress(body)).decode()

        out, page, pages = [], 0, None
        while page < (pages if pages is not None else 1) and page < 1000:
            r = http.get_once(api, params={"request": req(page)}, timeout=25)
            if not r.ok:
                break
            try:
                d = r.json()
            except ValueError:
                break
            if pages is None:
                pages = d.get("PageCount") or 0
            for j in d.get("Results") or []:
                jid = j.get("Id")
                link = (j.get("Link") or {}).get("Url") or ""
                url = (f"https://{host}{link}" if link.startswith("/") else link) or f"https://{host}/careers"
                locs = j.get("LocationNames") or []
                loc = "; ".join(locs) if isinstance(locs, list) else (locs or None)
                wp = j.get("WorkplaceOptions") or []
                out.append({"ats_job_id": str(jid), "title": j.get("Title"),
                            "location": loc, "remote": _looks_remote(loc, " ".join(wp) if isinstance(wp, list) else ""),
                            "department": j.get("Category"), "url": url,
                            "description": _strip_html(j.get("Excerpt")),
                            "posted_at": j.get("Date") or j.get("FormattedDate")})
            page += 1
        return out

    @classmethod
    def detect(cls, url):
        return None

    @classmethod
    def probe(cls, slug):
        return None


# ── Goldman Sachs (higher.gs.com) — public GraphQL roleSearch, no auth ───────
class GSRoles:
    NAME = "gsroles"
    _API = "https://api-higher.gs.com/gateway/api/v1/graphql"
    _QUERY = ("query GetRoles($searchQueryInput: RoleSearchQueryInput!) { "
              "roleSearch(searchQueryInput: $searchQueryInput) { totalCount items { "
              "roleId corporateTitle jobTitle jobFunction locations { primary state country city } "
              "status division jobType { code description } } } }")

    @classmethod
    def fetch(cls, token):
        out, page, total, size = [], 0, None, 100
        while page < 200:
            payload = {"operationName": "GetRoles", "query": cls._QUERY,
                       "variables": {"searchQueryInput": {
                           "page": {"pageSize": size, "pageNumber": page},
                           "sort": {"sortStrategy": "RELEVANCE", "sortOrder": "DESC"},
                           "filters": [], "experiences": ["EARLY_CAREER", "PROFESSIONAL"],
                           "searchTerm": ""}}}
            try:
                r = http.post(cls._API, json=payload, timeout=30,
                              headers={"Content-Type": "application/json"})
                rs = ((r.json().get("data") or {}).get("roleSearch")) or {}
            except Exception:
                break
            if total is None:
                total = rs.get("totalCount") or 0
            items = rs.get("items") or []
            if not items:
                break
            for j in items:
                jid = j.get("roleId")
                locs = j.get("locations") or []
                lp = locs[0] if isinstance(locs, list) and locs else {}
                loc = ", ".join(str(x) for x in [lp.get("city"), lp.get("state"), lp.get("country")]
                                if x) if isinstance(lp, dict) else None
                jt = j.get("jobType") or {}
                out.append({"ats_job_id": str(jid), "title": j.get("jobTitle") or j.get("corporateTitle"),
                            "location": loc, "remote": _looks_remote(loc, j.get("jobTitle")),
                            "department": j.get("division") or j.get("jobFunction"),
                            "url": f"https://higher.gs.com/roles/{jid}",
                            "description": None, "posted_at": None})
            page += 1
            if total and len(out) >= total:
                break
        return out

    @classmethod
    def detect(cls, url):
        return None

    @classmethod
    def probe(cls, slug):
        return None


# ── Generic server-rendered job list — paginates ?page=N, parses /jobs/{id} links ─
# For careers sites that render their listings straight into HTML (no ATS API).
# token = the listing URL (e.g. "https://careers.hilti.group/en-us/jobs/").
class HtmlList:
    NAME = "htmllist"
    _JOB = re.compile(r"/jobs?/(\d+)", re.I)
    _DROP = {"save", "saved", "apply", "share", "view", "details", "read more", ""}

    @classmethod
    def _links(cls, soup):
        return [a for a in soup.find_all("a", href=True) if cls._JOB.search(a["href"])]

    @classmethod
    def fetch(cls, token):
        from bs4 import BeautifulSoup
        from urllib.parse import urlparse, urljoin
        base = token.strip()
        pr = urlparse(base)
        origin = f"{pr.scheme}://{pr.netloc}"
        sep = "&" if "?" in base else "?"
        out, seen, page, empty = [], set(), 1, 0
        while page < 200:
            url = base if page == 1 else f"{base}{sep}page={page}"
            try:
                r = http.get_once(url, timeout=25)
            except Exception:
                break
            if not r.ok:
                break
            soup = BeautifulSoup(r.text, "lxml")
            page_new = 0
            for a in cls._links(soup):
                href = a["href"]
                jid = cls._JOB.search(href).group(1)
                if jid in seen:
                    continue
                title = a.get_text(" ", strip=True)
                if not title or title.lower() in cls._DROP:
                    continue
                seen.add(jid); page_new += 1
                card = a.find_parent(["li", "article", "div"])
                loc = None
                if card:
                    segs = [s.strip() for s in card.get_text("|", strip=True).split("|")]
                    segs = [s for s in segs if s and s.lower() not in cls._DROP and s != title]
                    loc = next((s for s in segs if "," in s), None)
                out.append({"ats_job_id": jid, "title": title,
                            "location": loc, "remote": _looks_remote(loc, title),
                            "department": None,
                            "url": urljoin(origin, href) if href.startswith("/") else href,
                            "description": None, "posted_at": None})
            page += 1
            if page_new == 0:
                empty += 1
                if empty >= 2:
                    break
            else:
                empty = 0
        return out

    @classmethod
    def detect(cls, url):
        return None

    @classmethod
    def probe(cls, slug):
        return None


class Web:
    NAME = "web"

    @classmethod
    def fetch(cls, token):
        from . import webscrape
        return webscrape.scrape_careers(token)

    @classmethod
    def detect(cls, url):
        return None  # never auto-detected; assigned explicitly to careers_only companies

    @classmethod
    def probe(cls, slug):
        return None


class Webflow:
    """Careers sites built on Webflow CMS + Jetboost search (server-rendered, paginated via
    ?<collectionId>_page=N). Used by employers like Parsons (jobs.parsons.com). The generic
    `web` connector only sees page 1; this walks every page.
    Token format:  '<search_url>|<collectionId>'
      e.g.  'https://jobs.parsons.com/career-search|428a8687'
    """
    NAME = "webflow"
    _TITLE = re.compile(r'heading-style-h4">(.*?)</div>', re.S)
    _DEPT = re.compile(r'class="tag"><div>(.*?)</div>', re.S)
    _HREF = re.compile(r'href="(/jobs/[^"]+)"')
    _ID = re.compile(r"-r-?(\d{4,})", re.I)

    @classmethod
    def fetch(cls, token):
        base, _, cid = token.partition("|")
        if not cid:
            return []
        host = re.match(r"https?://[^/]+", base).group(0)
        sep = "&" if "?" in base else "?"
        out, seen = [], set()
        for page in range(1, 101):  # safety cap: 100 pages x ~100 = 10k jobs
            try:
                r = http.get(f"{base}{sep}{cid}_page={page}")
            except Exception:
                break
            if not getattr(r, "ok", False):
                break
            new = 0
            for card in r.text.split("career20_item")[1:]:
                t = cls._TITLE.search(card)
                h = cls._HREF.search(card)
                if not t or not h:
                    continue
                m = cls._ID.search(h.group(1))
                jid = m.group(1) if m else h.group(1)
                if jid in seen:
                    continue
                seen.add(jid)
                new += 1
                d = cls._DEPT.search(card)
                title = _strip_html(t.group(1))
                out.append({
                    "ats_job_id": jid,
                    "title": title,
                    "location": None,
                    "remote": _looks_remote(title, h.group(1)),
                    "department": _strip_html(d.group(1)) if d else None,
                    "url": host + h.group(1),
                    "description": None,
                    "posted_at": None,
                })
            if new == 0:  # no new jobs on this page → past the last page
                break
        return out

    @classmethod
    def detail(cls, token, job_id, url=None):
        """Job description from the Webflow CMS item page (JSON-LD, else rich-text block)."""
        if not url:
            return {}
        try:
            r = http.get_once(url, timeout=20)
            html = r.text if getattr(r, "ok", False) else ""
        except Exception:
            return {}
        desc = _jsonld_description(html)
        if not desc:
            m = re.search(r'class="[^"]*w-richtext[^"]*"[^>]*>(.*?)</div>\s*</div>', html, re.S)
            if m:
                desc = _strip_html(m.group(1))
        return {"description": desc} if desc else {}

    @classmethod
    def detect(cls, url):
        return None  # Webflow/Jetboost sites aren't slug-probeable; configured explicitly

    @classmethod
    def probe(cls, slug):
        return None


class Symphony:
    """Symphony Talent / SmashFly career sites (window.csns / talemetry), e.g. jobs.saic.com.
    Clean JSON at {host}/search/jobs.json?page=N -> {entries[], total_entries, per_page}.
    Token = the careers host (e.g. 'jobs.saic.com').
    """
    NAME = "symphony"
    _UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
           "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

    @classmethod
    def _get_json(cls, url):
        """These sites sit behind Cloudflare, which TLS-fingerprints python-requests and
        returns a 403 'Just a moment' challenge. curl's fingerprint passes, so fetch via
        curl. Still rate-limited through http._throttle to stay polite."""
        import json as _json
        import shutil
        import subprocess

        import time
        curl = shutil.which("curl") or "curl"
        for attempt in range(3):  # Cloudflare challenges are often intermittent — retry
            http._throttle(url)
            try:
                p = subprocess.run(
                    [curl, "-sL", "--compressed", "--max-time", "30", "-A", cls._UA,
                     "-H", "Accept: application/json, text/javascript, */*; q=0.01", url],
                    capture_output=True, text=True, timeout=45,
                )
                return _json.loads(p.stdout)
            except Exception:
                time.sleep(1.5 * (attempt + 1))
        return None

    @classmethod
    def fetch(cls, token):
        host = token.replace("https://", "").replace("http://", "").strip("/").split("/")[0]
        base = f"https://{host}"
        out, seen, page, total, misses = [], set(), 1, None, 0
        while page <= 400:  # safety cap (~10k)
            d = cls._get_json(f"{base}/search/jobs.json?q=&page={page}")
            if not d or not (d.get("entries") or []):
                # transient gap vs real end: keep going until we've reached total_entries
                misses += 1
                if total and len(seen) < total and misses <= 5:
                    page += 1
                    continue
                break
            misses = 0
            if total is None:
                total = d.get("total_entries")
            entries = d.get("entries") or []
            if not entries:
                break
            new = 0
            for j in entries:
                jid = str(j.get("id") or j.get("talemetry_job_id") or "")
                if not jid or jid in seen:
                    continue
                seen.add(jid); new += 1
                loc = j.get("location") or {}
                locname = loc.get("name") or ", ".join(
                    x for x in [loc.get("locality"), loc.get("region_abbr"), loc.get("country")] if x)
                perm = j.get("permalink") or ""
                if perm.startswith("http"):
                    jurl = perm
                elif perm.startswith("/"):
                    jurl = base + perm
                else:  # permalink is just the slug -> /jobs/<id>-<slug>
                    jurl = f"{base}/jobs/{jid}" + (f"-{perm}" if perm else "")
                title = j.get("title")
                out.append({
                    "ats_job_id": jid,
                    "title": title,
                    "location": locname or None,
                    "remote": _looks_remote(locname, title),
                    "department": j.get("category"),
                    "url": jurl,
                    "description": _strip_html(j.get("description")),
                    "posted_at": j.get("posted_at") or j.get("create_date"),
                })
            total = d.get("total_entries")
            if new == 0 or (total and len(seen) >= total):
                break
            page += 1
        return out

    @classmethod
    def detail(cls, token, job_id, url=None):
        """Pull the job description (Cloudflare-protected page → curl + JSON-LD).
        Fetches by job_id so it doesn't depend on the stored permalink."""
        host = token.replace("https://", "").replace("http://", "").strip("/").split("/")[0]
        html = cls._get_html(url or f"https://{host}/jobs/{job_id}")
        desc = _jsonld_description(html)
        return {"description": desc} if desc else {}

    @classmethod
    def _get_html(cls, url):
        import shutil
        import subprocess
        http._throttle(url)
        try:
            p = subprocess.run([shutil.which("curl") or "curl", "-sL", "--compressed",
                                "--max-time", "30", "-A", cls._UA, url],
                               capture_output=True, text=True, timeout=45)
            return p.stdout
        except Exception:
            return ""

    @classmethod
    def detect(cls, url):
        return None  # configured explicitly

    @classmethod
    def probe(cls, slug):
        return None


REGISTRY = [Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Workday, Amazon, Microsoft,
            Radancy, Google, SuccessFactors, OracleORC, Phenom, Eightfold, Apple,
            Pinpoint, Jibe, Avature, ICIMS, Brassring, GDCareers, GSRoles, HtmlList,
            Webflow, Symphony, Web]
BY_NAME = {c.NAME: c for c in REGISTRY}
# Order to try when slug-probing an unknown company (Workday excluded — not probeable):
PROBE_ORDER = [Greenhouse, Lever, Ashby, SmartRecruiters, Workable]


def fetch(ats_type: str, token: str) -> list[dict]:
    conn = BY_NAME.get(ats_type)
    if not conn:
        raise ValueError(f"unknown ATS type: {ats_type}")
    return conn.fetch(token)


def detect_from_url(url: str):
    """Return (ats_type, token) if any connector recognizes the URL."""
    for conn in REGISTRY:
        tok = conn.detect(url)
        if tok:
            return conn.NAME, tok
    return None, None


def fetch_detail(ats_type: str, token: str, job_id: str, url: str = None) -> dict:
    """Fetch per-posting extras (description/salary) for connectors that omit them
    from the list endpoint (SmartRecruiters, Workday). Returns {} for the rest."""
    conn = BY_NAME.get(ats_type)
    fn = getattr(conn, "detail", None)
    if not fn:
        return {}
    try:
        return fn(token, job_id, url) or {}
    except Exception:
        return {}
