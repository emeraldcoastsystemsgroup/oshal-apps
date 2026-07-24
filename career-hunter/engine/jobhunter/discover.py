"""Figure out which ATS a company uses, and the token to hit it.

Strategy, cheapest first:
  1. If we already have a careers_url, try to detect the ATS straight from it.
  2. Fetch the homepage, follow likely "careers/jobs" links, scan that page's HTML
     and links for known ATS hosts (handles iframes/embeds).
  3. Fall back to slug-probing: try name-derived slugs against each probeable ATS API.
"""
from __future__ import annotations
import re
import warnings
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

try:
    from bs4 import XMLParsedAsHTMLWarning
    warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
except Exception:
    pass

from . import http, ats

# Discovery probes lots of maybe-dead URLs, so use a short per-fetch timeout
# (the default 20s makes a full run take hours when guessed URLs hang).
_T = 7

_CAREER_HINT = re.compile(r"care+rs?|jobs|join-?us|work-?with|opportunit|life-at|talent", re.I)
# ATS hosts that appear as bare URLs inside page HTML/JS (not always in href/src attrs).
_ATS_IN_HTML = re.compile(
    r"https?://[a-z0-9.-]*(?:myworkdayjobs\.com|greenhouse\.io|lever\.co|ashbyhq\.com|"
    r"smartrecruiters\.com|workable\.com|icims\.com|taleo\.net|successfactors\.com|"
    r"avature\.net|phenompeople\.com)[^\s\"'<>]*", re.I)


def _slugs(name: str):
    """Candidate ATS tokens derived from a company name."""
    base = re.sub(r"[^a-z0-9]+", "", name.lower())
    nospace = re.sub(r"[^a-z0-9]+", "", name.lower())
    dashed = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    # drop common suffixes
    trimmed = re.sub(r"(inc|corp|corporation|co|company|ltd|llc|plc|group|holdings)$", "", base)
    out = []
    for s in (base, nospace, dashed, trimmed):
        if s and s not in out:
            out.append(s)
    return out


def _find_career_links(html: str, base_url: str):
    """Return [('ats', type, token), ...] for every ATS host on the page,
    followed by [('page', url, None), ...] for likely careers links to follow."""
    soup = BeautifulSoup(html, "lxml")
    ats_hits, links = [], set()
    seen = set()

    def add_ats(url):
        atype, tok = ats.detect_from_url(url)
        if atype and (atype, tok) not in seen:
            seen.add((atype, tok))
            ats_hits.append(("ats", atype, tok))
            return True
        return False

    for tag in soup.find_all(["a", "iframe", "link", "script"]):
        href = tag.get("href") or tag.get("src")
        if not href:
            continue
        absu = urljoin(base_url, href)            # resolve relative links (e.g. /en/search-jobs)
        if not (add_ats(href) or add_ats(absu)) and _CAREER_HINT.search(href):
            links.add(absu)
    # ATS URLs embedded as bare text in scripts/JSON (Workday/iCIMS often live here).
    for m in _ATS_IN_HTML.finditer(html):
        add_ats(m.group(0))
    return ats_hits + [("page", url, None) for url in list(links)[:8]]


def _validate(atype: str, token: str) -> bool:
    """An ATS candidate is only 'found' if it actually returns at least one posting."""
    try:
        return bool(ats.fetch(atype, token))
    except Exception:
        return False


def _guess_homepages(name: str):
    """Best-effort homepage guesses from the company name (used when none is given)."""
    base = re.sub(r"[^a-z0-9]+", "", name.lower())
    trimmed = re.sub(r"(inc|corp|corporation|co|company|ltd|llc|plc|group|holdings|international)$", "", base)
    seen, out = set(), []
    for slug in (trimmed, base):
        if slug and slug not in seen:
            seen.add(slug)
            out.append(f"https://www.{slug}.com")
    return out


_CAREERS_HREF = re.compile(r"care+rs?|/jobs|join-?us|work-?with-?us|life-?at|talent|/job\b", re.I)


def google_careers_url(company: str):
    """Ask Google for the company's careers page — the first relevant link.
    Returns (careers_url, ats_type_or_None, ats_token_or_None) or (None, None, None)."""
    from . import config
    if not (config.GOOGLE_API_KEY and config.GOOGLE_CX):
        return None, None, None
    try:
        r = http.get_once("https://www.googleapis.com/customsearch/v1", timeout=12, params={
            "key": config.GOOGLE_API_KEY, "cx": config.GOOGLE_CX,
            "q": f"{company} careers jobs", "num": 8,
        })
        items = (r.json() or {}).get("items", []) if r.ok else []
    except Exception:
        return None, None, None
    if not items:
        return None, None, None
    links = [it.get("link", "") for it in items if it.get("link")]
    # 1) prefer a result that IS a supported ATS (we can scrape it directly)
    for link in links:
        atype, tok = ats.detect_from_url(link)
        if atype and _validate(atype, tok):
            return link, atype, tok
    # 2) else prefer a careers-looking URL
    for link in links:
        if _CAREERS_HREF.search(link):
            return link, None, None
    # 3) else the top result
    return links[0], None, None


def _safe_get(url):
    try:
        r = http.get_once(url, timeout=_T, allow_redirects=True)
        return r if (r.ok and r.text) else None
    except Exception:
        return None


def _pick_careers_link(html: str, base_url: str):
    """The careers/jobs link a human would click on a homepage. Returns absolute URL or None."""
    soup = BeautifulSoup(html, "lxml")
    best = None
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        text = a.get_text(" ", strip=True).lower()
        h = href.lower()
        score = 0
        if "career" in h:
            score = 4
        elif re.search(r"/jobs?\b|join-?us|work-?with", h):
            score = 3
        elif "career" in text or text in ("jobs", "join us", "join our team", "work with us"):
            score = 2
        elif "job" in text:
            score = 1
        if score:
            absu = urljoin(base_url, href)
            if absu.startswith("http") and (best is None or score > best[0]):
                best = (score, absu)
    return best[1] if best else None


def _constructed_careers(host: str):
    """Try common careers URLs; return the first that loads (not a 404)."""
    for cu in (f"https://careers.{host}", f"https://{host}/careers",
               f"https://jobs.{host}", f"https://{host}/en/careers"):
        r = _safe_get(cu)
        if r and ("career" in r.url.lower() or "job" in r.url.lower() or r.url.rstrip("/") != f"https://{host}"):
            return r.url
    return None


def _scan_for_ats(html: str, page_url: str):
    """Return (ats_type, token) if a supported, non-empty ATS is referenced on the page."""
    atype, tok = ats.detect_from_url(page_url)
    if atype and _validate(atype, tok):
        return atype, tok
    for kind, a, b in _find_career_links(html, page_url):
        if kind == "ats" and _validate(a, b):
            return a, b
    return None


def discover_company(name: str, homepage: str | None, careers_url: str | None):
    """Capture the company's careers/jobs URL (works for ~every company), and detect a
    scrapable ATS as a bonus. Returns dict(ats_type, ats_token, careers_url, status).

    status: 'found'  = scrapable ATS resolved (and careers_url set)
            'careers_only' = clickable careers URL captured, but no supported ATS to scrape
            'not_found' = couldn't even locate a careers page
    """
    homepage = homepage or (_guess_homepages(name) or [None])[0]
    careers = careers_url
    ats_type = ats_token = None

    # 0) Google search — "the first link". Most reliable; gets special careers.xxx subdomains.
    g_url, g_type, g_tok = google_careers_url(name)
    if g_url:
        careers = careers or g_url
        if g_type:
            ats_type, ats_token = g_type, g_tok

    # already have a careers_url? try to detect its ATS.
    if careers and not ats_type:
        hit = ats.detect_from_url(careers)
        if hit[0] and _validate(*hit):
            ats_type, ats_token = hit

    # homepage: grab the careers link + scan for an ATS
    if homepage:
        r = _safe_get(homepage)
        if r:
            careers = careers or _pick_careers_link(r.text, r.url)
            if not ats_type:
                hit = _scan_for_ats(r.text, r.url)
                if hit:
                    ats_type, ats_token = hit

    # fetch the careers page itself: it usually redirects into / embeds the real ATS
    if careers and not ats_type:
        r = _safe_get(careers)
        if r:
            careers = r.url  # follow to the real (often ATS-powered) jobs URL
            hit = _scan_for_ats(r.text, r.url)
            if hit:
                ats_type, ats_token = hit

    # constructed careers fallback if we still have no jobs URL
    if not careers and homepage:
        careers = _constructed_careers(urlparse(homepage).netloc.replace("www.", ""))
        if careers and not ats_type:
            r = _safe_get(careers)
            if r:
                hit = _scan_for_ats(r.text, r.url)
                if hit:
                    ats_type, ats_token = hit

    # bonus: Workday tenant-probe + API slug-probes (don't need a careers URL)
    if not ats_type:
        wd_slugs = []
        if homepage:
            wd_slugs.append(urlparse(homepage).netloc.replace("www.", "").split(".")[0])
        wd_slugs += _slugs(name)
        for slug in dict.fromkeys(wd_slugs):
            try:
                tok = ats.Workday.probe_tenant(slug)
            except Exception:
                tok = None
            if tok:
                ats_type, ats_token = "workday", tok
                break
    if not ats_type:
        for slug in _slugs(name):
            for conn in ats.PROBE_ORDER:
                try:
                    tok = conn.probe(slug)
                except Exception:
                    tok = None
                if tok and _validate(conn.NAME, tok):
                    ats_type, ats_token = conn.NAME, tok
                    break
            if ats_type:
                break

    status = "found" if ats_type else ("careers_only" if careers else "not_found")
    return {"ats_type": ats_type, "ats_token": ats_token, "careers_url": careers, "status": status}
