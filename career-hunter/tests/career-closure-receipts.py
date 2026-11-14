"""CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Prove every job a complete source read stops listing is recorded with that read, a job the employer only re-keyed stays the same job (saved, applied and removed marks included), ambiguous matches stay closed and are counted, a partial read closes nothing, and a full pull leaves a receipt per source that scripts/closure-receipt.py prints read-only; all against real temporary SQLite with made-up employers and people.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
os.environ["JOBHUNTER_STORE"] = "sqlite"
os.environ["JOBHUNTER_MULTIUSER"] = "1"
from jobhunter import ats, cli, config, db, match, source_maintenance, source_memory as memory, source_review

# The kernel reads the pull's summary with this expression (oshal-kernel crates/oshald/src/career_ingest.rs).
KERNEL_SUMMARY = r"^Scrape done: ([0-9]+) new, ([0-9]+) refreshed, ([0-9]+) closed\."
KERNEL_SOURCES = r"Sources: ([0-9]+) confirmed, ([0-9]+) unconfirmed\."


def job(key, title, location, remote=0):
    return dict(ats_job_id=key, title=title, location=location, remote=remote, department=None,
                url="https://jobs.example/" + key.strip("/"), description=f"{title} for a made-up employer")


# The old page reader stored a path holding the employer's requisition number.
OLD = [job("/job/Chicago-IL/Payroll-Analyst_R10001", "Payroll Analyst", "Chicago, IL"),
       job("/job/Austin-TX/Field-Technician_R-10002", "Field Technician", "Austin, TX"),
       job("/job/Remote/Data-Engineer_R10003", "Data Engineer", "Remote", remote=1),
       job("/job/Denver-CO/Store-Manager_R10004", "Store Manager", "Denver, CO"),
       job("/job/Miami-FL/Cashier_R10005", "Cashier", "Miami, FL")]
# The same board after the source moved to a reader keyed by requisition number: three re-keyed (the place written
# another way, the title in another case), one with the same number and another title (ambiguous), one gone, one new.
NEW = [job("10001", "Payroll Analyst", "Chicago, Illinois, United States"),
       job("R10002", "Field Technician", "Austin, Texas"),
       job("10003", "Data engineer", "Remote", remote=1),
       job("10004", "Store Manager II", "Denver, CO"),
       job("10099", "Recruiter", "Tampa, FL")]


class Store(unittest.TestCase):
    """A real corpus and one made-up person's store, both temporary SQLite files."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        for name, value in {"CORPUS_DB": root / "corpus.db", "USER_DB": root / "user.db", "DATA_DIR": root,
                            "CAREER_DB": root / "career_db.json", "POSTGRES": False, "MULTIUSER": True}.items():
            patcher = patch.object(config, name, value, create=True)
            patcher.start()
            self.addCleanup(patcher.stop)
        db._multiuser_inited.clear()
        self.addCleanup(db._multiuser_inited.clear)
        self.addCleanup(db._portable_paths.clear)
        db.init_db()
        with db.connect() as conn:
            conn.execute("INSERT INTO companies(id,name,ats_type,ats_token) VALUES(1,'Made-up Employer','jibe','fixture-one')")
            conn.execute("INSERT INTO companies(id,name,ats_type,ats_token) VALUES(2,'Other Made-up Employer','jibe','fixture-two')")

    def ingest(self, rows, company=1, complete=True, reason=None):
        feed = memory.Feed(rows, complete=complete, reason=reason or ("" if complete else "pagination_incomplete"))
        with db.connect() as conn:
            return memory.ingest(conn, company, feed)

    def ids(self, company=1):
        """Posting id by key, for the keys first stored."""
        with db.connect() as conn:
            return {r["ats_job_id"]: r["id"] for r in conn.execute(
                "SELECT id,ats_job_id FROM corpus.postings_corpus WHERE company_id=?", (company,))}

    def posting(self, posting_id):
        with db.connect() as conn:
            return dict(conn.execute("SELECT * FROM corpus.postings_corpus WHERE id=?", (posting_id,)).fetchone())

    def closures(self):
        with db.connect() as conn:
            return {r["posting_id"]: dict(r) for r in conn.execute("SELECT * FROM corpus.posting_closures")}

    def last_attempt(self, company=1):
        with db.connect() as conn:
            return conn.execute("SELECT attempt_id FROM corpus.source_pull_runs WHERE company_id=? "
                                "ORDER BY completed_at DESC LIMIT 1", (company,)).fetchone()["attempt_id"]

    def active_keys(self, company=1):
        with db.connect() as conn:
            return sorted(r[0] for r in conn.execute(
                "SELECT ats_job_id FROM corpus.postings_corpus WHERE company_id=? AND active=1", (company,)))


class AReadThatReKeys(Store):
    def test_each_job_the_read_stops_listing_is_recorded_with_that_read(self):
        self.ingest(OLD)
        old = self.ids()
        out = self.ingest(NEW)
        attempt = self.last_attempt()
        self.assertEqual((out["new"], out["rekeyed"], out["closed"], out["possible_rekey"]), (2, 3, 2, 1), out)
        records = self.closures()
        self.assertEqual(set(records), set(old.values()), "one record for each job the read stopped listing")
        for record in records.values():
            self.assertEqual(record["attempt_id"], attempt, "the read that did it")
            self.assertRegex(record["closed_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d")
        cashier = records[old["/job/Miami-FL/Cashier_R10005"]]
        self.assertEqual((cashier["outcome"], cashier["possible_rekey"], cashier["successor_id"]), ("closed", None, None))
        manager = records[old["/job/Denver-CO/Store-Manager_R10004"]]
        self.assertEqual((manager["outcome"], manager["possible_rekey"]), ("closed", "title-differs"))
        self.assertEqual(manager["successor_key"], "10004", "the ambiguous match is named, not followed")
        with db.connect() as conn:
            run = dict(conn.execute("SELECT new_count,closed_count FROM corpus.source_pull_runs WHERE attempt_id=?",
                                    (attempt,)).fetchone())
        self.assertEqual(run, {"new_count": 2, "closed_count": 2}, "a re-keyed job is neither new nor closed")

    def test_a_rekeyed_job_keeps_its_id_and_takes_the_new_key_and_listing(self):
        self.ingest(OLD)
        old = self.ids()
        self.ingest(NEW)
        records = self.closures()
        for path, key in (("/job/Chicago-IL/Payroll-Analyst_R10001", "10001"),
                          ("/job/Austin-TX/Field-Technician_R-10002", "R10002"),
                          ("/job/Remote/Data-Engineer_R10003", "10003")):
            posting = self.posting(old[path])
            self.assertEqual((posting["ats_job_id"], posting["active"], posting["url"]),
                             (key, 1, "https://jobs.example/" + key), path)
            record = records[old[path]]
            self.assertEqual((record["outcome"], record["possible_rekey"], record["ats_job_id"],
                              record["successor_key"], record["successor_id"]),
                             ("rekeyed", None, path, key, old[path]), path)
        self.assertEqual(self.posting(old["/job/Chicago-IL/Payroll-Analyst_R10001"])["location"],
                         "Chicago, Illinois, United States", "the listing as the employer now writes it")
        self.assertEqual(self.active_keys(), ["10001", "10003", "10004", "10099", "R10002"])
        self.assertEqual(len(self.ids()), 7, "no second row for a re-keyed job: 5 first stored + 2 genuinely new")
        with db.connect() as conn:
            found = [r[0] for r in conn.execute("SELECT rowid FROM corpus.postings_fts WHERE postings_fts MATCH 'payroll'")]
        self.assertEqual(found, [old["/job/Chicago-IL/Payroll-Analyst_R10001"]], "search finds the job once, by its kept id")

    def test_a_partial_or_unconfirmed_read_closes_and_records_nothing(self):
        self.ingest(OLD)
        for feed in (memory.Feed(NEW[:2], reason="pagination_incomplete"), memory.Feed([], complete=True),
                     memory.Feed([*NEW, {"ats_job_id": "bad"}], complete=True)):
            with db.connect() as conn:
                out = memory.ingest(conn, 1, feed)
            self.assertEqual((out["closed"], out["rekeyed"], out["possible_rekey"]), (0, 0, 0))
        self.assertEqual(self.closures(), {}, "only a complete read may close, and only a close is recorded")
        self.assertLessEqual({row["ats_job_id"] for row in OLD}, set(self.active_keys()), "every first-stored job stays open")

    def test_a_successor_an_earlier_partial_read_listed_is_a_possible_rekey(self):
        self.ingest(OLD)
        self.ingest(NEW, complete=False)
        out = self.ingest(NEW)
        self.assertEqual((out["rekeyed"], out["possible_rekey"], out["closed"]), (0, 4, 5), out)
        reasons = sorted(r["possible_rekey"] or "" for r in self.closures().values())
        self.assertEqual(reasons, ["", "listed-before", "listed-before", "listed-before", "title-differs"])

    def test_two_successors_or_one_successor_for_two_jobs_stay_closed(self):
        self.ingest([job("/job/Tulsa-OK/Welder_R20001", "Welder", "Tulsa, OK"),
                     job("/job/Reno-NV/Nurse_R30001", "Nurse", "Reno, NV"),
                     job("/job/Reno-NV/Nurse_R30001?src=referral", "Nurse", "Reno, NV")])
        out = self.ingest([job("20001", "Welder", "Tulsa, OK"), job("JR-20001", "Welder", "Tulsa, OK"),
                           job("30001", "Nurse", "Reno, NV")])
        self.assertEqual((out["rekeyed"], out["possible_rekey"], out["closed"], out["new"]), (0, 3, 3, 3), out)
        reasons = sorted(r["possible_rekey"] for r in self.closures().values())
        self.assertEqual(reasons, ["several-successors", "shared-successor", "shared-successor"])

    def test_the_same_number_and_title_in_another_place_stays_closed(self):
        self.ingest([job("/job/Tulsa-OK/Welder_R20001", "Welder", "Tulsa, OK"),
                     job("/job/Remote/Writer_R20002", "Writer", "Remote", remote=1)])
        out = self.ingest([job("20001", "Welder", "Dallas, TX"), job("20002", "Writer", "Boise, ID")])
        self.assertEqual((out["rekeyed"], out["possible_rekey"], out["closed"]), (0, 2, 2), out)
        self.assertEqual(sorted(r["possible_rekey"] for r in self.closures().values()), ["place-differs", "place-differs"])

    def test_a_possible_match_names_the_job_that_now_carries_its_key(self):
        self.ingest([job("/job/Denver-CO/Store-Manager_R10004", "Store Manager", "Denver, CO"),
                     job("/job/Denver-CO/Store-Manager-II_R10004", "Store Manager II", "Denver, CO")])
        old = self.ids()
        self.ingest([job("10004", "Store Manager II", "Denver, CO")])
        kept = old["/job/Denver-CO/Store-Manager-II_R10004"]
        record = self.closures()[old["/job/Denver-CO/Store-Manager_R10004"]]
        self.assertEqual((record["possible_rekey"], record["successor_id"], record["successor_key"]),
                         ("title-differs", kept, "10004"))
        self.assertEqual(self.posting(kept)["ats_job_id"], "10004")

    def test_another_employers_jobs_are_never_a_successor(self):
        self.ingest([job("/job/Boise-ID/Driver_R40001", "Driver", "Boise, ID")])
        self.ingest([job("40001", "Driver", "Boise, ID")], company=2)
        out = self.ingest([job("/job/Boise-ID/Other_R1", "Other", "Boise, ID")])
        self.assertEqual((out["rekeyed"], out["possible_rekey"], out["closed"]), (0, 0, 1))


class RequisitionNumbers(unittest.TestCase):
    def test_the_number_a_key_or_link_carries(self):
        from jobhunter import closures
        cases = {("/job/Chicago-IL/Payroll-Analyst_R10001", None): "10001", ("R-10002", None): "10002",
                 ("JR0010003-1", None): "10003", ("10004", None): "10004",
                 ("https://careers.example.com/careers-home/jobs/10004?lang=en-us", None): "10004",
                 ("https://careers.example.com/apply?jobId=10005&src=li", None): "10005",
                 ("/job/X/Analyst_R30001?src=referral", None): "30001",
                 ("6f1c2d3e-4821-4a5b-9c7d-8e9f01234567", None): None,
                 ("Payroll Analyst", "https://jobs.example/job/10006"): "10006",
                 ("123", None): None, ("careers2024", None): None, (None, None): None}
        for (key, url), expected in cases.items():
            self.assertEqual(closures.requisition_number(key, url), expected, key)


class APersonsJob(Store):
    """A made-up person's marks are keyed by posting id, as are their saved and preparation records."""

    def mark(self, posting_id, **fields):
        with db.connect() as conn:
            db.user_set(conn, posting_id, **fields)

    def mine(self, posting_id):
        with db.connect() as conn:
            return dict(conn.execute("SELECT active,status,url FROM postings WHERE id=?", (posting_id,)).fetchone())

    def test_a_saved_or_applied_job_follows_its_successor_and_a_gone_one_shows_closed(self):
        self.ingest(OLD)
        old = self.ids()
        saved, applied, gone = (old["/job/Chicago-IL/Payroll-Analyst_R10001"], old["/job/Austin-TX/Field-Technician_R-10002"],
                                old["/job/Miami-FL/Cashier_R10005"])
        self.mark(saved, status="promoted", promoted_at="2026-11-01T00:00:00+00:00")
        self.mark(applied, status="applied", applied_at="2026-11-02T00:00:00+00:00")
        self.mark(gone, status="promoted", promoted_at="2026-11-03T00:00:00+00:00")
        self.ingest(NEW)
        self.assertEqual(self.mine(saved), {"active": 1, "status": "promoted", "url": "https://jobs.example/10001"})
        self.assertEqual(self.mine(applied), {"active": 1, "status": "applied", "url": "https://jobs.example/R10002"})
        self.assertEqual(self.mine(gone)["active"], 0, "a job the employer took down still shows as no longer active")

    def test_a_removed_job_does_not_come_back_when_it_is_rekeyed(self):
        self.ingest(OLD)
        removed = self.ids()["/job/Remote/Data-Engineer_R10003"]
        self.mark(removed, status="dismissed")
        self.assertEqual(match.rescore_new(), 4, "the person's first match: every open job but the removed one")
        self.ingest(NEW)
        self.assertEqual(match.rescore_new(), 2, "the next night matches only the two genuinely new jobs")
        self.assertEqual(self.mine(removed)["status"], "dismissed")
        with db.connect() as conn:
            pending = conn.execute("SELECT COUNT(*) FROM postings WHERE active=1 AND status='new' AND fit_score IS NULL").fetchone()[0]
            same = conn.execute("SELECT COUNT(*) FROM corpus.postings_corpus WHERE active=1 AND title LIKE 'Data engineer'").fetchone()[0]
        self.assertEqual((pending, same), (0, 1), "the vacancy is listed once, as the job the person removed")


class AFullPull(Store):
    """`scrape --all` with the employer's board replaced by a fixture feed: two nights, the second one re-keys."""

    def pull(self, feeds):
        def fetch(_ats_type, token):
            return memory.Feed(feeds[token], complete=True, reason=None)
        out = StringIO()
        with patch.object(ats, "fetch", fetch), patch.object(source_review, "after_pull", lambda _since: None), \
                patch.object(source_maintenance, "after_pull", lambda _since: None), redirect_stdout(out):
            cli.main(["scrape", "--all"])
        return out.getvalue()

    def receipts(self):
        with db.connect() as conn:
            return [json.loads(r[0]) for r in conn.execute("SELECT receipt FROM corpus.closure_receipts ORDER BY pull_started_at")]

    def read_receipt(self):
        """The operator's read-only reader (scripts/closure-receipt.py) over this corpus."""
        done = subprocess.run([sys.executable, str(ROOT / "scripts" / "closure-receipt.py"), str(config.CORPUS_DB)],
                              capture_output=True, text=True, timeout=60)
        return done.returncode, done.stdout

    def test_each_full_pull_writes_a_receipt_with_counts_per_source(self):
        self.assertEqual(self.read_receipt(), (1, "No closure receipt yet: no full pull has finished on a Career "
                                                  "version with closure receipts.\n"))
        other = [job("/job/Ogden-UT/Clerk_R50001", "Clerk", "Ogden, UT")]
        self.pull({"fixture-one": OLD, "fixture-two": other})
        with db.connect() as conn:  # the first night's receipt, as written a day earlier
            conn.execute("UPDATE corpus.closure_receipts SET pull_started_at='2026-11-12T00:00:00+00:00'")
        output = self.pull({"fixture-one": NEW, "fixture-two": other})
        line = next(line for line in output.splitlines() if line.startswith("Scrape done:"))
        self.assertRegex(line, KERNEL_SUMMARY)
        self.assertRegex(line, KERNEL_SOURCES)
        self.assertEqual(re.match(KERNEL_SUMMARY, line).groups(), ("2", "1", "2"))
        self.assertIn("3 re-keyed (kept as the same job); 1 of the closed may be re-keyed.", line)
        self.assertLessEqual(len(line), 240, "the kernel keeps 240 characters of the summary")
        receipts = self.receipts()
        self.assertEqual(len(receipts), 2, "one receipt for each full pull")
        receipt = receipts[-1]
        self.assertEqual(receipt["totals"], {"wentInactive": 2, "closed": 1, "possibleRekey": 1, "rekeyed": 3,
                                             "sourceRunsClosed": 2, "sources": 1})
        self.assertEqual(receipt["sources"], [{"companyId": 1, "name": "Made-up Employer", "reader": "jibe",
                                               "wentInactive": 2, "closed": 1, "possibleRekey": 1, "rekeyed": 3}])
        self.assertEqual(receipts[0]["totals"]["wentInactive"], 0)
        self.assertIn("Closure receipt: 1 closed, 3 re-keyed, 1 closed with a possible re-key, across 1 source.", output)
        code, printed = self.read_receipt()
        self.assertEqual(code, 0)
        self.assertEqual(printed.splitlines()[1:], ["  Made-up Employer (jibe): 1 closed, 1 possible re-key, 3 re-keyed"])
        self.assertRegex(printed.splitlines()[0], r"^Pull started \S+: 1 closed, 1 closed but possibly re-keyed, 3 re-keyed "
                                                   r"\(kept as the same job\), across 1 sources\. Reads reported 2 closed; "
                                                   r"the records add up to 2\.$")


def saved_fixture(folder):
    """For the node test: a corpus and a person's store after a re-key, read by the shipped saved-jobs board query."""
    root = Path(folder)
    with patch.object(config, "CORPUS_DB", root / "corpus.db"), patch.object(config, "USER_DB", root / "user.db"), \
            patch.object(config, "POSTGRES", False), patch.object(config, "MULTIUSER", True):
        db.init_db()
        with db.connect() as conn:
            conn.execute("INSERT INTO companies(id,name,ats_type,ats_token) VALUES(1,'Made-up Employer','jibe','fixture-one')")
            memory.ingest(conn, 1, memory.Feed(OLD, complete=True, reason=None))
            ids = {r["ats_job_id"]: r["id"] for r in conn.execute("SELECT id,ats_job_id FROM corpus.postings_corpus")}
            saved, gone = ids["/job/Chicago-IL/Payroll-Analyst_R10001"], ids["/job/Miami-FL/Cashier_R10005"]
            for posting_id in (saved, gone):
                db.user_set(conn, posting_id, status="promoted", fit_score=80)
        with db.connect() as conn:
            memory.ingest(conn, 1, memory.Feed(NEW, complete=True, reason=None))
    print(json.dumps({"saved": saved, "gone": gone}))


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--saved-fixture":
        saved_fixture(sys.argv[2])
    else:
        unittest.main()
