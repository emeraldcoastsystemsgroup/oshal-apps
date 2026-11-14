# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Keep the existing portals readers in a bounded provider module; ats retains their registry and public names.
from __future__ import annotations
import re
from datetime import datetime
from . import http
from .ats_common import _strip_html, _jsonld_description
from .work_arrangement import looks_remote as _looks_remote, remote_location
from .salary_text import parse_salary as _parse_salary
from .listed_boards import listed_place

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
            if startrow == 0 and r.ok and "jobTitle-link" not in r.text and "/job/" not in r.text:
                return cls._search(host) or []
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
                loct, remote = listed_place(a)
                out.append({"ats_job_id": href, "title": a.get_text(strip=True), "location": loct,
                            "remote": _looks_remote(loct, a.get_text()) if remote is None else remote, "department": None,
                            "url": url, "description": None, "posted_at": None})
            if not page_new:
                break
            startrow += 25
        return out

    _SEARCH = "/services/recruiting/v1/jobs"
    _POSTCODE = re.compile(r"-\d{5}(?:-\d{4})?\b|,\s*\d{4,5}(?:-\d{3,4})?(?=\s*(?:,|$))")
    _BREAK = re.compile(r"<br\s*/?>", re.I)

    @classmethod
    def _place(cls, row):
        """The job's place from the search answer: each listed place without its postal code or markup, the first one
        first ("Clarksville, TN-37041, United States" and "Ada, MI, USA, 49355<br/>" are "Clarksville, TN, United States"
        and "Ada, MI, USA")."""
        places = []
        for value in row.get("jobLocationShort") or []:
            for part in cls._BREAK.split(str(value or "")):
                text = " ".join(cls._POSTCODE.sub("", _strip_html(part) or "").split()).strip(" ,")
                if text:
                    places.append(text)
        return "; ".join(places) or None

    @staticmethod
    def _posted(value):
        try:
            return datetime.strptime(str(value), "%m/%d/%y").date().isoformat()
        except (TypeError, ValueError):
            return None

    @classmethod
    def _search(cls, host, locale="en_US"):
        """The jobs the newer SuccessFactors career site loads into its page: its own search service, ten a page, with the
        total. None when the host does not answer it (a classic site answers 401, and its page lists the jobs itself).

        Its pages have no stable order, so one pass repeats some jobs and misses others. The reader pages through up to
        three times, keeping every job it sees, and calls the board whole only when it has seen as many as the site states."""
        from .source_memory import Feed
        base, out, seen, total, cut, asked = f"https://{host}", [], set(), None, None, 0
        for _ in range(3):
            page = 0
            while page * 10 < (total if total is not None else 10) and asked < 1500:
                body = {"locale": locale, "pageNumber": page, "sortBy": "", "keywords": "", "location": "", "facetFilters": {},
                        "brand": "", "skills": [], "categoryId": 0, "alertId": "", "rcmCandidateId": ""}
                r = http.post_once(base + cls._SEARCH, json=body, headers={"Accept": "application/json"}, timeout=25)
                asked += 1
                try:
                    d = r.json() if r.ok else None
                except ValueError:
                    d = None
                if not isinstance(d, dict) or not isinstance(d.get("jobSearchResult"), list):
                    if total is None:
                        return None
                    cut = "http_refused" if not r.ok else "completion_unverified"
                    break
                if total is None:
                    total = int(d.get("totalJobs") or 0)
                if not d["jobSearchResult"]:
                    break
                for item in d["jobSearchResult"]:
                    cls._keep(item, base, locale, seen, out)
                page += 1
            if cut or len(seen) >= (total or 0):
                break
        whole = not cut and bool(total) and len(seen) >= total
        return Feed(out, complete=whole, reason=None if whole else cut or "completion_unverified")

    @classmethod
    def _keep(cls, item, base, locale, seen, out):
        row = item.get("response") if isinstance(item, dict) else None
        if not isinstance(row, dict) or not row.get("id") or str(row["id"]) in seen:
            return
        jid = str(row["id"])
        seen.add(jid)
        title = row.get("unifiedStandardTitle") or row.get("title")
        slug = row.get("unifiedUrlTitle") or row.get("urlTitle") or "job"
        place = cls._place(row)
        out.append({"ats_job_id": jid, "title": title, "location": place,
                    "remote": _looks_remote(place, title, " ".join(row.get("cust_workModel") or [])),
                    "department": None, "url": f"{base}/job/{slug}/{jid}-{locale}/", "description": None,
                    "posted_at": cls._posted(row.get("unifiedStandardStart"))})

    @classmethod
    def detect(cls, url):
        # only claim it when the page is clearly a SuccessFactors search host
        return None

    @classmethod
    def probe(cls, slug):
        return None



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



class Jibe:
    NAME = "jibe"

    @classmethod
    def fetch(cls, token):
        from .source_memory import Feed
        code, _, careers = token.partition("|")
        code = code.strip()
        host = code if "." in code else f"{code}.jibeapply.com"
        api = f"https://{host}/api/jobs"
        out, seen, page, total, cut = [], set(), 1, None, None
        while page < 2000:
            r = http.get_once(api, params={"page": page, "internal": "false", "limit": 100}, timeout=25)
            if not r.ok:
                cut = "http_refused"
                break
            try:
                d = r.json()
            except ValueError:
                cut = "completion_unverified"
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
                # The city, state and country are the job's place. `location_name` is the employer's own label for a
                # site ("Sheetz #899", "Casa Paloma"); it names no state, so it is the place only when nothing else is.
                city, site = j.get("city"), j.get("location_name")
                place = ", ".join(x for x in [city.title() if city and city.isupper() else city,
                                              j.get("state"), j.get("country")] if x)
                loc = place if city or j.get("state") else site or place
                jurl = (f"https://{careers}/careers-home/jobs/{jid}" if careers
                        else f"https://{host}/jobs/{jid}")
                out.append({"ats_job_id": str(jid), "title": j.get("title"),
                            "location": loc or None,
                            "remote": _looks_remote(loc, site, j.get("location_type"), j.get("title")),
                            "department": j.get("department"), "url": jurl,
                            "description": _strip_html(j.get("description")),
                            "posted_at": j.get("posted_date") or j.get("create_date")})
            if not page_new:
                break
            if total and len(seen) >= total:
                break
            page += 1
        # The listing states how many jobs it holds. Reading that many, with every page answered, is the whole
        # board, and only then may a job missing from it be closed.
        whole = not cut and bool(total) and len(seen) >= total
        return Feed(out, complete=whole, reason=None if whole else cut or "completion_unverified")

    @classmethod
    def detect(cls, url):
        return None

    @classmethod
    def probe(cls, slug):
        return None



class Avature:
    NAME = "avature"
    _JOB_LINK = "/careers/JobDetail/"
    _PLACE_LABEL_RE = re.compile(r"^locations?\s*:\s*", re.I)
    _LABEL_RE = re.compile(r"^[^:]*:\s*")

    @classmethod
    def _card(cls, link, job_id):
        """The block of the list that holds one job and no other, or None. What a block that holds more than this job
        says is not known to be this job's."""
        card = link.find_parent(["article", "li", "tr"])
        if card is None:
            return None
        jobs = {a["href"].rstrip("/").rsplit("/", 1)[-1] for a in card.find_all("a", href=True)
                if cls._JOB_LINK in a["href"]}
        return card if jobs == {job_id} else None

    @classmethod
    def _workplace(cls, card):
        """The workplace the board marks beside one job, or None: ManTech has
        <span class="list-item-remote type">Remote Type: Fully Remote</span>, and "Hybrid" and "Onsite" the same way.
        The label is left out: it holds the word "remote" for every job."""
        if card is None:
            return None
        for marked in card.find_all(class_=re.compile("remote", re.I)):
            kind = cls._LABEL_RE.sub("", " ".join(marked.get_text(" ").split()))
            if kind:
                return kind
        return None

    @classmethod
    def _place(cls, card):
        """The place the list shows beside one job, or None when it shows none.

        A board shows it in one of two ways. Some mark it: ManTech has
        <span class="list-item-location">Location: USA-VA-Fort Belvoir</span>. Others end the line under the title with
        it: Deloitte has member firm | legal entity | "Chicago, Illinois, United States"."""
        if card is None:
            return None
        for marked in card.find_all(class_=re.compile("location", re.I)):
            place = cls._PLACE_LABEL_RE.sub("", " ".join(marked.get_text(" ").split()))
            if place:
                return place
        line = card.find(class_=re.compile("subtitle", re.I))
        spans = line.find_all("span") if line is not None else []
        last = " ".join(spans[-1].get_text(" ").split()) if spans else ""
        # Only "city, region, country" is a place: the same line can end with "Multiple Locations", a legal entity's
        # name can hold a comma ("Deloitte Touche Tohmatsu Services, LLC"), and a date holds two and a number.
        return last if last.count(",") >= 2 and not re.search(r"\d", last) else None

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
            links = [a for a in soup.find_all("a", href=True) if cls._JOB_LINK in a["href"]]
            page_new, page_jobs = 0, set()
            for a in links:
                href = a["href"]
                jid = href.rstrip("/").rsplit("/", 1)[-1]
                page_jobs.add(jid)
                if jid in seen:
                    continue
                seen.add(jid); page_new += 1
                url = href if href.startswith("http") else base + href
                slug = href.split(cls._JOB_LINK)[-1].rsplit("/", 1)[0]
                title = a.get_text(strip=True)
                card = cls._card(a, jid)
                # The board's own answer decides: "Fully Remote" makes a job in a named city remote, and "Onsite" or
                # "Hybrid" keeps a job whose title says remote where it is.
                workplace = cls._workplace(card)
                verified = True if workplace and _looks_remote(workplace) else None
                place = remote_location(cls._place(card), slug, title, workplace, verified=verified)
                out.append({"ats_job_id": jid, "title": title,
                            "location": place, "remote": _looks_remote(place, slug, title, workplace, verified=verified),
                            "department": None, "url": url,
                            "description": None, "posted_at": None})
            if page_new == 0:
                empty += 1
                if empty >= 2:
                    break
                offset += 10
                continue
            empty = 0
            # This tenant's page size is the number of jobs on the page. A list can link a job more than once.
            offset += len(page_jobs)
        return out

    @classmethod
    def detect(cls, url):
        return None

    @classmethod
    def probe(cls, slug):
        return None



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

