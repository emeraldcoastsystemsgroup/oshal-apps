"""CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Exercise source health, unchanged-body protection, conditional HTTP and complete-feed closure against real temporary SQLite.
2 | maintainer@emeraldcoastsystemsgroup.com | Prove a Workday board past the 2,000-job search cap is read whole, and that one which cannot be proven whole closes nothing, against the search as measured live.
"""
import ast
import json
import os
import sys
import tempfile
import unittest
from collections import Counter
from contextlib import redirect_stdout
from io import StringIO
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
os.environ["JOBHUNTER_STORE"] = "sqlite"
os.environ["JOBHUNTER_MULTIUSER"] = "1"
from jobhunter import ats, config, db, http, source_memory as memory


def job(key, title="IT Manager", description="Own the local IT shop"):
    return dict(ats_job_id=key, title=title, location="a regional federal hub, FL", remote=0,
                department=None, url="https://jobs.example/" + key, description=description)


class Reply:
    def __init__(self, body=None, status=200, headers=None):
        self.body, self.status_code, self.headers = body, status, headers or {}
        self.ok = status < 400

    def json(self):
        if self.status_code == 304:
            raise AssertionError("a 304 body must never be parsed")
        return self.body


class WorkdayBoard:
    """The jobs search as measured live on 2026-11-03: at most 2,000 jobs, `total` capped at 2000
    and reported only on the first page, facet counts exact for the search they came from."""

    def __init__(self, jobs, facets=(), nested=(), refuse_after=None, unlisted=()):
        self.jobs, self.facet_names, self.nested = jobs, facets, nested
        self.refuse_after, self.unlisted, self.requests = refuse_after, set(unlisted), 0

    def counts(self, found, name):
        values = Counter(value for job in found for value in job.get(name, []))
        return {'facetParameter': name, 'values': [{'id': value, 'count': count} for value, count in values.items()]}

    def post(self, _url, json=None):
        self.requests += 1
        if self.refuse_after is not None and self.requests > self.refuse_after:
            return Reply(status=403)
        found = [job for job in self.jobs
                 if all(set(values) & set(job.get(name, [])) for name, values in json['appliedFacets'].items())]
        listed = [job for job in found if job['path'] not in self.unlisted]
        offset, limit = json['offset'], json['limit']
        page = listed[:ats.WORKDAY_CAP][offset:offset + limit]
        body = {'total': 0, 'jobPostings': [{'title': 'IT Manager', 'externalPath': job['path']} for job in page]}
        if offset == 0:
            body['total'] = min(len(listed), ats.WORKDAY_CAP)
            body['facets'] = [self.counts(found, name) for name in self.facet_names]
            if self.nested:
                body['facets'].append({'facetParameter': 'locationMainGroup',
                                       'values': [self.counts(found, name) for name in self.nested]})
        return Reply(body)


def board_jobs(count, **fields):
    """`count` jobs; each field names a function from the job's number to its facet values."""
    return [{'path': f'/job/{n}', **{name: value(n) for name, value in fields.items()}} for n in range(count)]


class SourceMemory(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        config.CORPUS_DB = Path(self.temp.name) / "corpus.db"
        config.USER_DB = Path(self.temp.name) / "user.db"
        config.MULTIUSER, config.POSTGRES = True, False
        db._multiuser_inited.clear()
        config.PER_HOST_DELAY = 0
        with db.connect() as conn:
            conn.execute("INSERT INTO companies(id,name) VALUES(1,'Fixture Employer')")
            conn.execute("INSERT INTO companies(id,name) VALUES(2,'Other Employer')")

    def tearDown(self):
        self.temp.cleanup()

    def ingest(self, rows, company=1, complete=True):
        feed = rows if isinstance(rows, memory.Feed) else memory.Feed(rows, complete=complete)
        with db.connect() as conn:
            return memory.ingest(conn, company, feed)

    def state(self, company=1):
        with db.connect() as conn:
            return dict(conn.execute("SELECT * FROM corpus.source_pull_state WHERE company_id=?", (company,)).fetchone())

    def active(self, company=1):
        with db.connect() as conn:
            return [r[0] for r in conn.execute("SELECT ats_job_id FROM corpus.postings_corpus WHERE company_id=? AND active=1 ORDER BY ats_job_id", (company,))]

    def test_unchanged_bodies_do_not_write_and_changed_rows_are_counted(self):
        self.assertEqual(self.ingest([job('a'), job('b')])["new"], 2)
        with db.connect() as conn:
            conn.execute("CREATE TRIGGER corpus.no_body_rewrite BEFORE UPDATE OF description ON postings_corpus BEGIN SELECT RAISE(ABORT,'unchanged body rewritten'); END")
        self.assertEqual(self.ingest([job('a'), job('b')])["unchanged"], 2)
        with db.connect() as conn:
            conn.execute("DROP TRIGGER corpus.no_body_rewrite")
        out = self.ingest([job('a', 'IT Director'), job('c')])
        self.assertEqual((out['new'], out['changed'], out['closed']), (1, 1, 1))
        self.assertEqual(self.active(), ['a', 'c'])
        self.assertEqual(self.state()['status'], 'ok')

    def test_partial_empty_invalid_and_unverified_results_never_close_jobs(self):
        self.ingest([job('a'), job('b')])
        self.ingest([job('other')], company=2)
        for rows in (memory.Feed([job('a')], reason='pagination_incomplete'), memory.Feed([], complete=True),
                     memory.Feed([job('a'), {'ats_job_id': 'bad'}], complete=True),
                     memory.Feed([job('a'), job('a')], complete=True), [job('a')]):
            with db.connect() as conn:
                out = memory.ingest(conn, 1, rows)
            self.assertEqual(out['closed'], 0)
            self.assertEqual(self.active(), ['a', 'b'])
        self.assertEqual(self.active(2), ['other'])
        self.assertIsNotNone(self.state()['last_success_at'])
        self.assertEqual(self.state()['consecutive_failures'], 5)

    def test_list_only_change_preserves_previously_loaded_description(self):
        self.ingest([job('a')])
        self.ingest([job('a', 'Senior IT Manager', None)])
        with db.connect() as conn:
            self.assertEqual(conn.execute("SELECT description FROM corpus.postings_corpus").fetchone()[0], 'Own the local IT shop')

    def test_nullable_field_removal_is_a_change_then_becomes_unchanged(self):
        first = {**job('a'), 'department': 'IT'}
        self.ingest([first])
        self.assertEqual(self.ingest([{**first, 'department': None}])['changed'], 1)
        with db.connect() as conn:
            self.assertIsNone(conn.execute("SELECT department FROM corpus.postings_corpus").fetchone()[0])
        self.assertEqual(self.ingest([{**first, 'department': None}])['unchanged'], 1)

    def test_failure_and_empty_attempts_are_retained_without_error_bodies(self):
        self.ingest([job('a')])
        with patch.object(ats, 'fetch', side_effect=RuntimeError('secret employer URL')):
            with self.assertRaises(RuntimeError):
                memory.fetch(1, 'greenhouse', 'fixture')
        self.assertEqual(self.state()['status'], 'failed')
        self.assertEqual(self.state()['last_error_code'], 'fetch_failed')
        self.assertNotIn('secret', json.dumps(self.state()))
        with patch.object(ats, 'fetch', return_value=memory.Feed([])):
            rows = memory.fetch(1, 'greenhouse', 'fixture')
        self.assertEqual(self.state()['consecutive_failures'], 2)
        self.ingest(rows)
        self.assertEqual(self.state()['consecutive_failures'], 2, 'one failed source attempt is counted once')
        self.assertEqual(self.active(), ['a'])

    def test_validator_304_and_changed_url(self):
        listing = {'jobs': [{'id': 'a', 'title': 'IT Manager', 'location': {'name': 'a regional federal hub, FL'},
                             'absolute_url': 'https://jobs.example/a', 'content': 'Local IT'}]}
        calls = []
        def reply(method, url, **kwargs):
            calls.append((url, kwargs.get('headers', {})))
            return Reply(status=304) if kwargs.get('headers', {}).get('If-None-Match') else Reply(listing, headers={'ETag': '"version-1"'})
        with patch.object(http._session, 'request', side_effect=reply):
            first = memory.fetch(1, 'greenhouse', 'fixture')
            self.ingest(first)
            with patch.object(ats, 'fetch', side_effect=RuntimeError('temporary outage')):
                with self.assertRaises(RuntimeError):
                    memory.fetch(1, 'greenhouse', 'fixture')
            self.assertEqual(self.state()['consecutive_failures'], 1)
            previous_success = self.state()['last_success_at']
            second = memory.fetch(1, 'greenhouse', 'fixture')
            self.assertTrue(second.not_modified)
            self.assertEqual(self.ingest(second)['unchanged'], 1)
            self.assertEqual(self.state()['status'], 'not_modified')
            self.assertEqual(self.state()['consecutive_failures'], 0)
            self.assertGreater(self.state()['last_success_at'], previous_success)
            third = memory.fetch(1, 'greenhouse', 'changed-board')
            self.assertNotIn('If-None-Match', calls[-1][1])
            self.ingest(third)
        self.assertEqual(self.active(), ['a'])
        self.assertEqual(len(calls), 3)

    def test_no_validator_means_full_fetch_not_a_fake_delta(self):
        listing = {'jobs': [{'id': 'a', 'title': 'IT Manager', 'location': {'name': 'a regional federal hub, FL'}}]}
        with patch.object(http._session, 'request', return_value=Reply(listing)) as request:
            self.ingest(memory.fetch(1, 'greenhouse', 'fixture'))
            self.ingest(memory.fetch(1, 'greenhouse', 'fixture'))
            self.assertEqual(request.call_count, 2)
            self.assertNotIn('headers', request.call_args.kwargs)

    def test_changed_source_cannot_reuse_success_hashes_or_validators(self):
        listing = {'jobs': [{'id': 'a', 'title': 'IT Manager', 'location': {'name': 'a regional federal hub, FL'}}]}
        with patch.object(http._session, 'request', return_value=Reply(listing, headers={'ETag': '"old-source"'})):
            self.ingest(memory.fetch(1, 'greenhouse', 'original'))
        self.assertIsNotNone(self.state()['last_success_at'])
        with patch.object(ats, 'fetch', return_value=memory.Feed([job('a')], reason='pagination_incomplete')):
            pending = memory.fetch(1, 'workday', 'other:wd5:Careers')
        state = self.state()
        self.assertIsNone(state['last_success_at'])
        self.assertEqual(state['consecutive_failures'], 1)
        with db.connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM corpus.source_posting_hashes WHERE company_id=1").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM corpus.source_http_validators WHERE company_id=1").fetchone()[0], 0)
        self.assertEqual(self.active(), ['a'], 'changing a source never removes retained postings before enumeration')
        self.ingest(pending)
        self.assertIsNone(self.state()['last_success_at'])

    def test_workday_partial_pagination_never_claims_complete(self):
        pages = [Reply({'total': 2, 'jobPostings': [{'title': 'IT Manager', 'externalPath': '/job/a'}]}), Reply(status=403)]
        with patch.object(http, 'post', side_effect=pages):
            rows = ats.fetch('workday', 'fixture:wd5:Careers')
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows.complete)
        self.ingest([job('old')])
        self.assertEqual(self.ingest(rows)['closed'], 0)
        self.assertIn('old', self.active())

    def walk(self, board):
        with patch.object(http, 'post', side_effect=board.post):
            return ats.fetch('workday', 'fixture:wd5:Careers')

    def test_workday_reads_past_the_cap_reopens_wrongly_closed_jobs_and_closes_only_what_is_gone(self):
        self.ingest([job('gone'), job('/job/7')])
        self.ingest([job('gone')])  # The cap had closed /job/7 while the employer still listed it.
        self.assertNotIn('/job/7', self.active())
        board = WorkdayBoard(board_jobs(2600, family=lambda n: [f'f{n % 3}'], time=lambda n: ['part' if n % 50 == 0 else 'full']),
                             facets=['family', 'time'])
        feed = self.walk(board)
        self.assertEqual(len(feed), 2600)
        self.assertTrue(feed.complete, feed.reason)
        self.assertEqual(self.ingest(feed)['closed'], 1)
        active = self.active()
        self.assertEqual(len(active), 2600)
        self.assertIn('/job/7', active)
        self.assertNotIn('gone', active)

    def test_workday_splits_again_when_one_facet_value_is_over_the_cap(self):
        # Accenture's shape: one country and one job family each hold far more than the cap.
        board = WorkdayBoard(board_jobs(5000, family=lambda n: ['big' if n % 5 else 'small'], time=lambda n: ['full']),
                             facets=['family', 'time'], nested=['country'])
        for row in board.jobs:
            row['country'] = ['US' if int(row['path'].split('/')[-1]) % 2 else 'IN']
        feed = self.walk(board)
        self.assertEqual(len(feed), 5000)
        self.assertTrue(feed.complete, feed.reason)

    def test_workday_job_with_two_facet_values_counts_once(self):
        board = WorkdayBoard(board_jobs(2500, family=lambda n: ['a'], time=lambda n: ['full'],
                                        country=lambda n: ['US', 'CA'] if n % 100 == 0 else ['US' if n % 2 else 'CA']),
                             facets=['family', 'time', 'country'])
        feed = self.walk(board)
        self.assertEqual(len(feed), 2500)
        self.assertTrue(feed.complete, feed.reason)
        self.assertEqual(self.ingest(feed)['skipped'], 0)
        self.assertEqual(self.state()['status'], 'ok')

    def test_workday_splits_on_the_facet_that_agrees_with_the_size_not_the_widest(self):
        # Jabil's shape, measured live: state/province totals more than the board, because some jobs
        # list several states, yet misses every job with no state at all.
        def region(n):
            return [] if n % 25 == 0 else ['A', 'B'] if n % 20 == 1 else [f'r{n % 7}']
        board = WorkdayBoard(board_jobs(2300, family=lambda n: [f'f{n % 9}'], time=lambda n: ['full' if n % 40 else 'part'], region=region),
                             facets=['region', 'family', 'time'])
        self.assertGreater(sum(len(region(n)) for n in range(2300)), 2300, 'the region facet must look the widest')
        feed = self.walk(board)
        self.assertEqual(len(feed), 2300)
        self.assertTrue(feed.complete, feed.reason)

    def test_workday_board_at_the_cap_with_nothing_to_split_on_closes_nothing(self):
        self.ingest([job('old')])
        feed = self.walk(WorkdayBoard(board_jobs(2600)))
        self.assertEqual(len(feed), ats.WORKDAY_CAP)
        self.assertFalse(feed.complete)
        self.assertEqual(self.ingest(feed)['closed'], 0)
        self.assertIn('old', self.active())
        self.assertEqual(self.state()['last_error_code'], 'page_limit_reached')

    def test_workday_refused_page_during_a_walk_keeps_rows_and_closes_nothing(self):
        self.ingest([job('old')])
        board = WorkdayBoard(board_jobs(2600, family=lambda n: [f'f{n % 3}'], time=lambda n: ['full']),
                             facets=['family', 'time'], refuse_after=30)
        feed = self.walk(board)
        self.assertTrue(0 < len(feed) < 2600)
        self.assertFalse(feed.complete)
        self.assertEqual(feed.reason, 'http_refused')
        self.assertEqual(board.requests, 31, 'a refusal stops the walk instead of hammering the employer')
        self.assertEqual(self.ingest(feed)['closed'], 0)
        self.assertIn('old', self.active())

    def test_workday_network_failure_after_the_first_page_keeps_rows_and_before_it_stays_a_failure(self):
        first = Reply({'total': 40, 'jobPostings': [{'title': 'IT Manager', 'externalPath': '/job/a'}]})
        with patch.object(http, 'post', side_effect=[first, http.TransientHTTP('503')]):
            feed = ats.fetch('workday', 'fixture:wd5:Careers')
        self.assertEqual(len(feed), 1)
        self.assertEqual(feed.reason, 'http_refused')
        with patch.object(http, 'post', side_effect=http.TransientHTTP('503')), self.assertRaises(http.TransientHTTP):
            ats.fetch('workday', 'fixture:wd5:Careers')

    def test_workday_walk_short_of_the_facet_counts_closes_nothing(self):
        self.ingest([job('old')])
        jobs = board_jobs(2600, family=lambda n: [f'f{n % 3}'], time=lambda n: ['full'])
        feed = self.walk(WorkdayBoard(jobs, facets=['family', 'time'], unlisted=[row['path'] for row in jobs[:100]]))
        self.assertEqual(len(feed), 2500)
        self.assertFalse(feed.complete)
        self.assertEqual(self.ingest(feed)['closed'], 0)
        self.assertIn('old', self.active())

    def test_workday_walk_stops_at_its_request_budget_and_closes_nothing(self):
        board = WorkdayBoard(board_jobs(2600, family=lambda n: [f'f{n % 3}'], time=lambda n: ['full']), facets=['family', 'time'])
        with patch.object(ats, 'WORKDAY_MAX_REQUESTS', 5):
            feed = self.walk(board)
        self.assertEqual(board.requests, 5)
        self.assertFalse(feed.complete)
        self.assertEqual(feed.reason, 'page_limit_reached')

    def test_workday_repeat_inside_one_search_still_means_the_list_moved(self):
        pages = [Reply({'total': 3, 'jobPostings': [{'title': 'A', 'externalPath': '/job/a'}, {'title': 'B', 'externalPath': '/job/b'}]}),
                 Reply({'total': 0, 'jobPostings': [{'title': 'B', 'externalPath': '/job/b'}, {'title': 'C', 'externalPath': '/job/c'}]})]
        with patch.object(http, 'post', side_effect=pages):
            feed = ats.fetch('workday', 'fixture:wd5:Careers')
        self.assertEqual(len(feed), 3)
        self.assertFalse(feed.complete)
        self.assertEqual(feed.reason, 'invalid_feed_rows')

    def test_workday_board_under_the_cap_is_one_plain_search(self):
        board = WorkdayBoard(board_jobs(45, family=lambda n: ['a']), facets=['family'])
        feed = self.walk(board)
        self.assertEqual(len(feed), 45)
        self.assertTrue(feed.complete, feed.reason)
        self.assertEqual(board.requests, 3)

    def test_receipt_retention_is_bounded_per_employer(self):
        for _ in range(25):
            self.ingest([job('a')])
        self.ingest([job('other')], company=2)
        with db.connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM corpus.source_pull_runs WHERE company_id=1").fetchone()[0], 20)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM corpus.source_pull_runs WHERE company_id=2").fetchone()[0], 1)

    def test_resolve_and_add_target_report_retained_jobs_on_304(self):
        from jobhunter import cli
        self.ingest([job('a')])
        def not_modified(*args):
            feed = memory.Feed(complete=True, reason=None)
            feed.not_modified = True
            return feed
        with patch.object(cli.resolve, 'classify_url_deep', return_value=('greenhouse', 'fixture')):
            with patch.object(memory, 'fetch', side_effect=not_modified):
                output = StringIO()
                with redirect_stdout(output):
                    cli.cmd_seturl(SimpleNamespace(company_id=1, url='https://boards.greenhouse.io/fixture'))
                self.assertEqual(json.loads(output.getvalue())['jobs'], 1)
        with patch.object(cli.resolve, 'classify_url', return_value=('greenhouse', 'fixture')):
            with patch.object(cli, '_register_target', return_value=(1, 'Fixture Employer')):
                with patch.object(memory, 'fetch', side_effect=not_modified):
                    output = StringIO()
                    with redirect_stdout(output):
                        cli.cmd_add_target(SimpleNamespace(url='https://boards.greenhouse.io/fixture', source='fixture', name=None))
                    self.assertEqual(json.loads(output.getvalue())['postings'], 1)

    def test_every_persistence_entry_uses_the_shared_completeness_guard(self):
        for name in ('cli.py', 'runner.py', 'resolve.py', 'dashboard.py'):
            tree = ast.parse((ROOT / 'engine/jobhunter' / name).read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                    self.assertNotEqual(node.func.attr, 'deactivate_missing', name)


if __name__ == '__main__':
    unittest.main()
