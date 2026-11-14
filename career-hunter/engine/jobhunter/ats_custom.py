# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Keep the existing custom readers in a bounded provider module; ats retains their registry and public names.
from __future__ import annotations
import re
from datetime import datetime
from . import http
from .ats_common import _strip_html, _jsonld_description
from .work_arrangement import looks_remote as _looks_remote, remote_location
from .salary_text import parse_salary as _parse_salary
from .listed_boards import listed_place

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
                workplace = (j.get("workLocationOption"), j.get("locationFlexibility"))
                verified = True if any(isinstance(value, str) and value.lower() == 'remote' for value in workplace) else None
                loc = remote_location(loc, j.get("name"), *workplace, verified=verified)
                out.append({"ats_job_id": jid, "title": j.get("name"), "location": loc,
                            "remote": _looks_remote(loc, j.get("name"), *workplace, verified=verified),
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

