# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Hold two readers to the search services their boards' pages call. A newer SuccessFactors career site lists no job in its page; the reader then asks the site's own search service, ten a page, to the total it states, and a classic site's page is read as before. A Dayforce board answers its search only with the anti-forgery token its page asks for first; the reader asks for it, reads to the count the board states and places each job by city, state and country. A whole listing closes a job that left it; one refused part way or cut short closes nothing. Read through the engine's own HTTP layer and one-source pull into real SQLite. No network.
"""The SuccessFactors search-service fallback and the Dayforce reader against answers in the live shape, through the pull's one-source path."""
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
STORE = tempfile.TemporaryDirectory(prefix='career-search-service-')
atexit.register(STORE.cleanup)  # Registered before the engine loads, so it runs after the engine's own exit handler.
sys.path.insert(0, str(ROOT / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
os.environ['JOBHUNTER_DATA'] = STORE.name
for name in ('JOBHUNTER_DB', 'JOBHUNTER_CORPUS_DB', 'JOBHUNTER_USER_DB', 'DATABASE_URL'):
    os.environ.pop(name, None)
import requests
from jobhunter import ats, cli, db, resolve

SF_HOST = 'careers.fixture.example'
DF_HOST = 'jobs.dayforcehcm.com'
CSRF = 'f' * 64


def sf_job(n, place='Clarksville, TN-37041, United States    ', model='On-Site'):
    return {'response': {'id': str(2700 + n), 'unifiedStandardTitle': f'Electrician {n} - Clarksville, TN',
                         'unifiedUrlTitle': f'Electrician-{n}-Clarksville%2C-TN', 'jobLocationShort': [place] if place else [],
                         'cust_workModel': [model], 'unifiedStandardStart': '5/12/26', 'supportedLocales': ['en_US']}}


def df_job(n, places=(('Atlanta', 'GA'),), virtual=False):
    return {'clientNamespace': 'fixture', 'jobBoardId': 1, 'jobPostingId': 3400 + n, 'jobReqId': 600 + n,
            'jobTitle': f'Property Manager {n}', 'jobDescription': f'<p>Manage property {n}.</p>', 'hasVirtualLocation': virtual,
            'postingStartTimestampUTC': '2026-11-05T05:00:00+00:00',
            'postingLocations': [{'formattedAddress': f'1 Main St, {c}, {s} 30327, USA', 'isoCountryCode': 'US', 'stateCode': s,
                                  'cityName': c} for c, s in places]}


@contextlib.contextmanager
def sites(*, sf_page='<html><div>No jobs found</div></html>', sf_jobs=(), sf_total=None, sf_status=200, sf_refuse_page=None, sf_unstable=False,
          df_jobs=(), df_total=None, df_csrf=True, df_page_size=10, df_refuse_offset=None):
    """Answer the engine's HTTP session as the two sites do, and record each request. Nothing leaves the machine."""
    asked = []
    served = {}

    def answer(_session, method, url, **kwargs):
        parts = urlsplit(url)
        body = kwargs.get('json') or {}
        headers = kwargs.get('headers') or {}
        asked.append((method.upper(), parts.netloc, parts.path, body, dict(headers)))
        response = requests.Response()
        response.url = url

        def send(status, value, kind='application/json'):
            response.status_code = status
            response.headers['Content-Type'] = kind
            response._content = (json.dumps(value) if kind == 'application/json' else value).encode()
            return response
        if parts.netloc == SF_HOST and parts.path == '/search/':
            return send(200, sf_page, 'text/html')
        if parts.netloc == SF_HOST and parts.path == '/services/recruiting/v1/jobs' and method.upper() == 'POST':
            page = body.get('pageNumber', 0)
            if sf_status != 200 or page == sf_refuse_page:
                return send(sf_status if sf_status != 200 else 503, {'error': {'message': 'Error retrieving jobs'}, 'totalJobs': 0})
            served[page] = served.get(page, 0) + 1
            # An unstable site repeats the first page in place of the others on the first pass.
            first = sf_unstable and served[page] == 1 and page > 0
            rows = list(sf_jobs)[:10] if first else list(sf_jobs)[page * 10:(page + 1) * 10]
            return send(200, {'jobSearchResult': rows, 'totalJobs': len(sf_jobs) if sf_total is None else sf_total})
        if parts.netloc == DF_HOST and parts.path == '/api/auth/csrf':
            return send(200, {'csrfToken': CSRF} if df_csrf else {})
        if parts.netloc == DF_HOST and parts.path == '/api/geo/fixture/jobposting/search' and method.upper() == 'POST':
            if headers.get('x-csrf-token') != CSRF:
                return send(403, 'Forbidden', 'text/plain')
            start = body.get('paginationStart', 0)
            if start == df_refuse_offset:
                return send(503, 'busy', 'text/plain')
            rows = list(df_jobs)[start:start + df_page_size]
            return send(200, {'jobPostings': rows, 'maxCount': len(df_jobs) if df_total is None else df_total,
                              'offset': start, 'count': len(rows)})
        return send(404, '<html>Not found</html>', 'text/html')

    with patch.object(requests.sessions.Session, 'request', answer), patch('time.sleep', lambda _seconds: None):
        yield asked


def searches(asked, path):
    return [entry for entry in asked if entry[2] == path]


class SuccessFactorsSearch(unittest.TestCase):
    def test_a_page_that_lists_its_jobs_is_read_as_before_and_the_search_service_is_not_asked(self):
        page = '<a class="jobTitle-link" href="/job/Clarksville-Electrician-TN-37041/1387312900/">Electrician</a>'
        with sites(sf_page=page) as asked:
            rows = ats.SuccessFactors.fetch(SF_HOST)
        self.assertEqual([row['ats_job_id'] for row in rows], ['/job/Clarksville-Electrician-TN-37041/1387312900/'])
        self.assertEqual(searches(asked, '/services/recruiting/v1/jobs'), [], 'stored ids of a classic site do not change')

    def test_a_page_with_no_jobs_in_it_is_read_from_the_sites_search_to_the_total_it_states(self):
        jobs = [sf_job(n) for n in range(23)] + [sf_job(99, place=None, model='Remote')]
        with sites(sf_jobs=jobs) as asked:
            rows = ats.SuccessFactors.fetch(SF_HOST)
        self.assertEqual([entry[3]['pageNumber'] for entry in searches(asked, '/services/recruiting/v1/jobs')], [0, 1, 2])
        self.assertEqual((len(rows), rows.complete, rows.reason), (24, True, None))
        first = rows[0]
        self.assertEqual((first['ats_job_id'], first['location'], first['remote'], first['posted_at']),
                         ('2700', 'Clarksville, TN, United States', False, '2026-05-12'))
        self.assertEqual(first['url'], f'https://{SF_HOST}/job/Electrician-0-Clarksville%2C-TN/2700-en_US/')
        self.assertEqual((rows[-1]['location'], rows[-1]['remote']), (None, True))

    def test_a_place_loses_its_postal_code_and_markup_in_each_shape_the_sites_send(self):
        shapes = {'Ada, MI, USA, 49355<br/>': 'Ada, MI, USA', 'Oslo, NOR, 0283': 'Oslo, NOR',
                  'São Leopoldo, BR, 93022-718': 'São Leopoldo, BR', 'Clarksville, TN-37041, United States    ': 'Clarksville, TN, United States',
                  'Richmond, VA, US<br/>Remote, US': 'Richmond, VA, US; Remote, US'}
        for sent, place in shapes.items():
            self.assertEqual(ats.SuccessFactors._place({'jobLocationShort': [sent]}), place, sent)

    def test_pages_that_repeat_jobs_are_read_again_until_every_stated_job_is_seen(self):
        jobs = [sf_job(n) for n in range(25)]
        with sites(sf_jobs=jobs, sf_unstable=True) as asked:
            rows = ats.SuccessFactors.fetch(SF_HOST)
        self.assertEqual([entry[3]['pageNumber'] for entry in searches(asked, '/services/recruiting/v1/jobs')], [0, 1, 2, 0, 1, 2])
        self.assertEqual((len(rows), len({row['ats_job_id'] for row in rows}), rows.complete), (25, 25, True))

    def test_a_search_refused_part_way_or_short_of_its_total_is_not_whole(self):
        jobs = [sf_job(n) for n in range(25)]
        with sites(sf_jobs=jobs, sf_refuse_page=1):
            refused = ats.SuccessFactors.fetch(SF_HOST)
        self.assertEqual((len(refused), refused.complete, refused.reason), (10, False, 'http_refused'))
        with sites(sf_jobs=jobs[:5], sf_total=40):
            short = ats.SuccessFactors.fetch(SF_HOST)
        self.assertEqual((len(short), short.complete, short.reason), (5, False, 'completion_unverified'))

    def test_a_site_that_answers_neither_reads_nothing(self):
        with sites(sf_status=401):
            self.assertEqual(list(ats.SuccessFactors.fetch(SF_HOST)), [])


class DayforceBoard(unittest.TestCase):
    def test_the_board_is_read_with_the_token_its_page_asks_for_to_the_count_it_states(self):
        jobs = [df_job(n) for n in range(23)] + [df_job(50, places=(('Atlanta', 'GA'), ('Jacksonville', 'FL'))), df_job(60, places=(), virtual=True)]
        with sites(df_jobs=jobs) as asked:
            rows = ats.Dayforce.fetch('fixture|CANDIDATEPORTAL|en-US')
        posts = searches(asked, '/api/geo/fixture/jobposting/search')
        self.assertEqual([entry[3]['paginationStart'] for entry in posts], [0, 10, 20])
        self.assertTrue(all(entry[4]['x-csrf-token'] == CSRF for entry in posts))
        self.assertEqual(posts[0][3]['jobBoardCode'], 'CANDIDATEPORTAL')
        self.assertEqual((len(rows), rows.complete, rows.reason), (25, True, None))
        by_id = {row['ats_job_id']: row for row in rows}
        self.assertEqual(by_id['3400']['location'], 'Atlanta, GA, US')
        self.assertEqual(by_id['3400']['url'], f'https://{DF_HOST}/en-US/fixture/CANDIDATEPORTAL/jobs/3400')
        self.assertEqual(by_id['3400']['description'], 'Manage property 0.')
        self.assertEqual(by_id['3450']['location'], 'Atlanta, GA, US; Jacksonville, FL, US')
        self.assertEqual((by_id['3460']['location'], by_id['3460']['remote']), ('Remote', True))

    def test_without_a_token_or_with_a_refused_page_nothing_is_whole(self):
        with sites(df_jobs=[df_job(1)], df_csrf=False) as asked:
            none = ats.Dayforce.fetch('fixture|CANDIDATEPORTAL|en-US')
        self.assertEqual((list(none), none.reason), ([], 'http_refused'))
        self.assertEqual(searches(asked, '/api/geo/fixture/jobposting/search'), [])
        with sites(df_jobs=[df_job(n) for n in range(15)], df_refuse_offset=10):
            cut = ats.Dayforce.fetch('fixture|CANDIDATEPORTAL|en-US')
        self.assertEqual((len(cut), cut.complete, cut.reason), (10, False, 'http_refused'))
        with sites(df_jobs=[df_job(n) for n in range(3)], df_total=30):
            short = ats.Dayforce.fetch('fixture|CANDIDATEPORTAL|en-US')
        self.assertEqual((len(short), short.complete), (3, False))

    def test_a_board_link_names_the_dayforce_reader(self):
        cases = {'https://jobs.dayforcehcm.com/en-US/regency/CANDIDATEPORTAL': 'regency|CANDIDATEPORTAL|en-US',
                 'https://jobs.dayforcehcm.com/asrcfh/CANDIDATEPORTAL': 'asrcfh|CANDIDATEPORTAL|en-US',
                 'https://jobs.dayforcehcm.com/en-us/mirion/CANDIDATEPORTAL/jobs/12': 'mirion|CANDIDATEPORTAL|en-US'}
        for link, token in cases.items():
            self.assertEqual(resolve.classify_url(link), ('dayforce', token), link)
        self.assertIn('dayforce', resolve.PATTERN_ATS)
        self.assertIsNone(resolve.classify_url('https://jobs.dayforcehcm.com/api/geo/x/jobposting/search'))


class ThroughThePull(unittest.TestCase):
    def setUp(self):
        with db.connect() as conn:
            for table in (db.corpus_table(), db.companies_table()):
                conn.execute(f'DELETE FROM {table}')
            self.sf = db.upsert_company(conn, 'Fixture Search Co', ats_type='successfactors', ats_token=SF_HOST,
                                        discover_status='found', source_list='curated')
            self.df = db.upsert_company(conn, 'Fixture Board Co', ats_type='dayforce', ats_token='fixture|CANDIDATEPORTAL|en-US',
                                        discover_status='found', source_list='curated')

    def pull(self, name, **site):
        with db.connect() as conn:
            row = dict(cli._companies(conn, company=name, need_ats=True)[0])
        with sites(**site), contextlib.redirect_stdout(io.StringIO()):
            return cli._scrape_source(row, None)

    def active(self, company):
        with db.connect() as conn:
            return {row['ats_job_id']: row['state'] for row in conn.execute(
                f'SELECT ats_job_id,state FROM {db.corpus_table()} WHERE company_id=? AND active=1', (company,)).fetchall()}

    def test_a_whole_listing_closes_the_job_that_left_it_and_a_short_one_closes_nothing(self):
        jobs = [sf_job(n) for n in range(12)]
        self.assertEqual(self.pull('Fixture Search Co', sf_jobs=jobs)['new'], 12)
        self.assertEqual(self.pull('Fixture Search Co', sf_jobs=jobs[:11])['closed'], 1)
        self.assertEqual(self.pull('Fixture Search Co', sf_jobs=jobs[:5], sf_total=40).get('closed', 0), 0)
        self.assertEqual(len(self.active(self.sf)), 11)
        board = [df_job(n) for n in range(4)]
        self.assertEqual(self.pull('Fixture Board Co', df_jobs=board)['new'], 4)
        self.assertEqual(set(self.active(self.df).values()), {'GA'})
        self.assertEqual(self.pull('Fixture Board Co', df_jobs=board[:3])['closed'], 1)
        self.assertEqual(self.pull('Fixture Board Co', df_jobs=board, df_csrf=False).get('closed', 0), 0)
        self.assertEqual(len(self.active(self.df)), 3)


if __name__ == '__main__':
    unittest.main()
