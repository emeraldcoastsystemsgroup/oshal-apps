# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.5 (Roger, 2026-11-16: "my cover letter pulls from my first development job ... and lies about my level of expertise on c# ... we ironed all of these problems previously and they just keep coming back"): the engine half of the letter-truth guard, on a made-up long-form candidate (eight short field-contracting engagements in the last four years, a program role, and a first development job that used C# once). (1) letter_evidence ranks the field engagements that fit a controls posting above the first job, also when they are recorded as engagements, and still picks the first job when only it fits. (2) The prompts carry that evidence, the editor no longer reaches into "an EARLIER role", and every anti-inflation rule that held letters before is still in the prompts without any prompt_framing (guards for the earlier fixes). (3) claims_check catches an unstated C# level, a skill the records never name, inflated years, a title and an employer the records do not hold, a tool under the wrong job and a sentence drawn from the first job, and finds nothing in an honest packet. (4) The REAL generate_for and prepare_job, with only the model, the PDF renderer and the posting row replaced, hold a scripted model that overclaims as production's did: the letter is written again once with the problems named, or marked needs your review, and the documents on disk claim nothing the records do not support. Red on store main dd5cd9ed (no letter_evidence, claims_check or claims_fix; the editor's EARLIER-role rule), green here.
"""Letter-truth contract: Career's letters and résumés claim only what the records support, from the right roles."""
from __future__ import annotations

import copy
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

try:  # store main before 1.68.5 has none of these: the checks below then fail instead of the import
    from jobhunter import claims_check, claims_fix, letter_evidence  # noqa: E402
except ImportError:
    claims_check = claims_fix = letter_evidence = None

CHECKS: list = []
TITLE, COMPANY = "Senior Controls Engineer", "Target Utilities"
DESCRIPTION = ("You will build SCADA integrations, extend our Ignition HMI, read PLC data, script in Python and commission "
               "systems in the field. C# and .NET services are a plus, as is Azure. ") * 4
FIELD = [  # eight short field-contracting engagements, newest first
    ("Field Automation Engineer (contract)", "Gulf Coast Refining", "2025-06", "2025-10",
     ["Commissioned PLC and SCADA upgrades across three refinery units", "Wrote Python scripts that validated Modbus tag maps before cutover"], ["PLC", "SCADA", "Python"]),
    ("Field Systems Engineer (contract)", "Bayou Water Authority", "2025-01", "2025-05",
     ["Migrated 40 pump stations to a new SCADA historian", "Built Grafana dashboards for operators"], ["SCADA", "Grafana"]),
    ("Controls Integration Contractor", "Delta Grain Terminals", "2024-08", "2024-12",
     ["Integrated conveyor PLCs with an Ignition HMI", "Trained the night shift on the new screens"], ["PLC", "Ignition", "HMI"]),
    ("Field Network Engineer (contract)", "Pine Ridge Utilities", "2024-02", "2024-07", ["Rebuilt substation networks on Cisco switches"], ["Cisco"]),
    ("SCADA Contractor", "Magnolia Pipeline", "2023-07", "2024-01", ["Rationalized 3,000 pipeline alarms with operations"], ["SCADA"]),
    ("Field Engineer (contract)", "Coastal Power Coop", "2023-01", "2023-06", ["Upgraded relay settings at six substations"], ["Relays"]),
    ("Automation Technician (contract)", "Sunbelt Packaging", "2022-07", "2022-12", ["Replaced packaging line PLC programs during a shutdown"], ["PLC"]),
    ("Field Service Contractor", "Redfish Marine", "2022-01", "2022-06", ["Serviced vessel navigation electronics at three ports"], ["Marine electronics"]),
]
FIRST_JOB = ("Software Developer", "Old Mill Software")


def check(name: str, condition) -> None:
    CHECKS.append((name, bool(condition)))


def _field_rows():
    return [{"title": t, "org": o, "start": s, "end": e, "deliverables": list(d), "skills": list(k)} for t, o, s, e, d, k in FIELD]


def sample_profile(engagements: bool = False) -> dict:
    """A made-up long-form candidate; with engagements=True the field work is recorded as client engagements in the
    main résumé's project_ledger (dated, as Work history writes them from 1.68.4), not as roles."""
    roles = [{"id": "r1", "title": "Principal", "org": "Harbor Light Systems", "start": "2026-01", "end": None,
              "deliverables": ["Leads delivery for two pilot customers"]}]
    roles += [] if engagements else _field_rows()
    roles += [{"title": "Program Manager / SRE Lead", "org": "Bluewater Corp", "start": "2014-01", "end": "2021-12",
               "deliverables": ["Led a 40-person SRE organization", "Ran Azure migrations for 120 services"], "skills": ["Azure", "Kubernetes", "Terraform"]},
              {"title": "Systems Analyst", "org": "Atlas Federal", "start": "2006-01", "end": "2013-12",
               "deliverables": ["Analyzed logistics systems for federal programs"], "skills": ["SQL"]},
              {"title": FIRST_JOB[0], "org": FIRST_JOB[1], "start": "2000-06", "end": "2002-05",
               "deliverables": ["Wrote desktop inventory tools in Visual Basic for a regional bank", "Maintained a small C# utility for the bank's tellers"],
               "skills": ["C#", "Visual Basic", "SQL Server"]}]
    prof = {"profile": {"name": "Sample Candidate", "location": "Testville", "headline": "Field Automation and SCADA Engineer",
                        "experience_summary": "Field automation engineer who commissions SCADA and PLC systems on short contracts."},
            "roles": roles, "skills": {"Automation": {"items": ["PLC", "SCADA", "Ignition", "Python"]}, "Cloud": {"items": ["Azure", "Terraform"]}},
            "framing_notes": ["Never claim expert C#; it was one small utility long ago."], "gaps_to_collect": ["C# services at scale"]}
    if engagements:
        prof["project_ledger"] = [{"project": o, "role": t, "industry": "Utilities", "duration_months": 4, "tech": list(k),
                                   "public": True, "start": s, "end": e, "bullets": list(d)} for t, o, s, e, d, k in FIELD]
    return prof


OVERCLAIM_LETTER = {"greeting": "Dear Hiring Manager,", "paragraphs": [
    "As an expert C# developer with 15 years of C# experience, I was excited to see this role. My first development job at Old Mill Software taught me to love building C# tools.",
    "At Bluewater Corp I built C# services and brought deep Kubernetes expertise to a 40-person SRE organization. Most recently I commissioned PLC and SCADA upgrades across three refinery units at Gulf Coast Refining.",
    "As a Principal Controls Architect, I would bring that field discipline to your team. I would welcome a conversation."], "closing": "Sincerely,"}
HONEST_LETTER = {"greeting": "Dear Hiring Manager,", "paragraphs": [
    "The Senior Controls Engineer role is the field work I do every week. Most recently I commissioned PLC and SCADA upgrades across three refinery units at Gulf Coast Refining and wrote Python scripts that validated Modbus tag maps before cutover.",
    "At Delta Grain Terminals I integrated conveyor PLCs with an Ignition HMI and trained the night shift on the new screens. At Bayou Water Authority I migrated 40 pump stations to a new SCADA historian and built Grafana dashboards for operators.",
    "I would bring that field discipline to your SCADA integrations, along with experience with Azure. Could we talk about what your team needs first?"], "closing": "Sincerely,"}


def model_resume(*, honest: bool) -> dict:
    experience = [
        {"title": "Principal", "org": "Harbor Light Systems", "span": "2026 to Present", "bullets": ["Leads delivery for two pilot customers"]},
        {"title": "Field Automation Engineer (contract)" if honest else "Lead SCADA Architect", "org": "Gulf Coast Refining", "span": "2025",
         "bullets": ["Commissioned PLC and SCADA upgrades across three refinery units"] + ([] if honest else ["Built C# services for PLC data"])},
        {"title": "Program Manager / SRE Lead", "org": "Bluewater Corp", "span": "2014 to 2021",
         "bullets": ["Led a 40-person SRE organization"] + ([] if honest else ["Wrote Rust microservices on Kubernetes"])},
    ]
    if not honest:
        experience.append({"title": "Chief Engineer", "org": "Acme Rockets", "span": "2010 to 2012", "bullets": ["Built rockets"]})
    return {"headline": "Field Automation and SCADA Engineer" if honest else "Senior C# Controls Engineer",
            "summary": ("Field automation engineer with over 20 years of experience who commissions SCADA and PLC systems."
                        if honest else "Expert C# developer with 15+ years of C# experience. Commissions SCADA systems in the field."),
            "competencies": ["SCADA integration", "PLC commissioning", "Ignition HMI"] + ([] if honest else ["Expert C# Development", "Rust"]),
            "experience": experience, "skills": ["SCADA", "PLC", "Python", "Azure"] + ([] if honest else ["Rust"]),
            "certifications": [], "education": [], "clearance": ""}


def ranking() -> None:
    """@description Which recorded work a letter draws on, by relevance to the posting and recency."""
    check("letter_evidence exists", letter_evidence is not None)
    if letter_evidence is None:
        return
    ranked = letter_evidence.rank(sample_profile(), TITLE, DESCRIPTION)
    chosen = [row for row in ranked if row["chosen"]]
    orgs = [row["org"] for row in ranked]
    check("the field engagements that fit the posting are chosen",
          {"Gulf Coast Refining", "Delta Grain Terminals", "Bayou Water Authority"} <= {row["org"] for row in chosen})
    check("the first development job is not chosen for a controls posting", FIRST_JOB[1] not in {row["org"] for row in chosen})
    check("the first development job ranks below every chosen field engagement",
          all(orgs.index(FIRST_JOB[1]) > orgs.index(org) for org in ("Gulf Coast Refining", "Delta Grain Terminals", "Bayou Water Authority")))
    reversed_prof = sample_profile()
    reversed_prof["roles"].reverse()
    again = {row["org"] for row in letter_evidence.rank(reversed_prof, TITLE, DESCRIPTION) if row["chosen"]}
    check("a profile listed oldest first chooses the same work", again == {row["org"] for row in chosen})
    recorded = letter_evidence.rank(sample_profile(engagements=True), TITLE, DESCRIPTION)
    picks = [row for row in recorded if row["chosen"]]
    check("engagements recorded in the project ledger are ranked and chosen when they fit",
          sum(1 for row in picks if row["key"].startswith("E")) >= 3 and FIRST_JOB[1] not in {row["org"] for row in picks})
    undated = sample_profile(engagements=True)
    for row in undated["project_ledger"]:
        row.pop("start"), row.pop("end")
    undated["roles"].insert(1, {"id": "r9", "title": "Field Consultant", "org": "Sample Field Services", "start": "2022-01", "end": "2025-10",
                                "deliverables": ["Commissioned controls for Gulf Coast Refining and Delta Grain Terminals"]})
    dated = {row["org"]: row for row in letter_evidence.rank(undated, TITLE, DESCRIPTION)}
    check("an undated engagement whose client a job's record names takes that job's dates",
          dated["Gulf Coast Refining"]["span"] == "2022 to 2025" and dated["Bayou Water Authority"]["recency"] == letter_evidence.UNDATED_RECENCY)
    ledger = undated["project_ledger"]   # the fields Work history writes from 1.68.4: start/end months, length, job
    ledger[1]["job"] = "r9"
    ledger[2].update({"start": "2024-08", "duration_months": 4})
    ledger.append("Plain Text Client")
    placed = {row["org"]: row for row in letter_evidence.entries(undated)}
    check("an engagement placed under a job (its id) takes that job's dates, one with a start and a length ends after it",
          (placed["Bayou Water Authority"]["start"], placed["Bayou Water Authority"]["end"]) == ("2022-01", "2025-10")
          and (placed["Delta Grain Terminals"]["end"], placed["Delta Grain Terminals"]["current"]) == ("2024-12", False))
    check("a ledger entry saved as plain text is an engagement keyed by its place",
          placed["Plain Text Client"]["key"] == f"E{len(ledger)}" and placed["Plain Text Client"]["undated"])
    hidden = sample_profile()
    hidden["roles"][-1]["public"] = False
    only_old = letter_evidence.rank(hidden, "Visual Basic Developer", "Maintain Visual Basic desktop inventory tools for a bank. " * 3)
    check("a role the person marked not public is never chosen, even when only it fits",
          not any(row["chosen"] and row["org"] == FIRST_JOB[1] for row in only_old))
    old_only = letter_evidence.rank(sample_profile(), "Visual Basic Developer", "Maintain Visual Basic desktop inventory tools for a bank. " * 3)
    check("when only the first job fits the posting it is chosen (relevance, not a ban)",
          bool(old_only) and old_only[0]["org"] == FIRST_JOB[1] and old_only[0]["chosen"])
    block = letter_evidence.prompt_block(ranked)
    check("the evidence block lists the chosen engagements and not the first job",
          "COVER LETTER EVIDENCE" in block and "Gulf Coast Refining" in block and FIRST_JOB[1] not in block)


def prompts() -> None:
    """@description The prompts carry the evidence, and every rule that held letters before still reaches the model."""
    prof = sample_profile()
    prompt = generate.build_prompt(prof, COMPANY, TITLE, "Remote", DESCRIPTION)
    check("the generation prompt carries the cover letter's evidence", "COVER LETTER EVIDENCE" in prompt)
    evidence = prompt.split("COVER LETTER EVIDENCE", 1)[-1]
    check("the evidence names the field engagements and not the first job",
          "Delta Grain Terminals" in evidence and FIRST_JOB[1] not in evidence.split("The cover letter's proof points", 1)[0])
    check("the roles to carry still come before the evidence", prompt.find("ROLES TO CARRY") < prompt.find("COVER LETTER EVIDENCE"))
    check("the evidence states the level and years rule",
          "never expert, advanced, deep, extensive, strong or senior" in evidence and "years only as the recorded dates add up" in evidence)
    storied = sample_profile()
    storied["roles"][2]["stories"] = [{"title": "Night cutover", "story": "We cut over 40 stations in one night.", "bullet": "Migrated 40 pump stations"}]
    check("the story evidence stays last", generate.build_prompt(storied, COMPANY, TITLE, "Remote", DESCRIPTION).endswith(generate.story_evidence_suffix(storied)))
    editor = generate.build_editor_system(prof)
    check("the cover editor no longer reaches into an EARLIER role", "even when it lives in an EARLIER role" not in editor)
    check("the cover editor draws only on the evidence", "ONLY from the COVER LETTER EVIDENCE" in editor)
    system = generate.build_system(prof)   # no prompt_framing: the rules that held letters before must still be here
    for rule in ("never invent employers, titles, dates, metrics, or skills", "MIRRORING LIMIT", "is NOT permission to claim it",
                 "never inflate", "TITLES (hard rule)", "REFERRALS/CONTACTS (hard rule)"):
        check(f"the system prompt still carries: {rule}", rule in system)
    check("the template still keeps every accomplishment with its role", "ATTRIBUTION (critical)" in generate.PROMPT
          and "NEVER blend or cross-attribute" in generate.PROMPT)
    check("the editor still adds no fact", "do NOT invent or add any metric, technology, title, employer, certification, or claim" in editor)


def _context(prof):
    job = {"title": TITLE, "company": COMPANY, "terms": claims_check.posting_terms(TITLE, DESCRIPTION)}
    return claims_check.records(prof, (), job["terms"]), job, letter_evidence.rank(prof, TITLE, DESCRIPTION)


def _kinds(problems):
    return {(p["kind"], str(p.get("claim") or "")) for p in problems}


def claims() -> None:
    """@description What claims_check finds, claim by claim, and what it leaves alone."""
    check("claims_check and claims_fix exist", claims_check is not None and claims_fix is not None)
    if claims_check is None:
        return
    rec, job, ranked = _context(sample_profile())
    found = claims_check.check({"resume": model_resume(honest=False), "cover": OVERCLAIM_LETTER}, rec, job, ranked)
    kinds = {kind for kind, _claim in _kinds(found)}
    check("an expert C# claim is caught when the records name C# without a level",
          any(p["kind"] == "level" and p.get("term") == "csharp" for p in found))
    check("years the dates do not add up to are caught", any(p["kind"] == "years" and p.get("supported") == 2 for p in found))
    check("a title the records do not hold is caught", ("title", "Principal Controls Architect") in _kinds(found))
    check("C# put under a job whose records do not name it is caught", any(p["kind"] == "attribution" and p.get("term") == "csharp" for p in found))
    check("a letter sentence drawn from the first job is caught", any(p["kind"] == "evidence" and FIRST_JOB[1] in p["claim"] for p in found))
    stale = claims_check.check({"resume": {}, "cover": {"paragraphs": ["I also bring hands-on experience with C# services."]}}, rec, job, ranked)
    check("a letter naming C#, which only the first job records, is caught as drawing on that job",
          any(p["kind"] == "evidence" and p.get("term") == "csharp" and FIRST_JOB[1] in p.get("where", "") for p in stale))
    check("a tool the records never name is caught", ("skill", "Rust") in _kinds(found))
    check("an employer the records do not hold is caught", any(p["kind"] == "title" and p.get("employer") is False for p in found))
    check("a résumé title the records do not give that job is caught",
          any(p["kind"] == "title" and p.get("recorded") == "Field Automation Engineer (contract)" for p in found))
    check("every kind of problem is found", {"level", "years", "title", "attribution", "evidence", "skill"} <= kinds)
    honest = claims_check.check({"resume": model_resume(honest=True), "cover": HONEST_LETTER}, rec, job, ranked)
    check("an honest packet has no problems", honest == [])
    no_csharp = sample_profile()
    no_csharp["roles"][-1]["deliverables"], no_csharp["roles"][-1]["skills"] = ["Wrote desktop inventory tools in Visual Basic"], ["Visual Basic"]
    rec2, job2, ranked2 = _context(no_csharp)
    modest = {"paragraphs": ["I would bring that field discipline to your team, along with experience with C# and Azure."]}
    flagged = claims_check.check({"resume": {}, "cover": modest}, rec2, job2, ranked2)
    check("C# the records never name is caught even in a modest sentence", any(p["kind"] == "skill" and p["claim"] == "C#" for p in flagged))
    stated = sample_profile()
    stated["skills"]["Automation"]["items"].append("SCADA (expert)")
    rec3, job3, ranked3 = _context(stated)
    sentence = {"resume": {}, "cover": {"paragraphs": ["I am an expert in SCADA and commissioned PLC and SCADA upgrades at Gulf Coast Refining."]}}
    check("a level the records state is kept", not any(p["kind"] == "level" for p in claims_check.check(sentence, rec3, job3, ranked3)))
    toned = claims_fix._tone_term("I am an expert in C# and Azure.", "csharp")
    check("a level is toned down to what the records say", toned.startswith("I am experienced with C#"))
    listed = {"resume": {"skills": ["Cloud: Azure, Terraform, Rust"]}, "cover": {}}
    trimmed, _actions = claims_fix.fix(listed, claims_check.check(listed, rec, job, ranked), rec, job,
                                       claims_check.allowed(rec, ranked), sample_profile())
    check("a listed skills item loses only the tool the records never name", trimmed["resume"]["skills"] == ["Cloud: Azure, Terraform"])


class _Result:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _Conn:
    """The posting row generate_for reads, and nothing else."""

    def execute(self, sql, params=()):
        if "FROM postings p JOIN companies" in sql:
            return _Result({"id": 7, "company_id": 1, "company": COMPANY, "title": TITLE, "location": "Remote",
                            "description": DESCRIPTION, "url": "https://example.invalid/7", "ats_job_id": "REQ-7", "status": "new"})
        return _Result({"status": "new"} if "SELECT status FROM postings" in sql else None)

    def commit(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


def _scripted(draft, polished, rewritten, calls):
    def complete(system, prompt, max_tokens=0, **_kw):
        if "PROBLEMS CAREER FOUND" in prompt:
            calls.append(("rewrite", prompt))
            return json.dumps(rewritten) if rewritten is not None else "not json"
        if "DRAFT COVER" in prompt:
            calls.append(("editor", prompt))
            return json.dumps(polished)
        calls.append(("generate", prompt))
        return json.dumps(draft)
    return complete


def _run_generate(prof, draft, polished, rewritten):
    calls = []
    with patch.object(profile, "load", return_value=prof), patch.object(generate.enrich, "provider", return_value="scripted"), \
            patch.object(generate.enrich, "complete", side_effect=_scripted(draft, polished, rewritten, calls)), \
            patch.object(generate.db, "connect", _Conn), patch.object(generate.db, "set_status", lambda *a, **k: None), \
            patch.object(generate.db, "user_set", lambda *a, **k: None), \
            patch.object(generate, "_render_pdf", lambda html, pdf: pdf.write_bytes(b"%PDF-1.4 scripted")):
        result = generate.generate_for(7)
    outdir = Path(result["dir"])
    return json.loads((outdir / "application.json").read_text(encoding="utf-8")), outdir, calls


def _letter_text(outdir):
    return (outdir / "CoverLetter.html").read_text(encoding="utf-8")


UNTRUE = ("expert C#", "15 years", "Old Mill Software", "Principal Controls Architect", "Chief Engineer", "Rust", "deep Kubernetes")


def generation() -> None:
    """@description The REAL generate_for holds a scripted model that overclaims, as production's local model did."""
    draft = {"resume": model_resume(honest=False), "cover": OVERCLAIM_LETTER}
    record, outdir, calls = _run_generate(sample_profile(), draft, OVERCLAIM_LETTER, HONEST_LETTER)
    receipt = record.get("claims_check") or {}
    check("the generation prompt carried the letter's evidence", bool(calls) and "COVER LETTER EVIDENCE" in calls[0][1])
    check("the editor pass was given the letter's evidence", any(kind == "editor" and "COVER LETTER EVIDENCE" in p for kind, p in calls))
    rewrite = [p for kind, p in calls if kind == "rewrite"]
    check("the letter was written again exactly once", len(rewrite) == 1)
    check("the rewrite named the specific problems", bool(rewrite) and "never mention" not in rewrite[0]
          and "The draft said “expert C#”" in rewrite[0] and "Old Mill Software" in rewrite[0])
    check("the packet records the check as fixed after one rewrite", receipt.get("status") == "fixed" and receipt.get("regenerated") is True)
    letter, resume = _letter_text(outdir), (outdir / "Resume_ATS.html").read_text(encoding="utf-8")
    check("the cover letter on disk claims nothing the records do not support", not any(word in letter for word in UNTRUE))
    check("the résumé on disk claims nothing the records do not support", not any(word in resume for word in UNTRUE))
    check("the résumé keeps the recorded title", "Field Automation Engineer (contract)" in resume and "Lead SCADA Architect" not in resume)
    check("the packet says which work the letter drew on", set(receipt.get("letter_draws_on") or []) <= set(receipt.get("letter_evidence") or []) | {"R1"})
    check("the packet lists what Career took out in plain words",
          any("expert C#" in p.get("words", "") for p in receipt.get("problems") or []))
    record, outdir, calls = _run_generate(sample_profile(), draft, OVERCLAIM_LETTER, None)
    receipt = record.get("claims_check") or {}
    check("a letter the rewrite cannot save is marked needs your review", receipt.get("status") == "needs_review" and bool(receipt.get("review")))
    check("even then the letter on disk claims nothing the records do not support", not any(word in _letter_text(outdir) for word in UNTRUE))
    record, outdir, calls = _run_generate(sample_profile(), {"resume": model_resume(honest=True), "cover": HONEST_LETTER}, HONEST_LETTER, HONEST_LETTER)
    receipt = record.get("claims_check") or {}
    check("an honest packet is left as written, with no rewrite", receipt.get("status") == "clean" and not any(k == "rewrite" for k, _p in calls)
          and record["generated"]["cover"]["paragraphs"] == HONEST_LETTER["paragraphs"])


def prepared() -> None:
    """@description Prepare application's engine path (prepare_job): real store, real scoring commit, scripted model."""
    with tempfile.TemporaryDirectory(prefix="career-truth-prepare-") as tmp:
        root = Path(tmp)
        saved = (config.DATA_DIR, config.CORPUS_DB, config.USER_DB, config.CAREER_DB, generate.APP_DIR)
        config.DATA_DIR, config.CORPUS_DB, config.USER_DB = root, root / "corpus.db", root / "user.db"
        config.CAREER_DB, generate.APP_DIR = root / "career_db.json", root / "applications"
        config.CAREER_DB.write_text(json.dumps(sample_profile()), encoding="utf-8")
        profile.load.cache_clear()
        try:
            with db.connect() as con:
                con.execute("INSERT INTO corpus.companies(id,name) VALUES(1,?)", (COMPANY,))
                con.execute("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,active,target_role) "
                            "VALUES(9,1,'9',?,?,1,1)", (TITLE, DESCRIPTION))
            scored = lambda row, _summary: {"id": row["id"], "data": {"fit_score": 81, "rationale": "Fit", "matched": [], "gaps": []}}
            calls = []
            with patch.object(prepare.render, "_chromium_binary", return_value="/scripted/chrome"), \
                    patch.object(score, "_score_one", side_effect=scored), \
                    patch.object(generate.enrich, "provider", return_value="scripted"), \
                    patch.object(generate.enrich, "complete", side_effect=_scripted(
                        {"resume": model_resume(honest=False), "cover": OVERCLAIM_LETTER}, OVERCLAIM_LETTER, HONEST_LETTER, calls)), \
                    patch.object(generate, "_render_pdf", lambda html, pdf: pdf.write_bytes(b"%PDF-1.4 scripted")):
                result = prepare.prepare_job(9, documents=True, request_id="truth-9")
            check("preparation finishes ready", result.get("phase") == "ready")
            packets = list((root / "applications").glob("*__9/application.json"))
            record = json.loads(packets[0].read_text(encoding="utf-8")) if packets else {}
            letter = json.dumps(record.get("generated", {}).get("cover", {}))
            check("the prepared letter is held to the records", (record.get("claims_check") or {}).get("status") == "fixed"
                  and not any(word in letter for word in UNTRUE))
        finally:
            db._leave_portable()          # the engine's own exit step, run while the fixture store still exists
            db._portable_paths.clear()
            config.DATA_DIR, config.CORPUS_DB, config.USER_DB, config.CAREER_DB, generate.APP_DIR = saved
            profile.load.cache_clear()


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="career-truth-") as packets:
        generate.APP_DIR = Path(packets) / "applications"
        for section in (ranking, prompts, claims, generation, prepared):
            try:
                section()
            except Exception as error:  # a section that cannot run is a failed check, never a silent pass
                check(f"{section.__name__} ran ({type(error).__name__}: {str(error)[:160]})", False)
    failed = [name for name, ok in CHECKS if not ok]
    print(json.dumps({"checks": len(CHECKS), "failed": failed}))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
