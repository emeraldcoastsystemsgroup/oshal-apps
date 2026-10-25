"""CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Exercise source health, unchanged-body protection, conditional HTTP and complete-feed closure against real temporary SQLite.
"""
import ast
import json
import os
import sys
import tempfile
import unittest
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
