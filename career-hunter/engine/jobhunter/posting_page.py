# CHANGE LOG
# 9 | maintainer@emeraldcoastsystemsgroup.com | Employers' own career sites read by the browser (web): the job page by plain HTTP, its JSON-LD, microdata or Avature details article. A site that refuses plain reads (an AWS or Cloudflare check: Jacobs, CBRE, Delta, Regeneron, SAIC, Verizon) answers 202 or 403 and costs three reads a pull, then is left for the night.
# 8 | maintainer@emeraldcoastsystemsgroup.com | Webflow CMS career sites (Parsons): the job page's rich-text body, under its page title, 20 jobs.
# 7 | maintainer@emeraldcoastsystemsgroup.com | Avature career sites: the job page's JSON-LD JobPosting (the one carrying the job's id when a page has two), else the details article's description (58 of 79 jobs; ManTech's 21 link another host than their list and are not read).
# 6 | maintainer@emeraldcoastsystemsgroup.com | No job-page reader for Google: its results page, which the pull already reads, carries every job's description (ats_custom.Google.descriptions).
# 5 | maintainer@emeraldcoastsystemsgroup.com | iCIMS portals: the job page's JSON-LD JobPosting, 167 jobs on 20 portals, a portal's sibling hosts included (allcareers-quanta lists careers2-quanta).
# 4 | maintainer@emeraldcoastsystemsgroup.com | SuccessFactors career sites: the schema.org JobPosting marked up in the job page (description under its title), 362 jobs on 34 sites; a filled position's page gives nothing.
# 3 | maintainer@emeraldcoastsystemsgroup.com | Radancy (TalentBrew) career sites: the job page's JSON-LD JobPosting, 736 jobs on 39 sites.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Experis and the other listed boards (htmllist): the job page's JSON-LD JobPosting, 1,286 jobs. Kept text keeps its paragraph and list breaks.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Read one posting's description from its own page during the pull, for a source whose job list carries none: one GET of the page the list links, on the site the list was read from, kept only when the page names this job.
"""One posting's description from its own page, read by the pull that has just found the job.

The pull reads its job lists with the network the kernel's ingest grants it; scoring later runs with none. Most lists
carry a title, an employer, a place and a link, not the description. The page the link names usually carries the
description as schema.org JobPosting data (JSON-LD or microdata) or in the site's own layout, so one more GET to the
site the list came from keeps it in the shared corpus, where scoring reads it without any request.

A page is read only when it is an https page on the site the list was read from (the same host, or a sibling host of the
same parent domain, as a vendor's portal links its own boards), and its text is kept only when the page names this job.
The text is stripped of markup and kept whole or not at all (ats_common.detail_text, the bound a saved copy has).
"""
from __future__ import annotations

import json
import re
from html import unescape
from urllib.parse import urlsplit

from .ats_common import detail_text as _detail_text

MAX_PAGE_BYTES = 2 * 1024 * 1024  # The largest page seen, a Google careers posting, is 1.3 MB.
MIN_CHARS = 200                   # Less is a label or a notice, not a description.
_LD = re.compile(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', re.S | re.I)
_WORD = re.compile(r'[a-z0-9]+')
_BREAK = re.compile(r'<br\s*/?>|</(?:p|div|li|h[1-6]|ul|ol|tr|section|article)\s*>|<li\b[^>]*>', re.I)


def source_host(token: str | None) -> str:
    """The host a source's job list is read from: its token is that host or a URL on it, optionally followed by `|`."""
    head = (token or '').split('|', 1)[0].strip()
    host = urlsplit(head).hostname if '://' in head else head.split('/', 1)[0].split(':', 1)[0]
    return (host or '').lower().rstrip('.')


def _parent(host: str) -> str:
    labels = host.split('.')
    return '.'.join(labels[1:]) if len(labels) > 2 else host


def admitted(url: str | None, list_host: str) -> bool:
    """An https page with no credentials or port, on the host the list was read from or a sibling of it."""
    if not isinstance(url, str) or len(url) > 2048 or not list_host:
        return False
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    host = (parts.hostname or '').lower().rstrip('.')
    if parts.scheme != 'https' or not host or parts.username or parts.password or port not in (None, 443):
        return False
    parent = _parent(host)
    # A sibling counts under a named parent (icims.com, eightfold.ai), never under a bare suffix such as co.uk.
    return host == list_host or parent == _parent(list_host) and '.' in parent and len(parent.split('.')[0]) >= 4


def detail_text(*sections) -> str | None:
    """ats_common.detail_text with markup that a page escaped once more (`&lt;p&gt;`) removed too, and runs of blank
    space closed up, so the text scoring reads is the words of the description and its line breaks."""
    sections = [unescape(s) if isinstance(s, str) and '&lt;' in s else s for s in sections]
    sections = [_BREAK.sub('\n', s) if isinstance(s, str) else s for s in sections]
    text = _detail_text(*sections)
    if not text:
        return None
    text = re.sub(r'[ \t\r\f\v\xa0\u200b]+', ' ', text)
    return re.sub(r' ?\n[ \n]*', lambda m: '\n\n' if m.group(0).count('\n') > 1 else '\n', text).strip() or None


def _words(text) -> set:
    return set(_WORD.findall(str(text or '').lower()))


def same_job(page_title, title) -> bool:
    """The page's job title names this job: one title's words hold the other's, or most of them agree.

    Lists often add a place or a number to the title ("Staff Global Program Manager - 220757"), pages often drop them.
    """
    a, b = _words(page_title), _words(title)
    if not a or not b:
        return False
    return a <= b or b <= a or len(a & b) / len(a | b) >= 0.6


def _postings(html: str):
    for match in _LD.finditer(html or ''):
        try:
            value = json.loads(match.group(1).strip(), strict=False)
        except ValueError:
            continue
        stack = [value]
        while stack:
            item = stack.pop()
            if isinstance(item, list):
                stack.extend(item)
            elif isinstance(item, dict):
                if 'JobPosting' in str(item.get('@type', '')) and isinstance(item.get('description'), str):
                    yield item
                stack.extend(v for v in item.values() if isinstance(v, (dict, list)))


def _identifier(item) -> str:
    value = item.get('identifier')
    value = value.get('value') if isinstance(value, dict) else value
    return str(value).strip() if isinstance(value, (str, int)) else ''


def from_jsonld(html: str, job_id, title) -> str | None:
    """This job's JSON-LD JobPosting description: the one whose identifier is the job's id, else the longest whose
    title names the job, else the page's only posting when it carries no title. Another job's posting gives nothing."""
    postings = list(_postings(html))
    by_id = [p for p in postings if _identifier(p) and _identifier(p) == str(job_id or '').strip()]
    named = by_id or [p for p in postings if same_job(p.get('title'), title)]
    if not named and len(postings) == 1 and not postings[0].get('title'):
        named = postings
    if not named:
        return None
    return detail_text(max((p['description'] for p in named), key=len))


def from_microdata(html: str, job_id, title) -> str | None:
    """A schema.org JobPosting marked up in the page itself (SuccessFactors career sites): its description, when its
    title names the job."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html or '', 'lxml')
    for scope in soup.find_all(attrs={'itemtype': re.compile(r'schema\.org/JobPosting$', re.I)}):
        heading = scope.find(attrs={'itemprop': 'title'})
        if heading is not None and not same_job(heading.get_text(' ', strip=True), title):
            continue
        parts = [node.decode_contents() for node in scope.find_all(attrs={'itemprop': 'description'})]
        text = detail_text(max(parts, key=len)) if parts else None
        if text:
            return text
    return None


def _titled(soup, title) -> bool:
    """The page's own title names this job; a layout reader has no other way to tell whose description it holds."""
    return soup.title is not None and same_job(soup.title.get_text(' ', strip=True), title)


def from_avature(html: str, job_id, title) -> str | None:
    """An Avature job page's details article: its longest block, the description and requirements."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html or '', 'lxml')
    if not _titled(soup, title):
        return None
    blocks = [node.decode_contents() for node in soup.select('article.article--details .article__content')]
    return detail_text(max(blocks, key=lambda block: len(re.sub(r'<[^>]+>', '', block)))) if blocks else None


def from_rich_text(html: str, job_id, title) -> str | None:
    """A Webflow CMS job page's rich-text body."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html or '', 'lxml')
    if not _titled(soup, title):
        return None
    blocks = [node.decode_contents() for node in soup.select('.w-richtext')]
    return detail_text(max(blocks, key=len)) if blocks else None


# The source kinds whose list carries no description and whose posting pages were read for one (Lane CR8, 2026-11-14),
# each with the readers its pages answer to, in order.
READERS = {
    'eightfold': (from_jsonld,),
    'htmllist': (from_jsonld,),
    'radancy': (from_jsonld,),
    'successfactors': (from_microdata, from_jsonld),
    'icims': (from_jsonld,),
    'avature': (from_jsonld, from_avature),
    'webflow': (from_jsonld, from_rich_text),
    'web': (from_jsonld, from_microdata, from_avature),
}
# The order the stage serves kinds in, by jobs gained per request in the live look (Lane CR8, 2026-11-14), then by jobs.
# Google is not here: its results page already carries every job's description (ats_custom.Google.descriptions).
RANK = ['eightfold', 'htmllist', 'radancy', 'successfactors', 'icims', 'avature', 'webflow', 'web']


def describable(kind: str | None) -> bool:
    return kind in READERS


def read(kind: str, token: str | None, posting: dict) -> tuple[str | None, str]:
    """(description or None, outcome) for one posting. Never raises: a failed read leaves the posting as it is.

    Outcomes: saved, not_named (the page answered without this job's description), refused (any answer but 200, so a
    redirect, a site's check or a closed posting), unreadable (no connection, a timeout, a page past the bound), skipped
    (not a page this source may read).
    """
    from . import http
    url = posting.get('url')
    if kind not in READERS or not admitted(url, source_host(token)):
        return None, 'skipped'
    try:
        status, html, _ = http.page_once(url, MAX_PAGE_BYTES)
    except Exception:
        return None, 'unreadable'
    if status != 200:
        return None, 'refused'
    for reader in READERS[kind]:
        try:
            text = reader(html, posting.get('ats_job_id'), posting.get('title'))
        except Exception:
            text = None
        if text and len(text) >= MIN_CHARS:
            return text, 'saved'
    return None, 'not_named'
