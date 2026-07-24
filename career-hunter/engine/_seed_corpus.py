"""One-off: split a legacy single-user jobs.db into the multi-user layout —
a shared corpus.db (companies + objective postings + reputation) and one per-user
user-{sub}.db (keyword/AI fit, status, resume/cover paths, recruiter tracker,
interview assessments). Idempotent (INSERT OR IGNORE / upsert).

Run (point CAREER_SRC_DB at the legacy jobs.db, set the user you are seeding):
  JOBHUNTER_MULTIUSER=1 OSHAL_USER_SUB=<sub> \
  JOBHUNTER_CORPUS_DB=.../corpus.db JOBHUNTER_USER_DB=.../user-<sub>.db \
  CAREER_SRC_DB="/c/Users/.../job-hunter/data/jobs.db" \
  python _seed_corpus.py
"""
import os
import sqlite3
import sys

from jobhunter import db, config

OBJ_COLS = ("id, company_id, ats_job_id, title, location, remote, department, url, description, "
            "posted_at, posted_date, state, city, lat, lon, job_type, target_role, "
            "salary_min, salary_max, salary_currency, salary_period, salary_raw, salary_source, "
            "first_seen_at, last_seen_at, active")
SIG_SELECT = ("id AS posting_id, fit_score, ai_fit_score, ai_fit_rationale, ai_fit_matched, "
              "ai_fit_gaps, ai_scored_at, ai_model, status, resume_path, cover_path, "
              "generated_at, promoted_at, applied_at, outreach_sent_at, notes")


def main():
    if not config.MULTIUSER:
        print("Set JOBHUNTER_MULTIUSER=1 first.", file=sys.stderr); sys.exit(2)
    src = os.environ.get("CAREER_SRC_DB")
    if not src or not os.path.exists(src):
        print(f"CAREER_SRC_DB not found: {src}", file=sys.stderr); sys.exit(2)

    db.init_db()  # create corpus + user schemas
    conn = sqlite3.connect(config.USER_DB)
    conn.execute("ATTACH DATABASE ? AS corpus", (str(config.CORPUS_DB),))
    conn.execute("ATTACH DATABASE ? AS src", (src,))

    # Shared corpus (objective + companies + reputation).
    conn.execute("INSERT OR IGNORE INTO corpus.companies SELECT * FROM src.companies")
    conn.execute(f"INSERT OR IGNORE INTO corpus.postings_corpus ({OBJ_COLS}) "
                 f"SELECT {OBJ_COLS} FROM src.postings")
    try:
        conn.execute("INSERT OR IGNORE INTO corpus.company_reputation SELECT * FROM src.company_reputation")
    except sqlite3.OperationalError:
        pass

    # Per-user signals — only rows that carry a real signal (keeps the user DB lean).
    conn.execute(
        f"INSERT OR IGNORE INTO user_signals "
        f"(posting_id, fit_score, ai_fit_score, ai_fit_rationale, ai_fit_matched, ai_fit_gaps, "
        f" ai_scored_at, ai_model, status, resume_path, cover_path, generated_at, promoted_at, "
        f" applied_at, outreach_sent_at, notes) "
        f"SELECT {SIG_SELECT} FROM src.postings "
        f"WHERE fit_score IS NOT NULL OR ai_fit_score IS NOT NULL "
        f"   OR (status IS NOT NULL AND status <> 'new') OR resume_path IS NOT NULL")

    # Per-user trackers.
    for tbl in ("recruiter_firms", "interview_assessments"):
        try:
            conn.execute(f"INSERT OR IGNORE INTO {tbl} SELECT * FROM src.{tbl}")
        except sqlite3.OperationalError:
            pass

    conn.commit()
    companies = conn.execute("SELECT COUNT(*) FROM corpus.postings_corpus").fetchone()[0]
    signals = conn.execute("SELECT COUNT(*) FROM user_signals").fetchone()[0]
    conn.close()
    print(f"Seeded corpus: {companies} postings; user {config.USER_SUB}: {signals} signal rows.")


if __name__ == "__main__":
    main()
