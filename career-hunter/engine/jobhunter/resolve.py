"""Universal platform resolver: for any company, follow its careers page and auto-detect
which ATS it runs on — Workday, Oracle ORC, Radancy, Phenom, SuccessFactors, Taleo, Google —
then wire + scrape it. No hand-fed URLs.

HTTP-only (fast). Sites that hide the ATS behind JavaScript stay on the to-do list; the
large majority expose it in the page HTML or a redirect.
"""
from __future__ import annotations
import re
from urllib.parse import urlparse, urljoin

from . import db, ats, http

_WD = re.compile(r"([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com/(?:wday/cxs/[a-z0-9-]+/)?(?:[a-z]{2}-[A-Z]{2}/)?([A-Za-z0-9_]+)", re.I)
_TALEO = re.compile(r"(\w+\.taleo\.net)/(\w+)/ats/careers.*?org=([A-Za-z0-9_]+).*?cws=(\d+)", re.I)
_CAREER_LINK = re.compile(r"search-jobs|search-results|careers-home|/search/?|/jobs|find-?jobs|view-?jobs|/go/", re.I)


def _host(url):
    u = url if "://" in url else "https://" + url
    return urlparse(u).netloc


def _validate(atype, token):
    try:
        return bool(ats.fetch(atype, token))
    except Exception:
        return False


def classify_url(url: str):
    """Read the ATS platform + token straight off a pasted careers URL.
    Returns (ats_type, token) or None. Pure string parsing for most platforms;
    only Oracle ORC needs one network hop to extract its backend host + site code."""
    u = (url or "").strip()
    if not u:
        return None
    full = u if "://" in u else "https://" + u
    pu = urlparse(full)
    host = pu.netloc.lower()
    path = pu.path or "/"
    low = full.lower()

    # ── Workday: {tenant}.{wdN}.myworkdayjobs.com/[locale/]{site} ───────────
    m = re.search(r"([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com", low)
    if m:
        tenant, wd = m.group(1), m.group(2)
        mm = re.search(r"/wday/cxs/[a-z0-9-]+/([A-Za-z0-9_]+)/", path)
        if mm:
            return ("workday", f"{tenant}:{wd}:{mm.group(1)}")
        segs = [s for s in path.split("/") if s
                and not re.fullmatch(r"[a-z]{2}(-[a-zA-Z]{2})?", s)]
        if segs:
            return ("workday", f"{tenant}:{wd}:{segs[0]}")
        return ("workday_host", f"{tenant}.{wd}")

    # ── iCIMS native ───────────────────────────────────────────────────────
    m = re.search(r"([a-z0-9-]+\.icims\.com)", low)
    if m:
        return ("icims", m.group(1))

    # ── Eightfold ──────────────────────────────────────────────────────────
    # Hosted: {company}.eightfold.ai/careers  (Morgan Stanley, many others)
    m = re.search(r"([a-z0-9-]+)\.eightfold\.ai", low)
    if m:
        return ("eightfold", f"{m.group(1)}.eightfold.ai|{m.group(1)}.com")
    # Vanity: apply.{domain}/careers?...pid=...  (HP, Microsoft, etc.)
    m = re.search(r"(apply\.([a-z0-9-]+\.[a-z.]+))/careers", low)
    if m and ("pid=" in low or "sort_by=" in low or "/careers" in path):
        return ("eightfold", f"{m.group(1)}|{m.group(2)}")

    # ── Avature ────────────────────────────────────────────────────────────
    if ".avature.net" in low:
        return ("avature", host)

    # ── Jibe (iCIMS career-site front end) ─────────────────────────────────
    m = re.search(r"([a-z0-9-]+)\.jibeapply\.com", low)
    if m:
        return ("jibe", m.group(1))

    # ── Greenhouse / Lever / Ashby / SmartRecruiters / Workable ────────────
    m = re.search(r"(?:boards|job-boards)\.greenhouse\.io/(?:embed/job_board\?for=)?([a-z0-9_-]+)", low) \
        or re.search(r"greenhouse\.io/embed/job_board\?for=([a-z0-9_-]+)", low)
    if m:
        return ("greenhouse", m.group(1))
    m = re.search(r"jobs\.lever\.co/([a-z0-9-]+)", low)
    if m:
        return ("lever", m.group(1))
    m = re.search(r"jobs\.ashbyhq\.com/([a-z0-9._-]+?)(?:/|\?|$)", low)
    if m:
        return ("ashby", m.group(1))
    m = re.search(r"(?:careers|jobs)\.smartrecruiters\.com/([A-Za-z0-9_-]+)", full)
    if m:
        return ("smartrecruiters", m.group(1))
    m = re.search(r"apply\.workable\.com/([a-z0-9-]+)", low)
    if m:
        return ("workable", m.group(1))

    # ── General Dynamics custom careers API ────────────────────────────────
    if re.search(r"(?:^|\.)gd\.com/careers", low) or host.endswith("gd.com") and "/careers" in path:
        return ("gdcareers", host)

    # ── Goldman Sachs (higher.gs.com) public GraphQL ───────────────────────
    if "higher.gs.com" in low:
        return ("gsroles", "gs")

    # ── Brassring (IBM/Infinite Kenexa) — needs partnerid + siteid ─────────
    if "sjobs.brassring.com" in low or ".brassring.com" in low:
        pid = re.search(r"partnerid=(\d+)", low)
        sid = re.search(r"siteid=(\d+)", low)
        if pid and sid:
            return ("brassring", f"{pid.group(1)}|{sid.group(1)}")

    # ── Taleo (TBE + enterprise) ───────────────────────────────────────────
    if ".taleo.net" in low:
        return ("taleo", full)

    # ── Oracle Recruiting Cloud ────────────────────────────────────────────
    # Direct backend URL (….oraclecloud.com/…/sites/CX_xxxx/jobs) → build token straight off it.
    if "oraclecloud.com" in host:
        ms = re.search(r"/sites/([A-Za-z0-9_]+)", full)
        if ms:
            return ("oracle_orc", f"{host}|{ms.group(1)}|{host}")
    # Vanity careers host with a /sites/{SITE}/ SPA (often behind a # fragment) → resolve backend.
    if re.search(r"/sites/[A-Za-z0-9_]+/(?:jobs|requisitions)", full, re.I) or "oraclecloud.com" in low:
        tok = ats.resolve_orc(host)
        if tok:
            return ("oracle_orc", tok)

    # ── SuccessFactors (SAP) — /search/ board with its tell-tale params ─────
    if "sapsf.com" in low or (
        "/search" in path and ("searchresultview" in low or "optionsfacetsdd" in low
                               or "locationsearch" in low or "successfactors" in low)):
        return ("successfactors", host)

    # ── Phenom — only the unambiguous hosted form ──────────────────────────
    if "phenompeople.com" in low:
        return ("phenom", host)

    return None


# ATS host patterns worth re-classifying when found embedded in a careers page's HTML.
_EMBED_HOSTS = re.compile(
    r"https?://[a-z0-9.\-]*(?:myworkdayjobs\.com|icims\.com|jibeapply\.com|avature\.net|"
    r"oraclecloud\.com|greenhouse\.io|jobs\.lever\.co|ashbyhq\.com|smartrecruiters\.com)[a-z0-9.\-/_?=&#]*",
    re.I)


def classify_url_deep(url: str):
    """classify_url first; if the URL pattern is ambiguous, do up to a few cheap network
    probes — Pinpoint board, Phenom /widgets, SuccessFactors /search, and finally follow
    the page HTML to whatever ATS host it embeds (Workday/Oracle/iCIMS/Jibe…)."""
    hit = classify_url(url)
    if hit and hit[0] != "workday_host":
        return hit
    host = _host(url)

    # Pinpoint board (jobs.{co}.com/postings.json)
    try:
        r = http.get_once(f"https://{host}/postings.json", timeout=15)
        if r.ok and isinstance(r.json(), dict) and r.json().get("data"):
            return ("pinpoint", host)
    except Exception:
        pass
    # Phenom widgets
    if _try_phenom(host):
        return ("phenom", host)
    # Radancy / TalentBrew (/search-jobs results JSON) — Chipotle, many big brands
    if re.search(r"search-jobs|job-search-results|/go/", (url or ""), re.I):
        try:
            if ats.Radancy.fetch(host):
                return ("radancy", host)
        except Exception:
            pass
    # SuccessFactors server-rendered /search/
    try:
        if "/search" in (urlparse(url if "://" in url else "https://" + url).path) and \
                ats.SuccessFactors.fetch(host):
            return ("successfactors", host)
    except Exception:
        pass
    # Oracle ORC backend hiding in the page (e.g. #fragment SPAs like American Tower)
    tok = ats.resolve_orc(host)
    if tok:
        return ("oracle_orc", tok)
    # Follow the page HTML to the real ATS host it loads (AEP -> Workday, etc.)
    try:
        full = url if "://" in url else "https://" + url
        r = http.get_once(full, timeout=20)
        blob = (r.url + " " + r.text) if r.ok else ""
    except Exception:
        blob = ""
    if blob:
        for cand in dict.fromkeys(_EMBED_HOSTS.findall(blob)):
            sub = classify_url(cand)
            if sub and sub[0] in ("workday", "oracle_orc", "icims", "jibe",
                                  "greenhouse", "lever", "ashby", "smartrecruiters", "avature"):
                return sub
        # Last resort: the page renders its job listings straight into HTML (e.g. Hilti).
        # If we can see several /jobs/{id} links, the generic HtmlList connector handles it.
        try:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(blob, "lxml")
            if len(ats.HtmlList._links(soup)) >= 5:
                return ("htmllist", (url if "://" in url else "https://" + url))
        except Exception:
            pass
    return hit  # workday_host or None


def _try_phenom(host):
    try:
        r = http.post(f"https://{host}/widgets", timeout=18, json={
            "lang": "en_us", "deviceType": "desktop", "country": "us", "pageName": "search-results",
            "ddoKey": "refineSearch", "from": 0, "jobs": True, "size": 1, "pageType": "search-results",
            "siteType": "external", "keywords": "", "selected_fields": {}, "locationData": {}})
        if r.ok:
            d = r.json()
            for k in ("refineSearch", "eagerLoadRefineSearch"):
                if ((d.get(k) or {}).get("data") or {}).get("jobs"):
                    return True
    except Exception:
        pass
    return False


def _try_sf(host):
    try:
        r = http.get_once(f"https://{host}/search/", params={"q": "", "startrow": 0}, timeout=15)
        return r.ok and ("jobTitle-link" in r.text or "/job/" in r.text)
    except Exception:
        return False


def _detect_in(blob, host):
    """Detect a platform from a page blob (final_url + html). Returns (atype, token) or None."""
    m = _WD.search(blob)
    if m:
        tok = f"{m.group(1)}:{m.group(2)}:{m.group(3)}"
        if _validate("workday", tok):
            return "workday", tok
    m = _TALEO.search(blob)
    if m:
        tok = f"{m.group(1)}|{m.group(2)}|{m.group(3)}|{m.group(4)}"
        if _validate("taleo", tok):
            return "taleo", tok
    if "oraclecloud.com" in blob or "/sites/" in blob:
        tok = ats.resolve_orc(host)
        if tok and _validate("oracle_orc", tok):
            return "oracle_orc", tok
    if "google.com/about/careers" in blob:
        return "google", "google"
    if re.search(r"search-jobs(/results)?", blob) and _validate("radancy", host):
        return "radancy", host
    if _try_phenom(host):
        return "phenom", host
    if _try_sf(host):
        return "successfactors", host
    return None


def _candidate_starts(careers_url, homepage, name):
    """Pages to try: the known careers URL, the homepage, AND constructed careers hosts
    derived from the domain/name (handles companies where no careers page was ever found)."""
    cands = [u for u in (careers_url, homepage) if u]
    domain = None
    if homepage:
        domain = urlparse(homepage if "://" in homepage else "https://" + homepage).netloc.replace("www.", "")
    if not domain and name:
        slug = re.sub(r"[^a-z0-9]", "", name.lower())
        slug = re.sub(r"(incorporated|inc|corporation|corp|company|co|ltd|llc|plc|group|holdings|international)$", "", slug)
        if slug:
            domain = slug + ".com"
    if domain:
        cands += [f"https://careers.{domain}", f"https://jobs.{domain}",
                  f"https://{domain}/careers", f"https://{domain}/careers/", f"https://{domain}/jobs"]
    return list(dict.fromkeys(cands))


def resolve_platform(careers_url, homepage=None, name=None):
    """Return (ats_type, token) for a company, or None."""
    seen = set()
    for start in _candidate_starts(careers_url, homepage, name):
        try:
            r = http.get_once(start, timeout=15)
        except Exception:
            continue
        if not (r.ok and r.text):
            continue
        host = _host(r.url)
        hit = _detect_in(r.url + r.text, host)
        if hit:
            return hit
        # follow up to a few likely careers/jobs sub-links one hop
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(r.text, "lxml")
        cand = []
        for a in soup.find_all("a", href=True):
            if _CAREER_LINK.search(a["href"]):
                cand.append(urljoin(r.url, a["href"]))
        for u in list(dict.fromkeys(cand))[:5]:
            if u in seen:
                continue
            seen.add(u)
            try:
                rr = http.get_once(u, timeout=15)
            except Exception:
                continue
            if not (rr.ok and rr.text):
                continue
            hit = _detect_in(rr.url + rr.text, _host(rr.url))
            if hit:
                return hit
    return None


def _platform_from_apis(urls, page_host):
    """Identify the ATS from the API URLs a careers page calls. Returns (atype, token) or None."""
    for u in urls:
        lu = u.lower()
        m = re.search(r"https?://([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com/wday/cxs/[a-z0-9-]+/([A-Za-z0-9_]+)/jobs", u, re.I)
        if m:
            return "workday", f"{m.group(1)}:{m.group(2)}:{m.group(3)}"
        if "recruitingcejobrequisitions" in lu:
            host = urlparse(u).netloc
            ms = re.search(r"sitenumber=([A-Za-z0-9_]+)", lu)
            if ms:
                return "oracle_orc", f"{host}|{ms.group(1)}|{page_host}"
        if "/api/pcsx/" in lu:
            host = urlparse(u).netloc
            md = re.search(r"domain=([a-z0-9.]+)", lu)
            return "eightfold", f"{host}|{md.group(1) if md else page_host}"
        m = re.search(r"smartrecruiters\.com/v1/companies/([a-z0-9-]+)", u, re.I)
        if m:
            return "smartrecruiters", m.group(1)
        m = re.search(r"boards-api\.greenhouse\.io/v1/boards/([a-z0-9_-]+)", u, re.I)
        if m:
            return "greenhouse", m.group(1)
        m = re.search(r"api\.lever\.co/v0/postings/([a-z0-9-]+)", u, re.I)
        if m:
            return "lever", m.group(1)
        m = re.search(r"ashbyhq\.com/posting-api/job-board/([a-z0-9._-]+)", u, re.I)
        if m:
            return "ashby", m.group(1)
        if "phenompeople.com" in lu or lu.split("?")[0].rstrip("/").endswith("/widgets"):
            return "phenom", page_host
        if "myworkdayjobs.com" in lu:  # workday but non-standard cxs path
            m = re.search(r"https?://([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com", u, re.I)
            if m:
                return "workday_host", f"{m.group(1)}.{m.group(2)}"
    return None


def resolve_rendered(careers_url, homepage=None, name=None, browser=None):
    """Render the page(s) in a headless browser, capture the job-API call, identify the platform."""
    own = browser is None
    if own:
        from playwright.sync_api import sync_playwright
        pw = sync_playwright().start()
        browser = pw.chromium.launch()
    try:
        for start in _candidate_starts(careers_url, homepage, name)[:4]:
            urls = []
            page = browser.new_page()
            page.on("response", lambda r: urls.append(r.url) if ("json" in (r.headers.get("content-type", "")) or
                     any(k in r.url.lower() for k in ["myworkdayjobs", "oraclecloud", "pcsx", "widgets",
                     "smartrecruiters", "greenhouse", "lever.co", "ashbyhq", "phenompeople"])) else None)
            try:
                page.goto(start, wait_until="domcontentloaded", timeout=20000)
                page.wait_for_timeout(3500)  # let the jobs XHR fire (don't wait for full networkidle)
            except Exception:
                pass
            host = urlparse(page.url).netloc or urlparse(start).netloc
            hit = _platform_from_apis(urls, host)
            page.close()
            if hit and hit[0] != "workday_host":
                if _validate(*hit):
                    return hit
            if hit and hit[0] == "workday_host":   # need the site name; try common ones
                tenant_dc = hit[1]
                for site in ("External", "External_Career_Site", "Careers", "careers"):
                    tok = tenant_dc.replace(".", ":") + f":{site}"
                    if _validate("workday", tok):
                        return "workday", tok
        return None
    finally:
        if own:
            browser.close()
            pw.stop()


def run_render(limit=None):
    """Render-based resolution for companies HTTP couldn't crack (JS-loaded sites)."""
    from playwright.sync_api import sync_playwright
    with db.connect() as c:
        # READ stays on `companies` in both backends — a real table in sqlite mode, the 097
        # compat VIEW in postgres mode, same columns either way. Only the WRITES below have
        # to name the base table.
        rows = [dict(r) for r in c.execute(
            "SELECT id, name, careers_url, homepage FROM companies WHERE ats_type IS NULL ORDER BY name").fetchall()]
    if limit:
        rows = rows[:limit]
    print(f"render-resolving {len(rows)} JS-loaded companies...", flush=True)
    unlocked = total = 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for i, r in enumerate(rows, 1):
            try:
                hit = resolve_rendered(r.get("careers_url"), r.get("homepage"), r.get("name"), browser=browser)
            except Exception:
                hit = None
            if hit:
                atype, token = hit
                try:
                    postings = ats.fetch(atype, token)
                except Exception:
                    postings = None
                if postings:
                    ct = db.companies_table()
                    with db.connect() as c:
                        c.execute(f"UPDATE {ct} SET ats_type=?, ats_token=?, discover_status='found' WHERE id=?",
                                  (atype, token, r["id"]))
                        seen = set()
                        for p in postings:
                            if p.get("ats_job_id") is None:
                                continue
                            db.upsert_posting(c, r["id"], p); seen.add(str(p["ats_job_id"]))
                        db.deactivate_missing(c, r["id"], seen)
                        c.execute(f"UPDATE {ct} SET last_scraped_at=? WHERE id=?", (db.now(), r["id"]))
                    unlocked += 1; total += len(postings)
                    print(f"  [{i}/{len(rows)}] UNLOCKED {r['name']} ({atype}): {len(postings)}", flush=True)
                    continue
            if i % 20 == 0:
                print(f"  [{i}/{len(rows)}] ... {unlocked} unlocked", flush=True)
        browser.close()
    print(f"\nRender-resolved {unlocked} companies, {total} jobs.", flush=True)
    return unlocked, total


def run_all(limit=None, workers=10):
    """Resolve + scrape every no-data company we can. Concurrent."""
    import concurrent.futures as cf
    with db.connect() as c:
        # READ stays on `companies` in both backends — a real table in sqlite mode, the 097
        # compat VIEW in postgres mode, same columns either way. Only the WRITES below have
        # to name the base table.
        rows = [dict(r) for r in c.execute(
            "SELECT id, name, careers_url, homepage FROM companies WHERE ats_type IS NULL ORDER BY name").fetchall()]
    if limit:
        rows = rows[:limit]
    print(f"resolving {len(rows)} companies across all platforms...", flush=True)
    unlocked = total = done = 0

    def work(r):
        hit = resolve_platform(r.get("careers_url"), r.get("homepage"), r.get("name"))
        if not hit:
            return r, None, None
        atype, token = hit
        try:
            return r, hit, ats.fetch(atype, token)
        except Exception:
            return r, hit, None

    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for r, hit, postings in ex.map(work, rows):
            done += 1
            if hit and postings:
                atype, token = hit
                ct = db.companies_table()
                with db.connect() as c:
                    c.execute(f"UPDATE {ct} SET ats_type=?, ats_token=?, discover_status='found' WHERE id=?",
                              (atype, token, r["id"]))
                    seen = set()
                    for p in postings:
                        if p.get("ats_job_id") is None:
                            continue
                        db.upsert_posting(c, r["id"], p); seen.add(str(p["ats_job_id"]))
                    db.deactivate_missing(c, r["id"], seen)
                    c.execute(f"UPDATE {ct} SET last_scraped_at=? WHERE id=?", (db.now(), r["id"]))
                unlocked += 1; total += len(postings)
                print(f"  [{done}/{len(rows)}] UNLOCKED {r['name']} ({atype}): {len(postings)}", flush=True)
            elif done % 25 == 0:
                print(f"  [{done}/{len(rows)}] ... {unlocked} unlocked", flush=True)
    print(f"\nResolved {unlocked} companies, {total} jobs.", flush=True)
    return unlocked, total
