# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.76.1: the final packet holds one entry per job (role_plan.drop_repeats) and its review names only what the final résumé still holds (resume_review.settle). Made-up person and figures only.
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.76.2: a letter is dated the calendar day in Career's time zone (America/Chicago), never the server's UTC day (generate._today).
# 3 | maintainer@emeraldcoastsystemsgroup.com | A cover letter said "In my own open-source work on <project> | independent product, I designed ...": the model copied a recorded label with its " | descriptor" tail into a sentence. The contract now proves label_prose.rewrite writes such a label as the name before the bar in a letter's and a résumé's sentences (mid-sentence, at a sentence end, twice in one letter, written with other capitals), leaves a line of columns, a résumé entry's own fields and a letter without the label as they were, reads the labels from the person's records only, that generate._tailored_packet's final packet holds no such label while the claims receipt's fingerprint is still the final letter's, and that the claims check's notice names the entry once, by its name. Made-up person, project and employer only.
"""Final-packet contract: one entry per job, a review judged on what is sent, and recorded labels named plainly in sentences."""
from __future__ import annotations

import copy
import datetime
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

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


LABEL = "Tidewater Ledger (tidewater.example) | independent product"
NAME = "Tidewater Ledger (tidewater.example)"
MID = ("In my own open-source work on Tidewater Ledger (tidewater.example) | independent product, I designed and "
       "operate a Rust and PostgreSQL platform that runs nightly jobs.")
MID_PLAIN = ("In my own open-source work on Tidewater Ledger (tidewater.example), I designed and operate a Rust and "
             "PostgreSQL platform that runs nightly jobs.")
HEADING = "Maintainer | Tidewater Ledger (tidewater.example) | independent product | 2024 to Present"
CONTACT = "Ada Example | Springfield, IL | ada@example.invalid"


def selected() -> list:
    """@description The made-up person's Other experience entry chosen for the packet: its title and organization are
    one label with a descriptor after a bar, as a saved portfolio's are. @returns The selected entries."""
    return [{"id": "saved-portfolio", "title": LABEL, "kind": "project", "organization": LABEL, "period": "2024 to Present",
             "facts": "Designed and operates a Rust and PostgreSQL platform that runs nightly jobs.",
             "skills": ["Rust", "PostgreSQL"], "archived": False}]


def letter(*paragraphs: str) -> dict:
    """@description A packet holding only a letter. @param paragraphs - Its paragraphs. @returns {cover}."""
    return {"cover": {"greeting": "Dear Hiring Manager,", "paragraphs": list(paragraphs), "closing": "Sincerely,"}}


def test_label_in_letter() -> None:
    """@description A recorded label with a descriptor after a bar is written as its name in a letter's sentences: in
    mid-sentence, at a sentence end, twice in one letter and with other capitals; nothing else in the letter moves.
    @returns None."""
    from jobhunter import label_prose
    end = "The same habits shaped Tidewater Ledger (tidewater.example) | independent product."
    capitals = "Outside work I maintain Tidewater Ledger (tidewater.example) | Independent Product; it runs nightly."
    packet = letter(MID, end + " " + MID, capitals)
    before = copy.deepcopy(packet)
    fixed, changes = label_prose.rewrite(packet, profile(), selected())
    paragraphs = fixed["cover"]["paragraphs"]
    check("label in mid-sentence is written as the name before the bar", paragraphs[0] == MID_PLAIN, paragraphs[0])
    check("label at a sentence end is written as the name, the full stop kept",
          paragraphs[1].startswith("The same habits shaped Tidewater Ledger (tidewater.example). "), paragraphs[1])
    check("label twice in one paragraph, and four times in one letter, is rewritten each time",
          paragraphs[1] == "The same habits shaped Tidewater Ledger (tidewater.example). " + MID_PLAIN
          and "|" not in json.dumps(paragraphs) and len(changes) == 4, f"{len(changes)} {paragraphs}")
    check("label written with other capitals is rewritten too",
          paragraphs[2] == "Outside work I maintain Tidewater Ledger (tidewater.example); it runs nightly.", paragraphs[2])
    check("each change is recorded with where it was, what was written and the name",
          changes[0] == {"path": "cover.paragraphs.0", "from": LABEL, "to": NAME}, f"{changes[:1]}")
    check("the greeting and closing are as they were, and the packet handed in is not changed",
          fixed["cover"]["greeting"] == "Dear Hiring Manager," and fixed["cover"]["closing"] == "Sincerely," and packet == before)


def test_label_headings_and_unchanged() -> None:
    """@description A line of columns separated by bars (a role's heading, the contact line), a résumé entry's own
    title, organization and dates, and a letter with no recorded label are left exactly as they were; a label the
    person's records do not hold is never rewritten. @returns None."""
    from jobhunter import label_prose
    resume = {"headline": "Platform Engineer | Java | Python", "summary": "Engineer. " + MID,
              "competencies": ["Java | Python"], "skills": ["Rust | PostgreSQL"],
              "experience": [{"title": "Principal Platform Engineer", "org": "Apex Cloud Systems", "span": "Jan 2015 to Present",
                              "bullets": ["Built Java services and Python automation."]}],
              "additional_experience": [{"title": "Maintainer", "org": LABEL, "span": "2024 to Present",
                                         "bullets": [HEADING, "Wrote the scheduler of " + LABEL + " in Rust."]}]}
    packet = {"resume": resume, **letter(CONTACT, HEADING, LABEL, MID)}
    fixed, changes = label_prose.rewrite(packet, profile(), selected())
    entry = fixed["resume"]["additional_experience"][0]
    check("a résumé entry's own title, organization and dates keep the recorded label",
          (entry["title"], entry["org"], entry["span"]) == ("Maintainer", LABEL, "2024 to Present"), f"{entry}")
    check("a heading line of columns is left alone in a bullet and in a letter",
          entry["bullets"][0] == HEADING and fixed["cover"]["paragraphs"][:3] == [CONTACT, HEADING, LABEL], f"{fixed['cover']}")
    check("the label in a bullet's sentence and in the summary's sentence is written as the name",
          entry["bullets"][1] == "Wrote the scheduler of " + NAME + " in Rust." and fixed["resume"]["summary"] == "Engineer. " + MID_PLAIN,
          f"{entry['bullets'][1]} / {fixed['resume']['summary']}")
    check("the headline and the skill lists keep their bars",
          fixed["resume"]["headline"] == resume["headline"] and fixed["resume"]["competencies"] == ["Java | Python"]
          and fixed["resume"]["skills"] == ["Rust | PostgreSQL"])
    check("only the three sentences changed", fixed["cover"]["paragraphs"][3] == MID_PLAIN and len(changes) == 3, f"{changes}")
    plain = {"resume": {"summary": "Engineer who reads a | b tables.", "experience": resume["experience"]},
             **letter(MID_PLAIN, "The role fits the Java and Python platform work I lead at Apex Cloud Systems.", CONTACT)}
    raw = json.dumps(plain, ensure_ascii=False, sort_keys=True)
    same, none = label_prose.rewrite(plain, profile(), selected())
    check("a packet with no recorded label in a sentence is handed back itself, byte for byte",
          same is plain and none == [] and json.dumps(same, ensure_ascii=False, sort_keys=True) == raw)
    other, none = label_prose.rewrite(letter(MID), profile(), ())
    check("a label the person's records do not hold is not rewritten", other["cover"]["paragraphs"] == [MID] and none == [])


def test_label_from_records() -> None:
    """@description The labels come from the person's own records: a job's employer, a client engagement's project,
    a saved portfolio and a label written with a dash the packet's cleanup turns into a comma. @returns None."""
    from jobhunter import generate, label_prose
    prof = profile()
    prof["roles"][0]["org"] = "Apex Cloud Systems | platform group | Springfield"
    prof["project_ledger"] = [{"project": "Harbor – Works | pilot", "role": "Lead", "tech": ["Java"]}]
    prof["oss_portfolio"] = {"label": "Saved work", "entry": {"org": "Quiet Loom | side project", "title": "Maintainer"}}
    check("name() is the text before the first bar, and a label with no bar is itself",
          label_prose.name(LABEL) == NAME and label_prose.name("Apex Cloud Systems") == "Apex Cloud Systems" and label_prose.name(None) == "")
    packet = letter("At Apex Cloud Systems | platform group | Springfield, the team I lead built Java services.",
                    "At Apex Cloud Systems | platform group I also ran Python automation.",
                    "Harbor, Works | pilot taught me to ship small, and Quiet Loom | side project keeps me writing code.")
    fixed, changes = label_prose.rewrite(packet, prof, (), generate._dewash)
    check("a job's employer label is written as its name, with all of its tail or the first part of it",
          fixed["cover"]["paragraphs"][:2] == ["At Apex Cloud Systems, the team I lead built Java services.",
                                               "At Apex Cloud Systems I also ran Python automation."], f"{fixed['cover']['paragraphs']}")
    check("an engagement's project (as the dash cleanup leaves it) and a saved portfolio's label are written as their names",
          fixed["cover"]["paragraphs"][2] == "Harbor, Works taught me to ship small, and Quiet Loom keeps me writing code."
          and len(changes) == 4, f"{fixed['cover']['paragraphs'][2]} {changes}")


def _scripted_packet() -> dict:
    """@description What the scripted model writes for the made-up posting: the recorded label copied into the
    letter's and the résumé's sentences, as the model did. @returns {resume, cover}."""
    return {
        "resume": {
            "headline": "Principal Platform Engineer",
            "summary": ("Platform engineer who builds Java services and Python automation. Also designed and operates "
                        "Tidewater Ledger (tidewater.example) | independent product, a Rust and PostgreSQL platform."),
            "competencies": ["Java", "Python"], "skills": ["Java (12 years)", "Python (5 years)", "Rust", "PostgreSQL"],
            "certifications": [], "education": [], "clearance": "",
            "experience": [{"title": "Principal Platform Engineer", "org": "Apex Cloud Systems", "span": "Jan 2015 to Nov 2026",
                            "bullets": ["Built Java services and Python automation."]}],
            "additional_experience": [{"title": LABEL, "org": LABEL, "span": "2024 to Present",
                                       "bullets": ["Designed the scheduler of " + LABEL + " in Rust on PostgreSQL."]}],
        },
        "cover": {"greeting": "Dear Hiring Manager,", "closing": "Sincerely,", "paragraphs": [
            "The Platform Engineer role at Meridian Networks is close to the Java and Python platform work the team I lead "
            "does at Apex Cloud Systems, where we built Java services and Python automation.",
            MID + " That work taught me to keep nightly jobs small, observable and easy to run again.",
            "I would like to talk about what that experience could bring to your platform team, and about the lessons of "
            "Tidewater Ledger (tidewater.example) | independent product."]},
    }


def test_tailored_packet() -> None:
    """@description The real generation function, the model scripted: the packet it hands back names the project by
    its name in every sentence of the letter and the résumé, keeps the label on the résumé entry's heading fields,
    and the claims receipt's fingerprint is still the final letter's. @returns None."""
    from jobhunter import claims_fix, generate
    draft = _scripted_packet()

    def scripted(system, prompt, max_tokens=0, bot=None, **_kw):
        if bot == "career-resume-reviewer":
            return json.dumps({"passed": True, "issues": [], "revised_resume": None, "reviewer_notes": "ok"})
        return json.dumps(draft["cover"] if "DRAFT COVER" in prompt else draft)

    row = {"title": "Platform Engineer", "location": "Remote", "description": "Build Java and Python platform services. Rust and PostgreSQL are a plus."}
    with patch.object(generate.enrich, "complete", side_effect=scripted):
        result = generate._tailored_packet(profile(), selected(), row, "Meridian Networks", False, "")
    packet, receipt = result[0], result[4]
    paragraphs = packet["cover"]["paragraphs"]
    check("generation: the letter keeps its three paragraphs and the sentence that named the project",
          len(paragraphs) == 3 and paragraphs[1].startswith(MID_PLAIN), f"{paragraphs}")
    check("generation: no sentence of the final letter holds the label's bar", "|" not in json.dumps(paragraphs), f"{paragraphs}")
    check("generation: the letter's last sentence ends on the project's name",
          paragraphs[-1].endswith("the lessons of Tidewater Ledger (tidewater.example)."), paragraphs[-1])
    resume = packet["resume"]
    extra = (resume.get("additional_experience") or [{}])[0]
    check("generation: the résumé's summary and bullet sentences name the project by its name",
          "|" not in resume["summary"] and NAME in resume["summary"]
          and extra.get("bullets") == ["Designed the scheduler of " + NAME + " in Rust on PostgreSQL."], f"{resume['summary']} / {extra}")
    check("generation: the résumé entry's heading fields keep the recorded label", extra.get("org") == LABEL, f"{extra}")
    check("generation: the claims receipt's fingerprint is the final letter's",
          receipt.get("cover_digest") == claims_fix.digest(packet["cover"]), f"{receipt.get('status')}")
    recorded = result[8] if len(result) > 8 else None
    check("generation: what the pass rewrote is handed back for application.json",
          isinstance(recorded, list) and len(recorded) == 4 and all(item["to"] == NAME for item in recorded), f"{recorded}")


def test_notice_names_the_entry_once() -> None:
    """@description The claims check's sentence to the person names an Other experience entry whose title and
    organization are one label once, by its name, and still names a job as its title at its employer. @returns None."""
    from jobhunter import claims_check, claims_fix
    rec = claims_check.records(profile(), selected(), frozenset(), TODAY)
    keys = {row["key"]: row for row in rec["rows"]}
    problem = {"document": "cover", "kind": "attribution", "claim": "Rust", "where": ["A1"]}
    words = claims_check.describe(problem, rec)
    check("notice: the entry is named once, by its name",
          words == "The cover letter put Rust under the wrong job; your records name it only at " + NAME + ".", words)
    check("notice: the line for the model writing the letter again names it the same way",
          claims_fix.instruction(problem, rec).endswith("The records name it only at: " + NAME + "."), claims_fix.instruction(problem, rec))
    check("notice: a job still reads as its title at its employer",
          claims_check._where(keys["R1"]) == "Principal Platform Engineer at Apex Cloud Systems", claims_check._where(keys["R1"]))


def main() -> int:
    """@description Run all checks and print a JSON summary. @returns Exit code 0 or 1."""
    for fn in (test_drop_repeats, test_settle, test_letter_date, test_label_in_letter, test_label_headings_and_unchanged,
               test_label_from_records, test_tailored_packet, test_notice_names_the_entry_once):
        try:
            fn()
        except Exception as err:  # a crash is a failed check, named
            check(f"{fn.__name__} raised {type(err).__name__}: {err}", False)
    failed = [name for name, ok in CHECKS if not ok]
    print(json.dumps({"checks": len(CHECKS), "failed": failed}))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
