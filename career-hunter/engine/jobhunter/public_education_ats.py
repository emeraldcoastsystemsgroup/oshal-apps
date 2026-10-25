# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Read public PageUp college tables and GovernmentJobs agency listings with exact identities, bounded complete pagination and explicit partial results on refusal or changed markup.
"""Public education/community boards; no applicant account, application writes or credentials."""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlencode, urljoin, urlparse

from bs4 import BeautifulSoup
from . import http
from .source_memory import Feed

MAX_PAGES = 50


def _text(node):
    return node.get_text(' ', strip=True) if node else ''


def _salary(text):
    """Retain only explicitly dollar-denominated advertised amounts, including hourly pay."""
    numbers = [float(value.replace(',', '')) for value in re.findall(r'\$\s*([\d,]+(?:\.\d+)?)', text)]
    if not numbers:
        return {}
    period = 'hour' if re.search(r'hour|hourly', text, re.I) else 'month' if re.search(r'month', text, re.I) else 'year' if re.search(r'year|annual', text, re.I) else None
    return {'salary_min': min(numbers), 'salary_max': max(numbers), 'salary_currency': 'USD', 'salary_period': period, 'salary_raw': text}


def _read_pages(initial, parse_page, next_page):
    """Only a recognized final page can attest a complete source enumeration."""
    rows, seen, seen_pages = [], set(), set()
    url = initial
    malformed = False
    for _ in range(MAX_PAGES):
        if url in seen_pages:
            return Feed(rows, complete=False, reason='pagination_repeated')
        seen_pages.add(url)
        try:
            response = http.get(url, timeout=20, headers={'X-Requested-With': 'XMLHttpRequest'})
        except Exception:
            return Feed(rows, complete=False, reason='http_unavailable')
        if not response.ok:
            return Feed(rows, complete=False, reason=f'http_{response.status_code}')
        if urlparse(response.url).netloc != urlparse(initial).netloc:
            return Feed(rows, complete=False, reason='unexpected_redirect')
        soup = BeautifulSoup(response.text, 'lxml')
        page_rows, recognized, bad_rows = parse_page(soup, initial)
        if not recognized:
            return Feed(rows, complete=False, reason='listing_markup_unrecognized')
        malformed = malformed or bad_rows
        if page_rows and all(str(row['ats_job_id']) in seen for row in page_rows):
            return Feed(rows, complete=False, reason='pagination_repeated')
        for row in page_rows:
            key = str(row['ats_job_id'])
            if key not in seen:
                seen.add(key)
                rows.append(row)
        next_url = next_page(soup, url)
        if next_url is False:
            return Feed(rows, complete=False, reason='pagination_invalid')
        if not next_url:
            return Feed(rows, complete=not malformed, reason='listing_row_invalid' if malformed else None)
        url = next_url
    return Feed(rows, complete=False, reason='page_limit')


class PageUp:
    """Reviewed public table variant used by UWF; other PageUp variants remain unclaimed."""
    NAME = 'pageup'
    HOSTS = {'careers.uwf.edu'}

    @classmethod
    def detect(cls, url):
        parsed = urlparse(url or '')
        return f'https://{parsed.netloc}/jobs/search' if parsed.scheme == 'https' and parsed.netloc in cls.HOSTS and parsed.path.rstrip('/') == '/jobs/search' else None

    @classmethod
    def probe(cls, slug):
        return None

    @classmethod
    def fetch(cls, token):
        initial = cls.detect(token)
        if not initial:
            raise ValueError('unreviewed public PageUp board')
        return _read_pages(initial, cls._parse, cls._next)

    @staticmethod
    def _parse(soup, origin):
        nodes = soup.select('tr[data-job-url]')
        rows, bad = [], False
        for node in nodes:
            link = node.select_one('.job-search-results-title a[href]')
            title = _text(link)
            identifier = _text(node.select_one('.job-search-results-requisition-identifiers'))
            url = urljoin(origin, link.get('href', '')) if link else ''
            if not title or not identifier or urlparse(url).netloc != urlparse(origin).netloc or not urlparse(url).path.startswith('/jobs/'):
                bad = True
                continue
            location = _text(node.select_one('.job-search-results-location')) or None
            employment = _text(node.select_one('.job-search-results-employment-type'))
            rows.append({'ats_job_id': identifier, 'title': title, 'location': location,
                         'remote': int(bool(location and re.search(r'\bremote\b', location, re.I))),
                         'department': _text(node.select_one('.job-search-results-department')) or None,
                         'url': url, 'description': f'Employment type: {employment}' if employment else None,
                         'job_type_hint': employment or None, 'posted_at': None})
        recognized = bool(nodes) or bool(soup.select('table.job-search-results')) or bool(re.search(r'no (?:matching )?(?:jobs|positions) found', soup.get_text(' ', strip=True), re.I))
        return rows, recognized, bad

    @staticmethod
    def _next(soup, current):
        node = soup.select_one('a[rel~=next][href]')
        if not node:
            return None
        following = urljoin(current, node['href'])
        parsed = urlparse(following)
        if parsed.scheme != 'https' or parsed.netloc != urlparse(current).netloc or parsed.path.rstrip('/') != '/jobs/search':
            return False
        return following


class GovernmentJobs:
    """The same anonymous agency-list GET used by the official NEOGOV careers screen."""
    NAME = 'governmentjobs'

    @classmethod
    def detect(cls, url):
        parsed = urlparse(url or '')
        found = re.fullmatch(r'/careers/([a-z0-9_-]+)(?:/jobs(?:/.*)?)?/?', parsed.path, re.I)
        return found.group(1) if parsed.scheme == 'https' and parsed.netloc in {'www.governmentjobs.com', 'governmentjobs.com'} and found else None

    @classmethod
    def probe(cls, slug):
        return None

    @classmethod
    def fetch(cls, token):
        if not re.fullmatch(r'[a-z0-9_-]{1,100}', token or '', re.I):
            raise ValueError('invalid public GovernmentJobs agency')
        initial = 'https://www.governmentjobs.com/careers/home/index?' + urlencode({'agency': token, 'page': 1})
        return _read_pages(initial, cls._parse, cls._next)

    @staticmethod
    def _parse(soup, origin):
        rows, bad = [], False
        for node in soup.select('li[data-job-id]'):
            identifier = node.get('data-job-id')
            link = node.select_one('a.item-details-link[href]')
            url = urljoin(origin, link.get('href', '')) if link else ''
            title = _text(link)
            if not identifier or not title or urlparse(url).netloc != 'www.governmentjobs.com' or not re.search(r'/jobs/\d+/', url):
                bad = True
                continue
            meta = node.select('ul.list-meta > li')
            location = _text(meta[0]) if meta else None
            salary = _text(meta[1]) if len(meta) > 1 else ''
            rows.append({'ats_job_id': identifier, 'title': title, 'location': location,
                         'remote': int(bool(location and re.search(r'\bremote\b', location, re.I))),
                         'department': link.get('data-department-name') or None,
                         'url': url, 'description': _text(node.select_one('.list-entry')) or None,
                         'job_type_hint': salary or None, 'posted_at': None, **_salary(salary)})
        recognized = bool(rows) or bool(re.search(r'no (?:matching )?(?:jobs|positions) (?:were )?found', soup.get_text(' ', strip=True), re.I))
        return rows, recognized, bad

    @staticmethod
    def _next(soup, current):
        current_query = parse_qs(urlparse(current).query)
        page = int(current_query['page'][0])
        candidates = []
        for link in soup.select('a[href]'):
            parsed = urlparse(urljoin(current, link['href']))
            following = parse_qs(parsed.query).get('page', [''])[0]
            if following.isdigit() and int(following) > page:
                if parsed.netloc != 'www.governmentjobs.com' or parsed.path.lower().rstrip('/') != '/careers/home':
                    return False
                candidates.append(int(following))
        if not candidates:
            return None
        return 'https://www.governmentjobs.com/careers/home/index?' + urlencode({'agency': current_query['agency'][0], 'page': min(candidates)})
