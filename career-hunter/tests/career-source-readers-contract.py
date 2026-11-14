# CHANGE LOG
# 2 | maintainer@emeraldcoastsystemsgroup.com | Guard the actual Oracle window cap, named and hash-routed boards, and bounded source previews through real local HTTP and SQLite.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise counted Oracle pagination through a real local HTTP server and SQLite, plus interrupted Workday facet progress through real scratch files and store ingestion.
"""Disposable source-reader regressions; no employer or live corpus is written."""
import atexit
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
import unittest
from collections import Counter
from types import SimpleNamespace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

STORE = tempfile.TemporaryDirectory(prefix="career-source-readers-")
atexit.register(STORE.cleanup)
os.environ.update(JOBHUNTER_DATA=STORE.name, JOBHUNTER_MULTIUSER="1", JOBHUNTER_STORE="sqlite")
for key in ("JOBHUNTER_CORPUS_DB", "JOBHUNTER_USER_DB", "JOBHUNTER_DB", "DATABASE_URL"):
    os.environ.pop(key, None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
import requests
from jobhunter import ats, config, db, http, oracle_orc, resolve, source_memory as memory, workday_progress, source_requests, pull_checkpoint

TOKEN = "fixture.oraclecloud.com|CX_1|incorrect-landing.example"
STATE = {}


class Listing(BaseHTTPRequestHandler):
    def do_GET(self):
        finder = parse_qs(urlsplit(self.path).query)["finder"][0]
        offset = int(re.search(r"offset=(\d+)", finder)[1])
        limit = int(re.search(r"limit=(\d+)", finder)[1])
        STATE["offsets"].append(offset)
        if STATE.get("refuse") is not None and offset >= STATE["refuse"]:
            self.send_response(403)
            self.end_headers()
            return
        selected = re.search(r"selectedLocationsFacet=([A-Za-z0-9_-]+)", finder)
        group = selected[1] if selected else None
        STATE.setdefault("filters", []).append(group)
        found = STATE.get("groups", {}).get(group, STATE["jobs"])
        jobs = found[offset:offset + limit] if group or offset < STATE.get("cap", 1000000) else []
        if STATE.get("repeat") and offset == limit and STATE["offsets"].count(0) == 1:
            jobs = [STATE["jobs"][limit - 1], *jobs[:-1]]
        payload = {"items": [{"TotalJobsCount": len(found), "requisitionList": jobs}]}
        if STATE.get("groups") and not group:
            payload["items"][0]["locationsFacet"] = [{"Id": key, "Name": key, "TotalCount": len(rows)} for key, rows in STATE["groups"].items()]
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def log_message(self, *_args):
        pass


class LocalTransport(requests.adapters.HTTPAdapter):
    def __init__(self, origin):
        super().__init__()
        self.origin = origin

    def send(self, request, **kwargs):
        request.url = self.origin + request.url.split(".com", 1)[1]
        return super().send(request, **kwargs)


class Reply:
    ok = True

    def __init__(self, value):
        self.value = value

    def json(self):
        return self.value


class Readers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Listing)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.adapter = LocalTransport("http://127.0.0.1:" + str(cls.server.server_port))
        http._session.mount("https://fixture.oraclecloud.com/", cls.adapter)
        config.PER_HOST_DELAY = 0

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.adapter.close()

    def setUp(self):
        STATE.clear()
        STATE.update(jobs=[], offsets=[])
        with db.connect() as conn:
            conn.execute("DELETE FROM corpus.postings_corpus")
            conn.execute("DELETE FROM corpus.companies")
            conn.execute("INSERT INTO corpus.companies(id,name) VALUES(1,'Fixture')")
            db.upsert_posting(conn, 1, {"ats_job_id": "old", "title": "Existing role"})
        for path in config.DATA_DIR.glob(".workday-*.json"):
            path.unlink()

    def oracle(self, count, **settings):
        STATE.update(jobs=[{"Id": str(n), "Title": "Engineer " + str(n),
                            "PrimaryLocation": "Austin, TX, United States"} for n in range(count)], **settings)
        feed = ats.fetch("oracle_orc", TOKEN)
        with db.connect() as conn:
            result = memory.ingest(conn, 1, feed)
        return feed, result

    def test_oracle_reads_beyond_12000_and_closes_only_after_counted_completion(self):
        feed, result = self.oracle(12007)
        self.assertEqual((len(feed), feed.complete, result["closed"]), (12007, True, 1))
        self.assertEqual(STATE["offsets"][-1], 12000)
        self.assertIn("/hcmUI/CandidateExperience/en/sites/CX_1/job/", feed[0]["url"])
        self.assertNotIn("incorrect-landing", feed[0]["url"])

    def test_oracle_refused_later_page_retains_received_jobs_and_closes_none(self):
        feed, result = self.oracle(405, refuse=200)
        self.assertEqual((len(feed), feed.complete, result["closed"]), (200, False, 0))
        self.assertEqual(feed.reason, "http_refused")

    def test_oracle_page_overlap_is_deduplicated_and_missing_jobs_are_recovered(self):
        feed, result = self.oracle(205, repeat=True)
        self.assertEqual((len(feed), feed.complete, result["closed"]), (205, True, 1))
        self.assertEqual(STATE["offsets"].count(0), 2)

    def test_oracle_budget_and_empty_result_cannot_close_existing_jobs(self):
        with patch.object(oracle_orc, "MAX_PAGES", 1):
            feed, result = self.oracle(205)
        self.assertEqual((len(feed), feed.reason, result["closed"]), (200, "page_limit_reached", 0))
        feed, result = self.oracle(0)
        self.assertFalse(feed.complete)
        self.assertEqual(result["closed"], 0)

    def test_oracle_resolver_keeps_host_and_site_together(self):
        real = "https://opaque.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs"
        response = Reply({})
        response.url, response.text = "https://employer.example/", f'<a href="{real}">Jobs</a>' * 3
        with patch.object(http, "get_once", return_value=response):
            self.assertEqual(ats.resolve_orc("employer.example"), "opaque.fa.ocs.oraclecloud.com|CX_1|opaque.fa.ocs.oraclecloud.com")
        self.assertEqual(ats.OracleORC.detect(real), "opaque.fa.ocs.oraclecloud.com|CX_1|opaque.fa.ocs.oraclecloud.com")
        self.assertEqual(ats.OracleORC.detect(real.replace("/hcmUI", "/#/hcmUI")), ats.OracleORC.detect(real))
        named = real.replace("CX_1", "bristlecone-careers")
        self.assertEqual(resolve.classify_url(named), ("oracle_orc", "opaque.fa.ocs.oraclecloud.com|bristlecone-careers|opaque.fa.ocs.oraclecloud.com"))
        for url in (real.replace(".com/", ".com.evil/"), real.replace("https:", "http:"), real.replace("opaque.", "u:p@opaque.")):
            self.assertIsNone(ats.OracleORC.detect(url))

    def test_oracle_partitions_a_capped_window_and_proves_the_whole_count(self):
        jobs = [{"Id": str(n), "Title": "Engineer " + str(n)} for n in range(10007)]
        feed, result = self.oracle(10007, cap=10000, groups={"north": jobs[:6000], "south": jobs[6000:]})
        self.assertEqual((len(feed), feed.complete, result["closed"]), (10007, True, 1))
        self.assertIn("north", STATE["filters"])
        self.assertIn("south", STATE["filters"])

    def test_source_change_uses_a_real_preview_without_settling_the_full_pull(self):
        STATE.update(jobs=[{"Id": str(n), "Title": "Engineer"} for n in range(12007)])
        pull = SimpleNamespace(finished=set(), totals=Counter(), settle=lambda *_a, **_k: self.fail("a preview settled the source"))
        target = "https://fixture.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs"
        with patch.object(source_requests, "_is_public_link", return_value=True):
            result = source_requests._apply({"company_id": 1, "target": target}, pull)
        self.assertEqual((result["outcome"], result["jobs"], result["closed"], result["complete"]), ("applied", 3, 0, False))
        self.assertEqual(pull.finished, set())
        self.assertEqual(STATE["offsets"], [0])
        with db.connect() as conn:
            self.assertEqual(conn.execute("SELECT ats_type FROM corpus.companies WHERE id=1").fetchone()[0], "oracle_orc")
            self.assertEqual(conn.execute("SELECT active FROM corpus.postings_corpus WHERE ats_job_id='old'").fetchone()[0], 1)

    def workday(self, calls, stop=False, extra=False):
        def answer(_url, json):
            applied, offset = json["appliedFacets"], json["offset"]
            group = (applied.get("region") or ["all"])[0]
            calls.append((group, offset))
            if stop and group == "b":
                raise SystemExit("fixture process restart")
            found = [f"/job/{g}/{n}" for g in ("a", "b") if group in ("all", g)
                     for n in range(31 if extra and g == "a" else 30)]
            data = {"total": min(40, len(found)) if offset == 0 else 0,
                    "jobPostings": [{"title": "Engineer", "externalPath": key} for key in found[offset:offset + 20]]}
            if not applied:
                data["facets"] = [{"facetParameter": "region", "values": [
                    {"id": "a", "count": 31 if extra else 30}, {"id": "b", "count": 30}]}]
            return Reply(data)
        with patch.object(ats, "WORKDAY_CAP", 40), patch.object(http, "post", side_effect=answer), \
                patch.dict(os.environ, JOBHUNTER_SOURCE_REQUESTS="fixture-writer"):
            return ats.fetch("workday", "fixture:wd5:Careers")

    def test_source_preview_reopens_an_old_finished_source_in_a_resumed_pull(self):
        STATE.update(jobs=[{"Id": str(n), "Title": "Engineer"} for n in range(10)])
        pull = pull_checkpoint.begin(fresh=True)
        self.assertTrue(pull.claim({"id": 1, "name": "Fixture"}))
        with db.connect() as conn:
            pull.settle(conn, 1, new=5, unconfirmed=1)
        pull = pull_checkpoint.begin()
        self.assertIn(1, pull.finished)
        with patch.object(source_requests, "_is_public_link", return_value=True):
            result = source_requests._apply({"company_id": 1, "target": "oracle_orc:" + TOKEN}, pull)
        self.assertEqual(result["jobs"], 3)
        self.assertNotIn(1, pull.finished)
        self.assertEqual(pull.totals["new"], 0)
        self.assertTrue(pull.claim({"id": 1, "name": "Fixture"}))
        with db.connect() as conn:
            row = conn.execute("SELECT attempts,counts FROM corpus.pull_checkpoint_sources WHERE company_id=1").fetchone()
            self.assertEqual(tuple(row), (1, None))

    def test_workday_restart_reuses_finished_facets_and_changed_counts_are_reread(self):
        calls = []
        with self.assertRaisesRegex(SystemExit, "fixture process restart"):
            self.workday(calls, stop=True)
        self.assertIn(("a", 20), calls)
        resumed = []
        feed = self.workday(resumed)
        self.assertEqual((len(feed), feed.complete), (60, True))
        self.assertNotIn(("a", 20), resumed)
        self.assertEqual(list(config.DATA_DIR.glob(".workday-*.json")), [])
        with self.assertRaises(SystemExit):
            self.workday([], stop=True)
        changed = []
        feed = self.workday(changed, extra=True)
        self.assertEqual((len(feed), feed.complete), (61, True))
        self.assertIn(("a", 20), changed)

    def test_expired_progress_is_reread(self):
        with self.assertRaises(SystemExit):
            self.workday([], stop=True)
        with patch.object(workday_progress, "MAX_AGE", 0):
            calls = []
            feed = self.workday(calls)
        self.assertTrue(feed.complete)
        self.assertIn(("a", 20), calls)


if __name__ == "__main__":
    unittest.main()
