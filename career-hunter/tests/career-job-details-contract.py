# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.6 (Roger, 2026-11-16, Torch Technologies on My jobs): the posting sheet's reader (lib/career-job-details.js) and the backfill (scripts/backfill-job-descriptions.py) held to the engine: for every saved real answer the engine's own reader asks the rail for the address the node reader reads first, the node reader and the backfill read the same addresses and keep the same text, and every copy the route keeps is one the engine accepts for that listing and reuses without a read.
"""Run by tests/career-job-details.test.mjs with the node reader's results on stdin.

Replaced: the Career rail (enrich._rail_post), answering with the saved fixture for an address the node guard
(lib/career-employer-detail.js) admits, and direct networking (none on the native kernel).
"""
import importlib.util
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
from jobhunter import config, detail, enrich, http, job_context  # noqa: E402

INPUT = json.loads(sys.stdin.read())
FIXTURES = Path(__file__).resolve().parent / 'employer-detail-fixtures'
SPEC = importlib.util.spec_from_file_location('backfill', Path(__file__).resolve().parents[1] / 'scripts' / 'backfill-job-descriptions.py')
BACKFILL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BACKFILL)


class Rail:
    """The rail as lib/career-employer-detail.js answers it: the guard's verdict, then the employer's status and body."""

    def __init__(self, answers, guard):
        self.answers, self.guard, self.reads = answers, guard, []

    def __call__(self, body):
        request = json.loads(body)
        self.reads.append(request['url'])
        if not self.guard.get(request['url']):
            return 400, {'ok': False, 'error': 'invalid-employer-detail'}
        status, text = self.answers.get(request['url'], (404, '{}'))
        return 200, {'ok': True, 'status': status, 'body': text, 'contentType': 'application/json'}


class SheetReader(unittest.TestCase):
    def setUp(self):
        self.direct = []
        for item in (patch.dict(os.environ, {'OSHAL_EGRESS': 'kernel'}), patch.object(config, 'PER_HOST_DELAY', 0.0),
                     patch.object(http._session, 'request', side_effect=self.no_route)):
            item.start()
            self.addCleanup(item.stop)

    def no_route(self, *args, **kwargs):
        self.direct.append(args[1] if len(args) > 1 else kwargs.get('url'))
        raise requests.ConnectionError('the native sandbox has no network route')

    def test_the_engine_reads_the_address_the_sheet_reads_first_once(self):
        for case in INPUT['fixtures']:
            text = (FIXTURES / case['file']).read_text(encoding='utf-8')
            first = case['addresses'][0][1]
            rail = Rail({first: (200, text)}, {url: True for _, url in case['addresses']})
            with patch.object(enrich, '_rail_post', side_effect=rail):
                found = detail.fetch(case['company']['ats_type'], case['company']['ats_token'], case['posting']['ats_job_id'],
                                     case['posting']['url'])
            self.assertTrue(found.get('description'), case['file'])
            self.assertEqual(rail.reads, [first], f"{case['file']}: one read, at the sheet's first address")
        self.assertEqual(self.direct, [], 'nothing left the rail')

    def test_the_backfill_reads_the_same_addresses_and_keeps_the_same_text(self):
        for case in INPUT['fixtures']:
            text = (FIXTURES / case['file']).read_text(encoding='utf-8')
            self.assertEqual([list(item) for item in BACKFILL.addresses(case['posting'], case['company'])], case['addresses'],
                             case['file'])
            kind = case['addresses'][0][0]
            description, outcome = BACKFILL.describe(kind, json.loads(text), str(case['posting']['ats_job_id']))
            self.assertEqual(outcome, 'filled', case['file'])
            self.assertEqual(description, case['description'], f"{case['file']}: the sheet and the backfill keep one text")
        for case in INPUT['addressCases']:
            self.assertEqual([list(item) for item in BACKFILL.addresses(case['posting'], case['company'])], case['addresses'],
                             case['name'])

    def test_every_copy_the_route_keeps_is_one_the_engine_uses_without_a_read(self):
        self.assertTrue(INPUT['copies'], 'the route kept at least one copy')
        for case in INPUT['copies']:
            with patch.object(config, 'DATA_DIR', Path(case['dataDir'])):
                saved = job_context.read(case['row'])
                self.assertIsNotNone(saved, 'the engine accepts the copy for this exact listing')
                self.assertEqual((saved['description'], saved['basis']), (case['description'], 'employer-detail'))
                with patch.object(detail, 'fetch', side_effect=AssertionError('no employer read')):
                    resolved, fetched = job_context.hydrate(case['row'], {'ats_type': 'workday', 'ats_token': 'x:y:z'})
                self.assertEqual(resolved['description'], case['description'])
                self.assertIsNone(fetched, 'scoring and preparation reuse the copy')


if __name__ == '__main__':
    unittest.main(argv=['contract'], verbosity=1)
