# CHANGE LOG
# 2 | maintainer@emeraldcoastsystemsgroup.com | Partition a capped Oracle board through its own filters, use the actual 200-row page ceiling, and verify source changes promptly without settling their full pull.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Read counted Oracle boards beyond the old 12,000-job ceiling, retain partial results on refused requests, and link to the actual candidate site. Resolve embedded host/site pairs together.
"""The anonymous Oracle candidate site's counted requisition listing."""
from __future__ import annotations

import re
from collections import Counter
from urllib.parse import urlsplit

from . import http
from .ats_common import _strip_html
from .source_memory import Feed
from .work_arrangement import looks_remote

PAGE_SIZE = 200
MAX_PAGES = 3000
MAX_PASSES = 3


def board_token(url):
    """Recognize a complete candidate-site address, preserving its exact host/site pair."""
    try:
        parsed = urlsplit(url)
        route = parsed.path + (parsed.fragment if parsed.fragment.startswith("/") else "")
        match = re.search(r"/sites/([A-Za-z0-9_-]{1,255})(?:/|\?|$)", route)
        host = parsed.hostname or ""
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
            return None
        if not host.endswith(".oraclecloud.com") or not match:
            return None
        return f"{host}|{match[1]}|{host}"
    except ValueError:
        return None


def _row(job, backend, site):
    jid, title, place = job.get("Id"), job.get("Title"), job.get("PrimaryLocation")
    if jid is None or not isinstance(title, str) or not title.strip():
        return None
    return {"ats_job_id": str(jid), "title": title, "location": place,
            "remote": looks_remote(place, title), "department": job.get("Department"),
            "url": f"https://{backend}/hcmUI/CandidateExperience/en/sites/{site}/job/{jid}",
            "description": _strip_html(job.get("ExternalDescriptionStr")),
            "posted_at": job.get("PostedDate") or job.get("ExternalPostedStartDate")}


class _Walk:
    def __init__(self, backend, site, applied=None, budget=None, passes=MAX_PASSES):
        self.backend, self.site, self.passes = backend, site, passes
        self.applied, self.budget, self.last = applied or {}, budget if budget is not None else [MAX_PAGES], {}
        self.jobs, self.total, self.pages, self.reason = {}, None, 0, None

    def fork(self, applied):
        return _Walk(self.backend, self.site, applied, self.budget, passes=1)

    def page(self, offset, extra=None, limit=PAGE_SIZE):
        api = f"https://{self.backend}/hcmRestApi/resources/latest/recruitingCEJobRequisitions"
        if self.budget[0] <= 0:
            self.reason = "page_limit_reached"
            return None
        self.budget[0] -= 1
        suffix = "".join("," + key + "=" + str(value) for key, value in {**self.applied, **(extra or {})}.items())
        params = {"onlyData": "true", "expand": "all",
                  "finder": f"findReqs;siteNumber={self.site},limit={limit},offset={offset},sortBy=POSTING_DATES_DESC{suffix}"}
        try:
            response = http.get(api, params=params, timeout=25)
            if not response.ok:
                self.reason = "http_refused"
                return None
            data = response.json()
            item = data["items"][0] if isinstance(data, dict) and data.get("items") else None
        except (http.TransientHTTP, http.requests.RequestException, ValueError, TypeError):
            self.reason = "http_refused"
            return None
        if not isinstance(item, dict) or not isinstance(item.get("requisitionList"), list):
            self.reason = "completion_unverified"
            return None
        total = item.get("TotalJobsCount")
        if type(total) is not int or total < 0:
            self.reason = "completion_unverified"
            return None
        self.last = item
        if not extra:
            self.total = max(self.total or 0, total)
        return item["requisitionList"]

    def read(self):
        for _ in range(self.passes):
            offset = 0
            while self.total is None or offset < self.total:
                if self.pages >= MAX_PAGES:
                    self.reason = "page_limit_reached"
                    return self.feed()
                self.pages += 1
                page = self.page(offset)
                if page is None:
                    return self.feed()
                if not page:
                    break
                for job in page:
                    row = _row(job, self.backend, self.site) if isinstance(job, dict) else None
                    if row is None:
                        self.reason = "invalid_feed_rows"
                    else:
                        self.jobs[row["ats_job_id"]] = row
                if offset == 0 and not self.applied and self.total >= 10000 and self.last.get("locationsFacet"):
                    from .oracle_partitions import read_large
                    return read_large(self, self.last)
                offset += len(page)
                if self.total and len(self.jobs) >= self.total:
                    return self.feed()
            if not self.total or len(self.jobs) >= self.total:
                break
        return self.feed()

    def feed(self):
        whole = bool(self.total) and len(self.jobs) == self.total and not self.reason
        return Feed(self.jobs.values(), complete=whole, reason=None if whole else self.reason or "pagination_incomplete")


class OracleORC:
    NAME = "oracle_orc"

    @classmethod
    def fetch(cls, token):
        backend, site, *_ = token.split("|")
        if not board_token(f"https://{backend}/hcmUI/CandidateExperience/en/sites/{site}/jobs"):
            raise ValueError("invalid Oracle candidate site")
        return _Walk(backend, site).read()

    @classmethod
    def preview(cls, token):
        """A bounded real sample authorizes neither enumeration completion nor job closure."""
        backend, site, *_ = token.split("|")
        if not board_token(f"https://{backend}/hcmUI/CandidateExperience/en/sites/{site}/jobs"):
            raise ValueError("invalid Oracle candidate site")
        walk = _Walk(backend, site)
        page = walk.page(0, limit=3)
        rows = [_row(job, backend, site) for job in page or [] if isinstance(job, dict)]
        feed = Feed((row for row in rows if row), reason=walk.reason or "completion_unverified")
        feed.preview = True
        return feed

    @classmethod
    def detect(cls, url):
        return board_token(url)

    @classmethod
    def probe(cls, _slug):
        return None


def resolve_orc(careers_host):
    """Resolve actual links as pairs; opaque Oracle tenants need no guessed employer name."""
    host = urlsplit(careers_host if "://" in careers_host else "https://" + careers_host).hostname
    try:
        response = http.get_once(f"https://{host}/", timeout=20)
    except http.requests.RequestException:
        return None
    if not response.ok:
        return None
    direct = board_token(response.url)
    if direct:
        return direct
    links = re.findall(r'https://[a-zA-Z0-9.-]+\.oraclecloud\.com/[^\s<>"\'\\]+', response.text)
    tokens = Counter(token for link in links if (token := board_token(link)))
    return tokens.most_common(1)[0][0] if tokens else None
