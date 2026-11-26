# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.76.1: the final packet holds one entry per job (role_plan.drop_repeats) and its review names only what the final résumé still holds (resume_review.settle). Made-up person and figures only.
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.76.2: a letter is dated the calendar day in Career's time zone (America/Chicago), never the server's UTC day (generate._today).
"""Final-packet contract: one entry per job, and a review judged on what is sent."""
from __future__ import annotations

import datetime
import json
import os
import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT / "engine"))
os.environ["JOBHUNTER_MULTIUSER"] = "1"
os.environ["JOBHUNTER_STORE"] = "sqlite"

from jobhunter import resume_review, role_plan  # noqa: E402

CHECKS: list = []
TODAY = datetime.date(2026, 11, 25)


def check(name: str, condition, detail: str = "") -> None:
    """@description Record one named check. @param name - Check name. @param condition - Truthy when it passed.
    @param detail - Shown when it failed. @returns None."""
    CHECKS.append((name + (f" ({detail})" if detail and not condition else ""), bool(condition)))


def profile() -> dict:
    """@description A made-up person who stated their own years. @returns Profile dict."""
    return {
        "profile": {"name": "Ada Example", "email": "ada@example.invalid", "headline": "Platform Engineer"},
        "years_by_skill": [{"skill": "Java", "years": 12}, {"skill": "Python", "years": 5}],
        "roles": [
            {"id": "r1", "title": "Principal Platform Engineer", "org": "Apex Cloud Systems", "start": "2015-01",
             "end": "2026-11", "bullets": ["Built Java services and Python automation."], "skills": ["Java", "Python"]},
            {"id": "r2", "title": "Quality Manager - embedded at Beacon", "org": "Crest Technologies", "start": "2011-06",
             "end": "2014-12", "bullets": ["Ran quality reviews."], "skills": ["Java"]},
        ],
    }


def test_drop_repeats() -> None:
    """@description A job written twice with different punctuation is printed once, the recorded copy kept; two stints
    with different spans and two different jobs both stay. @returns None."""
    resume = {"experience": [
        {"title": "Principal Platform Engineer", "org": "Apex Cloud Systems", "span": "Jan 2015 to Present", "bullets": ["a"]},
        {"title": "Quality Manager (Embedded at Beacon)", "org": "Crest Technologies", "span": "Jun 2011 to Dec 2014", "bullets": ["b"]},
        {"id": "r2", "title": "Quality Manager, embedded at Beacon", "org": "Crest Technologies Inc.", "span": "Jun 2011 to Dec 2014", "bullets": ["c"]},
        {"title": "Quality Manager, embedded at Beacon", "org": "Crest Technologies", "span": "Jan 2005 to Dec 2008", "bullets": ["d"]},
    ]}
    dropped = role_plan.drop_repeats(resume)
    titles = [(item.get("id"), item["bullets"][0]) for item in resume["experience"]]
    check("drop_repeats drops the second copy of one job", dropped == 1 and len(resume["experience"]) == 3, f"{titles}")
    check("drop_repeats keeps the copy bound to the recorded role, in the first copy's place",
          titles == [(None, "a"), ("r2", "c"), (None, "d")], f"{titles}")
    same = {"experience": [{"title": "Engineer", "org": "Apex", "span": "2010 to 2012"}, {"title": "Architect", "org": "Apex", "span": "2010 to 2012"}]}
    check("drop_repeats keeps two different jobs at one employer", role_plan.drop_repeats(same) == 0 and len(same["experience"]) == 2)


def test_settle() -> None:
    """@description A years conflict the review found in the draft is gone once the final résumé no longer holds it; a
    reviewer bot's item stays; a conflict still in the final résumé keeps the résumé at needs review. @returns None."""
    stale = "Conflicting year claims for Java (summary[0]: '2 years', skills[0]: 'Java (12 years)')."
    bot = "The summary repeats the headline."
    receipt = {"status": "needs_review", "remaining_issues": [stale], "deterministic_remaining": [stale], "issues_fixed": []}
    posting = {"title": "Platform Engineer", "company": {}, "description": "Java and Python services."}
    final = {"resume": {"summary": "Engineer with 12 years of Java.", "skills": ["Java (12 years)", "Python (5 years)"],
                        "experience": []}}
    settled = resume_review.settle(receipt, final, profile(), (), posting, TODAY)
    check("settle: a draft's years conflict absent from the final résumé is no longer reported",
          settled["status"] == "passed" and settled["remaining_issues"] == [] and stale in settled["issues_fixed"], f"{settled}")
    with_bot = dict(receipt, remaining_issues=[stale, bot])
    settled = resume_review.settle(with_bot, final, profile(), (), posting, TODAY)
    check("settle: the reviewer bot's own item stays", settled["status"] == "needs_review" and settled["remaining_issues"] == [bot], f"{settled}")
    still = {"resume": {"summary": "Engineer with 2 years of Java.", "skills": ["Java (12 years)"], "experience": []}}
    settled = resume_review.settle(dict(receipt, status="passed", remaining_issues=[], deterministic_remaining=[]),
                                   still, profile(), (), posting, TODAY)
    check("settle: a conflict still in the final résumé is reported",
          settled["status"] == "needs_review" and any("Java" in msg for msg in settled["remaining_issues"]), f"{settled}")


def test_letter_date() -> None:
    """@description A letter made at 6:18 PM Central on November 25 (00:18 UTC on the 26th) is dated November 25; the
    Central day turns at midnight Central, in daylight saving time too. @returns None."""
    from jobhunter import generate
    utc = datetime.timezone.utc
    cases = [(datetime.datetime(2026, 11, 26, 0, 18, tzinfo=utc), "November 25, 2026"),
             (datetime.datetime(2026, 11, 26, 6, 0, tzinfo=utc), "November 26, 2026"),
             (datetime.datetime(2026, 7, 1, 4, 59, tzinfo=utc), "June 30, 2026"),
             (datetime.datetime(2026, 7, 1, 5, 0, tzinfo=utc), "July 01, 2026")]
    for moment, want in cases:
        got = generate._today(moment)
        check(f"letter date at {moment.isoformat()} is {want}", got == want, got)


def main() -> int:
    """@description Run all checks and print a JSON summary. @returns Exit code 0 or 1."""
    for fn in (test_drop_repeats, test_settle, test_letter_date):
        try:
            fn()
        except Exception as err:  # a crash is a failed check, named
            check(f"{fn.__name__} raised {type(err).__name__}: {err}", False)
    failed = [name for name, ok in CHECKS if not ok]
    print(json.dumps({"checks": len(CHECKS), "failed": failed}))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
