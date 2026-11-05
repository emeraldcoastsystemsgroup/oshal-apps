"""CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Prove a saved source change is applied by a pull on real temporary SQLite, with the real page guard, real time limit and a real process really killed, over recorded employer replies.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
os.environ["JOBHUNTER_STORE"] = "sqlite"
os.environ["JOBHUNTER_MULTIUSER"] = "1"
from jobhunter import ats, cli, config, db, http, resolve, source_memory as memory, source_requests as requests, source_review as review, webscrape

FIRST, SECOND = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"


def jobs(*tokens):
    return memory.Feed([{"ats_job_id": token, "title": "Role " + token, "url": "https://jobs.example/" + token} for token in tokens],
                       complete=True, reason=None)


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.folder = self.root / "handed"
        self.folder.mkdir()
        for name, value in {"CORPUS_DB": self.root / "corpus.db", "USER_DB": self.root / "ingest.db", "DATA_DIR": self.root,
                            "POSTGRES": False, "MULTIUSER": True, "PER_HOST_DELAY": 0}.items():
            patcher = patch.object(config, name, value, create=True)
            patcher.start()
            self.addCleanup(patcher.stop)
        environ = patch.dict(os.environ, {"JOBHUNTER_SOURCE_REQUESTS": str(self.folder)})
        environ.start()
        self.addCleanup(environ.stop)
        self.addCleanup(db._portable_paths.clear)
        db.init_db()
        with db.connect() as conn:
            for name, kind, token in (("Moving Co", "greenhouse", "oldboard"), ("Holder Co", "lever", "heldboard")):
                conn.execute(f"INSERT INTO {db.companies_table()} (name,ats_type,ats_token,careers_url) VALUES (?,?,?,?)",
                             (name, kind, token, "https://moving.example/careers"))
            memory.ensure(conn)
        self.moving, self.holder = 1, 2

    def hand(self, change_id=FIRST, company=None, target="greenhouse:newboard", at=1000):
        (self.folder / f"{change_id}.json").write_text(json.dumps(
            {"id": change_id, "companyId": company or self.moving, "target": target, "requestedBy": "verified-subject", "requestedAt": at}))

    def scrape(self, boards=None, **patches):
        """A real full pull. A board not named in `boards` answers with nothing."""
        asked = []

        def fetch(kind, token):
            asked.append(f"{kind}:{token}")
            return boards.get(f"{kind}:{token}", memory.Feed([], reason="empty_unconfirmed")) if boards else memory.Feed([], reason="empty_unconfirmed")

        out = StringIO()
        with patch.object(ats, "fetch", fetch), patch.object(review, "after_pull"), patch.object(http, "_host_is_public", patches.get("public", lambda _host: True)), redirect_stdout(out):
            cli.cmd_scrape(SimpleNamespace(all=True, company=None, list=None, limit=None))
        self.asked, self.output = asked, out.getvalue()
        return self.outcome()

    def outcome(self, change_id=FIRST):
        with db.connect() as conn:
            if not conn.execute("SELECT 1 FROM corpus.sqlite_master WHERE name='source_requests'").fetchone():
                return None
            row = conn.execute(f"SELECT * FROM {memory.table('source_requests')} WHERE id=?", (change_id,)).fetchone()
        return dict(row) if row else None

    def company(self, company_id=None):
        with db.connect() as conn:
            return dict(conn.execute(f"SELECT * FROM {db.companies_table()} WHERE id=?", (company_id or self.moving,)).fetchone())

    def titles(self):
        with db.connect() as conn:
            return sorted(row["title"] for row in conn.execute(f"SELECT title FROM {db.corpus_table()}").fetchall())


class Applying(Base):
    def test_a_named_board_moves_the_source_and_its_jobs_arrive_tonight(self):
        self.hand()
        row = self.scrape({"greenhouse:newboard": jobs("a", "b")})
        self.assertEqual(row["outcome"], "applied")
        self.assertEqual(row["requested_by"], "verified-subject")
        detail = json.loads(row["detail"])
        self.assertEqual((detail["board"], detail["jobs"], detail["new"], detail["from"], detail["closed"]), ("greenhouse:newboard", 2, 2, "greenhouse:oldboard", 0))
        company = self.company()
        self.assertEqual((company["ats_type"], company["ats_token"]), ("greenhouse", "newboard"))
        self.assertEqual(self.titles(), ["Role a", "Role b"])

    def test_the_pull_counts_it_and_does_not_read_the_same_board_again(self):
        self.hand()
        self.scrape({"greenhouse:newboard": jobs("a", "b")})
        self.assertEqual(self.asked.count("greenhouse:newboard"), 1, self.asked)
        self.assertNotIn("greenhouse:oldboard", self.asked, "the old board is not read after the move")
        self.assertIn("Scrape done: 2 new", self.output)

    def test_it_says_how_many_jobs_the_move_closed_so_a_wrong_press_is_visible(self):
        with db.connect() as conn:
            memory.ingest(conn, self.moving, jobs("old1", "old2", "old3"))
        self.hand()
        row = self.scrape({"greenhouse:newboard": jobs("a")})
        self.assertEqual(json.loads(row["detail"])["closed"], 3)

    def test_a_person_s_choice_is_held_from_the_source_review(self):
        self.hand()
        self.scrape({"greenhouse:newboard": jobs("a")})
        self.assertEqual(self.company()["discover_status"], "manual")
        with db.connect() as conn:
            conn.execute(f"""UPDATE {memory.table('source_pull_state')} SET status='failed', consecutive_failures=9 WHERE company_id=?""", (self.moving,))
            review.ensure(conn)
            queue = review._queue(conn)
        self.assertNotIn(self.moving, [row["id"] for row in queue])

    def test_a_link_is_worked_out_and_kept_on_the_employer(self):
        self.hand(target="https://boards.greenhouse.io/newboard")
        with patch.object(resolve, "classify_url_deep", return_value=("greenhouse", "newboard")):
            row = self.scrape({"greenhouse:newboard": jobs("a", "b", "c")})
        self.assertEqual(row["outcome"], "applied", row)
        company = self.company()
        self.assertEqual((company["ats_token"], company["careers_url"]), ("newboard", "https://boards.greenhouse.io/newboard"))

    def test_a_link_with_no_board_falls_back_to_reading_the_page(self):
        self.hand(target="https://moving.example/jobs")
        page = [{"ats_job_id": str(n), "title": f"Page role {n}", "url": f"https://moving.example/{n}"} for n in range(3)]
        with patch.dict(os.environ, {"JOBHUNTER_BROWSER_NATIVE": "1"}), patch.object(resolve, "classify_url_deep", return_value=None), patch.object(webscrape, "scrape_careers", return_value=page):
            row = self.scrape()
        self.assertEqual(row["outcome"], "applied", row)
        self.assertEqual(self.company()["ats_type"], "web")
        self.assertEqual(json.loads(row["detail"])["complete"], False, "a read page never proves a whole feed, so it closes nothing")


class Refusing(Base):
    def unchanged(self):
        company = self.company()
        self.assertEqual((company["ats_type"], company["ats_token"]), ("greenhouse", "oldboard"))

    def test_a_link_with_no_jobs_keeps_the_link_and_the_source(self):
        self.hand(target="https://moving.example/jobs")
        with patch.dict(os.environ, {"JOBHUNTER_BROWSER_NATIVE": "1"}), patch.object(resolve, "classify_url_deep", return_value=None), patch.object(webscrape, "scrape_careers", return_value=[]):
            self.assertEqual(self.scrape()["outcome"], "saved_no_jobs")
        self.unchanged()
        self.assertEqual(self.company()["careers_url"], "https://moving.example/jobs")

    def test_a_board_with_no_jobs_changes_nothing(self):
        self.hand()
        self.assertEqual(self.scrape()["outcome"], "no_jobs")
        self.unchanged()

    def test_a_board_another_employer_holds_is_refused_in_any_letter_case(self):
        self.hand(target="lever:HeldBoard")
        row = self.scrape({"lever:HeldBoard": jobs("a")})
        self.assertEqual(row["outcome"], "duplicate")
        self.assertEqual(json.loads(row["detail"])["owner"], "Holder Co")
        self.unchanged()

    def test_a_company_no_longer_listed(self):
        self.hand(company=999)
        self.assertEqual(self.scrape()["outcome"], "unknown_company")

    def test_anything_else_is_not_a_target(self):
        for target in ("ftp://x.example/", "file:///etc/passwd", "nosuchboard:x", "greenhouse:", "plain words", "javascript:alert(1)"):
            self.hand(change_id=FIRST, target=target)
            with db.connect() as conn:
                conn.execute(f"DROP TABLE IF EXISTS {memory.table('source_requests')}")
            self.assertEqual(self.scrape()["outcome"], "bad_target", target)
        self.unchanged()


class TheGuards(Base):
    def test_a_link_to_a_private_address_is_refused_before_anything_reads_it(self):
        for target in ("http://127.0.0.1:8080/jobs", "http://localhost/jobs", "http://169.254.169.254/latest/meta-data/", "http://[::1]/"):
            self.hand(target=target)
            with db.connect() as conn:
                conn.execute(f"DROP TABLE IF EXISTS {memory.table('source_requests')}")
            with patch.object(resolve, "classify_url_deep", side_effect=AssertionError("read a private link")), \
                    patch.object(webscrape, "scrape_careers", side_effect=AssertionError("read a private link")), \
                    patch.object(ats, "fetch", return_value=memory.Feed([], reason="empty_unconfirmed")), patch.object(review, "after_pull"), redirect_stdout(StringIO()):
                cli.cmd_scrape(SimpleNamespace(all=True, company=None, list=None, limit=None))
            self.assertEqual(self.outcome()["outcome"], "unsafe", target)

    def test_a_page_read_named_as_a_board_gets_the_same_check_as_a_link(self):
        for target in ("web:http://127.0.0.1:38788/x", "web:file:///etc/passwd", "web:http://169.254.169.254/", "webflow:http://127.0.0.1:9/x|abc", "htmllist:http://localhost/jobs"):
            self.hand(target=target)
            with db.connect() as conn:
                conn.execute(f"DROP TABLE IF EXISTS {memory.table('source_requests')}")
            with patch.object(webscrape, "scrape_careers", side_effect=AssertionError("read a private link")), \
                    patch.object(ats, "fetch", side_effect=lambda kind, token: memory.Feed([], reason="empty_unconfirmed") if kind == "greenhouse" else self.fail("read " + token)), \
                    patch.object(review, "after_pull"), redirect_stdout(StringIO()):
                cli.cmd_scrape(SimpleNamespace(all=True, company=None, list=None, limit=None))
            self.assertEqual(self.outcome()["outcome"], "unsafe", target)

    def test_a_page_read_with_no_link_in_it_is_not_read(self):
        self.hand(target="web:/etc/passwd")
        with patch.dict(os.environ, {"JOBHUNTER_BROWSER_NATIVE": "1"}):
            self.assertEqual(self.scrape()["outcome"], "no_jobs")
        self.assertNotIn("web:/etc/passwd", self.asked)

    def test_the_page_reader_only_runs_under_its_read_policy(self):
        page = [{"ats_job_id": str(n), "title": f"Page role {n}", "url": f"https://moving.example/{n}"} for n in range(3)]
        for flag in (None, "unavailable", "0"):
            environment = {k: v for k, v in os.environ.items() if k != "JOBHUNTER_BROWSER_NATIVE"}
            if flag:
                environment["JOBHUNTER_BROWSER_NATIVE"] = flag
            for target in ("https://moving.example/jobs", "web:https://moving.example/jobs"):
                self.hand(target=target)
                with db.connect() as conn:
                    conn.execute(f"DROP TABLE IF EXISTS {memory.table('source_requests')}")
                with patch.dict(os.environ, environment, clear=True), patch.object(resolve, "classify_url_deep", return_value=None), \
                        patch.object(webscrape, "scrape_careers", return_value=page) as reader:
                    row = self.scrape()
                # Asserted on the double: the code under test rightly swallows anything a reader raises.
                reader.assert_not_called()
                self.assertNotIn("web:https://moving.example/jobs", self.asked, (flag, target))
                self.assertIn(row["outcome"], ("saved_no_jobs", "no_jobs"), (flag, target, row))
        with patch.dict(os.environ, {"JOBHUNTER_BROWSER_NATIVE": "1"}), patch.object(webscrape, "scrape_careers", return_value=page) as reader, \
                patch.object(ats, "fetch", lambda kind, token: memory.Feed(page, reason="completion_unverified") if kind == "web" else memory.Feed([], reason="empty_unconfirmed")), \
                patch.object(review, "after_pull"), patch.object(http, "_host_is_public", lambda _host: True), redirect_stdout(StringIO()):
            self.hand("33333333-3333-4333-8333-333333333333", target="web:https://moving.example/jobs")
            cli.cmd_scrape(SimpleNamespace(all=True, company=None, list=None, limit=None))
        self.assertEqual(self.outcome("33333333-3333-4333-8333-333333333333")["outcome"], "applied")

    def test_every_read_happens_under_the_public_address_guard(self):
        self.hand()
        seen = []

        def fetch(kind, token):
            seen.append(http._public_only_active)
            return jobs("a") if token == "newboard" else memory.Feed([], reason="empty_unconfirmed")

        with patch.object(ats, "fetch", fetch), patch.object(review, "after_pull"), redirect_stdout(StringIO()):
            cli.cmd_scrape(SimpleNamespace(all=True, company=None, list=None, limit=None))
        self.assertTrue(seen[0], "the change is read with the guard on")

    def test_a_read_that_hangs_costs_that_change_and_no_more(self):
        self.hand(FIRST, at=1)
        self.hand(SECOND, target="greenhouse:second", company=self.moving, at=2)

        def fetch(kind, token):
            if token == "newboard":
                time.sleep(30)
            return jobs("a") if token == "second" else memory.Feed([], reason="empty_unconfirmed")

        began = time.monotonic()
        with patch.object(review, "SOURCE_SECONDS", 0.2), patch.object(ats, "fetch", fetch), patch.object(review, "after_pull"), redirect_stdout(StringIO()):
            cli.cmd_scrape(SimpleNamespace(all=True, company=None, list=None, limit=None))
        self.assertLess(time.monotonic() - began, 10)
        self.assertEqual(self.outcome(FIRST)["outcome"], "timeout")
        self.assertEqual(self.outcome(SECOND)["outcome"], "applied")

    def test_a_crash_costs_that_change_and_no_more(self):
        self.hand(FIRST, at=1)
        self.hand(SECOND, target="greenhouse:second", at=2)
        with patch.object(requests, "_apply", side_effect=[RuntimeError("fixture"), {"outcome": "no_jobs"}]):
            self.scrape()
        self.assertEqual(self.outcome(FIRST)["outcome"], "error")
        self.assertEqual(json.loads(self.outcome(FIRST)["detail"])["errorType"], "RuntimeError")
        self.assertEqual(self.outcome(SECOND)["outcome"], "no_jobs")


class TheHandover(Base):
    def test_a_change_handed_over_twice_is_applied_once(self):
        self.hand()
        self.scrape({"greenhouse:newboard": jobs("a")})
        with db.connect() as conn:
            conn.execute(f"UPDATE {db.companies_table()} SET ats_token='someoneelse' WHERE id=?", (self.moving,))
        self.scrape({"greenhouse:newboard": jobs("a")})
        self.assertEqual(self.company()["ats_token"], "someoneelse", "the kernel repeating itself cannot undo a later change")

    def test_oldest_first_so_the_last_thing_asked_for_is_what_stands(self):
        self.hand(SECOND, target="greenhouse:latest", at=2000)
        self.hand(FIRST, target="greenhouse:earlier", at=1000)
        self.scrape({"greenhouse:earlier": jobs("a"), "greenhouse:latest": jobs("b")})
        self.assertEqual(self.company()["ats_token"], "latest")

    def test_an_unreadable_entry_is_said_aloud_and_the_rest_are_applied(self):
        (self.folder / f"{SECOND}.json").write_text("{not json")
        self.hand()
        self.assertEqual(self.scrape({"greenhouse:newboard": jobs("a")})["outcome"], "applied")
        self.assertIn(f"source change {SECOND}.json: unreadable", self.output)

    def test_no_folder_means_nothing_to_do_and_no_table(self):
        with patch.dict(os.environ, {"JOBHUNTER_SOURCE_REQUESTS": str(self.root / "absent")}):
            self.scrape()
        with db.connect() as conn:
            self.assertIsNone(conn.execute("SELECT 1 FROM corpus.sqlite_master WHERE name='source_requests'").fetchone())

    def test_a_partial_pull_applies_nothing(self):
        self.hand()
        with patch.object(ats, "fetch", return_value=jobs("a")), patch.object(review, "after_pull"), redirect_stdout(StringIO()):
            cli.cmd_scrape(SimpleNamespace(company="Moving Co", list=None, limit=None))
        with db.connect() as conn:
            self.assertIsNone(conn.execute("SELECT 1 FROM corpus.sqlite_master WHERE name='source_requests'").fetchone())

    def test_only_the_newest_outcomes_are_kept(self):
        self.hand()
        with patch.object(requests, "KEEP", 3), patch.object(requests, "_apply", return_value={"outcome": "no_jobs"}):
            for n in range(6):
                change = f"33333333-3333-4333-8333-{n:012}"
                self.hand(change)
                self.scrape()
        with db.connect() as conn:
            count = conn.execute(f"SELECT COUNT(*) AS n FROM {memory.table('source_requests')}").fetchone()["n"]
        self.assertLessEqual(count, 4)


# A real process, killed for real inside a change's write, with nothing flushed or closed.
CHILD = r"""
import os, signal, sys
from jobhunter import ats, cli, source_memory as memory, source_review as review
kill = os.environ.get("KILL_ON")

def fetch(kind, token):
    with open(os.environ["FETCH_LOG"], "a") as log:
        log.write(token + "\n")
    if kill == "reading-holder" and token == "heldboard":
        os.kill(os.getpid(), signal.SIGKILL)
    if token == "newboard":
        return memory.Feed([{"ats_job_id": "a", "title": "Role a", "url": "https://jobs.example/a"}], complete=True, reason=None)
    return memory.Feed([], reason="empty_unconfirmed")

ingest = memory.ingest
def ingest_then_die(conn, company_id, rows):
    counts = ingest(conn, company_id, rows)
    if kill == "writing":
        os.kill(os.getpid(), signal.SIGKILL)
    return counts

ats.fetch, memory.ingest, review.after_pull = fetch, ingest_then_die, lambda since: None
sys.argv = ["jobhunter", "scrape", "--all"]
cli.main()
"""


class AKilledPull(Base):
    def run_child(self, kill=None):
        env = {"JOBHUNTER_CORPUS_DB": str(self.root / "corpus.db"), "JOBHUNTER_USER_DB": str(self.root / "ingest.db"), "JOBHUNTER_DATA": str(self.root),
               "JOBHUNTER_STORE": "sqlite", "JOBHUNTER_MULTIUSER": "1", "JOBHUNTER_SOURCE_REQUESTS": str(self.folder), "PATH": os.environ.get("PATH", ""),
               "HOME": str(self.root), "PYTHONDONTWRITEBYTECODE": "1", "KILL_ON": kill or "", "FETCH_LOG": str(self.root / "fetched.log"),
               "PYTHONPATH": os.pathsep.join([str(ROOT / "engine"), *os.environ.get("PYTHONPATH", "").split(os.pathsep)])}
        return subprocess.run([sys.executable, "-c", CHILD], env=env, capture_output=True, text=True, timeout=60, cwd=self.temp.name)

    def test_a_kill_while_applying_rolls_back_and_the_next_process_applies_it(self):
        self.hand()
        self.assertEqual(self.run_child(kill="writing").returncode, -9)
        self.assertEqual(self.titles(), [], "the half-applied change rolled back")
        self.assertEqual(self.company()["ats_token"], "oldboard")
        self.assertEqual(self.outcome()["outcome"], "started")
        done = self.run_child()
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.outcome()["outcome"], "applied")
        self.assertEqual(self.company()["ats_token"], "newboard")
        self.assertEqual(self.titles(), ["Role a"])

    def test_a_moved_board_is_not_read_again_after_a_restart_and_still_counts(self):
        self.hand()
        self.assertEqual(self.run_child(kill="reading-holder").returncode, -9, "stopped after the change, on another employer")
        done = self.run_child()
        self.assertEqual(done.returncode, 0, done.stderr)
        fetched = (self.root / "fetched.log").read_text().split()
        self.assertEqual(fetched.count("newboard"), 1, fetched)
        self.assertIn("Scrape done: 1 new", done.stdout)

    def test_a_change_the_pull_keeps_stopping_on_is_given_up_and_the_person_told(self):
        self.hand()
        for _ in range(requests.MAX_ATTEMPTS):
            self.assertEqual(self.run_child(kill="writing").returncode, -9)
        done = self.run_child(kill="writing")
        self.assertEqual(done.returncode, 0, "the pull is no longer held back: " + done.stderr)
        self.assertEqual(self.outcome()["outcome"], "interrupted")
        self.assertEqual(self.company()["ats_token"], "oldboard")


if __name__ == "__main__":
    unittest.main()
