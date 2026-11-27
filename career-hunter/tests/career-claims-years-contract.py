# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | A résumé made on 2026-11-26 read "2 years" twice beside "Java / J2EE (11 years)", with the notice "The résumé claimed 11 years; your records support about 2. Career toned it down to what your records say", for a person who states Java 11 years: the claims check held "11 years of Java and <another tool>" to the tool with the fewest recorded years and wrote that count in. This contract proves, on a made-up person who states Java 11 years and whose dated records span 2: the claims check leaves a years figure the person stated as written (beside another tool, in a list, in "N-year" form, behind a title, in a role's bullet, in the letter), takes a figure they have not stated out of its sentence and never writes a number of its own, keeps a stated total, says what it did in true words with no count of its own, gives the résumé review nothing to refuse, and that the real generation function ends with the person's figure where the model wrote it after the letter's second writing and the reviewer's rewrite, and on a letter held for the person's review. Made-up person, employers and figures only.
"""Claims check and years: a figure the person stated stays, one they did not is taken out, and no number is Career's own."""
from __future__ import annotations

import datetime
import json
import os
import re
import sys
from pathlib import Path
from unittest.mock import patch

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT / "engine"))
os.environ["JOBHUNTER_MULTIUSER"] = "1"
os.environ["JOBHUNTER_STORE"] = "sqlite"

from jobhunter import claims_check, claims_fix, resume_review, skill_tenure, years_truth  # noqa: E402

CHECKS: list = []
TODAY = datetime.date(2026, 11, 26)
TITLE, COMPANY = "Java Platform Engineer", "Meridian Networks"
DESCRIPTION = "Build Java and Spring services on Kubernetes for a small platform team. " * 3
OWN = "Brings 11 years of Java and Spring development to regulated programs."
TOTAL = "Platform engineer with over 25 years of experience building billing platforms."
PLAIN = "Platform engineer with experience building billing platforms."
SUMMARY = f"{TOTAL} {OWN} Leads delivery with small teams."
YEARS = re.compile(r"\b(\d{1,2})\+?[ -]years?\b", re.I)


def check(name: str, condition, detail: str = "") -> None:
    """@description Record one named check. @param name - Check name. @param condition - Truthy when it passed.
    @param detail - Shown when it failed. @returns None."""
    CHECKS.append((name + (f" ({detail})" if detail and not condition else ""), bool(condition)))


def profile(java=11, total=None) -> dict:
    """@description A made-up person whose one dated job spans two years (January 2023 to December 2024).
    @param java - The years of Java they state, or None for a person who states no figure.
    @param total - The total they state, or None. @returns Profile dict."""
    prof = {
        "profile": {"name": "Lee Example", "email": "lee@example.invalid", "headline": "Platform Engineer",
                    "experience_summary": "Platform engineer who builds billing services."},
        "roles": [{"id": "r1", "title": "Platform Engineer", "org": "Apex Cloud Systems", "start": "2023-01", "end": "2024-12",
                   "bullets": ["Built Java services and Spring automation on Kubernetes for a billing platform."],
                   "skills": ["Java", "Spring", "Kubernetes"]}],
    }
    if java is not None:
        prof["years_by_skill"] = [{"skill": "Java", "years": java}]
    if total is not None:
        prof["career_years"] = total
    return prof


def resume(summary: str = "", skills=(), bullets=()) -> dict:
    """@description A résumé of the made-up person's one job. @param summary - Its summary. @param skills - Its skills
    lines. @param bullets - The job's bullets. @returns Résumé dict."""
    return {"headline": "Platform Engineer", "summary": summary, "competencies": [], "skills": list(skills),
            "certifications": [], "education": [], "clearance": "",
            "experience": [{"title": "Platform Engineer", "org": "Apex Cloud Systems", "span": "Jan 2023 to Dec 2024",
                            "bullets": list(bullets) or ["Built Java services and Spring automation on Kubernetes."]}]}


def context(prof: dict) -> tuple:
    """@description What the claims check reads for the made-up posting. @param prof - The profile.
    @returns (records, job)."""
    job = {"title": TITLE, "company": COMPANY, "terms": claims_check.posting_terms(TITLE, DESCRIPTION)}
    return claims_check.records(prof, (), job["terms"], TODAY), job


def held(prof: dict, packet: dict) -> tuple:
    """@description One packet through the claims check and its fix. @param prof - The profile. @param packet - The
    generation. @returns (fixed packet, the years actions, every problem found)."""
    rec, job = context(prof)
    found = claims_check.check(packet, rec, job)
    fixed, actions = claims_fix.fix(packet, found, rec, job, frozenset(), prof)
    return fixed, [item for item in actions if item["kind"] == "years"], found


def years_of(value) -> list:
    """@description Every number of years written anywhere in a value. @param value - A JSON value.
    @returns The numbers, sorted, each once."""
    return sorted(set(YEARS.findall(json.dumps(value, ensure_ascii=False))), key=int)


def test_own_figure_is_supported() -> None:
    """@description A years figure the person stated for what the claim names is never a problem, whatever the dated
    records add up to and whatever other tool the sentence names. @returns None."""
    prof = profile()
    for name, packet in (
        ("beside another tool", {"resume": resume(OWN)}),
        ("in a skills line", {"resume": resume("", ["Java / J2EE (11 years)", "Spring", "Kubernetes"])}),
        ("in N-year form", {"resume": resume("An 11-year Java and Spring developer who ships billing services.")}),
        ("behind a title", {"resume": resume("Java developer with 11 years of experience. Ships billing services.")}),
        ("written with over", {"resume": resume("Brings over 11 years of Java and Spring development.")}),
        ("in a role's bullet", {"resume": resume("", (), ["Built Java and Spring services for 11 years on Kubernetes"])}),
        ("in the letter", {"resume": resume(), "cover": {"paragraphs": ["My 11 years of Java and Spring fit this role."]}}),
    ):
        fixed, actions, found = held(prof, packet)
        check(f"the person's own figure {name} is not a problem", not [p for p in found if p["kind"] == "years"],
              f"{[(p['kind'], p.get('claim')) for p in found]}")
        check(f"the person's own figure {name} is left exactly as written", fixed == packet, json.dumps(fixed)[:300])
    rec, _job = context(prof)
    check("the records keep the person's own figures for the check", (rec.get("figures") or {}).get("skills", [{}])[0].get("years") == 11)
    total = profile(total=25)
    kept = {"resume": resume("Engineer with 25 years of experience across Java and Kubernetes. Leads delivery.")}
    fixed, actions, found = held(total, kept)
    check("a stated total beside tools is kept as written", fixed == kept and not actions, json.dumps(fixed["resume"]["summary"]))
    over = {"resume": resume("Engineer with over 30 years of experience. Leads delivery.")}
    fixed, actions, found = held(total, over)
    final, changes = years_truth.enforce(fixed, total, ())
    check("a total other than the stated one is left for the years pass, which writes the stated total",
          fixed == over and final["resume"]["summary"] == "Engineer with 25 years of experience. Leads delivery.",
          final["resume"]["summary"])
    low = {"resume": resume("Engineer with 9 years of Java and Spring. Leads delivery.")}
    fixed, actions, found = held(prof, low)
    final, changes = years_truth.enforce(fixed, prof, ())
    check("a claim naming the person's skill with another number is left for the years pass, which writes their figure",
          fixed == low and final["resume"]["summary"] == "Engineer with 11 years of Java and Spring. Leads delivery.",
          final["resume"]["summary"])
    two = {"resume": resume("Brings 9 years of Java engineering and 2 years of Spring automation.")}
    _fixed, _actions, found = held(profile(java=None), two)
    check("two years claims in one sentence are each held to their own tool",
          not any(p["kind"] == "years" and p["claim"] == "9 years" and p.get("term") == "spring" for p in found),
          f"{[(p.get('claim'), p.get('term')) for p in found]}")


def test_unstated_figure_is_taken_out() -> None:
    """@description A years figure the person has not stated is taken out with its sentence kept, and no number of
    Career's own is ever written, for a person who stated figures and for one who stated none. @returns None."""
    prof = profile()
    packet = {"resume": resume(SUMMARY, ["Java / J2EE (11 years)", "Kubernetes (15 years)"], ["Ran Kubernetes clusters for 15 years"]),
              "cover": {"paragraphs": ["With over 25 years of experience, I have built Java services. My 11 years of Java and Spring fit this role."]}}
    fixed, actions, found = held(prof, packet)
    check("no years problem carries a count of Career's own", all("supported" not in p for p in found if p["kind"] == "years"),
          f"{[p for p in found if p['kind'] == 'years']}")
    check("an unstated total is taken out and its sentence kept; the person's figure stays in the next sentence",
          fixed["resume"]["summary"] == f"{PLAIN} {OWN} Leads delivery with small teams.", fixed["resume"]["summary"])
    check("an unstated figure in a skills line is taken out, the person's own beside it kept",
          fixed["resume"]["skills"] == ["Java / J2EE (11 years)", "Kubernetes"], f"{fixed['resume']['skills']}")
    check("an unstated figure in a role's bullet is taken out", fixed["resume"]["experience"][0]["bullets"] == ["Ran Kubernetes clusters"],
          f"{fixed['resume']['experience'][0]['bullets']}")
    check("an unstated total in the letter is taken out and the person's figure kept",
          fixed["cover"]["paragraphs"] == ["With experience, I have built Java services. My 11 years of Java and Spring fit this role."],
          f"{fixed['cover']['paragraphs']}")
    check("the only number of years left in the packet is the person's own", years_of(fixed) == ["11"], f"{years_of(fixed)}")
    check("each figure taken out is recorded as taken out, never as toned down",
          len(actions) == 4 and {item["action"] for item in actions} == {"years taken out"}, f"{[(a['claim'], a['action']) for a in actions]}")
    for name, before, after in (
        ("that opens a sentence", "Over 25 years of experience across billing platforms. Leads delivery.", "Experience across billing platforms. Leads delivery."),
        ("counted in decades", "Engineer with two decades of experience in Kubernetes. Leads delivery.", "Engineer with experience in Kubernetes. Leads delivery."),
        ("written as a decade", "Engineer with nearly a decade of Kubernetes. Leads delivery.", "Engineer with Kubernetes. Leads delivery."),
        ("in N-year form", "Engineer with a 26-year career in billing. Leads delivery.", "Engineer with a career in billing. Leads delivery."),
        ("on a project's length", "Led a 5-year Kubernetes migration. Leads delivery.", "Led a Kubernetes migration. Leads delivery."),
    ):
        fixed, actions, _found = held(prof, {"resume": resume(before)})
        check(f"an unstated figure {name} is taken out with the sentence kept", fixed["resume"]["summary"] == after, fixed["resume"]["summary"])
    fixed, actions, _found = held(prof, {"resume": resume("Engineer who spent 15 years modernizing Kubernetes platforms. Leads delivery.")})
    check("a figure that cannot be taken out and leave a sentence goes with its sentence, never with another number",
          fixed["resume"]["summary"] == "Leads delivery." and [item["action"] for item in actions] == ["removed"], fixed["resume"]["summary"])
    none = profile(java=None)
    fixed, actions, _found = held(none, {"resume": resume(SUMMARY.replace("11 years", "15 years"), ["Kubernetes (15 years)"])})
    check("a person who stated no figure: years the dated records do not add up to are taken out, not rewritten",
          years_of(fixed) == [] and fixed["resume"]["summary"].startswith(PLAIN + " Brings Java and Spring development")
          and fixed["resume"]["skills"] == ["Kubernetes"], f"{fixed['resume']['summary']} / {fixed['resume']['skills']}")
    honest = {"resume": resume("Platform engineer with 2 years of experience building billing platforms. Leads delivery.")}
    fixed, actions, found = held(none, honest)
    check("a person who stated no figure: years the dated records add up to are left as written", fixed == honest and not found)
    check("years_truth.without writes no number and reads what it cannot take out as None",
          years_truth.without("Leader with 20+ years of Java", 12, 21) == "Leader with Java"
          and years_truth.without("Grew revenue 40% in 3 years", 20, 27) is None
          and years_truth.without("No figure here", 0, 5) is None)


def test_notice() -> None:
    """@description The sentence to the person and the line for the letter's second writing say a years figure was
    not stated and was taken out; neither gives a count of Career's own. @returns None."""
    prof = profile()
    rec, job = context(prof)
    packet = {"resume": resume(SUMMARY), "cover": {"greeting": "Dear Hiring Manager,", "paragraphs": [], "closing": "Sincerely,"}}
    found = [p for p in claims_check.check(packet, rec, job) if p["kind"] == "years"]
    check("the check finds the unstated total and only it", [p["claim"] for p in found] == ["over 25 years"], f"{found}")
    words = claims_check.describe(found[0], rec) if found else ""
    check("the notice names the figure as one the person has not stated",
          words == "The résumé said “over 25 years”, a years figure you have not stated.", words)
    _held, receipt = claims_fix.hold(packet, prof, (), {"title": TITLE, "company": COMPANY, "description": DESCRIPTION}, [], today=TODAY)
    said = [item["words"] for item in receipt["problems"]]
    check("the receipt says the figure was taken out",
          said == ["The résumé said “over 25 years”, a years figure you have not stated. Career took the figure out."], f"{said}")
    check("no notice says what the records support, or that a figure was toned down",
          not any("support" in item or "toned" in item or re.search(r"\babout \d", item) for item in said), f"{said}")
    line = claims_fix.instruction(found[0], rec) if found else ""
    check("the line for the letter's second writing gives no number but the draft's own",
          "state no number of years" in line and not re.search(r"\d", line.replace("over 25 years", "")), line)
    check("claims_fix no longer has a step that writes a count", not hasattr(claims_fix, "_retime"))


def test_reviewer_has_no_conflict() -> None:
    """@description The résumé review's own check does not hold the person's figure against a tool named beside it;
    a real conflict and a real inflation are still found. @returns None."""
    prof = profile()
    rec, _job = context(prof)
    tenure = skill_tenure.compute_tenure(prof, (), TODAY)
    fixed, _actions, _found = held(prof, {"resume": resume(SUMMARY, ["Java / J2EE (11 years)", "Spring", "Kubernetes"])})
    issues = skill_tenure.find_year_contradictions(fixed["resume"], tenure, rec)
    check("the held résumé gives the review no years conflict", issues == [], f"{[item['message'] for item in issues]}")
    clash = resume("Brings 9 years of Java and Spring development.", ["Java / J2EE (11 years)"])
    kinds = {item["kind"] for item in skill_tenure.find_year_contradictions(clash, tenure, rec)}
    check("two different figures for the person's skill are still a conflict", "year_contradiction" in kinds, f"{kinds}")
    inflated = resume("Brings 15 years of Spring development.", ["Java / J2EE (11 years)"])
    found = skill_tenure.find_year_contradictions(inflated, tenure, rec)
    check("a figure on a tool the person stated nothing for is still found", any(item.get("skill") == "spring" for item in found), f"{found}")
    whole = profile(total=25)
    rec25, _job = context(whole)
    tenure25 = skill_tenure.compute_tenure(whole, (), TODAY)
    stated = resume("Engineer with 25 years of experience across Java and Kubernetes. Leads delivery.", ["Java / J2EE (11 years)"])
    issues = skill_tenure.find_year_contradictions(stated, tenure25, rec25)
    check("the person's stated total beside tools gives the review no conflict", issues == [], f"{[item['message'] for item in issues]}")
    tools = resume("Engineer with 25 years of Kubernetes. Leads delivery.", ["Java / J2EE (11 years)"])
    found = skill_tenure.find_year_contradictions(tools, tenure25, rec25)
    check("the stated total written as a tool's years is still found", any(item.get("skill") == "kubernetes" for item in found), f"{found}")


LETTER = [
    "The Java Platform Engineer role is the work I did at Apex Cloud Systems. With over 25 years of experience, I have built "
    "Java services and Spring automation on Kubernetes for a billing platform. I also wrote Rust services there.",
    "At Apex Cloud Systems the team shipped Java services and Spring automation on Kubernetes, and my 11 years of Java and "
    "Spring kept the billing platform easy to change. The same care would go into the services your platform team runs, "
    "from the first design note to the day a service is handed to the people who operate it.",
    "I would like to talk about what your platform team needs first, and about how the billing work at Apex Cloud Systems "
    "could help with it. Thank you for reading this letter and for your time.",
]
SECOND = [LETTER[0].replace(" I also wrote Rust services there.", " That work came with 2 years of Kubernetes."), LETTER[1], LETTER[2]]
THIN = ["My 11 years of Java and Spring fit this role, along with 2 years of Kubernetes. With over 25 years of experience, I "
        "have built Java services.", "I also wrote Rust services there."]


def _generate(paragraphs: list, second) -> tuple:
    """@description The real generation function with the model scripted: the writer and the cover editor give the
    draft, the letter's second writing gives `second` (None: nothing usable), and the reviewer rewrites the résumé
    with a figure the person never stated. @param paragraphs - The draft letter. @param second - The second letter.
    @returns (what _tailored_packet handed back, the model calls, the order the three passes ran in)."""
    from jobhunter import generate
    draft = {"resume": resume(SUMMARY, ["Java / J2EE (11 years)", "Spring", "Kubernetes"]),
             "cover": {"greeting": "Dear Hiring Manager,", "paragraphs": list(paragraphs), "closing": "Sincerely,"}}
    revised = resume(SUMMARY + " Adds 2 years of Kubernetes.", ["Java / J2EE (11 years)", "Spring", "Kubernetes"])
    calls, order = [], []

    def scripted(system, prompt, max_tokens=0, bot=None, **_kw):
        if bot == "career-resume-reviewer":
            calls.append("reviewer")
            return json.dumps({"passed": False, "issues": ["The summary could be tighter."], "revised_resume": revised, "reviewer_notes": "ok"})
        if "PROBLEMS CAREER FOUND" in prompt:
            calls.append("second letter")
            return json.dumps({"greeting": "Dear Hiring Manager,", "paragraphs": second, "closing": "Sincerely,"}) if second else "not json"
        calls.append("editor" if "DRAFT COVER" in prompt else "writer")
        return json.dumps(draft["cover"] if "DRAFT COVER" in prompt else draft)

    def logged(name, real):
        def run(*args, **kwargs):
            order.append(name)
            return real(*args, **kwargs)
        return run

    row = {"title": TITLE, "location": "Remote", "description": DESCRIPTION}
    with patch.object(generate.enrich, "complete", side_effect=scripted), \
            patch.object(generate.claims_fix, "hold", side_effect=logged("claims", claims_fix.hold)), \
            patch.object(generate.resume_review, "review_resume", side_effect=logged("review", resume_review.review_resume)), \
            patch.object(generate.years_truth, "enforce", side_effect=logged("years", years_truth.enforce)):
        return generate._tailored_packet(profile(), [], row, COMPANY, False, ""), calls, order


def test_generation() -> None:
    """@description The letter is written a second time and the reviewer rewrites the résumé, each putting back a
    figure the person never stated, and the packet handed back still states the person's 11 years where the model
    wrote them and no other number of years. @returns None."""
    result, calls, order = _generate(LETTER, SECOND)
    packet, claims, review = result[0], result[4], result[5]
    summary, letter = packet["resume"]["summary"], packet["cover"]["paragraphs"]
    check("generation: the letter was written a second time and the reviewer rewrote the résumé",
          calls.count("second letter") == 1 and "reviewer" in calls, f"{calls}")
    check("generation: the years pass runs after the claims check and after the review, on the packet they hand on",
          order == ["claims", "review", "years"], f"{order}")
    check("generation: the summary states the person's 11 years where the model wrote them", OWN in summary, summary)
    check("generation: the skills line keeps the person's figure", packet["resume"]["skills"][0] == "Java / J2EE (11 years)", f"{packet['resume']['skills']}")
    check("generation: the letter states the person's 11 years where the model wrote them",
          "my 11 years of Java and Spring kept the billing platform easy to change" in letter[1], f"{letter}")
    check("generation: the only number of years in the résumé and the letter is the person's own",
          years_of(packet) == ["11"], f"{years_of(packet)} {summary} {letter}")
    check("generation: no sentence says 2 years, and the total the person never stated is gone",
          not re.search(r"\b2 years\b|25 years", json.dumps(packet, ensure_ascii=False)), json.dumps(packet, ensure_ascii=False)[:600])
    check("generation: the sentences that lost a figure still read as sentences",
          summary.startswith(PLAIN + " " + OWN) and "With experience, I have built Java services" in letter[0]
          and "That work came with Kubernetes." in letter[0], f"{summary} / {letter[0]}")
    said = [item["words"] for item in claims.get("problems") or []]
    check("generation: the claims receipt says a figure the person has not stated was taken out",
          any("a years figure you have not stated. Career took the figure out." in item for item in said), f"{said}")
    check("generation: no notice says what the records support",
          not any("support about" in item or "toned it down" in item and "years" in item for item in said), f"{said}")
    check("generation: the review holds no years conflict on the final résumé",
          review.get("status") == "passed" and review.get("remaining_issues") == [], f"{review.get('remaining_issues')}")
    check("generation: the claims receipt records the second writing and a letter fit to send",
          claims.get("regenerated") is True and claims.get("status") == "fixed", f"{claims.get('status')}")


def test_generation_letter_held() -> None:
    """@description A letter the second writing cannot save is held for the person's review, and the years pass has
    still run on it: the person's figure stays and no other number of years is left. @returns None."""
    result, calls, order = _generate(THIN, None)
    packet, claims = result[0], result[4]
    letter = packet["cover"]["paragraphs"]
    check("held letter: the second writing was tried once and the letter is held for review",
          calls.count("second letter") == 1 and claims.get("status") == "needs_review" and bool(claims.get("review")), f"{calls} {claims.get('status')}")
    check("held letter: the years pass still ran after the claims check and the review", order == ["claims", "review", "years"], f"{order}")
    check("held letter: it states the person's 11 years and no other number of years",
          letter == ["My 11 years of Java and Spring fit this role, along with Kubernetes. With experience, I have built Java services."]
          and years_of(packet) == ["11"], f"{letter} {years_of(packet)}")


def main() -> int:
    """@description Run all checks and print a JSON summary. @returns Exit code 0 or 1."""
    for fn in (test_own_figure_is_supported, test_unstated_figure_is_taken_out, test_notice, test_reviewer_has_no_conflict,
               test_generation, test_generation_letter_held):
        try:
            fn()
        except Exception as err:  # a crash is a failed check, named
            check(f"{fn.__name__} raised {type(err).__name__}: {err}", False)
    failed = [name for name, ok in CHECKS if not ok]
    print(json.dumps({"checks": len(CHECKS), "failed": failed}, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
