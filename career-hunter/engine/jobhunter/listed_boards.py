# CHANGE LOG
# 13 | maintainer@emeraldcoastsystemsgroup.com | A reader for the ManpowerGroup sites (www.experis.com, www.manpower.com), whose job lists no longer carry their jobs in the page: on 2026-11-11 every page of Experis's list, and its search page, came back with no job link, and the pull read Experis as empty ("empty_unconfirmed", 03:26 UTC). The page asks the site's own search, POST /api/services/Jobs/searchjobs, which answers the jobs as data and states the total in filters.totalCount (Experis 2,131, Manpower 2,840 that day). Its offset counts pages, not jobs: offset 2 with limit 100 is the third hundred. read_counted takes the request for a page as a function, so a board asked by POST is read to its count by the same rules.
# 12 | maintainer@emeraldcoastsystemsgroup.com | A job's link is resolved against its board and kept only on the board's host. The Talentsoft reader joined the board's host and the link as text, so a link written in full came out as two addresses run together, and one that led to another host was stored as if it were on the board. A card whose link leads elsewhere is now a job the reader cannot store, so that read is not whole. The Motion Recruitment reader took a job link on any host and stored it under the board's own address; a link to another host is no longer read as one of the board's jobs.
# 11 | maintainer@emeraldcoastsystemsgroup.com | A Randstad job's id is read from its link, as this reader was written to do: the part after the line-of-business number. It was taken from the reference field beside the link and never from the link, and fell back to the page's own record id. The field is used only for a job whose link is on another site (Randstad's own vacancies), where the link carries another number. A job with no link, a link on the board that carries no reference, or a link elsewhere and no field is one the reader cannot name: it is left out and the read is not whole.
# 10 | maintainer@emeraldcoastsystemsgroup.com | A job the board lists but the reader cannot store keeps the read from being whole. Such a job was counted as seen and left out, so the read could still reach the board's count, be called whole, and close the stored copy of a job the board still lists. Each reader now says how many it could not use (a Randstad job with no title or no link, a Talentsoft card that is not the card the reader knows, a Motion Recruitment job link with no card of its own), and a read with any ends as listing_row_invalid. A Talentsoft card that shows "/" for a place is no such job: it is counted and not kept, as before.
# 9 | maintainer@emeraldcoastsystemsgroup.com | A page's size is the number of different jobs on it. It was the number of job links, so a Motion Recruitment page that showed one job twice was taken for twenty-one jobs: the next page was asked for at ?start=21, the job at 20 was never read, and the board never came back whole.
# 8 | maintainer@emeraldcoastsystemsgroup.com | A read that a redirect takes to another host, or through one, is cut there. The readers followed a redirect anywhere and read what came back as the board: a listing in the board's shape served from another host was stored, and could make the read whole. The read now ends as unexpected_redirect, as the public college and county readers' does, keeps what it had and is not whole. A redirect that stays on the board's host is followed.
# 7 | maintainer@emeraldcoastsystemsgroup.com | A value a board sends in place of a number no longer stops a read. A Randstad total that is not a whole number ("many", 12.5) raised, and so did a creation time no calendar holds, which lost the whole board for the night. Such a total is unknown, so the board is read and not called whole, and such a job is kept with no date.
# 6 | maintainer@emeraldcoastsystemsgroup.com | A Talentsoft count is read in full. The reader took the first run of digits, so "1,234 job opening (s)" was a board of 1: one page of twelve was called whole, and a pull would have closed every stored job it did not list. Digits grouped by a comma, a point or a space are one number, and a count that is not a clean whole number is unknown, which is never whole.
# 5 | maintainer@emeraldcoastsystemsgroup.com | A tile outside the United States whose place leaves its country out is held to the same rule as one that names it. "Perth, WA, 6000" with country AU was returned as it stood and filed under Washington, and "Chennai, TN" with IN under Tennessee.
# 4 | maintainer@emeraldcoastsystemsgroup.com | A tile's job is remote when the workplace its tile names says so. The reader judged it from the title link's text as the page holds it, on a line of its own with its indentation, and that reads as not remote: a live read stored all 71 of Syntax's jobs as not remote, 50 of them beside a place that said Remote. A table list is judged as it was.
# 3 | maintainer@emeraldcoastsystemsgroup.com | The place a SuccessFactors list shows beside a job, for the SuccessFactors reader. Syntax's site (careers.syntax.com) lists its jobs as tiles, where the place sits in a labelled field and not under the class the reader looked for, so all 71 of its jobs were read with no place. A tile's place is kept without its postal code, with the workplace the tile names; a job the tile says is outside the United States is never given a place the engine files under a US state. A table list is read as it was.
# 2 | maintainer@emeraldcoastsystemsgroup.com | A reader for Talentsoft boards (<tenant>.talent-soft.com), which had none: Akkodis's board stated 871 vacancies on 2026-11-11. A vacancy is known by the number that ends its link and keeps the place its card shows; a card with no place is counted toward the board's total and not kept. Read twelve at a time to the count the board states.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Readers for two boards that serve their jobs in the listing page and state how many they hold. Randstad USA serves its jobs as data in the page, each under /jobs/<line of business>/<job reference>/<title>/: the served page has no job link, and the page-list reader's rule would have taken the line-of-business number for the job. Motion Recruitment's links end with the job number (/tech-jobs/<city>/<type>/<title>/<number>), a form no reader matched. Each is read a page at a time to the count the board states, so a whole read closes a job that left and a refused or short one closes nothing.
"""Boards that serve their jobs in the listing page and state how many they hold.

Plain reads of public listing pages through the engine's own HTTP layer: no account, no form and no browser.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from urllib.parse import unquote, urljoin, urlsplit

import requests
from bs4 import BeautifulSoup
from . import geo, http
from .source_memory import Feed
from .work_arrangement import looks_remote, remote_location

MAX_REQUESTS = 600   # Two passes over the largest board read so far, Randstad USA's 164 pages, with room to grow.
PASSES = 2
ALLOWANCE = 200      # One job in 200 may go unseen: jobs open and close while a board is read (the Workday reader's 0.995).


def _text(node):
    return " ".join(node.get_text(" ").split()) if node is not None else ""


def _enough(seen, stated):
    return stated > 0 and seen >= stated - stated // ALLOWANCE


_NUMBER = re.compile(r"\d(?:[\d,. ]*\d)?")
_CLEAN = re.compile(r"\d+|\d{1,3}(?:[,. ]\d{3})+")


def _count(stated):
    """The whole number a board states as its total, or None when it states none.

    In text, digits grouped in threes by a comma, a point or a space are one number ("1,234 job opening (s)" is
    1234); text with two numbers, or with one that is not whole, states none. Anything else that is not a whole
    number of zero or more (a fraction, a truth value, a list) states none either."""
    if isinstance(stated, int) and not isinstance(stated, bool):
        return stated if stated >= 0 else None
    if isinstance(stated, float):
        return int(stated) if stated.is_integer() and stated >= 0 else None
    numbers = _NUMBER.findall(stated) if isinstance(stated, str) else []
    if len(numbers) != 1 or not _CLEAN.fullmatch(numbers[0]):
        return None
    return int(re.sub(r"\D", "", numbers[0]))


def _day(milliseconds):
    """The UTC date of a time given in milliseconds, or None when it is not a time a calendar holds."""
    if isinstance(milliseconds, bool) or not isinstance(milliseconds, (int, float)):
        return None
    try:
        return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).date().isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _refused(response, host):
    """Why an answer is not the board's, or None when it is. A redirect is followed only while it stays on the
    board's host. An answer that came from another host, or by way of one, is not the board's, whatever it holds."""
    if any(urlsplit(address).hostname != host for address in [hop.url for hop in response.history] + [response.url]):
        return "unexpected_redirect"
    return None if response.ok else "http_refused"


def _read_page(url, host, parse):
    """(what one page of the board holds, None) or (None, why the read ends here)."""
    response = http.get_once(url, timeout=30)
    if refused := _refused(response, host):
        return None, refused
    found = parse(response.text)
    return found, None if found is not None else "completion_unverified"


def _search_page(url, host, body, parse):
    """(what one page of a board's search holds, None) or (None, why the read ends here), for a search asked by POST
    with a JSON body and answered in JSON. `parse(data)` reads the answer as `parse(html)` reads a page.

    A search is asked again, with a growing wait, when it answers 429 or 5xx or does not answer in time (the engine's
    retrying request): on 2026-11-11 Experis's search refused its eighth page once and answered it seconds later.
    When it still does not answer, the read ends there and what was read is kept."""
    try:
        response = http.post(url, json=body, timeout=60,
                             headers={"Content-Type": "application/json", "Accept": "application/json"})
    except (http.TransientHTTP, requests.RequestException):
        return None, "http_refused"
    if refused := _refused(response, host):
        return None, refused
    try:
        data = response.json()
    except ValueError:
        return None, "completion_unverified"
    found = parse(data)
    return found, None if found is not None else "completion_unverified"


def read_counted(page_url, parse, *, ask=None):
    """Every job of a board that lists a page at a time and states its total, as a Feed.

    `page_url(page, size)` is the address of a page, counted from 1, given how many different jobs the first page listed; the
    first page's host is the board's. `parse(html)` answers (rows kept, ids listed, stated total as a whole number
    or None, how many listed jobs it could not use) for one page, or None when the answer is not the board's
    listing.

    A board adds and drops jobs while it is read, so a job can move between pages and be missed. The board is whole
    when the jobs seen reach the count it last stated, less the allowance; a pass that falls short is read once
    more. A page refused, sent to another host or not understood ends the read, and what was read is kept without
    being called whole. A board that states no total is read until a page lists nothing new, and is never called
    whole. Nor is a read in which the board listed a job the reader could not use: that job is still on the board,
    and a whole read would close its stored copy.

    `ask(page, size)`, when given, asks for a page itself and answers as a page read does: (what it holds, None)
    or (None, why the read ends). A board whose list is a search asked by POST is read this way.
    """
    host = urlsplit(page_url(1, 0)).hostname
    ask = ask or (lambda page, size: _read_page(page_url(page, size), host, parse))
    out, kept, seen, stated, cut, asked, unusable = [], set(), set(), 0, None, 0, 0
    for _ in range(PASSES):
        page, size = 1, 0
        while asked < MAX_REQUESTS:
            found, cut = ask(page, size)
            asked += 1
            if found is None:
                break
            rows, listed, total, dropped = found
            stated, size, unusable = total or 0, size or len(set(listed)), unusable + dropped
            fresh = [job for job in listed if job not in seen]
            seen.update(listed)
            for row in rows:
                if row["ats_job_id"] not in kept:
                    kept.add(row["ats_job_id"])
                    out.append(row)
            if not listed or (stated and page * size >= stated) or (not stated and not fresh):
                break
            page += 1
        if cut or unusable or not stated or _enough(len(seen), stated):
            break
    if not seen and not cut and not unusable:
        return Feed([], reason="empty_unconfirmed")
    whole = not cut and not unusable and _enough(len(seen), stated)
    short = cut or ("listing_row_invalid" if unusable else "completion_unverified")
    return Feed(out, complete=whole, reason=None if whole else short)


def _row(job_id, title, place, url, *, workplace=None, verified=None, department=None, posted_at=None):
    """One job in the engine's shape. A workplace the board marks beside the job decides whether it is remote."""
    if verified is None and workplace and looks_remote(workplace):
        verified = True
    place = remote_location(place, title, workplace, verified=verified)
    return {"ats_job_id": str(job_id), "title": title, "location": place or None,
            "remote": looks_remote(place, title, workplace, verified=verified), "department": department,
            "url": url, "description": None, "posted_at": posted_at}


# ── Randstad USA — the listing page carries its jobs as data ─────────────────
# token = the listing address ("https://www.randstadusa.com/jobs/"); page n is "<token>page-<n>/".
class Randstad:
    NAME = "randstad"
    _DATA = re.compile(r"window\.__ROUTE_DATA__\s*=\s*")
    _LINK = re.compile(r"/jobs/\d+/([^/?#]+)(?:/|$)")

    @classmethod
    def _reference(cls, hit, link, host):
        """The job reference a job's own link carries, or None when the job cannot be named. It is the part after
        the line-of-business number: "/jobs/309/AB_5146544/industrial-electrician_bolingbrook/" is job AB_5146544
        of line of business 309. A job whose link is on another site (Randstad's own vacancies) is known by the
        reference the page gives beside it, because that link carries another site's number."""
        where = urlsplit(link)
        if where.scheme not in ("http", "https") or not where.hostname:
            return None
        if where.hostname == host:
            carried = cls._LINK.match(where.path)
            return unquote(carried.group(1)) if carried else None
        field = hit.get("atsReference")
        return str(field).strip() or None if isinstance(field, (str, int)) and not isinstance(field, bool) else None

    @classmethod
    def _job(cls, reference, hit, link):
        where = hit.get("jobLocation") if isinstance(hit.get("jobLocation"), dict) else {}
        place = ", ".join(str(part).strip() for part in (where.get("city"), where.get("stateAbbreviation")) if part)
        remote = hit.get("isRemote") if isinstance(hit.get("isRemote"), bool) else None
        return _row(reference, hit["title"], place, link, verified=remote,
                    department=hit.get("lobName"), posted_at=_day(hit.get("createdDate")))

    @classmethod
    def parse(cls, html, host):
        start = cls._DATA.search(html or "")
        if not start:
            return None
        try:
            data, _ = json.JSONDecoder().raw_decode(html, start.end())
        except ValueError:
            return None
        results = data.get("searchResults") if isinstance(data, dict) else None
        hits = results.get("hits") if isinstance(results, dict) else None
        if not isinstance(hits, list):
            return None
        rows, listed, dropped = [], [], 0
        for hit in hits:
            link = hit.get("detailsUrl") if isinstance(hit, dict) else None
            link = urljoin(f"https://{host}/", link) if isinstance(link, str) else None
            reference = cls._reference(hit, link, host) if link else None
            if reference:
                listed.append(reference)
            # A job with no reference or no title is one the board lists and this reader cannot store.
            if reference and isinstance(hit.get("title"), str) and hit["title"].strip():
                rows.append(cls._job(reference, hit, link))
            else:
                dropped += 1
        return rows, listed, _count(results.get("totalSize")), dropped

    @classmethod
    def fetch(cls, token):
        base = token.strip().rstrip("/") + "/"
        host = urlsplit(base).hostname
        return read_counted(lambda page, _size: base if page == 1 else f"{base}page-{page}/",
                            lambda html: cls.parse(html, host))

    @classmethod
    def detect(cls, url):
        return None

    @classmethod
    def probe(cls, slug):
        return None


# ── Motion Recruitment — job links end with the job number ───────────────────
# token = the listing address ("https://motionrecruitment.com/tech-jobs"); a later page is "<token>?start=<offset>".
class MotionRecruitment:
    NAME = "motionrecruitment"
    _JOB = re.compile(r"^(/tech-jobs/[^/?#]+/[^/?#]+/[^/?#]+/(\d+))/?$")
    # The page's own data states the total. It is written inside a script string, so its quotes are escaped.
    _TOTAL = re.compile(r'dataSet\\?"\s*:\s*\{\\?"total\\?"\s*:\s*(\d+)')

    @classmethod
    def parse(cls, html, origin="https://motionrecruitment.com"):
        soup = BeautifulSoup(html or "", "lxml")
        found, host = {}, urlsplit(origin).hostname
        for link in soup.find_all("a", href=True):
            where = urlsplit(urljoin(origin + "/tech-jobs", link["href"].strip()))
            job = cls._JOB.match(where.path) if where.hostname == host else None
            if not job:
                continue
            heading = _text(link.find(["h1", "h2", "h3"]))
            if not heading or found.get(job.group(2)):
                found.setdefault(job.group(2), None)
                continue
            # The card reads title, then the place in the one paragraph that carries no class, then the workplace.
            place = next((_text(p) for p in link.find_all("p") if not p.get("class")), "")
            found[job.group(2)] = _row(job.group(2), heading, re.sub(r"\s+,", ",", place), origin + job.group(1),
                                       workplace=_text(link.find("b")) or None)
        total = cls._TOTAL.search(html or "")
        if not found and not total:
            return None
        # A job linked on the page with no card of its own, on any of its links, is one this reader cannot store.
        rows = [row for row in found.values() if row]
        return rows, list(found), int(total.group(1)) if total else None, len(found) - len(rows)

    @classmethod
    def fetch(cls, token):
        base = token.strip().split("?")[0].rstrip("/")
        origin = "/".join(base.split("/")[:3])
        return read_counted(lambda page, size: base if page == 1 else f"{base}?start={(page - 1) * size}",
                            lambda html: cls.parse(html, origin))

    @classmethod
    def detect(cls, url):
        return None

    @classmethod
    def probe(cls, slug):
        return None


# ── Talentsoft — "<tenant>.talent-soft.com/job/list-of-jobs.aspx" ────────────
# token = the board's host ("akka-cand.talent-soft.com"). LCID 2057 asks for the English pages the board links itself.
class Talentsoft:
    NAME = "talentsoft"
    _ID = re.compile(r"_(\d+)\.aspx")
    _DATE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")
    _TOTAL_ID = re.compile(r"Pagination_TotalOffers$")

    @classmethod
    def _job(cls, card, link, job_id, address):
        """One job the board marks with a place; None for one it shows with no place; False for a card that is not
        the card this reader knows. A card reads category, contract, place and date; the place is what the recruiter
        typed ("Torino", "Soyo, Angola", a street), and "/" stands where there is none."""
        items = [_text(item) for item in card.select("ul.ts-offer-card-content__list li")]
        day = cls._DATE.match(items[3]) if len(items) == 4 else None
        if not day or not _text(link):
            return False
        if not re.search(r"[^\W\d_]", items[2]):
            return None
        try:
            posted = datetime(int(day.group(3)), int(day.group(2)), int(day.group(1))).date().isoformat()
        except ValueError:
            posted = None
        return _row(job_id, _text(link), items[2], address, department=items[0] or None, posted_at=posted)

    @classmethod
    def parse(cls, html, host):
        soup = BeautifulSoup(html or "", "lxml")
        stated = soup.find(id=cls._TOTAL_ID)
        cards = soup.select("div.ts-offer-card")
        if not cards and stated is None:
            return None
        rows, listed, dropped = [], [], 0
        for card in cards:
            link = card.select_one("a.ts-offer-card__title-link[href]")
            # A card's link is read against the board's own address, and only a link on the board's host is a job.
            address = urljoin(f"https://{host}/job/", link["href"].strip()) if link is not None else ""
            job = cls._ID.search(urlsplit(address).path) if urlsplit(address).hostname == host else None
            if job:
                listed.append(job.group(1))
            row = cls._job(card, link, job.group(1), address) if job else False
            if row:
                rows.append(row)
            elif row is False:
                dropped += 1
        return rows, listed, _count(_text(stated)), dropped

    @classmethod
    def fetch(cls, token):
        host = token.replace("https://", "").replace("http://", "").strip("/").split("/")[0]
        return read_counted(lambda page, _size: f"https://{host}/job/list-of-jobs.aspx?page={page}&LCID=2057",
                            lambda html: cls.parse(html, host))

    @classmethod
    def detect(cls, url):
        return None

    @classmethod
    def probe(cls, slug):
        return None


# ── ManpowerGroup sites (Experis, Manpower) — the site's own job search ──────
# token = the site's host ("www.experis.com"). The list page asks POST /api/services/Jobs/searchjobs, which answers
# the jobs as data (jobsItems) and states the total (filters.totalCount). Its offset counts pages of `limit` jobs.
class ManpowerGroup:
    NAME = "manpowergroup"
    SIZE = 100
    SEARCH = "/api/services/Jobs/searchjobs"
    DESCRIPTION_LIMIT = 20000

    @classmethod
    def body(cls, page):
        """The search for page `page`, counted from 1, in the shape the site's own list sends."""
        return {"filter": {"page": str(page), "offset": page - 1, "limit": cls.SIZE, "totalCount": 0,
                           "searchKeyword": "", "searchkeyword": "", "haslocation": False, "language": ""}}

    @staticmethod
    def _field(item, name):
        value = item.get(name)
        return " ".join(value.split()) if isinstance(value, str) else ""

    @classmethod
    def _job(cls, item, host):
        """(number, row) for one job the search lists. The number is None when the job cannot be named; the row is
        None when it can be named but not stored: no title, or a link that is not on the site's own host."""
        number = item.get("jobID")
        number = str(number).strip() if isinstance(number, (str, int)) and not isinstance(number, bool) else ""
        if not number.isdigit():
            return None, None
        link, title = cls._field(item, "jobURL"), cls._field(item, "jobTitle")
        where = urlsplit(urljoin(f"https://{host}/", link)) if link else None
        if not title or where is None or where.scheme != "https" or where.hostname != host:
            return number, None
        published = cls._field(item, "publishfromDate")[:10]
        try:
            posted = datetime.strptime(published, "%Y-%m-%d").date().isoformat()
        except ValueError:
            posted = None
        row = _row(number, title, cls._field(item, "jobLocation"), where.geturl(),
                   department=cls._field(item, "domain") or None, posted_at=posted)
        description = item.get("publicDescription")
        if isinstance(description, str) and description.strip():
            # Tags become spaces, so "<strong>Engineer</strong>." would read "Engineer ."; the space before a mark goes.
            text = re.sub(r"\s+([.,;:!?])", r"\1", _text(BeautifulSoup(description, "lxml")))
            row["description"] = text[:cls.DESCRIPTION_LIMIT] or None
        return number, row

    @classmethod
    def parse(cls, data, host):
        """(rows kept, numbers listed, stated total, jobs listed but not storable) for one answer, or None when the
        answer is not the search's."""
        items = data.get("jobsItems") if isinstance(data, dict) else None
        stated = data.get("filters") if isinstance(data, dict) else None
        if not isinstance(items, list) or not isinstance(stated, dict):
            return None
        rows, listed, dropped = [], [], 0
        for item in items:
            number, row = cls._job(item, host) if isinstance(item, dict) else (None, None)
            if number:
                listed.append(number)
            if row:
                rows.append(row)
            else:
                dropped += 1
        return rows, listed, _count(stated.get("totalCount")), dropped

    @classmethod
    def fetch(cls, token):
        host = token.replace("https://", "").replace("http://", "").strip("/").split("/")[0].lower()
        search = f"https://{host}{cls.SEARCH}"
        return read_counted(lambda _page, _size: search, None,
                            ask=lambda page, _size: _search_page(search, host, cls.body(page),
                                                                 lambda data: cls.parse(data, host)))

    @classmethod
    def detect(cls, url):
        return None

    @classmethod
    def probe(cls, slug):
        return None


# ── SuccessFactors — the place a list shows beside a job ─────────────────────
_SF_PLACE = re.compile("jobLocation|job-location", re.I)


def _tile_place(tile):
    """The place of one tile, without its postal code. A tile reads "Morrisville, NC, US, 27560" and states the
    country again in a field of its own. A job the board says is outside the United States is never given a place
    the engine files under a US state: "Weinheim, BW, DE" would be filed under Delaware and "Thornhill, ON, CA"
    under California, so the parts that read as a state are left out. That holds whether or not the place names
    its country: "Perth, WA, 6000" in AU would be filed under Washington."""
    def field(kind):
        return _text(tile.select_one(f'.section-field.{kind} [id$="-value"]'))
    place, country = field("location"), field("country")
    parts = [part.strip() for part in place.split(",") if part.strip()]
    if not country or (country == "US" and country not in parts):
        return place or None
    if country in parts:
        parts = parts[:parts.index(country)]
    if country == "US":
        return ", ".join(parts + ["US"])
    for shape in (parts + [country], parts[:1] + [country], parts[:1]):
        if shape and not geo.state_of(", ".join(shape)):
            return ", ".join(shape)
    return None


def listed_place(link):
    """(place, remote) a SuccessFactors list shows beside one job link; remote is None where the list does not say.

    A table list marks the place with a class, and that is read as it always was. A tile list (li.job-tile) holds
    it in a labelled field, with the workplace beside it when the board has a field named "Workplace Type"; that
    workplace, the place and the title decide whether the job is remote."""
    row = link.find_parent(["tr", "li", "div"])
    marked = row.find(class_=_SF_PLACE) if row else None
    if marked:
        return marked.get_text(strip=True), None
    tile = link.find_parent("li", class_="job-tile")
    if tile is None:
        return None, None
    workplace = next((_text(field.select_one('[id$="-value"]')) for field in tile.select(".section-field")
                      if _text(field.select_one(".section-label")).lower() == "workplace type"), None)
    stated = True if workplace and looks_remote(workplace) else None
    place = remote_location(_tile_place(tile), workplace, verified=stated)
    return place, looks_remote(place, _text(link), workplace, verified=stated)
