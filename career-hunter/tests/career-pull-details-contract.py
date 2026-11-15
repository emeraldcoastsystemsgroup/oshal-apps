"""CHANGE LOG
3 | maintainer@emeraldcoastsystemsgroup.com | 1.64.1: the raised defaults (600 a source, 6,000 a pull, 80 minutes, 600 s of a source's own reads) hold as caps; a source's seconds are a setting; a host shared by two sources gets one source's cap; the newest day's jobs of every source are read before older ones; the stage ends at once when no page is left.
2 | maintainer@emeraldcoastsystemsgroup.com | Google jobs keep the description their results page already carries, from the saved real page, with no request beyond the list; a page whose job data cannot be read gives the same jobs with no description.
1 | maintainer@emeraldcoastsystemsgroup.com | A full pull keeps the description of an in-lane Eightfold job from the job's own saved real page, after every list is read: the text lands in the corpus's listing text whole and stripped, a refused or empty read leaves the job as it is and never fails the pull, the caps and the off switch hold, a job read twice is not read again, and a pull stopped inside the stage continues without reading a page it kept.

The real `scrape --all` (cli.cmd_scrape), the real Eightfold list reader, ingest, pull checkpoint, source changes and the
description stage, over a disposable SQLite corpus opened as the native ingest opens it. Replaced: the network (the
session answers each address from tests/pull-detail-fixtures, real pages and the real list shape, and refuses any other),
and the nightly source review and maintenance, which run after the stage and read other sites.
"""
import contextlib
import io
import json
import os
import signal
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
os.environ["JOBHUNTER_STORE"] = "sqlite"
os.environ["JOBHUNTER_MULTIUSER"] = "1"
from jobhunter import ats_custom, cli, config, db, http, posting_page, pull_details, source_maintenance, source_memory as memory, source_review

FIXTURES = ROOT / "tests" / "pull-detail-fixtures"
INDEX = json.loads((FIXTURES / "index.json").read_text(encoding="utf-8"))
PAGES = {entry["file"]: entry for entry in INDEX["fixtures"]}
LM = PAGES["eightfold-lockheedmartin-996477886618.html"]
LM_TOKEN = LM["token"]
SEARCH = json.loads((FIXTURES / "eightfold-lockheedmartin-search.json").read_text(encoding="utf-8"))
LM_PAGE = (FIXTURES / LM["file"]).read_text(encoding="utf-8")


def page_url(pid):
    return f"https://lockheedmartin.eightfold.ai/careers?pid={pid}&domain=lockheedmartin.com"


def response(url, status, body, ctype):
    answer = requests.Response()
    answer.status_code, answer.url = status, url
    answer._content, answer._content_consumed = body.encode("utf-8"), True
    answer.headers["Content-Type"] = ctype
    return answer


class Web:
    """The network as the pull sees it: the saved list for the board's search, saved pages for postings, nothing else."""

    def __init__(self, positions, pages):
        self.positions, self.pages, self.reads = positions, pages, []

    def __call__(self, method, url, params=None, **kwargs):
        if url == "https://lockheedmartin.eightfold.ai/api/pcsx/search":
            start = int((params or {}).get("start", 0))
            listed = self.positions.get((params or {}).get("domain"), []) if isinstance(self.positions, dict) else self.positions
            body = {**SEARCH, "data": {**SEARCH["data"], "positions": listed[start:start + 50], "count": len(listed)}}
            return response(url, 200, json.dumps(body), "application/json")
        self.reads.append(url)
        answer = self.pages.get(url)
        if answer is None:
            raise requests.ConnectionError("no such fixture address")
        if isinstance(answer, Exception):
            raise answer
        return response(url, *answer)


def position(pid, name):
    shape = SEARCH["data"]["positions"][0]
    return {**shape, "id": pid, "name": name, "positionUrl": f"/careers/job/{pid}"}


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.requests = self.root / "source-requests"
        self.requests.mkdir()
        for name, value in {"CORPUS_DB": self.root / "corpus.db", "USER_DB": self.root / "ingest.db", "DATA_DIR": self.root,
                            "POSTGRES": False, "MULTIUSER": True, "PER_HOST_DELAY": 0.0}.items():
            patcher = patch.object(config, name, value, create=True)
            patcher.start()
            self.addCleanup(patcher.stop)
        for target, value in [(source_review, "after_pull"), (source_maintenance, "after_pull")]:
            patcher = patch.object(target, value, lambda *args, **kwargs: None)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.dict(os.environ, {"JOBHUNTER_SOURCE_REQUESTS": str(self.requests)})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(db._portable_paths.clear)
        db.init_db()
        with db.connect() as conn:
            conn.execute(f"INSERT INTO {db.companies_table()} (id,name,ats_type,ats_token) VALUES (1,'Lockheed Martin','eightfold',?)", (LM_TOKEN,))

    def serve(self, positions, pages):
        self.web = Web(positions, pages)
        patcher = patch.object(http._session, "request", side_effect=self.web)
        patcher.start()
        self.addCleanup(patcher.stop)
        return self.web

    def pull(self, fresh=True):
        """One full pull. Its reads are then moved an hour back, as the next night's pull is hours later, not the same second."""
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            cli.cmd_scrape(SimpleNamespace(all=True, fresh=fresh, limit=None, company=None, list=None))
        with db.connect() as conn:
            pull_details.ensure(conn)
            conn.execute(f"UPDATE {memory.table('source_detail_reads')} SET last_attempt_at=strftime('%Y-%m-%dT%H:%M:%S+00:00', last_attempt_at, '-1 hour')")
        return out.getvalue()

    def job(self, ats_job_id):
        with db.connect() as conn:
            return dict(conn.execute(f"SELECT * FROM {db.corpus_table()} WHERE ats_job_id=?", (str(ats_job_id),)).fetchone())

    def reads_of(self, ats_job_id):
        with db.connect() as conn:
            row = conn.execute(f"SELECT attempts, outcome FROM {memory.table('source_detail_reads')} WHERE ats_job_id=?",
                               (str(ats_job_id),)).fetchone()
        return (row["attempts"], row["outcome"]) if row else None

    def change(self, target):
        change = {"id": str(uuid.uuid4()), "companyId": 1, "target": target, "requestedBy": "invented-admin", "requestedAt": 1}
        (self.requests / (change["id"] + ".json")).write_text(json.dumps(change))


class Stage(Base):
    def test_pull_keeps_the_description_of_an_in_lane_job_from_its_saved_real_page(self):
        web = self.serve([position(996477886618, LM["title"]), position(996477000001, "Software Engineer Senior"),
                          position(996477000002, "Cafeteria Cashier")],
                         {page_url(996477886618): (200, LM_PAGE, LM["contentType"]),
                          page_url(996477000001): (404, "<html><body>Not found</body></html>", "text/html")})
        out = self.pull()
        self.assertIn("Scrape done: 3 new", out, "job finding is as it was: all three jobs are found")
        self.assertIn("Descriptions kept: 1 of 2 job pages read.", out)
        kept = self.job(996477886618)["description"]
        self.assertIn(LM["expect"], kept)
        self.assertEqual(kept, posting_page.from_jsonld(LM_PAGE, LM["jobId"], LM["title"]))
        self.assertNotRegex(kept, r"<\s*/?\s*[a-zA-Z][^>]*>", "markup stripped as the scorer expects")
        self.assertLessEqual(len(kept), 64000)
        self.assertFalse((self.job(996477000001)["description"] or "").strip(), "a refused read leaves the job as it is")
        self.assertEqual(self.reads_of(996477000001), (1, "refused"))
        self.assertNotIn(page_url(996477000002), web.reads, "a job out of lane is never read")
        self.assertEqual(sorted(web.reads), sorted([page_url(996477886618), page_url(996477000001)]))

    def test_a_kept_description_survives_the_next_pull_and_nothing_is_read_twice_more(self):
        web = self.serve([position(996477886618, LM["title"]), position(996477000001, "Software Engineer Senior")],
                         {page_url(996477886618): (200, LM_PAGE, LM["contentType"]),
                          page_url(996477000001): (503, "", "text/html")})
        self.pull()
        kept = self.job(996477886618)["description"]
        out = self.pull()
        self.assertIn("0 new, 2 refreshed", out)
        self.assertEqual(self.job(996477886618)["description"], kept, "the list gives no text, and the kept text stays")
        self.assertEqual(web.reads.count(page_url(996477886618)), 1, "a kept description is never read again")
        self.assertEqual(self.reads_of(996477000001), (2, "refused"), "a refused job is read once more on a later pull")
        self.pull()
        self.assertEqual(web.reads.count(page_url(996477000001)), 2, "and then never again")
        with db.connect() as conn:
            changed = conn.execute(f"SELECT changed_count, unchanged_count FROM {memory.table('source_pull_state')}").fetchone()
        self.assertEqual((changed["changed_count"], changed["unchanged_count"]), (0, 2), "keeping text rewrites no job on later pulls")

    def test_another_jobs_page_and_a_failed_read_keep_nothing_and_never_fail_the_pull(self):
        web = self.serve([position(996477000003, "Data Scientist"), position(996477000004, "Data Engineer"),
                          position(996477000005, "Cloud Architect")],
                         {page_url(996477000003): (200, LM_PAGE, LM["contentType"]),
                          page_url(996477000004): requests.Timeout("slow"),
                          page_url(996477000005): (200, "x" * (posting_page.MAX_PAGE_BYTES + 1), "text/html")})
        out = self.pull()
        self.assertIn("Scrape done: 3 new", out)
        self.assertIn("Descriptions kept: 0 of 3 job pages read.", out)
        self.assertEqual(self.reads_of(996477000003), (1, "not_named"), "the page names another job, so its text is not this job's")
        self.assertEqual(self.reads_of(996477000004), (1, "unreadable"))
        self.assertEqual(self.reads_of(996477000005), (1, "unreadable"), "a page past the bound is not kept")
        for job in (996477000003, 996477000004, 996477000005):
            self.assertFalse((self.job(job)["description"] or "").strip())
        with patch.object(pull_details, "_plan", side_effect=RuntimeError("broken stage")):
            out = self.pull()
        self.assertIn("Descriptions stopped: RuntimeError; the pull carries on.", out)
        self.assertIn("Scrape done: 0 new, 3 refreshed", out)

    def test_caps_refusals_and_the_off_switch_hold(self):
        pids = [996477100000 + n for n in range(10)]
        pages = {page_url(pid): (200, LM_PAGE, LM["contentType"]) for pid in pids}
        web = self.serve([position(pid, LM["title"]) for pid in pids], pages)
        self.change("setting:descriptions_per_source=3")
        self.change("setting:descriptions_per_pull=99999")
        self.assertIn("Descriptions kept: 3 of 3 job pages read.", self.pull())
        with db.connect() as conn:
            outcomes = {row["target"]: row["outcome"] for row in conn.execute(f"SELECT target, outcome FROM {memory.table('source_requests')}")}
        self.assertEqual(outcomes, {"setting:descriptions_per_source=3": "setting_saved", "setting:descriptions_per_pull=99999": "bad_setting"})
        self.assertEqual(web.reads, [page_url(pid) for pid in sorted(pids, reverse=True)[:3]], "newest first, three of ten")
        self.change("setting:descriptions_per_pull=2")
        self.assertIn("Descriptions kept: 2 of 2 job pages read.", self.pull())
        self.change("setting:descriptions_minutes=0")
        self.assertNotIn("Descriptions kept", self.pull(), "no minutes, no reads")
        self.change("setting:descriptions_minutes=20")
        self.change("setting:descriptions=off")
        self.assertNotIn("Descriptions kept", self.pull(), "turned off, the stage reads nothing")
        self.assertEqual(len(web.reads), 5)
        self.change("setting:descriptions=on")
        for pid in pids:
            pages[page_url(pid)] = (403, "Forbidden", "text/html")
        self.assertIn("Descriptions kept: 0 of 2 job pages read.", self.pull(), "the per-pull cap of 2 still holds")
        self.change("setting:descriptions_per_pull=1500")
        self.change("setting:descriptions_per_source=150")
        with db.connect() as conn:
            conn.execute(f"DELETE FROM {memory.table('source_detail_reads')} WHERE outcome='refused'")
        self.assertIn("Descriptions kept: 0 of 3 job pages read.", self.pull(), "three refusals in a row end the source")

    def test_scoring_cannot_use_the_pulls_reader(self):
        with patch.dict(os.environ, {"OSHAL_EGRESS": "kernel"}), self.assertRaises(requests.RequestException):
            http.page_once(page_url(1), 1024)
        self.assertEqual(posting_page.read("eightfold", LM_TOKEN, {"url": "https://evil.example/careers?pid=1", "title": "x"}),
                         (None, "skipped"), "a page on another site is not read")


class Readers(unittest.TestCase):
    def test_each_saved_real_page_gives_its_jobs_description_and_no_other_jobs(self):
        """Every saved page through posting_page.read as the stage calls it: one GET of the listed address, the job's
        whole description, nothing for a page that names another job or answers anything but 200."""
        with patch.object(config, "PER_HOST_DELAY", 0.0):
            for entry in INDEX["fixtures"]:
                with self.subTest(entry["file"]):
                    body = (FIXTURES / entry["file"]).read_text(encoding="utf-8")
                    asked = []
                    def serve(method, url, **kwargs):
                        asked.append((method, url, kwargs.get("allow_redirects")))
                        return response(url, entry["status"], body, entry["contentType"])
                    posting = {"url": entry["url"], "ats_job_id": entry["jobId"], "title": entry["title"]}
                    with patch.object(http._session, "request", side_effect=serve):
                        text, outcome = posting_page.read(entry["kind"], entry["token"], posting)
                        self.assertEqual(asked, [("GET", entry["url"], False)], "one GET of the listed page, no redirect followed")
                        if entry.get("outcome"):
                            self.assertEqual((text, outcome), (None, entry["outcome"]))
                            continue
                        self.assertEqual(outcome, "saved")
                        self.assertIn(entry["expect"], text)
                        self.assertNotRegex(text, r"<\s*/?\s*[a-zA-Z][^>]*>|&lt;|&amp;[a-z]+;")
                        self.assertGreaterEqual(len(text), posting_page.MIN_CHARS)
                        other = {**posting, "ats_job_id": "0", "title": "Registered Nurse Night Shift"}
                        if entry.get("named", True):
                            self.assertEqual(posting_page.read(entry["kind"], entry["token"], other), (None, "not_named"),
                                             "the page names another job, so it describes nothing here")


class Clock:
    """Monotonic time that moves only when a page is read, so a source's seconds can be counted exactly."""

    def __init__(self):
        self.now = pull_details.time.monotonic()

    def monotonic(self):
        return self.now


class Caps(Base):
    def lm_pull(self, pids, pages=None, name=None):
        return self.serve([position(pid, name or LM["title"]) for pid in pids],
                          pages if pages is not None else {page_url(pid): (200, LM_PAGE, LM["contentType"]) for pid in pids})

    def test_the_raised_defaults(self):
        with db.connect() as conn:
            pull_details.ensure(conn)
            self.assertEqual(pull_details.settings(conn), {"descriptions": True, "descriptions_per_source": 600,
                             "descriptions_per_pull": 6000, "descriptions_minutes": 80, "descriptions_source_seconds": 600})

    def test_at_the_defaults_one_source_reads_600_pages_and_the_stage_then_ends_by_itself(self):
        pids = [996477300000 + n for n in range(650)]
        web = self.lm_pull(pids)
        started = pull_details.time.monotonic()
        self.assertIn("Descriptions kept: 600 of 600 job pages read.", self.pull())
        self.assertEqual(len(web.reads), 600, "the per-source cap holds at its default")
        self.assertEqual(web.reads, [page_url(pid) for pid in sorted(pids, reverse=True)[:600]], "newest first")
        out = self.pull()
        self.assertIn("Descriptions kept: 50 of 50 job pages read.", out, "the next night reads the 50 left, and stops")
        web.reads.clear()
        began = pull_details.time.monotonic()
        out = self.pull()
        self.assertNotIn("Descriptions kept", out)
        self.assertEqual(web.reads, [], "nothing left to read: no page is asked for")
        self.assertLess(pull_details.time.monotonic() - began, 30, "and the stage does not wait out its 80 minutes")

    def test_a_sources_own_seconds_are_a_setting(self):
        pids = [996477400000 + n for n in range(10)]
        web = self.lm_pull(pids)
        clock = Clock()
        def slow_read(*args, **kwargs):
            clock.now += 2.0
            return original(*args, **kwargs)
        original = posting_page.read
        self.change("setting:descriptions_source_seconds=5")
        with patch.object(pull_details, "time", clock), patch.object(posting_page, "read", side_effect=slow_read):
            out = self.pull()
        self.assertIn("Descriptions kept: 3 of 3 job pages read.", out, "2 s a page: the source stops once 5 s are used")
        self.change("setting:descriptions_source_seconds=0")
        self.assertNotIn("Descriptions kept", self.pull(), "0 seconds reads nothing")
        self.change("setting:descriptions_source_seconds=3601")
        self.assertNotIn("Descriptions kept", self.pull(), "a value past 3,600 is refused and 0 stays")
        with db.connect() as conn:
            self.assertEqual(conn.execute(f"SELECT outcome FROM {memory.table('source_requests')} WHERE target=?",
                                          ("setting:descriptions_source_seconds=3601",)).fetchone()["outcome"], "bad_setting")
        self.assertEqual(len(web.reads), 3)

    def test_a_shared_host_gets_one_sources_cap_and_the_newest_day_comes_first(self):
        with db.connect() as conn:
            conn.execute(f"INSERT INTO {db.companies_table()} (id,name,ats_type,ats_token) VALUES (2,'Lockheed Martin Space','eightfold',?)",
                         ("lockheedmartin.eightfold.ai|space.example",))
        first, second = [996477500000 + n for n in range(6)], [996477600000 + n for n in range(3)]
        url = lambda pid: page_url(pid) if pid in first else page_url(pid).replace("lockheedmartin.com", "space.example")
        pages = {url(pid): (200, LM_PAGE, LM["contentType"]) for pid in first + second}
        web = self.serve({"lockheedmartin.com": [position(pid, LM["title"]) for pid in first],
                          "space.example": [position(pid, LM["title"]) for pid in second]}, pages)
        self.change("setting:descriptions=off")
        self.pull()
        newest = {first[5], first[4], first[3], second[2]}
        with db.connect() as conn:  # Everything else was first seen three days ago.
            conn.execute(f"""UPDATE {db.corpus_table()} SET first_seen_at=strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now', '-3 days')
                WHERE ats_job_id NOT IN ({','.join("'%d'" % pid for pid in newest)})""")
        self.change("setting:descriptions=on")
        self.change("setting:descriptions_per_source=4")
        out = self.pull()
        self.assertIn("Descriptions kept: 4 of 4 job pages read.", out, "both sources are on one host: four pages in all")
        self.assertEqual(set(web.reads), {url(pid) for pid in newest},
                         "the newest day's jobs of both sources are read before either source's older ones")


class GoogleList(unittest.TestCase):
    def test_google_jobs_keep_the_description_their_results_page_already_carries(self):
        entry = next(item for item in INDEX["lists"] if item["kind"] == "google")
        page = (FIXTURES / entry["file"]).read_text(encoding="utf-8")
        for body, described in [(page, True), (page.replace("key: 'ds:1'", "key: 'ds:9'"), False),
                                (page.replace("data:[[[", "data:[[[{"), False)]:
            with self.subTest(described=described, body=body[-60:]):
                def serve(method, url, params=None, **kwargs):
                    return response(url, 200, body if (params or {}).get("page") == 1 else "<html><body></body></html>",
                                    "text/html; charset=utf-8")
                with patch.object(config, "PER_HOST_DELAY", 0.0), patch.object(http._session, "request", side_effect=serve) as asked:
                    rows = ats_custom.Google.fetch("google")
                self.assertEqual([row["ats_job_id"] for row in rows], entry["jobIds"], "job finding is unchanged")
                self.assertEqual(asked.call_count, 2, "no request beyond the two results pages the reader always reads")
                if not described:
                    self.assertEqual([row["description"] for row in rows], [None, None])
                    continue
                self.assertIn("Chrome has grown into one of the world", rows[0]["description"])
                self.assertIn("About the job", rows[1]["description"])
                self.assertIn("Responsibilities", rows[1]["description"])
                self.assertIn("Minimum qualifications", rows[1]["description"])
                self.assertNotRegex(rows[1]["description"], r"<\s*/?\s*[a-zA-Z][^>]*>")


# The same pull in its own process, killed (SIGKILL, as a restart stops it) on the third page read of the stage.
CHILD = r"""
import json, os, signal, sys
import requests
sys.path.insert(0, os.environ["TESTS"])
import importlib.util
spec = importlib.util.spec_from_file_location("contract", os.path.join(os.environ["TESTS"], "career-pull-details-contract.py"))
contract = importlib.util.module_from_spec(spec); spec.loader.exec_module(contract)
from jobhunter import cli, http, pull_details, source_maintenance, source_review
pids = json.loads(os.environ["PIDS"])
web = contract.Web([contract.position(pid, contract.LM["title"]) for pid in pids],
                   {contract.page_url(pid): (200, contract.LM_PAGE, contract.LM["contentType"]) for pid in pids})
log = open(os.environ["READ_LOG"], "a")
def serve(method, url, **kwargs):
    if "pcsx/search" not in url:
        log.write(url + "\n"); log.flush()
        if os.environ.get("KILL_AT") and sum(1 for _ in open(os.environ["READ_LOG"])) == int(os.environ["KILL_AT"]):
            os.kill(os.getpid(), signal.SIGKILL)
    return web(method, url, **kwargs)
http._session.request = serve
source_review.after_pull = source_maintenance.after_pull = lambda *a, **k: None
pull_details.BATCH = 1
sys.argv = ["jobhunter", "scrape", "--all"]
cli.main()
"""


class Stopped(Base):
    def test_a_pull_stopped_inside_the_stage_continues_without_reading_a_page_it_kept(self):
        pids = [996477200000 + n for n in range(5)]
        env = {**os.environ, "JOBHUNTER_CORPUS_DB": str(self.root / "corpus.db"), "JOBHUNTER_USER_DB": str(self.root / "ingest.db"),
               "JOBHUNTER_DATA": str(self.root), "HOME": str(self.root), "JOBHUNTER_DELAY": "0", "PYTHONDONTWRITEBYTECODE": "1",
               "TESTS": str(ROOT / "tests"), "PIDS": json.dumps(pids), "READ_LOG": str(self.root / "reads.log"),
               "JOBHUNTER_SOURCE_REQUESTS": str(self.requests),
               "PYTHONPATH": os.pathsep.join([str(ROOT / "engine"), *filter(None, os.environ.get("PYTHONPATH", "").split(os.pathsep))])}
        first = subprocess.run([sys.executable, "-c", CHILD], env={**env, "KILL_AT": "3"}, capture_output=True, text=True, timeout=120)
        self.assertEqual(first.returncode, -signal.SIGKILL, first.stdout + first.stderr)
        kept = [pid for pid in pids if (self.job(pid)["description"] or "").strip()]
        self.assertEqual(len(kept), 2, "the two pages read before the stop were kept")
        second = subprocess.run([sys.executable, "-c", CHILD], env=env, capture_output=True, text=True, timeout=120)
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertIn("Continuing the pull", second.stdout)
        reads = (self.root / "reads.log").read_text().split()
        self.assertEqual(len(reads), 3 + 3, "the continued pull read the three it had not kept, the one in flight included")
        self.assertFalse(set(reads[3:]) & {page_url(pid) for pid in kept}, "no kept page was read again")
        self.assertTrue(all((self.job(pid)["description"] or "").strip() for pid in pids))
        self.assertIn("Descriptions kept: 5 of 5 job pages read.", second.stdout, "the pull's count covers both processes")


if __name__ == "__main__":
    unittest.main(argv=["pull-details"], verbosity=2)
