# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Keep the existing legacy readers in a bounded provider module; ats retains their registry and public names.
from __future__ import annotations
import re
from datetime import datetime
from . import http
from .ats_common import _strip_html, _jsonld_description
from .work_arrangement import looks_remote as _looks_remote, remote_location
from .salary_text import parse_salary as _parse_salary
from .listed_boards import listed_place

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



class Dayforce:
    NAME = "dayforce"
    HOST = "https://jobs.dayforcehcm.com"
    _URL = re.compile(r"jobs\.dayforcehcm\.com/(?:([a-z]{2}-[A-Z]{2})/)?([A-Za-z0-9_-]+)/([A-Za-z0-9_-]+)", re.I)
    _SKIP = {"api", "_next", "static", "en-us"}

    @classmethod
    def token_from(cls, url):
        m = cls._URL.search(url or "")
        if not m or m.group(2).lower() in cls._SKIP:
            return None
        culture = m.group(1) or "en-US"
        culture = culture[:2].lower() + "-" + culture[3:].upper()
        return f"{m.group(2)}|{m.group(3)}|{culture}"

    @classmethod
    def fetch(cls, token):
        from .source_memory import Feed
        client, _, rest = token.partition("|")
        board, _, culture = rest.partition("|")
        board, culture = board or "CANDIDATEPORTAL", culture or "en-US"
        page_url = f"{cls.HOST}/{culture}/{client}/{board}"
        try:
            csrf = http.get_once(f"{cls.HOST}/api/auth/csrf", headers={"Referer": page_url}, timeout=20).json().get("csrfToken")
        except (ValueError, AttributeError):
            csrf = None
        if not csrf:
            return Feed([], reason="http_refused")
        headers = {"x-csrf-token": csrf, "Referer": page_url, "Origin": cls.HOST, "Accept": "application/json"}
        out, seen, offset, total, cut = [], set(), 0, None, None
        while offset < 20000:
            body = {"clientNamespace": client, "jobBoardCode": board, "cultureCode": culture, "distanceUnit": 0,
                    "exactLocationOnly": False, "paginationStart": offset}
            r = http.post_once(f"{cls.HOST}/api/geo/{client}/jobposting/search", json=body, headers=headers, timeout=30)
            try:
                d = r.json() if r.ok else None
            except ValueError:
                d = None
            if not isinstance(d, dict) or not isinstance(d.get("jobPostings"), list):
                cut = "http_refused" if not r.ok else "completion_unverified"
                break
            if total is None:
                total = int(d.get("maxCount") or 0)
            page_new = 0
            for j in d["jobPostings"]:
                jid = str(j.get("jobPostingId") or "")
                if not jid or jid in seen:
                    continue
                seen.add(jid); page_new += 1
                places = [", ".join(x for x in (p.get("cityName"), p.get("stateCode"), p.get("isoCountryCode")) if x)
                          for p in (j.get("postingLocations") or []) if isinstance(p, dict)]
                place = "; ".join(p for p in places if p) or None
                virtual = bool(j.get("hasVirtualLocation"))
                out.append({"ats_job_id": jid, "title": j.get("jobTitle"), "location": place or ("Remote" if virtual else None),
                            "remote": virtual or _looks_remote(place, j.get("jobTitle")), "department": None,
                            "url": f"{page_url}/jobs/{jid}", "description": _strip_html(j.get("jobDescription")),
                            "posted_at": j.get("postingStartTimestampUTC")})
            if not page_new or (total and len(seen) >= total):
                break
            offset += page_new
        # The search states how many jobs the board holds; reading that many, every page answered, is the whole board.
        whole = not cut and total is not None and len(seen) >= total and (total > 0 or not out)
        if whole and total == 0:
            return Feed([], reason="empty_unconfirmed")
        return Feed(out, complete=whole, reason=None if whole else cut or "completion_unverified")

    @classmethod
    def detect(cls, url):
        return cls.token_from(url)

    @classmethod
    def probe(cls, slug):
        return None

