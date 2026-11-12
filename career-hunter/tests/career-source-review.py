"""CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Prove the nightly source review on real temporary SQLite with the real connectors and page parser over recorded employer replies, and prove the public-only guard against a real local HTTP server.
2 | maintainer@emeraldcoastsystemsgroup.com | A careers link on a board vendor's site (jobs.lever.co, myworkdayjobs.com, boards.greenhouse.io) lends the employer no name: a board with the vendor's word in it does not look like the employer, while its own name and its own site still do.
"""
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stdout, redirect_stderr
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
os.environ["JOBHUNTER_STORE"] = "sqlite"
os.environ["JOBHUNTER_MULTIUSER"] = "1"
from jobhunter import ats, cli, config, db, discover, http, source_memory as memory, source_review as review

CAREERS = "https://careers.fixture.example/jobs"
GREENHOUSE = "https://boards-api.greenhouse.io/v1/boards/"
LEVER = "https://api.lever.co/v0/postings/"


class Reply:
    def __init__(self, body=None, status=200, text=None, url=""):
        self.body, self.status_code, self.url = body, status, url
        self.text = text if text is not None else ""
        self.ok, self.headers, self.encoding = status < 400, {}, "utf-8"

    def json(self):
        return self.body

    def iter_content(self, _size):
        yield self.text.encode("utf-8")

    def close(self):
        pass


def board(*titles):
    return {"jobs": [{"id": index, "title": title, "location": {"name": "Remote"}, "absolute_url": f"https://jobs.example/{index}"}
                     for index, title in enumerate(titles, 1)]}


def page(*links):
    return "<html><body>" + "".join(f'<a href="{link}">Open roles</a>' for link in links) + "</body></html>"


class Internet:
    """Recorded employer replies behind the real connectors; anything unlisted is a 404, and every request is kept."""

    def __init__(self, replies=None):
        self.replies, self.asked = dict(replies or {}), []

    def request(self, _method, url, **_):
        self.asked.append(url)
        for prefix, reply in self.replies.items():
            if url.startswith(prefix):
                if isinstance(reply, Exception):
                    raise reply
                reply.url = url
                return reply
        return Reply(status=404, url=url)


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        config.CORPUS_DB = Path(self.temp.name) / "corpus.db"
        config.USER_DB = Path(self.temp.name) / "user.db"
        config.MULTIUSER, config.POSTGRES = True, False
        db._multiuser_inited.clear()
        config.PER_HOST_DELAY = 0
        with db.connect() as conn:
            memory.ensure(conn)

    def tearDown(self):
        os.chmod(config.CORPUS_DB, 0o660)
        self.temp.cleanup()

    def company(self, id=1, name="Fixture Co", ats_type="greenhouse", token="oldboard", careers=CAREERS, homepage=None,
                status="empty_unconfirmed", failures=3, discover_status="found"):
        with db.connect() as conn:
            conn.execute("""INSERT INTO companies(id,name,homepage,careers_url,ats_type,ats_token,discover_status)
                VALUES(?,?,?,?,?,?,?)""", (id, name, homepage, careers, ats_type, token, discover_status))
            if status:
                conn.execute(f"""INSERT INTO {memory.table('source_pull_state')} (company_id,status,consecutive_failures)
                    VALUES(?,?,?)""", (id, status, failures))

    def row(self, id=1):
        with db.connect() as conn:
            return dict(conn.execute("SELECT ats_type,ats_token,discover_status FROM companies WHERE id=?", (id,)).fetchone())

    def item(self, id=1):
        with db.connect() as conn:
            found = conn.execute(f"SELECT * FROM {memory.table('source_review_items')} WHERE company_id=?", (id,)).fetchone()
        return dict(found) if found else None

    def active(self, id=1):
        with db.connect() as conn:
            return conn.execute("SELECT COUNT(*) AS n FROM corpus.postings_corpus WHERE company_id=? AND active=1", (id,)).fetchone()["n"]

    def review(self, internet, **kwargs):
        with patch.object(http._session, "request", side_effect=internet.request), redirect_stdout(StringIO()):
            return review.run(**kwargs)


class Repairs(Base):
    def test_a_dead_board_moves_to_the_board_on_the_employers_own_page_and_its_jobs_arrive_that_night(self):
        self.company()
        report = self.review(Internet({CAREERS: Reply(text=page("https://boards.greenhouse.io/fixtureco")),
                                       GREENHOUSE + "fixtureco": Reply(board("IT Manager", "Network Engineer"))}))
        self.assertEqual(self.row(), {"ats_type": "greenhouse", "ats_token": "fixtureco", "discover_status": "found"})
        self.assertEqual(self.active(), 2)
        repaired = report["review"]["repaired"][0]
        self.assertEqual((repaired["company"], repaired["from"], repaired["to"], repaired["jobs"]),
                         ("Fixture Co", "greenhouse:oldboard", "greenhouse:fixtureco", 2))
        self.assertEqual(report["sources"]["whole"], 1, "the repaired source's own pull state is recorded")
        self.assertEqual(self.item()["outcome"], "repaired")

    def test_an_employer_with_no_feed_gets_one_from_its_own_page(self):
        self.company(ats_type=None, token=None, status=None, discover_status="careers_only")
        self.review(Internet({CAREERS: Reply(text=page("https://jobs.lever.co/fixtureco")),
                              LEVER + "fixtureco": Reply([{"id": "a", "text": "Analyst", "categories": {}, "hostedUrl": "https://x/a"}])}))
        self.assertEqual(self.row(), {"ats_type": "lever", "ats_token": "fixtureco", "discover_status": "found"})
        self.assertEqual(self.active(), 1)

    def test_a_repair_that_fails_part_way_leaves_the_old_source_exactly_as_it_was(self):
        self.company()
        internet = Internet({CAREERS: Reply(text=page("https://boards.greenhouse.io/fixtureco")), GREENHOUSE + "fixtureco": Reply(board("Analyst"))})
        with patch.object(memory, "ingest", side_effect=RuntimeError("fixture write failure")):
            report = self.review(internet)
        self.assertEqual(self.row()["ats_token"], "oldboard")
        self.assertEqual(self.active(), 0)
        self.assertEqual(report["review"]["outcomes"], {"error": 1})
        with db.connect() as conn:
            state = conn.execute(f"SELECT status FROM {memory.table('source_pull_state')} WHERE company_id=1").fetchone()
        self.assertEqual(state["status"], "empty_unconfirmed")


class WhatItWillNotChange(Base):
    def assert_untouched(self, id=1, ats_type="greenhouse", token="oldboard"):
        self.assertEqual((self.row(id)["ats_type"], self.row(id)["ats_token"]), (ats_type, token))
        self.assertEqual(self.active(id), 0)

    def test_a_name_match_alone_is_a_suggestion_and_changes_nothing(self):
        self.company(token="old-board", careers=None, name="Fixture")
        report = self.review(Internet({GREENHOUSE + "fixture": Reply(board("Someone else's job"))}))
        self.assert_untouched(token="old-board")
        suggestion = report["review"]["suggested"][0]
        self.assertEqual((suggestion["reason"], suggestion["options"]), ("name match only", ["greenhouse:fixture"]))

    def test_healthy_sources_and_one_or_two_bad_nights_are_not_rechecked(self):
        self.company(1, "Healthy", status="ok", failures=0)
        self.company(2, "Bad Night", status="failed", failures=2)
        self.company(3, "Partial", status="partial", failures=9)
        internet = Internet()
        report = self.review(internet)
        self.assertEqual(internet.asked, [])
        self.assertEqual(report["review"]["checked"], 0)

    def test_a_source_a_person_chose_is_never_overridden(self):
        self.company(1, "Pinned", ats_type="manual", token="x")
        self.company(2, "By Hand", token=None, status=None, discover_status="manual")
        internet = Internet()
        self.review(internet)
        self.assertEqual(internet.asked, [])

    def test_a_board_with_no_jobs_is_not_applied(self):
        self.company()
        report = self.review(Internet({CAREERS: Reply(text=page("https://boards.greenhouse.io/fixtureco")), GREENHOUSE + "fixtureco": Reply(board())}))
        self.assert_untouched()
        self.assertEqual(report["review"]["outcomes"], {"nothing": 1})

    def test_a_board_returning_only_untitled_rows_is_not_applied(self):
        self.company()
        report = self.review(Internet({CAREERS: Reply(text=page("https://boards.greenhouse.io/fixtureco")),
                                       GREENHOUSE + "fixtureco": Reply({"jobs": [{"id": 1, "title": None, "location": {}}]})}))
        self.assert_untouched()
        self.assertEqual(report["review"]["outcomes"], {"nothing": 1})

    def test_a_board_another_employer_already_holds_is_not_taken_whatever_its_case(self):
        self.company()
        self.company(2, "Parent Co", token="FixtureCo", careers=None, status="ok", failures=0)
        report = self.review(Internet({CAREERS: Reply(text=page("https://boards.greenhouse.io/fixtureco")), GREENHOUSE + "fixtureco": Reply(board("Analyst"))}))
        self.assert_untouched()
        self.assertEqual(report["review"]["duplicates"][0]["owner"], "Parent Co")

    def test_several_live_boards_on_one_page_are_left_for_a_person(self):
        self.company()
        # Both look like the employer, so only the several-boards rule can stop this.
        report = self.review(Internet({CAREERS: Reply(text=page("https://boards.greenhouse.io/fixtureco-us", "https://boards.greenhouse.io/fixtureco-eu")),
                                       GREENHOUSE + "fixtureco-us": Reply(board("A")), GREENHOUSE + "fixtureco-eu": Reply(board("B"))}))
        self.assert_untouched()
        self.assertEqual(sorted(report["review"]["suggested"][0]["options"]), ["greenhouse:fixtureco-eu", "greenhouse:fixtureco-us"])
        self.assertEqual(report["review"]["suggested"][0]["reason"], "several boards on the employer's page")

    def test_a_link_to_a_single_employers_site_proves_nothing_about_this_employer(self):
        self.company()
        internet = Internet({CAREERS: Reply(text=page("https://www.amazon.jobs/en/search"))})
        report = self.review(internet)
        self.assert_untouched()
        self.assertEqual(report["review"]["outcomes"], {"nothing": 1})
        self.assertFalse([url for url in internet.asked if "amazon.jobs" in url], "it is not even read as a candidate")

    def test_a_page_pointing_at_the_board_it_already_has_is_not_a_repair(self):
        self.company()
        internet = Internet({CAREERS: Reply(text=page("https://boards.greenhouse.io/oldboard")), GREENHOUSE + "oldboard": Reply(board("Analyst"))})
        report = self.review(internet)
        self.assert_untouched()
        self.assertEqual(report["review"]["outcomes"], {"nothing": 1})

    def test_a_board_that_does_not_look_like_the_employer_is_only_a_suggestion(self):
        # The real shape: an employer's page or an old guess pointing at another company's board.
        self.company(name="Crown Castle", careers="https://careers.crowncastle.example/")
        report = self.review(Internet({"https://careers.crowncastle.example/": Reply(text=page("https://boards.greenhouse.io/remotecom")),
                                       GREENHOUSE + "remotecom": Reply(board("Someone else's job"))}))
        self.assert_untouched()
        self.assertEqual(report["review"]["suggested"][0]["reason"], "the board's name does not look like this employer")

    def test_resemblance_goes_by_the_employers_name_or_its_own_website(self):
        row = lambda name, careers=None, homepage=None: {"name": name, "careers_url": careers, "homepage": homepage}
        for employer, token in ((row("D. R. Horton"), "drhorton"), (row("Snyk"), "snyk"), (row("Fixture Co"), "fixtureco"),
                                (row("Booz Allen Hamilton"), "boozallen"),
                                (row("Automatic Data Processing", "https://careers.adp.example.com/"), "example"),
                                (row("Leidos"), "leidos:wd5:External")):
            self.assertTrue(review._resembles(employer, token), (employer["name"], token))
        for employer, token in ((row("Crown Castle"), "remotecom"), (row("American Group"), "american-express-rival"),
                                (row("Fixture Co"), "xy"), (row("Global Energy Services"), "services")):
            self.assertFalse(review._resembles(employer, token), (employer["name"], token))

    def test_a_careers_link_on_a_board_vendors_site_lends_the_employer_no_name(self):
        # The link is the employer's page on the vendor's site: its site label is the vendor's ("lever", "myworkdayjobs"),
        # and taking it for the employer's own made any board with that word in it look like the employer.
        row = lambda careers: {"name": "Acme Robotics", "careers_url": careers, "homepage": None}
        for careers, token in (("https://jobs.lever.co/acmerobotics", "cleverdevices"),
                               ("https://acmerobotics.wd5.myworkdayjobs.com/External", "myworkdayjobsdemo:wd1:Careers"),
                               ("https://boards.greenhouse.io/acmerobotics", "greenhouseinc")):
            self.assertFalse(review._resembles(row(careers), token), (careers, token))
        self.assertTrue(review._resembles(row("https://jobs.lever.co/acmerobotics"), "acmerobotics"), "its own name still counts")
        self.assertTrue(review._resembles(row("https://careers.acmebots.example/"), "acmebots"), "and so does its own site")

    def test_a_board_that_can_name_any_host_is_never_read_or_applied(self):
        # Radancy takes the host from the link, so a hostile page could otherwise name its own site as a job board.
        self.company()
        internet = Internet({CAREERS: Reply(text=page("https://evil.example/search-jobs"))})
        report = self.review(internet)
        self.assert_untouched()
        self.assertEqual(report["review"]["suggested"][0]["options"], ["radancy:evil.example"])
        self.assertNotIn("jobs", report["review"]["suggested"][0], "it was not read, so no count is claimed")
        self.assertFalse([url for url in internet.asked if "evil.example" in url])

    def test_a_feed_that_cannot_be_proven_whole_is_only_a_suggestion(self):
        # Moving to it would leave the dead source's jobs open for good, because a partial feed closes nothing.
        self.company()
        internet = Internet({CAREERS: Reply(text=page("https://boards.greenhouse.io/fixtureco"))})
        with patch.object(ats, "fetch", return_value=memory.Feed([{"ats_job_id": "a", "title": "Analyst"}], reason="pagination_incomplete")):
            report = self.review(internet)
        self.assert_untouched()
        self.assertEqual(report["review"]["suggested"][0]["reason"], "the feed could not be proven whole")

    def test_more_boards_than_it_will_read_is_left_for_a_person_unread(self):
        self.company()
        links = [f"https://boards.greenhouse.io/fixtureco{index}" for index in range(review.MAX_CANDIDATES + 1)]
        internet = Internet({CAREERS: Reply(text=page(*links))})
        report = self.review(internet)
        self.assert_untouched()
        self.assertEqual(report["review"]["suggested"][0]["reason"], "several boards on the employer's page")
        self.assertEqual(internet.asked, [CAREERS])

    def test_a_read_only_corpus_is_skipped_without_writing(self):
        self.company()
        os.chmod(config.CORPUS_DB, 0o440)
        internet = Internet()
        self.assertIsNone(self.review(internet))
        self.assertEqual(internet.asked, [])


class Slow(Base):
    """A real alarm and real blocking calls: a budget checked between sources cannot stop any of these."""

    def test_a_source_that_never_answers_costs_its_time_limit_and_the_review_carries_on(self):
        self.company(1, "Stalls", careers="https://stall.example/", token="old1")
        self.company(2, "Fixture Co", token="old2")

        class Stall(Reply):
            def iter_content(self, _size):
                time.sleep(60)
                yield b""

        internet = Internet({"https://stall.example/": Stall(text="x"), CAREERS: Reply(text=page("https://boards.greenhouse.io/fixtureco")),
                             GREENHOUSE + "fixtureco": Reply(board("Analyst"))})
        started = time.monotonic()
        with patch.object(review, "SOURCE_SECONDS", 1):
            report = self.review(internet)
        self.assertLess(time.monotonic() - started, 10)
        self.assertEqual(report["review"]["outcomes"], {"timeout": 1, "repaired": 1})
        self.assertEqual(self.item(1)["outcome"], "timeout")

    def test_the_stop_goes_through_connectors_that_catch_exception(self):
        self.company(token="old1", careers=None, name="Fixture")
        internet = Internet()

        def sleeps(*_args, **_kwargs):
            try:
                time.sleep(60)
            except Exception:  # The shape of the connectors' own broad handlers.
                self.fail("the stop must not be an Exception")

        started = time.monotonic()
        with patch.object(ats.Greenhouse, "probe", side_effect=sleeps), patch.object(review, "SOURCE_SECONDS", 1):
            report = self.review(internet)
        self.assertLess(time.monotonic() - started, 10)
        self.assertEqual(report["review"]["outcomes"], {"timeout": 1})

    def test_the_whole_review_cannot_outlast_its_budget_on_one_source(self):
        self.company(1, "Stalls", careers="https://stall.example/", token="old1")

        class Stall(Reply):
            def iter_content(self, _size):
                time.sleep(60)
                yield b""

        started = time.monotonic()
        report = self.review(Internet({"https://stall.example/": Stall(text="x")}), max_seconds=1)
        self.assertLess(time.monotonic() - started, 10)
        self.assertEqual(report["review"]["outcomes"], {"timeout": 1})

    def test_a_timed_out_review_leaves_no_journal_that_would_stop_the_publish(self):
        self.company()
        real = memory.ingest

        def slow_ingest(*args, **kwargs):
            counts = real(*args, **kwargs)
            time.sleep(60)
            return counts

        with patch.object(memory, "ingest", side_effect=slow_ingest), patch.object(review, "SOURCE_SECONDS", 1):
            self.review(Internet({CAREERS: Reply(text=page("https://boards.greenhouse.io/fixtureco")), GREENHOUSE + "fixtureco": Reply(board("Analyst"))}))
        self.assertEqual(self.row()["ats_token"], "oldboard", "the interrupted transaction rolled back")
        self.assertEqual(sorted(p.name for p in config.CORPUS_DB.parent.glob("corpus.db-*")), [], "the kernel refuses to publish with a journal left behind")


class Refusals(Base):
    def assert_left_alone_for_a_month(self, outcome):
        item = self.item()
        self.assertEqual(item["outcome"], outcome)
        retry = datetime.fromisoformat(item["retry_after"])
        self.assertGreater(retry, datetime.now(timezone.utc) + timedelta(days=29))

    def test_an_employer_that_refuses_is_left_alone_and_never_worked_around(self):
        self.company(homepage="https://www.fixture.example/", name="Fixture")
        internet = Internet({CAREERS: Reply(status=403), GREENHOUSE + "fixture": Reply(board("Should not be asked"))})
        report = self.review(internet)
        self.assertEqual(internet.asked, [CAREERS], "no other page, no name probe, no retry after a refusal")
        self.assertEqual(report["review"]["outcomes"], {"blocked": 1})
        self.assert_left_alone_for_a_month("blocked")
        internet = Internet()
        self.review(internet)
        self.assertEqual(internet.asked, [], "the next nights do not ask again")

    def test_a_challenge_page_is_a_refusal_even_with_status_200(self):
        self.company()
        report = self.review(Internet({CAREERS: Reply(text="<title>Just a moment...</title><a href='https://boards.greenhouse.io/fixtureco'>x</a>")}))
        self.assertEqual(report["review"]["outcomes"], {"blocked": 1})
        self.assertEqual(self.row()["ats_token"], "oldboard")

    def test_a_link_to_a_private_address_stops_the_source(self):
        self.company()
        report = self.review(Internet({CAREERS: http.PrivateAddressRefused("fixture")}))
        self.assertEqual(report["review"]["outcomes"], {"unsafe": 1})
        self.assert_left_alone_for_a_month("unsafe")


class Budget(Base):
    def fill(self, count):
        for id in range(1, count + 1):
            self.company(id, f"Employer {id}", token=f"old{id}")

    def test_the_budget_stops_the_night_and_the_longest_waiting_go_first_next_time(self):
        self.fill(5)
        first = self.review(Internet(), max_sources=2)
        self.assertEqual((first["review"]["checked"], first["review"]["waiting"]), (2, 3))
        self.assertIsNotNone(self.item(1))
        self.assertIsNone(self.item(3))
        second = self.review(Internet(), max_sources=2)
        self.assertEqual((second["review"]["checked"], second["review"]["waiting"]), (2, 1))
        self.assertIsNotNone(self.item(4))
        self.assertIsNone(self.item(5))

    def test_never_checked_sources_go_first_then_the_longest_since_checked(self):
        self.fill(3)
        with db.connect() as conn:
            review.ensure(conn)
            for id, at in ((1, "2026-10-02T00:00:00+00:00"), (2, "2026-10-01T00:00:00+00:00")):
                conn.execute(f"""INSERT INTO {memory.table('source_review_items')} (company_id,reviewed_at,retry_after,outcome,detail)
                    VALUES(?,?,'2000-01-01T00:00:00+00:00','nothing','{{}}')""", (id, at))
            order = [row["id"] for row in review._queue(conn)]
        self.assertEqual(order, [3, 2, 1])

    def test_the_time_budget_ends_the_review_but_the_report_is_still_written(self):
        self.fill(3)
        report = self.review(Internet(), max_seconds=0)
        self.assertEqual((report["review"]["checked"], report["review"]["waiting"]), (0, 3))
        with db.connect() as conn:
            self.assertEqual(conn.execute(f"SELECT COUNT(*) AS n FROM {memory.table('source_review_runs')}").fetchone()["n"], 1)

    def test_a_source_with_nothing_found_comes_back_after_a_week(self):
        self.company()
        self.review(Internet())
        internet = Internet()
        self.review(internet)
        self.assertEqual(internet.asked, [])
        with db.connect() as conn:
            conn.execute(f"UPDATE {memory.table('source_review_items')} SET retry_after='2000-01-01T00:00:00+00:00'")
        internet = Internet()
        self.review(internet)
        self.assertIn(CAREERS, internet.asked)

    def test_one_source_crashing_costs_only_that_source(self):
        self.company(1, "Crashes", careers="https://crash.example/", token="old1")
        self.company(2, "Fixture Co", token="old2")
        real = discover._find_career_links

        def parse(html, url):
            if "crash" in url:
                raise RuntimeError("fixture parser failure")
            return real(html, url)

        with patch.object(discover, "_find_career_links", side_effect=parse):
            report = self.review(Internet({"https://crash.example/": Reply(text=page()), CAREERS: Reply(text=page("https://boards.greenhouse.io/fixtureco")),
                                           GREENHOUSE + "fixtureco": Reply(board("Analyst"))}))
        self.assertEqual(report["review"]["outcomes"], {"error": 1, "repaired": 1})
        self.assertEqual(json.loads(self.item(1)["detail"]), {"outcome": "error", "errorType": "RuntimeError"})
        self.assertEqual(self.row(2)["ats_token"], "fixtureco")


class Report(Base):
    def run_row(self, company, attempt, at, status="partial", fetched=0, closed=0, new=0, changed=0, unchanged=0):
        with db.connect() as conn:
            conn.execute(f"""INSERT INTO {memory.table('source_pull_runs')} (attempt_id,company_id,last_attempt_at,completed_at,status,
                fetched,new_count,changed_count,unchanged_count,closed_count) VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (attempt, company, at, at, status, fetched, new, changed, unchanged, closed))

    def test_it_says_what_changed_what_the_pull_did_and_what_looks_wrong(self):
        self.company(1, "Capped Closer", status="ok", failures=0)
        self.company(2, "Stuck Feed", status="partial", failures=9)
        self.company(3, "Dead Feed", status="failed", failures=9, careers=None)
        self.company(4, "Small Closer", status="ok", failures=0)
        self.company(5, "No Feed", ats_type=None, token=None, status=None, careers=None, discover_status="not_found")
        self.company(6, "Varying Feed", status="partial", failures=9)
        self.company(7, "Stable Large Board", status="partial", failures=9)
        self.company(8, "Whole At A Round Count", status="ok", failures=0)
        since = "2026-11-03T00:00:00+00:00"
        self.run_row(1, "a", "2026-11-03T01:00:00+00:00", "ok", fetched=2000, closed=6262, new=391, changed=294, unchanged=1315)
        self.run_row(4, "b", "2026-11-03T01:00:00+00:00", "ok", fetched=100, closed=60, unchanged=100)
        for day, attempt in enumerate("cde", 1):
            self.run_row(2, attempt, f"2026-11-0{day}T01:00:00+00:00", fetched=8000, unchanged=8000)
            self.run_row(6, attempt + "-varies", f"2026-10-0{day}T01:00:00+00:00", fetched=700 + 100 * day)  # Ends on a round count, so only the equal-counts rule excludes it.
            self.run_row(7, attempt + "-stable", f"2026-10-0{day}T01:00:00+00:00", fetched=1234)
            self.run_row(8, attempt + "-whole", f"2026-10-0{day}T01:00:00+00:00", "ok", fetched=2000)
        self.run_row(1, "old", "2026-10-01T01:00:00+00:00", "ok", fetched=99999, closed=99999)
        first = self.review(Internet(), since=since)
        self.assertEqual(first["sources"], {"whole": 3, "unverified": 3, "empty": 0, "failed": 1, "noFeed": 1})
        self.assertIsNone(first["previousSources"])
        self.assertEqual((first["delta"]["read"], first["delta"]["new"], first["delta"]["closed"]), (2000 + 100 + 8000, 391, 6322))
        self.assertEqual([entry["company"] for entry in first["massClosed"]], ["Capped Closer"], "a closure share under half is normal churn")
        self.assertEqual([(entry["company"], entry["jobs"]) for entry in first["stuck"]], [("Stuck Feed", 8000)])
        self.assertEqual(first["stillBroken"][0]["company"], "Dead Feed")
        second = self.review(Internet(), since=since)
        self.assertEqual(second["previousSources"], first["sources"])

    def test_it_keeps_a_bounded_history_and_the_report_is_valid_json(self):
        self.company(status="ok", failures=0)
        with patch.object(review, "KEEP_REPORTS", 3):
            for _ in range(5):
                self.review(Internet())
        with db.connect() as conn:
            rows = conn.execute(f"SELECT report FROM {memory.table('source_review_runs')}").fetchall()
        self.assertEqual(len(rows), 3)
        for row in rows:
            self.assertEqual(json.loads(row["report"])["version"], 1)


class ThePull(Base):
    def scrape(self, **kwargs):
        args = SimpleNamespace(**{"all": True, "limit": None, "company": None, "list": None, **kwargs})
        out = StringIO()
        with patch.object(memory, "fetch", return_value=memory.Feed([], reason="empty_unconfirmed")), redirect_stdout(out), redirect_stderr(StringIO()):
            cli.cmd_scrape(args)
        return out.getvalue()

    def test_a_full_pull_ends_with_a_review_and_keeps_its_summary_line(self):
        with patch.object(review, "after_pull") as after:
            output = self.scrape()
        self.assertIn("Scrape done:", output, "the kernel reads this line for the run's summary")
        after.assert_called_once()

    def test_a_partial_pull_does_not_trigger_a_review(self):
        with patch.object(review, "after_pull") as after:
            self.scrape(all=False, company="Fixture Co")
            self.scrape(limit=5)
        after.assert_not_called()

    def test_a_caller_that_passes_no_all_field_is_not_a_full_pull(self):
        args = SimpleNamespace(company="Fixture Co", list=None, limit=None)
        with patch.object(review, "after_pull") as after, redirect_stdout(StringIO()):
            cli.cmd_scrape(args)
        after.assert_not_called()

    def test_a_crashing_review_never_stops_the_pull_from_publishing(self):
        with patch.object(review, "run", side_effect=RuntimeError("fixture review failure")):
            output = self.scrape()
        self.assertIn("Scrape done:", output)
        self.assertIn("publishes without it", output)


class Handler(BaseHTTPRequestHandler):
    hits = []

    def do_GET(self):
        Handler.hits.append(self.path)
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", f"http://127.0.0.1:{self.server.server_port}/inside")
            self.end_headers()
            return
        self.send_response(200)
        self.end_headers()
        try:
            if self.path == "/endless":
                while True:
                    self.wfile.write(b"x" * 100_000)
            elif self.path == "/drip":
                while True:
                    self.wfile.write(b"x")
                    self.wfile.flush()
                    time.sleep(0.2)
            else:
                self.wfile.write(b"reached")
        except OSError:
            pass

    def log_message(self, *_):
        pass


class PublicOnly(unittest.TestCase):
    """Against a real local server through the real session, because the guard's whole job is to stop a real connection."""

    def setUp(self):
        Handler.hits = []
        config.PER_HOST_DELAY = 0
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_a_private_address_is_refused_before_any_connection(self):
        with http.public_only(), self.assertRaises(http.PrivateAddressRefused):
            http.get_once(self.base + "/inside")
        self.assertEqual(Handler.hits, [])

    def test_a_name_that_changes_its_answer_is_stopped_at_the_connection(self):
        # DNS rebinding: the name looks public when checked, and connects inside.
        with patch.object(http, "_host_is_public", return_value=True), http.public_only(), self.assertRaises(http.PrivateAddressRefused):
            http.get_once(self.base + "/inside")
        self.assertEqual(Handler.hits, [], "no request was sent")

    def test_a_name_that_will_not_resolve_is_refused_rather_than_left_to_a_second_lookup(self):
        with patch("socket.getaddrinfo", side_effect=socket.gaierror("fixture")):
            self.assertFalse(http._host_is_public("flaky.example"))

    def test_an_endless_page_is_read_only_to_its_cap(self):
        with review._time_limit(20):  # Reading past the cap would never finish, and this would fail the test.
            page_read, problem = review._read_page(self.base + "/endless")
        self.assertIsNone(problem)
        self.assertEqual(len(page_read.text), review.MAX_PAGE_BYTES)

    def test_a_page_that_drips_forever_is_stopped_by_the_alarm(self):
        started = time.monotonic()
        with self.assertRaises(review.SourceTimedOut), review._time_limit(1):
            review._read_page(self.base + "/drip")
        self.assertLess(time.monotonic() - started, 5)

    def test_the_guard_ends_with_its_block(self):
        with http.public_only():
            pass
        self.assertEqual(http.get_once(self.base + "/inside").text, "reached")
        self.assertEqual(Handler.hits, ["/inside"])

    def test_a_redirect_into_a_private_address_is_refused_at_the_hop(self):
        # The fixture lives on loopback, so the connection check steps aside to isolate the hop check.
        allowed = lambda host: host == "localhost"
        with patch.object(http, "_host_is_public", side_effect=allowed), patch.object(http, "_is_public_address", return_value=True), \
                http.public_only(), self.assertRaises(http.PrivateAddressRefused):
            http.get_once(f"http://localhost:{self.server.server_port}/redirect")
        self.assertEqual(Handler.hits, ["/redirect"], "the first hop was allowed and the private one never connected")

    def test_a_guarded_connector_cannot_reach_inside_from_its_own_thread(self):
        outcome = []

        def read():
            try:
                http.get_once(self.base + "/inside")
                outcome.append("reached")
            except http.PrivateAddressRefused:
                outcome.append("refused")

        with http.public_only():
            worker = threading.Thread(target=read)
            worker.start()
            worker.join()
        self.assertEqual(outcome, ["refused"])

    def test_a_name_with_any_private_answer_is_not_public(self):
        answer = lambda *addresses: [(2, 1, 6, "", (address, 0)) for address in addresses]
        with patch("socket.getaddrinfo", return_value=answer("93.184.216.34", "10.0.0.5")):
            self.assertFalse(http._host_is_public("rebinding.example"))
        with patch("socket.getaddrinfo", return_value=answer("93.184.216.34")):
            self.assertTrue(http._host_is_public("employer.example"))
        for address in ("127.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fe80::1%eth0", "224.0.0.1"):
            self.assertFalse(http._is_public_address(address), address)


if __name__ == "__main__":
    unittest.main()
