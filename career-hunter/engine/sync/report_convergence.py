#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Produce bounded-memory counts, SHA-256 datasets, and product-query convergence evidence for SQLite and PostgreSQL.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Bound server-side cursor names independently of untrusted subject identifiers.

"""Read-only Career SQLite/PostgreSQL convergence report.

Run after every loader replay and as the final cutover comparison. Rows are streamed in primary-key
order into canonical SHA-256 digests, so the report does not materialize the million-row corpus.
Application evidence intentionally includes provenance and durable run correlation while excluding
the one-time claim token: the offline loader must never copy a possibly live token.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Iterable, Mapping


DEFAULT_ROOT = Path(os.environ.get("CAREER_DATA_ROOT", "/app/output/career-hunter-data/default"))
TIMESTAMPS = {
    "last_scraped_at", "posted_at", "first_seen_at", "last_seen_at", "ai_scored_at",
    "promoted_at", "generated_at", "outreach_sent_at", "applied_at", "answered_at", "at",
}
DATES = {"posted_date"}
BOOLEANS = {"gsearched", "remote", "active", "target_role"}
JSON_VALUES = {"source_lists", "ai_fit_matched", "ai_fit_gaps"}
DECIMALS = {"lat", "lon", "salary_min", "salary_max"}


COMPANY_FIELDS = (
    "id", "name", "ticker", "domain", "homepage", "careers_url", "ats_type", "ats_token",
    "industry", "hq", "discover_status", "gsearched", "referral", "source_lists",
    "last_scraped_at",
)
POSTING_FIELDS = (
    "id", "company_id", "ats_job_id", "title", "description", "url", "location", "city",
    "state", "lat", "lon", "remote", "department", "job_type", "salary_min", "salary_max",
    "salary_currency", "salary_period", "salary_raw", "salary_source", "posted_at",
    "posted_date", "first_seen_at", "last_seen_at", "active",
)
SCORE_FIELDS = (
    "posting_id", "fit_score", "target_role", "ai_fit_score", "ai_fit_rationale",
    "ai_fit_matched", "ai_fit_gaps", "ai_model", "ai_scored_at",
)
APPLICATION_FIELDS = (
    "posting_id", "status", "resume_path", "cover_path", "promoted_at", "generated_at",
    "outreach_sent_at", "applied_at", "notes", "apply_active", "apply_claimed_at",
    "apply_run_id", "confirmation_path", "application_source", "application_task_id",
)
RECRUITER_FIELDS = (
    "id", "firm", "bucket", "website", "contact_name", "contact_role", "contact_link",
    "resume_label", "channel", "status", "date_contacted", "followup_date", "next_action",
    "notes", "sort_order",
)
GAP_FIELDS = (
    "key", "n_jobs", "avg_fit", "sample_gaps", "status", "response", "answered_at",
)
INTERVIEW_FIELDS = (
    "source_id", "at", "company", "role", "transcript", "answers", "result", "finalized",
)


def _timestamp(value):
    """Normalize loader-accepted timestamps; invalid SQLite UI labels become NULL."""
    if value in (None, ""):
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, datetime):
        parsed = value
    else:
        raw = str(value).strip()
        if len(raw) < 10 or raw[4:5] != "-" or raw[7:8] != "-":
            return None
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            try:
                return date.fromisoformat(raw[:10]).isoformat()
            except ValueError:
                return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def _json_value(value):
    if value in (None, ""):
        return None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    return value


def _decimal(value):
    if value is None:
        return None
    normalized = Decimal(str(value)).normalize()
    return "0" if normalized == 0 else format(normalized, "f")


def canonical_row(row: Mapping, fields: tuple[str, ...]) -> list:
    """Return a dialect-independent ordered representation of one selected row."""
    values = []
    for field in fields:
        value = row[field]
        if field in TIMESTAMPS:
            value = _timestamp(value)
        elif field in DATES:
            value = value.isoformat() if isinstance(value, date) else (str(value) if value else None)
        elif field in BOOLEANS:
            value = None if value is None else bool(value)
        elif field in JSON_VALUES:
            value = _json_value(value)
        elif field in DECIMALS:
            value = _decimal(value)
        elif isinstance(value, Decimal):
            value = _decimal(value)
        elif isinstance(value, uuid.UUID):  # pragma: no cover - psycopg2 UUID adapter is optional
            value = str(value)
        values.append(value)
    return values


def digest_rows(rows: Iterable[Mapping], fields: tuple[str, ...]) -> dict:
    """Stream canonical rows into a count and SHA-256 digest."""
    digest = hashlib.sha256()
    count = 0
    for row in rows:
        payload = json.dumps(canonical_row(row, fields), ensure_ascii=False,
                             sort_keys=True, separators=(",", ":"))
        digest.update(payload.encode("utf-8") + b"\n")
        count += 1
    return {"count": count, "sha256": digest.hexdigest()}


def sqlite_rows(conn: sqlite3.Connection, sql: str, params=()):
    cursor = conn.execute(sql, params)
    while True:
        batch = cursor.fetchmany(2_000)
        if not batch:
            return
        yield from batch


def postgres_rows(conn, name: str, sql: str, params=()):
    from psycopg2.extras import RealDictCursor

    # PostgreSQL cursor identifiers are limited to 63 bytes. Deriving the name from a digest
    # also prevents a long or punctuation-heavy user subject from becoming an invalid cursor.
    cursor_name = f"career_conv_{hashlib.sha256(name.encode('utf-8')).hexdigest()[:24]}"
    cursor = conn.cursor(name=cursor_name, cursor_factory=RealDictCursor)
    cursor.itersize = 2_000
    try:
        cursor.execute(sql, params)
        yield from cursor
    finally:
        cursor.close()


def list_users(root: Path) -> list[str]:
    """Return exact source subjects which have a corresponding user database."""
    return sorted(
        child.name for child in root.iterdir()
        if child.is_dir() and not child.name.startswith("_")
        and (child / f"user-{child.name}.db").is_file()
    )


def open_user(root: Path, user_sub: str) -> sqlite3.Connection:
    """Open the user database first, then attach corpus as required by its views."""
    user_db = root / user_sub / f"user-{user_sub}.db"
    corpus_db = root / "corpus.db"
    conn = sqlite3.connect(f"file:{user_db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("ATTACH DATABASE ? AS corpus", (str(corpus_db),))
    return conn


def dataset(source, target, name: str, fields: tuple[str, ...], source_sql: str,
            target_sql: str, source_params=(), target_params=()) -> dict:
    left = digest_rows(sqlite_rows(source, source_sql, source_params), fields)
    right = digest_rows(postgres_rows(target, name.replace(".", "_"), target_sql, target_params), fields)
    return {"sqlite": left, "postgres": right, "match": left == right}


def corpus_report(source, target) -> dict:
    return {
        "companies": dataset(
            source, target, "corpus.companies", COMPANY_FIELDS,
            f"SELECT {','.join(COMPANY_FIELDS)} FROM corpus.companies ORDER BY id",
            f"SELECT {','.join(COMPANY_FIELDS)} FROM career_companies ORDER BY id",
        ),
        "postings": dataset(
            source, target, "corpus.postings", POSTING_FIELDS,
            f"SELECT {','.join(POSTING_FIELDS)} FROM corpus.postings_corpus ORDER BY id",
            f"SELECT {','.join(POSTING_FIELDS)} FROM career_postings ORDER BY id",
        ),
    }


APPLICATION_WHERE = """(
  (status IS NOT NULL AND status <> 'new') OR applied_at IS NOT NULL OR resume_path IS NOT NULL
  OR cover_path IS NOT NULL OR generated_at IS NOT NULL OR promoted_at IS NOT NULL
  OR outreach_sent_at IS NOT NULL OR apply_claimed_at IS NOT NULL OR confirmation_path IS NOT NULL
  OR application_source IS NOT NULL OR application_task_id IS NOT NULL OR apply_run_id IS NOT NULL
  OR notes IS NOT NULL
)"""


def key_queries(source, target, user_sub: str) -> dict:
    """Compare the board/application queries operators use to judge cutover health."""
    cutoff = (datetime.now(timezone.utc).date() - timedelta(days=14)).isoformat()
    source_top = [dict(row) for row in source.execute(
        "SELECT ats_job_id,title,COALESCE(ai_fit_score,fit_score,-1) AS score,status "
        "FROM postings WHERE active=1 ORDER BY score DESC,id LIMIT 10"
    ).fetchall()]
    with target.cursor() as cur:
        cur.execute(
            "SELECT p.ats_job_id,p.title,COALESCE(s.ai_fit_score,s.fit_score,-1) AS score,"
            "COALESCE(a.status,'new') AS status FROM career_postings p "
            "LEFT JOIN career_user_job_scores s ON s.posting_id=p.id AND s.user_sub=%s "
            "LEFT JOIN career_user_applications a ON a.posting_id=p.id AND a.user_sub=%s "
            "WHERE p.active ORDER BY score DESC,p.id LIMIT 10",
            (user_sub, user_sub),
        )
        target_top = [dict(zip([desc[0] for desc in cur.description], row)) for row in cur.fetchall()]
        cur.execute(
            "SELECT COUNT(*) FROM career_postings p JOIN career_user_job_scores s "
            "ON s.posting_id=p.id AND s.user_sub=%s WHERE p.active AND s.target_role "
            "AND COALESCE(s.ai_fit_score,s.fit_score,-1)>=70 "
            "AND COALESCE(p.posted_date,(p.first_seen_at AT TIME ZONE 'UTC')::date)>=%s::date",
            (user_sub, cutoff),
        )
        target_fresh = int(cur.fetchone()[0])
        cur.execute(
            "SELECT posting_id FROM career_user_applications "
            "WHERE user_sub=%s AND status='applied' ORDER BY posting_id",
            (user_sub,),
        )
        target_applied = [int(row[0]) for row in cur.fetchall()]
    source_fresh = int(source.execute(
        "SELECT COUNT(*) FROM postings WHERE active=1 AND COALESCE(target_role,0)=1 "
        "AND COALESCE(ai_fit_score,fit_score,-1)>=70 "
        "AND COALESCE(posted_date,date(first_seen_at))>=?",
        (cutoff,),
    ).fetchone()[0])
    source_applied = [int(row[0]) for row in source.execute(
        "SELECT id FROM postings WHERE status='applied' ORDER BY id"
    ).fetchall()]
    checks = {
        "topActive": {"sqlite": source_top, "postgres": target_top,
                      "match": source_top == target_top},
        "freshHighFit": {"sqlite": source_fresh, "postgres": target_fresh,
                         "match": source_fresh == target_fresh},
        "appliedPostingIds": {"sqlite": source_applied, "postgres": target_applied,
                              "match": source_applied == target_applied},
    }
    return checks


def user_report(source, target, user_sub: str) -> dict:
    app_fields = ",".join(APPLICATION_FIELDS)
    reports = {
        "scores": dataset(
            source, target, f"{user_sub}.scores", SCORE_FIELDS,
            "SELECT s.posting_id,s.fit_score,COALESCE(p.target_role,0) AS target_role,"
            "s.ai_fit_score,s.ai_fit_rationale,s.ai_fit_matched,s.ai_fit_gaps,s.ai_model,s.ai_scored_at "
            "FROM user_signals s JOIN corpus.postings_corpus p ON p.id=s.posting_id "
            "ORDER BY s.posting_id",
            f"SELECT {','.join(SCORE_FIELDS)} FROM career_user_job_scores "
            "WHERE user_sub=%s ORDER BY posting_id",
            target_params=(user_sub,),
        ),
        "applications": dataset(
            source, target, f"{user_sub}.applications", APPLICATION_FIELDS,
            f"SELECT {app_fields} FROM user_signals WHERE {APPLICATION_WHERE} ORDER BY posting_id",
            f"SELECT {app_fields} FROM career_user_applications WHERE user_sub=%s ORDER BY posting_id",
            target_params=(user_sub,),
        ),
        "recruiters": dataset(
            source, target, f"{user_sub}.recruiters", RECRUITER_FIELDS,
            f"SELECT {','.join(RECRUITER_FIELDS)} FROM recruiter_firms ORDER BY id",
            f"SELECT {','.join(RECRUITER_FIELDS)} FROM career_user_recruiter_firms "
            "WHERE user_sub=%s ORDER BY id",
            target_params=(user_sub,),
        ),
        "gaps": dataset(
            source, target, f"{user_sub}.gaps", GAP_FIELDS,
            f"SELECT {','.join(GAP_FIELDS)} FROM gap_themes ORDER BY key",
            f"SELECT {','.join(GAP_FIELDS)} FROM career_user_gap_themes "
            "WHERE user_sub=%s ORDER BY key",
            target_params=(user_sub,),
        ),
        "interviews": dataset(
            source, target, f"{user_sub}.interviews", INTERVIEW_FIELDS,
            "SELECT id AS source_id,at,company,role,transcript,answers,result,finalized "
            "FROM interview_assessments ORDER BY id",
            f"SELECT {','.join(INTERVIEW_FIELDS)} FROM career_user_interview_assessments "
            "WHERE user_sub=%s AND source_id IS NOT NULL ORDER BY source_id",
            target_params=(user_sub,),
        ),
    }
    with target.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM career_user_interview_assessments "
            "WHERE user_sub=%s AND source_id IS NULL",
            (user_sub,),
        )
        unmapped = int(cur.fetchone()[0])
    reports["interviews"]["postgresUnmapped"] = unmapped
    reports["interviews"]["match"] = reports["interviews"]["match"] and unmapped == 0
    reports["keyQueries"] = key_queries(source, target, user_sub)
    return reports


def all_match(value) -> bool:
    if isinstance(value, dict):
        own = value.get("match", True)
        return bool(own) and all(all_match(child) for child in value.values())
    if isinstance(value, list):
        return all(all_match(child) for child in value)
    return True


def build_report(root: Path, database_url: str, only_user: str | None) -> dict:
    import psycopg2

    users = [only_user] if only_user else list_users(root)
    if not users:
        raise RuntimeError("no SQLite user stores found")
    target = psycopg2.connect(database_url)
    try:
        with target.cursor() as cur:
            cur.execute("SELECT set_config('oshal.is_operator','on',false)")
        first = open_user(root, users[0])
        try:
            report = {
                "schemaVersion": 1,
                "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "corpus": corpus_report(first, target),
                "users": {},
            }
        finally:
            first.close()
        for user_sub in users:
            source = open_user(root, user_sub)
            try:
                report["users"][user_sub] = user_report(source, target, user_sub)
            finally:
                source.close()
        report["converged"] = all_match(report)
        target.rollback()
        return report
    finally:
        target.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--only-user")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--require-convergence", action="store_true")
    args = parser.parse_args()
    if not args.database_url:
        parser.error("--database-url or DATABASE_URL is required")
    report = build_report(args.data_root.resolve(), args.database_url, args.only_user)
    payload = json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    print("CAREER_CONVERGENCE_REPORT=" + payload)
    if args.require_convergence and not report["converged"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
