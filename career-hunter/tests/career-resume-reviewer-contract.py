# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.15: contract tests for ATS typography cleanliness (zero boldmetrics on Ed25519/ChaCha20-Poly1305/FIPS 140/NIST 800-53/2024/100/$82M across all three HTML templates, zero numeric '+' while preserving C++/Security+/A+), deterministic per-skill non-overlapping tenure math (skill_tenure), parenthetical year attribution & zero-'+' claims_fix, Lockheed-Martin contradiction reproduction & repair via the dynamically-loaded career-resume-reviewer Swarm bot, and needs_review escalation.
# 3 | maintainer@emeraldcoastsystemsgroup.com | 1.68.22: generate_for with the person's own years by skill states those years in the rendered résumé whatever the writer and the reviewer wrote, records the figures and corrections in application.json (years_truth), and restores a miswritten recorded term (term_fidelity).
# 4 | maintainer@emeraldcoastsystemsgroup.com | 1.68.23: the years case uses new made-up figures (12, 5 and 24).
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.68.17: verify skill_tenure counts start-of-title/line "Java" roles and structured engagement tech lists across multi-role spans.
# 5 | maintainer@emeraldcoastsystemsgroup.com | claims_fix._retime, which wrote a count worked out from the roles' dates over a years claim ("20+ years" became "11 years"), is gone; the check now proves the figure is taken out and no number written (claims_fix._untime).
"""Resume quality & career-resume-reviewer Swarm bot contract tests."""
from __future__ import annotations

import datetime
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT / "engine"))
os.environ["JOBHUNTER_MULTIUSER"] = "1"
os.environ["JOBHUNTER_STORE"] = "sqlite"

from jobhunter import claims_check, claims_fix, generate, profile, resume_review, role_plan, skill_tenure  # noqa: E402

CHECKS: list = []
TODAY = datetime.date(2026, 11, 19)
TITLE = "Senior Full-Stack Java & Python Cloud Engineer"
COMPANY = "Lockheed Martin"
DESCRIPTION = (
    "Build Java and Python microservices on Kubernetes with containerized CI/CD (GitLab, Argo CD), "
    "FIPS 140, NIST 800-53, and automated Playwright testing in DoD IL6 enclaves. C++ and Security+ are a plus. "
) * 3


def check(name: str, condition) -> None:
    CHECKS.append((name, bool(condition)))


def sample_profile() -> dict:
    """Made-up senior engineer profile mirroring overlapping roles + multi-era Java vs recent Python."""
    return {
        "profile": {
            "name": "Morgan Rivera",
            "location": "Pensacola, FL",
            "email": "morgan@example.invalid",
            "headline": "Program Manager / SRE Lead | Principal Solutions Architect",
            "experience_summary": "Technology leader across enterprise cloud, SRE, and Java/Python engineering.",
            "clearance": "Active U.S. DoD Secret",
        },
        "roles": [
            {"id": "r1", "title": "Co-Founder / Principal", "org": "Coastal Systems Group",
             "start": "2026-07", "end": None,
             "deliverables": ["Leads secure enclave delivery and architecture advisory"]},
            {"id": "r2", "title": "Program Manager / SRE Lead", "org": "Defense Cloud Corp",
             "start": "2024-10", "end": "2026-08",
             "deliverables": [
                 "Led a 50-person engineering org building containerized GitLab, Kubernetes, and Argo CD pipelines",
                 "Validated services against FIPS 140 and NIST 800-53 controls using Java and Python tooling",
             ],
             "skills": ["Kubernetes", "Python", "Java", "DevSecOps", "SRE", "C++"]},
            {"id": "r3", "title": "Principal Solutions Architect", "org": "Enterprise Cloud Inc",
             "start": "2018-01", "end": "2024-10",
             "deliverables": [
                 "Closed $82M in enterprise engagements delivering 100 customer workshops and 40 proposals",
             ],
             "skills": ["AWS", "Azure", "Enterprise Architecture"]},
            {"id": "r3b", "title": "Engineering Architect", "org": "Enterprise Cloud Inc",
             "start": "2011-06", "end": "2017-12",
             "deliverables": ["Led enterprise architecture engagements and cloud transformations"],
             "skills": ["Enterprise Architecture"]},
            {"id": "r4", "title": "Senior Technology Consultant", "org": "Enterprise Cloud Inc",
             "start": "2006-05", "end": "2011-06",
             "deliverables": ["Delivered enterprise Java/J2EE and ABAP integrations across global deployments"],
             "skills": ["Java", "J2EE", "ABAP"]},
            {"id": "r5", "title": "Lead Development Architect", "org": "Midwest Motors",
             "start": "2002", "end": "2006",
             "deliverables": ["Built Java/J2EE e-commerce portals and a 20-state warehouse barcoding rollout"],
             "skills": ["Java", "J2EE", "ABAP"]},
            {"id": "r6", "title": "Systems Administrator", "org": "Regional Manufacturing",
             "start": "2000", "end": "2002",
             "deliverables": ["Administered Linux and Windows Server infrastructure"],
             "skills": ["Linux"]},
        ],
        "skills": {
            "Languages": {"items": ["Java", "Python", "C++", "Rust", "TypeScript", "ABAP"]},
            "Certifications": {"items": ["CompTIA Security+", "CompTIA Network+", "CompTIA A+"]},
        },
        "additional_experience": [
            {"id": "saved-portfolio", "title": "Open Platform", "organization": "Independent R&D",
             "period": "2024 to Present",
             "facts": "Created a 34-crate Rust platform with 200 architecture decision records, Ed25519 and "
                      "ChaCha20-Poly1305 cryptography, Python automation, and Kubernetes (k3s) deployments.",
             "skills": ["Rust", "Python", "TypeScript", "Kubernetes"]},
        ],
    }


def test_templates_and_bold_stripping() -> None:
    """Zero <b> wrapping on Ed25519/ChaCha20-Poly1305/FIPS 140/NIST 800-53/2024/100/$82M across all 3 templates."""
    dirty_resume = {
        "headline": "**Program Manager** / <b>SRE Lead</b>",
        "summary": "Delivered **100+** workshops and <strong>$82M</strong> in 2024 with C++ and Security+.",
        "competencies": ["FIPS 140 & NIST 800-53", "<b>Java</b> & Python"],
        "skills": ["Languages: C++, g++, Java (9+ years), Python, COM+, Security+, Network+, CompTIA A+"],
        "certifications": ["CompTIA Security+", "CompTIA A+"],
        "education": ["MBA"],
        "clearance": "Active U.S. DoD Secret",
        "experience": [{
            "title": "Program Manager / SRE Lead", "org": "Defense Cloud Corp", "span": "Oct 2024 to Aug 2026",
            "bullets": [
                "Implemented Ed25519 and ChaCha20-Poly1305 cryptography with FIPS 140 and NIST 800-53 controls in 2024.",
                "Closed **$82M** in revenue across 100+ workshops, 40+ proposals, and <b>200+</b> architecture records.",
                "Drove $30M+ renewals, increased web revenue by 150%+, and led a 20+-state rollout with C++ and Security+.",
            ],
        }],
    }
    clean = resume_review.normalize_packet(dirty_resume)
    check("bold filter removed from Jinja environment", "boldmetrics" not in generate._env.filters)
    with tempfile.TemporaryDirectory(prefix="career-tpl-qa-") as tmp:
        out = Path(tmp)
        ctx = {"contact": sample_profile()["profile"], "company": COMPANY, "title": TITLE,
               "job_url": "https://example.invalid/1", "today": "November 19, 2026"}
        with patch.object(generate, "_render_pdf", lambda html, pdf: pdf.write_bytes(b"%PDF-1.4")):
            generate._packet_files(out, {"resume": clean, "cover": {"greeting": "Hi,", "paragraphs": ["Ok."], "closing": "Best,"}}, ctx)
        for name in ("Resume_ATS", "Resume_Premium", "Resume_1page"):
            html = (out / f"{name}.html").read_text(encoding="utf-8")
            bullets_html = "".join(re.findall(r"<li>.*?</li>", html, flags=re.S))
            check(f"{name}: zero <b> or <strong> inside bullets", "<b>" not in bullets_html and "<strong>" not in bullets_html)
            check(f"{name}: preserves Ed25519 & ChaCha20-Poly1305 intact",
                  "Ed25519" in bullets_html and "ChaCha20-Poly1305" in bullets_html)
            check(f"{name}: preserves FIPS 140, NIST 800-53, 2024, 100, $82M cleanly",
                  all(tok in html for tok in ("FIPS 140", "NIST 800-53", "2024", "100 workshops", "$82M")))
            check(f"{name}: zero markdown ** in HTML", "**" not in html)
            check(f"{name}: zero numeric + suffixes in HTML", not resume_review._AUDIT_NUMERIC_PLUS_RE.search(html))
            check(f"{name}: preserves C++, g++, Security+, Network+, A+, COM+",
                  all(tok in html for tok in ("C++", "Security+")) and "C++" in clean["skills"][0]
                  and "g++" in clean["skills"][0] and "Network+" in clean["skills"][0]
                  and "CompTIA A+" in clean["skills"][0] and "COM+" in clean["skills"][0])


def test_plus_normalization() -> None:
    """All numeric '+' suffixes become clean executive phrasing while tech/cert '+' names remain intact."""
    cases = [
        ("20+ years across cloud engineering", "Over 20 years across cloud engineering"),
        ("Leader with 20+ years of experience", "Leader with over 20 years of experience"),
        ("Java / J2EE (9+ years), Python (2+ years)", "Java / J2EE (9 years), Python (2 years)"),
        ("Delivered 100+ workshops and 40+ proposals", "Delivered 100 workshops and 40 proposals"),
        ("200+ architecture records and 1,400+ tests", "200 architecture records and 1,400 tests"),
        ("Drove $30M+ in renewals and 150%+ growth", "Drove over $30M in renewals and over 150% growth"),
        ("Increased web revenue by 150%+ in a 20+-state rollout", "Increased web revenue by over 150% in a 20-state rollout"),
        ("C++, g++, Objective-C++, Security+, Network+, CompTIA A+, COM+", "C++, g++, Objective-C++, Security+, Network+, CompTIA A+, COM+"),
    ]
    for src, expected in cases:
        got = resume_review.strip_numeric_plus(src)
        check(f"plus normalize: {src!r} -> {expected!r}", got == expected)


def test_skill_tenure_and_claims_fix() -> None:
    """Overlapping roles union cleanly without double-counting; parenthetical years bind backward; claims_fix writes no number of years."""
    prof = sample_profile()
    tenure = skill_tenure.compute_tenure(prof, prof["additional_experience"], today=TODAY)
    # 2000-01 to 2026-11 = 26y 11m (not double-counting overlaps in 2002, 2006, 2024-10, 2026-07..08)
    check("total career tenure unions overlapping roles accurately", 26 <= tenure["total_career_years"] <= 27)
    java_yrs = tenure["skills"]["java"]["years"]
    py_yrs = tenure["skills"]["python"]["years"]
    # Java: 2002-01..2011-06 (9.5y, overlapping 2006-05..12 NOT double-counted) + 2024-10..2026-08 (1.9y) = ~11.4y
    check("Java tenure unions overlapping 2002-2006 & 2006-05..2011-06 plus 2024-2026 (~11.4y)", 11.0 <= java_yrs <= 11.8)
    # Python: 2024-01..2026-11 (2.9y, overlapping 2024-10..2026-08 NOT double-counted)
    check("Python tenure unions 2024-Present without double-counting (~2.9y)", 2.5 <= py_yrs <= 3.2)
    block = skill_tenure.prompt_block(tenure, claims_check.posting_terms(TITLE, DESCRIPTION))
    check("prompt_block renders VERIFIED EXPERIENCE TENURE TABLE with Java and Python",
          "VERIFIED EXPERIENCE TENURE TABLE" in block and "Java:" in block and "Python:" in block)
    # Parenthetical skills bug fix: "Java / J2EE (9 years), Python" MUST check Java (11.4y -> ok), NOT Python (2.9y)!
    job = {"title": TITLE, "company": COMPANY, "terms": claims_check.posting_terms(TITLE, DESCRIPTION)}
    rec = claims_check.records(prof, prof["additional_experience"], job["terms"], TODAY)
    paren_check = claims_check.check(
        {"resume": {"skills": ["Languages: Java / J2EE (9 years), Python, Rust"]}, "cover": {}}, rec, job)
    check("parenthetical 'Java / J2EE (9 years), Python' binds to Java, never corrupted by Python", paren_check == [])
    # claims_fix writes no number of years: a figure the records do not add up to is taken out, '+' and all
    untimed = claims_fix._untime("Leader with 20+ years of Java", {"claim": "20+ years", "at": 12})
    check("claims_fix takes a years figure out and writes no number in its place", untimed == "Leader with Java")
    # Start-of-title "Java Developer", start-of-bullet "Java ...", and engagement tech: ["Java"] must all union cleanly.
    title_prof = {
        "roles": [
            {"title": "Platform Engineer", "org": "Recent Co", "start": "2024-09", "end": "2026-08",
             "bullets": ["Maintained services built in Java and Kubernetes."]},
            {"title": "Java Developer", "org": "Enterprise Co", "start": "2008-01", "end": "2014-12",
             "bullets": ["Built billing APIs.", "Java backend batch processing."]},
        ],
        "project_ledger": [
            {"project": "Bank Core", "role": "Consultant", "start": "2015-01", "end": "2017-01",
             "bullets": ["Modernized account ledger."], "tech": ["Java", "Spring"]},
        ],
    }
    title_tenure = skill_tenure.compute_tenure(title_prof, today=TODAY)
    check("Java start-of-title + engagement tech union reaches ~11y instead of 2y",
          10.5 <= title_tenure["skills"]["java"]["years"] <= 11.5)


def test_lockheed_contradiction_and_reviewer_bot() -> None:
    """Reproduce Lockheed-Martin 11+ vs 9+ contradiction and verify career-resume-reviewer catches, repairs, or escalates."""
    prof = sample_profile()
    contradictory = {
        "headline": "Program Manager / SRE Lead | Java & Python",
        "summary": (
            "Program Manager / SRE Lead with 11+ years across full-stack Java and Python software engineering "
            "and a proven track record delivering cloud enclaves. Led a 50-person team that cut MTTR by 61%. "
            "Combines 9+ years of hands-on Java/J2EE and Python development with 61% MTTR reduction."
        ),
        "competencies": ["Java/J2EE & Python", "Kubernetes & Argo CD"],
        "skills": ["Languages: Java / J2EE (2+ years), Python, C++, Security+"],
        "certifications": ["CompTIA Security+"],
        "education": ["MBA"],
        "clearance": "Active U.S. DoD Secret",
        "experience": [
            {"title": "Co-Founder / Principal", "org": "Coastal Systems Group", "span": "Jul 2026 to Present",
             "bullets": ["Leads secure enclave delivery and architecture advisory"]},
            {"title": "Program Manager / SRE Lead", "org": "Defense Cloud Corp", "span": "Oct 2024 to Aug 2026",
             "bullets": ["Led a 50-person engineering org building containerized GitLab, Kubernetes, and Argo CD pipelines."]},
        ],
    }
    tenure = skill_tenure.compute_tenure(prof, prof["additional_experience"], today=TODAY)
    job = {"title": TITLE, "company": COMPANY, "terms": claims_check.posting_terms(TITLE, DESCRIPTION)}
    rec = claims_check.records(prof, prof["additional_experience"], job["terms"], TODAY)
    issues = resume_review.audit_resume(contradictory, tenure, rec)
    kinds = {item["kind"] for item in issues}
    check("audit catches numeric '+' suffixes", "numeric_plus" in kinds)
    check("audit catches AI cliché ('proven track record')", "ai_cliche" in kinds)
    check("audit catches repeated summary stat ('61%')", "summary_repeated_stat" in kinds)
    check("audit catches cross-sentence/skills year contradiction (11 vs 9 vs 2)", "year_contradiction" in kinds)
    check("audit catches inflated Python tenure (11/9 vs 2.9y)", "skill_tenure_inflation" in kinds)

    clean_revised = {
        **contradictory,
        "summary": (
            "Program Manager and SRE Lead with over 25 years in enterprise technology leadership, including 11 years "
            "of Java/J2EE engineering and recent Python cloud automation. Directed a 50-person engineering organization "
            "delivering containerized GitLab, Kubernetes, and Argo CD pipelines across regulated DoD enclaves. "
            "Brings FIPS 140, NIST 800-53, and automated testing discipline to mission-critical cloud delivery."
        ),
        "skills": ["Languages: Java / J2EE (11 years), Python, C++, Security+"],
    }
    dispatched = []

    def bot_repairs(system, prompt, max_tokens=0, bot=None, **_kw):
        dispatched.append({"bot": bot, "system": system, "bytes": len(prompt.encode("utf-8")), "prompt": prompt})
        return json.dumps({
            "passed": False,
            "issues": ["Conflicting year claims for Java and Python across summary and skills.", "Banned cliché used."],
            "revised_resume": clean_revised,
            "reviewer_notes": "Rewrote summary and skills to remove year contradiction, '+' signs, and clichés.",
        })

    roles = role_plan.plan(prof, TODAY)
    data = {"resume": contradictory, "cover": {"greeting": "Dear Hiring Manager,", "paragraphs": ["Clean."], "closing": "Sincerely,"}}
    reviewed, receipt = resume_review.review_resume(
        data, prof, prof["additional_experience"], {"title": TITLE, "company": COMPANY, "description": DESCRIPTION},
        roles, (), [], today=TODAY, complete_fn=bot_repairs,
    )
    check("reviewer dispatches to dynamically-loaded career-resume-reviewer Swarm bot",
          len(dispatched) == 1 and dispatched[0]["bot"] == "career-resume-reviewer")
    check("reviewer prompt stays strictly under 64 KiB inline bot limit", dispatched[0]["bytes"] < 60000)
    check("multi-user mode delegates persona system prompt to oshald (empty system override)", dispatched[0]["system"] == "")
    check("reviewer receipt records passed, bot name, rubric_version 1.0.0, issues_found & issues_fixed",
          receipt["status"] == "passed" and receipt["bot"] == "career-resume-reviewer"
          and receipt["rubric_version"] == "1.0.0" and receipt["llm_reviewed"] is True
          and len(receipt["issues_found"]) >= 3 and len(receipt["issues_fixed"]) >= 3
          and receipt["remaining_issues"] == [])
    check("repaired resume has zero remaining audit issues",
          resume_review.audit_resume(reviewed["resume"], tenure, rec) == [])

    # Escalation to needs_review when bot cannot fix an unresolvable contradiction
    def bot_cannot_fix(system, prompt, max_tokens=0, bot=None, **_kw):
        return json.dumps({"passed": False, "issues": ["Unresolved year contradiction."], "revised_resume": None,
                           "reviewer_notes": "Could not safely resolve conflicting tenure."})

    _esc_data, esc_receipt = resume_review.review_resume(
        data, prof, prof["additional_experience"], {"title": TITLE, "company": COMPANY, "description": DESCRIPTION},
        roles, (), [], today=TODAY, complete_fn=bot_cannot_fix,
    )
    check("unfixable contradiction escalates to needs_review after 1 repair attempt",
          esc_receipt["status"] == "needs_review" and esc_receipt["attempts"] == 2 and bool(esc_receipt["remaining_issues"]))


class _Result:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _Conn:
    def execute(self, sql, params=()):
        if "FROM postings p JOIN companies" in sql:
            return _Result({"id": 42, "company_id": 1, "company": COMPANY, "title": TITLE, "location": "Remote",
                            "description": DESCRIPTION, "url": "https://example.invalid/42", "ats_job_id": "996477814774", "status": "new"})
        return _Result({"status": "new"} if "SELECT status FROM postings" in sql else None)

    def commit(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


def test_generate_for_end_to_end() -> None:
    """Real generate_for routes review to bot='career-resume-reviewer', persists resume_review, renders clean HTML."""
    prof = sample_profile()
    draft = {
        "resume": {
            "headline": "Program Manager / SRE Lead | Java & Python",
            "summary": "Program Manager / SRE Lead with 20+ years across Java and Python. Combines 9+ years of Java/J2EE and Python.",
            "competencies": ["Java/J2EE", "Python", "Kubernetes"],
            "skills": ["Java (9+ years)", "Python", "C++", "Security+"],
            "certifications": ["CompTIA Security+"],
            "education": ["MBA"],
            "clearance": "Active U.S. DoD Secret",
            "experience": [{
                "title": "Program Manager / SRE Lead", "org": "Defense Cloud Corp", "span": "Oct 2024 to Aug 2026",
                "bullets": ["Implemented Ed25519 and ChaCha20-Poly1305 with FIPS 140 and NIST 800-53 controls across 100+ workshops."],
            }],
        },
        "cover": {
            "greeting": "Dear Hiring Manager,",
            "paragraphs": [
                "This role aligns with my recent cloud engineering leadership at Defense Cloud Corp.",
                "At Defense Cloud Corp I led a 50-person engineering org delivering Kubernetes and Argo CD pipelines with FIPS 140 controls.",
                "I would welcome a conversation about how this delivery discipline fits your enclave roadmap.",
            ],
            "closing": "Sincerely,",
        },
    }
    clean_resume = {
        **draft["resume"],
        "summary": (
            "Program Manager and SRE Lead with over 25 years in enterprise technology leadership, including 11 years "
            "of Java/J2EE engineering and recent Python cloud automation. Directed a 50-person engineering team "
            "delivering Kubernetes and Argo CD pipelines validated against FIPS 140 and NIST 800-53 controls."
        ),
        "skills": ["Java (11 years)", "Python", "C++", "Security+"],
    }
    bots_seen = []

    def scripted(system, prompt, max_tokens=0, bot=None, **_kw):
        bots_seen.append(bot)
        if bot == "career-resume-reviewer":
            return json.dumps({"passed": False, "issues": ["Fixed year contradiction and '+' suffixes."],
                               "revised_resume": clean_resume, "reviewer_notes": "Clean executive resume approved."})
        if "DRAFT COVER" in prompt:
            return json.dumps(draft["cover"])
        return json.dumps(draft)

    with tempfile.TemporaryDirectory(prefix="career-e2e-rev-") as tmp:
        saved_app_dir = generate.APP_DIR
        generate.APP_DIR = Path(tmp) / "applications"
        try:
            with patch.object(profile, "load", return_value=prof), \
                    patch.object(generate.enrich, "provider", return_value="scripted"), \
                    patch.object(generate.enrich, "complete", side_effect=scripted), \
                    patch.object(generate.db, "connect", _Conn), \
                    patch.object(generate.db, "set_status", lambda *a, **k: None), \
                    patch.object(generate.db, "user_set", lambda *a, **k: None), \
                    patch.object(generate, "_render_pdf", lambda html, pdf: pdf.write_bytes(b"%PDF-1.4")):
                result = generate.generate_for(42)
            outdir = Path(result["dir"])
            app_json = json.loads((outdir / "application.json").read_text(encoding="utf-8"))
            html = (outdir / "Resume_ATS.html").read_text(encoding="utf-8")
            check("generate_for invoked career-resume-reviewer Swarm bot", "career-resume-reviewer" in bots_seen)
            check("application.json persists structured resume_review receipt",
                  (app_json.get("resume_review") or {}).get("status") == "passed"
                  and (app_json.get("resume_review") or {}).get("bot") == "career-resume-reviewer"
                  and bool((app_json.get("resume_review") or {}).get("skill_tenure")))
            check("final Resume_ATS.html has zero <b> numbers, zero numeric '+', preserves Ed25519/C++/Security+",
                  "Ed25519" in html and "Ed2<b>5519</b>" not in html and "C++" in html and "Security+" in html
                  and not resume_review._AUDIT_NUMERIC_PLUS_RE.search(html))
        finally:
            generate.APP_DIR = saved_app_dir


def test_generate_for_states_the_persons_own_years() -> None:
    """Real generate_for with the person's own years by skill: whatever the writer and the reviewer wrote, the packet
    states those years, application.json says what was corrected, and a miswritten recorded term is restored."""
    def note(name, condition, detail=""):
        check(name if condition else f"{name} :: {detail}", condition)

    prof = sample_profile()
    prof["years_by_skill"] = [{"skill": "Java", "years": 12}, {"skill": "Python", "years": 5}]
    prof["career_years"] = 24
    prof["roles"][0].setdefault("deliverables", []).append("Stood up the secure enclave for a made-up program")
    wrong = {
        "headline": "Program Manager / SRE Lead | Java & Python",
        "summary": ("Program Manager and SRE Lead with 2 years of experience. Brings 9 years of Java engineering "
                    "and 2 years of Python automation."),
        "competencies": ["Java/J2EE", "Python"],
        "skills": ["Java (9 years)", "Python (2 years)", "C++"],
        "certifications": ["CompTIA Security+"], "education": ["MBA"], "clearance": "Active U.S. DoD Secret",
        "experience": [{"title": "Program Manager / SRE Lead", "org": "Defense Cloud Corp", "span": "Oct 2024 to Aug 2026",
                        "bullets": ["Stood up the secure enslave for a made-up program"]}],
    }
    cover = {"greeting": "Dear Hiring Manager,", "closing": "Sincerely,",
             "paragraphs": ["This role aligns with my recent cloud engineering leadership at Defense Cloud Corp.",
                            "At Defense Cloud Corp I led engineering delivery of Kubernetes pipelines.",
                            "I would welcome a conversation about your roadmap."]}

    def scripted(system, prompt, max_tokens=0, bot=None, **_kw):
        if bot == "career-resume-reviewer":
            return json.dumps({"passed": True, "issues": [], "revised_resume": wrong, "reviewer_notes": "ok"})
        return json.dumps(cover if "DRAFT COVER" in prompt else {"resume": wrong, "cover": cover})

    with tempfile.TemporaryDirectory(prefix="career-e2e-years-") as tmp:
        saved_app_dir = generate.APP_DIR
        generate.APP_DIR = Path(tmp) / "applications"
        try:
            with patch.object(profile, "load", return_value=prof), \
                    patch.object(generate.enrich, "provider", return_value="scripted"), \
                    patch.object(generate.enrich, "complete", side_effect=scripted), \
                    patch.object(generate.db, "connect", _Conn), \
                    patch.object(generate.db, "set_status", lambda *a, **k: None), \
                    patch.object(generate.db, "user_set", lambda *a, **k: None), \
                    patch.object(generate, "_render_pdf", lambda html, pdf: pdf.write_bytes(b"%PDF-1.4")):
                result = generate.generate_for(42)
            outdir = Path(result["dir"])
            app_json = json.loads((outdir / "application.json").read_text(encoding="utf-8"))
            html = (outdir / "Resume_ATS.html").read_text(encoding="utf-8")
            text = re.sub(r"<[^>]+>", " ", html)
            years = sorted(set(re.findall(r"\b(\d+) years", text)))
            note("the rendered résumé states only the person's own years", years == ["12", "24", "5"], f"{years}")
            note("the rendered résumé says 24 years of experience, 12 of Java and 5 of Python",
                  "24 years of experience" in text and "12 years of Java" in text and "5 years of Python" in text
                  and "Java (12 years)" in text and "Python (5 years)" in text, text[:600])
            receipt = app_json.get("years_truth") or {}
            note("application.json records the figures used and each correction",
                  receipt.get("career_source") == "person" and len(receipt.get("corrected") or []) >= 5
                  and any(row.get("source") == "person" and row.get("skill") == "Java" for row in receipt.get("figures") or []),
                  json.dumps(receipt)[:400])
            note("a miswritten recorded term is restored and recorded",
                  "secure enclave" in text and "enslave" not in text
                  and any(row.get("to") == "enclave" for row in app_json.get("term_fidelity") or []),
                  json.dumps(app_json.get("term_fidelity"))[:300])
        finally:
            generate.APP_DIR = saved_app_dir


def main() -> int:
    for fn in (test_templates_and_bold_stripping, test_plus_normalization,
               test_skill_tenure_and_claims_fix, test_lockheed_contradiction_and_reviewer_bot,
               test_generate_for_end_to_end, test_generate_for_states_the_persons_own_years):
        try:
            fn()
        except Exception as err:
            check(f"{fn.__name__} raised {type(err).__name__}: {err}", False)
    failed = [name for name, ok in CHECKS if not ok]
    print(json.dumps({"checks": len(CHECKS), "failed": failed}))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
