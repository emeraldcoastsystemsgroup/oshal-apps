"""CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Prove a stopped pull continues: a real process is really killed inside each stage of a pull over a real temporary SQLite corpus, and the next process reads only what the first did not finish.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
os.environ["JOBHUNTER_STORE"] = "sqlite"
os.environ["JOBHUNTER_MULTIUSER"] = "1"
from jobhunter import cli, config, db, pull_checkpoint as checkpoint, source_memory as memory, source_review as review

# A real `scrape --all` in its own process, with the network replaced by each source's token being its feed. The process
# kills itself at the stage named in KILL, as a restart would: no handler runs and nothing is flushed or closed.
CHILD = r"""
import json, os, signal, sys
from jobhunter import ats, cli, db, pull_checkpoint as checkpoint, source_memory as memory, source_review as review
log, plan = open(os.environ["FETCH_LOG"], "a"), json.loads(os.environ["PLAN"])

def die(stage, token):
    if plan.get("kill") == [stage, token]:
        os.kill(os.getpid(), signal.SIGKILL)

def fetch(ats_type, token):
    log.write(token + "\n"); log.flush()
    die("reading", token)
    behaviour = plan.get("feeds", {}).get(token, "ok")
    if behaviour == "error":
        raise RuntimeError("fixture refusal")
    if behaviour == "empty":
        return memory.Feed([], reason="empty_unconfirmed")
    return memory.Feed([{"ats_job_id": token + "-1", "title": "Role at " + token, "url": "https://jobs.example/" + token}], complete=True, reason=None)

ingest = memory.ingest
def ingest_then_die(conn, company_id, rows):
    counts = ingest(conn, company_id, rows)
    die("writing", rows[0]["ats_job_id"].rsplit("-", 1)[0])
    return counts

settle = checkpoint.Pull.settle
def settle_then_die(self, conn, company_id, **counts):
    settle(self, conn, company_id, **counts)
    die("settled", conn.execute(f"SELECT name FROM {db.companies_table()} WHERE id=?", (company_id,)).fetchone()["name"])

def after_pull(since):
    print("REVIEW SINCE " + since, flush=True)
    die("reviewing", "review")

report = review._report
def report_then_die(*args):
    done = report(*args)
    die("reporting", "review")
    return done

ats.fetch, memory.ingest, checkpoint.Pull.settle, review._report = fetch, ingest_then_die, settle_then_die, report_then_die
if not plan.get("real_review"):
    review.after_pull = after_pull
sys.argv = ["jobhunter", "scrape", "--all", *plan.get("args", [])]
cli.main()
"""


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.env = {"JOBHUNTER_CORPUS_DB": str(root / "corpus.db"), "JOBHUNTER_USER_DB": str(root / "ingest.db"),
                    "JOBHUNTER_DATA": str(root), "JOBHUNTER_STORE": "sqlite", "JOBHUNTER_MULTIUSER": "1",
                    "FETCH_LOG": str(root / "fetched.log"), "PATH": os.environ.get("PATH", ""), "HOME": str(root),
                    "PYTHONDONTWRITEBYTECODE": "1", "PYTHONPATH": os.pathsep.join([str(ROOT / "engine"), *os.environ.get("PYTHONPATH", "").split(os.pathsep)])}
        self.fetched_log = root / "fetched.log"
        patches = {"CORPUS_DB": root / "corpus.db", "USER_DB": root / "ingest.db", "DATA_DIR": root, "POSTGRES": False, "MULTIUSER": True}
        for name, value in patches.items():
            patcher = patch.object(config, name, value, create=True)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(db._portable_paths.clear)
        db.init_db()
        self.names = ["aaa", "bbb", "ccc", "ddd"]
        with db.connect() as conn:
            for name in self.names:
                conn.execute(f"INSERT INTO {db.companies_table()} (name,ats_type,ats_token) VALUES (?,?,?)", (name, "greenhouse", name))

    def run_pull(self, **plan):
        """One whole process; returns its exit code and output."""
        env = {**self.env, "PLAN": json.dumps(plan)}
        done = subprocess.run([sys.executable, "-c", CHILD], env=env, capture_output=True, text=True, timeout=60, cwd=self.temp.name)
        self.assertNotIn("Traceback", done.stderr, done.stderr)
        return done.returncode, done.stdout

    def reads(self):
        """The sources read since the last call, in order."""
        text = self.fetched_log.read_text() if self.fetched_log.exists() else ""
        self.fetched_log.write_text("")
        return text.split()

    def jobs(self):
        with db.connect() as conn:
            return sorted(row["title"] for row in conn.execute(f"SELECT title FROM {db.corpus_table()}").fetchall())

    def row(self):
        with db.connect() as conn:
            return dict(conn.execute(f"SELECT * FROM {memory.table('pull_checkpoint')}").fetchone())

    def age_pull(self, hours):
        started = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat(timespec="seconds")
        with db.connect() as conn:
            conn.execute(f"UPDATE {memory.table('pull_checkpoint')} SET started_at=?", (started,))
        return started

    def assert_healthy(self):
        corpus = Path(self.env["JOBHUNTER_CORPUS_DB"])
        self.assertFalse(corpus.with_name("corpus.db-journal").exists(), "the kernel refuses to publish over a journal")
        self.assertFalse(corpus.with_name("corpus.db-wal").exists())
        with db.connect() as conn:
            self.assertEqual(conn.execute("PRAGMA corpus.integrity_check").fetchone()[0], "ok")


class AKilledPull(Base):
    def test_a_kill_between_sources_reads_only_what_was_not_finished(self):
        code, _ = self.run_pull(kill=["reading", "ccc"])
        self.assertEqual(code, -9, "the process really was killed")
        self.assertEqual(self.reads(), ["aaa", "bbb", "ccc"])
        self.assertEqual(self.jobs(), ["Role at aaa", "Role at bbb"], "what finished is in the copy")

        code, output = self.run_pull()
        self.assertEqual(code, 0, output)
        self.assertEqual(self.reads(), ["ccc", "ddd"], "aaa and bbb are not read again")
        self.assertEqual(self.jobs(), [f"Role at {name}" for name in self.names])
        self.assert_healthy()

    def test_a_kill_while_writing_a_source_undoes_it_and_reads_it_again(self):
        code, _ = self.run_pull(kill=["writing", "bbb"])
        self.assertEqual(code, -9)
        self.assertEqual(self.jobs(), ["Role at aaa"], "the half-written source rolled back, with its note")
        self.reads()

        code, output = self.run_pull()
        self.assertEqual(code, 0, output)
        self.assertEqual(self.reads(), ["bbb", "ccc", "ddd"], "the source whose write did not commit is read again")
        self.assertEqual(self.jobs(), [f"Role at {name}" for name in self.names])
        self.assert_healthy()

    def test_an_employers_jobs_and_its_note_commit_together(self):
        # Killed with both written and neither committed: were they two commits, the jobs would already be there.
        code, _ = self.run_pull(kill=["settled", "bbb"])
        self.assertEqual(code, -9)
        self.assertEqual(self.jobs(), ["Role at aaa"], "neither the jobs nor the note survive")
        self.reads()
        self.run_pull()
        self.assertEqual(self.reads(), ["bbb", "ccc", "ddd"])
        self.assertEqual(self.jobs(), [f"Role at {name}" for name in self.names])

    def test_the_summary_counts_every_process_and_says_it_continued(self):
        self.run_pull(kill=["reading", "bbb"])
        self.run_pull(kill=["reading", "ddd"])
        code, output = self.run_pull()
        self.assertEqual(code, 0, output)
        self.assertIn("Scrape done: 4 new, 0 refreshed, 0 closed. Sources: 4 confirmed, 0 unconfirmed. Continued after 2 interruptions.", output)
        self.assertIn("Continuing the pull started", output)

    def test_the_kernels_summary_patterns_still_match(self):
        self.run_pull(kill=["reading", "bbb"])
        _, output = self.run_pull()
        line = next(line for line in output.splitlines() if line.startswith("Scrape done:"))
        self.assertRegex(line, r"^Scrape done: ([0-9]+) new, ([0-9]+) refreshed, ([0-9]+) closed\.")
        self.assertRegex(line, r"Sources: ([0-9]+) confirmed, ([0-9]+) unconfirmed\.")
        self.assertIn("Continued after 1 interruption.", line)

    def test_sources_that_failed_or_read_empty_are_not_tried_again(self):
        feeds = {"aaa": "error", "bbb": "empty"}
        self.run_pull(feeds=feeds, kill=["reading", "ddd"])
        self.assertEqual(self.reads(), ["aaa", "bbb", "ccc", "ddd"])
        code, output = self.run_pull(feeds=feeds)
        self.assertEqual(code, 0, output)
        self.assertEqual(self.reads(), ["ddd"])
        self.assertIn("Scrape done: 2 new, 0 refreshed, 0 closed. Sources: 2 confirmed, 2 unconfirmed.", output)

    def test_the_review_covers_the_pull_from_its_first_start(self):
        self.run_pull(kill=["reading", "ccc"])
        started = self.age_pull(1)  # Both processes would otherwise share one second, and any start time would pass.
        _, output = self.run_pull()
        self.assertIn(f"REVIEW SINCE {started}", output)

    def test_a_kill_during_the_review_only_runs_the_review_again(self):
        code, _ = self.run_pull(kill=["reviewing", "review"])
        self.assertEqual(code, -9)
        self.reads()
        code, output = self.run_pull()
        self.assertEqual(code, 0, output)
        self.assertEqual(self.reads(), [], "every source was already finished")
        self.assertIn("REVIEW SINCE", output)
        self.assertIn("Scrape done: 4 new", output)


    def test_the_real_review_killed_midway_runs_again_and_reports_once(self):
        code, _ = self.run_pull(real_review=True, kill=["reporting", "review"])
        self.assertEqual(code, -9)
        with db.connect() as conn:
            memory_runs = memory.table("source_review_runs")
            self.assertEqual(conn.execute(f"SELECT COUNT(*) AS n FROM {memory_runs}").fetchone()["n"], 0, "the killed review wrote nothing")
        self.reads()
        code, output = self.run_pull(real_review=True)
        self.assertEqual(code, 0, output)
        self.assertEqual(self.reads(), [], "every source was already finished")
        self.assertIn("Source review:", output)
        with db.connect() as conn:
            self.assertEqual(conn.execute(f"SELECT COUNT(*) AS n FROM {memory_runs}").fetchone()["n"], 1)
            report = json.loads(conn.execute(f"SELECT report FROM {memory_runs}").fetchone()["report"])
        self.assertEqual(report["delta"]["new"], 4, "the report covers the whole pull, not only the last process")
        self.assert_healthy()


class WhenItStartsOver(Base):
    def test_a_finished_pull_is_followed_by_a_new_one_that_reads_everything(self):
        self.run_pull()
        self.assertIsNotNone(self.row()["finished_at"], "the published corpus carries a finished pull")
        self.reads()
        code, output = self.run_pull()
        self.assertEqual(code, 0, output)
        self.assertEqual(self.reads(), self.names)
        self.assertNotIn("Continu", output)
        self.assertEqual(self.row()["resumes"], 0)

    def test_a_finished_pull_leaves_nothing_of_its_sources_behind(self):
        self.run_pull()
        with db.connect() as conn:
            self.assertEqual(conn.execute(f"SELECT COUNT(*) AS n FROM {memory.table('pull_checkpoint_sources')}").fetchone()["n"], 0)

    def test_a_pull_stopped_too_long_ago_is_read_again_keeping_its_jobs(self):
        self.run_pull(kill=["reading", "ccc"])
        self.reads()
        self.age_pull(checkpoint.MAX_AGE_HOURS + 1)
        code, output = self.run_pull()
        self.assertEqual(code, 0, output)
        self.assertEqual(self.reads(), self.names, "last night's reads are not carried into tonight's")
        self.assertEqual(self.jobs(), [f"Role at {name}" for name in self.names])

    def test_a_new_pull_owes_nothing_to_the_old_one_it_replaced(self):
        self.run_pull(kill=["reading", "ccc"])
        self.age_pull(checkpoint.MAX_AGE_HOURS + 1)
        self.run_pull(kill=["reading", "bbb"])
        self.reads()
        code, output = self.run_pull()
        self.assertEqual(code, 0, output)
        self.assertEqual(self.reads(), ["bbb", "ccc", "ddd"], "bbb finished only in the old pull, so it is still owed")
        self.assertIn("Scrape done: 2 new, 2 refreshed, 0 closed. Sources: 4 confirmed, 0 unconfirmed.", output)

    def test_a_pull_stopped_recently_is_continued(self):
        self.run_pull(kill=["reading", "ccc"])
        self.reads()
        self.age_pull(checkpoint.MAX_AGE_HOURS - 1)
        self.run_pull()
        self.assertEqual(self.reads(), ["ccc", "ddd"])

    def test_fresh_reads_everything_even_when_a_stopped_pull_could_continue(self):
        self.run_pull(kill=["reading", "bbb"])
        self.reads()
        code, output = self.run_pull(args=["--fresh"])
        self.assertEqual(code, 0, output)
        self.assertEqual(self.reads(), self.names)
        self.assertNotIn("Continuing", output)

    def test_an_unreadable_start_time_starts_a_new_pull(self):
        self.run_pull(kill=["reading", "ccc"])
        self.reads()
        with db.connect() as conn:
            conn.execute(f"UPDATE {memory.table('pull_checkpoint')} SET started_at='not a time'")
        self.run_pull()
        self.assertEqual(self.reads(), self.names)


class ASourceThatKeepsStoppingThePull(Base):
    def test_it_is_skipped_after_three_attempts_and_the_rest_still_publish(self):
        for _ in range(checkpoint.MAX_ATTEMPTS):
            code, _ = self.run_pull(kill=["reading", "bbb"])
            self.assertEqual(code, -9)
        self.assertEqual(self.reads(), ["aaa", "bbb", "bbb", "bbb"])

        code, output = self.run_pull(kill=["reading", "bbb"])
        self.assertEqual(code, 0, "the poison source is not read a fourth time: " + output)
        self.assertEqual(self.reads(), ["ccc", "ddd"])
        self.assertIn("skipped: the pull stopped 3 times", output)
        self.assertIn("Sources: 3 confirmed, 1 unconfirmed.", output)
        self.assertEqual(self.jobs(), ["Role at aaa", "Role at ccc", "Role at ddd"])
        self.assert_healthy()

    def test_the_skip_is_recorded_as_a_failure_a_person_can_see(self):
        for _ in range(checkpoint.MAX_ATTEMPTS):
            self.run_pull(kill=["reading", "bbb"])
        self.run_pull()
        with db.connect() as conn:
            row = conn.execute(f"""SELECT s.status,s.last_error_code FROM {memory.table('source_pull_state')} s
                JOIN {db.companies_table()} c ON c.id=s.company_id WHERE c.name='bbb'""").fetchone()
        self.assertEqual((row["status"], row["last_error_code"]), ("failed", "pull_interrupted"))

    def test_a_skipped_source_stays_settled_through_another_stop(self):
        for _ in range(checkpoint.MAX_ATTEMPTS):
            self.run_pull(kill=["reading", "bbb"])
        self.run_pull(kill=["reading", "ddd"])
        code, output = self.run_pull()
        self.assertEqual(code, 0, output)
        self.assertNotIn("skipped: the pull stopped", output, "the skip was already settled by the process before")
        self.assertIn("Sources: 3 confirmed, 1 unconfirmed.", output)
        with db.connect() as conn:
            row = conn.execute(f"""SELECT COUNT(*) AS n FROM {memory.table('source_pull_runs')} r
                JOIN {db.companies_table()} c ON c.id=r.company_id WHERE c.name='bbb' AND r.status='failed'""").fetchone()
        self.assertEqual(row["n"], 1, "recorded once")

    def test_the_attempts_survive_a_pull_expiring_around_it(self):
        # A source that hangs to the kernel's 8 hour ceiling uses a day on 3 tries, past the 20 hour limit.
        self.run_pull(kill=["reading", "bbb"])
        self.run_pull(kill=["reading", "bbb"])
        self.age_pull(checkpoint.MAX_AGE_HOURS + 1)
        code, _ = self.run_pull(kill=["reading", "bbb"])
        self.assertEqual(code, -9, "the third try, in the new pull")
        self.reads()
        code, output = self.run_pull(kill=["reading", "bbb"])
        self.assertEqual(code, 0, "the fourth is skipped: " + output)
        self.assertEqual(self.reads(), ["ccc", "ddd"])

    def test_a_skip_is_not_evidence_against_the_source(self):
        for _ in range(checkpoint.MAX_ATTEMPTS):
            self.run_pull(kill=["reading", "bbb"])
        self.run_pull()
        with db.connect() as conn:
            row = conn.execute(f"""SELECT s.consecutive_failures FROM {memory.table('source_pull_state')} s
                JOIN {db.companies_table()} c ON c.id=s.company_id WHERE c.name='bbb'""").fetchone()
        self.assertEqual(row["consecutive_failures"], 0, "the review treats repeated failures as a reason to look for a new board")

    def test_it_is_tried_again_after_fewer_attempts(self):
        for _ in range(checkpoint.MAX_ATTEMPTS - 1):
            self.run_pull(kill=["reading", "bbb"])
        self.reads()
        code, output = self.run_pull()
        self.assertEqual(code, 0, output)
        self.assertEqual(self.reads(), ["bbb", "ccc", "ddd"])


class OtherCallers(Base):
    def scrape(self, **kwargs):
        args = SimpleNamespace(**{"company": None, "list": None, "limit": None, **kwargs})
        out = StringIO()
        with patch.object(memory, "fetch", return_value=memory.Feed([], reason="empty_unconfirmed")), patch.object(review, "after_pull") as after, redirect_stdout(out):
            cli.cmd_scrape(args)
        return out.getvalue(), after

    def stopped_pull(self):
        self.run_pull(kill=["reading", "ccc"])
        return self.row()

    def test_a_partial_pull_neither_reads_nor_disturbs_a_stopped_pull(self):
        before = self.stopped_pull()
        for kwargs in ({"company": "aaa"}, {"all": True, "limit": 1}, {"all": True, "company": "aaa"}, {"all": True, "list": "dow30"}):
            output, after = self.scrape(**kwargs)
            self.assertNotIn("Continu", output)
            after.assert_not_called()
        self.assertEqual(self.row(), before)
        self.reads()
        self.run_pull()
        self.assertEqual(self.reads(), ["ccc", "ddd"], "the stopped pull is still there to continue")

    def test_a_process_that_cannot_write_the_corpus_keeps_no_checkpoint(self):
        with patch.object(db, "corpus_writable", return_value=False):
            self.assertIsNone(checkpoint.begin())

    def test_postgresql_mode_keeps_no_checkpoint(self):
        with patch.object(config, "POSTGRES", True):
            self.assertIsNone(checkpoint.begin())

    def test_a_full_pull_without_a_checkpoint_still_runs_and_reviews(self):
        with patch.object(checkpoint, "begin", return_value=None):
            output, after = self.scrape(all=True)
        self.assertIn("Scrape done: 0 new, 0 refreshed, 0 closed. Sources: 0 confirmed, 4 unconfirmed.", output)
        after.assert_called_once()

    def test_a_corpus_published_before_the_checkpoint_existed_starts_a_new_pull(self):
        with db.connect() as conn:
            for name in ("pull_checkpoint", "pull_checkpoint_sources"):
                conn.execute(f"DROP TABLE IF EXISTS {memory.table(name)}")
        code, output = self.run_pull()
        self.assertEqual(code, 0, output)
        self.assertEqual(self.reads(), self.names)


if __name__ == "__main__":
    unittest.main()
