# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.3 (Roger, 2026-11-16: "the system isnt using my most recent expierence to generate the resume"): the engine half of the current-role guard, on a made-up candidate whose current role is first with no end date and whose profile is longer than every limit suspected (the guided editor's 32,000 characters, the kernel's 65,536-byte agentic turn). The input builder carries the complete profile and lists the roles to carry, current first; the REAL generate_for and prepare_job, with only the model, the PDF renderer and (for generate_for) the posting row replaced, write a résumé that carries the current role first when the scripted model leaves it out, exactly as production's model did. Red on store main 82d67aa7/d28c8c02 (no ROLES TO CARRY block, the packet starts at the older employer), green with role_plan.
"""Current-role contract: the prompt names the roles to carry and every generated résumé carries them, most recent first."""
from __future__ import annotations

import copy
import datetime
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT / "engine"))
os.environ["JOBHUNTER_MULTIUSER"] = "1"
os.environ["JOBHUNTER_STORE"] = "sqlite"

from jobhunter import config, db, generate, prepare, profile, score  # noqa: E402

try:
    from jobhunter import role_plan  # noqa: E402
except ImportError:  # store main before 1.67.3: the checks below then fail instead of the import
    role_plan = None

CHECKS: list = []
TODAY = datetime.date(2026, 11, 16)
CURRENT = ("Co-Founder / Principal", "Harbor Light Systems")
FILLER = ("Directed a cross-team delivery program with measurable outcomes for reliability, cost and schedule, "
          "reporting to the executive staff and coordinating vendors, security reviews and release planning. ")


def check(name: str, condition) -> None:
    CHECKS.append((name, bool(condition)))


def _older(title, org, start, end, count):
    return {"title": title, "org": org, "start": start, "end": end, "employer": org,
            "deliverables": [f"{FILLER}Milestone {n} at {org}." for n in range(count)]}


def sample_profile() -> dict:
    """A made-up candidate shaped like the failing production profile: three roles added through Work history at the
    top (two current, no end), a long uploaded history below, and narrative sections that name only older employers."""
    roles = [
        {"id": "r13", "title": CURRENT[0], "org": CURRENT[1], "start": "2024-02", "end": None,
         "deliverables": ["Led the agentic platform build for the company", "Won two paying pilot customers in 2025"]},
        {"id": "r14", "title": "Board Advisor", "org": "North Pier Labs", "start": "2023-06", "end": None,
         "deliverables": ["Advised the founders on delivery and hiring"]},
        {"id": "r15", "title": "Program Director", "org": "Cedar Analytics", "start": "2022-01", "end": "2023-12",
         "deliverables": ["Ran a 40-person analytics program", "Cut reporting time by 30%"]},
        _older("Platform Director", "Bluewater Corp", "2018-03", "2021-12", 80),
        _older("Operations Manager", "Bluewater Corp", "2015-01", "2018-02", 60),
        _older("Systems Engineer", "Atlas Federal", "2011-05", "2014-12", 60),
        _older("Systems Analyst", "Atlas Federal", "2008-01", "2011-04", 50),
        _older("Support Lead", "Granite Health", "2006-01", "2007-12", 40),
        _older("Engineer", "Old Mill Co", "1998-06", "2003-09", 20),
    ]
    return {
        "profile": {"name": "Sample Candidate", "location": "Testville", "experience_summary": "Leads platform work at Bluewater Corp."},
        "roles": roles,
        "employers": [{"name": "Bluewater Corp", "note": "current employer"}, {"name": "Atlas Federal"}],
        "framing_notes": ["Currently leads platform delivery at Bluewater Corp.",
                          "Lantern, a personal agent-orchestration project, never appears on a résumé."],
        "oss_portfolio": {"name": "Lantern"},
        "skills": {"Cloud": {"items": ["AWS", "Terraform"]}},
    }


def model_answer(*, carried=False) -> dict:
    """What production's model wrote: the résumé starts at the older employer and leaves the three newest roles out."""
    experience = [
        {"title": "Platform Director", "org": "Bluewater Corp", "span": "2018 to 2021", "bullets": ["Led the platform org"]},
        {"title": "Operations Manager", "org": "Bluewater Corp", "span": "2015 to 2018", "bullets": ["Ran operations"]},
        {"title": "Systems Engineer", "org": "Atlas Federal", "span": "2008 to 2014", "bullets": ["Built systems"]},
        *([{"title": "Support Lead", "org": "Granite Health", "span": "2006 to 2007", "bullets": ["Led support"]}] if carried else []),
        {"title": "Early career", "org": "", "span": "", "bullets": ["Support and engineering roles"]},
    ]
    if carried:
        experience = [
            {"role": "R1", "title": CURRENT[0], "org": CURRENT[1], "span": "2024 to Present", "bullets": ["Won pilots"]},
            {"role": "R2", "title": "Board Advisor", "org": "North Pier Labs", "span": "2023 to Present", "bullets": ["Advised"]},
            {"role": "R3", "title": "Program Director", "org": "Cedar Analytics", "span": "2022 to 2023", "bullets": ["Ran it"]},
        ] + experience
    return {"resume": {"headline": "Platform leader", "summary": "Leads platforms.", "competencies": ["Delivery"],
                       "experience": experience, "skills": ["AWS"], "certifications": [], "education": [], "clearance": ""},
            "cover": {"greeting": "Dear Hiring Manager,", "paragraphs": ["Draft."], "closing": "Sincerely,"}}


def input_builder() -> None:
    """@description The prompt the model gets: the whole profile, and the roles to carry with the current role first."""
    prof = sample_profile()
    compact = json.dumps(generate._prep_profile(prof, False), ensure_ascii=False, separators=(",", ":"))
    check("the sample profile is longer than the kernel's 65,536-byte agentic turn and the editor's 32,000 cut",
          len(compact.encode("utf-8")) > 65_536)
    prompt = generate.build_prompt(prof, "Target Co", "Platform Director", "Remote", "Lead the platform. " * 40)
    check("the prompt carries the complete profile, current role included", compact in prompt)
    carry = prompt.split("ROLES TO CARRY", 1)[1] if "ROLES TO CARRY" in prompt else ""
    lines = [line for line in carry.splitlines() if line.startswith("- R")]
    check("the prompt lists the roles to carry", len(lines) == 8)
    check("the current role is listed first, marked current, its span to Present",
          bool(lines) and lines[0] == "- R1: Co-Founder / Principal | Harbor Light Systems | 2024 to Present | CURRENT ROLE")
    check("the second current role follows, then the newest ended role",
          [line.split(":")[0] for line in lines[:3]] == ["- R1", "- R2", "- R3"])
    check("a role that ended more than 20 years ago is not required", not any("Old Mill Co" in line for line in lines))
    reversed_prof = sample_profile()
    reversed_prof["roles"].reverse()
    order = [line.split("|")[0].split(":")[1].strip() for line in
             generate.build_prompt(reversed_prof, "T", "T", "R", "D").split("ROLES TO CARRY", 1)[-1].splitlines()
             if line.startswith("- R")]
    check("a profile listed oldest first still carries its roles most recent first",
          bool(order) and order[0] == CURRENT[0] and order.index("Program Director") < order.index("Platform Director"))


class _Result:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _Conn:
    """The posting row generate_for reads, and nothing else."""

    def execute(self, sql, params=()):
        if "FROM postings p JOIN companies" in sql:
            return _Result({"id": 7, "company_id": 1, "company": "Target Co", "title": "Platform Director",
                            "location": "Remote", "description": "Lead the platform. " * 60, "url": "https://example.invalid/7",
                            "ats_job_id": "REQ-7", "status": "new"})
        return _Result({"status": "new"} if "SELECT status FROM postings" in sql else None)

    def commit(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


def _run_generate(prof, answer, **kwargs):
    prompts = []

    def scripted(system, prompt, max_tokens=0, **_kw):
        prompts.append(prompt)
        if "DRAFT COVER" in prompt:
            return json.dumps({"greeting": "Dear Hiring Manager,", "paragraphs": ["Polished."], "closing": "Sincerely,"})
        return json.dumps(answer)

    with patch.object(profile, "load", return_value=prof), patch.object(generate.enrich, "provider", return_value="scripted"), \
            patch.object(generate.enrich, "complete", side_effect=scripted), patch.object(generate.db, "connect", _Conn), \
            patch.object(generate.db, "set_status", lambda *a, **k: None), patch.object(generate.db, "user_set", lambda *a, **k: None), \
            patch.object(generate, "_render_pdf", lambda html, pdf: pdf.write_bytes(b"%PDF-1.4 scripted")):
        result = generate.generate_for(7, **kwargs)
    outdir = Path(result["dir"])
    return json.loads((outdir / "application.json").read_text(encoding="utf-8")), outdir, prompts


def _titles(record):
    return [(e.get("title"), e.get("org")) for e in (record.get("generated") or {}).get("resume", {}).get("experience") or []]


def generation_restores() -> None:
    """@description The production failure shape: the model is given the current role and leaves it out."""
    record, outdir, prompts = _run_generate(sample_profile(), model_answer())
    check("the model was given the current role", bool(prompts) and CURRENT[0] in prompts[0] and CURRENT[1] in prompts[0])
    titles = _titles(record)
    check("the written résumé starts with the current role", bool(titles) and titles[0] == CURRENT)
    expected = [CURRENT, ("Board Advisor", "North Pier Labs"), ("Program Director", "Cedar Analytics"),
                ("Platform Director", "Bluewater Corp"), ("Operations Manager", "Bluewater Corp"),
                ("Systems Engineer", "Atlas Federal"), ("Support Lead", "Granite Health"), ("Early career", "")]
    check("every required role is carried, most recent first, the model's own entries kept", titles == expected)
    first = (record.get("generated") or {}).get("resume", {}).get("experience", [{}])[0]
    check("the restored current role runs to Present", first.get("span") == "2024 to Present")
    check("the restored role keeps only its recorded bullets, none naming the embargoed work",
          first.get("bullets") == ["Won two paying pilot customers in 2025"])
    receipt = record.get("roles_carried") or {}
    check("the packet records what the check restored", receipt.get("restored") == ["R1", "R2", "R3", "R8"])
    check("no role key reaches the packet's résumé", all("role" not in e for e in record["generated"]["resume"]["experience"]))
    html = (outdir / "Resume_ATS.html").read_text(encoding="utf-8")
    check("the rendered résumé document names the current role", CURRENT[0] in html and CURRENT[1] in html)


def generation_keeps_a_good_answer() -> None:
    """@description An answer that already carries every role in order is left as the model wrote it."""
    record, _outdir, _prompts = _run_generate(sample_profile(), model_answer(carried=True))
    receipt = record.get("roles_carried") or {}
    check("a complete answer restores nothing", receipt.get("restored") == [] and receipt.get("reordered") is False)
    check("a complete answer keeps the model's bullets", record["generated"]["resume"]["experience"][0]["bullets"] == ["Won pilots"])
    wrong = model_answer(carried=True)
    wrong["resume"]["experience"][0]["span"] = "2024 to 2025"
    moved = wrong["resume"]["experience"].pop(1)
    moved.pop("role")
    wrong["resume"]["additional_experience"] = [moved]
    record, _outdir, _prompts = _run_generate(sample_profile(), wrong, additional_experience=[
        {"id": "saved-portfolio", "title": "Lantern", "kind": "project"}])
    titles = _titles(record)
    check("a current role written with an end year runs to Present again",
          record["generated"]["resume"]["experience"][0]["span"] == "2024 to Present")
    check("a current role written under another section is moved back into experience",
          titles[:2] == [CURRENT, ("Board Advisor", "North Pier Labs")]
          and not record["generated"]["resume"].get("additional_experience"))


def prepare_restores() -> None:
    """@description Prepare application's engine path (prepare_job): real store, real scoring commit, scripted model."""
    with tempfile.TemporaryDirectory(prefix="career-roles-prepare-") as tmp:
        root = Path(tmp)
        saved = (config.DATA_DIR, config.CORPUS_DB, config.USER_DB, config.CAREER_DB, generate.APP_DIR)
        config.DATA_DIR, config.CORPUS_DB, config.USER_DB = root, root / "corpus.db", root / "user.db"
        config.CAREER_DB, generate.APP_DIR = root / "career_db.json", root / "applications"
        config.CAREER_DB.write_text(json.dumps(sample_profile()), encoding="utf-8")
        profile.load.cache_clear()
        try:
            with db.connect() as con:
                con.execute("INSERT INTO corpus.companies(id,name) VALUES(1,'Target Co')")
                con.execute("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,active,target_role) "
                            "VALUES(9,1,'9','Platform Director',?,1,1)", ("Lead the platform. " * 60,))
            scored = lambda row, _summary: {"id": row["id"], "data": {"fit_score": 81, "rationale": "Fit", "matched": [], "gaps": []}}
            with patch.object(prepare.render, "_chromium_binary", return_value="/scripted/chrome"), \
                    patch.object(score, "_score_one", side_effect=scored), \
                    patch.object(generate.enrich, "provider", return_value="scripted"), \
                    patch.object(generate.enrich, "complete", return_value=json.dumps(model_answer())), \
                    patch.object(generate, "_polish_cover", side_effect=lambda cover, *a, **k: cover), \
                    patch.object(generate, "_render_pdf", lambda html, pdf: pdf.write_bytes(b"%PDF-1.4 scripted")):
                result = prepare.prepare_job(9, documents=True, request_id="roles-9")
            check("preparation finishes ready", result.get("phase") == "ready")
            packets = list((root / "applications").glob("*__9/application.json"))
            record = json.loads(packets[0].read_text(encoding="utf-8")) if packets else {}
            check("the prepared résumé carries the current role first", _titles(record)[:1] == [CURRENT])
        finally:
            db._leave_portable()          # the engine's own exit step, run while the fixture store still exists
            db._portable_paths.clear()
            config.DATA_DIR, config.CORPUS_DB, config.USER_DB, config.CAREER_DB, generate.APP_DIR = saved
            profile.load.cache_clear()


def plan_rules() -> None:
    """@description Which roles are current and required, by the recorded dates alone."""
    check("role_plan exists", role_plan is not None)
    if role_plan is None:
        return
    entries = {e["title"]: e for e in role_plan.plan(sample_profile(), TODAY)}
    check("no end is current", entries[CURRENT[0]]["current"] and entries["Board Advisor"]["current"])
    check("an end of Present is current", role_plan.is_current({"end": "Present"}) and role_plan.is_current({"end": "current"}))
    check("a dated end is not current", not role_plan.is_current({"end": "2023-12"}))
    check("ended within 20 years is required, older is not",
          entries["Support Lead"]["required"] and not entries["Engineer"]["required"])
    check("dates read in the forms résumés use", role_plan.month("Mar 2019") == (2019, 3)
          and role_plan.month("03/2019") == (2019, 3) and role_plan.month("2019", last=True) == (2019, 12))


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="career-roles-") as packets:
        generate.APP_DIR = Path(packets) / "applications"
        for section in (plan_rules, input_builder, generation_restores, generation_keeps_a_good_answer, prepare_restores):
            try:
                section()
            except Exception as error:  # a section that cannot run is a failed check, never a silent pass
                check(f"{section.__name__} ran ({type(error).__name__}: {str(error)[:160]})", False)
    failed = [name for name, ok in CHECKS if not ok]
    print(json.dumps({"checks": len(CHECKS), "failed": failed}))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
