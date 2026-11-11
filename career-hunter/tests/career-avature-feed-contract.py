# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Hold the Avature reader to the three list pages its boards really send: a place and a workplace the board marks beside each job (ManTech), a place that ends the line under the title, or "Multiple Locations" in its stead (Deloitte), and a shop list with no place that links every job four times (Trader Joe's). Read page by page through the engine's own HTTP layer and one-source pull into real SQLite, where a stored job filed under a state its location does not state is filed again by the next pull. No network.
"""The Avature reader against list pages in the boards' live shapes, through the pull's own one-source path and a real store."""
import atexit
import contextlib
import html
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
STORE = tempfile.TemporaryDirectory(prefix='career-avature-feed-')
atexit.register(STORE.cleanup)  # Registered before the engine loads, so it runs after the engine's own exit handler.
sys.path.insert(0, str(ROOT / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
os.environ['JOBHUNTER_DATA'] = STORE.name
for name in ('JOBHUNTER_DB', 'JOBHUNTER_CORPUS_DB', 'JOBHUNTER_USER_DB', 'DATABASE_URL'):
    os.environ.pop(name, None)
import requests
from bs4 import BeautifulSoup
from jobhunter import ats, cli, db, source_memory

HOST = 'fixture.avature.net'
SEARCH = f'https://{HOST}/careers/SearchJobs'


def address(job, title):
    return f"https://{HOST}/en_US/careers/JobDetail/{title.replace(' ', '-').replace('/', '-')}/{job}"


def marked(job, title, place, remote_type='Onsite'):
    """One job as ManTech's list shows it: the board marks the place, and states the remote type beside it."""
    return f'''<article class="article article--result article--non-toggle" id="article--{job}"> <div class="article__header">
 <div class="article__header__text"> <h3 class="article__header__text__title title title--04">
 <a class="link" href="{address(job, title)}"> {html.escape(title)} </a> </h3>
 <div class="article__header__text__subtitle"> <span class="list-item-location">{html.escape(place)}</span>
 <span aria-hidden="true" class="separator"> &bull; </span> <span class="list-item-ref">Req # R{job}</span>
 <span aria-hidden="true" class="separator"> &bull; </span> <span class="list-item-posted">Posted Date: 11/10/2026</span>
 <span aria-hidden="true" class="separator"> &bull; </span> <span class="list-item-remote type">Remote Type: {remote_type}</span>
 </div> </div> </div> <div class="article__footer">
 <a class="button button--secondary" href="https://{HOST}/en_US/careers/ApplicationMethods?jobId={job}" tabindex="0"> Apply </a>
 </div> </article>'''


def trailing(job, title, *line):
    """One job as Deloitte's list shows it: member firm, legal entity, and the place or "Multiple Locations"."""
    spans = ' | '.join(f'<span> {html.escape(text)} </span>' for text in line)
    return f'''<article class="article--result" data-total="999+"> <div class="article__content--result">
 <div class="article__header__text"> <h3 class="article__header__text__title article__header__text__title--2">
 <a class="link" href="{address(job, title)}"> {html.escape(title)} </a> </h3>
 <div class="article__header__text__subtitle"> {spans} </div> </div> </div> </article>'''


def shop(job, title, street, kind):
    """One job in one of the two lists Trader Joe's page carries: its title link, a shop's street, and a share-by-mail
    link that holds the job's address again."""
    link = address(job, title)
    return f'''<li class="{kind}"> <h2 class="listSingleColumnItemTitle"> <a href="{link}"> {html.escape(title)} </a> </h2>
 <p class="listSingleColumnItemMiscData"> {html.escape(street)} </p> <span class="tpt_socialShareBar">
 <a class="icon32 iconEmail32 tpt_socialShareIcon" href="mailto:?body={link}" tabindex="-1"> Share {html.escape(title)} with a friend via e-mail </a>
 </span> <a class="buttonNormal" href="https://{HOST}/careers/ApplicationMethods?jobId={job}"> Apply </a> </li>'''


def pages(cards, size, total):
    """The board's list cut into pages of `size`, keyed by the offset each page is asked for with."""
    return {start: f'<html><body><p>{start + 1} - {min(start + size, total)} of {total} results</p>'
                   f'<div class="results">{"".join(cards[start:start + size])}</div></body></html>'
            for start in range(0, total, size)}


MARKED = [
    marked(67034, 'Personnel Security Specialist', 'Location: USA-VA-Fort Belvoir'),
    marked(67035, 'Systems Engineer', 'Location: USA-VA-Herndon, USA-TX-San Antonio, USA-MD-Hanover', 'Hybrid'),
    marked(67036, 'Logistics Analyst', 'Location: International-Germany-Miesau'),
    marked(67037, 'Help Desk Technician', 'Location: USA-DC-Washington'),
    marked(67038, 'Intelligence Analyst', 'Location: USA-FL-a regional federal hub'),
    marked(67039, 'Cyber Analyst', 'Location: USA-VA-Arlington', 'Fully Remote'),
    marked(67040, 'Cloud Engineer', 'Location: USA-Remote Work', 'Fully Remote'),
    marked(67041, 'Remote Systems Administrator', 'Location: USA-MD-Hanover'),
]
# A job the board marks fully remote in a named city keeps that answer in its stored place, as every reader's jobs do.
MARKED_PLACES = {'67034': 'USA-VA-Fort Belvoir', '67035': 'USA-VA-Herndon, USA-TX-San Antonio, USA-MD-Hanover',
                 '67036': 'International-Germany-Miesau', '67037': 'USA-DC-Washington', '67038': 'USA-FL-a regional federal hub',
                 '67039': 'USA-VA-Arlington / Remote', '67040': 'USA-Remote Work', '67041': 'USA-MD-Hanover'}
MARKED_REMOTE = {'67039', '67040'}
MARKED_ASKED = [0, 3, 6, 8, 18]     # three pages, then the two empty answers the reader waits for before it stops
TRAILING = [
    trailing(374969, 'Cyber Operate - PlainID/PBAC Senior Consultant', 'Deloitte US', 'Deloitte & Touche LLP',
             'Chicago, Illinois, United States'),
    trailing(374970, 'Tax Senior', 'Deloitte US', 'Deloitte Tax LLP', 'Multiple Locations'),
    trailing(374971, 'Global Mobility Lead', 'Deloitte Global', 'Deloitte Touche Tohmatsu Services, LLC', 'Multiple Locations'),
    trailing(374972, 'Forensic Analyst', 'Deloitte US', 'Deloitte Transactions and Business Analytics LLP',
             'Washington, District of Columbia, United States'),
]
TRAILING_PLACES = {'374969': 'Chicago, Illinois, United States', '374970': None, '374971': None,
                   '374972': 'Washington, District of Columbia, United States'}
SHOPS = [(21567, 'Crew', '#681 - 1407 Waukegan Road'), (21568, 'Crew', '#702 - 2101 Liberty Street'),
         (21569, 'Mate', '#544 - 77 Boston Post Road'), (21570, 'Crew', '#119 - 3977 Sepulveda Boulevard'),
         (21571, 'Merchant', '#236 - 20 Main Street')]


def shop_pages(size):
    """Each page carries its jobs twice, once in the list for a phone and once in the list for a wide screen."""
    cut = {}
    for start in range(0, len(SHOPS), size):
        here = SHOPS[start:start + size]
        cut[start] = ('<html><body><p>%d-%d of %d results</p><ul class="listSingleColumn">%s</ul><ul class="listSingleColumn">%s</ul>'
                      '</body></html>') % (start + 1, start + len(here), len(SHOPS),
                                           ''.join(shop(*job, 'mobile_listSingleColumnItem') for job in here),
                                           ''.join(shop(*job, 'listSingleColumnItem') for job in here))
    return cut


@contextlib.contextmanager
def board_answers(by_offset):
    """Answer the engine's HTTP session with the page for the offset it asks for; past the last page the list is empty,
    as the boards answer. Records every offset asked for. Nothing leaves the machine."""
    asked = []

    def answer(_session, method, url, **kwargs):
        offset = int((kwargs.get('params') or {}).get('jobOffset', -1))
        assert (method.upper(), url) == ('GET', SEARCH), (method, url)
        asked.append(offset)
        response = requests.Response()
        response.status_code, response.url = 200, url
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        response._content = by_offset.get(offset, '<html><body><p>0 results</p></body></html>').encode()
        return response

    with patch.object(requests.sessions.Session, 'request', answer), patch('time.sleep', lambda _seconds: None):
        yield asked


class AvatureFeed(unittest.TestCase):
    def setUp(self):
        with db.connect() as conn:
            # Each case starts with no jobs and no memory of an earlier pull: a job the pull remembers as unchanged
            # is not stored again, so a hash left by another case would decide this one.
            source_memory.ensure(conn)
            memory = [source_memory.table(name) for name in ('source_posting_hashes', 'source_http_validators', 'source_pull_state')]
            for table in (db.corpus_table(), db.companies_table(), *memory):
                conn.execute(f'DELETE FROM {table}')
            self.company = db.upsert_company(conn, 'Fixture Employer', ats_type='avature', ats_token=HOST,
                                             discover_status='found', source_list='curated')

    def pull(self, by_offset):
        """The nightly pull's own read of one employer. Returns what it added and the offsets it asked the board for."""
        with db.connect() as conn:
            row = dict(cli._companies(conn, company='Fixture Employer', need_ats=True)[0])
        with board_answers(by_offset) as asked, contextlib.redirect_stdout(io.StringIO()):
            added = cli._scrape_source(row, None)
        return added, asked

    def stored(self):
        with db.connect() as conn:
            rows = conn.execute(f"""SELECT id,ats_job_id,title,location,remote,state,city,lat,lon,url,active FROM {db.corpus_table()}
                WHERE company_id=? ORDER BY ats_job_id""", (self.company,)).fetchall()
        return {row['ats_job_id']: dict(row) for row in rows}

    def test_the_reader_takes_the_place_and_the_workplace_the_board_marks(self):
        with board_answers(pages(MARKED, 3, len(MARKED))) as asked:
            rows = ats.Avature.fetch(HOST)
        self.assertEqual(asked, MARKED_ASKED)
        self.assertEqual({row['ats_job_id']: row['location'] for row in rows}, MARKED_PLACES)
        self.assertEqual([row['title'] for row in rows][:2], ['Personnel Security Specialist', 'Systems Engineer'])
        self.assertEqual(rows[0]['url'], address(67034, 'Personnel Security Specialist'))
        # "Fully Remote" makes a job remote, in a named city too. The label "Remote Type:" does not: it stands beside
        # every job. "Onsite" keeps a job whose title says remote where it is.
        self.assertEqual({row['ats_job_id'] for row in rows if row['remote']}, MARKED_REMOTE)

    def test_the_workplace_is_the_value_the_board_marks_without_its_label(self):
        for shown, workplace in [('Remote Type: Fully Remote', 'Fully Remote'), ('Remote Type: Onsite', 'Onsite'),
                                 ('Remote Type: Hybrid', 'Hybrid'), ('Remote Type:', None)]:
            with self.subTest(shown=shown):
                page = marked(1, 'Analyst', 'Location: USA-VA-Herndon').replace('Remote Type: Onsite', shown)
                link = BeautifulSoup(page, 'lxml').find('a')
                self.assertEqual(ats.Avature._workplace(ats.Avature._card(link, '1')), workplace)
        link = BeautifulSoup(trailing(1, 'Analyst', 'Deloitte US', 'Multiple Locations'), 'lxml').find('a')
        self.assertIsNone(ats.Avature._workplace(ats.Avature._card(link, '1')))

    def test_the_reader_takes_a_place_that_ends_the_line_and_none_where_the_line_says_multiple_locations(self):
        with board_answers(pages(TRAILING, 10, len(TRAILING))):
            rows = ats.Avature.fetch(HOST)
        self.assertEqual({row['ats_job_id']: row['location'] for row in rows}, TRAILING_PLACES)

    def test_only_a_city_a_region_and_a_country_at_the_end_of_the_line_is_a_place(self):
        cases = [(('Deloitte US', 'Deloitte Consulting LLP', 'Rosslyn, Virginia, United States'), 'Rosslyn, Virginia, United States'),
                 (('Deloitte US', 'Deloitte Consulting LLP', 'Multiple Locations'), None),
                 (('Deloitte Global', 'Deloitte Touche Tohmatsu Services, LLC'), None),
                 (('Rosslyn, Virginia, United States', 'Deloitte Consulting LLP'), None),
                 (('Deloitte US', 'Posted Tuesday, November 10, 2026'), None),
                 ((), None)]
        for line, place in cases:
            with self.subTest(line=line):
                link = BeautifulSoup(trailing(1, 'Analyst', *line), 'lxml').find('a')
                self.assertEqual(ats.Avature._place(ats.Avature._card(link, '1')), place)

    def test_what_a_block_that_holds_more_than_one_job_says_is_given_to_neither(self):
        soup = BeautifulSoup('<ul><li>' + marked(1, 'Analyst', 'Location: USA-VA-Herndon')
                             + marked(2, 'Engineer', 'Location: USA-TX-San Antonio') + '</li></ul>', 'lxml')
        for link in soup.find_all('a', class_='link'):
            link.find_parent('article').unwrap()     # the two jobs now share the one list item
        cards = [ats.Avature._card(link, link['href'].rsplit('/', 1)[-1]) for link in soup.find_all('a', class_='link')]
        self.assertEqual([(ats.Avature._place(card), ats.Avature._workplace(card)) for card in cards], [(None, None)] * 2)

    def test_a_list_that_links_each_job_four_times_is_read_whole(self):
        with board_answers(shop_pages(2)) as asked:
            rows = ats.Avature.fetch(HOST)
        # Pages of two jobs carry eight links. The next page starts two jobs on, not eight.
        self.assertEqual(asked, [0, 2, 4, 5, 15])
        self.assertEqual([row['ats_job_id'] for row in rows], [str(job) for job, _title, _street in SHOPS])
        self.assertEqual({row['location'] for row in rows}, {None})     # a shop number and a street are not a place

    def test_the_pull_stores_each_marked_place_with_its_state_city_and_map_point(self):
        added, asked = self.pull(pages(MARKED, 3, len(MARKED)))
        self.assertEqual((asked, added['new'], added['skipped']), (MARKED_ASKED, len(MARKED), 0))
        stored = self.stored()
        self.assertEqual({job: row['location'] for job, row in stored.items()}, MARKED_PLACES)
        self.assertEqual({job: (row['state'], row['city']) for job, row in stored.items()},
                         {'67034': ('VA', 'fort belvoir'), '67035': ('VA', 'herndon'), '67036': (None, None),
                          '67037': ('DC', 'washington'), '67038': ('FL', 'a regional federal hub'), '67039': ('VA', 'arlington'),
                          '67040': (None, None), '67041': ('MD', None)})
        # Hanover, Maryland is not in the bundled town list: the job has its state and no map point.
        self.assertEqual({job for job, row in stored.items() if row['lat'] is None or row['lon'] is None},
                         {'67036', '67040', '67041'})
        self.assertEqual({job for job, row in stored.items() if row['remote']}, MARKED_REMOTE)
        with db.connect() as conn:
            state = conn.execute('SELECT status,last_error_code,fetched,new_count FROM corpus.source_pull_state WHERE company_id=?',
                                 (self.company,)).fetchone()
        # This reader's listing is not one the pull treats as proof that a missing job has closed.
        self.assertEqual((state['status'], state['last_error_code']), ('partial', 'completion_unverified'))
        self.assertEqual((state['fetched'], state['new_count']), (len(MARKED), len(MARKED)))

    def test_the_pull_files_the_capital_under_the_district_and_stores_no_place_for_multiple_locations(self):
        added, _asked = self.pull(pages(TRAILING, 10, len(TRAILING)))
        self.assertEqual(added['new'], len(TRAILING))
        stored = self.stored()
        self.assertEqual({job: (row['location'], row['state'], row['city']) for job, row in stored.items()},
                         {'374969': ('Chicago, Illinois, United States', 'IL', 'chicago'),
                          '374970': (None, None, None), '374971': (None, None, None),
                          '374972': ('Washington, District of Columbia, United States', 'DC', 'washington')})

    def test_a_job_stored_without_a_place_takes_it_on_the_next_pull_and_keeps_its_row(self):
        with db.connect() as conn:
            db.upsert_posting(conn, self.company, {'ats_job_id': '67034', 'title': 'Personnel Security Specialist',
                                                   'location': None, 'remote': 0,
                                                   'url': address(67034, 'Personnel Security Specialist')})
            kept = conn.execute(f'SELECT id,state,lat FROM {db.corpus_table()} WHERE company_id=?', (self.company,)).fetchone()
        self.assertEqual((kept['state'], kept['lat']), (None, None))
        added, _asked = self.pull(pages(MARKED, 3, len(MARKED)))
        self.assertEqual((added['new'], added['seen']), (len(MARKED) - 1, 1))
        row = self.stored()['67034']
        self.assertEqual((row['id'], row['location'], row['state'], row['city']),
                         (kept['id'], 'USA-VA-Fort Belvoir', 'VA', 'fort belvoir'))
        self.assertIsNotNone(row['lat'])

    def test_a_job_filed_under_a_state_its_location_does_not_state_is_filed_again_on_the_next_pull(self):
        self.pull(pages(TRAILING, 10, len(TRAILING)))
        before = self.stored()
        # The capital as an earlier state lookup filed it: under Washington State, where no town of that name was found.
        with db.connect() as conn:
            conn.execute(f"UPDATE {db.corpus_table()} SET state='WA', city=NULL, lat=NULL, lon=NULL WHERE id=?",
                         (before['374972']['id'],))
        self.assertEqual(self.stored()['374972']['state'], 'WA')
        added, _asked = self.pull(pages(TRAILING, 10, len(TRAILING)))
        self.assertEqual((added['new'], added['seen']), (0, len(TRAILING)))
        # The same row, back under the District with its town and map point; the board's location did not change.
        self.assertEqual(self.stored(), before)

    def test_a_job_filed_under_a_state_though_its_location_states_none_loses_it_on_the_next_pull(self):
        self.pull(pages(MARKED, 3, len(MARKED)))
        before = self.stored()
        self.assertEqual((before['67036']['location'], before['67036']['state']), ('International-Germany-Miesau', None))
        with db.connect() as conn:
            conn.execute(f"UPDATE {db.corpus_table()} SET state='CA', city='miesau', lat=1.0, lon=2.0 WHERE id=?",
                         (before['67036']['id'],))
        self.pull(pages(MARKED, 3, len(MARKED)))
        self.assertEqual(self.stored(), before)

    def test_a_second_pull_of_the_same_list_changes_nothing(self):
        self.pull(pages(MARKED, 3, len(MARKED)))
        before = self.stored()
        added, _asked = self.pull(pages(MARKED, 3, len(MARKED)))
        self.assertEqual((added['new'], added['seen'], added['skipped']), (0, len(MARKED), 0))
        self.assertEqual(self.stored(), before)

    def test_the_pull_stores_every_shop_job_once(self):
        added, _asked = self.pull(shop_pages(2))
        self.assertEqual((added['new'], added['skipped']), (len(SHOPS), 0))
        stored = self.stored()
        self.assertEqual(sorted(stored), [str(job) for job, _title, _street in SHOPS])
        self.assertEqual({(row['location'], row['state']) for row in stored.values()}, {(None, None)})


if __name__ == '__main__':
    unittest.main()
