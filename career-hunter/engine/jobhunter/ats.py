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
# CHANGE LOG
# 16 | maintainer@emeraldcoastsystemsgroup.com | Recover missing rows from shifted Workday pages and resume completed facet searches after an interrupted native ingest.
# 15 | maintainer@emeraldcoastsystemsgroup.com | Split provider readers into bounded modules while retaining the registry and public reader names.
# 14 | maintainer@emeraldcoastsystemsgroup.com | Register the ManpowerGroup reader (Experis, Manpower), kept in listed_boards with the listed boards.
# 13 | maintainer@emeraldcoastsystemsgroup.com | A SuccessFactors tile's job takes the remote answer its tile gives (listed_place); a table list's job is judged from its place and link text as before.
# 12 | maintainer@emeraldcoastsystemsgroup.com | The SuccessFactors reader takes the place a tile list shows beside a job (listed_boards.listed_place). Syntax's 71 jobs were read with no place, because a tile holds it in a labelled field and not under the class the reader looked for. A table list is read as before, and a job's id, title and link do not change in either.
# 11 | maintainer@emeraldcoastsystemsgroup.com | Register the Talentsoft reader, kept in listed_boards with the two it joins.
# 10 | maintainer@emeraldcoastsystemsgroup.com | Register the Randstad USA and Motion Recruitment readers, kept in listed_boards: each board is read from its own listing pages to the count it states.
# 9 | maintainer@emeraldcoastsystemsgroup.com | Two readers for boards whose page loads its jobs from a search service the browser page reader may not call. A newer SuccessFactors career site lists no job in its page (Altria, Skyworks, NTT DATA Business Solutions, Amway said "No jobs found" to the page reader); when the page lists none, the SuccessFactors reader asks the site's own search service, read to the total it states. A classic site's page is read as before, so its stored jobs keep their ids. New Dayforce reader (Regency Centers, ASRC Federal, Mirion, Carhartt, Imperial Dade): the board's search service, with the anti-forgery token the board's page asks for first, read to the count it states.
# 8 | maintainer@emeraldcoastsystemsgroup.com | The Jibe reader takes an employer's own careers host as its token ("careers.costco.com"): 22 employers' sites answered HTTP 403 to the browser page reader and answer this listing. A Jibe listing read to the count it states is the whole board, so a job that leaves it closes; a listing cut short closes nothing. A Jibe job's place is its city, state and country, not the employer's label for the site: 397 of Ulta Beauty's 13,620 open jobs had a state.
# 7 | maintainer@emeraldcoastsystemsgroup.com | Read the place an Avature list shows beside each job: the element the board marks as the location (ManTech), or the line under the title when it ends with a city, region and country (Deloitte). Every Avature job was stored with no place, so none matched a search by place. A list that shows no place for a job ("Multiple Locations", a shop's street address) still stores none. The workplace a board marks beside the place ("Remote Type: Fully Remote", "Hybrid", "Onsite") is the job's remote answer. The next page starts after the jobs on this one, not after its links: Trader Joe's list links each job four times, so the reader stepped over three pages in four and read 60 of 190 jobs.
# 6 | maintainer@emeraldcoastsystemsgroup.com | Read a Workable board in the shape it sends: the place from `city`, `state` and `country` or the one `locations` entry (a hidden place gives its country only), the remote answer from `telecommuting`, and one row for a job the board lists once for each place it is offered in. Every Workable job was stored with no place, and the repeated ids made the pull record the feed as invalid.
# 5 | maintainer@emeraldcoastsystemsgroup.com | Split a capped Workday search on a facet that agrees with its size before a wider one: a facet that overshoots can still miss jobs, and left Jabil 41 jobs short of whole.
# 4 | maintainer@emeraldcoastsystemsgroup.com | Stop treating Workday's 2,000-job search cap as a whole board: a capped search is split by facet until every job is read, and a board that cannot be proven whole closes nothing. The cap had closed live jobs at Accenture, NVIDIA, Leidos, Booz Allen, Jabil and Tapestry.
# 3 | maintainer@emeraldcoastsystemsgroup.com | Parse complete decimal/grouped salary amounts and explicit currencies while retaining unknown or per-course units without an annual default.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Keep occupational, hybrid and negated remote metadata out of fully remote matches while retaining independent structured workplace evidence.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Retain per-source pull health and guarded content deltas across existing ingestion paths.
from __future__ import annotations
import re
import statistics
from collections import Counter

from . import http
from .ats_feeds import Greenhouse, Lever, Ashby, SmartRecruiters, Workable
from .ats_custom import Amazon, Microsoft, Radancy, Apple, Eightfold, Phenom, Google
from .ats_portals import SuccessFactors, Pinpoint, Jibe, Avature, ICIMS
from .ats_legacy import Brassring, GDCareers, GSRoles, HtmlList, Web, Webflow, Symphony, Dayforce
from .oracle_orc import OracleORC, resolve_orc
from .ats_common import _strip_html, _jsonld_description
from .public_education_ats import GovernmentJobs, PageUp
from .listed_boards import ManpowerGroup, MotionRecruitment, Randstad, Talentsoft, listed_place
from .work_arrangement import looks_remote as _looks_remote, remote_location
from .salary_text import parse_salary as _parse_salary
from .workday_progress import Progress


# ── Workday ──────────────────────────────────────────────────────────────────
# Workday is per-tenant. token format = "tenant:dc:site"
#   e.g. nvidia:wd5:NVIDIAExternalCareerSite   ->
#        https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs
#
# A search answers at most 2,000 jobs and reports `total` as 2000 however many exist, so a search
# at the cap proves only "at least this many". Facet counts stay exact: splitting the search by a
# facet reaches the rest, and those counts say how many jobs the board really holds.
WORKDAY_CAP = 2000
WORKDAY_MAX_REQUESTS = 4000  # Room for the largest board seen, Accenture's 41,000 jobs at 20 a page.
WORKDAY_MAX_DEPTH = 5
WORKDAY_COVERAGE = 0.995     # Jobs open and close during a walk that can take most of an hour.


def _workday_facets(facets):
    """Flatten Workday's nested facet groups into (parameter, [(value id, count)]) pairs."""
    out = []
    for facet in facets or []:
        values = facet.get("values") or []
        if any("facetParameter" in value for value in values):
            out.extend(_workday_facets(values))
        elif facet.get("facetParameter"):
            out.append((facet["facetParameter"], [(v["id"], v.get("count") or 0) for v in values if v.get("id")]))
    return out


def _workday_size(facets, applied):
    """How many jobs a search really holds: the count most of its facets agree on, or 0 if it has none.

    One a job can hold several values of (locations) overshoots the size and one a job can lack
    undershoots it, so the agreeing count is the evidence and no single facet is trusted alone.
    """
    sums = [sum(count for _, count in values) for parameter, values in _workday_facets(facets) if parameter not in applied]
    if not sums:
        return 0
    common, agreeing = Counter(sums).most_common(1)[0]
    return common if agreeing > 1 else statistics.median_low(sums)


def _workday_split(facets, applied, size):
    """The facet that divides a search of `size` jobs: (parameter, value ids), or None.

    A facet that agrees with the size holds every job once. One that overshoots has jobs in several
    values and can still miss others, so it is the fallback however wide it looks. Among equals the
    best has every value under the cap in the fewest searches, else the smallest largest value.
    """
    def rank(option):
        _, values, total = option
        largest = max(count for _, count in values)
        under = largest < WORKDAY_CAP
        return (not size <= total <= size * 1.001, not under, len(values) if under else largest, -total)

    options = [(parameter, values, sum(count for _, count in values))
               for parameter, values in _workday_facets(facets) if parameter not in applied and len(values) > 1]
    near = [option for option in options if size * 0.99 <= option[2] <= size * 1.05]
    if not near:
        return None
    parameter, values, _ = min(near, key=rank)
    return parameter, [value for value, count in values if count]


class _WorkdayWalk:
    """One pull of one board: every job once, and the first reason it cannot be proven whole."""

    def __init__(self, cxs, to_row):
        self.cxs, self.to_row = cxs, to_row
        self.jobs, self.requests, self.expected, self.reason = {}, 0, 0, None
        self.progress = Progress(cxs)

    def _fail(self, reason):
        self.reason = self.reason or reason

    def _page(self, applied, offset):
        if self.requests >= WORKDAY_MAX_REQUESTS:
            self._fail("page_limit_reached")
            return None
        self.requests += 1
        try:
            r = http.post(self.cxs, json={"appliedFacets": applied, "limit": 20, "offset": offset, "searchText": ""})
        except (http.TransientHTTP, http.requests.RequestException):
            if not self.jobs:
                raise  # Nothing was read: this stays a failed attempt, as it always was.
            self._fail("http_refused")
            return None
        if not r.ok:
            self._fail("http_refused")
            return None
        return r.json()

    def read(self, applied, depth=0):
        """Read one search, splitting it while it sits at the cap. False stops the whole walk."""
        data = self._page(applied, 0)
        if data is None:
            return False
        # Workday only reports `total` on the FIRST page (0 thereafter) — capture it once.
        total = data.get("total") or 0
        if total >= WORKDAY_CAP:
            size = _workday_size(data.get("facets"), applied)
            self.expected = self.expected or size
            if size != WORKDAY_CAP:  # Exactly at the cap, the search still shows all of its jobs.
                split = _workday_split(data.get("facets"), applied, size) if size > WORKDAY_CAP else None
                if split and depth < WORKDAY_MAX_DEPTH:
                    parameter, values = split
                    return all(self.read({**applied, parameter: [value]}, depth + 1) for value in values)
                self._fail("page_limit_reached")
        return self._window(data, applied, total)

    def _window(self, data, applied, total):
        saved = self.progress.get(applied, total)
        if saved:
            self.jobs.update((row["ats_job_id"], row) for row in saved)
            return True
        seen, repeated = {}, False
        for attempt in range(3):
            offset = 0
            while True:
                jobs = data.get("jobPostings", [])
                if not jobs:
                    break
                for job in jobs:
                    row = self.to_row(job)
                    repeated |= row["ats_job_id"] in seen
                    seen[row["ats_job_id"]] = row
                    self.jobs.setdefault(row["ats_job_id"], row)
                offset += len(jobs)
                if offset > total:
                    self._fail("invalid_feed_rows")
                    return True
                if total and offset >= total:
                    break
                data = self._page(applied, offset)
                if data is None:
                    return False
            if len(seen) >= total or attempt == 2:
                break
            data = self._page(applied, 0)
            if data is None:
                return False
            if (data.get("total") or 0) != total:
                break
        if len(seen) != total:
            self._fail("invalid_feed_rows" if repeated else "pagination_incomplete")
        elif total < WORKDAY_CAP:
            self.progress.keep(applied, list(seen.values()))
        return True

    def feed(self):
        from .source_memory import Feed
        rows = list(self.jobs.values())
        complete = bool(rows) and not self.reason and len(rows) >= self.expected * WORKDAY_COVERAGE
        if complete:
            self.progress.clear()
        return Feed(rows, complete=complete, reason=None if complete else self.reason or "pagination_incomplete")


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

        def to_row(j):
            path = j.get("externalPath", "")
            loc = j.get("locationsText")
            return {
                "ats_job_id": path or j.get("bulletFields", [None])[0] or j.get("title"),
                "title": j.get("title"),
                "location": loc,
                "remote": _looks_remote(loc, j.get("title")),
                "department": None,
                "url": f"{base}/en-US/{site}{path}" if path else base,
                "description": None,  # detail needs a per-job cxs call; skipped for speed
                "posted_at": j.get("postedOn"),
            }

        walk = _WorkdayWalk(f"{base}/wday/cxs/{tenant}/{site}/jobs", to_row)
        walk.read({})
        return walk.feed()

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


REGISTRY = [Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Workday, Amazon, Microsoft,
            Radancy, Google, SuccessFactors, OracleORC, Phenom, Eightfold, Apple,
            Pinpoint, Jibe, Avature, ICIMS, Brassring, GDCareers, GSRoles, HtmlList,
            Webflow, Symphony, PageUp, GovernmentJobs, Dayforce, Randstad, MotionRecruitment, Talentsoft, ManpowerGroup, Web]
BY_NAME = {c.NAME: c for c in REGISTRY}
# Order to try when slug-probing an unknown company (Workday excluded — not probeable):
PROBE_ORDER = [Greenhouse, Lever, Ashby, SmartRecruiters, Workable]


def fetch(ats_type: str, token: str) -> list[dict]:
    conn = BY_NAME.get(ats_type)
    if not conn:
        raise ValueError(f"unknown ATS type: {ats_type}")
    from .source_memory import Feed
    try:
        with http.observe() as failures:
            rows = conn.fetch(token)
    except http.NotModified:
        result = Feed(complete=True, reason=None)
        result.not_modified = True
        return result
    if isinstance(rows, Feed):
        return rows
    # These whole-board JSON contracts and Workday's counted enumeration are audited.
    # A legacy adapter returning a list is not evidence that pagination completed.
    audited = ats_type in {"greenhouse", "lever", "ashby", "workday"}
    complete = bool(rows) and audited and not failures
    reason = "http_refused" if failures else "empty_unconfirmed" if not rows else "completion_unverified"
    return Feed(rows, complete=complete, reason=None if complete else reason)


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
