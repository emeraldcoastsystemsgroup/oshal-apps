"""Find and VET the in-house recruiters for a company, so the user can reach out directly.

We never log into or scrape LinkedIn as the user (that risks his account). Instead we
query a public search engine for already-public LinkedIn profiles, then apply an
intelligence layer that keeps only people who look like a CURRENT recruiter EMPLOYED BY
the target company — not third-party staffing-agency middlemen.

Backends (best first): Google Programmable Search (if a key is configured) → DuckDuckGo
HTML (no key). Always also returns ready-to-click LinkedIn + Google search URLs as a
manual fallback. The user does the actual outreach through LinkedIn's own UI.
"""
from __future__ import annotations
import re
import urllib.parse

from . import http, config

_RECRUITER = re.compile(
    r"recruit|talent acquisition|\btalent\b|sourcer|sourcing|people (?:&|and) talent|"
    r"head of (?:talent|people|ta)\b|\bta\b partner|talent partner|staffing partner|"
    r"people operations|people team|hiring", re.I)

# Third-party staffing / search firms — a recruiter AT one of these is a middleman, not in-house.
_AGENCY = re.compile(
    r"robert half|teksystems|tek systems|insight global|aerotek|randstad|adecco|kforce|"
    r"apex systems|beacon hill|cybercoders|jobot|motion recruitment|harvey nash|hays|"
    r"michael page|korn ferry|heidrick|russell reynolds|recruiting agency|staffing|"
    r"search firm|search partners|talent solutions|consulting group|recruitment agency|"
    r"headhunt|executive search|rpo\b", re.I)

_LINKEDIN_IN = re.compile(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9\-_%]+", re.I)

# Search engines return empty for bot-identifying UAs — use a normal browser UA.
_BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
               "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def _norm(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"\b(inc|incorporated|corp|corporation|co|llc|ltd|plc|the|industries|"
               r"technologies|holdings|group|company|federal|services?)\b", " ", s)
    return re.sub(r"[^a-z0-9]", "", s)


def search_links(company: str) -> dict:
    """Always-available manual fallbacks: a LinkedIn people search + a Google X-ray search."""
    li = ("https://www.linkedin.com/search/results/people/?keywords="
          + urllib.parse.quote(f'{company} recruiter talent acquisition'))
    gx = ("https://www.google.com/search?q="
          + urllib.parse.quote(f'site:linkedin.com/in (recruiter OR "talent acquisition") "{company}"'))
    return {"linkedin_people_search": li, "google_xray": gx}


def _clean_title(t: str) -> str:
    t = re.sub(r"\s*[\|\-–]\s*LinkedIn\s*$", "", t or "", flags=re.I)
    return t.strip()


def _parse_name(title: str, url: str) -> str:
    # Prefer the human name before the first " - " / " – " if it reads like a name.
    m = re.match(r"\s*([A-Z][A-Za-z.''\-]+(?:\s+[A-Z][A-Za-z.''\-]+){0,3})\s*[\-–]\s", title or "")
    if m and not _RECRUITER.search(m.group(1)):
        return m.group(1).strip()
    # else humanize the /in/ slug
    slug = re.sub(r"^https?://[^/]+/in/", "", url or "").strip("/").split("/")[0]
    slug = re.sub(r"-[0-9a-f]{6,}$", "", slug)       # drop the trailing id hash
    slug = re.sub(r"[0-9]+$", "", slug)
    name = re.sub(r"[-_]+", " ", urllib.parse.unquote(slug)).strip()
    return name.title() if name else "(name on profile)"


def _employer(title: str):
    """Pull the employer that follows 'at' / '@' / '|' in a LinkedIn result title."""
    m = re.search(r"(?:\bat\b|@|\|)\s*([A-Z][A-Za-z0-9&.,'’\- ]{1,50})", title or "")
    return m.group(1).strip(" .|-") if m else None


def _google_cse(query: str, want: int):
    if not (config.GOOGLE_API_KEY and config.GOOGLE_CX):
        return []
    out = []
    try:
        r = http.get_once("https://www.googleapis.com/customsearch/v1", timeout=15, params={
            "key": config.GOOGLE_API_KEY, "cx": config.GOOGLE_CX, "q": query, "num": min(want, 10)})
        if r.ok:
            for it in (r.json().get("items") or []):
                out.append((it.get("title", ""), it.get("link", ""), it.get("snippet", "")))
    except Exception:
        pass
    return out


def _firecrawl(query: str, want: int):
    """Web search via Firecrawl's /v1/search (works where Google's closed JSON API can't)."""
    if not config.FIRECRAWL_API_KEY:
        return []
    out = []
    try:
        r = http.post_once(
            "https://api.firecrawl.dev/v1/search",
            json={"query": query, "limit": min(want, 10)},
            timeout=40,
            headers={"Authorization": f"Bearer {config.FIRECRAWL_API_KEY}",
                     "Content-Type": "application/json"})
        if r.ok:
            for it in (r.json().get("data") or []):
                out.append((it.get("title", ""), it.get("url", ""), it.get("description", "") or ""))
    except Exception:
        pass
    return out


def _ddg(query: str):
    from bs4 import BeautifulSoup
    out = []
    try:
        r = http.post_once("https://html.duckduckgo.com/html/", data={"q": query},
                           timeout=20, headers={"User-Agent": _BROWSER_UA,
                                                "Accept": "text/html,application/xhtml+xml"})
        if not r.ok:
            return out
        soup = BeautifulSoup(r.text, "lxml")
        for a in soup.select("a.result__a"):
            href = a.get("href", "")
            m = re.search(r"uddg=([^&]+)", href)
            url = urllib.parse.unquote(m.group(1)) if m else href
            snip = ""
            row = a.find_parent(class_=re.compile("result"))
            if row:
                s = row.find(class_=re.compile("result__snippet"))
                snip = s.get_text(" ", strip=True) if s else ""
            out.append((a.get_text(" ", strip=True), url, snip))
    except Exception:
        pass
    return out


def find_recruiters(company: str, limit: int = 8) -> dict:
    """Return {recruiters: [...], links: {...}, source: str}. Each recruiter is vetted to be
    a current, in-house recruiter at `company` (best-effort) with a confidence score."""
    ckey = _norm(company)
    queries = [
        f'site:linkedin.com/in (recruiter OR "talent acquisition") "{company}"',
        f'site:linkedin.com/in ("technical recruiter" OR "talent partner" OR sourcer) "{company}"',
    ]
    raw, source = [], "none"
    for q in queries:
        hits = _firecrawl(q, limit)
        if hits:
            source = "firecrawl"
        else:
            hits = _google_cse(q, limit)
            if hits:
                source = source if source == "firecrawl" else "google"
            else:
                hits = _ddg(q)
                source = source if source in ("firecrawl", "google") else "duckduckgo"
        raw.extend(hits)
        if len({u for _, u, _ in raw}) >= limit + 4:
            break

    seen, recruiters = set(), []
    for title, url, snip in raw:
        mu = _LINKEDIN_IN.search(url or "")
        if not mu:
            continue
        prof = mu.group(0).split("?")[0]
        if prof in seen:
            continue
        title = _clean_title(title)
        blob = f"{title} {snip}"
        if not _RECRUITER.search(blob):
            continue
        employer = _employer(title) or _employer(snip)
        emp_norm = _norm(employer) if employer else ""
        # in-house check: company appears in the employer slot OR clearly in the blob,
        # and the employer is not a different/agency company.
        company_present = ckey and (ckey in _norm(blob))
        employer_matches = bool(emp_norm and (ckey in emp_norm or emp_norm in ckey)) if emp_norm else company_present
        is_agency = bool(_AGENCY.search(blob)) and not (ckey and ckey in _norm(_AGENCY.sub("", blob)))
        if is_agency or not company_present:
            continue
        # confidence: explicit "...at {Company}" beats company-only-in-snippet
        conf = "high" if employer_matches and _RECRUITER.search(title) else \
               "medium" if employer_matches else "low"
        seen.add(prof)
        recruiters.append({
            "name": _parse_name(title, prof),
            "title": title or "(see profile)",
            "employer": employer or company,
            "linkedin": prof,
            "confidence": conf,
            "snippet": snip[:200] or None,
        })
        if len(recruiters) >= limit:
            break

    order = {"high": 0, "medium": 1, "low": 2}
    recruiters.sort(key=lambda r: order.get(r["confidence"], 3))
    return {"recruiters": recruiters, "links": search_links(company), "source": source}


_MSG_SYS = (
    "You write short, warm, professional LinkedIn outreach notes for a senior technology "
    "leader introducing himself to a company recruiter about a specific role he found on the "
    "company's own careers site and intends to apply for. Tone: confident, genuine, concise — "
    "never salesy or desperate. Use ONLY facts from the candidate profile; never invent. "
    "It must fit a LinkedIn connection note (under ~300 characters) unless asked otherwise.")


def draft_outreach(company: str, title: str, recruiter_name: str | None = None,
                   long: bool = False) -> str:
    """A short, tailored intro the user sends himself (connection note or InMail)."""
    from . import enrich, profile
    if not enrich.provider():
        # graceful template fallback when no AI auth
        who = recruiter_name.split()[0] if recruiter_name else "there"
        return (f"Hi {who} — I came across the {title} role on {company}'s careers site and it "
                f"lines up closely with my background in secure cloud/DevOps platform delivery. "
                f"I'm planning to apply and would love to connect. Thanks for considering!")
    prof = profile.load().get("profile", {})
    summ = prof.get("experience_summary") or ""
    head = (prof.get("headline_options") or ["senior technology leader"])[0]
    length = ("a 4-6 sentence InMail" if long else
              "a LinkedIn connection note UNDER 300 characters (very tight)")
    prompt = (f"Candidate: {prof.get('name')}, {head}. Background: {summ[:600]}. "
              f"Clearance: {prof.get('clearance','')}.\n"
              f"Recruiter: {recruiter_name or 'the recruiter'} at {company}.\n"
              f"Role he found on {company}'s careers site and will apply to: {title}.\n\n"
              f"Write {length}. Greet the recruiter by first name if provided. Mention the exact "
              f"role, one or two genuinely relevant strengths, that he's applying, and a soft ask "
              f"to connect/chat. No subject line. Return only the message text.")
    try:
        return (enrich.complete(_MSG_SYS, prompt, max_tokens=350) or "").strip()
    except Exception:
        return draft_outreach(company, title, recruiter_name, long)  # fallback path
