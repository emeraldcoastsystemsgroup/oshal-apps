# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Run the shipped nightly launcher on the native rail with invented jobs: a job no reader on the native kernel can describe never takes one of the 50 slots, night after night, while a Workday job that answered a redirect is tried again the next night.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Jobs of an Oracle board on an admitted host are scored from saved real public responses read through the rail, a closed requisition is skipped after one read and tried again; Eightfold and SmartRecruiters jobs and an Oracle board on another host still take no slot and make no read.
# 3 | maintainer@emeraldcoastsystemsgroup.com | SmartRecruiters jobs are scored from a saved real posting read through the rail; a closed posting is skipped after one read and tried again.
# 4 | maintainer@emeraldcoastsystemsgroup.com | A job of each source kind whose description the pull keeps (tests/pull-detail-fixtures, read by posting_page as the pull reads it) is selected and scored from that listing text with no detail read at all, while jobs of the same sources with no text still take no slot.
"""Disposable owner and corpus stores, the real nightly launcher, score selection, job context and detail readers.

Replaced: the model (a fixed fit), the Career rail (answering as lib/career-employer-detail.js does, from the real
guard's verdicts that the node wrapper computes, with the employers' saved real responses from
tests/employer-detail-fixtures), and direct networking (the native sandbox has no route).
"""
import contextlib
import io
import json
import os
import re
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
from jobhunter import config, db, enrich, http, job_context, posting_page, profile, score

INPUT = json.loads(sys.stdin.read())
CODE, GUARD = INPUT['code'], INPUT['guard']
FIXTURES = Path(__file__).resolve().parent / 'employer-detail-fixtures'
SR_OPEN = json.loads((FIXTURES / 'smartrecruiters-boschgroup-744000161629479.json').read_text(encoding='utf-8'))
SR_CLOSED = (FIXTURES / 'smartrecruiters-servicenow-closed.json').read_text(encoding='utf-8')
ORACLE_OPEN = json.loads((FIXTURES / 'oracle-jpmc-210801278.json').read_text(encoding='utf-8'))
ORACLE_CLOSED = (FIXTURES / 'oracle-eeho-us2-closed.json').read_text(encoding='utf-8')
SR_CLOSED_ID, ORACLE_CLOSED_ID = '7000064', '7000070'
PULL_FIXTURES = Path(__file__).resolve().parent / 'pull-detail-fixtures'
FIT = json.dumps({'fit_score': 77, 'rationale': 'Invented fit', 'matched': [], 'gaps': []})
TODAY, YESTERDAY = "date('now')", "date('now','-1 day')"


class NativeNight(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        root = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix='nightly-unreadable-')))
        for key, value in dict(DATA_DIR=root, USER_DB=root / 'user.db', CORPUS_DB=root / 'corpus.db',
                               CAREER_DB=root / 'career_db.json', POSTGRES=False, MULTIUSER=True, STORE='sqlite',
                               USER_SUB='invented-person', PER_HOST_DELAY=0.0).items():
            self.stack.enter_context(patch.object(config, key, value))
        self.addCleanup(db._portable_paths.discard, str(config.USER_DB))
        config.CAREER_DB.write_text(json.dumps({'profile': {'experience_summary': 'Invented engineer'}, 'roles': []}))
        self.addCleanup(profile.load.cache_clear)
        self.lock = threading.Lock()
        self.detail_reads, self.unexpected, self.direct, self.completions = [], [], [], 0
        self.stack.enter_context(patch.dict(os.environ, {'CH_NIGHTLY_MATCH': '1', 'CH_TITLES': 'Engineer', 'CH_LIMIT': '50'}))
        self.stack.enter_context(patch.object(http._session, 'request', side_effect=self.no_route))
        with db.connect() as conn:
            for cid, name, ats, token in [(1, 'Invented SR', 'smartrecruiters', 'InventedCo'),
                                          (2, 'Invented WD', 'workday', 'invented:wd5:Careers'),
                                          (3, 'Invented GH', 'greenhouse', 'invented-gh'),
                                          (4, 'Invented EF', 'eightfold', 'invented.eightfold.ai|invented.example'),
                                          (5, 'Invented ORC', 'oracle_orc', 'invented.fa.us2.oraclecloud.com|CX_1|invented.example'),
                                          (6, 'Invented ORC EU', 'oracle_orc', 'invented.fa.em2.oraclecloud.com|CX_1|invented.example')]:
                conn.execute('INSERT INTO corpus.companies(id,name,ats_type,ats_token) VALUES(?,?,?,?)', (cid, name, ats, token))

    def no_route(self, *args, **kwargs):
        with self.lock:
            self.direct.append(args[1] if len(args) > 1 else kwargs.get('url'))
        raise requests.ConnectionError('the native sandbox has no network route')

    def rail(self, body):
        request = json.loads(body)
        if request.get('operation') == 'model-identity':
            return 200, {'ok': True, 'identity': {'version': 1, 'identity': 'e' * 64,
                                                  'primary': {'provider': 'fixture', 'model': 'fixture-model'}}}
        if request.get('operation') == 'employer-detail-get':
            with self.lock:
                self.detail_reads.append(request['url'])
                if request['url'] not in GUARD:
                    self.unexpected.append(request['url'])
            if not GUARD.get(request['url']):
                return 400, {'ok': False, 'error': 'invalid-employer-detail'}
            return self.employer(request['url'])
        with self.lock:
            self.completions += 1
        return 200, {'ok': True, 'text': FIT, 'provider': 'fixture', 'model': 'fixture-model',
                     'modelIdentity': 'e' * 64, 'fallback': False}

    @staticmethod
    def employer(url):
        """What the employer answers the kernel's GET: saved real responses, with the requested posting's id."""
        if 'smartrecruiters' in url:
            posting = url.rsplit('/', 1)[1]
            if posting == SR_CLOSED_ID:
                return 200, {'ok': True, 'status': 404, 'body': SR_CLOSED, 'contentType': 'application/json'}
            return 200, {'ok': True, 'status': 200, 'body': json.dumps({**SR_OPEN, 'id': posting}), 'contentType': 'application/json'}
        if 'oraclecloud' in url:
            requisition = re.search(r'Id=%22([^%]+)%22', url)[1]
            if requisition == ORACLE_CLOSED_ID:
                return 200, {'ok': True, 'status': 200, 'body': ORACLE_CLOSED, 'contentType': 'application/json'}
            item = {**ORACLE_OPEN['items'][0], 'Id': int(requisition)}
            return 200, {'ok': True, 'status': 200, 'body': json.dumps({**ORACLE_OPEN, 'items': [item]}), 'contentType': 'application/json'}
        # Workday in maintenance: the kernel reports the 303, never follows it, and relays no body.
        return 200, {'ok': True, 'status': 303, 'body': '', 'contentType': 'application/json'}

    @contextlib.contextmanager
    def native(self):
        with patch.dict(os.environ, {'OSHAL_EGRESS': 'kernel'}), patch.object(enrich, '_rail_configured', return_value=True), \
                patch.object(enrich, '_rail_post', side_effect=self.rail), patch.object(enrich, '_RAIL_FAILURE', None):
            yield

    def add(self, first, count, company, url, description, posted):
        with db.connect() as conn:
            for n in range(first, first + count):
                job = f'/job/Remote/Engineer_R-{n}' if company == 2 else str(7000000 + n)
                conn.execute('INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,url,description,active,target_role,'
                             f"posted_date,first_seen_at) VALUES(?,?,?,'Engineer',?,?,1,1,{posted},datetime('now'))",
                             (n, company, job, url.format(n=n), description))

    def night(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            exec(compile(CODE, 'shipped-nightly-launcher', 'exec'), {})
        return json.loads(out.getvalue().strip().splitlines()[-1])

    def pending(self):
        with db.connect() as conn:
            return {r[0] for r in conn.execute('SELECT id FROM postings WHERE ai_fit_score IS NULL')}

    def test_native_night_never_spends_a_slot_on_a_job_no_reader_here_can_describe(self):
        self.add(1, 45, 4, 'https://invented.eightfold.ai/careers/job/{n}', None, TODAY)
        # One Workday-feed job whose URL is the board itself, and one aggregator listing that links a Workday posting.
        self.add(46, 1, 2, 'https://invented.wd5.myworkdayjobs.com', '', TODAY)
        self.add(47, 1, 4, 'https://invented.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Engineer_R-{n}', None, TODAY)
        self.add(48, 1, 4, 'https://invented.eightfold.ai/careers/job/{n}', None, TODAY)
        self.add(49, 10, 3, 'https://boards.greenhouse.io/invented/jobs/{n}', 'Invented Linux cloud duties. ' * 50, YESTERDAY)
        # Six SmartRecruiters jobs and six of an Oracle board on an admitted host (the last of each closed), and three of
        # an Oracle board on a host the rail does not admit: none has listing text.
        self.add(59, 6, 1, 'https://jobs.smartrecruiters.com/InventedCo/{n}-engineer', None, TODAY)
        self.add(65, 6, 5, 'https://invented.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/{n}', None, TODAY)
        self.add(71, 3, 6, 'https://invented.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/{n}', None, TODAY)
        with db.connect() as conn:
            row = dict(conn.execute('SELECT * FROM postings WHERE id=48').fetchone())
        job_context.remember(row, {'description': 'A saved private copy of invented duties. ' * 40})
        with self.native():
            first = self.night()
            self.assertEqual((first['scored'], first['skipped']), (21, 4),
                             'ten described jobs, the saved copy and five of each new source are scored; '
                             'the two Workday redirects and the two closed postings skip')
            self.assertEqual(self.pending(), set(range(1, 48)) | {64, 70, 71, 72, 73})
            self.assertEqual(self.completions, 21)
            self.assertEqual(sorted(self.detail_reads), sorted(url for url, admitted in GUARD.items() if admitted),
                             'one read for each Workday, SmartRecruiters and admitted Oracle job, and no other')
            for job in [59, 60, 61, 62, 63]:
                self.assertIn('Molding and Assembly', self.saved(job) or '', 'the SmartRecruiters job ad was kept and scored')
            for job in [65, 66, 67, 68, 69]:
                self.assertIn('software engineering leader', self.saved(job) or '', 'the Oracle requisition was kept and scored')
            second = self.night()
            self.assertEqual((second['scored'], second['skipped']), (0, 4),
                             'the next night tries the Workday jobs and the closed postings again, and never the jobs nothing here can read')
            self.assertEqual(len(self.detail_reads), 14 + 4)
        self.assertEqual(self.unexpected, [], 'every detail URL the engine asked for was judged by the real guard')
        self.assertFalse(any('eightfold' in url or 'em2' in url for url in self.detail_reads))
        refused = {f'https://jobs.smartrecruiters.com/InventedCo/64-engineer',
                   'https://invented.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/70',
                   'https://invented.wd5.myworkdayjobs.com',
                   'https://invented.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Engineer_R-47'}
        self.assertEqual(set(map(str, self.direct)), refused,
                         'only a refused job reaches the unchanged JSON-LD page fallback, which has no route here')

    def saved(self, job):
        with db.connect() as conn:
            row = dict(conn.execute('SELECT * FROM postings WHERE id=?', (job,)).fetchone())
        saved = job_context.read(row)
        return saved and saved['description']

    def kept_by_the_pull(self):
        """(kind, token, listing text) for each saved page the pull reads, as posting_page.read keeps it."""
        kept = []
        for entry in json.loads((PULL_FIXTURES / 'index.json').read_text(encoding='utf-8'))['fixtures']:
            if entry.get('outcome'):
                continue
            body = (PULL_FIXTURES / entry['file']).read_text(encoding='utf-8')
            answer = requests.Response()
            answer.status_code, answer._content, answer._content_consumed = 200, body.encode('utf-8'), True
            answer.headers['Content-Type'] = entry['contentType']
            with patch.object(http._session, 'request', return_value=answer):
                text, outcome = posting_page.read(entry['kind'], entry['token'], {'url': entry['url'],
                                                  'ats_job_id': entry['jobId'], 'title': entry['title']})
            self.assertEqual(outcome, 'saved', entry['file'])
            kept.append((entry['kind'], entry['token'], text))
        from jobhunter.ats_custom import Google
        page = (PULL_FIXTURES / 'google-results-page-1.html').read_text(encoding='utf-8')
        kept.append(('google', 'google', next(iter(Google.descriptions(page).values()))))
        return kept

    def test_native_night_scores_jobs_whose_description_the_pull_kept_with_no_detail_read(self):
        kept = self.kept_by_the_pull()
        with db.connect() as conn:
            for index, (kind, token, _) in enumerate(kept):
                conn.execute('INSERT INTO corpus.companies(id,name,ats_type,ats_token) VALUES(?,?,?,?)',
                             (100 + index, f'Invented {kind} {index}', kind, token))
        for index, (kind, _, text) in enumerate(kept):
            self.add(200 + index, 1, 100 + index, 'https://invented.example/careers/job/{n}', text, TODAY)
            self.add(300 + index, 1, 100 + index, 'https://invented.example/careers/job/{n}', None, TODAY)
        with self.native():
            result = self.night()
        self.assertEqual((result['scored'], result['skipped']), (len(kept), 0),
                         'each job with kept text is scored; jobs of the same sources with no text take no slot')
        self.assertEqual(self.pending(), {300 + index for index in range(len(kept))})
        self.assertEqual((self.detail_reads, self.direct), ([], []), 'scoring read nothing: no rail read, no direct read')

    def test_off_native_the_same_jobs_stay_candidates_for_the_direct_readers(self):
        self.add(1, 3, 4, 'https://invented.eightfold.ai/careers/job/{n}', None, TODAY)
        fetched = []
        def read(ats, token, job, url):
            fetched.append(job)
            return {'description': 'Employer text for an invented job. ' * 40}
        with patch.object(score.detail, 'fetch', side_effect=read), patch.object(enrich, 'provider', return_value='fixture'), \
                patch.object(enrich, 'complete_scoring', return_value=enrich.ScoringAnswer(FIT, 'fixture-model')):
            result = self.night()
        self.assertEqual((result['scored'], result['skipped']), (3, 0))
        self.assertEqual(sorted(fetched), ['7000001', '7000002', '7000003'])


if __name__ == '__main__':
    unittest.main(argv=['nightly-unreadable'], verbosity=2)
