# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Keep the existing feeds readers in a bounded provider module; ats retains their registry and public names.
from __future__ import annotations
import re
from datetime import datetime
from . import http
from .ats_common import _strip_html, _jsonld_description
from .work_arrangement import looks_remote as _looks_remote, remote_location
from .salary_text import parse_salary as _parse_salary
from .listed_boards import listed_place

class Greenhouse:
    NAME = "greenhouse"
    _URL = re.compile(r"(?:boards|job-boards)\.greenhouse\.io/(?:embed/job_board\?for=)?([a-z0-9_-]+)", re.I)

    @classmethod
    def fetch(cls, token):
        data = http.get_json(f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true")
        out = []
        for j in (data or {}).get("jobs", []):
            loc = (j.get("location") or {}).get("name")
            depts = ", ".join(d.get("name", "") for d in j.get("departments", []) if d.get("name"))
            out.append({
                "ats_job_id": j.get("id"),
                "title": j.get("title"),
                "location": loc,
                "remote": _looks_remote(loc, j.get("title")),
                "department": depts or None,
                "url": j.get("absolute_url"),
                "description": _strip_html(j.get("content")),
                "posted_at": j.get("updated_at"),
            })
        return out

    @classmethod
    def detect(cls, url):
        m = cls._URL.search(url or "")
        return m.group(1) if m else None

    @classmethod
    def probe(cls, slug):
        d = http.get_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs")
        return slug if d and d.get("jobs") else None



class Lever:
    NAME = "lever"
    _URL = re.compile(r"jobs\.(?:eu\.)?lever\.co/([a-z0-9_-]+)", re.I)

    @classmethod
    def fetch(cls, token):
        data = http.get_json(f"https://api.lever.co/v0/postings/{token}?mode=json")
        out = []
        for j in (data or []):
            cat = j.get("categories") or {}
            loc = cat.get("location")
            rec = {
                "ats_job_id": j.get("id"),
                "title": j.get("text"),
                "location": loc,
                "remote": _looks_remote(loc, cat.get("commitment"), j.get("workplaceType")),
                "department": cat.get("team"),
                "url": j.get("hostedUrl"),
                "description": _strip_html(j.get("descriptionPlain") or j.get("description")),
                "posted_at": j.get("createdAt"),
            }
            sal = _parse_salary(j.get("salaryDescription") or (j.get("salaryRange") or {}).get("text"))
            if sal:
                rec.update(salary_min=sal["min"], salary_max=sal["max"],
                           salary_currency=sal["currency"], salary_period=sal["period"], salary_raw=sal["raw"])
            out.append(rec)
        return out

    @classmethod
    def detect(cls, url):
        m = cls._URL.search(url or "")
        return m.group(1) if m else None

    @classmethod
    def probe(cls, slug):
        d = http.get_json(f"https://api.lever.co/v0/postings/{slug}?mode=json")
        return slug if isinstance(d, list) and d else None



class Ashby:
    NAME = "ashby"
    _URL = re.compile(r"jobs\.ashbyhq\.com/([a-z0-9_.-]+)", re.I)

    @classmethod
    def fetch(cls, token):
        data = http.get_json(
            f"https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true"
        )
        out = []
        for j in (data or {}).get("jobs", []):
            loc = j.get("location")
            loc = remote_location(loc, j.get("title"), verified=j.get("isRemote"))
            rec = {
                "ats_job_id": j.get("id"),
                "title": j.get("title"),
                "location": loc,
                "remote": _looks_remote(loc, j.get("title"), verified=j.get("isRemote")),
                "department": j.get("departmentName") or j.get("teamName"),
                "url": j.get("jobUrl") or j.get("applyUrl"),
                "description": _strip_html(j.get("descriptionPlain") or j.get("descriptionHtml")),
                "posted_at": j.get("publishedDate") or j.get("publishedAt"),
            }
            comp = j.get("compensation") or {}
            sal = _parse_salary(comp.get("compensationTierSummary") or comp.get("summary"))
            if sal:
                rec.update(salary_min=sal["min"], salary_max=sal["max"],
                           salary_currency=sal["currency"], salary_period=sal["period"], salary_raw=sal["raw"])
            out.append(rec)
        return out

    @classmethod
    def detect(cls, url):
        m = cls._URL.search(url or "")
        return m.group(1) if m else None

    @classmethod
    def probe(cls, slug):
        d = http.get_json(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
        return slug if d and d.get("jobs") else None



class SmartRecruiters:
    NAME = "smartrecruiters"
    _URL = re.compile(r"(?:jobs|careers)\.smartrecruiters\.com/([a-z0-9_-]+)", re.I)

    @classmethod
    def fetch(cls, token):
        out, offset = [], 0
        while True:
            data = http.get_json(
                f"https://api.smartrecruiters.com/v1/companies/{token}/postings?limit=100&offset={offset}"
            )
            if not data:
                break
            for j in data.get("content", []):
                loc = j.get("location") or {}
                loc_str = ", ".join(x for x in [loc.get("city"), loc.get("region"), loc.get("country")] if x)
                loc_str = remote_location(loc_str, j.get("name"), verified=loc.get("remote"))
                out.append({
                    "ats_job_id": j.get("id"),
                    "title": j.get("name"),
                    "location": loc_str or None,
                    "remote": _looks_remote(loc_str, j.get("name"), verified=loc.get("remote")),
                    "department": (j.get("department") or {}).get("label"),
                    "url": f"https://jobs.smartrecruiters.com/{token}/{j.get('id')}",
                    "description": None,  # full text needs a per-posting call; skipped for speed
                    "posted_at": j.get("releasedDate"),
                })
            total = data.get("totalFound", 0)
            offset += 100
            if offset >= total or not data.get("content"):
                break
        return out

    @classmethod
    def detect(cls, url):
        m = cls._URL.search(url or "")
        return m.group(1) if m else None

    @classmethod
    def probe(cls, slug):
        d = http.get_json(f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=1")
        return slug if d and d.get("content") else None

    @classmethod
    def detail(cls, token, job_id, url=None):
        """Fetch the full job-ad text for one posting (SmartRecruiters omits it from the list)."""
        d = http.get_json(f"https://api.smartrecruiters.com/v1/companies/{token}/postings/{job_id}")
        if not d:
            return {}
        sections = ((d.get("jobAd") or {}).get("sections") or {})
        parts = [(sections.get(k) or {}).get("text") for k in
                 ("jobDescription", "qualifications", "additionalInformation", "companyDescription")]
        desc = _strip_html("\n\n".join(p for p in parts if p))
        return {"description": desc or None}



class Workable:
    NAME = "workable"
    _URL = re.compile(r"(?:apply\.workable\.com/([a-z0-9_-]+)|([a-z0-9_-]+)\.workable\.com)", re.I)

    @staticmethod
    def _place(j):
        """Where a listing is, as "City, Region, Country". The board's feed gives it as top-level `city`, `state` and
        `country` and as one entry in `locations`; a place the employer hides gives its country only. An older
        `location` object or text still reads."""
        loc = j.get("location")
        if loc and not isinstance(loc, dict):
            return str(loc)
        if not loc:
            listed = [place for place in (j.get("locations") or []) if isinstance(place, dict)]
            loc = listed[0] if listed else {"city": j.get("city"), "region": j.get("state"), "country": j.get("country")}
        parts = [loc.get("country")] if loc.get("hidden") else [loc.get("city"), loc.get("region"), loc.get("country")]
        return ", ".join(part for part in parts if part)

    @classmethod
    def fetch(cls, token):
        data = http.get_json(f"https://apply.workable.com/api/v1/widget/accounts/{token}?details=true")
        jobs = (data or {}).get("jobs", []) if isinstance(data, dict) else []
        out, listed = [], set()
        for j in jobs:
            job_id = j.get("shortcode") or j.get("id")
            # The board lists a job once for each place it is offered in, under one id: keep the first.
            if job_id is not None and job_id in listed:
                continue
            listed.add(job_id)
            verified = j.get("remote") if "remote" in j else j.get("telecommuting")
            loc_str = remote_location(cls._place(j), j.get("title"), verified=verified)
            out.append({
                "ats_job_id": job_id,
                "title": j.get("title"),
                "location": loc_str or None,
                "remote": _looks_remote(loc_str, j.get("title"), verified=verified),
                "department": j.get("department"),
                "url": j.get("url") or j.get("application_url")
                       or f"https://apply.workable.com/{token}/j/{j.get('shortcode')}",
                "description": _strip_html(j.get("description")),
                "posted_at": j.get("published_on") or j.get("created_at"),
            })
        return out

    @classmethod
    def detect(cls, url):
        m = cls._URL.search(url or "")
        return (m.group(1) or m.group(2)) if m else None

    @classmethod
    def probe(cls, slug):
        d = http.get_json(f"https://apply.workable.com/api/v1/widget/accounts/{slug}")
        return slug if isinstance(d, dict) and d.get("jobs") is not None else None

