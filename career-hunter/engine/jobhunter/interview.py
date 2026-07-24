"""Interview transcript -> realistic skill reassessment, calibrated against the
resume/claimed skills. Round 1: assess the transcript + generate calibration questions.
Round 2: the candidate answers those questions -> a finalized, defensible skill read."""
from __future__ import annotations
import json
from . import enrich, profile, db

SYS = ("You are a rigorous, fair technical-interview assessor and career coach for a senior "
       "(~$300K) technology leader. Assess ONLY what the candidate actually DEMONSTRATED in the "
       "transcript (and their follow-up answers, if given) — realistic and specific, never flattering. "
       "Cite short evidence. Calibrate his CLAIMED skills against what he actually showed.")


def _claimed_skills():
    d = profile.load(); out = []
    for g in d.get("skills", {}).values():
        out += g.get("items", [])
    return out


def assess(transcript: str, company: str = "", role: str = "", answers: str = "") -> dict:
    claimed = _claimed_skills()
    prompt = (
        f"CANDIDATE'S CLAIMED SKILLS (from his resume/profile):\n{', '.join(claimed[:80])}\n\n"
        f"INTERVIEW (company: {company or 'n/a'}, role: {role or 'n/a'}):\n{(transcript or '')[:12000]}\n"
        + (f"\nHIS ANSWERS TO THE FOLLOW-UP CALIBRATION QUESTIONS:\n{answers[:4000]}\n" if answers else "")
        + "\nReturn STRICT JSON only:\n{\n"
        '  "summary": "2-3 sentence realistic read of how he came across",\n'
        '  "demonstrated": [{"skill":"...","depth":"strong|moderate|mentioned","evidence":"short quote or paraphrase"}],\n'
        '  "overclaimed": ["claimed/resume skills NOT evidenced here — shore these up before relying on them"],\n'
        '  "underclaimed": ["skills he clearly showed that are missing or under-weighted on the resume"],\n'
        '  "assessed_skills": ["realistic skills he can defend, each with a 1-3 word calibration e.g. \\"Kubernetes (operating)\\""],\n'
        + ("" if answers else '  "calibration_questions": ["3-6 targeted questions to resolve uncertainty about real depth"],\n')
        + '  "coaching": ["2-4 concrete tips to interview better next time"]\n}'
    )
    return enrich.parse_json(enrich.complete(SYS, prompt, max_tokens=2200)) or {}


def save(transcript, company, role, result, answers="", finalized=0) -> int:
    with db.connect() as c:
        cur = c.execute(
            "INSERT INTO interview_assessments (at,company,role,transcript,answers,result,finalized) "
            "VALUES (?,?,?,?,?,?,?)",
            (db.now(), company, role, transcript, answers, json.dumps(result), finalized))
        return cur.lastrowid


def update(aid, result, answers, finalized=1):
    with db.connect() as c:
        c.execute("UPDATE interview_assessments SET result=?, answers=?, finalized=? WHERE id=?",
                  (json.dumps(result), answers, finalized, aid))
