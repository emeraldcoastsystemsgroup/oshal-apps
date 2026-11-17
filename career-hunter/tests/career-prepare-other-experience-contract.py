# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.1 (Roger, 2026-11-16: "i still need the option of 'Other experience · optional — Agentic Federal | oshal (open-source)' to be selectable"): the engine half of "ticking the open-source item is exactly the inclusion". On 1.67.3's made-up candidate (tests/career-resume-roles-contract.py: a current role with one bullet naming a personal agent-orchestration project, the project saved with the résumé as its portfolio), the REAL generate_for with only the model, the posting row and the PDF renderer replaced: with nothing ticked, or with another entry ticked, the restored current role leaves that bullet out and the portfolio's facts never reach the model; with the portfolio's entry (saved-portfolio, the one Prepare application and bulk Prepare list) ticked, the bullet stays, the facts reach the model and the packet records the entry. One switch, no second rule. Run by tests/career-prepare-other-experience-route.test.mjs.
"""Ticking the open-source entry is the one switch that includes the candidate's open-source work in a generated résumé."""
from __future__ import annotations

import importlib.util
import json
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("career_resume_roles_contract", HERE / "career-resume-roles-contract.py")
roles = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(roles)          # its main() is guarded; this only loads the made-up candidate and the harness
from jobhunter import generate  # noqa: E402  (the module above put the engine on the path)

CHECKS: list = []
NAMING = "Led the agentic platform build for the company"     # the current role's bullet that names the open-source work
PORTFOLIO = {"id": "saved-portfolio", "title": "Lantern", "kind": "project", "organization": "Lantern (open-source)", "period": "",
             "facts": json.dumps({"name": "Lantern", "scoring_blurb": "PORTFOLIO_MARKER: built Lantern in the open"}),
             "skills": ["Python"], "archived": False}
VOLUNTEER = {"id": "volunteer-teaching-01", "title": "Weekend teaching", "kind": "volunteer", "organization": "Community school",
             "period": "2024", "facts": "VOLUNTEER_MARKER: taught Python workshops", "skills": ["Teaching"], "archived": False}


def check(name: str, condition) -> None:
    CHECKS.append((name, bool(condition)))


def _bullets(record) -> list:
    """@description The bullets of the résumé's first experience entry (the current role, restored by role_plan)."""
    experience = (record.get("generated") or {}).get("resume", {}).get("experience") or [{}]
    return experience[0].get("bullets") or []


def nothing_ticked() -> None:
    record, _outdir, prompts = roles._run_generate(roles.sample_profile(), roles.model_answer())
    check("nothing ticked: the restored current role leaves out its bullet naming the open-source work", NAMING not in _bullets(record))
    check("nothing ticked: the portfolio's facts never reach the model", not any("PORTFOLIO_MARKER" in p for p in prompts))


def open_source_ticked() -> None:
    record, _outdir, prompts = roles._run_generate(roles.sample_profile(), roles.model_answer(), additional_experience=[PORTFOLIO])
    check("open-source entry ticked: the restored current role keeps its bullet naming that work", NAMING in _bullets(record))
    check("open-source entry ticked: its facts reach the model", "PORTFOLIO_MARKER" in prompts[0])
    check("open-source entry ticked: the packet records the entry", record.get("additional_experience") == [{"id": "saved-portfolio", "title": "Lantern"}])
    check("open-source entry ticked: no second switch is involved", record.get("include_oshal") is False)


def other_entry_ticked() -> None:
    record, _outdir, prompts = roles._run_generate(roles.sample_profile(), roles.model_answer(), additional_experience=[VOLUNTEER])
    check("another entry ticked: the bullet naming the open-source work stays out", NAMING not in _bullets(record))
    check("another entry ticked: the unticked portfolio's facts never reach the model", "PORTFOLIO_MARKER" not in prompts[0])
    check("another entry ticked: its own facts do", "VOLUNTEER_MARKER" in prompts[0])


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="career-prepare-other-") as packets:
        generate.APP_DIR = Path(packets) / "applications"
        for section in (nothing_ticked, open_source_ticked, other_entry_ticked):
            try:
                section()
            except Exception as error:  # a section that cannot run is a failed check, never a silent pass
                check(f"{section.__name__} ran ({type(error).__name__}: {str(error)[:160]})", False)
    failed = [name for name, ok in CHECKS if not ok]
    print(json.dumps({"checks": len(CHECKS), "failed": failed}))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
