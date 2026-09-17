# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Contract for the ADR-141 D7 evidence half: the master resume document carries each role's stories under the bullet they support, a tailored packet's prompt carries the same evidence, a citation is kept only when the profile really holds that story on that role, and a candidate who has never been through the review gets the prompt this module always sent.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Run the REAL generate_for, because nothing did. Clause 3 of the done-when — a generated resume for a job cites a story — had no guard at all: reverting `prompt = build_prompt(...)` to the inline PROMPT.format and deleting `stories_cited = collect_story_citations(data, prof)` with its application.json key left every check in this file, and all twenty package tests, green. The new section drives the shipped pipeline with only the provider, the database and the PDF renderer replaced, and reads the citation record off the application.json it actually wrote. The prompt checks assert the EVIDENCE BLOCK rather than the story text, because the career DB is serialised into the same prompt and a presence check would survive the revert.
"""Story-evidence contract, run against the production ``profile`` and ``generate`` modules and a
REAL profile file.

The provider is not even doubled here: every function under test is deterministic. What is under
test is the boundary the ADR-141 D7 done-when names — the master document the Resume Studio edits,
the prompt a tailored packet is generated from, and the verification that decides whether a model's
claimed citation reaches the record. A story must never be attributed to a role the candidate did
not tell it about, and a model must never be able to invent one.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE_ROOT / "engine"))

DEPLOY_BULLET = "Cut deploy time from 40 minutes to 6 by rebuilding the release pipeline"
DEPLOY_STORY = ("The pipeline took forty minutes because every service rebuilt the whole image. "
                "I rewrote it around layer caching and it landed at six minutes.")
K8S_STORY = "I moved thirty services onto Kubernetes over two quarters without a customer outage."

PROFILE = {
    "profile": {"name": "Contract Candidate", "credential": "PMP", "location": "Testville",
                "clearance": "None stated", "experience_summary": "Platform leader."},
    "roles": [
        {
            "title": "Director of Platform", "org": "Acme", "start": "2019-01", "end": None,
            "deliverables": [DEPLOY_BULLET, "Grew the platform team from 4 to 11"],
            "stories": [
                {"at": "2026-09-16", "title": "Six-minute deploys", "story": DEPLOY_STORY,
                 "bullet": DEPLOY_BULLET, "answer": DEPLOY_STORY, "source": "verbatim"},
                {"at": "2026-09-16", "title": "", "story": "I think we did some things.",
                 "bullet": "", "answer": "I think we did some things.", "source": "ai",
                 "weak": True},
            ],
        },
        {
            "title": "Staff Engineer", "org": "Globex", "start": "2015-05", "end": "2018-12",
            "deliverables": ["Migrated 30 services to Kubernetes"],
            "stories": [
                {"at": "2026-09-16", "title": "Kubernetes migration", "story": K8S_STORY,
                 "bullet": "Migrated 30 services to Kubernetes", "answer": K8S_STORY,
                 "source": "ai"},
            ],
        },
    ],
    "skills": {"Cloud": {"items": ["AWS", "Terraform"]}},
}

STORYLESS = {
    "profile": {"name": "No Review", "experience_summary": "Never reviewed."},
    "roles": [{"title": "Director of Platform", "org": "Acme", "deliverables": [DEPLOY_BULLET]}],
}

CHECKS: list = []


def check(name: str, condition: bool) -> None:
    CHECKS.append((name, bool(condition)))


def entry(title: str, org: str, cited) -> dict:
    """@description One generated experience entry as the model would return it."""
    return {"title": title, "org": org, "span": "2019 to present",
            "bullets": ["A tailored bullet"], "story_evidence": cited}


def run_with_profile(raw: dict, fn):
    """@description Run fn(profile_module, generate_module) against a REAL profile file on disk."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "career_db.json"
        path.write_text(json.dumps(raw), encoding="utf-8")
        os.environ["JOBHUNTER_CAREER_DB"] = str(path)
        from jobhunter import config, generate, profile  # imported AFTER the store env is set
        config.CAREER_DB = path
        profile.load.cache_clear()
        try:
            return fn(profile, generate, path)
        finally:
            profile.load.cache_clear()


def master_document(profile, generate, _path) -> None:
    """@description The master resume document the Resume Studio edits."""
    doc = profile.base_document()
    experience = doc["resume"]["experience"]
    check("the master document keeps both roles", len(experience) == 2)
    acme = experience[0]
    check("every role carries a stories list", all("stories" in e for e in experience))
    check("the role's story reaches the document", any(
        s.get("story") == DEPLOY_STORY for s in acme["stories"]))
    told = [s for s in acme["stories"] if s.get("story") == DEPLOY_STORY][0]
    check("the story names the bullet it supports", told["bullet"] == DEPLOY_BULLET)
    check("the supported bullet is one the role carries", told["bullet"] in acme["bullets"])
    check("the story keeps its handle", told["title"] == "Six-minute deploys")
    check("a story with no evidence is marked, not hidden", any(
        s.get("weak") is True for s in acme["stories"]))
    check("the strong story is not marked weak", told.get("weak") is False)
    check("the bullets are untouched", acme["bullets"] == PROFILE["roles"][0]["deliverables"])

    # A master save is a WHITELIST: a document carrying stories must not be able to write them.
    doc["resume"]["experience"][0]["stories"] = [
        {"title": "Invented", "story": "Never told.", "bullet": DEPLOY_BULLET}]
    doc["resume"]["experience"][0]["bullets"] = [DEPLOY_BULLET, "Grew the platform team from 4 to 12"]
    result = profile.replace_resume_fields(doc)
    check("the master save still applies bullets", result.get("ok") is True)
    profile.load.cache_clear()
    after = profile.load()["roles"][0]
    check("the edited bullet landed", after["deliverables"][1].endswith("4 to 12"))
    check("the save could not write a story", all(
        s.get("story") != "Never told." for s in after.get("stories") or []))
    check("the told story survived the save", any(
        s.get("story") == DEPLOY_STORY for s in after.get("stories") or []))


def prompt_evidence(profile, generate, _path) -> None:
    """@description The evidence a tailored packet is generated from."""
    prof = profile.load()
    suffix = generate.story_evidence_suffix(prof)
    check("the prompt carries the story", DEPLOY_STORY[:60] in suffix)
    check("the prompt names the bullet the story supports", DEPLOY_BULLET in suffix)
    check("the prompt names the role", "Director of Platform at Acme" in suffix)
    check("the prompt carries the second role's story", K8S_STORY[:40] in suffix)
    check("a weak story is never offered as proof", "I think we did some things" not in suffix)
    check("the prompt asks for the citation key", '"story_evidence"' in suffix)

    prompt = generate.build_prompt(prof, "Target Co", "Platform Director", "Remote", "A job.")
    check("the posting reaches the prompt", "Target Co" in prompt and "Platform Director" in prompt)
    check("the evidence block is appended to the prompt", prompt.endswith(suffix))
    check("the profile itself still reaches the prompt", DEPLOY_BULLET in prompt)


def storyless_prompt(profile, generate, _path) -> None:
    """@description A candidate who has never been through the review must see no drift at all."""
    prof = profile.load()
    check("no stories means no evidence block", generate.story_evidence_suffix(prof) == "")
    prompt = generate.build_prompt(prof, "Target Co", "Platform Director", "Remote", "A job.")
    expected = generate.PROMPT.format(
        profile=json.dumps(generate._prep_profile(prof, False), indent=1)[:120000],
        company="Target Co", title="Platform Director", location="Remote", description="A job.")
    check("the prompt is byte-identical to the one this module always sent", prompt == expected)
    check("nothing asks for a citation", "story_evidence" not in prompt)


def citations(profile, generate, _path) -> None:
    """@description What survives verification, and what is refused."""
    prof = profile.load()

    data = {"resume": {"experience": [
        entry("Director of Platform", "Acme", ["Six-minute deploys"]),
        entry("Staff Engineer", "Globex", []),
    ]}}
    cited = generate.collect_story_citations(data, prof)
    check("a real citation is kept", len(cited) == 1)
    check("the citation names the role", cited[0]["role"] == "Director of Platform")
    check("the citation carries the story", cited[0]["story"] == DEPLOY_STORY)
    check("the citation carries the bullet it proves", cited[0]["bullet"] == DEPLOY_BULLET)
    check("the key never reaches the rendered resume", all(
        "story_evidence" not in e for e in data["resume"]["experience"]))
    check("the bullets are left alone", data["resume"]["experience"][0]["bullets"] == ["A tailored bullet"])

    # A model may cite by the story's opening words when it has no handle.
    data = {"resume": {"experience": [entry("Staff Engineer", "Globex", [K8S_STORY[:45]])]}}
    check("a citation by opening words is kept", len(generate.collect_story_citations(data, prof)) == 1)

    # ── the refusals: this is the half that keeps a generated packet honest ──────────────
    data = {"resume": {"experience": [entry("Staff Engineer", "Globex", ["Six-minute deploys"])]}}
    check("a story may not be moved to another role",
          generate.collect_story_citations(data, prof) == [])

    data = {"resume": {"experience": [
        entry("Director of Platform", "Acme", ["Rescued the company from bankruptcy"])]}}
    check("an invented story is refused", generate.collect_story_citations(data, prof) == [])

    data = {"resume": {"experience": [
        entry("Director of Platform", "Acme", ["I think we did some things."])]}}
    check("a weak story may never be cited", generate.collect_story_citations(data, prof) == [])

    data = {"resume": {"experience": [
        entry("Head of Everything", "Never Worked Here", ["Six-minute deploys"])]}}
    check("a role the candidate never held is refused",
          generate.collect_story_citations(data, prof) == [])

    data = {"resume": {"experience": [entry("Director of Platform", "Acme", [""])]}}
    check("an empty citation is refused", generate.collect_story_citations(data, prof) == [])

    check("a packet with no experience cites nothing",
          generate.collect_story_citations({"resume": {}}, prof) == [])



# ─────────────────────────────────────────────────────────────────────────────
# CLAUSE 3 — "a generated resume for a job cites a story".
#
# Everything above proves the PIECES: the prompt suffix, the citation verifier, the master
# document. None of it runs generate_for, which is the only place those pieces are wired together,
# and that is the shape of defect this file exists to catch: reverting `prompt = build_prompt(...)`
# to the inline PROMPT.format, and deleting `stories_cited = collect_story_citations(data, prof)`
# with its application.json key, undoes the clause entirely and leaves every check above green.
#
# So this section runs the REAL generate_for. Three things are replaced and nothing else:
#   - enrich.provider / enrich.complete — there is no API key and no network in this suite;
#   - db.connect (plus set_status / user_set) — the posting row, not the feature;
#   - _render_pdf — it shells out to headless Chromium.
# The profile load, the prompt build, the citation verification, the sanitiser, the cover editor
# pass, the Jinja templates and the application.json write are all the shipped code.
# ─────────────────────────────────────────────────────────────────────────────

JOB_ROW = {
    "id": 7, "company": "Target Co", "title": "Platform Director", "location": "Remote",
    "description": "Run the platform org.", "url": "https://example.invalid/jobs/7",
    "ats_job_id": "REQ-9", "status": "new",
}

MODEL_PACKET = {
    "resume": {
        "headline": "Platform Director",
        "summary": "Platform leader.",
        "skills": ["AWS", "Terraform"],
        "experience": [
            {"title": "Director of Platform", "org": "Acme", "span": "2019-01 to present",
             "bullets": ["Rebuilt the release pipeline"], "story_evidence": ["Six-minute deploys"]},
            {"title": "Staff Engineer", "org": "Globex", "span": "2015-05 to 2018-12",
             "bullets": ["Ran the migration"],
             "story_evidence": ["Rescued the company from bankruptcy"]},
        ],
    },
    "cover": {"greeting": "Dear Hiring Manager,", "paragraphs": ["Draft paragraph."],
              "closing": "Sincerely,"},
}


class _Result:
    """@description The one cursor shape _job_row and the status re-read use."""

    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _Conn:
    """@description The posting row, and nothing else. Every other statement answers empty."""

    def __init__(self):
        self.statements = []

    def execute(self, sql, params=()):
        self.statements.append(sql)
        if "FROM postings p JOIN companies" in sql:
            return _Result(dict(JOB_ROW))
        if "SELECT status FROM postings" in sql:
            return _Result({"status": "new"})
        return _Result(None)

    def commit(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False


def packet_record(profile, generate, _path) -> None:
    """
    @description Run the real generate_for and read the packet it wrote off disk.
    @param profile - The production profile module.
    @param generate - The production generate module.
    @param _path - The profile file backing this run.
    """
    prompts = []
    status_writes = []
    originals = {
        "provider": generate.enrich.provider,
        "complete": generate.enrich.complete,
        "connect": generate.db.connect,
        "set_status": generate.db.set_status,
        "user_set": generate.db.user_set,
        "render": generate._render_pdf,
    }

    def fake_complete(system, prompt, max_tokens=0, **_kw):
        prompts.append(prompt)
        if "DRAFT COVER" in prompt:          # the second, cover-editor pass
            return json.dumps({"greeting": "Dear Hiring Manager,",
                               "paragraphs": ["Polished paragraph."], "closing": "Sincerely,"})
        return json.dumps(MODEL_PACKET)

    generate.enrich.provider = lambda: "contract"
    generate.enrich.complete = fake_complete
    generate.db.connect = _Conn
    generate.db.set_status = lambda *a, **k: status_writes.append(("set_status", a, k))
    generate.db.user_set = lambda *a, **k: status_writes.append(("user_set", a, k))
    generate._render_pdf = lambda html_path, pdf_path: pdf_path.write_bytes(b"%PDF-1.4 contract")
    try:
        result = generate.generate_for(7)
    finally:
        generate.enrich.provider = originals["provider"]
        generate.enrich.complete = originals["complete"]
        generate.db.connect = originals["connect"]
        generate.db.set_status = originals["set_status"]
        generate.db.user_set = originals["user_set"]
        generate._render_pdf = originals["render"]

    outdir = Path(result["dir"])
    check("generate_for wrote a packet directory", outdir.is_dir())
    check("the four documents were rendered", all(
        Path(result[key]).exists() for key in
        ("resume_ats", "resume_premium", "resume_1page", "cover")))

    record = json.loads((outdir / "application.json").read_text(encoding="utf-8"))

    # ── the clause: the packet records the evidence it cited ───────────────────────────
    check("the packet records its story citations", isinstance(record.get("stories_cited"), list))
    cited = record.get("stories_cited") or []
    check("exactly the one real citation survived", len(cited) == 1)
    check("the recorded citation carries the candidate's own words",
          bool(cited) and cited[0]["story"] == DEPLOY_STORY)
    check("the recorded citation names the role it belongs to",
          bool(cited) and cited[0]["role"] == "Director of Platform" and cited[0]["org"] == "Acme")
    check("the recorded citation names the bullet it proves",
          bool(cited) and cited[0]["bullet"] == DEPLOY_BULLET)
    check("an invented citation never reaches the packet",
          not any("bankruptcy" in json.dumps(c) for c in cited))

    # ── the other half of the same clause: the model was GIVEN the evidence ────────────
    check("the generation prompt was sent", len(prompts) >= 1)
    first = prompts[0] if prompts else ""
    # These assert the EVIDENCE BLOCK specifically, not the story text: the career DB is serialised
    # into the same prompt, so the story and the bullet appear in it either way and a check for
    # their presence would survive the very revert this section exists to catch.
    check("the generation prompt carried the evidence block",
          "EVIDENCE THE CANDIDATE TOLD YOU" in first)
    check("the evidence block quoted the candidate's own words",
          "in the candidate's own words: " + DEPLOY_STORY[:60] in first)
    check("the evidence block named the bullet the story supports",
          'supports the bullet: "' + DEPLOY_BULLET + '"' in first)
    check("the generation prompt asked for the citation key", '"story_evidence"' in first)
    check("the prompt generate_for sent is the one build_prompt builds",
          first.endswith(generate.story_evidence_suffix(profile.load())))

    # ── and the rendered document keeps the shape the templates already speak ──────────
    generated = (record.get("generated") or {}).get("resume") or {}
    check("the citation key is stripped from the packet's resume", all(
        "story_evidence" not in e for e in generated.get("experience") or []))
    check("the posting is recorded beside the evidence",
          record.get("posting_id") == 7 and record.get("req") == "REQ-9")
    check("the posting was moved to generated", any(w[0] == "set_status" for w in status_writes))


def main() -> int:
    argparse.ArgumentParser().parse_args()
    with tempfile.TemporaryDirectory() as packets:
        # generate_for writes its packet under config.APP_DIR, which is bound at import time.
        os.environ["JOBHUNTER_APP_DIR"] = str(Path(packets) / "applications")
        run_with_profile(PROFILE, master_document)
        run_with_profile(PROFILE, prompt_evidence)
        run_with_profile(PROFILE, citations)
        run_with_profile(STORYLESS, storyless_prompt)
        run_with_profile(PROFILE, packet_record)
    failed = [name for name, ok in CHECKS if not ok]
    print(json.dumps({"checks": len(CHECKS), "failed": failed}))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
