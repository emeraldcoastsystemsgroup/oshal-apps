# CHANGE LOG
# 13 | maintainer@emeraldcoastsystemsgroup.com | A job's link is resolved against its board and kept only on the board's host: a Talentsoft card whose link is written in full keeps that address, one whose link leads to another host is not stored and the read is not whole, and a Motion Recruitment link to another host is not read as one of the board's jobs.
# 12 | maintainer@emeraldcoastsystemsgroup.com | Prove where a Randstad job's id comes from. Every fixture job carried the same value in its link and in its reference field, so the cases passed whichever was read. A job whose link and field differ is known by the link; one whose link is on another site, by the field; one with neither is left out and the read is not whole.
# 11 | maintainer@emeraldcoastsystemsgroup.com | A job the board lists but the reader cannot store keeps the read from being whole, so the stored copy is not closed: a Randstad job with no title or no link, a Talentsoft card that is not the card the reader knows (a field missing, a date it cannot read, no title link), a Motion Recruitment job link with no card of its own. A Talentsoft card that shows "/" for a place is still counted and not kept. The card with a field missing moves out of the first Talentsoft case, which had expected such a read to be whole.
# 10 | maintainer@emeraldcoastsystemsgroup.com | A Motion Recruitment page that shows one job twice does not shift the pages after it: the next page is asked for after twenty jobs, not twenty-one links.
# 9 | maintainer@emeraldcoastsystemsgroup.com | A read that a redirect takes to another host, or through one, is cut there and is not whole, even when what comes back is a listing in the board's own shape; a redirect that stays on the board's host is followed. The fixture server can now answer with the address a read ended at and the addresses it passed through.
# 8 | maintainer@emeraldcoastsystemsgroup.com | A Randstad total that is not a whole number, or a creation time no calendar holds, does not stop the read: the total is unknown, so the board is read and not called whole, and the job is kept with no date.
# 7 | maintainer@emeraldcoastsystemsgroup.com | A Talentsoft count written with a separator ("1,234 job opening (s)") is read as 1,234 and not as 1, so one page of twelve is not a whole board; a count that is not a clean whole number is unknown.
# 6 | maintainer@emeraldcoastsystemsgroup.com | A tile outside the United States whose place leaves its country out ("Perth, WA, 6000" in AU, "Chennai, TN" in IN) is not filed under a US state either.
# 5 | maintainer@emeraldcoastsystemsgroup.com | A link that only resembles a board names no reader: another path that begins the same way (/jobsearch, /jobs-at-randstad, /tech-jobsearch), another subdomain of the employer, and the Talentsoft vendor's own hosts (www, support, help).
# 4 | maintainer@emeraldcoastsystemsgroup.com | The tile fixture carries the line breaks and indentation the live page has inside each title link. Without them the contract passed while the live read stored all 71 of Syntax's jobs as not remote, 50 of them beside a place that said Remote.
# 3 | maintainer@emeraldcoastsystemsgroup.com | Hold the SuccessFactors reader to the tile list Syntax's site served on 2026-11-11: each job takes the place its tile shows, without its postal code; the workplace the tile names decides whether it is remote; a job the tile says is outside the United States is never given a place the engine files under a US state; and a table list, or a tile with no country field, is read as it was.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Hold the Talentsoft reader to the list pages Akkodis's board served on 2026-11-11: a job is known by the number that ends its link and keeps the place its card shows, a card with "/" for a place or with a field missing is counted and not kept, and the board is read twelve at a time to the count it states.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Hold the Randstad USA and Motion Recruitment readers to the pages those boards served on 2026-11-11, cut down to a few jobs with every contact name, phone number and mail address left out. A Randstad job is known by the job reference in its link and not by the line-of-business number before it; a Motion Recruitment job by the number that ends its link, with the card's heading alone as its title. Each board is read a page at a time to the count it states: a whole read closes a job that left, and a refused, short or uncounted one closes nothing. Read through the engine's own HTTP layer and one-source pull into real SQLite. No network.
"""Boards read from their own listing pages, against pages in the shapes the boards serve, through the pull's one-source path."""
import atexit
import contextlib
import html
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
STORE = tempfile.TemporaryDirectory(prefix='career-listed-boards-')
atexit.register(STORE.cleanup)  # Registered before the engine loads, so it runs after the engine's own exit handler.
sys.path.insert(0, str(ROOT / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
os.environ['JOBHUNTER_DATA'] = STORE.name
for name in ('JOBHUNTER_DB', 'JOBHUNTER_CORPUS_DB', 'JOBHUNTER_USER_DB', 'DATABASE_URL'):
    os.environ.pop(name, None)
import requests
from jobhunter import ats, cli, db, geo, resolve, webscrape

STAFFING = 'jobs.staffing.example'
RANDSTAD = f'https://{STAFFING}/jobs/'
TECH = 'tech.staffing.example'
MOTION = f'https://{TECH}/tech-jobs'
BOARD = 'fixture.talent-soft.com'
TILES = 'careers.tiles.example'


def randstad_hit(reference, title, city, state, *, line=310, remote=False):
    """One job as Randstad USA's page carries it in window.__ROUTE_DATA__, cut down to what a list shows. The live
    answer also names a recruiter with a phone number and a mail address in each job; those fields are left out."""
    slug = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')
    return {'id': f'doc-{reference}', 'title': title, 'type': 'Temporary', 'createdDate': 1794376192613,
            'opCoName': 'Randstad@Work', 'lobId': line, 'lobName': 'Randstad@Work', 'atsReference': reference,
            'isRemote': remote, 'jobLocation': {'city': city, 'state': None, 'stateAbbreviation': state, 'postalCode': None},
            'detailsUrl': f'https://{STAFFING}/jobs/{line}/{reference}/{slug}_{city.lower().replace(" ", "-")}/',
            'applyUrl': f'https://{STAFFING}/jobs/apply/{line}/{reference}/', 'employmentType': 'Full-time', 'isInternal': None}


def randstad_own(reference, title, city, state):
    """One of Randstad's own vacancies: the board lists it with a link to another site, and without `isRemote`."""
    hit = randstad_hit(reference, title, city, state, line=1027)
    del hit['isRemote']
    slug = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')
    return {**hit, 'opCoName': 'Randstad Careers', 'lobName': 'Randstad Careers', 'isInternal': True,
            'detailsUrl': f'https://careers.staffing.example/jobs/{reference}/{slug}?sid=11117'}


def randstad_page(hits, total, page=1):
    data = {'regionCitiesAggregation': [], 'titleSuggestions': [], 'startingPage': page,
            'searchResults': {'googleSearchResultId': '', 'totalSize': total, 'hits': hits, 'noIndex': False}}
    return ('<html><body><div id="root"></div><a href="/jobs/remote/">remote jobs</a><script type="text/javascript">\n'
            f'  window.__ROUTE_DATA__ = {json.dumps(data)};\n  window.__SEO_DATA__ = {{"meta_title":null}};</script></body></html>')


def randstad_board(hits, *, total=None, refuse=None, moved=False, per_page=30):
    """Randstad USA's listing: /jobs/ and then /jobs/page-N/, thirty jobs a page, with the total in each page."""
    served = {}

    def board(host, path, _query):
        if host != STAFFING or not path.startswith('/jobs/'):
            return None
        page = int(path.split('page-')[1].strip('/')) if 'page-' in path else 1
        if page == refuse:
            return 403, '<html>Forbidden</html>'
        served[page] = served.get(page, 0) + 1
        # Jobs that moved while the board was read: the first time, a later page shows the first page's jobs again.
        again = moved and served[page] == 1 and page > 1
        rows = hits[:per_page] if again else hits[(page - 1) * per_page:page * per_page]
        return 200, randstad_page(rows, len(hits) if total is None else total, page)
    return board


def motion_card(number, title, place, workplace, kind='contract', pay='$80/hr - $90/hr'):
    """One job as Motion Recruitment's page lists it: the whole card is the link."""
    city = place.split(',')[0].strip().lower().replace(' ', '-')
    slug = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')
    return f'''<a href="/tech-jobs/{city}/{kind}/{slug}/{number}"><h2 class="JobItem_module_title">{html.escape(title)}</h2>
 <div class="JobItem_module_jobDetailsSection"><p>{html.escape(place)}</p><div class="JobItem_module_jobDetailsWrapper"><b>{workplace}</b>
 <div class="JobDetailsItem_module_jobDetails"><p class="JobDetailsItem_module_jobDetailsText">Contract</p></div>
 <div class="JobDetailsItem_module_jobDetails"><p class="JobDetailsItem_module_jobDetailsText">{pay}</p></div></div></div>
 <p class="JobItem_module_briefDescription JobItem_module_hidden">Job Title: {html.escape(title)}
Location: {html.escape(place)}

Job Summary
We are seeking a strategic and technically s...</p><hr class="JobItem_module_hr"/></a>'''


def motion_page(cards, total, start):
    """The page states its total only in the data its script carries, where every quote is escaped."""
    stated = '' if total is None else (
        '<script>self.__next_f.push([1,"7:[[\\"$\\",\\"$L1b\\",null,{\\"title\\":\\"Find and Apply for Tech Jobs\\",'
        f'\\"dataSet\\":{{\\"total\\":{total},\\"start\\":{start},\\"count\\":20,\\"data\\":[]}}}}]]"])</script>')
    menu = (f'<a class="MenuNav_nav-dropdown__title__Q8QnH" href="https://{TECH}/tech-jobs/contract">Contract Jobs</a>'
            f'<a href="https://{TECH}/tech-jobs/cybersecurity">Cybersecurity</a>')
    return f'<html><body>{menu}<div>{"".join(cards)}</div><a href="?start={start + 20}">2</a>{stated}</body></html>'


def motion_board(cards, *, total=None, counted=True, refuse=None, twice=None, per_page=20):
    """Motion Recruitment's listing: /tech-jobs and then /tech-jobs?start=N, twenty jobs a page. `twice` names a job
    the first page shows a second time."""
    def board(host, path, query):
        if host != TECH or path != '/tech-jobs':
            return None
        start = int(query.get('start', 0))
        if start == refuse:
            return 503, 'busy'
        shown = cards[start:start + per_page] + ([cards[twice]] if twice is not None and start == 0 else [])
        return 200, motion_page(shown, (len(cards) if total is None else total) if counted else None, start)
    return board


def talentsoft_card(number, title, place, *, contract='Permanent contract', date='10/11/2026', items=None):
    """One vacancy as a Talentsoft list shows it: a title link, then category, contract, place and date."""
    slug = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')
    listed = ''.join(f'<li>{html.escape(text)}</li>' for text in (items if items is not None else ['OPERATIONS', contract, place, date]))
    return f'''<div class="ts-offer-card Layer" onclick="location.href='/job/job-{slug}_{number}.aspx';" title="">
 <h3 class="ts-offer-card__title"><a class="ts-offer-card__title-link" href="/job/job-{slug}_{number}.aspx"
  title="{html.escape(title)} (Ref. : 2026-{number}) - ENGINEERING/PRODUCTION">{html.escape(title)}</a></h3>
 <span class="ts-offer-card__favorite-link lienfavori" data-action="add" data-post-uri="/Basket/Add?offerId={number}&amp;lcid=2057"
  data-reference="2026-{number}" title="Add this job opening to selection {html.escape(title)} (2026-{number})"></span>
 <div class="ts-offer-card-content offerContent"><ul class="ts-offer-card-content__list">{listed}</ul></div></div>'''


def talentsoft_page(listed, total, page):
    return f'''<html><head><title>AKKODIS - Search results({total} vacancies/{page})-Display all</title></head><body>
 <a class="ts-my-shortcuts-jobs-basket__link" href="/job/my-basket-of-jobs.aspx">Selection: 0 job opening(s)</a>
 <a class="ts-ol-criterias-display-mode-link" href="/job/list-of-jobs.aspx?mode=list">List</a>
 <div class="ts-ol-pagination ts-ol-pagination--top"><div class="ts-ol-pagination__title resultat">Number of results:
 <span class="gras" id="ctl00_ctl00_corpsRoot_corps_Pagination_TotalOffers">{total} job opening (s)</span></div>
 <ul class="ts-ol-pagination-list PrecSuivant"><li class="ts-ol-pagination-list-item"><a class="ts-ol-pagination-list-item__link"
  href="https://{BOARD}/job/list-of-jobs.aspx?page={page + 1}&amp;LCID=2057">{page + 1}</a></li></ul></div>
 <div class="ts-offer-list">{"".join(listed)}</div></body></html>'''


def talentsoft_board(listed, *, total=None, refuse=None, per_page=12):
    """A Talentsoft board's list: /job/list-of-jobs.aspx?page=N&LCID=2057, twelve vacancies a page."""
    def board(host, path, query):
        if host != BOARD or path != '/job/list-of-jobs.aspx' or query.get('LCID') != '2057':
            return None
        page = int(query['page'])
        if page == refuse:
            return 403, '<html>Forbidden</html>'
        return 200, talentsoft_page(listed[(page - 1) * per_page:page * per_page], len(listed) if total is None else total, page)
    return board


def sf_tile(number, title, location, country, workplace):
    """One job as a SuccessFactors tile list shows it: the title link once for each screen width, and under the
    first the date, the country, the board's own workplace field and the location, each with its label. The title
    sits on a line of its own inside the link, indented, as the live page has it."""
    link = f"/job/{re.sub(r'[^A-Za-z0-9]+', '-', title).strip('-')}/{number}/"
    shown = [('date', 'Date', 'Nov 10, 2026'), ('country', 'Country/Region', country),
             ('customfield1', 'Workplace Type', workplace), ('location', 'Location', location)]

    def section(view, hidden, kinds):
        fields = ''.join(
            f'<div class="section-field {kind} fontcolor5f573480f71de7c1" id="job-{number}-{view}-section-{kind}">'
            f'<span class="section-label fontcolor5f573480f71de7c1" id="job-{number}-{view}-section-{kind}-label">{label}</span>'
            f'<div id="job-{number}-{view}-section-{kind}-value">{html.escape(value)}</div></div>'
            for kind, label, value in shown if kind in kinds and value is not None)
        return f'''<div class="col-md-12 sub-section sub-section-{view} {hidden}"><div class="oneline"><div class="tiletitle">
 <span class="sr-only">Title</span><span aria-level="2" class="col-md-12 section-title title" role="heading">
 <a class="jobTitle-link fontcolorb4005d4b95a11ce7" data-focus-tile=".job-id-{number}" href="{link}">
                    {html.escape(title)}
                </a></span>
 </div></div><div class="oneline">{fields}</div></div>'''
    return f'''<li class="job-tile job-id-{number} job-row-index-1" data-url="{link}"><div class="job-tile-cell"><div class="row job job-row">
 {section('desktop', 'hidden-xs hidden-sm', ('date', 'country', 'customfield1', 'location'))}
 {section('tablet', 'hidden-xs hidden-md hidden-lg', ('customfield1',))}{section('mobile', 'visible-xs', ())}</div></div></li>'''


def sf_board(listing):
    """A SuccessFactors career site whose /search/ page lists every job on its first page."""
    def board(host, path, query):
        if host != TILES or path != '/search/':
            return None
        return 200, (f'<html><body><span class="paginationLabel">Showing 1 to 25 of 71 Jobs</span>{listing}</body></html>'
                     if query.get('startrow') == '0' else '<html><body><div class="noresults">No more jobs</div></body></html>')
    return board


SYNTAX = [sf_tile(1449494000, 'Power Platform Consultant', 'Morrisville, NC, US, 27560', 'US', 'Remote'),
          sf_tile(1438551500, '(Junior) SAP Basis Administrator (m/f/d)', 'Weinheim, BW, DE, 69469', 'DE', 'Hybrid'),
          sf_tile(1401267800, 'Advisory Technical Architect', 'San Andres Cholula, PUE, MX, 72830', 'MX', 'Remote'),
          sf_tile(1449422200, 'Associate System Analyst, Managed Services', 'Mumbai, MH, IN, 400093', 'IN', 'Office'),
          sf_tile(1440000001, 'VP Delivery - Natural Resources', 'Thornhill, ON, CA, L3T 7W8', 'CA', 'Hybrid'),
          sf_tile(1440000002, 'Manager Conseil', 'Paris, 75, FR, 75009', 'FR', 'Hybrid')]


@contextlib.contextmanager
def served(*boards):
    """Answer the engine's HTTP session as the boards do, and record each request. Nothing leaves the machine."""
    asked = []

    def answer(_session, _method, url, **kwargs):
        parts = urlsplit(url)
        query = {key: values[0] for key, values in parse_qs(parts.query, keep_blank_values=True).items()}
        query.update({key: str(value) for key, value in (kwargs.get('params') or {}).items()})
        asked.append((parts.netloc, parts.path, query))
        found = next((reply for reply in (board(parts.netloc, parts.path, query) for board in boards) if reply), None)
        response = requests.Response()
        # A board answers (status, body). A third value is the address the read ended at after redirects, and any
        # after it are addresses it passed through on the way.
        response.status_code, body, *moved = found or (404, '<html>Not found</html>')
        response.url = moved[0] if moved else url
        for address in ([url] + moved[1:] if moved else []):
            hop = requests.Response()
            hop.status_code, hop.url = 301, address
            response.history.append(hop)
        response.headers['Content-Type'] = 'text/html; charset=utf-8'
        response._content = body.encode()
        return response

    with patch.object(requests.sessions.Session, 'request', answer), patch('time.sleep', lambda _seconds: None):
        yield asked


def numbered(count, first=1):
    return [randstad_hit(f'11{n:05d}-{n % 9}', f'Forklift Operator {n}', 'Mebane', 'NC') for n in range(first, first + count)]


def cards(count, first=1):
    return [motion_card(890000 + n, f'Data Analyst {n}', 'Irving, TX', 'Onsite') for n in range(first, first + count)]


def vacancies(count, first=1):
    return [talentsoft_card(35000 + n, f'Design Release Engineer {n}', 'Torino') for n in range(first, first + count)]


class RandstadBoard(unittest.TestCase):
    def test_a_job_is_known_by_the_reference_in_its_link_and_not_the_number_before_it(self):
        hits = [randstad_hit('AB_5146544', 'Industrial Electrician', 'Bolingbrook', 'IL', line=309),
                randstad_hit('1182454-6', 'Production Associate - Now Hiring', 'Mebane', 'NC'),
                randstad_own('53352', 'Site Manager', 'Omaha', 'NE'),
                {**randstad_own('53485', 'Head of PTS', 'United States', None), 'isRemote': True}]
        with served(randstad_board(hits)) as asked:
            rows = ats.fetch('randstad', RANDSTAD)
        self.assertEqual(asked, [(STAFFING, '/jobs/', {})])
        self.assertEqual([row['ats_job_id'] for row in rows], ['AB_5146544', '1182454-6', '53352', '53485'])
        first = rows[0]
        self.assertEqual(first['url'], f'https://{STAFFING}/jobs/309/AB_5146544/industrial-electrician_bolingbrook/')
        # The page-list reader's rule reads the first number of that link, which is the line of business.
        self.assertEqual(ats.HtmlList._JOB.search(first['url']).group(1), '309')
        self.assertEqual((first['title'], first['location'], first['remote'], first['posted_at'], first['department']),
                         ('Industrial Electrician', 'Bolingbrook, IL', 0, '2026-11-11', 'Randstad@Work'))
        self.assertEqual(rows[2]['url'], 'https://careers.staffing.example/jobs/53352/site-manager?sid=11117')
        self.assertEqual((rows[3]['location'], rows[3]['remote']), ('United States / Remote', 1))
        self.assertEqual((rows.complete, rows.reason), (True, None))

    def test_the_reference_is_the_one_in_the_link_and_the_field_only_when_the_link_is_on_another_site(self):
        on_site = {**randstad_hit('LINK-77', 'Machine Operator', 'Clovis', 'CA'), 'atsReference': 'FIELD-77'}
        off_site = {**randstad_own('53352', 'Site Manager', 'Omaha', 'NE'),
                    'detailsUrl': 'https://careers.staffing.example/jobs/99999/site-manager?sid=11117'}
        with served(randstad_board([on_site, off_site])):
            rows = ats.fetch('randstad', RANDSTAD)
        self.assertEqual([(row['ats_job_id'], row['url']) for row in rows],
                         [('LINK-77', f'https://{STAFFING}/jobs/310/LINK-77/machine-operator_clovis/'),
                          ('53352', 'https://careers.staffing.example/jobs/99999/site-manager?sid=11117')])
        self.assertEqual((rows.complete, rows.reason), (True, None))
        no_link = {key: value for key, value in on_site.items() if key != 'detailsUrl'}
        other_page = {**on_site, 'detailsUrl': f'https://{STAFFING}/jobs/remote/'}
        no_field = {**off_site, 'atsReference': None}
        not_a_link = {**off_site, 'detailsUrl': 'javascript:void(0)'}
        for nameless in (no_link, other_page, no_field, not_a_link):
            with served(randstad_board([off_site, nameless])):
                rows = ats.fetch('randstad', RANDSTAD)
            self.assertEqual(([row['ats_job_id'] for row in rows], rows.complete, rows.reason),
                             (['53352'], False, 'listing_row_invalid'), nameless.get('detailsUrl'))

    def test_the_board_is_read_a_page_at_a_time_to_the_count_it_states(self):
        with served(randstad_board(numbered(65))) as asked:
            rows = ats.fetch('randstad', RANDSTAD)
        self.assertEqual([path for _host, path, _query in asked], ['/jobs/', '/jobs/page-2/', '/jobs/page-3/'])
        self.assertEqual((len(rows), len({row['ats_job_id'] for row in rows}), rows.complete, rows.reason), (65, 65, True, None))

    def test_jobs_that_moved_between_pages_are_read_on_a_second_pass(self):
        with served(randstad_board(numbered(65), moved=True)) as asked:
            rows = ats.fetch('randstad', RANDSTAD)
        self.assertEqual([path for _host, path, _query in asked],
                         ['/jobs/', '/jobs/page-2/', '/jobs/page-3/', '/jobs/', '/jobs/page-2/', '/jobs/page-3/'])
        self.assertEqual((len(rows), len({row['ats_job_id'] for row in rows}), rows.complete), (65, 65, True))

    def test_one_job_in_two_hundred_may_go_unseen_and_no_more(self):
        with served(randstad_board(numbered(398), total=400)) as asked:
            near = ats.fetch('randstad', RANDSTAD)
        self.assertEqual((len(near), near.complete, len(asked)), (398, True, 14))
        with served(randstad_board(numbered(397), total=400)) as asked:
            short = ats.fetch('randstad', RANDSTAD)
        self.assertEqual((len(short), short.complete, short.reason, len(asked)), (397, False, 'completion_unverified', 28))

    def test_a_refused_page_or_an_answer_that_is_not_the_listing_is_not_whole(self):
        with served(randstad_board(numbered(65), refuse=2)) as asked:
            refused = ats.fetch('randstad', RANDSTAD)
        self.assertEqual((len(refused), refused.complete, refused.reason, len(asked)), (30, False, 'http_refused', 2))
        # A site's browser check answers with a page that holds no listing.
        with served(lambda host, _path, _query: (202, '') if host == STAFFING else None):
            checked = ats.fetch('randstad', RANDSTAD)
        self.assertEqual((list(checked), checked.complete, checked.reason), ([], False, 'completion_unverified'))
        with served(randstad_board([])):
            empty = ats.fetch('randstad', RANDSTAD)
        self.assertEqual((list(empty), empty.complete, empty.reason), ([], False, 'empty_unconfirmed'))


    def test_a_total_that_is_not_a_whole_number_or_a_time_no_calendar_holds_does_not_stop_the_read(self):
        for total in ('many', {'value': 35}, True, 12.5, -1):
            with served(randstad_board(numbered(35), total=total)) as asked:
                rows = ats.fetch('randstad', RANDSTAD)
            self.assertEqual((len(rows), rows.complete, rows.reason), (35, False, 'completion_unverified'), total)
            self.assertEqual([path for _host, path, _query in asked], ['/jobs/', '/jobs/page-2/', '/jobs/page-3/'], total)
        with served(randstad_board(numbered(35), total='35')):
            self.assertEqual(ats.fetch('randstad', RANDSTAD).complete, True)
        late = {**randstad_hit('1190001-1', 'Night Shift Supervisor', 'Reno', 'NV'), 'createdDate': 10 ** 20}
        worded = {**randstad_hit('1190002-1', 'Day Shift Supervisor', 'Reno', 'NV'), 'createdDate': 'yesterday'}
        with served(randstad_board([late, worded])):
            rows = ats.fetch('randstad', RANDSTAD)
        self.assertEqual([(row['ats_job_id'], row['posted_at']) for row in rows], [('1190001-1', None), ('1190002-1', None)])
        self.assertEqual((rows.complete, rows.reason), (True, None))


    def test_a_read_that_a_redirect_takes_off_the_boards_host_is_cut_there_and_is_not_whole(self):
        jobs = numbered(65)
        board = randstad_board(jobs)

        def sent_away(host, path, query):
            # Page 2 is answered by another host, with a listing in the board's own shape.
            return (*board(host, path, query), f'https://jobs.elsewhere.example{path}') if path == '/jobs/page-2/' else None
        with served(sent_away, board) as asked:
            rows = ats.fetch('randstad', RANDSTAD)
        self.assertEqual((len(rows), rows.complete, rows.reason, len(asked)), (30, False, 'unexpected_redirect', 2))

        def by_way_of(host, path, query):
            # The first page comes back on the board's host, by way of another one.
            return (*board(host, path, query), RANDSTAD, 'https://sso.elsewhere.example/check') if path == '/jobs/' else None
        with served(by_way_of, board) as asked:
            rows = ats.fetch('randstad', RANDSTAD)
        self.assertEqual((list(rows), rows.complete, rows.reason, len(asked)), ([], False, 'unexpected_redirect', 1))

        def same_host(host, path, query):
            return (*board(host, path, query), f'https://{STAFFING}/jobs/?sort=newest') if path == '/jobs/' else None
        with served(same_host, board):
            rows = ats.fetch('randstad', RANDSTAD)
        self.assertEqual((len(rows), rows.complete, rows.reason), (65, True, None))


    def test_a_job_the_page_lists_but_the_reader_cannot_store_keeps_the_read_from_being_whole(self):
        jobs = numbered(35)
        untitled = {**jobs[4], 'title': None}
        unlinked = {key: value for key, value in jobs[4].items() if key != 'detailsUrl'}
        for broken in (untitled, unlinked, 'not a job'):
            with served(randstad_board(jobs[:4] + [broken] + jobs[5:])) as asked:
                rows = ats.fetch('randstad', RANDSTAD)
            self.assertEqual((len(rows), rows.complete, rows.reason, len(asked)), (34, False, 'listing_row_invalid', 2), broken)


class MotionRecruitmentBoard(unittest.TestCase):
    def test_a_job_is_known_by_the_number_that_ends_its_link_and_its_title_is_the_heading_alone(self):
        listed = [motion_card(885266, 'Product Manager – Loan Servicing Contract Hybrid SF', 'San Francisco, CA', 'Hybrid'),
                  motion_card(894609, 'SOC Analyst (Remote EST) - Splunk/AWS/Sentinel', 'Boston, MA', '100% Remote', pay='$25/hr - $45/hr'),
                  motion_card(894661, 'Senior Security Engineer / Hybrid in Scottsdale', 'Scottsdale , Arizona', 'Hybrid', kind='direct-hire'),
                  motion_card(894214, 'Project Manager III', 'Vancouver , British Columbia', 'Onsite')]
        with served(motion_board(listed)) as asked:
            rows = ats.fetch('motionrecruitment', MOTION)
        self.assertEqual(asked, [(TECH, '/tech-jobs', {})])
        self.assertEqual([row['ats_job_id'] for row in rows], ['885266', '894609', '894661', '894214'])
        first = rows[0]
        link = '/tech-jobs/san-francisco/contract/product-manager-loan-servicing-contract-hybrid-sf/885266'
        self.assertEqual(first['url'], f'https://{TECH}{link}')
        # No reader matched this form: neither the page reader's job-link rule nor the page-list reader's.
        self.assertIsNone(webscrape._JOB_HREF.search(link))
        self.assertIsNone(ats.HtmlList._JOB.search(link))
        self.assertEqual((first['title'], first['location'], first['remote']),
                         ('Product Manager – Loan Servicing Contract Hybrid SF', 'San Francisco, CA', 0))
        self.assertEqual((rows[1]['location'], rows[1]['remote']), ('Boston, MA / Remote', 1))
        self.assertEqual([rows[2]['location'], rows[3]['location']], ['Scottsdale, Arizona', 'Vancouver, British Columbia'])
        self.assertEqual((rows.complete, rows.reason), (True, None))

    def test_the_board_is_read_twenty_at_a_time_to_the_count_its_page_states(self):
        with served(motion_board(cards(45))) as asked:
            rows = ats.fetch('motionrecruitment', MOTION)
        self.assertEqual([query for _host, _path, query in asked], [{}, {'start': '20'}, {'start': '40'}])
        self.assertEqual((len(rows), rows.complete, rows.reason), (45, True, None))

    def test_a_board_that_states_no_count_or_refuses_a_page_is_read_but_not_whole(self):
        with served(motion_board(cards(45), counted=False)) as asked:
            uncounted = ats.fetch('motionrecruitment', MOTION)
        self.assertEqual([query for _host, _path, query in asked], [{}, {'start': '20'}, {'start': '40'}, {'start': '60'}])
        self.assertEqual((len(uncounted), uncounted.complete, uncounted.reason), (45, False, 'completion_unverified'))
        with served(motion_board(cards(45), refuse=20)):
            refused = ats.fetch('motionrecruitment', MOTION)
        self.assertEqual((len(refused), refused.complete, refused.reason), (20, False, 'http_refused'))


    def test_a_job_shown_twice_on_a_page_does_not_shift_the_pages_after_it(self):
        with served(motion_board(cards(45), twice=3)) as asked:
            rows = ats.fetch('motionrecruitment', MOTION)
        self.assertEqual([query for _host, _path, query in asked], [{}, {'start': '20'}, {'start': '40'}])
        self.assertEqual((len(rows), rows.complete, rows.reason), (45, True, None))


    def test_a_job_link_with_no_card_of_its_own_keeps_the_read_from_being_whole(self):
        listed = cards(25)
        # A second, bare link to a job that has its card changes nothing.
        again = listed[:3] + ['<a href="/tech-jobs/irving/contract/data-analyst-2/890002">Apply</a>'] + listed[3:]
        with served(motion_board(again, total=25, per_page=21)):
            rows = ats.fetch('motionrecruitment', MOTION)
        self.assertEqual((len(rows), rows.complete, rows.reason), (25, True, None))
        # A link to a job with no card, or a card with nothing in its heading, is a job the reader cannot store.
        for bare in ('<a href="/tech-jobs/irving/contract/site-reliability-engineer/899001">Apply</a>',
                     motion_card(899001, 'Site Reliability Engineer', 'Irving, TX', 'Onsite').replace('>Site Reliability Engineer</h2>', '></h2>')):
            with served(motion_board(listed[:3] + [bare] + listed[3:], total=26, per_page=21)):
                rows = ats.fetch('motionrecruitment', MOTION)
            self.assertEqual((len(rows), rows.complete, rows.reason), (25, False, 'listing_row_invalid'), bare[:60])


    def test_a_link_to_another_host_is_not_one_of_the_boards_jobs(self):
        listed = cards(25)
        in_full = listed[1].replace('href="/tech-jobs/', f'href="https://{TECH}/tech-jobs/')
        foreign = motion_card(890099, 'Data Analyst 99', 'Irving, TX', 'Onsite').replace(
            'href="/tech-jobs/', 'href="https://jobs.elsewhere.example/tech-jobs/')
        with served(motion_board([listed[0], in_full, foreign] + listed[2:], total=25, per_page=21)):
            rows = ats.fetch('motionrecruitment', MOTION)
        self.assertEqual([row['url'] for row in rows[:2]], [f'https://{TECH}/tech-jobs/irving/contract/data-analyst-1/890001',
                                                            f'https://{TECH}/tech-jobs/irving/contract/data-analyst-2/890002'])
        self.assertNotIn('890099', [row['ats_job_id'] for row in rows])
        self.assertEqual((len(rows), rows.complete, rows.reason), (25, True, None))


class TalentsoftBoard(unittest.TestCase):
    def test_a_vacancy_keeps_the_place_its_card_shows_and_one_with_no_place_is_counted_but_not_kept(self):
        listed = [talentsoft_card(35691, 'Junior Brake Systems Engineer - Automotive', 'Torino', contract='Apprenticeship'),
                  talentsoft_card(35697, 'Electrical Supervisor', 'Soyo, Angola', contract='Fixed term contract'),
                  talentsoft_card(26219, 'Project Manager - Technology Transfer - Pharma', 'Pomezia/remote'),
                  talentsoft_card(35701, 'MS&T Process Scientist - Pharma', 'Remote'),
                  talentsoft_card(35269, 'Powertrain Simulation & Structural Dynamics Engineer', '/'),
                  talentsoft_card(34778, 'Project Engineer Launch Excellence - Life Sciences', 'Noordkustlaan 16, 1702 Dilbeek', date='09/11/2026')]
        with served(talentsoft_board(listed)) as asked:
            rows = ats.fetch('talentsoft', BOARD)
        self.assertEqual(asked, [(BOARD, '/job/list-of-jobs.aspx', {'page': '1', 'LCID': '2057'})])
        self.assertEqual([row['ats_job_id'] for row in rows], ['35691', '35697', '26219', '35701', '34778'])
        first = rows[0]
        self.assertEqual(first['url'], f'https://{BOARD}/job/job-junior-brake-systems-engineer-automotive_35691.aspx')
        self.assertEqual((first['title'], first['location'], first['remote'], first['posted_at'], first['department']),
                         ('Junior Brake Systems Engineer - Automotive', 'Torino', 0, '2026-11-10', 'OPERATIONS'))
        self.assertEqual([(row['location'], row['remote']) for row in rows[1:4]],
                         [('Soyo, Angola', 0), ('Pomezia/remote', 1), ('Remote', 1)])
        self.assertEqual((rows[3]['title'], rows[4]['posted_at']), ('MS&T Process Scientist - Pharma', '2026-11-09'))
        # All six vacancies the board states were seen, so the read is whole though one shows no place to keep.
        self.assertEqual((rows.complete, rows.reason), (True, None))

    def test_the_board_is_read_twelve_at_a_time_to_the_count_it_states(self):
        with served(talentsoft_board(vacancies(30))) as asked:
            rows = ats.fetch('talentsoft', BOARD)
        self.assertEqual([query for _host, _path, query in asked],
                         [{'page': str(page), 'LCID': '2057'} for page in (1, 2, 3)])
        self.assertEqual((len(rows), rows.complete, rows.reason), (30, True, None))
        with served(talentsoft_board(vacancies(30), refuse=2)):
            refused = ats.fetch('talentsoft', BOARD)
        self.assertEqual((len(refused), refused.complete, refused.reason), (12, False, 'http_refused'))
        with served(talentsoft_board(vacancies(20), total=60)):
            short = ats.fetch('talentsoft', BOARD)
        self.assertEqual((len(short), short.complete, short.reason), (20, False, 'completion_unverified'))


    def test_a_count_written_with_a_separator_is_read_in_full_and_one_that_is_not_a_number_is_unknown(self):
        # One page of twelve under "1,234 job opening (s)": read as 1, that page would be a whole board.
        for stated in ('1,234', '1 234', '1.234'):
            with served(talentsoft_board(vacancies(12), total=stated)):
                short = ats.fetch('talentsoft', BOARD)
            self.assertEqual((len(short), short.complete, short.reason), (12, False, 'completion_unverified'), stated)
        with served(talentsoft_board(vacancies(1234), total='1,234')) as asked:
            whole = ats.fetch('talentsoft', BOARD)
        self.assertEqual((len(whole), whole.complete, whole.reason, len(asked)), (1234, True, None, 103))
        for unclear in ('1,23', '12 or 13', 'many'):
            with served(talentsoft_board(vacancies(12), total=unclear)):
                unknown = ats.fetch('talentsoft', BOARD)
            self.assertEqual((len(unknown), unknown.complete, unknown.reason), (12, False, 'completion_unverified'), unclear)


    def test_a_card_the_reader_does_not_know_keeps_the_read_from_being_whole_and_one_with_no_place_does_not(self):
        listed = vacancies(13)
        short = talentsoft_card(35005, 'Design Release Engineer 5', '', items=['OPERATIONS', 'Permanent contract', '10/11/2026'])
        undated = talentsoft_card(35005, 'Design Release Engineer 5', 'Torino', date='Yesterday')
        unlinked = listed[4].replace('ts-offer-card__title-link', 'ts-offer-card__title-text')
        for odd in (short, undated, unlinked):
            with served(talentsoft_board(listed[:4] + [odd] + listed[5:])) as asked:
                rows = ats.fetch('talentsoft', BOARD)
            self.assertEqual((len(rows), rows.complete, rows.reason, len(asked)), (12, False, 'listing_row_invalid', 2), odd[:80])
        placeless = talentsoft_card(35005, 'Design Release Engineer 5', '/')
        with served(talentsoft_board(listed[:4] + [placeless] + listed[5:])):
            rows = ats.fetch('talentsoft', BOARD)
        self.assertEqual((len(rows), rows.complete, rows.reason), (12, True, None))


    def test_a_vacancys_link_is_resolved_against_the_board_and_kept_only_on_the_boards_host(self):
        listed = vacancies(13)
        in_full = listed[1].replace('href="/job/', f'href="https://{BOARD}/job/')
        elsewhere = listed[2].replace('href="/job/', 'href="//jobs.elsewhere.example/job/')
        with served(talentsoft_board([listed[0], in_full, elsewhere] + listed[3:])):
            rows = ats.fetch('talentsoft', BOARD)
        self.assertEqual([row['url'] for row in rows[:2]], [f'https://{BOARD}/job/job-design-release-engineer-1_35001.aspx',
                                                            f'https://{BOARD}/job/job-design-release-engineer-2_35002.aspx'])
        self.assertEqual({urlsplit(row['url']).hostname for row in rows}, {BOARD})
        self.assertNotIn('35003', [row['ats_job_id'] for row in rows])
        self.assertEqual((len(rows), rows.complete, rows.reason), (12, False, 'listing_row_invalid'))


class SuccessFactorsTileList(unittest.TestCase):
    def test_each_job_takes_the_place_its_tile_shows_and_none_outside_the_country_is_filed_under_a_state(self):
        with served(sf_board(f'<ul class="container job-list">{"".join(SYNTAX)}</ul>')) as asked:
            rows = ats.SuccessFactors.fetch(TILES)
        self.assertEqual([(path, query['startrow']) for _host, path, query in asked], [('/search/', '0'), ('/search/', '25')])
        # A tile links its job three times; the job is read once, under the id it always had.
        self.assertEqual([row['ats_job_id'] for row in rows],
                         ['/job/Power-Platform-Consultant/1449494000/', '/job/Junior-SAP-Basis-Administrator-m-f-d/1438551500/',
                          '/job/Advisory-Technical-Architect/1401267800/', '/job/Associate-System-Analyst-Managed-Services/1449422200/',
                          '/job/VP-Delivery-Natural-Resources/1440000001/', '/job/Manager-Conseil/1440000002/'])
        self.assertEqual([(row['location'], row['remote']) for row in rows],
                         [('Morrisville, NC, US / Remote', 1), ('Weinheim', 0), ('San Andres Cholula, PUE, MX / Remote', 1),
                          ('Mumbai', 0), ('Thornhill', 0), ('Paris, 75, FR', 0)])
        self.assertEqual([geo.state_of(row['location']) for row in rows], ['NC', None, None, None, None, None])

    def test_a_tile_outside_the_country_whose_place_leaves_the_country_out_is_not_filed_under_a_state(self):
        listed = [sf_tile(1450000001, 'Mine Planner', 'Perth, WA, 6000', 'AU', 'Office'),
                  sf_tile(1450000002, 'Support Analyst', 'Chennai, TN', 'IN', 'Office'),
                  sf_tile(1450000003, 'Site Lead', 'Toronto, ON', 'CA', 'Hybrid'),
                  sf_tile(1450000004, 'Comptable', 'Lyon', 'FR', 'Office'),
                  sf_tile(1450000005, 'Field Technician', 'Austin, TX', 'US', 'Office')]
        with served(sf_board(f'<ul class="container job-list">{"".join(listed)}</ul>')):
            rows = ats.SuccessFactors.fetch(TILES)
        self.assertEqual([row['location'] for row in rows], ['Perth, AU', 'Chennai', 'Toronto', 'Lyon, FR', 'Austin, TX'])
        self.assertEqual([geo.state_of(row['location']) for row in rows], [None, None, None, None, 'TX'])

    def test_a_table_list_and_a_tile_that_names_no_country_are_read_as_the_board_states_them(self):
        table = '''<table><tr class="data-row"><td class="colTitle"><span class="jobTitle hidden-phone">
 <a class="jobTitle-link" href="/job/Houston-Process-Engineer-TX-77001/1300000000/">Process Engineer</a></span></td>
 <td class="colLocation hidden-phone"><span class="jobLocation"> Houston, TX, US, 77001 </span></td></tr></table>'''
        with served(sf_board(table)):
            rows = ats.SuccessFactors.fetch(TILES)
        self.assertEqual([(row['ats_job_id'], row['location'], row['remote']) for row in rows],
                         [('/job/Houston-Process-Engineer-TX-77001/1300000000/', 'Houston, TX, US, 77001', 0)])
        bare = sf_tile(1300000001, 'Field Technician', 'Austin, TX, US, 73301', None, 'Office')
        with served(sf_board(f'<ul class="container job-list">{bare}</ul>')):
            rows = ats.SuccessFactors.fetch(TILES)
        self.assertEqual([(row['location'], row['remote']) for row in rows], [('Austin, TX, US, 73301', 0)])


class LinksNameTheReaders(unittest.TestCase):
    def test_a_job_search_link_names_its_reader(self):
        links = {'https://www.randstadusa.com/jobs/': ('randstad', 'https://www.randstadusa.com/jobs/'),
                 'https://www.randstadusa.com/jobs/309/AB_5146544/industrial-electrician_bolingbrook/':
                     ('randstad', 'https://www.randstadusa.com/jobs/'),
                 'https://motionrecruitment.com/tech-jobs': ('motionrecruitment', 'https://motionrecruitment.com/tech-jobs'),
                 'motionrecruitment.com/tech-jobs/boston/contract/soc-analyst/894609':
                     ('motionrecruitment', 'https://motionrecruitment.com/tech-jobs')}
        for link, reader in links.items():
            self.assertEqual(resolve.classify_url(link), reader, link)
        self.assertTrue({'randstad', 'motionrecruitment'} <= set(resolve.PATTERN_ATS))
        for other in ('https://www.randstadusa.com/about/', 'https://motionrecruitment.com/blog',
                      'https://notrandstadusa.com/jobs/', 'https://example.com/tech-jobs'):
            self.assertIsNone(resolve.classify_url(other), other)

    def test_a_link_that_only_resembles_a_board_names_no_reader(self):
        for link, reader in {'https://randstadusa.com/jobs': ('randstad', 'https://randstadusa.com/jobs/'),
                             'https://www.motionrecruitment.com/tech-jobs/': ('motionrecruitment', 'https://www.motionrecruitment.com/tech-jobs'),
                             'https://akka-cand.talent-soft.com/': ('talentsoft', 'akka-cand.talent-soft.com')}.items():
            self.assertEqual(resolve.classify_url(link), reader, link)
        for other in ('https://www.randstadusa.com/jobsearch', 'https://www.randstadusa.com/jobs-at-randstad/',
                      'https://xplore.randstadusa.com/jobs/fe054270', 'https://careers.randstadusa.com/jobs/',
                      'https://motionrecruitment.com/tech-jobsearch', 'https://motionrecruitment.com/tech-jobs-in-boston',
                      'https://blog.motionrecruitment.com/tech-jobs', 'https://www.talent-soft.com/job/list-of-jobs.aspx',
                      'https://support.talent-soft.com/', 'https://help.talent-soft.com/job/list-of-jobs.aspx',
                      'https://a.b.talent-soft.com/job/list-of-jobs.aspx'):
            self.assertIsNone(resolve.classify_url(other), other)

    def test_a_talentsoft_board_link_names_its_reader(self):
        for link in ('https://akka-cand.talent-soft.com/job/list-of-jobs.aspx',
                     'akka-cand.talent-soft.com/job/job-maintenance-engineer-_35698.aspx'):
            self.assertEqual(resolve.classify_url(link), ('talentsoft', 'akka-cand.talent-soft.com'), link)
        self.assertIn('talentsoft', resolve.PATTERN_ATS)
        for other in ('https://talent-soft.com.example.org/job/list-of-jobs.aspx', 'https://example.com/job/list-of-jobs.aspx'):
            self.assertIsNone(resolve.classify_url(other), other)


class ThroughThePull(unittest.TestCase):
    def setUp(self):
        with db.connect() as conn:
            for table in (db.corpus_table(), db.companies_table()):
                conn.execute(f'DELETE FROM {table}')
            self.staffing = db.upsert_company(conn, 'Fixture Staffing', ats_type='randstad', ats_token=RANDSTAD,
                                              discover_status='found', source_list='curated')
            self.tech = db.upsert_company(conn, 'Fixture Tech Staffing', ats_type='motionrecruitment', ats_token=MOTION,
                                          discover_status='found', source_list='curated')
            self.board = db.upsert_company(conn, 'Fixture Engineering', ats_type='talentsoft', ats_token=BOARD,
                                           discover_status='found', source_list='curated')
            self.tiles = db.upsert_company(conn, 'Fixture Consulting', ats_type='successfactors', ats_token=TILES,
                                           discover_status='found', source_list='curated')

    def pull(self, name, *boards):
        with db.connect() as conn:
            row = dict(cli._companies(conn, company=name, need_ats=True)[0])
        with served(*boards), contextlib.redirect_stdout(io.StringIO()):
            return cli._scrape_source(row, None)

    def active(self, company):
        with db.connect() as conn:
            return {row['ats_job_id']: row['state'] for row in conn.execute(
                f'SELECT ats_job_id,state FROM {db.corpus_table()} WHERE company_id=? AND active=1', (company,)).fetchall()}

    def test_a_whole_read_closes_the_job_that_left_and_a_refused_or_uncounted_one_closes_nothing(self):
        jobs = numbered(35)
        self.assertEqual(self.pull('Fixture Staffing', randstad_board(jobs))['new'], 35)
        self.assertEqual(set(self.active(self.staffing).values()), {'NC'})
        self.assertEqual(self.pull('Fixture Staffing', randstad_board(jobs[:34]))['closed'], 1)
        self.assertEqual(self.pull('Fixture Staffing', randstad_board(jobs[:34], refuse=2)).get('closed', 0), 0)
        self.assertEqual(len(self.active(self.staffing)), 34)
        listed = cards(25)
        self.assertEqual(self.pull('Fixture Tech Staffing', motion_board(listed))['new'], 25)
        self.assertEqual(set(self.active(self.tech).values()), {'TX'})
        self.assertEqual(self.pull('Fixture Tech Staffing', motion_board(listed[:24]))['closed'], 1)
        self.assertEqual(self.pull('Fixture Tech Staffing', motion_board(listed[:10], counted=False)).get('closed', 0), 0)
        self.assertEqual(len(self.active(self.tech)), 24)

    def test_a_talentsoft_vacancy_with_no_place_is_not_stored_and_a_whole_read_closes_the_one_that_left(self):
        listed = vacancies(13) + [talentsoft_card(35269, 'Powertrain Software & Controls Engineer', '/')]
        self.assertEqual(self.pull('Fixture Engineering', talentsoft_board(listed))['new'], 13)
        self.assertEqual(set(self.active(self.board).values()), {None})
        self.assertNotIn('35269', self.active(self.board))
        self.assertEqual(self.pull('Fixture Engineering', talentsoft_board(listed[1:]))['closed'], 1)
        self.assertEqual(self.pull('Fixture Engineering', talentsoft_board(listed[1:], refuse=1)).get('closed', 0), 0)
        self.assertEqual(len(self.active(self.board)), 12)

    def test_a_tile_job_is_stored_where_its_tile_says_it_is(self):
        self.assertEqual(self.pull('Fixture Consulting', sf_board(f'<ul class="container job-list">{"".join(SYNTAX)}</ul>'))['new'], 6)
        stored = self.active(self.tiles)
        self.assertEqual(stored['/job/Power-Platform-Consultant/1449494000/'], 'NC')
        self.assertEqual({state for job, state in stored.items() if '1449494000' not in job}, {None})

    def test_a_job_the_board_still_lists_but_the_reader_cannot_store_is_not_closed(self):
        jobs = numbered(35)
        self.assertEqual(self.pull('Fixture Staffing', randstad_board(jobs))['new'], 35)
        untitled = jobs[:4] + [{**jobs[4], 'title': None}] + jobs[5:]
        self.assertEqual(self.pull('Fixture Staffing', randstad_board(untitled)).get('closed', 0), 0)
        self.assertEqual(len(self.active(self.staffing)), 35)
        listed = vacancies(13)
        self.assertEqual(self.pull('Fixture Engineering', talentsoft_board(listed))['new'], 13)
        short = talentsoft_card(35005, 'Design Release Engineer 5', '', items=['OPERATIONS', 'Permanent contract', '10/11/2026'])
        self.assertEqual(self.pull('Fixture Engineering', talentsoft_board(listed[:4] + [short] + listed[5:])).get('closed', 0), 0)
        self.assertEqual(len(self.active(self.board)), 13)


if __name__ == '__main__':
    unittest.main()
