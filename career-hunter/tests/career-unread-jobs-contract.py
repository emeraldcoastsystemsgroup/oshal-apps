# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.66.0 (Roger, 2026-11-15: "i want jobs flowing in.. even if we can only see their title .. at least run it up with a warning"): the shipped nightly launcher on the native rail over a disposable person with invented readable and unreadable jobs, in both nightly passes. Readable jobs are scored; jobs no reader there can describe are marked "details needed" with no read and no model call, best title and keyword matches first and at most the night's bound; a job whose one read is refused is marked after that read; a dismissed job, a job none of the person's titles names, a close call and an AI-scored job are never marked. The node wrapper then lists the same stores through the shipped board feed.
"""Disposable owner and corpus stores, the real nightly launcher, score selection, job context and the native rail guard.

Replaced: the model (a fixed fit, counted), the Career rail (a Workday read answers the maintenance redirect, every other
detail read is refused as the guard refuses it), and direct networking (the native sandbox has no route). The stores are
left in the folder the node wrapper gives, which reads them with the shipped feed and removes them.
"""
import contextlib
import io
import json
import os
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
from jobhunter import config, db, enrich, http, profile, score

INPUT = json.loads(sys.stdin.read())
CODE, ROOT = INPUT['code'], Path(INPUT['root'])
FIT = json.dumps({'fit_score': 77, 'rationale': 'Invented fit', 'matched': [], 'gaps': []})
TEXT = 'Invented duties for an invented engineering job: build and run invented services. ' * 20
# id: (company, title, listing text, keyword fit, status, ai_fit_score, ai_model). Company 1 Greenhouse (no reader on the
# native kernel, so only listing text describes it), 2 Workday (read through the rail), 3 Eightfold (no reader).
JOBS = {
    1: (1, 'Platform Engineer', TEXT, 60, None, None, None),
    2: (1, 'Engineer', TEXT, 50, None, None, None),
    3: (1, 'Data Engineer', TEXT, 40, None, None, None),
    10: (3, 'Platform Engineer', None, 20, None, None, None),     # both titles: first
    11: (3, 'Engineer', None, 90, None, None, None),              # one title, best keyword
    12: (3, 'Engineer', None, 30, None, None, None),
    13: (3, 'Site Engineer', None, 10, None, None, None),
    14: (3, 'Engineer', None, 80, 'dismissed', None, None),       # removed by the person
    15: (3, 'Accountant', None, 99, None, None, None),            # no saved title names it
    16: (3, 'Engineer', None, 70, None, None, '{"undecided":1,"runs":[60,75,80],"why":"sides","at":"2026-11-14T06:00:00+00:00"}'),
    17: (3, 'Engineer', None, 70, None, 64, '{"provider":"fixture","model":"fixture-model"}'),
    20: (2, 'Engineer', '', 15, None, None, None),                # Workday, no text: one read, refused
}
UNREAD_ORDER = [10, 11, 12, 13]


class UnreadNight(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.root = ROOT / self._testMethodName
        self.root.mkdir(parents=True)
        for key, value in dict(DATA_DIR=self.root, USER_DB=self.root / 'user.db', CORPUS_DB=self.root / 'corpus.db',
                               CAREER_DB=self.root / 'career_db.json', POSTGRES=False, MULTIUSER=True, STORE='sqlite',
                               USER_SUB='invented-person', PER_HOST_DELAY=0.0).items():
            self.stack.enter_context(patch.object(config, key, value))
        self.addCleanup(db._portable_paths.discard, str(config.USER_DB))
        config.CAREER_DB.write_text(json.dumps({'profile': {'experience_summary': 'Invented engineer'}, 'roles': []}))
        self.addCleanup(profile.load.cache_clear)
        self.lock = threading.Lock()
        self.reads, self.direct, self.completions = [], [], 0
        self.stack.enter_context(patch.dict(os.environ, {'CH_NIGHTLY_MATCH': '1', 'CH_TITLES': 'Engineer\nPlatform',
                                                         'CH_LIMIT': '50'}))
        self.stack.enter_context(patch.object(http._session, 'request', side_effect=self.no_route))
        with db.connect() as conn:
            for cid, name, ats, token in [(1, 'Invented GH', 'greenhouse', 'invented-gh'),
                                          (2, 'Invented WD', 'workday', 'invented:wd5:Careers'),
                                          (3, 'Invented EF', 'eightfold', 'invented.eightfold.ai|invented.example')]:
                conn.execute('INSERT INTO corpus.companies(id,name,ats_type,ats_token) VALUES(?,?,?,?)', (cid, name, ats, token))
            for job, (company, title, text, keyword, status, fit, model) in JOBS.items():
                url = (f'https://invented.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Engineer_R-{job}' if company == 2
                       else f'https://invented.example/careers/job/{job}')
                conn.execute('INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,url,description,active,'
                             "target_role,posted_date,first_seen_at) VALUES(?,?,?,?,?,?,1,1,date('now','-' || ? || ' days'),"
                             "datetime('now'))", (job, company, str(7000000 + job), title, url, text, job % 7))
                conn.execute('INSERT INTO user_signals(posting_id,fit_score,status,ai_fit_score,ai_model) VALUES(?,?,?,?,?)',
                             (job, keyword, status or 'new', fit, model))

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
                self.reads.append(request['url'])
            if 'myworkdayjobs' in request['url']:
                return 200, {'ok': True, 'status': 303, 'body': '', 'contentType': 'application/json'}
            return 400, {'ok': False, 'error': 'invalid-employer-detail'}
        with self.lock:
            self.completions += 1
        return 200, {'ok': True, 'text': FIT, 'provider': 'fixture', 'model': 'fixture-model',
                     'modelIdentity': 'e' * 64, 'fallback': False}

    @contextlib.contextmanager
    def native(self):
        with patch.dict(os.environ, {'OSHAL_EGRESS': 'kernel'}), patch.object(enrich, '_rail_configured', return_value=True), \
                patch.object(enrich, '_rail_post', side_effect=self.rail), patch.object(enrich, '_RAIL_FAILURE', None):
            yield

    def night(self, **env):
        out = io.StringIO()
        with patch.dict(os.environ, env), contextlib.redirect_stdout(out):
            exec(compile(CODE, 'shipped-nightly-launcher', 'exec'), {})
        return json.loads(out.getvalue().strip().splitlines()[-1])

    def signals(self):
        with db.connect() as conn:
            return {r['posting_id']: dict(r) for r in conn.execute('SELECT posting_id,ai_fit_score,ai_model FROM user_signals')}

    def marked(self):
        return {job for job, row in self.signals().items() if str(row['ai_model'] or '').startswith(score.NEEDS_DETAILS_PREFIX)}

    def check_night(self, result, scored_calls):
        signals = self.signals()
        self.assertEqual({job for job in (1, 2, 3) if signals[job]['ai_fit_score'] == 77}, {1, 2, 3}, 'readable jobs are scored')
        self.assertEqual(self.completions, scored_calls, 'model calls only for the three readable jobs')
        self.assertEqual(self.marked(), set(UNREAD_ORDER) | {20}, 'every unreadable job the titles select is marked, and no other')
        for job in UNREAD_ORDER + [20]:
            self.assertIsNone(signals[job]['ai_fit_score'], 'a marked job has no score, never a low one')
            mark = json.loads(signals[job]['ai_model'])
            self.assertEqual(mark['needsDetails'], 1)
        self.assertTrue(signals[16]['ai_model'].startswith('{"undecided":1'), 'a close call keeps its runs')
        self.assertEqual((signals[17]['ai_fit_score'], signals[17]['ai_model']), (64, '{"provider":"fixture","model":"fixture-model"}'))
        self.assertTrue(self.reads and all('myworkdayjobs.com' in url and '7000020' in url or 'Engineer_R-20' in url for url in self.reads),
                        f'reads only for the Workday job; none for the jobs no reader here can describe: {self.reads}')
        self.assertFalse(any('eightfold' in str(url) or 'invented.example' in str(url) for url in self.reads + self.direct),
                         f'nothing is read for a job no reader here can describe: {self.reads} {self.direct}')

    def test_the_nightly_pass_lists_unreadable_jobs_without_a_read_or_a_model_call(self):
        with self.native():
            first = self.night()
        self.assertEqual((first['scored'], first['skipped'], first['needsDetails']), (3, 1, 4),
                         'three scored, the Workday job skipped after its read; four listed without a read')
        self.check_night(first, 3)
        with self.native():
            second = self.night()
        self.assertEqual((second['scored'], second['skipped'], second['needsDetails']), (0, 1, 0),
                         'the next night marks nothing twice and tries only the Workday job again')
        self.assertEqual(self.completions, 3)
        self.assertEqual(self.marked(), set(UNREAD_ORDER) | {20})

    def test_the_settled_pass_lists_them_too_and_counts_the_refused_read(self):
        with self.native():
            result = self.night(CH_SETTLE='1', CH_LIMIT='400', CH_CONCURRENCY='1', CH_BAND='6', CH_BUDGET_SECONDS='600')
        self.assertEqual((result['scored'], result['unreadable'], result['needsDetails']), (3, 1, 5),
                         'three settled; the Workday job unreadable and marked; five listed in all')
        self.check_night(result, 9)

    def test_the_night_marks_at_most_its_bound_best_first(self):
        with self.native(), patch.object(score, 'UNREAD_NIGHTLY_LIMIT', 2):
            result = self.night()
        self.assertEqual(result['needsDetails'], 2)
        self.assertEqual(self.marked() - {20}, set(UNREAD_ORDER[:2]),
                         'both saved titles first, then the best keyword match among one-title jobs')
        with self.native(), patch.object(score, 'UNREAD_NIGHTLY_LIMIT', 2):
            self.night()
        self.assertEqual(self.marked() - {20}, set(UNREAD_ORDER), 'the next night marks the next best')

    def test_off_native_nothing_is_marked_without_a_read(self):
        fetched = []

        def read(ats, token, job, url):
            fetched.append(job)
            return {}
        with patch.object(score.detail, 'fetch', side_effect=read), patch.object(enrich, 'provider', return_value='fixture'), \
                patch.object(enrich, 'complete_scoring', return_value=enrich.ScoringAnswer(FIT, 'fixture-model')):
            result = self.night()
        self.assertEqual(result['needsDetails'], 0, 'off the native kernel no job is known unreadable before its read')
        self.assertEqual(self.marked(), set(UNREAD_ORDER) | {20}, 'each job whose read gave nothing is marked after it, '
                         'and the close call it also read keeps its runs')
        self.assertEqual(sorted(fetched), sorted(str(7000000 + job) for job in UNREAD_ORDER + [16, 20]))


if __name__ == '__main__':
    unittest.main(argv=['unread-jobs'], verbosity=2)
