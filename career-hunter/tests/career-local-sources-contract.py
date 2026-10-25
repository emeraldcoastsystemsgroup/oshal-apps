# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Prove public community-board pagination, conservative refusals and searchable production SQLite upserts without network access.
"""Deterministic adapter and real SQLite ingestion contracts; synthetic public markup."""
import json
import os
from pathlib import Path
import sqlite3
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
from jobhunter import ats, db, source_memory
from jobhunter.public_education_ats import GovernmentJobs, PageUp


def pageup(identifier='101', location='Pensacola - Main Campus, Florida', next_link=''):
    return f'''<table class="job-search-results"><tr data-job-url="/jobs/coordinator/{identifier}">
    <td class="job-search-results-title"><a href="/jobs/coordinator/{identifier}">Program Coordinator</a></td>
    <td class="job-search-results-requisition-identifiers">{identifier}</td>
    <td class="job-search-results-location">{location}</td>
    <td class="job-search-results-employment-type">Full-time</td></tr></table>{next_link}'''


def government(identifier='202', location='Crestview, FL', next_link=''):
    return f'''<ul><li data-job-id="{identifier}"><a class="item-details-link" data-department-name="Public Works"
    href="/careers/okaloosa/jobs/{identifier}/maintenance-worker">Maintenance Worker</a>
    <ul class="list-meta"><li>{location}</li><li>Full-time - $21.50 - $30.00 Hourly</li></ul>
    <div class="list-entry">Maintain public facilities.</div></li></ul>{next_link}'''


def response(url, text, status=200):
    return SimpleNamespace(ok=status == 200, status_code=status, url=url, text=text)


class Contracts(unittest.TestCase):
    def fetch(self, adapter, token, pages):
        calls = []
        def read(url, **kwargs):
            calls.append(url)
            item = pages[len(calls)-1]
            if isinstance(item, Exception):
                raise item
            return response(url, item) if isinstance(item, str) else item
        with patch('jobhunter.public_education_ats.http.get', read):
            result = adapter.fetch(token)
        return result, calls

    def test_pageup_complete_pagination_and_exact_metadata(self):
        rows, calls = self.fetch(PageUp, 'https://careers.uwf.edu/jobs/search', [
            pageup(next_link='<a rel="next" href="?page=2">Next</a>'), pageup('102')])
        self.assertTrue(rows.complete)
        self.assertIsNone(rows.reason)
        self.assertEqual([r['ats_job_id'] for r in rows], ['101', '102'])
        self.assertEqual(rows[0]['location'], 'Pensacola - Main Campus, Florida')
        self.assertEqual(rows[0]['job_type_hint'], 'Full-time')
        self.assertIsNone(rows[0]['posted_at'])
        self.assertEqual(calls[-1], 'https://careers.uwf.edu/jobs/search?page=2')

    def test_government_retains_agency_and_explicit_hourly_pay(self):
        rows, calls = self.fetch(GovernmentJobs, 'okaloosa', [
            government(next_link='<a href="/careers/Home?page=2">2</a>'), government('203')])
        self.assertTrue(rows.complete)
        self.assertIn('agency=okaloosa&page=2', calls[-1])
        self.assertEqual(rows[0]['salary_min'], 21.5)
        self.assertEqual(rows[0]['salary_max'], 30)
        self.assertEqual(rows[0]['salary_period'], 'hour')
        self.assertEqual(rows[0]['location'], 'Crestview, FL')

    def test_refusal_and_unrecognized_markup_are_not_empty_success(self):
        for item, reason in [(response('https://careers.uwf.edu/jobs/search', '', 403), 'http_403'),
                             ('<html>Access check</html>', 'listing_markup_unrecognized'),
                             (RuntimeError('provider body must not persist'), 'http_unavailable')]:
            with self.subTest(reason=reason):
                rows, _ = self.fetch(PageUp, 'https://careers.uwf.edu/jobs/search', [item])
                self.assertFalse(rows.complete)
                self.assertEqual(rows.reason, reason)

    def test_partial_pagination_keeps_rows_without_authorizing_closure(self):
        rows, _ = self.fetch(PageUp, 'https://careers.uwf.edu/jobs/search', [
            pageup(next_link='<a rel="next" href="?page=2">Next</a>'),
            response('https://careers.uwf.edu/jobs/search?page=2', '', 503)])
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows.complete)
        self.assertEqual(rows.reason, 'http_503')

    def test_repeated_invalid_and_foreign_pagination(self):
        for pages, reason in [
            ([pageup(next_link='<a rel="next" href="?page=2">Next</a>'), pageup()], 'pagination_repeated'),
            ([pageup(next_link='<a rel="next" href="https://foreign.example/jobs/search?page=2">Next</a>')], 'pagination_invalid'),
            ([response('https://login.example/', pageup())], 'unexpected_redirect')]:
            rows, _ = self.fetch(PageUp, 'https://careers.uwf.edu/jobs/search', pages)
            self.assertFalse(rows.complete)
            self.assertEqual(rows.reason, reason)

    def test_malformed_rows_and_page_ceiling(self):
        rows, _ = self.fetch(PageUp, 'https://careers.uwf.edu/jobs/search', [pageup().replace('>101<', '><')])
        self.assertFalse(rows.complete)
        self.assertEqual(rows.reason, 'listing_row_invalid')
        with patch('jobhunter.public_education_ats.MAX_PAGES', 1):
            rows, _ = self.fetch(PageUp, 'https://careers.uwf.edu/jobs/search', [pageup(next_link='<a rel="next" href="?page=2">Next</a>')])
        self.assertFalse(rows.complete)
        self.assertEqual(rows.reason, 'page_limit')

    def test_explicit_zero_is_recognized_but_still_conservative_at_ingest(self):
        rows, _ = self.fetch(GovernmentJobs, 'okaloosa', ['<p>No jobs found</p>'])
        self.assertEqual(len(rows), 0)
        self.assertTrue(rows.complete)
        self.assertIsNone(rows.reason)

    def test_directory_only_offers_reviewed_recognizable_feeds(self):
        directory = json.loads((ROOT / 'tools/career-local-sources.json').read_text())
        self.assertEqual(directory['region'], 'Northwest Florida / Emerald Coast')
        supported = 0
        for row in directory['sources']:
            self.assertTrue(row['url'].startswith('https://'))
            if row['status'] == 'available-feed':
                self.assertTrue(ats.detect_from_url(row['feedUrl'])[0])
                supported += 1
            else:
                self.assertEqual(row['status'], 'external-only')
                self.assertNotIn('feedUrl', row)
        self.assertEqual(supported, 4)
        self.assertEqual(ats.detect_from_url('https://careers.uwf.edu/jobs/search')[0], 'pageup')
        self.assertEqual(ats.detect_from_url('https://www.governmentjobs.com/careers/okaloosa'), ('governmentjobs', 'okaloosa'))
        self.assertIsNone(PageUp.detect('https://unreviewed.example/jobs/search'))

    def test_production_upserts_make_geocoded_searchable_rows_and_keep_unknowns(self):
        college, _ = self.fetch(PageUp, 'https://careers.uwf.edu/jobs/search', [pageup()])
        county, _ = self.fetch(GovernmentJobs, 'okaloosa', [government()])
        unknown, _ = self.fetch(PageUp, 'https://careers.uwf.edu/jobs/search', [pageup('103', '')])
        conn = sqlite3.connect(':memory:')
        conn.row_factory = sqlite3.Row
        conn.execute("ATTACH DATABASE ':memory:' AS corpus")
        conn.executescript(db.CORPUS_SCHEMA)
        conn.execute('CREATE TEMP VIEW postings AS SELECT * FROM corpus.postings_corpus')
        try:
            for name, rows in [('Fixture College', college), ('Fixture County', county), ('Unknown Place', unknown)]:
                cid = db.upsert_company(conn, name, source_list='local_community')
                counts = source_memory.ingest(conn, cid, rows)
                self.assertEqual(counts['new'], 1)
                self.assertTrue(counts['complete'])
                second = source_memory.ingest(conn, cid, rows)
                self.assertEqual(second['unchanged'], 1)
            records = [dict(row) for row in conn.execute('SELECT * FROM corpus.postings_corpus ORDER BY id')]
            self.assertEqual(len(records), 3)
            self.assertEqual(records[0]['city'], 'pensacola')
            self.assertEqual(records[0]['state'], 'FL')
            self.assertAlmostEqual(records[0]['lat'], 30.4213, places=1)
            self.assertEqual(records[1]['city'], 'crestview')
            self.assertEqual(records[1]['salary_source'], 'listed')
            self.assertEqual(records[1]['salary_period'], 'hour')
            self.assertEqual(records[1]['salary_min'], 21.5)
            self.assertIsNone(records[2]['city'])
            self.assertIsNone(records[2]['lat'])
            self.assertIsNone(records[2]['lon'])
            self.assertEqual(conn.execute("SELECT count(*) FROM corpus.postings_fts WHERE postings_fts MATCH 'Coordinator'").fetchone()[0], 2)
        finally:
            conn.close()


if __name__ == '__main__':
    unittest.main()
