# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | The Oracle Recruiting Cloud detail reader against saved real public responses: on the native kernel each asks the Career rail for exactly the address its guard admits, once, and turns the answer into the description scoring uses; a closed posting, a refusal or any non-200 marks nothing and costs that one read, never a retry.
# 2 | maintainer@emeraldcoastsystemsgroup.com | The SmartRecruiters detail reader: one read of the Posting API through the admitted address, the whole job ad in order, nothing on a closed posting, a refusal, another posting's answer or a company or posting id the rail would refuse.
"""The shipped readers (ats.fetch_detail, detail.fetch, http.detail_json) with the native rail replaced.

Replaced: the Career rail (enrich._rail_post), answering with the saved fixture for the address the node wrapper's real
guard (lib/career-employer-detail.js) admits and 400 otherwise, and direct networking (the native sandbox has none).
"""
import json
import os
import re
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
from jobhunter import ats, ats_common, config, detail, enrich, http, job_context, oracle_orc, score

INPUT = json.loads(sys.stdin.read())
GUARD, PARITY, EGRESS = INPUT['guard'], INPUT['oracleHosts'], INPUT['egress']
FIXTURES = Path(__file__).resolve().parent / 'employer-detail-fixtures'
INDEX = {entry['file']: entry for entry in json.loads((FIXTURES / 'index.json').read_text())['fixtures']}
TAG = re.compile(r'<\s*/?\s*[a-zA-Z][^>]*>')


def fixture(name):
    return INDEX[name], (FIXTURES / name).read_text(encoding='utf-8')


def oracle_token(entry):
    query = re.search(r'Id=%22([^%]+)%22,siteNumber=(.+)$', entry['url'])
    return f"{entry['url'].split('/')[2]}|{query[2]}|careers.invented.example", query[1]


def sr_token(entry):
    company, posting = re.search(r'/companies/([^/]+)/postings/([^/]+)$', entry['url']).groups()
    return company, posting


class Rail:
    """The rail as lib/career-employer-detail.js answers: the guard's verdict, then the employer's status and body."""

    def __init__(self, answers):
        self.answers, self.reads = answers, []

    def __call__(self, body):
        request = json.loads(body)
        assert request['operation'] == 'employer-detail-get' and set(request) == {'operation', 'url'}, request
        self.reads.append(request['url'])
        if not GUARD.get(request['url']):
            return 400, {'ok': False, 'error': 'invalid-employer-detail'}
        answer = self.answers.get(request['url'])
        if answer is None:
            return 502, {'ok': False, 'error': 'employer-detail-unavailable'}
        status, text = answer
        return 200, {'ok': True, 'status': status, 'body': text, 'contentType': 'application/json'}


class NativeReaders(unittest.TestCase):
    def setUp(self):
        self.direct = []
        patches = [patch.dict(os.environ, {'OSHAL_EGRESS': 'kernel'}), patch.object(config, 'PER_HOST_DELAY', 0.0),
                   patch.object(http._session, 'request', side_effect=self.no_route)]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    def no_route(self, *args, **kwargs):
        self.direct.append(args[1] if len(args) > 1 else kwargs.get('url'))
        raise requests.ConnectionError('the native sandbox has no network route')

    def rail(self, answers):
        rail = Rail(answers)
        item = patch.object(enrich, '_rail_post', side_effect=rail)
        item.start()
        self.addCleanup(item.stop)
        return rail

    def assert_description(self, result, entry, text):
        description = result.get('description')
        self.assertIsInstance(description, str, entry['file'])
        self.assertGreater(len(description), 1000, entry['file'])
        self.assertIsNone(TAG.search(description), 'markup is stripped')
        self.assertLessEqual(len(description), job_context.MAX_CHARS)
        return description

    def test_oracle_fixtures_read_once_through_the_admitted_address_and_give_the_whole_requisition(self):
        names = [name for name in INDEX if name.startswith('oracle-') and 'closed' not in name]
        self.assertEqual(len(names), 3)
        for name in names:
            entry, text = fixture(name)
            item = json.loads(text)['items'][0]
            rail = self.rail({entry['url']: (200, text)})
            token, job_id = oracle_token(entry)
            self.assertEqual(oracle_orc.detail_url(token, job_id), entry['url'])
            description = self.assert_description(ats.fetch_detail('oracle_orc', token, job_id), entry, text)
            self.assertEqual(rail.reads, [entry['url']])
            for field in ('ExternalDescriptionStr', 'ExternalResponsibilitiesStr', 'ExternalQualificationsStr'):
                words = re.findall(r'[A-Za-z]{6,}', re.sub(r'<[^>]+>', ' ', item.get(field) or ''))[:3]
                for word in words:
                    self.assertIn(word, description, f'{name} keeps {field}')
        self.assertEqual(self.direct, [])

    def test_smartrecruiters_fixtures_read_once_through_the_admitted_address_and_give_the_whole_job_ad(self):
        names = [name for name in INDEX if name.startswith('smartrecruiters-') and 'closed' not in name]
        self.assertEqual(len(names), 3)
        for name in names:
            entry, text = fixture(name)
            sections = json.loads(text)['jobAd']['sections']
            rail = self.rail({entry['url']: (200, text)})
            company, posting = sr_token(entry)
            description = self.assert_description(ats.fetch_detail('smartrecruiters', company, posting), entry, text)
            self.assertEqual(rail.reads, [entry['url']])
            self.assertTrue(description.startswith(ats_common._strip_html(sections['jobDescription']['text'])[:40]),
                            f'{name}: the job description leads')
            for key in ('qualifications', 'additionalInformation', 'companyDescription'):
                for word in re.findall(r'[A-Za-z]{6,}', re.sub(r'<[^>]+>', ' ', sections[key]['text']))[:3]:
                    self.assertIn(word, description, f'{name} keeps {key}')
        self.assertEqual(self.direct, [])

    def test_the_scoring_path_reads_each_source_once_and_never_falls_back_after_a_description(self):
        for name, ats_type in [('oracle-jpmc-210801278.json', 'oracle_orc'),
                               ('smartrecruiters-abbvie-3743990016859246.json', 'smartrecruiters')]:
            entry, text = fixture(name)
            rail = self.rail({entry['url']: (200, text)})
            token, job_id = oracle_token(entry) if ats_type == 'oracle_orc' else sr_token(entry)
            listing = f'https://jobs.invented.example/{job_id}'
            self.assert_description(detail.fetch(ats_type, token, job_id, listing), entry, text)
            self.assertEqual(rail.reads, [entry['url']])
        self.assertEqual(self.direct, [], 'the JSON-LD page fallback is not reached when the structured read answered')

    def test_a_closed_posting_a_refusal_or_any_non_200_marks_nothing_and_costs_one_read(self):
        oracle_closed, oracle_closed_text = fixture('oracle-eeho-us2-closed.json')
        sr_closed, sr_closed_text = fixture('smartrecruiters-servicenow-closed.json')
        cases = [('oracle_orc', oracle_closed, (200, oracle_closed_text)), ('smartrecruiters', sr_closed, (404, sr_closed_text))]
        oracle_open, oracle_text = fixture('oracle-eeho-us2-346395.json')
        sr_open, sr_text = fixture('smartrecruiters-boschgroup-744000161629479.json')
        for ats_type, entry, text in [('oracle_orc', oracle_open, oracle_text), ('smartrecruiters', sr_open, sr_text)]:
            for status in (303, 404, 410, 429, 500, 503):
                cases.append((ats_type, entry, (status, '')))
            cases.append((ats_type, entry, (200, 'not json')))
            cases.append((ats_type, entry, None))  # the employer unreachable: the rail answers 502
        for ats_type, entry, answer in cases:
            rail = self.rail({} if answer is None else {entry['url']: answer})
            token, job_id = oracle_token(entry) if ats_type == 'oracle_orc' else sr_token(entry)
            self.assertFalse(ats.fetch_detail(ats_type, token, job_id).get('description'), (entry['file'], answer))
            self.assertEqual(rail.reads, [entry['url']], f'one read, no retry: {entry["file"]} {answer and answer[0]}')

    def test_an_answer_for_another_posting_or_too_long_to_keep_whole_marks_nothing(self):
        entry, text = fixture('oracle-eeho-us2-346395.json')
        data = json.loads(text)
        data['items'][0]['Id'] = 999
        self.rail({entry['url']: (200, json.dumps(data))})
        self.assertEqual(ats.fetch_detail('oracle_orc', *oracle_token(entry)), {})
        data['items'][0]['Id'] = 346395
        data['items'][0]['ExternalDescriptionStr'] = '<p>' + 'duty ' * 13000 + '</p>'
        self.rail({entry['url']: (200, json.dumps(data))})
        self.assertIsNone(ats.fetch_detail('oracle_orc', *oracle_token(entry)).get('description'))
        entry, text = fixture('smartrecruiters-boschgroup-744000161629479.json')
        data = json.loads(text)
        data['id'] = '1'
        self.rail({entry['url']: (200, json.dumps(data))})
        self.assertEqual(ats.fetch_detail('smartrecruiters', *sr_token(entry)), {})
        self.assertEqual(ats_common.DETAIL_MAX_CHARS, job_context.MAX_CHARS)

    def test_a_board_the_rail_would_refuse_is_not_asked_for(self):
        rail = self.rail({})
        for ats_type, token, job_id in [('oracle_orc', 'eeho.fa.em2.oraclecloud.com|CX_1|x', '1'),
                                        ('oracle_orc', 'a.b.fa.us2.oraclecloud.com|CX_1|x', '1'),
                                        ('oracle_orc', 'eeho.fa.us2.oraclecloud.com|CX 1|x', '1'),
                                        ('oracle_orc', 'eeho.fa.us2.oraclecloud.com|CX_1|x', '../1'),
                                        ('smartrecruiters', 'Bosch.Group', '1'), ('smartrecruiters', 'BoschGroup', 'abc')]:
            self.assertEqual(ats.fetch_detail(ats_type, token, job_id), {})
        self.assertEqual(rail.reads, [])

    def test_the_engine_and_the_guard_agree_on_the_oracle_hosts_and_the_egress_block_declares_them(self):
        for host, admitted in PARITY.items():
            self.assertEqual(bool(oracle_orc.DETAIL_HOST.fullmatch(host)), admitted, host)
        self.assertEqual(sorted('*.' + suffix for suffix in score._ORACLE_DETAIL_SUFFIXES),
                         sorted(host for host in EGRESS if 'oraclecloud' in host))


class DirectReaders(unittest.TestCase):
    """Off the native kernel the same readers make one direct GET that follows no redirect."""

    def test_one_direct_get_without_redirects(self):
        for name, ats_type in [('oracle-jpmc-210801278.json', 'oracle_orc'),
                               ('smartrecruiters-servicenow-744000161596339.json', 'smartrecruiters')]:
            entry, text = fixture(name)
            token, job_id = oracle_token(entry) if ats_type == 'oracle_orc' else sr_token(entry)
            for status, body in [(200, text), (500, ''), (302, '')]:
                response = requests.Response()
                response.status_code, response._content, response.url = status, body.encode('utf-8'), entry['url']
                with patch.dict(os.environ, {'OSHAL_EGRESS': ''}), patch.object(config, 'PER_HOST_DELAY', 0.0), \
                        patch.object(http._session, 'get', return_value=response) as get:
                    result = ats.fetch_detail(ats_type, token, job_id)
                get.assert_called_once()
                self.assertEqual(get.call_args.args[0], entry['url'])
                self.assertIs(get.call_args.kwargs['allow_redirects'], False)
                self.assertEqual(bool(result.get('description')), status == 200, (name, status))


if __name__ == '__main__':
    unittest.main(argv=['detail-readers'], verbosity=2)
