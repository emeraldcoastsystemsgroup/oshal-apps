"""Universal careers-page scraper: render ANY company's jobs page in headless Chromium
and extract the postings — regardless of which platform they use.

It works two ways at once, so it copes with both server-rendered and JS/GraphQL sites:
  1. DOM:  pull job-like links + titles from the rendered HTML.
  2. DATA: capture every JSON response the page loads (the real browser carries the
           valid session/tokens), then find any array of job-shaped objects in it —
           however deeply nested or obfuscated (Meta GraphQL, ServiceNow, custom APIs).

Slower than the structured ATS connectors, but it reaches the defended/custom sites
those can't. Used as the `web` connector: ats_token = the careers URL.
"""
from __future__ import annotations
import re
from html import unescape
from urllib.parse import urljoin, urlparse

# href patterns that look like an individual job posting
_JOB_HREF = re.compile(
    r"/job[s]?[/-]|/career[s]?/[^/]+/[^/]|/position[s]?/|/opening[s]?/|/vacanc|/requisition|"
    r"/jobdetail|/jobposting|jobid=|reqid=|/p/|/role[s]?/|/apply/|gh_jid=|/listing/", re.I)
_BAD = re.compile(r"^(apply|search|view all|see all|back|next|previous|sign in|login|home|menu|"
                  r"learn more|read more|filter|sort|share|email|cookie|privacy|terms)\b", re.I)
_TAG = re.compile(r"<[^>]+>")

# Field-name hints for mapping arbitrary JSON job objects to our schema.
_TITLE_KEYS = ("title", "name", "jobtitle", "job_title", "postingname", "displayjobtitle",
               "positionname", "reqtitle", "jobname", "roletitle")
_LOC_KEYS = ("location", "locations", "city", "joblocation", "primarylocation", "location_name",
             "locationname", "formattedlocation", "standardizedlocations", "cityname", "region")
_URL_KEYS = ("absoluteurl", "applyurl", "joburl", "canonicalurl", "url", "link", "detailurl",
             "absolute_url", "jobpostingurl", "externalpath")
_ID_KEYS = ("id", "jobid", "reqid", "req_id", "atsjobid", "ats_job_id", "jobseqno", "slug",
            "requisitionid", "jobreqid", "positionid", "jobpostingid")
_DEPT_KEYS = ("department", "category", "jobfamily", "team", "function", "businessunit")
_DATE_KEYS = ("posteddate", "posted_at", "postedon", "createddate", "datecreated", "publisheddate",
              "lastupdated", "postedts", "creationts", "updatedat")


def _clean(s):
    return unescape(_TAG.sub(" ", s or "")).strip() if isinstance(s, str) else s


def _first(d, keys):
    """Case-insensitive lookup of the first present key from `keys` in dict d."""
    low = {k.lower(): v for k, v in d.items()}
    for k in keys:
        if k in low and low[k] not in (None, "", [], {}):
            return low[k]
    return None


def _stringify_loc(v):
    if v is None:
        return None
    if isinstance(v, str):
        return v[:120]
    if isinstance(v, dict):
        for k in ("name", "city", "displayName", "formattedAddress", "label", "text"):
            if v.get(k):
                base = v[k]
                st = v.get("state") or v.get("region") or v.get("country")
                return f"{base}, {st}" if st and st not in str(base) else str(base)
        return None
    if isinstance(v, list) and v:
        return _stringify_loc(v[0])
    return None


# Job-specific id keys (exclude generic 'id'/'slug' which also tag languages, nav, facets).
_STRONG_ID_KEYS = ("jobid", "reqid", "req_id", "atsjobid", "ats_job_id", "jobseqno",
                   "requisitionid", "jobreqid", "jobpostingid", "positionid")
# titles that are really language pickers / nav, not jobs
_NOT_JOB = re.compile(r"^(english|deutsch|fran|espa|portug|italian|chinese|japanese|korean|"
                      r"dutch|polski|русск|عرب|nederlands|svenska|norsk|dansk|suomi|türk|"
                      r"\w{2}\s*\([a-z]{2}\)|[a-z]{2}-[a-z]{2})", re.I)


def _looks_like_job(d):
    """Does this dict look like a job posting? Title + a job-specific signal (job-style url,
    a real location, or a job/req id) — not just any object with a 'title' and an 'id'."""
    if not isinstance(d, dict):
        return False
    title = _first(d, _TITLE_KEYS)
    if not isinstance(title, str) or not (3 <= len(title.strip()) <= 160):
        return False
    if _NOT_JOB.match(title.strip()):
        return False
    url = _first(d, _URL_KEYS)
    has_job_url = isinstance(url, str) and bool(_JOB_HREF.search(url))
    has_loc = bool(_stringify_loc(_first(d, _LOC_KEYS)))
    has_jobid = _first(d, _STRONG_ID_KEYS) is not None
    return has_job_url or has_loc or has_jobid


def _map_job(d, base_url):
    title = _clean(_first(d, _TITLE_KEYS))
    jid = _first(d, _ID_KEYS)
    url = _first(d, _URL_KEYS)
    if isinstance(url, str) and url and not url.startswith("http"):
        url = urljoin(base_url, url)
    loc = _stringify_loc(_first(d, _LOC_KEYS))
    dept = _first(d, _DEPT_KEYS)
    dept = dept.get("name") if isinstance(dept, dict) else dept
    return {
        "ats_job_id": str(jid) if jid is not None else (url or title),
        "title": title, "location": loc,
        "remote": int("remote" in ((title or "") + " " + (loc or "")).lower()),
        "department": _clean(dept) if isinstance(dept, str) else None,
        "url": url if isinstance(url, str) else base_url,
        "description": None, "posted_at": _first(d, _DATE_KEYS),
    }


def _jobs_from_json(obj, base_url, out, depth=0):
    """Walk arbitrary parsed JSON; whenever we hit a list whose items look like jobs,
    map them. Recurse through dicts/lists to reach nested API envelopes."""
    if depth > 14:
        return
    if isinstance(obj, list):
        joblike = [x for x in obj if _looks_like_job(x)]
        if len(joblike) >= 2:                       # an actual results array
            for j in joblike:
                out.append(_map_job(j, base_url))
        for x in obj:                                # still recurse for nested arrays
            if isinstance(x, (list, dict)):
                _jobs_from_json(x, base_url, out, depth + 1)
    elif isinstance(obj, dict):
        for v in obj.values():
            if isinstance(v, (list, dict)):
                _jobs_from_json(v, base_url, out, depth + 1)


def _extract_dom(html: str, base_url: str):
    """Heuristic: pull job-like links + titles from rendered HTML."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")
    out, seen = [], set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        if not _JOB_HREF.search(href):
            continue
        url = urljoin(base_url, href)
        if url in seen:
            continue
        title = _clean(a.get_text(" ", strip=True))
        if len(title) < 4:
            h = a.find(["h1", "h2", "h3", "h4", "span"])
            title = _clean(h.get_text(" ", strip=True)) if h else title
        if len(title) < 4 or _BAD.match(title) or len(title) > 160:
            continue
        seen.add(url)
        loc = None
        par = a.find_parent(["li", "div", "article", "tr"])
        if par:
            lt = par.find(class_=re.compile(r"location|city|region|where", re.I))
            if lt:
                loc = _clean(lt.get_text(" ", strip=True))[:80]
        out.append({
            "ats_job_id": re.sub(r"https?://[^/]+", "", url)[:200] or url,
            "title": title, "location": loc, "remote": int("remote" in (title + (loc or "")).lower()),
            "department": None, "url": url, "description": None, "posted_at": None,
        })
    return out


# Pagination controls, tried in priority order. "Next" advances numbered/AJAX pagers;
# load-more handles incremental reveals; infinite scroll is the final fallback.
_NEXT_SELECTORS = [
    "a[rel='next']:not([aria-disabled='true'])",
    "[aria-label='Next' i]:not([disabled]):not([aria-disabled='true'])",
    "[aria-label='Next page' i]:not([disabled]):not([aria-disabled='true'])",
    "button[aria-label*='next' i]:not([disabled])",
    "a[aria-label*='next' i]:not([aria-disabled='true'])",
    "li.next:not(.disabled) a, a.next:not(.disabled)",
    "[class*='pagination'] [class*='next']:not([disabled]):not(.disabled)",
    "[class*='paging'] a[class*='next'], [class*='pager'] a[class*='next']",
    "button:has-text('Next'):not([disabled])",
    "a:has-text('Next'):not([aria-disabled='true'])",
    "[data-ph-at-id='pagination-next-link']",  # Phenom
]
_MORE_SELECTORS = [
    "button:has-text('Load more'):not([disabled])",
    "button:has-text('Show more'):not([disabled])",
    "a:has-text('Load more')", "a:has-text('Show more')",
    "button:has-text('See more'):not([disabled])",
    "[class*='load-more']:not([disabled])", "[class*='show-more']:not([disabled])",
    "button:has-text('More jobs'), button:has-text('View more')",
]


def scrape_careers(url: str, max_pages: int = 80) -> list[dict]:
    """Render the careers URL, capture both the rendered DOM and every JSON payload the
    page fetches, then merge job postings found in either. A general pagination engine
    drives Next / load-more / infinite-scroll to the end so the FULL list is collected,
    not just page one — the fix for sites that under-count (FedEx, custom AJAX boards)."""
    from playwright.sync_api import sync_playwright
    import json as _json

    jobs = {}
    json_blobs = []

    def on_response(resp):
        try:
            ct = (resp.headers or {}).get("content-type", "")
            if "json" not in ct and not resp.url.lower().endswith(("json", "graphql")):
                return
            if "graphql" in resp.url.lower() or "json" in ct:
                body = resp.text()
                if body and len(body) < 6_000_000 and ("{" in body or "[" in body):
                    json_blobs.append((body, resp.url))
        except Exception:
            pass

    def harvest(base_url):
        # DOM
        try:
            for j in _extract_dom(page.content(), page.url):
                jobs[j["url"]] = j
        except Exception:
            pass
        # captured JSON
        while json_blobs:
            body, src = json_blobs.pop()
            try:
                data = _json.loads(body)
            except Exception:
                continue
            found = []
            _jobs_from_json(data, base_url, found)
            for j in found:
                key = j["url"] if j["url"] != base_url else f"{j['ats_job_id']}::{j['title']}"
                jobs[key] = j

    def advance():
        """Drive whatever pagination the page has → True if it triggered more results.
        Tries, in order: a Next control (navigate via its href if it has one, else click),
        a Load-more control, then infinite scroll."""
        for sel in _NEXT_SELECTORS:
            try:
                el = page.query_selector(sel)
                if not (el and el.is_visible() and el.is_enabled()):
                    continue
                href = el.get_attribute("href")
                if href and not href.startswith("#") and "javascript" not in href.lower():
                    page.goto(urljoin(page.url, href), wait_until="domcontentloaded", timeout=20000)
                else:
                    el.scroll_into_view_if_needed(timeout=2000)
                    el.click(timeout=3000)
                return True
            except Exception:
                continue
        for sel in _MORE_SELECTORS:
            try:
                el = page.query_selector(sel)
                if el and el.is_visible():
                    el.scroll_into_view_if_needed(timeout=2000)
                    el.click(timeout=3000)
                    return True
            except Exception:
                continue
        try:
            prev = page.evaluate("document.body.scrollHeight")
            page.mouse.wheel(0, 30000)
            page.wait_for_timeout(1000)
            return page.evaluate("document.body.scrollHeight") > prev
        except Exception:
            return False

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                                            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"))
        page.on("response", on_response)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=35000)
        except Exception:
            browser.close()
            return []
        page.wait_for_timeout(2500)            # let client-rendered jobs paint
        harvest(page.url)
        # General pagination loop: advance, wait for the resulting load, harvest, repeat
        # until the job set stops growing (a few stale rounds) or we hit the page cap.
        stale = 0
        for _ in range(max_pages):
            before = len(jobs)
            moved = advance()
            page.wait_for_timeout(1300)            # let the new page/results settle
            harvest(page.url)
            grew = len(jobs) > before
            if grew:
                stale = 0
            else:
                stale += 1
                if stale >= (2 if not moved else 3):
                    break
        harvest(page.url)
        browser.close()
    # drop obvious non-jobs that slipped through
    clean = [j for j in jobs.values() if j.get("title") and len(j["title"]) >= 4
             and not _BAD.match(j["title"])]
    return clean
