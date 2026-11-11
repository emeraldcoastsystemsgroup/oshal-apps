# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Hold the Jibe reader to the listing a Jibe career site sends: asked on the employer's own careers host, read page by page to the count it states, each job in its city and state, and linked on that host. A whole listing closes a job that left it; one cut short, refused part way, or empty closes nothing. The link resolver finds such a host by asking it for the listing. Read through the engine's own HTTP layer and one-source pull into real SQLite. No network.
"""The Jibe reader and its host detection against a listing in the live shape, through the pull's one-source path and a real store."""
import atexit
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
STORE = tempfile.TemporaryDirectory(prefix='career-jibe-feed-')
atexit.register(STORE.cleanup)  # Registered before the engine loads, so it runs after the engine's own exit handler.
sys.path.insert(0, str(ROOT / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
os.environ['JOBHUNTER_DATA'] = STORE.name
for name in ('JOBHUNTER_DB', 'JOBHUNTER_CORPUS_DB', 'JOBHUNTER_USER_DB', 'DATABASE_URL'):
    os.environ.pop(name, None)
import requests
from jobhunter import ats, cli, db, resolve

HOST = 'careers.fixture.example'
LISTING = f'https://{HOST}/api/jobs'


def job(slug, title, site, city, state, country='United States', kind='LAT_LNG'):
    """One job with the fields a Jibe listing carries, wrapped in `data` as the listing wraps it."""
    return {'data': {'slug': slug, 'req_id': slug, 'title': title, 'location_name': site, 'city': city, 'state': state,
                     'country': country, 'location_type': kind, 'department': '', 'description': f'<p>{title}.</p>',
                     'full_location': ', '.join(part for part in (city, state) if part), 'posted_date': '2026-11-02T10:00:00+0000',
                     'create_date': '2026-11-01T10:00:00+0000', 'apply_url': f'https://fixture.icims.com/jobs/{slug}/login'}}


LIVE_SHAPE = [
    job('1001', 'Cashier', 'EAST ORLANDO - FL - 00000185', 'WINTER PARK', 'Florida'),
    job('1002', 'Store Manager', 'Fixture Store #899', 'Greensboro', 'North Carolina'),
    job('1003', 'Auditor', 'Washington, DC', 'Washington', 'Washington, DC'),
    job('1004', 'Help Desk Analyst', 'REMT - Remote - US', None, None, kind='ANY'),
    job('1005', 'UX Writer', 'Amsterdam Campus', 'Amsterdam', 'North Holland', 'Netherlands'),
]
EXPECTED = {
    '1001': ('Winter Park, Florida, United States', 0, 'FL'),
    '1002': ('Greensboro, North Carolina, United States', 0, 'NC'),
    '1003': ('Washington, Washington, DC, United States', 0, 'DC'),
    '1004': ('REMT - Remote - US', 1, None),
    '1005': ('Amsterdam, North Holland, Netherlands', 0, None),
}


@contextlib.contextmanager
def site_answers(jobs, *, total=None, refuse_page=None, hosts=(HOST,), other=None):
    """Answer the engine's HTTP session as a Jibe career site does, a page at a time, and record what it asked for.

    `total` is the count the listing states (the number of jobs unless given). `refuse_page` answers that page with
    HTTP 503. A request for anything else on any host gets `other`, or HTTP 404. Nothing leaves the machine."""
    asked = []

    def answer(_session, method, url, **kwargs):
        parts = urlsplit(url)
        params = dict(kwargs.get('params') or {})
        asked.append((method.upper(), parts.netloc, parts.path, params))
        response = requests.Response()
        response.url = url
        if parts.netloc in hosts and parts.path == '/api/jobs' and method.upper() == 'GET':
            page, limit = int(params.get('page', 1)), int(params.get('limit', 10))
            if page == refuse_page:
                response.status_code, response._content = 503, b'busy'
                return response
            response.status_code = 200
            response.headers['Content-Type'] = 'application/json'
            response._content = json.dumps({'jobs': jobs[(page - 1) * limit:page * limit],
                                            'totalCount': len(jobs) if total is None else total, 'count': limit}).encode()
            return response
        status, kind, body = other or (404, 'text/html', '<html><title>404 - Page Not Found</title></html>')
        response.status_code = status
        response.headers['Content-Type'] = kind
        response._content = body.encode()
        return response

    with patch.object(requests.sessions.Session, 'request', answer), patch('time.sleep', lambda _seconds: None):
        yield asked


def listing_pages(asked):
    return [(host, params.get('page'), params.get('limit')) for _method, host, path, params in asked if path == '/api/jobs']


class JibeFeed(unittest.TestCase):
    def setUp(self):
        with db.connect() as conn:
            for table in (db.corpus_table(), db.companies_table()):
                conn.execute(f'DELETE FROM {table}')
            self.company = db.upsert_company(conn, 'Fixture Employer', ats_type='jibe', ats_token=HOST,
                                             discover_status='found', source_list='curated')

    def pull(self, jobs, **site):
        """The nightly pull's own read of one employer. Returns what it added and what it asked the site for."""
        with db.connect() as conn:
            row = dict(cli._companies(conn, company='Fixture Employer', need_ats=True)[0])
        with site_answers(jobs, **site) as asked, contextlib.redirect_stdout(io.StringIO()):
            added = cli._scrape_source(row, None)
        return added, asked

    def stored(self):
        with db.connect() as conn:
            rows = conn.execute(f"""SELECT ats_job_id,location,remote,state,url,active FROM {db.corpus_table()}
                WHERE company_id=? ORDER BY ats_job_id""", (self.company,)).fetchall()
        return {row['ats_job_id']: dict(row) for row in rows}

    def state(self):
        with db.connect() as conn:
            row = conn.execute("""SELECT status,last_error_code,fetched,closed_count FROM corpus.source_pull_state
                WHERE company_id=?""", (self.company,)).fetchone()
        return tuple(row)

    def test_the_reader_asks_the_employers_own_host_and_places_each_job_by_city_and_state(self):
        with site_answers(LIVE_SHAPE) as asked:
            rows = ats.Jibe.fetch(HOST)
        self.assertEqual(listing_pages(asked), [(HOST, 1, 100)])
        self.assertEqual({row['ats_job_id']: (row['location'], row['remote']) for row in rows},
                         {slug: place[:2] for slug, place in EXPECTED.items()})
        for row in rows:
            self.assertEqual(row['url'], f"https://{HOST}/jobs/{row['ats_job_id']}")
            self.assertEqual(row['posted_at'], '2026-11-02T10:00:00+0000')
        self.assertTrue(rows.complete)
        self.assertIsNone(rows.reason)

    def test_a_client_code_token_still_reads_jibes_own_host_and_keeps_its_links(self):
        own = 'fixtureco.jibeapply.com'
        with site_answers(LIVE_SHAPE, hosts=(own,)) as asked:
            plain = ats.Jibe.fetch('fixtureco')
            branded = ats.Jibe.fetch('fixtureco|careers.fixtureco.example')
        self.assertEqual(listing_pages(asked), [(own, 1, 100), (own, 1, 100)])
        self.assertEqual(plain[0]['url'], 'https://fixtureco.jibeapply.com/jobs/1001')
        self.assertEqual(branded[0]['url'], 'https://careers.fixtureco.example/careers-home/jobs/1001')

    def test_a_long_listing_is_read_page_by_page_to_the_count_it_states(self):
        many = [job(str(2000 + n), f'Clerk {n}', f'Store {n}', 'Austin', 'Texas') for n in range(230)]
        with site_answers(many) as asked:
            rows = ats.Jibe.fetch(HOST)
        self.assertEqual(listing_pages(asked), [(HOST, 1, 100), (HOST, 2, 100), (HOST, 3, 100)])
        self.assertEqual((len(rows), rows.complete), (230, True))

    def test_a_whole_listing_closes_the_job_that_left_it_and_files_the_rest_under_their_states(self):
        added, _asked = self.pull(LIVE_SHAPE)
        self.assertEqual((added['new'], added['confirmed'], added['unconfirmed']), (5, 1, 0))
        self.assertEqual(self.state()[:3], ('ok', None, 5))
        stored = self.stored()
        self.assertEqual({slug: (row['location'], row['remote'], row['state']) for slug, row in stored.items()}, EXPECTED)
        added, _asked = self.pull(LIVE_SHAPE[:4])
        self.assertEqual((added['closed'], added['confirmed']), (1, 1))
        self.assertEqual({slug: row['active'] for slug, row in self.stored().items()},
                         {'1001': 1, '1002': 1, '1003': 1, '1004': 1, '1005': 0})

    def test_a_listing_refused_part_way_keeps_every_stored_job_open(self):
        many = [job(str(3000 + n), f'Clerk {n}', f'Store {n}', 'Austin', 'Texas') for n in range(150)]
        self.pull(many)
        added, asked = self.pull(many, refuse_page=2)
        self.assertEqual(listing_pages(asked), [(HOST, 1, 100), (HOST, 2, 100)])
        self.assertEqual((added['closed'], added['confirmed'], added['unconfirmed']), (0, 0, 1))
        self.assertEqual(self.state(), ('partial', 'http_refused', 100, 0))
        self.assertEqual(sum(row['active'] for row in self.stored().values()), 150)

    def test_a_listing_that_sends_fewer_jobs_than_it_states_closes_nothing(self):
        self.pull(LIVE_SHAPE)
        added, _asked = self.pull(LIVE_SHAPE[:3], total=40)
        self.assertEqual((added['closed'], added['unconfirmed']), (0, 1))
        self.assertEqual(self.state(), ('partial', 'completion_unverified', 3, 0))
        self.assertEqual(sum(row['active'] for row in self.stored().values()), 5)

    def test_an_empty_listing_closes_nothing(self):
        self.pull(LIVE_SHAPE)
        added, _asked = self.pull([])
        self.assertEqual(added, {'unconfirmed': 1})
        self.assertEqual(self.state()[:2], ('empty_unconfirmed', 'empty_unconfirmed'))
        self.assertEqual(sum(row['active'] for row in self.stored().values()), 5)

    def test_a_pasted_link_on_a_jibe_host_is_found_by_asking_the_host_for_its_listing(self):
        with site_answers(LIVE_SHAPE) as asked:
            hit = resolve.classify_url_deep(f'https://{HOST}/careers-home/jobs?page=1')
        self.assertEqual(hit, ('jibe', HOST))
        self.assertIn((HOST, 1, 1), listing_pages(asked))

    def test_a_host_that_does_not_answer_the_listing_is_not_called_a_jibe_site(self):
        not_found = (404, 'text/html', '<html><title>404 - Page Not Found</title></html>')
        no_slug = (200, 'application/json', json.dumps({'totalCount': 12, 'jobs': [{'title': 'Clerk'}]}))
        no_count = (200, 'application/json', json.dumps({'jobs': [{'data': {'slug': '1', 'title': 'Clerk'}}]}))
        nothing_open = (200, 'application/json', json.dumps({'totalCount': 0, 'jobs': []}))
        for other in (not_found, no_slug, no_count, nothing_open):
            with site_answers([], hosts=(), other=other):
                self.assertFalse(resolve._try_jibe('www.fixture.example'), other[2][:60])
        with site_answers([], hosts=()):
            self.assertIsNone(resolve.classify_url_deep('https://www.fixture.example/careers/job-listings'))


if __name__ == '__main__':
    unittest.main()
