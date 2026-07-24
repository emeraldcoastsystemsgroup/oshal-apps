#!/usr/bin/env python3
"""
CHANGE LOG
-------------------------------------------------------------------------------
DATE/TIME           | AUTHOR                                      | DESCRIPTION
-------------------------------------------------------------------------------
2026-07-16 01:40:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Natural-key MERGE migrator for the Jobs-2026 cutover — the safe replacement for the drop-and-mirror sync (which would orphan other users' signals). Merges ONE native jobs.db into the shared swarm corpus + a SINGLE user's store by natural key (companies by name, postings by (company_id, ats_job_id)), never renumbering existing rows, so other tenants' user_signals references stay valid. Phased + idempotent + verified; other user stores are never opened.

WHY NOT _seed_corpus.py / sync_jobs_to_swarm.py: _seed_corpus is INSERT-OR-IGNORE with the
SOURCE's own ids — into a populated corpus that shares an id-space with OTHER users, that both
mis-maps company_ids and never reconciles. sync_jobs_to_swarm drops+reseeds corpus.db, which
re-points every other user's `user_signals.posting_id`. Both are unsafe once >1 user exists.

USAGE (inside the api container, cron quiescent):
  JOBHUNTER_MULTIUSER=1 OSHAL_USER_SUB=<sub> OSHAL_TENANT=default \
  JOBHUNTER_CORPUS_DB=/app/output/career-hunter-data/default/corpus.db \
  JOBHUNTER_USER_DB=/app/output/career-hunter-data/default/<sub>/user-<sub>.db \
  CAREER_SRC_DB=/tmp/jobs.db  MERGE_BACKUP_DIR=/app/output/career-hunter-data/_backups/<stamp> \
  python3 _merge_native.py <preflight|backup|corpus|user|verify|all>

Never renumbers/deletes swarm rows. Re-runnable after a partial failure (converges).
"""
from __future__ import annotations
import os, sys, json, re, glob, hashlib, sqlite3
from datetime import datetime, timezone

SUB = os.environ.get("OSHAL_USER_SUB", "")
CORPUS_DB = os.environ["JOBHUNTER_CORPUS_DB"]
USER_DB = os.environ["JOBHUNTER_USER_DB"]
SRC_DB = os.environ["CAREER_SRC_DB"]
STORE_DEFAULT = os.path.dirname(os.path.dirname(USER_DB))  # .../default
USER_DIR = os.path.dirname(USER_DB)
APP_DIR = os.path.join(USER_DIR, "applications")
BACKUP_DIR = os.environ.get("MERGE_BACKUP_DIR") or os.path.join(os.path.dirname(STORE_DEFAULT), "_backups", "adhoc")
WORK_DB = os.path.join(BACKUP_DIR, "migrate-map.db")

OBJ = ("title", "location", "remote", "department", "url", "description", "posted_at", "posted_date",
       "state", "city", "lat", "lon", "job_type", "target_role",
       "salary_min", "salary_max", "salary_currency", "salary_period", "salary_raw", "salary_source")
SIG = ("fit_score", "ai_fit_score", "ai_fit_rationale", "ai_fit_matched", "ai_fit_gaps", "ai_scored_at",
       "ai_model", "status", "resume_path", "cover_path", "generated_at", "promoted_at", "applied_at",
       "outreach_sent_at", "notes")


def log(msg: str) -> None:
    print(f"[merge {datetime.now(timezone.utc).isoformat(timespec='seconds')}] {msg}", flush=True)


def die(msg: str) -> None:
    print(f"!! MERGE ABORT: {msg}", file=sys.stderr, flush=True)
    sys.exit(1)


def connect_work() -> sqlite3.Connection:
    """Open the persistent work/map db as MAIN, ATTACH corpus (rw) + src (ro). NEVER open corpus.db
    standalone — its persisted company_view references `corpus.` and is malformed as main."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    c = sqlite3.connect(WORK_DB)
    c.execute("ATTACH DATABASE ? AS corpus", (CORPUS_DB,))
    c.execute("ATTACH DATABASE ? AS src", (f"file:{SRC_DB}?mode=ro",))
    c.execute("PRAGMA foreign_keys=OFF")
    return c


# ── preflight ────────────────────────────────────────────────────────────────
def phase_preflight() -> None:
    if not SUB or SUB.startswith("_") or SUB in ("default", "mock-user-001"):
        die(f"refusing to merge into a non-user sub: {SUB!r}")
    c = connect_work()
    n_null = c.execute("SELECT COUNT(*) FROM src.postings WHERE ats_job_id IS NULL OR ats_job_id=''").fetchone()[0]
    if n_null:
        die(f"{n_null} native postings have NULL/empty ats_job_id — the (company_id, ats_job_id) merge key is not total")
    # timestamp format uniformity — freshness compares are lexicographic ISO-8601
    bad = c.execute("""SELECT COUNT(*) FROM src.postings
                       WHERE (last_seen_at IS NOT NULL AND last_seen_at NOT LIKE '____-__-__T%')
                          OR (ai_scored_at IS NOT NULL AND ai_scored_at NOT LIKE '____-__-__T%')""").fetchone()[0]
    if bad:
        die(f"{bad} native rows have non-ISO last_seen_at/ai_scored_at — freshness compares would be unsafe")
    # single-writer: other user dbs are NOT opened; assert only ours + corpus are targets
    others = [d for d in os.listdir(STORE_DEFAULT)
              if os.path.isdir(os.path.join(STORE_DEFAULT, d)) and d != SUB and not d.startswith("_")]
    log(f"preflight OK — src postings ok, ISO timestamps ok. Other user stores (untouched): {others}")
    c.close()


# ── backups (sqlite backup API; WAL-folded, canonical) ─────────────────────────
def _backup_db(src_path: str, dst_path: str) -> str:
    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
    dst = sqlite3.connect(dst_path)
    with dst:
        src.backup(dst)
    src.close(); dst.close()
    h = hashlib.sha256(open(dst_path, "rb").read()).hexdigest()
    return h


def phase_backup() -> None:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    manifest = {"at": datetime.now(timezone.utc).isoformat(), "sub": SUB, "backups": {}, "other_users": {}}
    for path in [CORPUS_DB, USER_DB]:
        name = os.path.basename(path)
        manifest["backups"][name] = _backup_db(path, os.path.join(BACKUP_DIR, name))
    # OTHER users — image + a spot-join fixture so verify can prove they're untouched
    for d in sorted(os.listdir(STORE_DEFAULT)):
        udb = os.path.join(STORE_DEFAULT, d, f"user-{d}.db")
        if d == SUB or d.startswith("_") or not os.path.exists(udb):
            continue
        h = _backup_db(udb, os.path.join(BACKUP_DIR, f"user-{d}.db"))
        c = sqlite3.connect(f"file:{udb}?mode=ro", uri=True)
        c.execute("ATTACH DATABASE ? AS corpus", (f"file:{CORPUS_DB}?mode=ro",))
        cnt = c.execute("SELECT COUNT(*) FROM user_signals").fetchone()[0]
        spot = c.execute("""SELECT s.posting_id, s.ai_fit_score, p.title, co.name
                              FROM user_signals s JOIN corpus.postings_corpus p ON p.id=s.posting_id
                              JOIN corpus.companies co ON co.id=p.company_id
                             WHERE s.ai_fit_score IS NOT NULL ORDER BY s.posting_id LIMIT 20""").fetchall()
        c.close()
        manifest["other_users"][d] = {"sha256": h, "signals": cnt, "spot": spot}
    cdb = sqlite3.connect(f"file:{USER_DB}?mode=ro", uri=True)
    cdb.execute("ATTACH DATABASE ? AS corpus", (f"file:{CORPUS_DB}?mode=ro",))
    manifest["pre"] = {
        "corpus_postings": cdb.execute("SELECT COUNT(*) FROM corpus.postings_corpus").fetchone()[0],
        "corpus_companies": cdb.execute("SELECT COUNT(*) FROM corpus.companies").fetchone()[0],
        "user_signals": cdb.execute("SELECT COUNT(*) FROM user_signals").fetchone()[0],
    }
    cdb.close()
    json.dump(manifest, open(os.path.join(BACKUP_DIR, "manifest.json"), "w"), indent=2)
    log(f"backup OK -> {BACKUP_DIR} (corpus+user+{len(manifest['other_users'])} other-user images, manifest written)")


# ── corpus merge ───────────────────────────────────────────────────────────────
def phase_corpus() -> None:
    c = connect_work()
    # companies: insert missing by name, carry gsearched/referral (max), build src->dst map
    src_cols = {r[1] for r in c.execute("PRAGMA src.table_info(companies)")}
    dst_cols = {r[1] for r in c.execute("PRAGMA corpus.table_info(companies)")}
    cols = sorted((src_cols & dst_cols) - {"id"})
    c.execute(f"""INSERT INTO corpus.companies ({",".join(cols)})
                  SELECT {",".join("s."+x for x in cols)} FROM src.companies s
                  WHERE NOT EXISTS (SELECT 1 FROM corpus.companies c WHERE c.name = s.name)""")
    c.execute("CREATE TABLE IF NOT EXISTS main.company_map(src_id INTEGER PRIMARY KEY, dst_id INTEGER NOT NULL)")
    c.execute("""INSERT OR REPLACE INTO main.company_map
                 SELECT s.id, c.id FROM src.companies s JOIN corpus.companies c ON c.name = s.name""")
    if "gsearched" in src_cols and "gsearched" in dst_cols:
        c.execute("""UPDATE corpus.companies AS c SET gsearched = MAX(COALESCE(c.gsearched,0), COALESCE(s.gsearched,0))
                     FROM src.companies s JOIN main.company_map m ON m.src_id=s.id WHERE c.id=m.dst_id""")
    if "referral" in src_cols and "referral" in dst_cols:
        c.execute("""UPDATE corpus.companies AS c SET referral = MAX(COALESCE(c.referral,0), COALESCE(s.referral,0))
                     FROM src.companies s JOIN main.company_map m ON m.src_id=s.id WHERE c.id=m.dst_id""")
    c.commit()

    # posting map: existing matches by (dst company_id, ats_job_id)
    c.execute("CREATE TABLE IF NOT EXISTS main.posting_map(src_id INTEGER PRIMARY KEY, dst_id INTEGER NOT NULL, matched INTEGER)")
    c.execute("""INSERT OR REPLACE INTO main.posting_map
                 SELECT s.id, pc.id, 1 FROM src.postings s
                 JOIN main.company_map cm ON cm.src_id = s.company_id
                 JOIN corpus.postings_corpus pc ON pc.company_id=cm.dst_id AND pc.ats_job_id=s.ats_job_id""")
    # update matched objective fields — native wins only when strictly fresher (last_seen_at)
    nonsal = [x for x in OBJ if not x.startswith("salary")]
    c.execute(f"""UPDATE corpus.postings_corpus AS pc SET
                    {",".join(f"{x}=s.{x}" for x in nonsal)},
                    last_seen_at=s.last_seen_at, active=s.active,
                    first_seen_at=MIN(COALESCE(pc.first_seen_at,s.first_seen_at), COALESCE(s.first_seen_at,pc.first_seen_at))
                  FROM src.postings s JOIN main.posting_map m ON m.src_id=s.id AND m.matched=1
                  WHERE pc.id=m.dst_id AND COALESCE(s.last_seen_at,'') > COALESCE(pc.last_seen_at,'')""")
    # salary: source-rank then freshness
    c.execute("""UPDATE corpus.postings_corpus AS pc SET
                   salary_min=s.salary_min, salary_max=s.salary_max, salary_currency=s.salary_currency,
                   salary_period=s.salary_period, salary_raw=s.salary_raw, salary_source=s.salary_source
                 FROM src.postings s JOIN main.posting_map m ON m.src_id=s.id AND m.matched=1
                 WHERE pc.id=m.dst_id AND s.salary_source IS NOT NULL
                   AND (pc.salary_source IS NULL
                        OR (s.salary_source='listed' AND pc.salary_source='ai_estimated')
                        OR (s.salary_source=pc.salary_source AND COALESCE(s.last_seen_at,'') > COALESCE(pc.last_seen_at,'')))""")
    # insert new postings (swarm assigns ids), then map them
    c.execute(f"""INSERT INTO corpus.postings_corpus
                    (company_id, ats_job_id, {",".join(OBJ)}, first_seen_at, last_seen_at, active)
                  SELECT cm.dst_id, s.ats_job_id, {",".join("s."+x for x in OBJ)}, s.first_seen_at, s.last_seen_at, s.active
                  FROM src.postings s JOIN main.company_map cm ON cm.src_id=s.company_id
                  WHERE NOT EXISTS (SELECT 1 FROM main.posting_map m WHERE m.src_id=s.id)""")
    c.execute("""INSERT OR REPLACE INTO main.posting_map
                 SELECT s.id, pc.id, 0 FROM src.postings s
                 JOIN main.company_map cm ON cm.src_id=s.company_id
                 JOIN corpus.postings_corpus pc ON pc.company_id=cm.dst_id AND pc.ats_job_id=s.ats_job_id
                 WHERE s.id NOT IN (SELECT src_id FROM main.posting_map)""")
    c.commit()
    total = c.execute("SELECT COUNT(*) FROM main.posting_map").fetchone()[0]
    inserted = c.execute("SELECT COUNT(*) FROM main.posting_map WHERE matched=0").fetchone()[0]
    src_total = c.execute("SELECT COUNT(*) FROM src.postings").fetchone()[0]
    if total != src_total:
        die(f"posting_map covers {total} of {src_total} native postings — company-name drift? inspect before proceeding")
    log(f"corpus OK — companies mapped; postings mapped={total} (inserted={inserted}, matched={total-inserted})")
    c.close()


# ── user_signals merge (this SUB only) ─────────────────────────────────────────
def phase_user() -> None:
    c = sqlite3.connect(USER_DB)
    c.execute("ATTACH DATABASE ? AS corpus", (f"file:{CORPUS_DB}?mode=ro",))
    c.execute("ATTACH DATABASE ? AS src", (f"file:{SRC_DB}?mode=ro",))
    c.execute("ATTACH DATABASE ? AS work", (WORK_DB,))
    # single upsert; native wins except never downgrade a protected swarm status; AI group by newest ai_scored_at
    c.execute(f"""
      INSERT INTO user_signals (posting_id, {",".join(SIG)})
      SELECT m.dst_id, {",".join("s."+x for x in SIG)}
        FROM src.postings s JOIN work.posting_map m ON m.src_id = s.id
       -- ANY user signal qualifies. NB: the old _seed_corpus filter was fit/status/resume only,
       -- which silently dropped NOTES-ONLY rows (a posting whose only signal is a hand-written
       -- submission lesson, status still 'new') — 138 of the operator's lessons. Notes ARE the
       -- lessons-learned store, so they must carry.
       WHERE s.fit_score IS NOT NULL OR s.ai_fit_score IS NOT NULL
          OR (s.status IS NOT NULL AND s.status <> 'new')
          OR s.resume_path IS NOT NULL OR s.cover_path IS NOT NULL
          OR (s.notes IS NOT NULL AND s.notes <> '')
          OR s.applied_at IS NOT NULL OR s.generated_at IS NOT NULL
          OR s.promoted_at IS NOT NULL OR s.outreach_sent_at IS NOT NULL
      ON CONFLICT(posting_id) DO UPDATE SET
        status = CASE
          WHEN user_signals.status IN ('applied','interview','offer')
           AND instr(',applied,interview,offer,', ','||COALESCE(excluded.status,'')||',')=0 THEN user_signals.status
          WHEN user_signals.status='offer' THEN 'offer'
          WHEN user_signals.status='interview' AND excluded.status='applied' THEN 'interview'
          ELSE COALESCE(excluded.status, user_signals.status) END,
        applied_at   = COALESCE(excluded.applied_at,   user_signals.applied_at),
        promoted_at  = COALESCE(excluded.promoted_at,  user_signals.promoted_at),
        generated_at = COALESCE(excluded.generated_at, user_signals.generated_at),
        resume_path  = COALESCE(excluded.resume_path,  user_signals.resume_path),
        cover_path   = COALESCE(excluded.cover_path,   user_signals.cover_path),
        notes        = COALESCE(excluded.notes,        user_signals.notes),
        outreach_sent_at = COALESCE(excluded.outreach_sent_at, user_signals.outreach_sent_at),
        fit_score    = COALESCE(excluded.fit_score,    user_signals.fit_score),
        ai_fit_score     = CASE WHEN COALESCE(excluded.ai_scored_at,'') > COALESCE(user_signals.ai_scored_at,'') THEN excluded.ai_fit_score     ELSE user_signals.ai_fit_score     END,
        ai_fit_rationale = CASE WHEN COALESCE(excluded.ai_scored_at,'') > COALESCE(user_signals.ai_scored_at,'') THEN excluded.ai_fit_rationale ELSE user_signals.ai_fit_rationale END,
        ai_fit_matched   = CASE WHEN COALESCE(excluded.ai_scored_at,'') > COALESCE(user_signals.ai_scored_at,'') THEN excluded.ai_fit_matched   ELSE user_signals.ai_fit_matched   END,
        ai_fit_gaps      = CASE WHEN COALESCE(excluded.ai_scored_at,'') > COALESCE(user_signals.ai_scored_at,'') THEN excluded.ai_fit_gaps      ELSE user_signals.ai_fit_gaps      END,
        ai_model         = CASE WHEN COALESCE(excluded.ai_scored_at,'') > COALESCE(user_signals.ai_scored_at,'') THEN excluded.ai_model         ELSE user_signals.ai_model         END,
        ai_scored_at     = NULLIF(MAX(COALESCE(excluded.ai_scored_at,''), COALESCE(user_signals.ai_scored_at,'')), '')
    """)
    c.commit()
    # confirmation_path from packet folders (trailing __<nativeId>); repath Windows -> container
    _populate_confirmations(c)
    for col in ("resume_path", "cover_path", "confirmation_path"):
        c.execute(f"""UPDATE user_signals SET {col}=REPLACE(REPLACE({col},
                    'C:\\Users\\roger\\OneDrive\\Documents\\Jobs 2026\\job-hunter\\applications\\',
                    '{APP_DIR}/'), '\\', '/') WHERE {col} LIKE 'C:\\%'""")
    c.commit()
    log("user OK — signals upserted (native-wins, protected statuses preserved, AI newest-wins); confirmations + repath done")
    c.close()


def _populate_confirmations(c: sqlite3.Connection) -> None:
    if not os.path.isdir(APP_DIR):
        log("  (no applications/ dir yet — skip confirmation scan; run after the file-asset copy)")
        return
    w = sqlite3.connect(WORK_DB)
    idmap = {r[0]: r[1] for r in w.execute("SELECT src_id, dst_id FROM posting_map")}
    w.close()
    n = 0
    for folder in os.scandir(APP_DIR):
        m = re.search(r"__(\d+)$", folder.name)
        if not (folder.is_dir() and m):
            continue
        pngs = sorted(glob.glob(os.path.join(folder.path, "confirmation-*.png")))
        dst = idmap.get(int(m.group(1)))
        if pngs and dst:
            c.execute("UPDATE user_signals SET confirmation_path=COALESCE(confirmation_path,?) WHERE posting_id=?",
                      (pngs[-1], dst)); n += 1
    log(f"  confirmations: matched {n} packet folder(s) to postings")


# ── verify (hard PASS/FAIL) ────────────────────────────────────────────────────
def phase_verify() -> None:
    man = json.load(open(os.path.join(BACKUP_DIR, "manifest.json")))
    fail = []
    # 1) other users byte-identical (re-image + sha compare) + spot-join intact
    for d, info in man["other_users"].items():
        udb = os.path.join(STORE_DEFAULT, d, f"user-{d}.db")
        tmp = os.path.join(BACKUP_DIR, f"_verify-{d}.db")
        if _backup_db(udb, tmp) != info["sha256"]:
            fail.append(f"other user {d}: db changed (NOT byte-identical)")
        c = sqlite3.connect(f"file:{udb}?mode=ro", uri=True)
        c.execute("ATTACH DATABASE ? AS corpus", (f"file:{CORPUS_DB}?mode=ro",))
        spot = c.execute("""SELECT s.posting_id, s.ai_fit_score, p.title, co.name
                              FROM user_signals s JOIN corpus.postings_corpus p ON p.id=s.posting_id
                              JOIN corpus.companies co ON co.id=p.company_id
                             WHERE s.ai_fit_score IS NOT NULL ORDER BY s.posting_id LIMIT 20""").fetchall()
        c.close(); os.remove(tmp)
        if [list(x) for x in spot] != [list(x) for x in info["spot"]]:
            fail.append(f"other user {d}: spot-join drifted (corpus rows re-pointed!)")
    # 2) corpus arithmetic
    c = sqlite3.connect(f"file:{USER_DB}?mode=ro", uri=True)
    c.execute("ATTACH DATABASE ? AS corpus", (f"file:{CORPUS_DB}?mode=ro",))
    w = sqlite3.connect(f"file:{WORK_DB}?mode=ro", uri=True)
    inserted = w.execute("SELECT COUNT(*) FROM posting_map WHERE matched=0").fetchone()[0]; w.close()
    post_now = c.execute("SELECT COUNT(*) FROM corpus.postings_corpus").fetchone()[0]
    if post_now != man["pre"]["corpus_postings"] + inserted:
        fail.append(f"corpus arithmetic: {post_now} != {man['pre']['corpus_postings']}+{inserted}")
    # 3) no leftover Windows paths
    leftover = c.execute("""SELECT COUNT(*) FROM user_signals
                            WHERE resume_path LIKE 'C:\\%' OR cover_path LIKE 'C:\\%' OR confirmation_path LIKE 'C:\\%'""").fetchone()[0]
    if leftover:
        fail.append(f"{leftover} user rows still have Windows paths")
    # 4) status counts present (sanity floor)
    counts = dict(c.execute("SELECT COALESCE(status,'new'), COUNT(*) FROM user_signals GROUP BY 1").fetchall())
    c.close()
    log(f"verify: user status counts = {counts}")
    if fail:
        for f in fail:
            print(f"  FAIL: {f}", file=sys.stderr)
        die(f"{len(fail)} verification check(s) FAILED — restore from {BACKUP_DIR}")
    log("verify PASS — other users byte-identical + spot-join intact; corpus arithmetic ok; paths repathed")


PHASES = {"preflight": phase_preflight, "backup": phase_backup, "corpus": phase_corpus,
          "user": phase_user, "verify": phase_verify}


def main() -> None:
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    order = ["preflight", "backup", "corpus", "user", "verify"] if which == "all" else [which]
    for p in order:
        if p not in PHASES:
            die(f"unknown phase {p!r} (choose: {', '.join(PHASES)} | all)")
        log(f"--- phase {p} ---")
        PHASES[p]()
    log("done")


if __name__ == "__main__":
    main()
