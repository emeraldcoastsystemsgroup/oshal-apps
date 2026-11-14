"""CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Prove source maintenance through a real full pull on real temporary SQLite, with the real readers, resolver, page parser, source review and saved-change path over recorded employer replies: a source the review could not connect on three runs becomes one decision with what was tried, Keep trying and Archive answer it, readers that stay partial become one repair brief, and the runbook connects an employer's job site only on evidence, inside hard time limits, without ever stopping the pull. Run with `--corpus <file>` it leaves the corpus six such pulls produce, which the route and page proofs read through the shipped library.
2 | maintainer@emeraldcoastsystemsgroup.com | Six review fixes, each with a case that fails without it: a careers link on someone else's site is never connected as the employer's own, by a page read or a list read; a part that asks to end the process ends its pass and never the pull; connecting keeps a saved careers link and changes nothing once the employer has a board, a person's choice or a removal; a suggestion stays until the employer has a board or is removed; two hosts on one vendor's domain are two sites; and a redirect into a private address is refused by the real connection guard, against a real local server.
3 | maintainer@emeraldcoastsystemsgroup.com | Keep real full-pull acceptance on exact confirmed action identities while retaining every nondecision source change.
4 | maintainer@emeraldcoastsystemsgroup.com | Apply queued immutable decision identities on the next real pull without time-warping their opening timestamp.
5 | maintainer@emeraldcoastsystemsgroup.com | Assert the repair brief names the actual extracted Pinpoint reader module.
6 | maintainer@emeraldcoastsystemsgroup.com | Choose the latest inserted maintenance report when two pulls finish in the same second; keep the archive assertions on the current pull.
"""
import json
import os
import sqlite3
import sys
import socket
import tempfile
import threading
import time
import unittest
from urllib.parse import quote
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
os.environ["JOBHUNTER_STORE"] = "sqlite"
os.environ["JOBHUNTER_MULTIUSER"] = "1"
from jobhunter import cli, config, db, http, resolve, source_maintenance as maintenance, source_memory as memory, source_review as review, webscrape

GREENHOUSE = "https://boards-api.greenhouse.io/v1/boards/"
PRIVATE = {"127.0.0.1", "localhost", "169.254.169.254", "inside.example"}
HOSTILE = '<img src=x onerror="window.__injected=1">Hostile & Co'
# Every stored time maintenance, the review and the pull compare against, so a test can let days pass.
TIMES = {"source_review_items": ("reviewed_at", "retry_after"), "source_review_history": ("reviewed_at",),
         "source_pull_state": ("last_attempt_at", "last_success_at", "completed_at"),
         "source_pull_runs": ("last_attempt_at", "last_success_at", "completed_at"),
         "source_actions": ("opened_at", "decided_at", "snooze_until"), "source_discovery": ("last_tried_at",),
         "source_repair_briefs": ("opened_at", "updated_at"), "source_maintenance_runs": ("started_at", "finished_at"),
         "source_suggestions": ("suggested_at",)}


class Reply:
    def __init__(self, body=None, status=200, text=None):
        self.body, self.status_code, self.url = body, status, ""
        self.text = text if text is not None else ("" if body is None else json.dumps(body))
        self.ok, self.headers, self.encoding = status < 400, {}, "utf-8"

    def json(self):
        if self.body is None:
            raise ValueError("not JSON")
        return self.body

    def iter_content(self, _size):
        yield self.text.encode("utf-8")

    def close(self):
        pass


class Internet:
    """Recorded employer replies behind the real readers and resolver. An address is matched whole, or by a prefix that
    ends in `*`; anything else is a 404. Like the real connection, it refuses a private address while the guard is on."""

    def __init__(self, replies=None, slow=(), when_asked=None):
        self.replies, self.slow, self.asked, self.unguarded, self.refused = dict(replies or {}), tuple(slow), [], [], []
        self.when_asked = dict(when_asked or {})

    def request(self, _method, url, **_):
        host = url.split("/")[2].split(":")[0]
        if http._public_only_active and host in PRIVATE:
            self.refused.append(url)
            raise http.PrivateAddressRefused("refused a non-public address")
        self.asked.append(url)
        if not http._public_only_active:
            self.unguarded.append(url)
        if any(name in url for name in self.slow):
            time.sleep(30)
        if url in self.when_asked:
            self.when_asked[url]()
        prefixes = [key for key in self.replies if key.endswith("*") and url.startswith(key[:-1])]
        reply = self.replies.get(url) or (self.replies[max(prefixes, key=len)] if prefixes else Reply(status=404))
        reply.url = url
        return reply

    def asked_of(self, host):
        return [url for url in self.asked if host in url]


def pinpoint(host, count, page=True):
    """A Pinpoint board on the employer's own host: a reader the review cannot find and that never proves a whole list."""
    listing = Reply({"data": [{"id": n, "title": f"Role {n}", "url": f"https://{host}/jobs/{n}", "location": {"name": "Remote"}}
                              for n in range(1, count + 1)]})
    return {f"https://{host}/postings.json": listing, **({f"https://{host}/": Reply(text="<html>Careers</html>")} if page else {})}


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
        os.environ.pop("JOBHUNTER_BROWSER_NATIVE", None)
        self.addCleanup(db._portable_paths.clear)
        db.init_db()
        with db.connect() as conn:
            maintenance.ensure(conn)
        self.changes = 0

    def employer(self, name, ats_type=None, token=None, careers=None, homepage=None, status=None):
        status = status or ("found" if ats_type else "careers_only" if careers else "pending")
        with db.connect() as conn:
            return conn.execute(f"""INSERT INTO {db.companies_table()} (name,ats_type,ats_token,careers_url,homepage,discover_status)
                VALUES (?,?,?,?,?,?)""", (name, ats_type, token, careers, homepage, status)).lastrowid

    def hand(self, company, target):
        self.changes += 1
        change = f"00000000-0000-4000-8000-{self.changes:012}"
        (self.folder / f"{change}.json").write_text(json.dumps(
            {"id": change, "companyId": company, "target": target, "requestedBy": "verified-subject", "requestedAt": self.changes}))
        return change

    def pull(self, internet=None):
        """A real full pull: the pull's own reads, the saved changes, the source review and maintenance."""
        self.internet = internet or Internet()
        out, self.errors = StringIO(), StringIO()
        with patch.object(http._session, "request", side_effect=self.internet.request), \
                patch.object(http, "_host_is_public", lambda host: host not in PRIVATE), redirect_stdout(out), redirect_stderr(self.errors):
            cli.cmd_scrape(SimpleNamespace(all=True, company=None, list=None, limit=None))
        self.output = out.getvalue()
        return self.report()

    def days_pass(self, days):
        """The same corpus, `days` later: every stored time moves back by that much."""
        with db.connect() as conn:
            for table, columns in TIMES.items():
                for row in conn.execute(f"SELECT rowid AS r,{','.join(columns)} FROM corpus.{table}").fetchall():
                    moved = [(datetime.fromisoformat(row[column]) - timedelta(days=days)).isoformat() if row[column] else None for column in columns]
                    conn.execute(f"UPDATE corpus.{table} SET {','.join(column + '=?' for column in columns)} WHERE rowid=?", (*moved, row["r"]))

    def nights(self, count, internet=None, apart=8):
        """`count` nightly pulls, far enough apart for the review to look again each time."""
        for _ in range(count):
            self.days_pass(apart)
            report = self.pull(internet)
        return report

    def rows(self, table, where="1=1", args=()):
        with db.connect() as conn:
            return [dict(row) for row in conn.execute(f"SELECT * FROM corpus.{table} WHERE {where}", args).fetchall()]

    def report(self):
        with db.connect() as conn:
            row = conn.execute("SELECT report FROM corpus.source_maintenance_runs ORDER BY finished_at DESC, rowid DESC LIMIT 1").fetchone()
        return json.loads(row["report"]) if row else None

    def company(self, company_id):
        return self.rows("companies", "id=?", (company_id,))[0]

    def open_jobs(self, company_id):
        return len(self.rows("postings_corpus", "company_id=? AND active=1", (company_id,)))

    def pull_finished(self):
        """Whether the last pull ran to its end, which is what lets the kernel publish it."""
        return self.rows("pull_checkpoint")[0]["finished_at"] is not None

    def suggestion(self, company_id):
        kept = self.rows("source_suggestions", "company_id=?", (company_id,))
        return kept[0] if kept else None

    def actions(self, company_id, state="open"):
        return self.rows("source_actions", "company_id=? AND state=?", (company_id, state))

    def found(self, company_id):
        tried = self.rows("source_discovery", "company_id=?", (company_id,))
        return {**tried[0], "detail": json.loads(tried[0]["detail"])} if tried else None

    def reviewed_recently(self, *company_ids):
        """The review looked at these employers this week, so tonight's requests for them are maintenance's alone."""
        with db.connect() as conn:
            for company_id in company_ids:
                conn.execute(f"""INSERT INTO {memory.table('source_review_items')} (company_id,reviewed_at,retry_after,outcome,detail)
                    VALUES (?,?,?,'suggested','{{}}')""", (company_id, review._now(), review._in_days(30)))

    def boards(self, *sizes):
        """Employers on Pinpoint boards of these sizes, which read partial every night, and the replies behind them."""
        hosts = [f"careers.partial{n}.example" for n in range(len(sizes))]
        ids = [self.employer(f"Partial {n} Co", "pinpoint", host) for n, host in enumerate(hosts)]
        replies = {}
        for host, size in zip(hosts, sizes):
            replies.update(pinpoint(host, size, page=False))
        return ids, Internet(replies)

    def dead_source(self):
        """A board the pull read whole once and that then stopped answering, taken to the night its decision opens: the
        fifth night of failing, which is the review's third look."""
        dead = self.employer("Dead Board Co", "greenhouse", "deadboard", careers="https://deadboard.example/careers")
        self.pull(Internet({GREENHOUSE + "deadboard*": Reply({"jobs": [{"id": n, "title": f"Role {n}", "location": {"name": "Remote"}} for n in (1, 2)]})}))
        self.assertEqual(self.open_jobs(dead), 2)
        self.nights(4)
        self.assertEqual(self.actions(dead), [], "two review runs are not three")
        self.nights(1)
        return dead


class Escalating(Base):
    def test_a_source_the_review_could_not_connect_on_three_runs_becomes_one_decision_with_what_was_tried(self):
        dead = self.dead_source()
        opened = self.actions(dead)
        self.assertEqual(len(opened), 1)
        self.assertEqual((opened[0]["kind"], opened[0]["decided_at"], opened[0]["snooze_until"]), ("archive", None, None))
        evidence = json.loads(opened[0]["evidence"])
        self.assertEqual((evidence["employer"], evidence["board"], evidence["link"]), ("Dead Board Co", "greenhouse:deadboard", "https://deadboard.example/careers"))
        self.assertEqual([run["outcome"] for run in evidence["reviews"]], ["nothing"] * 3, "each review run's outcome, with its date")
        self.assertTrue(all(run["at"] for run in evidence["reviews"]))
        self.assertEqual((evidence["lastErrorCode"], evidence["failuresInARow"], evidence["openJobs"]), ("empty_unconfirmed", 5, 2))
        self.assertTrue(evidence["lastJobsReadAt"] and evidence["lastSuccessAt"])
        self.assertEqual((self.report()["actions"]["open"], self.report()["actions"]["opened"]), (1, 1))

    def test_it_stays_one_open_decision_however_many_nights_pass_and_its_evidence_keeps_up(self):
        dead = self.dead_source()
        first = self.actions(dead)[0]
        self.nights(2)
        still = self.actions(dead)
        self.assertEqual([action["id"] for action in still], [first["id"]])
        self.assertEqual(len(self.rows("source_actions")), 1)
        self.assertEqual((len(json.loads(still[0]["evidence"])["reviews"]), json.loads(still[0]["evidence"])["failuresInARow"]), (5, 7))

    def test_keep_trying_closes_the_decision_and_the_source_is_not_raised_again_for_sixty_days(self):
        dead = self.dead_source()
        opened = self.actions(dead)[0]
        change = self.hand(dead, "decision:%s:%s:keep" % (opened["id"], quote(opened["opened_at"], safe="-_.~")))
        self.pull()  # A real next pull preserves the immutable opened_at already queued.
        applied = self.rows("source_requests", "id=?", (change,))[0]
        self.assertEqual(applied["outcome"], "kept")
        kept = self.actions(dead, "kept")[0]
        self.assertEqual(json.loads(applied["detail"])["until"], kept["snooze_until"])
        waited = datetime.fromisoformat(kept["snooze_until"]) - datetime.fromisoformat(kept["decided_at"])
        self.assertEqual(waited.days, maintenance.SNOOZE_DAYS)
        self.assertEqual(self.company(dead)["discover_status"], "found", "kept, not removed")
        self.nights(6)
        self.assertEqual(self.actions(dead), [], "48 days on it is still failing and still not raised")
        self.nights(2)
        self.assertEqual(len(self.actions(dead)), 1, "after the wait it is raised again")
        self.assertEqual(len(self.rows("source_actions", "company_id=?", (dead,))), 2)

    def test_archive_is_the_existing_remove_and_a_removed_employer_never_appears_again(self):
        dead = self.dead_source()
        opened = self.actions(dead)[0]
        self.hand(dead, "decision:%s:%s:archive" % (opened["id"], quote(opened["opened_at"], safe="-_.~")))
        report = self.pull()  # Do not rewrite an already queued action identity with days_pass.
        archived = self.actions(dead, "archived")
        self.assertEqual(len(archived), 1)
        self.assertTrue(archived[0]["decided_at"])
        self.assertEqual((self.company(dead)["discover_status"], self.open_jobs(dead), report["actions"]["open"]), ("removed", 0, 0))
        self.nights(3)
        self.assertEqual(self.actions(dead), [])
        self.assertIsNone(self.found(dead), "not looked up for a job site either")
        self.assertNotIn("Dead Board Co", json.dumps(self.report()))

    def test_keep_trying_with_no_decision_waiting_changes_nothing_and_says_so(self):
        healthy = self.employer("Healthy Co", "greenhouse", "healthy")
        gone = self.employer("Gone Co", "greenhouse", "gone", status="removed")
        changes = [self.hand(healthy, "keep:employer"), self.hand(gone, "keep:employer"), self.hand(999, "keep:employer")]
        self.pull(Internet({GREENHOUSE + "healthy*": Reply({"jobs": [{"id": 1, "title": "Analyst", "location": {"name": "Remote"}}]})}))
        outcomes = [self.rows("source_requests", "id=?", (change,))[0]["outcome"] for change in changes]
        self.assertEqual(outcomes, ["no_decision", "removed_employer", "unknown_company"])
        self.assertEqual(self.rows("source_actions"), [])

    def test_a_source_that_reads_again_is_withdrawn_without_anyone_deciding(self):
        dead = self.dead_source()
        back = Internet({GREENHOUSE + "deadboard*": Reply({"jobs": [{"id": "a", "title": "Role a", "location": {"name": "Remote"}}]})})
        report = self.nights(1, back)
        self.assertEqual(self.rows("source_actions"), [])
        self.assertEqual((report["actions"]["withdrawn"], report["actions"]["open"]), (1, 0))

    def test_a_person_s_choice_a_multi_source_and_a_source_that_read_lately_are_not_raised(self):
        chosen = self.employer("Chosen Co", "greenhouse", "chosen", status="manual")
        multi = self.employer("Multi Co", "multi", "a,b")
        lately = self.employer("Lately Co", "greenhouse", "lately")
        control = self.employer("Control Co", "greenhouse", "control")
        with db.connect() as conn:
            for company_id in (chosen, multi, lately, control):
                success = review._in_days(-10) if company_id == lately else None
                conn.execute(f"""INSERT INTO {memory.table('source_pull_state')} (company_id,status,consecutive_failures,last_success_at)
                    VALUES (?,'failed',9,?)""", (company_id, success))
                row = conn.execute(f"SELECT ats_type,ats_token FROM {db.companies_table()} WHERE id=?", (company_id,)).fetchone()
                conn.execute(f"INSERT INTO {memory.table('source_identity')} VALUES (?,?)", (company_id, memory.source_key(row["ats_type"], row["ats_token"])))
                for days in (30, 20, 10):
                    conn.execute(f"INSERT INTO {memory.table('source_review_history')} VALUES (?,?,'nothing')", (company_id, review._in_days(-days)))
        self.pull()
        self.assertEqual([action["company_id"] for action in self.rows("source_actions")], [control])
        self.nights(1, apart=5)
        self.assertEqual(sorted(action["company_id"] for action in self.rows("source_actions")), [lately, control], "15 days without a successful pull")


class RepairBriefs(Base):
    def test_three_employers_partial_on_one_reader_for_three_pulls_become_one_brief_a_developer_can_take(self):
        ids, internet = self.boards(4, 5, 6)
        self.nights(2, internet)
        self.assertEqual(self.rows("source_repair_briefs"), [], "two partial pulls are not three")
        report = self.nights(1, internet)
        brief = self.rows("source_repair_briefs")[0]
        self.assertEqual((brief["id"], brief["reader"], brief["reason"], brief["state"]),
                         (maintenance.brief_id("pinpoint", "completion_unverified"), "pinpoint", "completion_unverified", "open"))
        employers = json.loads(brief["employers"])
        self.assertEqual((employers["count"], employers["jobs"]), (3, 15))
        self.assertEqual([(shown["name"], shown["board"], shown["read"], shown["pulls"]) for shown in employers["shown"]][0],
                         ("Partial 2 Co", "careers.partial2.example", 6, 3), "the most stored jobs first, with what the last pull read")
        for expected in ("the `Pinpoint` class in `career-hunter/engine/jobhunter/ats_portals.py`", "Reason code: `completion_unverified`", "Employers affected: 3.",
                         "| Partial 0 Co | careers.partial0.example | 4 | 3 | 4 |", "## What done means", "`career-hunter/tests/career-jibe-feed-contract.py`",
                         "## Files to hand over", "- `career-hunter/engine/jobhunter/source_memory.py`"):
            self.assertIn(expected, brief["brief"])
        self.assertEqual((report["briefs"]["open"], report["briefs"]["opened"], report["briefs"]["list"][0]["count"]), (1, 1, 3))
        self.assertEqual(maintenance._cell("Pipe | Co\n`x`"), "Pipe / Co 'x'", "employer text cannot add a cell or a code span to the table")
        self.nights(1, internet)
        again = self.rows("source_repair_briefs")
        self.assertEqual([(row["id"], row["state"]) for row in again], [(brief["id"], "open")], "the same brief the next night")
        self.assertIn("| Partial 0 Co | careers.partial0.example | 4 | 4 | 4 |", again[0]["brief"], "brought up to date")

    def test_two_employers_are_not_a_brief(self):
        _, small = self.boards(4, 5)
        self.nights(4, small)
        self.assertEqual(self.rows("source_repair_briefs"), [])

    def test_one_employer_alone_is_a_brief_when_it_has_five_hundred_stored_jobs(self):
        (large,), internet = self.boards(maintenance.LONE_EMPLOYER_JOBS)
        self.nights(3, internet)
        brief = self.rows("source_repair_briefs")[0]
        self.assertEqual((json.loads(brief["employers"])["count"], json.loads(brief["employers"])["shown"][0]["id"]), (1, large))
        self.assertIn(f"Open jobs stored for the employers affected: {maintenance.LONE_EMPLOYER_JOBS}.", brief["brief"])

    def test_a_group_that_no_longer_qualifies_is_closed_and_a_removed_employer_is_never_named(self):
        ids, internet = self.boards(4, 5, 6, 7)
        self.nights(3, internet)
        with db.connect() as conn:  # Removed, with its pull history still in place.
            conn.execute(f"UPDATE {db.companies_table()} SET discover_status='removed' WHERE id=?", (ids[3],))
        self.nights(1, internet)
        brief = self.rows("source_repair_briefs")[0]
        self.assertEqual(len(self.rows("source_pull_state", "company_id=? AND status='partial'", (ids[3],))), 1)
        self.assertEqual((brief["state"], json.loads(brief["employers"])["count"]), ("open", 3))
        self.assertNotIn("Partial 3 Co", brief["brief"] + brief["employers"])
        self.hand(ids[2], "remove:employer")
        report = self.nights(1, internet)
        self.assertEqual(self.rows("source_repair_briefs")[0]["state"], "closed")
        self.assertEqual((report["briefs"]["open"], report["briefs"]["closed"], report["briefs"]["list"]), (0, 1, []))
        self.hand(ids[2], "restore:employer")
        self.nights(1, internet)
        reopened = self.rows("source_repair_briefs")
        self.assertEqual([(row["id"], row["state"]) for row in reopened], [(brief["id"], "open")], "the same brief, open again")


class FindingJobSites(Base):
    def test_a_job_site_on_the_employers_own_careers_link_is_connected_and_its_jobs_arrive_that_night(self):
        fresh = self.employer("Fresh Co", careers="https://careers.freshco.example/")
        self.reviewed_recently(fresh)
        report = self.pull(Internet(pinpoint("careers.freshco.example", 3)))
        company = self.company(fresh)
        self.assertEqual((company["ats_type"], company["ats_token"], company["discover_status"]), ("pinpoint", "careers.freshco.example", "found"))
        self.assertEqual(self.open_jobs(fresh), 3)
        found = self.found(fresh)
        self.assertEqual((found["outcome"], found["step"], found["tries"], found["detail"]["board"], found["detail"]["jobs"]),
                         ("connected", "saved-link", 1, "pinpoint:careers.freshco.example", 3))
        self.assertEqual([step["step"] for step in found["detail"]["steps"]], ["saved-link"], "each step that ran is recorded")
        connected = report["discovery"]["connected"]
        self.assertEqual([(entry["company"], entry["id"], entry["board"]) for entry in connected], [("Fresh Co", fresh, "pinpoint:careers.freshco.example")])
        self.assertEqual((report["discovery"]["tried"], report["discovery"]["outcomes"]), (1, {"connected": 1}))
        self.assertTrue(self.internet.asked_of("careers.freshco.example"))
        self.assertEqual(self.internet.unguarded, [], "every read maintenance made was under the public-address guard")

    def test_a_link_saved_without_its_scheme_is_read_all_the_same(self):
        bare = self.employer("Bare Co", careers="careers.bareco.example/")
        self.reviewed_recently(bare)
        self.pull(Internet(pinpoint("careers.bareco.example", 3)))
        company = self.company(bare)
        self.assertEqual((self.found(bare)["outcome"], company["ats_token"], company["careers_url"]), ("connected", "careers.bareco.example", "careers.bareco.example/"))

    def test_connecting_a_source_withdraws_the_decision_that_was_open_for_it(self):
        late = self.employer("Late Co", careers="https://careers.lateco.example/")
        empty = Internet({"https://careers.lateco.example/": Reply(text="<html>Careers</html>")})
        self.pull(empty)
        self.nights(2, empty)
        self.assertEqual(len(self.actions(late)), 1, "the review looked three times and nothing was found")
        report = self.nights(1, Internet(pinpoint("careers.lateco.example", 3)))
        self.assertEqual((self.found(late)["outcome"], self.rows("source_actions"), report["actions"]["open"]), ("connected", [], 0))

    def test_anything_weaker_is_a_suggestion_for_a_person_and_changes_nothing(self):
        few = self.employer("Few Co", careers="https://careers.fewco.example/")
        self.employer("Parent Co", "pinpoint", "careers.shared.example")
        sub = self.employer("Sub Co", careers="https://careers.shared.example/sub")
        other = self.employer("Other Co", careers="https://otherco.example/careers")
        self.reviewed_recently(few, sub, other)
        board = Reply({"jobs": [{"id": n, "title": f"Role {n}", "location": {"name": "Remote"}} for n in range(3)]})
        report = self.pull(Internet({**pinpoint("careers.fewco.example", 2), **pinpoint("careers.shared.example", 3),
                                     "https://careers.shared.example/sub": Reply(text="<html>Careers</html>"),
                                     "https://otherco.example/careers": Reply(text='<a href="https://boards.greenhouse.io/zzholdings">Jobs</a>'),
                                     GREENHOUSE + "zzholdings*": board}))
        expected = {few: ("the board has fewer than 3 jobs", ["pinpoint:careers.fewco.example"], None),
                    sub: ("another employer already uses this board", ["pinpoint:careers.shared.example"], "Parent Co"),
                    other: ("the board's name does not look like this employer", ["greenhouse:zzholdings"], None)}
        for company_id, (reason, options, owner) in expected.items():
            found = self.found(company_id)
            self.assertEqual((found["outcome"], found["detail"]["reason"], found["detail"]["options"], found["detail"].get("owner")),
                             ("suggested", reason, options, owner))
            self.assertEqual((self.company(company_id)["ats_type"], self.open_jobs(company_id)), (None, 0), "nothing applied")
        self.assertEqual(sorted(entry["id"] for entry in report["discovery"]["suggested"]), sorted(expected))
        self.assertEqual(report["discovery"]["connected"], [])

    def test_the_homepage_s_own_careers_link_is_followed_and_the_link_is_kept(self):
        linked = self.employer("Step Two Co", homepage="https://www.steptwo.example/")
        usual = self.employer("Usual Co", homepage="https://usual.example/")
        self.reviewed_recently(linked, usual)
        self.pull(Internet({"https://www.steptwo.example/": Reply(text='<a href="https://jobs.steptwo.example/">Open roles</a>'),
                            **pinpoint("jobs.steptwo.example", 4), "https://usual.example/": Reply(text="<html>Welcome</html>"),
                            "https://careers.usual.example": Reply(text="<html>Careers</html>"), **pinpoint("careers.usual.example", 3, page=False)}))
        for company_id, link, host in ((linked, "https://jobs.steptwo.example/", "jobs.steptwo.example"), (usual, "https://careers.usual.example", "careers.usual.example")):
            company, found = self.company(company_id), self.found(company_id)
            self.assertEqual((found["outcome"], found["step"]), ("connected", "homepage-link"), found)
            self.assertEqual((company["ats_type"], company["ats_token"], company["careers_url"], company["discover_status"]), ("pinpoint", host, link, "found"))
            self.assertEqual([step["step"] for step in found["detail"]["steps"]], ["saved-link", "homepage-link"])

    def test_a_link_from_the_homepage_to_someone_else_s_site_is_not_followed(self):
        linker = self.employer("Linker Co", homepage="https://linker.example/")
        self.reviewed_recently(linker)
        self.pull(Internet({"https://linker.example/": Reply(text='<a href="https://partner.example/jobs">Jobs</a>'),
                            "https://partner.example/jobs": Reply(text="<html>Partner jobs</html>"), **pinpoint("partner.example", 9, page=False)}))
        self.assertEqual(self.internet.asked_of("partner.example"), [])
        self.assertEqual((self.found(linker)["outcome"], self.company(linker)["ats_type"]), ("nothing", None))
        self.assertEqual(self.internet.asked_of("careers.linker.example"), ["https://careers.linker.example"], "a careers address that does not open is not probed")

    def test_the_page_is_read_only_under_the_page_reader_s_own_policy_and_with_its_whole_deadline_left(self):
        pagey = self.employer("Pagey Co", careers="https://pagey.example/careers")
        self.reviewed_recently(pagey)
        internet = Internet({"https://pagey.example/careers": Reply(text="<html>Careers</html>")})
        page = [{"ats_job_id": str(n), "title": f"Page role {n}", "url": f"https://pagey.example/{n}"} for n in range(3)]
        with patch.object(webscrape, "scrape_careers", return_value=page) as reader:
            self.pull(internet)
            self.assertEqual((self.found(pagey)["outcome"], self.found(pagey)["detail"]["steps"][-1]["note"]), ("nothing", "the page reader is not available here"))
            self.days_pass(1)
            with patch.dict(os.environ, {"JOBHUNTER_BROWSER_NATIVE": "1"}), patch.object(maintenance, "DISCOVERY_SECONDS", maintenance.READER_SECONDS - 1):
                self.pull(internet)
            self.assertEqual(self.found(pagey)["detail"]["steps"][-1]["note"], "too little time left for a page read")
            reader.assert_not_called()
            self.days_pass(1)
            with patch.dict(os.environ, {"JOBHUNTER_BROWSER_NATIVE": "1"}):
                self.pull(internet)
        reader.assert_called_once_with("https://pagey.example/careers")
        company, found = self.company(pagey), self.found(pagey)
        self.assertEqual((found["outcome"], found["step"], found["tries"], found["detail"]["complete"]), ("connected", "page-read", 3, False))
        self.assertEqual((company["ats_type"], company["ats_token"], company["discover_status"], self.open_jobs(pagey)), ("web", "https://pagey.example/careers", "found", 3))

    def test_a_refusal_ends_the_work_on_that_employer_and_it_is_left_alone_for_thirty_days(self):
        refuser = self.employer("Refuser Co", careers="https://refuser.example/careers", homepage="https://refuser.example/")
        self.reviewed_recently(refuser)
        internet = Internet({"https://refuser.example/careers": Reply(status=403), **pinpoint("refuser.example", 5)})
        self.pull(internet)
        self.assertEqual((self.found(refuser)["outcome"], self.found(refuser)["step"]), ("blocked", "saved-link"))
        self.assertEqual(internet.asked_of("refuser.example"), ["https://refuser.example/careers"], "one read, no probe, no other page")
        self.assertIsNone(self.company(refuser)["ats_type"])
        self.days_pass(8)
        self.pull(internet)
        self.assertEqual(len(internet.asked_of("refuser.example")), 1, "not asked again a week later")
        self.days_pass(maintenance.REFUSED_DAYS)
        self.pull(internet)
        self.assertEqual(self.found(refuser)["tries"], 2)

    def test_a_link_to_a_private_address_is_refused_before_anything_reads_it(self):
        inside = [self.employer(f"Inside {n} Co", careers=link, homepage=home) for n, (link, home) in enumerate((
            ("http://127.0.0.1:8080/jobs", None), ("https://inside.example/careers", None), (None, "http://169.254.169.254/latest/")))]
        self.reviewed_recently(*inside)
        self.pull()
        for company_id in inside:
            self.assertEqual(self.found(company_id)["outcome"], "unsafe")
        self.assertEqual((self.internet.asked, self.internet.refused), ([], []), "no request was even attempted")

    def test_a_slow_site_costs_that_employer_and_no_more(self):
        slow = self.employer("Slow Co", careers="https://slow.example/careers")
        fresh = self.employer("Fresh Co", careers="https://careers.freshco.example/")
        self.reviewed_recently(slow, fresh)
        began = time.monotonic()
        with patch.object(maintenance, "DISCOVERY_SECONDS", 0.3):
            report = self.pull(Internet(pinpoint("careers.freshco.example", 3), slow=["slow.example"]))
        self.assertLess(time.monotonic() - began, 10)
        self.assertEqual((self.found(slow)["outcome"], self.found(slow)["step"], self.found(fresh)["outcome"]), ("timeout", "saved-link", "connected"))
        self.assertEqual(report["discovery"]["outcomes"], {"timeout": 1, "connected": 1})

    def test_the_pass_stops_at_its_own_time_limit_and_the_rest_wait_for_another_night(self):
        slow = self.employer("Slow Co", careers="https://slow.example/careers")
        fresh = self.employer("Fresh Co", careers="https://careers.freshco.example/")
        self.reviewed_recently(slow, fresh)
        began = time.monotonic()
        with patch.object(maintenance, "MAX_DISCOVERY_SECONDS", 0.3):
            report = self.pull(Internet(pinpoint("careers.freshco.example", 3), slow=["slow.example"]))
        self.assertLess(time.monotonic() - began, 10)
        self.assertEqual((self.found(slow)["outcome"], self.found(fresh)), ("timeout", None))
        self.assertEqual((report["discovery"]["tried"], report["discovery"]["waiting"]), (1, 1))
        self.assertIn("Scrape done:", self.output)

    def test_a_few_a_night_least_recently_tried_first(self):
        first, second, third = (self.employer(name) for name in ("First Co", "Second Co", "Third Co"))
        with patch.object(maintenance, "MAX_DISCOVERIES", 2):
            report = self.pull()
            self.assertEqual((self.found(first)["tries"], self.found(second)["tries"], self.found(third)), (1, 1, None))
            self.assertEqual((report["discovery"]["tried"], report["discovery"]["waiting"]), (2, 1))
            self.days_pass(1)
            self.pull()
        self.assertEqual((self.found(first)["tries"], self.found(second)["tries"], self.found(third)["tries"]), (2, 1, 1), "the one never tried, then the longest ago")

    def test_one_employer_that_fails_is_recorded_and_the_next_still_runs(self):
        broken = self.employer("Broken Co", careers="https://broken.example/careers")
        fresh = self.employer("Fresh Co", careers="https://careers.freshco.example/")
        self.reviewed_recently(broken, fresh)
        deep = resolve.classify_url_deep

        def classify(link):
            if "broken" in link:
                raise RuntimeError("fixture failure")
            return deep(link)

        with patch.object(resolve, "classify_url_deep", classify):
            self.pull(Internet({"https://broken.example/careers": Reply(text="<html>Careers</html>"), **pinpoint("careers.freshco.example", 3)}))
        self.assertEqual((self.found(broken)["outcome"], self.found(broken)["step"], self.found(broken)["detail"]["errorType"]), ("error", "saved-link", "RuntimeError"))
        self.assertEqual(self.found(fresh)["outcome"], "connected")

    def test_a_page_reader_that_passes_its_own_deadline_ends_the_pass_and_the_pull_still_finishes(self):
        pagey = self.employer("Pagey Co", careers="https://pagey.example/careers")
        later = self.employer("Later Co", careers="https://later.example/careers")
        self.reviewed_recently(pagey, later)
        with patch.dict(os.environ, {"JOBHUNTER_BROWSER_NATIVE": "1"}), patch.object(webscrape, "scrape_careers", side_effect=SystemExit("browser_process_deadline")):
            report = self.pull(Internet({"https://pagey.example/careers": Reply(text="<html>Careers</html>")}))
        self.assertIn("Scrape done:", self.output)
        self.assertEqual((self.found(pagey)["outcome"], self.found(later)), ("timeout", None))
        self.assertEqual((report["discovery"]["outcomes"], report["discovery"]["stopped"], self.pull_finished()), ({"timeout": 1}, True, True))

    def test_a_pull_that_restarts_does_not_look_the_same_employers_up_again_and_keeps_one_report(self):
        fresh = self.employer("Fresh Co", careers="https://careers.freshco.example/")
        empty = self.employer("Empty Co", careers="https://empty.example/careers")
        self.reviewed_recently(fresh, empty)
        first = self.pull(Internet({**pinpoint("careers.freshco.example", 3), "https://empty.example/careers": Reply(text="<html>Careers</html>")}))
        asked = len(self.internet.asked)
        with patch.object(http._session, "request", side_effect=self.internet.request), \
                patch.object(http, "_host_is_public", lambda host: host not in PRIVATE), redirect_stdout(StringIO()):
            again = maintenance.after_pull(first["since"])
        self.assertEqual(len(self.internet.asked), asked)
        self.assertEqual((self.found(fresh)["tries"], self.found(empty)["tries"], self.found(empty)["outcome"]), (1, 1, "nothing"))
        self.assertEqual(len(self.rows("source_maintenance_runs")), 1)
        self.assertEqual([entry["company"] for entry in again["discovery"]["connected"]], ["Fresh Co"], "the report still covers the whole night")


JOB_LINKS = "<html>" + "".join(f'<a href="/jobs/{n}">Opening {n}</a>' for n in range(1, 6)) + "</html>"


class WhoseSiteItIs(Base):
    """A board is the employer's own on the same site as its saved homepage, or under its name. The saved careers
    link proves nothing, because the board was reached from it."""

    def test_a_careers_link_on_someone_else_s_site_is_never_connected_by_a_page_read(self):
        listed = self.employer("Northwind Traders", careers="https://jobs.aggregator.example/company/northwind")
        homed = self.employer("Contoso Works", careers="https://staffing.example/clients/contoso", homepage="https://www.contoso.example/")
        self.reviewed_recently(listed, homed)
        page = [{"ats_job_id": str(n), "title": f"Listed role {n}", "url": f"https://jobs.aggregator.example/{n}"} for n in range(5)]
        pages = {link: Reply(text="<html>Careers</html>") for link in ("https://jobs.aggregator.example/company/northwind",
                                                                     "https://staffing.example/clients/contoso", "https://www.contoso.example/")}
        with patch.dict(os.environ, {"JOBHUNTER_BROWSER_NATIVE": "1"}), patch.object(webscrape, "scrape_careers", return_value=page):
            report = self.pull(Internet(pages))
        for company_id, link in ((listed, "https://jobs.aggregator.example/company/northwind"), (homed, "https://staffing.example/clients/contoso")):
            found, company = self.found(company_id), self.company(company_id)
            self.assertEqual((found["outcome"], found["step"], found["detail"]["reason"], found["detail"]["options"], found["detail"]["jobs"]),
                             ("suggested", "page-read", "it is not on the employer's own site", ["web:" + link], 5))
            self.assertEqual((company["ats_type"], company["ats_token"], company["discover_status"], self.open_jobs(company_id)), (None, None, "careers_only", 0))
        self.assertEqual((report["discovery"]["connected"], len(self.rows("postings_corpus"))), ([], 0), "nothing connected and nothing ingested")
        self.assertEqual(report["discovery"]["outcomes"], {"suggested": 2})

    def test_nor_by_a_list_read_off_that_page_and_nor_by_a_board_on_that_host(self):
        listed = self.employer("Northwind Traders", careers="https://jobs.aggregator.example/company/northwind")
        hosted = self.employer("Fabrikam Group", careers="https://boards.staffing.example/fabrikam")
        self.reviewed_recently(listed, hosted)
        self.pull(Internet({"https://jobs.aggregator.example/company/northwind": Reply(text=JOB_LINKS),
                            "https://boards.staffing.example/fabrikam": Reply(text="<html>Careers</html>"), **pinpoint("boards.staffing.example", 4, page=False)}))
        expected = {listed: "htmllist:https://jobs.aggregator.example/company/northwind", hosted: "pinpoint:boards.staffing.example"}
        for company_id, board in expected.items():
            found = self.found(company_id)
            self.assertEqual((found["outcome"], found["detail"]["reason"], found["detail"]["options"]), ("suggested", "it is not on the employer's own site", [board]))
            self.assertEqual((self.company(company_id)["ats_type"], self.open_jobs(company_id)), (None, 0))

    def test_the_employer_s_own_site_still_connects_by_its_homepage_or_by_its_name(self):
        by_home = self.employer("Initech", careers="https://apply.initech-careers.example/open", homepage="https://www.initech-careers.example/")
        by_name = self.employer("Globex Corporation", careers="https://jobs.globex.example/")
        self.reviewed_recently(by_home, by_name)
        self.pull(Internet({"https://apply.initech-careers.example/open": Reply(text=JOB_LINKS), **pinpoint("jobs.globex.example", 3)}))
        self.assertEqual((self.found(by_home)["outcome"], self.company(by_home)["ats_type"], self.open_jobs(by_home)), ("connected", "htmllist", 5))
        self.assertEqual((self.found(by_name)["outcome"], self.company(by_name)["ats_token"], self.open_jobs(by_name)), ("connected", "jobs.globex.example", 3))

    def test_two_hosts_on_one_vendor_s_domain_are_two_sites(self):
        for vendor in ("avature.net", "successfactors.com", "phenompeople.com", "jibeapply.com", "icims.com", "sapsf.com", "eightfold.ai"):
            self.assertFalse(review._same_site(f"https://foo.{vendor}/careers", f"https://bar.{vendor}/jobs"), vendor)
            self.assertTrue(review._same_site(f"https://foo.{vendor}/careers", f"https://foo.{vendor}/jobs"), vendor)
        self.assertTrue(review._same_site("https://careers.acme.example/a", "https://www.acme.example/"), "an employer's own hosts are still one site")
        self.assertTrue({"avature.net", "successfactors.com", "phenompeople.com", "jibeapply.com", "icims.com", "myworkdayjobs.com"} <= review._VENDOR_DOMAINS,
                        "read from the resolver's and discovery's own patterns")
        self.assertFalse(review._same_site("https://foo.avature.net/", ""), "nothing is not a site")

    def test_another_employer_s_board_on_the_vendor_domain_the_homepage_is_on_is_not_this_employer_s(self):
        foo = self.employer("Foo Works", homepage="https://foo.successfactors.com/")
        self.reviewed_recently(foo)
        listing = "<html>" + "".join(f'<a class="jobTitle-link" href="/job/{n}">Bar role {n}</a>' for n in range(3)) + "</html>"
        self.pull(Internet({"https://foo.successfactors.com/": Reply(text='<a href="https://bar.successfactors.com/search/">Search jobs</a>'),
                            "https://bar.successfactors.com/search/": Reply(text=listing)}))
        found = self.found(foo)
        self.assertEqual((found["outcome"], found["detail"]["options"], found["detail"]["reason"]),
                         ("suggested", ["successfactors:bar.successfactors.com"], "it is not on the employer's own site"))
        self.assertEqual((self.company(foo)["ats_type"], self.open_jobs(foo)), (None, 0))


class Connecting(Base):
    def test_a_saved_careers_link_is_kept_and_only_an_empty_one_is_filled(self):
        saved = self.employer("Keep Co", careers="https://old.keepco.example/gone", homepage="https://www.keepco.example/")
        self.reviewed_recently(saved)
        self.pull(Internet({"https://www.keepco.example/": Reply(text='<a href="https://jobs.keepco.example/">Open roles</a>'), **pinpoint("jobs.keepco.example", 3)}))
        company = self.company(saved)
        self.assertEqual((self.found(saved)["outcome"], self.found(saved)["step"], company["ats_token"]), ("connected", "homepage-link", "jobs.keepco.example"))
        self.assertEqual(company["careers_url"], "https://old.keepco.example/gone", "the link a person or a list saved is not written over")

    def test_an_employer_given_a_board_chosen_by_a_person_or_removed_meanwhile_is_left_exactly_as_it_is(self):
        changes = {"given a board": "ats_type='lever', ats_token='racedboard'", "chosen by a person": "discover_status='manual'", "removed": "discover_status='removed'"}
        for n, (what, change) in enumerate(changes.items()):
            host = f"careers.raceco{n}.example"
            raced = self.employer(f"Raceco{n}", careers=f"https://{host}/")
            self.reviewed_recently(raced)

            def another_writer(company_id=raced, change=change):
                with db.connect() as conn:
                    conn.execute(f"UPDATE {db.companies_table()} SET {change} WHERE id=?", (company_id,))

            before = len(self.rows("postings_corpus"))
            self.pull(Internet(pinpoint(host, 3), when_asked={f"https://{host}/postings.json": another_writer}))
            found, company = self.found(raced), self.company(raced)
            self.assertEqual((found["outcome"], found["detail"]["reason"]), ("nothing", "the employer was given a board or removed while it was looked up"), what)
            self.assertNotEqual(company["ats_type"], "pinpoint", what)
            self.assertEqual((len(self.rows("postings_corpus")), self.rows("source_pull_state", "company_id=?", (raced,))), (before, []), what + ": nothing ingested")
            self.days_pass(1)


class Suggestions(Base):
    def test_a_suggestion_stays_on_the_books_until_the_employer_has_a_board_or_is_removed(self):
        other = self.employer("Other Co", careers="https://otherco.example/careers")
        few = self.employer("Few Co", careers="https://careers.fewco.example/")
        gone = self.employer("Gone Co", careers="https://careers.goneco.example/")
        self.reviewed_recently(other, few, gone)
        board = Reply({"jobs": [{"id": n, "title": f"Role {n}", "location": {"name": "Remote"}} for n in range(3)]})
        internet = Internet({"https://otherco.example/careers": Reply(text='<a href="https://boards.greenhouse.io/zzholdings">Jobs</a>'),
                             GREENHOUSE + "zzholdings*": board, **pinpoint("careers.fewco.example", 2), **pinpoint("careers.goneco.example", 2)})
        self.pull(internet)
        first = self.suggestion(other)
        self.assertEqual((first["board"], first["step"], first["reason"], first["jobs"], first["owner"]),
                         ("greenhouse:zzholdings", "saved-link", "the board's name does not look like this employer", 3, None))
        with patch.object(maintenance, "MAX_DISCOVERIES", 0):  # The rotation is elsewhere for two nights.
            report = self.nights(2, internet, apart=1)
            self.assertEqual((report["discovery"]["suggested"], report["discovery"]["tried"], report["discovery"]["suggestionsOpen"]), ([], 0, 3))
            still = self.suggestion(other)
            self.assertEqual((still["board"], datetime.fromisoformat(first["suggested_at"]) - datetime.fromisoformat(still["suggested_at"])),
                             ("greenhouse:zzholdings", timedelta(days=2)), "listed two nights later, as it was found")
            self.hand(other, "greenhouse:zzholdings")  # A person accepts one and removes another.
            self.hand(gone, "remove:employer")
            report = self.nights(1, internet, apart=1)
        self.assertEqual((self.company(other)["ats_token"], self.company(gone)["discover_status"]), ("zzholdings", "removed"))
        self.assertEqual((self.suggestion(other), self.suggestion(gone), self.suggestion(few)["board"]), (None, None, "pinpoint:careers.fewco.example"))
        self.assertEqual(report["discovery"]["suggestionsOpen"], 1)

    def test_a_new_suggestion_replaces_the_old_one_and_a_later_look_that_connects_or_finds_nothing_ends_it(self):
        few = self.employer("Few Co", careers="https://careers.fewco.example/")
        self.reviewed_recently(few)
        self.pull(Internet(pinpoint("careers.fewco.example", 2)))
        self.assertEqual(self.suggestion(few)["jobs"], 2)
        self.nights(1, Internet(pinpoint("careers.fewco.example", 1)), apart=1)
        self.assertEqual((len(self.rows("source_suggestions")), self.suggestion(few)["jobs"]), (1, 1), "one row an employer, the newest")
        self.nights(1, Internet({"https://careers.fewco.example/": Reply(text="<html>Careers</html>")}), apart=1)
        self.assertEqual((self.found(few)["outcome"], self.suggestion(few)), ("nothing", None), "it looked again and the board is not there")
        self.nights(1, Internet(pinpoint("careers.fewco.example", 2)), apart=1)
        self.assertEqual(self.suggestion(few)["jobs"], 2)
        self.nights(1, Internet(pinpoint("careers.fewco.example", 3)), apart=1)
        self.assertEqual((self.found(few)["outcome"], self.rows("source_suggestions")), ("connected", []))


class AskedToExit(Base):
    def test_a_step_that_asks_to_end_the_process_ends_the_pass_and_the_pull_still_finishes(self):
        asker = self.employer("Asker Co", careers="https://asker.example/careers")
        later = self.employer("Later Co", careers="https://later.example/careers")
        self.reviewed_recently(asker, later)
        with patch.object(resolve, "classify_url_deep", side_effect=SystemExit("browser_process_deadline")):
            report = self.pull(Internet({"https://asker.example/careers": Reply(text="<html>Careers</html>")}))
        self.assertIn("Scrape done:", self.output)
        self.assertTrue(self.pull_finished(), "the pull ran to its end, so the kernel publishes it")
        self.assertEqual((self.found(asker)["outcome"], self.found(asker)["detail"]["reason"], self.found(later)),
                         ("timeout", "a reader passed its own deadline and asked to end the process", None))
        self.assertEqual((report["discovery"]["stopped"], report["discovery"]["tried"], "opened" in report["actions"]), (True, 1, True))

    def test_a_pass_that_asks_to_end_the_process_is_recorded_as_stopped_and_the_others_run(self):
        fresh = self.employer("Fresh Co", careers="https://careers.freshco.example/")
        self.reviewed_recently(fresh)
        with patch.object(maintenance, "_escalate", side_effect=SystemExit("fixture exit")):
            report = self.pull(Internet(pinpoint("careers.freshco.example", 3)))
        self.assertEqual((report["actions"]["stopped"], report["discovery"]["outcomes"], self.pull_finished()), (True, {"connected": 1}, True))

    def test_nothing_in_maintenance_can_end_the_pull_but_a_person_s_interrupt_is_not_swallowed(self):
        with patch.object(maintenance, "run", side_effect=SystemExit("fixture exit")):
            self.pull()
        self.assertIn("Source maintenance failed; the pull publishes without it.", self.output)
        self.assertTrue(self.pull_finished())
        self.days_pass(1)
        with patch.object(maintenance, "run", side_effect=KeyboardInterrupt()), self.assertRaises(KeyboardInterrupt):
            self.pull()


class Hop(BaseHTTPRequestHandler):
    """A real local server: its careers page answers with a redirect to an address inside."""
    hits = []

    def do_GET(self):
        Hop.hits.append(self.path)
        self.send_response(302)
        self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
        self.end_headers()

    def log_message(self, *_):
        pass


class TheRealGuard(Base):
    """Through the real session and its connection guard, against a real local socket. The guard's own send is watched,
    not replaced; what is doubled is named in each case."""

    def setUp(self):
        super().setUp()
        Hop.hits = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Hop)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.port = self.server.server_port

    def real_pull(self):
        out = StringIO()
        with redirect_stdout(out), redirect_stderr(StringIO()):
            cli.cmd_scrape(SimpleNamespace(all=True, company=None, list=None, limit=None))
        self.output = out.getvalue()

    def test_a_redirect_into_a_private_address_is_refused_at_the_hop_and_recorded_as_unsafe(self):
        """Doubled: the name careers.hopco.example resolves to the local server, and the guard is told that server's own
        address, 127.0.0.1, is public, so the first hop can be made at all. The redirect target is judged for real."""
        hop = self.employer("Hop Co", careers=f"http://careers.hopco.example:{self.port}/careers")
        self.reviewed_recently(hop)
        resolve_name, judge = socket.getaddrinfo, http._is_public_address
        local = lambda host, *args, **kwargs: resolve_name("127.0.0.1" if host == "careers.hopco.example" else host, *args, **kwargs)
        sent = []
        send = http._PublicOnlyAdapter.send

        def watched(adapter, request, **kwargs):
            sent.append(request.url)
            return send(adapter, request, **kwargs)

        with patch.object(socket, "getaddrinfo", local), patch.object(http, "_is_public_address", lambda address: address == "127.0.0.1" or judge(address)), \
                patch.object(http._PublicOnlyAdapter, "send", watched):
            self.real_pull()
        self.assertEqual(Hop.hits, ["/careers"], "the first hop really reached the server, once")
        self.assertEqual(sent, [f"http://careers.hopco.example:{self.port}/careers", "http://169.254.169.254/latest/meta-data/"],
                         "the redirect went to the connection guard, which refused it there")
        found, company = self.found(hop), self.company(hop)
        self.assertEqual((found["outcome"], found["step"], company["ats_type"], self.open_jobs(hop)), ("unsafe", "saved-link", None, 0))
        self.assertIn("Scrape done:", self.output)

    def test_a_private_first_hop_never_reaches_the_server_with_nothing_doubled_at_all(self):
        inside = self.employer("Inside Co", careers=f"http://127.0.0.1:{self.port}/careers")
        named = self.employer("Named Co", careers=f"http://localhost:{self.port}/careers")
        self.reviewed_recently(inside, named)
        self.real_pull()
        self.assertEqual(Hop.hits, [])
        self.assertEqual((self.found(inside)["outcome"], self.found(named)["outcome"]), ("unsafe", "unsafe"))


class TheNightlyRun(Base):
    def scrape(self, **kwargs):
        out, self.errors = StringIO(), StringIO()
        with patch.object(http._session, "request", side_effect=Internet().request), redirect_stdout(out), redirect_stderr(self.errors):
            cli.cmd_scrape(SimpleNamespace(**{"all": True, "company": None, "list": None, "limit": None, **kwargs}))
        return out.getvalue()

    def test_a_full_pull_ends_with_maintenance_straight_after_the_review_and_a_partial_pull_starts_neither(self):
        self.employer("Fixture Co", "greenhouse", "fixture")
        order = []
        with patch.object(review, "after_pull", side_effect=lambda since: order.append("review")), \
                patch.object(maintenance, "after_pull", side_effect=lambda since: order.append("maintenance")):
            self.scrape(all=False, company="Fixture Co")
            self.scrape(limit=5)
            self.assertEqual(order, [])
            self.assertIn("Scrape done:", self.scrape())
        self.assertEqual(order, ["review", "maintenance"])

    def test_a_crash_in_maintenance_never_stops_the_pull_from_finishing(self):
        with patch.object(maintenance, "run", side_effect=RuntimeError("fixture maintenance failure")):
            output = self.scrape()
        self.assertIn("Scrape done:", output)
        self.assertIn("Source maintenance failed; the pull publishes without it.", output)
        self.assertIn("fixture maintenance failure", self.errors.getvalue())

    def test_one_pass_that_fails_or_runs_out_of_time_is_said_in_the_report_and_the_others_still_run(self):
        fresh = self.employer("Fresh Co", careers="https://careers.freshco.example/")
        self.reviewed_recently(fresh)
        with patch.object(maintenance, "_escalate", side_effect=RuntimeError("fixture pass failure")):
            report = self.pull(Internet(pinpoint("careers.freshco.example", 3)))
        self.assertEqual((report["actions"]["errorType"], report["discovery"]["outcomes"]), ("RuntimeError", {"connected": 1}))
        self.assertIn("Scrape done:", self.output)
        began = time.monotonic()
        self.days_pass(1)
        with patch.object(maintenance, "ACTION_SECONDS", 0.2), patch.object(maintenance, "_unconnected", side_effect=lambda conn: time.sleep(30)):
            report = self.pull()
        self.assertLess(time.monotonic() - began, 10)
        self.assertEqual((report["actions"]["timedOut"], "opened" in report["briefs"]), (True, True))

    def test_a_statement_still_running_when_its_pass_runs_out_of_time_is_given_up(self):
        self.employer("Fixture Co", "greenhouse", "fixture")
        endless = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 300000000) SELECT COUNT(*) FROM c"
        began = time.monotonic()
        with patch.object(maintenance, "BRIEF_SECONDS", 0.3), patch.object(maintenance, "_partial_sources", side_effect=lambda conn: conn.execute(endless).fetchall()):
            report = self.pull()
        self.assertLess(time.monotonic() - began, 10, "one long statement cannot hold the pull")
        self.assertEqual((report["briefs"].get("timedOut"), report["actions"]["opened"], report["discovery"]["tried"]), (True, 0, 0))
        self.assertIn("Scrape done:", self.output)

    def test_a_process_that_cannot_write_the_corpus_skips_it(self):
        os.chmod(config.CORPUS_DB, 0o440)
        self.addCleanup(os.chmod, config.CORPUS_DB, 0o660)
        with redirect_stdout(StringIO()) as out:
            self.assertIsNone(maintenance.run())
        self.assertIn("skipped", out.getvalue())

    def test_only_the_newest_reports_are_kept_and_each_says_what_its_limits_were(self):
        report = self.pull()
        with patch.object(maintenance, "KEEP_REPORTS", 3), redirect_stdout(StringIO()):
            for night in range(1, 6):  # Five more pulls, each begun a day after the last.
                self.days_pass(1)
                maintenance.after_pull(f"2026-11-{night:02}T02:00:00+00:00")
        self.assertEqual(sorted(run["run_id"] for run in self.rows("source_maintenance_runs")),
                         [f"pull-2026-11-{night:02}T02:00:00+00:00" for night in (3, 4, 5)])
        self.assertEqual((report["version"], report["actions"]["limitSeconds"], report["briefs"]["limitSeconds"]), (1, maintenance.ACTION_SECONDS, maintenance.BRIEF_SECONDS))
        self.assertEqual((report["discovery"]["limitSeconds"], report["discovery"]["limitEmployers"], report["discovery"]["employerSeconds"]),
                         (maintenance.MAX_DISCOVERY_SECONDS, maintenance.MAX_DISCOVERIES, maintenance.DISCOVERY_SECONDS))
        self.assertTrue(all(isinstance(report[name]["seconds"], float) for name in ("actions", "briefs", "discovery")))


class Fixture(Base):
    """Not a test: the corpus maintenance leaves after six real nightly pulls, for the route and page proofs."""

    def build(self):
        boards = (("hostileboard", HOSTILE), ("quietboard", "Quiet Board Co"), ("goneboard", "Gone Co"))
        dead = [self.employer(name, "greenhouse", token, careers=f"https://{token}.example/careers") for token, name in boards]
        self.pull(Internet({GREENHOUSE + token + "*": Reply({"jobs": [{"id": n, "title": f"Role {n}", "location": {"name": "Remote"}} for n in (1, 2)]})
                            for token, _ in boards}))
        self.nights(2)  # The three boards stop answering.
        _, partial = self.boards(4, 5, 6)
        other = self.employer("Other Co", careers="https://otherco.example/careers")
        sub = self.employer("Sub Co", careers="https://careers.partial0.example/sub")
        self.reviewed_recently(other, sub)
        board = Reply({"jobs": [{"id": n, "title": f"Role {n}", "location": {"name": "Remote"}} for n in range(3)]})
        # Two nights before the last: the runbook suggests a board for each of two employers and connects neither.
        self.nights(1, Internet({**partial.replies, GREENHOUSE + "zzholdings*": board,
                                 "https://otherco.example/careers": Reply(text='<a href="https://boards.greenhouse.io/zzholdings">Jobs</a>'),
                                 "https://careers.partial0.example/sub": Reply(text="<html>Careers</html>")}))
        with patch.object(maintenance, "MAX_DISCOVERIES", 0):  # The rotation is elsewhere the night after.
            self.nights(1, partial)
        fresh = self.employer("Fresh Co", careers="https://careers.freshco.example/")
        self.reviewed_recently(fresh)
        self.hand(dead[2], "remove:employer")
        # The last night: the third look opens two decisions, the third partial pull opens the brief, the one employer
        # the rotation reaches is connected, and the third dead board is removed before its decision would open. The
        # two suggestions are two nights old and are in no report from tonight.
        with patch.object(maintenance, "MAX_DISCOVERIES", 1):
            self.nights(1, Internet({**partial.replies, **pinpoint("careers.freshco.example", 3)}))


def build_corpus(target):
    """Write the fixture corpus to `target` as one plain SQLite file."""
    case = Fixture("build")
    case.setUp()
    try:
        case.build()
        source, copy = sqlite3.connect(config.CORPUS_DB), sqlite3.connect(target)
        source.backup(copy)
        copy.close()
        source.close()
    finally:
        case.doCleanups()


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--corpus":
        build_corpus(sys.argv[2])
    else:
        unittest.main()
