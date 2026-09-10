# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Contract for the ADR-141 D7 role-anchored story review: the no-provider path still records, a model may never cite a bullet the role does not carry, the review advances role by role, and a real profile file survives every write.
"""Story-review contract, run against the production ``stories`` module and a REAL profile file.

The provider is the only thing doubled, and deliberately: the boundary under test is what
``stories`` does with an answer — where it attaches it, which bullet it may cite, and what it
writes to disk. Both provider outcomes are exercised (reachable and not), because the review has
to work on a box with no AI at all.
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

PROFILE = {
    "profile": {"name": "Contract Candidate", "experience_summary": "Platform leader."},
    "roles": [
        {
            "title": "Director of Platform",
            "org": "Acme",
            "deliverables": [
                "Cut deploy time from 40 minutes to 6 by rebuilding the release pipeline",
                "Grew the platform team from 4 to 11",
            ],
        },
        {"title": "Staff Engineer", "org": "Globex", "deliverables": ["Migrated 30 services to Kubernetes"]},
    ],
}

CHECKS: list[tuple[str, bool]] = []


def check(name: str, condition: bool) -> None:
    CHECKS.append((name, bool(condition)))


def load_profile(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        profile_path = Path(tmp) / "career_db.json"
        profile_path.write_text(json.dumps(PROFILE), encoding="utf-8")
        os.environ["JOBHUNTER_CAREER_DB"] = str(profile_path)

        from jobhunter import enrich, stories  # imported AFTER the store env is set

        # ── the review starts with every role open, and asks about the first one ──────────
        state = stories.state()
        check("two roles, none with a story", state["total"] == 2 and state["withStory"] == 0)
        check("not complete before any story", state["complete"] is False)
        check("next role is the first", state["next"]["index"] == 0)
        question = state["next"]["question"]
        check("the question quotes the role's own bullet", "release pipeline" in question)
        check("the question names the role", "Director of Platform at Acme" in question)

        # ── no provider: the answer is still recorded, verbatim, against the right bullet ──
        def unavailable(*_args, **_kwargs):
            raise RuntimeError("no AI auth found")

        real_complete = enrich.complete
        enrich.complete = unavailable
        try:
            answer = ("The pipeline took forty minutes because every service rebuilt the whole image. "
                      "I rewrote it around layer caching and it landed at six minutes.")
            result = stories.record(0, answer)
        finally:
            enrich.complete = real_complete
        check("records with no provider", result["ok"] is True)
        story = result["story"]
        check("keeps the answer verbatim", story["source"] == "verbatim" and story["story"] == answer)
        check("verbatim story keeps the raw answer too", story["answer"] == answer)
        check(
            "attaches the overlapping bullet",
            story["bullet"] == "Cut deploy time from 40 minutes to 6 by rebuilding the release pipeline",
        )

        state = stories.state()
        check("the review advanced", state["withStory"] == 1 and state["next"]["index"] == 1)
        check("the story is on disk", len(load_profile(profile_path)["roles"][0]["stories"]) == 1)
        check("the profile kept its other content", load_profile(profile_path)["profile"]["name"] == "Contract Candidate")

        # ── a provider may NEVER cite a bullet the role does not carry ────────────────────
        def invents_a_bullet(*_args, **_kwargs):
            return json.dumps({
                "story": "Tightened prose about Kubernetes.",
                "bullet": "Invented a bullet nobody wrote",
                "title": "K8s migration",
                "evidence": True,
            })

        enrich.complete = invents_a_bullet
        try:
            result = stories.record(1, "I moved thirty services onto Kubernetes over two quarters.")
        finally:
            enrich.complete = real_complete
        story = result["story"]
        check("uses the model's story text", story["source"] == "ai" and story["story"].startswith("Tightened"))
        check("refuses the invented bullet", story["bullet"] != "Invented a bullet nobody wrote")
        check("falls back to a bullet the role carries", story["bullet"] == "Migrated 30 services to Kubernetes")

        state = stories.state()
        check("every role now has a story", state["complete"] is True and state["next"] is None)

        # ── a model that reports no evidence marks the story, and it is never cited ───────
        def no_evidence(*_args, **_kwargs):
            return json.dumps({"story": "Vague recollection.", "bullet": "", "title": "", "evidence": False})

        enrich.complete = no_evidence
        try:
            stories.record(1, "I think I helped with some things there.")
        finally:
            enrich.complete = real_complete
        raw = load_profile(profile_path)
        weak = raw["roles"][1]["stories"][-1]
        check("a no-evidence answer is marked weak", weak.get("weak") is True)
        check("a weak story is never offered as proof", len(stories.cited_for(raw["roles"][1])) == 1)

        # ── refusals ─────────────────────────────────────────────────────────────────────
        check("empty answers are refused", stories.record(0, "   ")["ok"] is False)
        check("an unknown role is refused", stories.record(99, "anything")["ok"] is False)
        check("the refusals wrote nothing", len(load_profile(profile_path)["roles"][0]["stories"]) == 1)

    failed = [name for name, ok in CHECKS if not ok]
    print(json.dumps({"checks": len(CHECKS), "failed": failed}))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
