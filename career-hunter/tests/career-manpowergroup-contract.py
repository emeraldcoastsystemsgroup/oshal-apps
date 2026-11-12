# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Hold the ManpowerGroup reader (Experis, Manpower) to the search those sites served on 2026-11-11: POST /api/services/Jobs/searchjobs answers the jobs as data with the total in filters.totalCount, and its offset counts pages of `limit` jobs. A search read to its total is whole, and through the pull a whole read closes the job that left; a page the search keeps refusing ends the read with what was read kept and nothing closed; a refusal the search recovers from is asked again; a listed job with no title or a link off the site is not stored and keeps the read from being whole; an answer that is not the search's ends the read unverified. The site links that name the reader, and the ones that only resemble them.
"""The ManpowerGroup sites' job search, answered in the shape the sites serve, through the reader and the pull's one-source path."""
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
STORE = tempfile.TemporaryDirectory(prefix='career-manpowergroup-')
atexit.register(STORE.cleanup)  # Registered before the engine loads, so it runs after the engine's own exit handler.
sys.path.insert(0, str(ROOT / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
os.environ['JOBHUNTER_DATA'] = STORE.name
for name in ('JOBHUNTER_DB', 'JOBHUNTER_CORPUS_DB', 'JOBHUNTER_USER_DB', 'DATABASE_URL'):
    os.environ.pop(name, None)
import requests
from jobhunter import ats, cli, db, resolve

SITE = 'www.experis.com'
SEARCH = '/api/services/Jobs/searchjobs'


def item(number, title='Data Engineer', place='Irving, TX', *, link=None, published='2026-11-11T14:32:54Z'):
    """One job as the search lists it, cut down to the fields a list uses; the live answer carries some fifty more."""
    return {'jobID': str(number), 'positionID': None, 'jobURL': link if link is not None else f'/en/job/{number}/data-engineer',
            'jobTitle': title, 'companyName': '', 'jobLocation': place, 'publishfromDate': published,
            'employmentType': 'Contract', 'domain': 'Technology and IT', 'remoteJobs': '',
            'publicDescription': '<p>Our client is seeking a <strong>Data Engineer</strong>.</p><ul><li>Python</li></ul>'}


def search(items, *, total=None, refuse=None, recover=None, html_page=None):
    """The site's search: POST SEARCH with {"filter": {...}}; `offset` counts pages of `limit` jobs. `refuse` is a page
    the search refuses every time it is asked, `recover` one it refuses once and answers after, `html_page` one it
    answers with a page instead of data."""
    asked = {}

    def answer(method, host, path, body):
        if host != SITE or path != SEARCH or method != 'POST':
            return None
        flt = body['filter']
        page, size = int(flt['offset']), int(flt['limit'])
        asked[page] = asked.get(page, 0) + 1
        if page == refuse or (page == recover and asked[page] == 1):
            return 503, '<html>Service Unavailable</html>'
        if page == html_page:
            return 200, '<html><title>View All Jobs</title></html>'
        rows = items[page * size:(page + 1) * size]
        stated = len(items) if total is None else total
        return 200, json.dumps({'jobsItems': rows, 'filters': {'totalCount': stated, 'offset': page, 'limit': size},
                                'totalNumberOfPosition': 0})
    return answer


@contextlib.contextmanager
def served(*sites):
    """Answer the engine's HTTP session as the sites do, and record each request. Nothing leaves the machine."""
    asked = []

    def request(_session, method, url, **kwargs):
        parts = urlsplit(url)
        body = kwargs.get('json')
        asked.append((method, parts.netloc, parts.path, body))
        found = next((reply for reply in (site(method, parts.netloc, parts.path, body) for site in sites) if reply), None)
        response = requests.Response()
        response.status_code, text = found or (404, '<html>Not found</html>')
        response.url = url
        response.headers['Content-Type'] = 'application/json' if text.startswith('{') else 'text/html'
        response._content = text.encode()
        return response

    with patch.object(requests.sessions.Session, 'request', request), patch('time.sleep', lambda _seconds: None):
        yield asked


def numbered(count, first=1):
    return [item(417000 + n, f'Data Engineer {n}') for n in range(first, first + count)]


def read(token, *sites):
    with served(*sites) as asked:
        feed = ats.BY_NAME['manpowergroup'].fetch(token)
    return feed, asked


class TheSearch(unittest.TestCase):
    def test_a_search_read_to_its_total_is_whole_and_each_job_is_kept_as_the_site_lists_it(self):
        feed, asked = read(SITE, search(numbered(250)))
        self.assertEqual(len(feed), 250)
        self.assertTrue(feed.complete)
        self.assertEqual([(body['filter']['offset'], body['filter']['limit']) for *_rest, body in asked], [(0, 100), (1, 100), (2, 100)],
                         'offset counts pages of a hundred jobs')
        job = feed[0]
        self.assertEqual((job['ats_job_id'], job['title'], job['location'], job['posted_at'], job['department']),
                         ('417001', 'Data Engineer 1', 'Irving, TX', '2026-11-11', 'Technology and IT'))
        self.assertEqual(job['url'], f'https://{SITE}/en/job/417001/data-engineer')
        self.assertEqual(job['description'], 'Our client is seeking a Data Engineer. Python')
        self.assertFalse(job['remote'])

    def test_a_page_the_search_keeps_refusing_ends_the_read_and_what_was_read_is_kept(self):
        feed, asked = read(SITE, search(numbered(250), refuse=1))
        self.assertEqual(len(feed), 100)
        self.assertFalse(feed.complete)
        self.assertEqual(feed.reason, 'http_refused')
        self.assertGreater(sum(1 for *_rest, body in asked if body['filter']['offset'] == 1), 1, 'the refused page was asked again before the read ended')

    def test_a_refusal_the_search_recovers_from_is_asked_again_and_the_read_is_whole(self):
        feed, _asked = read(SITE, search(numbered(250), recover=1))
        self.assertEqual(len(feed), 250)
        self.assertTrue(feed.complete)

    def test_a_job_with_no_title_or_a_link_off_the_site_is_not_stored_and_the_read_is_not_whole(self):
        jobs = numbered(5) + [item(418001, ''), item(418002, link='https://elsewhere.example/en/job/418002/x')]
        feed, _asked = read(SITE, search(jobs))
        self.assertEqual(sorted(job['ats_job_id'] for job in feed), [str(417000 + n) for n in range(1, 6)])
        self.assertFalse(feed.complete)
        self.assertEqual(feed.reason, 'listing_row_invalid')

    def test_an_answer_that_is_not_the_search_ends_the_read_unverified(self):
        feed, _asked = read(SITE, search(numbered(150), html_page=1))
        self.assertEqual(len(feed), 100)
        self.assertFalse(feed.complete)
        self.assertEqual(feed.reason, 'completion_unverified')

    def test_a_search_with_nothing_in_it_is_empty_and_unconfirmed(self):
        feed, _asked = read(SITE, search([], total=0))
        self.assertEqual(len(feed), 0)
        self.assertEqual(feed.reason, 'empty_unconfirmed')


class LinksNameTheReader(unittest.TestCase):
    def test_the_job_lists_of_experis_and_manpower_name_the_reader(self):
        for link, token in {'https://www.experis.com/en/all-jobs': 'www.experis.com',
                            'experis.com/en/search?page=1&searchKeyword=IT': 'www.experis.com',
                            'https://www.manpower.com/en/job/architecture-and-engineering/quality-manager/404746': 'www.manpower.com',
                            'https://manpower.com/en/all-jobs': 'www.manpower.com'}.items():
            self.assertEqual(resolve.classify_url(link), ('manpowergroup', token), link)
        self.assertIn('manpowergroup', resolve.PATTERN_ATS)
        for other in ('https://www.experis.com/en/for-job-seekers', 'https://www.experis.com/en/jobs-at-experis',
                      'https://careers.experis.com/en/all-jobs', 'https://notexperis.com/en/all-jobs',
                      'https://www.jeffersonwells.com/en/all-jobs', 'https://www.manpower.com/en/searching'):
            self.assertIsNone(resolve.classify_url(other), other)


class ThroughThePull(unittest.TestCase):
    def setUp(self):
        with db.connect() as conn:
            for table in (db.corpus_table(), db.companies_table()):
                conn.execute(f'DELETE FROM {table}')
            self.site = db.upsert_company(conn, 'Fixture Experis', ats_type='manpowergroup', ats_token=SITE,
                                          discover_status='found', source_list='curated')

    def pull(self, *sites):
        with db.connect() as conn:
            row = dict(cli._companies(conn, company='Fixture Experis', need_ats=True)[0])
        with served(*sites), contextlib.redirect_stdout(io.StringIO()):
            return cli._scrape_source(row, None)

    def active(self):
        with db.connect() as conn:
            return {row['ats_job_id']: row['state'] for row in conn.execute(
                f'SELECT ats_job_id,state FROM {db.corpus_table()} WHERE company_id=? AND active=1', (self.site,)).fetchall()}

    def test_a_whole_read_closes_the_job_that_left_and_a_refused_one_closes_nothing(self):
        jobs = numbered(150)
        self.assertEqual(self.pull(search(jobs))['new'], 150)
        self.assertEqual(set(self.active().values()), {'TX'})
        self.assertEqual(self.pull(search(jobs[:149]))['closed'], 1)
        self.assertEqual(self.pull(search(jobs[:148], refuse=1)).get('closed', 0), 0)
        self.assertEqual(len(self.active()), 149)


if __name__ == '__main__':
    unittest.main()
