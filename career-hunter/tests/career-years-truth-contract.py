# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Contract tests for person-confirmed skill/career year figures (years_truth) and miswritten recorded-term restoration (term_fidelity).
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.68.23: the made-up person has new made-up figures; cases for a career total counted from the roles, years in a field no record confirms, a titled claim nearer the career, and the plural of a corrected unit.
"""Person-confirmed years truth and recorded-term fidelity contract tests."""
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

from jobhunter import claims_check, skill_tenure, term_fidelity, years_truth  # noqa: E402

CHECKS: list = []
TODAY = datetime.date(2026, 11, 19)


def check(name: str, condition, detail: str = "") -> None:
    """@description Record a named contract assertion into CHECKS.
    @param name - Assertion label. @param condition - Truthy/falsy outcome. @param detail - Optional failure detail.
    @returns None."""
    label = f"{name} ({detail})" if detail and not condition else name
    CHECKS.append((label, bool(condition)))


def base_profile() -> dict:
    """@description Build a synthetic profile for Ada Example without person-confirmed year figures.
    @returns Profile dict."""
    return {
        "profile": {
            "name": "Ada Example",
            "location": "Austin, TX",
            "email": "ada@example.invalid",
            "headline": "Principal Platform Engineer",
            "experience_summary": "Enterprise platform leader across cloud infrastructure and SAP integration.",
        },
        "roles": [
            {
                "id": "r1",
                "title": "Principal Platform Engineer",
                "org": "Apex Cloud Systems",
                "start": "2024-11",
                "end": "2026-11",
                "bullets": [
                    "Stood up the IL6 enclave for a made-up program.",
                    "Built Python and Jenkins automation pipelines for DevOps teams.",
                ],
                "skills": ["Python", "Jenkins", "DevOps", "Java"],
            },
            {
                "id": "r2",
                "title": "Senior Enterprise Architect",
                "org": "Beacon Global",
                "start": "2015-01",
                "end": "2024-10",
                "bullets": [
                    "Managed annual support contract renewals across global business units.",
                    "Delivered SAP NetWeaver Java and ABAP integrations.",
                ],
                "skills": ["Java", "ABAP", "SAP"],
            },
            {
                "id": "r3",
                "title": "Systems Engineer",
                "org": "Crest Technologies",
                "start": "2004-06",
                "end": "2014-12",
                "bullets": [
                    "Developed ABAP reports and enterprise Java services.",
                ],
                "skills": ["Java", "ABAP"],
            },
        ],
    }


def profile_with_figures() -> dict:
    """@description Build Ada Example's profile augmented with person-confirmed years_by_skill and career_years.
    @returns Profile dict with person figures."""
    prof = base_profile()
    prof["career_years"] = 24
    prof["years_by_skill"] = [
        {"skill": "Java", "years": 12},
        {"skill": "SAP NetWeaver Java", "years": 7},
        {"skill": "Python", "years": 5},
        {"skill": "Jenkins", "years": 5},
        {"skill": "DevOps", "years": 5},
        {"skill": "ABAP", "years": 16},
    ]
    return prof


def test_without_person_figures() -> None:
    """@description Verify baseline behaviour is unchanged when years_by_skill and career_years are absent.
    @returns None."""
    prof = base_profile()
    tenure = skill_tenure.compute_tenure(prof, today=TODAY)
    check("no career_source key when career_years absent", "career_source" not in tenure)
    check("no skill has source=='person' when years_by_skill absent",
          all(v.get("source") != "person" for v in tenure["skills"].values()))
    check("derived Python tenure is ~2 years from latest role only",
          1.8 <= tenure["skills"]["python"]["years"] <= 2.2)
    check("prompt_lines is empty when no person figures exist", years_truth.prompt_lines(tenure) == "")
    sample = {
        "resume": {"summary": "Engineer with 2 years of Python.", "skills": ["Java (9 years)"]},
        "cover": {"paragraphs": ["Brought 22 years of experience."]},
    }
    enforced, y_changes = years_truth.enforce(sample, prof)
    restored, t_changes = term_fidelity.restore(sample, prof)
    check("enforce returns data unchanged when no figures exist", enforced == sample and y_changes == [])
    low = {"resume": {"summary": "Engineer with 2 years of Python."}, "cover": {"paragraphs": ["Brought 2 years of experience."]}}
    enforced, y_changes = years_truth.enforce(low, prof)
    check("with no figures a career total below the roles' span is set to it; a skill's years are left alone",
          enforced["cover"]["paragraphs"] == ["Brought 22 years of experience."]
          and enforced["resume"] == low["resume"] and [c["skill"] for c in y_changes] == ["career"], f"{enforced} {y_changes}")
    check("restore returns data unchanged when no miswritten terms exist", restored == sample and t_changes == [])


def test_overlay_and_prompt_block() -> None:
    """@description Verify overlay replaces single-token skills, adds multi-token skills, and renders prompt lines.
    @returns None."""
    prof = profile_with_figures()
    tenure = skill_tenure.compute_tenure(prof, today=TODAY)
    py_rec = tenure["skills"].get("python") or {}
    nw_rec = tenure["skills"].get("sap-netweaver-java") or {}
    abap_rec = tenure["skills"].get("abap") or {}
    check("overlay sets Python years to 5 and source=='person'",
          py_rec.get("years") == 5 and py_rec.get("source") == "person")
    check("overlay adds multi-token 'SAP NetWeaver Java' with 7 years",
          nw_rec.get("years") == 7 and nw_rec.get("display") == "SAP NetWeaver Java"
          and nw_rec.get("source") == "person")
    check("overlay sets ABAP years to 16 and career_years to 24",
          abap_rec.get("years") == 16 and tenure.get("total_career_years") == 24
          and tenure.get("career_source") == "person")
    block = skill_tenure.prompt_block(tenure)
    check("prompt_block states 'ABAP: exactly 16 years (the person's own figure)'",
          "ABAP: exactly 16 years (the person's own figure)" in block)
    check("prompt_block includes YEARS THE PERSON CONFIRMED block",
          "YEARS THE PERSON CONFIRMED" in block
          and "- SAP NetWeaver Java: 7 years" in block
          and "- Total professional experience: 24 years" in block)


ENFORCE_CASES = [  # (as written, as it must read; None = left exactly as written); the person: profile_with_figures()
 ("Engineer with 2 years of Python and over 20 years of ABAP.", "Engineer with 5 years of Python and 16 years of ABAP."),
 ("16 years of Python and 12 years of ABAP", "5 years of Python and 16 years of ABAP"),
 ("7+ years of experience with SAP NetWeaver Java", "7 years of experience with SAP NetWeaver Java"),
 ("13 years of SAP NetWeaver Java. 13 years of Java.", "7 years of SAP NetWeaver Java. 12 years of Java."),
 ("12 years of Java", None),
 ("Senior SAP engineer with 2 years of experience.", "Senior SAP engineer with 24 years of experience."),
 ("Senior ABAP developer with 12 years of experience", "Senior ABAP developer with 16 years of experience"),
 ("Java developer with 24 years of experience", None),
 ("Java developer with 2 years of experience", "Java developer with 12 years of experience"),
 ("DevOps engineer with 22 years of professional experience", "DevOps engineer with 24 years of professional experience"),
 ("DevOps engineer with 5 years of professional experience", None),
 ("24 years of experience leading Java teams", None), ("2 years of experience leading Java teams", None),
 ("Over 20 years of experience in enterprise software, including 7 years of ABAP",
  "Over 20 years of experience in enterprise software, including 16 years of ABAP"),
 ("Java developer with 2 years of experience in fintech", None), ("5 years of experience in retail management", None),
 ("Led a 3-year migration program and a 2-year Java rewrite", None),
 ("12-year Java veteran", None), ("9-year Java veteran", "12-year Java veteran"), ("1-year Java veteran", "12-year Java veteran"),
 ("20-year career in software", "24-year career in software"),
 ("Joined 5 years ago; promoted in 3 years; reviewed every 2 years", None),
 ("Has led DevOps for 2 years", "Has led DevOps for 5 years"), ("Has led DevOps for 1 year", "Has led DevOps for 5 years"),
 ("Ran the lab for 2 years", None), ("Has led Java teams using Python for 2 years", None),
 ("Java (9 years)", "Java (12 years)"), ("SAP NetWeaver Java (11+ yrs)", "SAP NetWeaver Java (7 yrs)"), ("Java: 9 years", "Java: 12 years"),
 ("Python (1 year)", "Python (5 years)"), ("1 yr of Python", "5 yrs of Python"),
 ("Python - 2 yrs", "Python - 5 yrs"), ("Kubernetes (2 years)", None), ("2 years of Kubernetes", None),
 ("3 years of experience with Kubernetes", None),
 ("Total experience: 20 years", "Total experience: 24 years"), ("eleven years of ABAP", "16 years of ABAP"),
 ("20+ years' experience", "24 years' experience"), ("8-10 years of Java", None), ("Agile delivery (10 years)", None),
 ("10 years of stakeholder management", None), ("two decades of experience", None),
 ("16 years of Java and ABAP", None), ("13 years of Java and ABAP", "12 years of Java and ABAP"),
 ("over 16 years of ABAP", "16 years of ABAP"), ("2 years of experience", "24 years of experience"),
 ("Offers 2 years of professional experience.", "Offers 24 years of professional experience."),
 ("Offers 2 years of professional experience across SAP landscapes.", None),
 ("DevOps engineer with 2 years of total experience.", "DevOps engineer with 24 years of total experience."),
 ("9 years of server-side Java", "12 years of server-side Java"), ("9 years of integration and Java", None),
 ("9 years of building services in Java", None), ("20 years of large-scale SAP NetWeaver Java development", "7 years of large-scale SAP NetWeaver Java development"),
 ("12 years of Java, 7 years of SAP NetWeaver Java, 5 years of Python and 16 years of ABAP", None),
 ("Brings 2 years of hands-on experience in DevOps, Python and Jenkins.", "Brings 5 years of hands-on experience in DevOps, Python and Jenkins."),
]
ROLES_CAREER_CASES = [  # the same person with no total of their own: the roles' dates give 22 years (2004-06 to 2026-11)
 ("2 years of experience", "22 years of experience"), ("22 years of experience", None), ("23 years of experience", None),
 ("Senior SAP engineer with 2 years of experience.", "Senior SAP engineer with 22 years of experience."),
 ("over 20 years of experience", None), ("20+ years of experience", None), ("20 years of experience", "22 years of experience"),
 ("nearly 20 years of experience", "22 years of experience"), ("over 15 years of experience", "22 years of experience"),
 ("Java developer with 22 years of experience", None), ("Java developer with 2 years of experience", "Java developer with 12 years of experience"),
 ("DevOps engineer with 21 years of professional experience", "DevOps engineer with 22 years of professional experience"),
 ("5 years of experience in retail management", None), ("Java (9 years)", "Java (12 years)"),
]


def test_enforce_corrections() -> None:
    """@description The last pass states the person's own years in what is said of the person as a whole: low and
    high numbers are corrected, a project's length, a range, another skill and a role's bullet are left alone.
    @returns None."""
    prof = profile_with_figures()
    for text, want in ENFORCE_CASES:
        packet = {"resume": {"summary": text}}
        fixed, changes = years_truth.enforce(packet, prof)
        got = fixed["resume"]["summary"]
        expected = text if want is None else want
        check(f"enforce: {text!r}", got == expected, f"got {got!r}, want {expected!r}")
        check(f"enforce reports its change: {text!r}", bool(changes) == (want is not None), f"{changes}")
    bullets = {"resume": {"summary": "Engineer.", "experience": [{"bullets": ["2 years of Python automation at one employer"]}]}}
    fixed, changes = years_truth.enforce(bullets, prof)
    check("enforce leaves a role's bullets to the over-claim check", fixed == bullets and changes == [])
    cover = {"resume": {"summary": "x"}, "cover": {"paragraphs": ["I bring 2 years of experience and 9 years of ABAP."]}}
    fixed, changes = years_truth.enforce(cover, prof)
    check("enforce corrects the cover letter",
          fixed["cover"]["paragraphs"][0] == "I bring 24 years of experience and 16 years of ABAP.", f"{fixed['cover']}")
    check("enforce names what it changed",
          [c["skill"] for c in changes] == ["career", "ABAP"] and changes[0]["path"] == "cover.paragraphs.0", f"{changes}")
    listed = {"resume": {"skills": ["Java (9 years)", "SAP NetWeaver Java (11+ yrs)", "Kubernetes (2 years)"],
                         "headline": "Java Architect | 20+ years' experience"}}
    fixed, _ = years_truth.enforce(listed, prof)
    check("enforce corrects the skills list and headline",
          fixed["resume"]["skills"] == ["Java (12 years)", "SAP NetWeaver Java (7 yrs)", "Kubernetes (2 years)"]
          and fixed["resume"]["headline"] == "Java Architect | 24 years' experience", f"{fixed['resume']}")
    no_career = dict(prof)
    no_career.pop("career_years")
    for text, want in ROLES_CAREER_CASES:
        fixed, changes = years_truth.enforce({"resume": {"summary": text}}, no_career)
        expected = text if want is None else want
        check(f"roles' career total: {text!r}", fixed["resume"]["summary"] == expected and bool(changes) == (want is not None),
              f"got {fixed['resume']['summary']!r}, want {expected!r}")


def test_stated_overlay() -> None:
    """@description Verify stated_overlay populates claims_check.records() so term_years reflects person figures.
    @returns None."""
    prof = profile_with_figures()
    terms = claims_check.posting_terms("SAP ABAP & Python Architect", "Requires 16 years of ABAP and 5 years of Python.")
    rec = claims_check.records(prof, (), terms, TODAY)
    check("stated_overlay: term_years(rec, 'abap') >= 16", claims_check.term_years(rec, "abap") >= 16)
    check("stated_overlay: term_years(rec, 'python') >= 5", claims_check.term_years(rec, "python") >= 5)
    check("stated_overlay: career_years(rec) >= 24", claims_check.career_years(rec) >= 24)


def test_term_fidelity_restore() -> None:
    """@description Verify term_fidelity.restore fixes 'enslave' -> 'enclave' by neighbor context and skips false matches.
    @returns None."""
    prof = profile_with_figures()
    posting = {
        "title": "Cloud Enclave Architect",
        "description": "Design secure systems and modernise legacy workflows.",
    }
    packet = {
        "resume": {
            "experience": [
                {
                    "title": "Principal Platform Engineer",
                    "org": "Apex Cloud Systems",
                    "bullets": [
                        "Stood up the IL6 enslave for a made-up program.",
                        "We contact the vendor weekly.",
                        "Design secure systems and modernise legacy workflows.",
                    ],
                }
            ]
        },
        "cover": {
            "paragraphs": ["Stood up the IL6 enslave for a made-up program."]
        },
    }
    restored, changes = term_fidelity.restore(packet, prof, (), posting)
    r_bullets = restored["resume"]["experience"][0]["bullets"]
    c_para = restored["cover"]["paragraphs"][0]
    check("restore: 'enslave' restored to 'enclave' in resume bullet",
          r_bullets[0] == "Stood up the IL6 enclave for a made-up program.")
    check("restore: 'enslave' restored to 'enclave' in cover paragraph",
          c_para == "Stood up the IL6 enclave for a made-up program.")
    check("restore: 'We contact the vendor weekly.' untouched despite 'contract' in records",
          r_bullets[1] == "We contact the vendor weekly.")
    check("restore: posting words never changed",
          r_bullets[2] == "Design secure systems and modernise legacy workflows.")
    check("restore: reports exact changes",
          len(changes) == 2 and all(c["from"] == "enslave" and c["to"] == "enclave" for c in changes))


def test_term_fidelity_keeps_other_forms_of_a_word() -> None:
    """@description A different form of a recorded word (tense, plural) is that word, not a miswriting of it.
    @returns None."""
    prof = base_profile()
    prof["roles"][0]["bullets"].append("Manages platform teams across regions.")
    packet = {"resume": {"experience": [{"bullets": ["Managed platform teams across regions.",
                                                      "Stood up two IL6 enclaves for a made-up program."]}]}}
    restored, changes = term_fidelity.restore(packet, prof, (), {"title": "Engineer", "description": "Cloud work."})
    check("restore leaves 'Managed' (records hold 'Manages') and 'enclaves' (records hold 'enclave')",
          restored == packet and changes == [], f"{changes}")


def main() -> int:
    """@description Run all contract checks and emit JSON summary. @returns Exit code 0 or 1."""
    for fn in (
        test_without_person_figures,
        test_overlay_and_prompt_block,
        test_enforce_corrections,
        test_stated_overlay,
        test_term_fidelity_restore,
        test_term_fidelity_keeps_other_forms_of_a_word,
    ):
        try:
            fn()
        except Exception as err:
            check(f"{fn.__name__} raised {type(err).__name__}: {err}", False)
    failed = [name for name, ok in CHECKS if not ok]
    print(json.dumps({"checks": len(CHECKS), "failed": failed}))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
