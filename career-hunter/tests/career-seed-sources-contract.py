# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Hold the employer seed list to what the nightly pull can read: one reader and one board per employer, a token the reader itself turns into its board's address, and a real SQLite seed that lands every entry in the pull's list and moves a row off a retired board. No network.
# 2 | maintainer@emeraldcoastsystemsgroup.com | The address a reader asks for must be on a real host. A reader that takes a careers host, given a short name instead, asked for `https://<name>/…` and the check passed it because the name was in the address.
"""The employer seed list against the engine's own readers and a real SQLite store; every request is refused."""
import atexit
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
STORE = tempfile.TemporaryDirectory(prefix='career-seed-sources-')
atexit.register(STORE.cleanup)  # Registered before the engine loads, so it runs after the engine's own exit handler.
sys.path.insert(0, str(ROOT / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
os.environ['JOBHUNTER_DATA'] = STORE.name
for name in ('JOBHUNTER_DB', 'JOBHUNTER_CORPUS_DB', 'JOBHUNTER_USER_DB', 'DATABASE_URL'):
    os.environ.pop(name, None)
import requests
from jobhunter import ats, cli, db, seeds

SEED = json.loads((ROOT / 'engine/seeds/companies_seed.json').read_text(encoding='utf-8'))
FIELDS = {'name', 'ticker', 'ats_type', 'ats_token', 'homepage', 'careers_url', 'industry'}
# Lockheed Martin's Radancy site was retired by the employer; the seed list held it until 1.52.3.
RETIRED = ('radancy', 'www.lockheedmartinjobs.com')
# Readers that do not read through the engine's HTTP session, so a refused request cannot show their first address.
NO_SESSION_REQUEST = {'symphony'}


def board(entry):
    return entry['ats_type'], entry['ats_token']


def first_request(entry):
    """The first address the entry's own reader asks for. The network is refused, so nothing leaves the machine."""
    asked = []

    def refuse(_session, method, url, **_kwargs):
        asked.append(url)
        raise requests.ConnectionError('this test has no network')

    with patch.object(requests.sessions.Session, 'request', refuse), patch('time.sleep', lambda _seconds: None):
        try:
            ats.BY_NAME[entry['ats_type']].fetch(entry['ats_token'])
        except requests.RequestException:
            pass
    return asked[0] if asked else None


def named_in_address(token, address):
    """Whether the address is the board the token names: a link token is the address's start, a host is its host,
    and a short name (a board slug, or a Workday tenant before its `:`) appears in it."""
    head = token.split('|')[0]
    if '://' in head:
        return address.startswith(head)
    host = urlsplit(address).hostname or ''
    if '.' in head:
        return host == head
    return head.split(':')[0].lower() in address.lower()


class SeedSources(unittest.TestCase):
    def setUp(self):
        with db.connect() as conn:
            conn.execute(f'DELETE FROM {db.companies_table()}')

    def pull_list(self):
        with db.connect() as conn:
            return {row['name']: dict(row) for row in cli._companies(conn, need_ats=True)}

    def test_each_entry_names_one_known_reader_and_no_two_share_a_name_or_a_board(self):
        names, boards = set(), set()
        for entry in SEED:
            with self.subTest(name=entry.get('name')):
                self.assertFalse(set(entry) - FIELDS)
                self.assertTrue(entry['name'].strip())
                self.assertIn(entry['ats_type'], ats.BY_NAME)
                self.assertTrue(entry['ats_token'].strip())
                self.assertEqual(entry['ats_token'], entry['ats_token'].strip())
                for link in ('homepage', 'careers_url'):
                    if link in entry:
                        self.assertEqual(urlsplit(entry[link]).scheme, 'https')
                self.assertNotIn(entry['name'].casefold(), names)
                self.assertNotIn((entry['ats_type'], entry['ats_token'].casefold()), boards)
                names.add(entry['name'].casefold())
                boards.add((entry['ats_type'], entry['ats_token'].casefold()))
        self.assertNotIn(RETIRED, {board(entry) for entry in SEED})

    def test_each_reader_asks_for_the_board_its_seed_token_names(self):
        unjudged = set()
        for entry in SEED:
            with self.subTest(name=entry['name'], board=board(entry)):
                address = first_request(entry)
                if address is None:
                    unjudged.add(entry['ats_type'])
                    continue
                self.assertEqual(urlsplit(address).scheme, 'https')
                self.assertIn('.', urlsplit(address).hostname or '', address)
                self.assertTrue(named_in_address(entry['ats_token'], address), address)
        self.assertEqual(unjudged - NO_SESSION_REQUEST, set())

    def test_a_malformed_token_is_caught_by_the_same_check(self):
        for entry in ({'ats_type': 'workday', 'ats_token': 'mars:External'},
                      {'ats_type': 'workday', 'ats_token': 'https://mars.wd3.myworkdayjobs.com/External'}):
            with self.subTest(token=entry['ats_token']):
                with self.assertRaises(ValueError):
                    first_request(entry)
        # A reader that takes a careers host, given a short name, asks for a host that is not one.
        self.assertNotIn('.', urlsplit(first_request({'ats_type': 'successfactors', 'ats_token': 'capgemini'})).hostname)
        self.assertFalse(named_in_address('careers.example.com', 'https://jobs.example.com/search/'))
        self.assertFalse(named_in_address('https://www.example.com/jobs', 'https://www.example.com/'))
        self.assertFalse(named_in_address('acme', 'https://boards-api.greenhouse.io/v1/boards/other/jobs'))

    def test_a_careers_link_the_engine_recognizes_names_the_same_board(self):
        recognized = 0
        for entry in SEED:
            if 'careers_url' not in entry:
                continue
            found = ats.detect_from_url(entry['careers_url'])
            if found != (None, None):
                with self.subTest(name=entry['name']):
                    self.assertEqual(found, board(entry))
                recognized += 1
        self.assertGreater(recognized, 0)

    def test_seeding_the_list_puts_every_entry_in_the_nightly_pull_list_once(self):
        self.assertEqual(seeds.seed_list('curated'), len(SEED))
        self.assertEqual(seeds.seed_list('curated'), len(SEED))
        pulled = self.pull_list()
        self.assertEqual(set(pulled), {entry['name'] for entry in SEED})
        for entry in SEED:
            row = pulled[entry['name']]
            with self.subTest(name=entry['name']):
                self.assertEqual((row['ats_type'], row['ats_token']), board(entry))
                self.assertEqual(row['discover_status'], 'found')
                self.assertEqual(json.loads(row['source_lists']), ['curated'])
                self.assertEqual(row['careers_url'], entry.get('careers_url'))

    def test_seeding_moves_a_row_off_the_retired_board_and_keeps_the_row(self):
        with db.connect() as conn:
            kept = db.upsert_company(conn, 'Lockheed Martin', ats_type=RETIRED[0], ats_token=RETIRED[1],
                                     discover_status='found', source_list='govcon')
        seeds.seed_list('curated')
        row = self.pull_list()['Lockheed Martin']
        entry = next(entry for entry in SEED if entry['name'] == 'Lockheed Martin')
        self.assertEqual(row['id'], kept)
        self.assertEqual((row['ats_type'], row['ats_token']), board(entry))
        self.assertNotEqual((row['ats_type'], row['ats_token']), RETIRED)
        self.assertEqual(json.loads(row['source_lists']), ['curated', 'govcon'])

    def test_a_name_seeded_from_another_list_takes_its_board_from_this_one(self):
        entry = next(entry for entry in SEED if entry['name'] == 'Caterpillar Inc.')
        with patch('jobhunter.seeds.load_sp500', lambda: [('Caterpillar Inc.', 'CAT'), ('Example Without A Board', 'EWB')]):
            self.assertEqual(seeds.seed_list('sp500'), 2)
        pulled = self.pull_list()
        self.assertEqual(set(pulled), {'Caterpillar Inc.'})
        self.assertEqual((pulled['Caterpillar Inc.']['ats_type'], pulled['Caterpillar Inc.']['ats_token']), board(entry))
        self.assertEqual(json.loads(pulled['Caterpillar Inc.']['source_lists']), ['sp500'])
        with db.connect() as conn:
            other = conn.execute('SELECT ats_type, ats_token FROM companies WHERE name=?', ('Example Without A Board',)).fetchone()
        self.assertEqual((other['ats_type'], other['ats_token']), (None, None))


if __name__ == '__main__':
    unittest.main()
