# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Hold the Workable reader to the feed the board really sends: a place given as city, state and country and as one `locations` entry, a job repeated under one id for each place it is offered in, a hidden place, and `telecommuting` as the remote answer. Read through the engine's own HTTP layer and one-source pull into real SQLite, where a stored job that gains a place or moves must take its state, city and map point with it. No network.
"""The Workable reader against a feed in the board's live shape, through the pull's own one-source path and a real store."""
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

ROOT = Path(__file__).resolve().parents[1]
STORE = tempfile.TemporaryDirectory(prefix='career-workable-feed-')
atexit.register(STORE.cleanup)  # Registered before the engine loads, so it runs after the engine's own exit handler.
sys.path.insert(0, str(ROOT / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
os.environ['JOBHUNTER_DATA'] = STORE.name
for name in ('JOBHUNTER_DB', 'JOBHUNTER_CORPUS_DB', 'JOBHUNTER_USER_DB', 'DATABASE_URL'):
    os.environ.pop(name, None)
import requests
from jobhunter import ats, cli, db

BOARD = 'fixture-board'
ADDRESS = f'https://apply.workable.com/api/v1/widget/accounts/{BOARD}?details=true'


def listing(code, title, city, state, country, *, hidden=False, telecommuting=False, places=True):
    """One listing with every field the board's feed carries. It has no `location` and no `remote` field."""
    place = {'country': country, 'countryCode': country[:2].upper(), 'city': city, 'region': state or None, 'hidden': hidden}
    return {'title': title, 'shortcode': code, 'code': '', 'employment_type': 'Full-time', 'telecommuting': telecommuting,
            'department': 'Consulting', 'url': f'https://apply.workable.com/j/{code}',
            'shortlink': f'https://apply.workable.com/j/{code}', 'application_url': f'https://apply.workable.com/j/{code}/apply',
            'published_on': '2026-11-02', 'created_at': '2026-11-01', 'country': country, 'city': city, 'state': state,
            'education': '', 'experience': '', 'function': '', 'industry': '',
            'description': f'<p>{title} at the fixture employer.</p>', 'locations': [place] if places else []}


LIVE_SHAPE = [
    listing('AAA111', 'Data Architect', 'Raleigh', 'North Carolina', 'United States'),
    listing('AAA111', 'Data Architect', 'Dallas', 'Texas', 'United States'),
    listing('AAA111', 'Data Architect', 'Atlanta', 'Georgia', 'United States'),
    listing('BBB222', 'Marketing Manager', 'Tallahassee', 'Florida', 'United States', hidden=True, telecommuting=True),
    listing('CCC333', 'Python Engineer', '', '', 'France', hidden=True, telecommuting=True),
    listing('CCC333', 'Python Engineer', '', '', 'United States', hidden=True, telecommuting=True),
    listing('DDD444', 'Analytics Engineer', 'Oxford', 'England', 'United Kingdom', places=False),
    listing('EEE555', 'Remote Sensing Engineer', 'Seattle', 'Washington', 'United States'),
]
EXPECTED = {
    'AAA111': ('Raleigh, North Carolina, United States', 0),
    'BBB222': ('United States / Remote', 1),
    'CCC333': ('France / Remote', 1),
    'DDD444': ('Oxford, England, United Kingdom', 0),
    'EEE555': ('Seattle, Washington, United States', 0),
}


@contextlib.contextmanager
def board_answers(jobs):
    """Answer the engine's HTTP session with this feed and record what it asked for. Nothing leaves the machine."""
    asked = []

    def answer(_session, method, url, **_kwargs):
        asked.append((method.upper(), url))
        response = requests.Response()
        response.status_code, response.url = 200, url
        response.headers['Content-Type'] = 'application/json'
        response._content = json.dumps({'name': 'Fixture Employer', 'jobs': jobs}).encode()
        return response

    with patch.object(requests.sessions.Session, 'request', answer), patch('time.sleep', lambda _seconds: None):
        yield asked


class WorkableFeed(unittest.TestCase):
    def setUp(self):
        with db.connect() as conn:
            for table in (db.corpus_table(), db.companies_table()):
                conn.execute(f'DELETE FROM {table}')
            self.company = db.upsert_company(conn, 'Fixture Employer', ats_type='workable', ats_token=BOARD,
                                             discover_status='found', source_list='curated')

    def pull(self, jobs):
        """The nightly pull's own read of one employer. Returns what it printed and what it asked the board for."""
        with db.connect() as conn:
            row = dict(cli._companies(conn, company='Fixture Employer', need_ats=True)[0])
        said = io.StringIO()
        with board_answers(jobs) as asked, contextlib.redirect_stdout(said):
            added = cli._scrape_source(row, None)
        return added, said.getvalue(), asked

    def stored(self):
        with db.connect() as conn:
            rows = conn.execute(f"""SELECT id,ats_job_id,title,location,remote,state,city,lat,lon,url,active FROM {db.corpus_table()}
                WHERE company_id=? ORDER BY ats_job_id""", (self.company,)).fetchall()
        return {row['ats_job_id']: dict(row) for row in rows}

    def test_the_reader_gives_one_row_for_each_job_with_its_place_and_its_remote_answer(self):
        with board_answers(LIVE_SHAPE) as asked:
            rows = ats.Workable.fetch(BOARD)
        self.assertEqual(asked, [('GET', ADDRESS)])
        self.assertEqual({row['ats_job_id']: (row['location'], row['remote']) for row in rows}, EXPECTED)
        self.assertEqual([row['ats_job_id'] for row in rows], list(EXPECTED))
        for row in rows:
            self.assertEqual(row['url'], f"https://apply.workable.com/j/{row['ats_job_id']}")
            self.assertEqual(row['posted_at'], '2026-11-02')

    def test_the_pull_stores_every_job_once_with_a_place_the_search_can_use(self):
        added, said, asked = self.pull(LIVE_SHAPE)
        self.assertEqual(asked, [('GET', ADDRESS)])
        self.assertEqual((added['new'], added['skipped']), (len(EXPECTED), 0))
        self.assertIn(f'{len(EXPECTED):>4} received', said)
        stored = self.stored()
        self.assertEqual({job: (row['location'], row['remote']) for job, row in stored.items()}, EXPECTED)
        self.assertEqual((stored['AAA111']['state'], stored['AAA111']['city']), ('NC', 'raleigh'))
        self.assertEqual(stored['EEE555']['state'], 'WA')
        with db.connect() as conn:
            state = conn.execute('SELECT status,last_error_code,fetched,new_count FROM corpus.source_pull_state WHERE company_id=?',
                                 (self.company,)).fetchone()
        # A repeated id makes the pull call the whole feed invalid. This reader's listing is still not one the pull
        # treats as proof that a missing job has closed, so the read is recorded as unverified, not as invalid.
        self.assertEqual((state['status'], state['last_error_code']), ('partial', 'completion_unverified'))
        self.assertEqual((state['fetched'], state['new_count']), (len(EXPECTED), len(EXPECTED)))

    def test_a_second_pull_of_the_same_feed_changes_nothing(self):
        self.pull(LIVE_SHAPE)
        before = self.stored()
        added, _said, _asked = self.pull(LIVE_SHAPE)
        self.assertEqual((added['new'], added['seen'], added['skipped']), (0, len(EXPECTED), 0))
        self.assertEqual(self.stored(), before)

    def test_a_job_stored_without_a_place_takes_it_on_the_next_pull_and_keeps_its_row(self):
        with db.connect() as conn:
            db.upsert_posting(conn, self.company, {'ats_job_id': 'AAA111', 'title': 'Data Architect', 'location': None,
                                                   'remote': 0, 'url': 'https://apply.workable.com/j/AAA111'})
            kept = conn.execute(f'SELECT id FROM {db.corpus_table()} WHERE company_id=?', (self.company,)).fetchone()['id']
        added, _said, _asked = self.pull(LIVE_SHAPE)
        self.assertEqual(added['new'], len(EXPECTED) - 1)
        row = self.stored()['AAA111']
        self.assertEqual((row['id'], row['location'], row['state'], row['city']),
                         (kept, EXPECTED['AAA111'][0], 'NC', 'raleigh'))
        self.assertIsNotNone(row['lat'])

    def test_a_job_that_moves_is_placed_where_it_now_is_and_one_whose_feed_drops_the_place_keeps_its_point(self):
        job = {'ats_job_id': 'MOVE1', 'title': 'Data Architect', 'remote': 0, 'url': 'https://apply.workable.com/j/MOVE1'}
        with db.connect() as conn:
            self.assertEqual(db.upsert_posting(conn, self.company, {**job, 'location': 'Dallas, Texas, United States'}), 'new')
        first = self.stored()['MOVE1']
        self.assertEqual((first['state'], first['city']), ('TX', 'dallas'))
        with db.connect() as conn:
            self.assertEqual(db.upsert_posting(conn, self.company, {**job, 'location': 'Atlanta, Georgia, United States'}), 'seen')
        moved = self.stored()['MOVE1']
        self.assertEqual((moved['id'], moved['state'], moved['city']), (first['id'], 'GA', 'atlanta'))
        self.assertNotEqual((moved['lat'], moved['lon']), (first['lat'], first['lon']))
        with db.connect() as conn:
            db.upsert_posting(conn, self.company, {**job, 'location': None})
        dropped = self.stored()['MOVE1']
        self.assertIsNone(dropped['location'])
        self.assertEqual((dropped['state'], dropped['city'], dropped['lat'], dropped['lon']),
                         (moved['state'], moved['city'], moved['lat'], moved['lon']))

    def test_the_older_location_object_and_remote_answer_still_read(self):
        older = [{'id': '1', 'title': 'Developer', 'location': {'city': 'Seattle', 'region': 'WA'}, 'remote': True},
                 {'id': '2', 'title': 'Developer', 'location': 'Austin, TX', 'remote': 'false', 'telecommuting': True},
                 {'id': '3', 'title': 'Developer', 'location': {}, 'city': 'Boise', 'state': 'Idaho', 'country': 'United States'},
                 {'id': '4', 'title': 'Developer'}]
        with board_answers(older):
            rows = ats.Workable.fetch(BOARD)
        self.assertEqual([(row['ats_job_id'], row['location'], row['remote']) for row in rows],
                         [('1', 'Seattle, WA / Remote', 1), ('2', 'Austin, TX', 0), ('3', 'Boise, Idaho, United States', 0),
                          ('4', None, 0)])


if __name__ == '__main__':
    unittest.main()
