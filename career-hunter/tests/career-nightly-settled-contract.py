# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Settled nightly scoring through the shipped launcher on disposable stores: the settling rule (majority, median, band, a failed run, no majority), its bounds, a fixture night answered with the per-posting scores Token Chase measured (the shortlist equals Sonnet's settled one; the two close calls are left undecided, asked again once, then left out), the best candidates first, a night that runs out of time ending on its own and the next night continuing, and the off switch reproducing 1.63.0's recorded night exactly.
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.66.0: the off-switch night is still 1.63.0's call for call, read for read and line for line, with one intended difference compared outside the recording: the jobs the night cannot read are marked "details needed" (no score) and its count line says how many it marked without a read (needsDetails). The comparison takes both out, then checks them: the three Workday jobs whose read is refused and the three jobs nothing here can read are marked, and nothing else changed.
"""Disposable owner and corpus stores, the real nightly launcher, selection, job context and the settled pass.

Replaced: the model (scripted answers; for the Token Chase postings, the scores it measured, in run order), the Career
rail (answering model-identity, employer-detail-get as a Workday maintenance redirect, and completions), the clock of
the time-budget case, and direct networking (the native sandbox has no route).

`{"mode": "record"}` on stdin runs only the off-switch night and prints its observation: run from an export of
career-hunter 1.63.0 (99aca0bc), that produced tests/fixtures/nightly-off-switch-1.63.0.json.
"""
import contextlib
import hashlib
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

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
from jobhunter import config, db, enrich, http, profile  # noqa: E402

INPUT = json.loads(sys.stdin.read())
CODE, MODE = INPUT['code'], INPUT.get('mode', 'check')
GOLDEN = HERE / 'fixtures' / 'nightly-off-switch-1.63.0.json'
IDENTITY = {'version': 1, 'identity': 'e' * 64, 'primary': {'provider': 'fixture', 'model': 'fixture-model'}}
TODAY, YESTERDAY, EARLIER = "date('now')", "date('now','-1 day')", "date('now','-2 days')"
TC_TITLES = 'Engineer\nEngineering\nAnalyst\nArchitect\nScientist\nAdministrator\nNurse\nDriver\nAccountant\nTeacher\nManager'


def fit_document(fit):
    return json.dumps({'fit_score': fit, 'rationale': f'Invented fit {fit}', 'matched': ['invented'], 'gaps': []})


class Night(unittest.TestCase):
    """One disposable person, corpus and rail; `answer(prompt)` is what the model says to one completion."""

    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        root = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix='nightly-settled-')))
        for key, value in dict(DATA_DIR=root, USER_DB=root / 'user.db', CORPUS_DB=root / 'corpus.db',
                               CAREER_DB=root / 'career_db.json', POSTGRES=False, MULTIUSER=True, STORE='sqlite',
                               USER_SUB='invented-person', PER_HOST_DELAY=0.0).items():
            self.stack.enter_context(patch.object(config, key, value))
        self.addCleanup(db._portable_paths.discard, str(config.USER_DB))
        config.CAREER_DB.write_text(json.dumps({'profile': {'experience_summary': 'Invented engineer'}, 'roles': []}))
        self.addCleanup(profile.load.cache_clear)
        self.lock = threading.Lock()
        self.bodies, self.prompts, self.reads, self.at_once, self.most_at_once = [], [], [], 0, 0
        self.stack.enter_context(patch.object(http._session, 'request', side_effect=self.no_route))
        self.stack.enter_context(patch.dict(os.environ, {'OSHAL_EGRESS': 'kernel'}))
        self.stack.enter_context(patch.object(enrich, '_rail_configured', return_value=True))
        self.stack.enter_context(patch.object(enrich, '_rail_post', side_effect=self.rail))
        self.stack.enter_context(patch.object(enrich, '_RAIL_FAILURE', None))
        with db.connect() as conn:
            for cid, name, ats, token in [(1, 'Invented GH', 'greenhouse', 'invented-gh'),
                                          (2, 'Invented WD', 'workday', 'invented:wd5:Careers'),
                                          (3, 'Invented EF', 'eightfold', 'invented.eightfold.ai|invented.example')]:
                conn.execute('INSERT INTO corpus.companies(id,name,ats_type,ats_token) VALUES(?,?,?,?)', (cid, name, ats, token))

    @staticmethod
    def no_route(*args, **kwargs):
        raise requests.ConnectionError('the native sandbox has no network route')

    def rail(self, body):
        request = json.loads(body)
        if request.get('operation') == 'model-identity':
            return 200, {'ok': True, 'identity': IDENTITY}
        if request.get('operation') == 'employer-detail-get':
            with self.lock:
                self.reads.append(request['url'])
            return 200, {'ok': True, 'status': 303, 'body': '', 'contentType': 'application/json'}
        with self.lock:
            self.bodies.append(body)
            self.prompts.append(request['prompt'])
            self.at_once += 1
            self.most_at_once = max(self.most_at_once, self.at_once)
        try:
            text = self.answer(request['prompt'])
        finally:
            with self.lock:
                self.at_once -= 1
        return 200, {'ok': True, 'text': text, 'provider': 'fixture', 'model': 'fixture-model',
                     'modelIdentity': 'e' * 64, 'fallback': False}

    def add(self, n, company, title, description, posted, url=None, fit_score=None):
        with db.connect() as conn:
            conn.execute('INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,url,description,active,'
                         f"target_role,posted_date,first_seen_at) VALUES(?,?,?,?,?,?,1,1,{posted},datetime('now'))",
                         (n, company, str(7000000 + n), title, url or f'https://boards.greenhouse.io/invented/jobs/{n}',
                          description))
            if fit_score is not None:
                db.user_set(conn, n, fit_score=fit_score)

    def night(self, **env):
        out = io.StringIO()
        with patch.dict(os.environ, {'CH_NIGHTLY_MATCH': '1', 'CH_LIMIT': '50', 'CH_TITLES': 'Engineer', **env}), \
                contextlib.redirect_stdout(out):
            exec(compile(CODE, 'shipped-nightly-launcher', 'exec'), {})
        lines = out.getvalue().strip().splitlines()
        return json.loads(lines[-1]), lines

    def rows(self):
        with db.connect() as conn:
            return {r['id']: dict(r) for r in conn.execute('SELECT * FROM postings ORDER BY id')}

    @staticmethod
    def posting_of(prompt):
        return re.search(r'^Company: (.*)$', prompt, re.M)[1], re.search(r'^Title: (.*)$', prompt, re.M)[1]


class OffSwitch(Night):
    """Without CH_SETTLE the nightly pass is 1.63.0's, call for call, line for line and row for row."""

    def answer(self, prompt):
        n = int(self.posting_of(prompt)[1].split()[-1])
        if n % 13 == 0:
            return 'not a JSON answer'
        if n % 11 == 0 and 'compact JSON object' not in prompt:
            return '{"fit_score": "high"}'
        return fit_document((n * 37) % 101)

    def fixture(self):
        for n in range(1, 61):
            self.add(n, 1, f'Engineer {n}', f'Invented duties for posting {n}. ' * 40,
                     (TODAY, YESTERDAY, EARLIER)[n % 3])
        for n in range(61, 64):  # Workday jobs with no listing text: a maintenance redirect, skipped, tried again
            self.add(n, 2, f'Engineer {n}', '', TODAY, url='https://invented.wd5.myworkdayjobs.com')
        for n in range(64, 67):  # nothing on the native kernel can read these: never selected
            self.add(n, 3, f'Engineer {n}', None, TODAY, url=f'https://invented.eightfold.ai/careers/job/{n}')

    def observe(self, **env):
        nights = []
        for _ in range(2):
            self.bodies.clear()
            self.reads.clear()
            verdict, lines = self.night(**env)
            nights.append({'lines': lines, 'verdict': verdict, 'reads': sorted(self.reads),
                           'completions': sorted(hashlib.sha256(body).hexdigest() for body in self.bodies)})
        keep = ('fit_score', 'ai_fit_score', 'ai_fit_rationale', 'ai_fit_matched', 'ai_fit_gaps', 'ai_model',
                'ai_input_fingerprint', 'status', 'description')
        rows = {str(n): {key: (hashlib.sha256(row[key].encode()).hexdigest() if key == 'description' and row[key] else row.get(key))
                         for key in keep} for n, row in self.rows().items()}
        return {'nights': nights, 'rows': rows}

    def unread_marks_apart(self, observation):
        """1.66.0's one difference from the recorded 1.63.0 night, taken out and checked: the marks and their count."""
        marked = sorted(int(n) for n, row in observation['rows'].items()
                        if str(row['ai_model'] or '').startswith('{"needsDetails":'))
        for n in marked:
            self.assertIsNone(observation['rows'][str(n)]['ai_fit_score'], 'a marked job has no score')
            observation['rows'][str(n)]['ai_model'] = None
        counts = []
        for night in observation['nights']:
            counts.append(night['verdict'].pop('needsDetails'))
            line = json.loads(night['lines'][-1])
            line.pop('needsDetails')
            night['lines'][-1] = json.dumps(line)
        self.assertEqual(marked, [61, 62, 63, 64, 65, 66], 'the refused Workday jobs and the jobs nothing here can read')
        self.assertEqual(counts, [3, 0], 'three marked without a read on the first night, none twice')
        return observation

    def test_off_switch_is_1_63_0_night_for_night(self):
        self.fixture()
        if MODE == 'record':
            print('OBSERVATION ' + json.dumps(self.observe(), sort_keys=True))
            return
        golden = json.loads(GOLDEN.read_text())['observation']
        self.assertEqual(self.unread_marks_apart(self.observe()), golden, 'no CH_SETTLE: exactly the night 1.63.0 recorded')

    def test_a_settle_value_other_than_1_is_off(self):
        self.fixture()
        if MODE == 'record':
            self.skipTest('recorded once, without CH_SETTLE')
        golden = json.loads(GOLDEN.read_text())['observation']
        self.assertEqual(self.unread_marks_apart(self.observe(CH_SETTLE='0')), golden)


class Rule(unittest.TestCase):
    def setUp(self):
        from jobhunter import settle
        self.settle = settle.settle

    def test_three_runs_on_one_side_outside_the_band_settle_on_the_median(self):
        self.assertEqual(self.settle([92, 95, 88]), {'outcome': 'settled', 'score': 92, 'above': True, 'why': None})
        self.assertEqual(self.settle([12, 30, 5]), {'outcome': 'settled', 'score': 12, 'above': False, 'why': None})

    def test_the_band_is_half_open_around_the_line(self):
        self.assertEqual(self.settle([63, 63, 63])['outcome'], 'settled')
        self.assertEqual(self.settle([64, 64, 64])['why'], 'band')
        self.assertEqual(self.settle([75, 75, 75])['why'], 'band')
        self.assertEqual(self.settle([76, 76, 76]), {'outcome': 'settled', 'score': 76, 'above': True, 'why': None})
        self.assertEqual(self.settle([60, 66, 40])['outcome'], 'settled', 'the median decides the band, not one run')
        self.assertEqual(self.settle([66, 50, 68])['why'], 'band')
        self.assertEqual(self.settle([69, 69, 69], band=0)['outcome'], 'settled', 'band 0: only the side counts')

    def test_runs_that_disagree_about_the_side_are_a_close_call_with_the_majority_named(self):
        self.assertEqual(self.settle([45, 72, 25]), {'outcome': 'close', 'score': None, 'above': False, 'why': 'sides'})
        self.assertEqual(self.settle([90, 92, 40]), {'outcome': 'close', 'score': None, 'above': True, 'why': 'sides'})

    def test_a_failed_run_is_a_run_on_neither_side_and_fewer_than_two_valid_runs_score_nothing(self):
        self.assertEqual(self.settle([92, 95, None]), {'outcome': 'close', 'score': None, 'above': True, 'why': 'failed-run'})
        self.assertEqual(self.settle([80, None, 40]), {'outcome': 'close', 'score': None, 'above': None, 'why': 'failed-run'},
                         'one above, one below, one failed: no majority, a tie')
        self.assertEqual(self.settle([None, None, 93]), {'outcome': 'failed', 'score': None, 'above': None, 'why': None},
                         'one valid run is not scored: Not scored yet, pending for the next night')
        self.assertEqual(self.settle([None, None, None]), {'outcome': 'failed', 'score': None, 'above': None, 'why': None})
        self.assertEqual(self.settle([True, 101, -1])['outcome'], 'failed', 'only a score from 0 to 100 is a score')

    def test_bounds_refuse_a_run_outside_them(self):
        from jobhunter import settle
        good = {'CH_LIMIT': '400', 'CH_CONCURRENCY': '3', 'CH_BAND': '6', 'CH_BUDGET_SECONDS': '1200'}
        self.assertEqual((settle.night_from_env(good).limit, settle.night_from_env(good).budget), (400, 1200))
        for key, bad in [('CH_LIMIT', '0'), ('CH_LIMIT', '2001'), ('CH_CONCURRENCY', '4'), ('CH_BAND', '16'),
                         ('CH_BUDGET_SECONDS', '59'), ('CH_BUDGET_SECONDS', '1501'), ('CH_LIMIT', 'many'), ('CH_BAND', '')]:
            with self.assertRaisesRegex(ValueError, 'Invalid nightly matching bounds'):
                settle.night_from_env({**good, key: bad})


SETTLED = {'CH_SETTLE': '1', 'CH_LIMIT': '400', 'CH_CONCURRENCY': '3', 'CH_BAND': '6', 'CH_BUDGET_SECONDS': '1200'}


class MeasuredNight(Night):
    """Token Chase's 24 postings, the model answering each run with the score the local model gave that run."""

    def setUp(self):
        super().setUp()
        measured = json.loads((HERE / 'fixtures' / 'settled-scoring-tc2-answers.json').read_text())['postings']
        self.measured = {(p['company'], p['title']): p for p in measured}
        self.asked = {}
        for n, p in enumerate(measured, 1):
            self.add(n, 1, p['title'], f"Invented duties of {p['title']} at {p['company']}. " * 40, TODAY)
            with db.connect() as conn:
                conn.execute('UPDATE corpus.postings_corpus SET location=? WHERE id=?', (p['company'], n))
        self.index = {p['title'] + '|' + p['company']: n for n, p in enumerate(measured, 1)}

    def answer(self, prompt):
        company, title = self.posting_of(prompt)
        posting = next(p for p in self.measured.values() if p['title'] == title)
        with self.lock:
            at = self.asked[title] = self.asked.get(title, 0) + 1
        return fit_document(posting['local'][(at - 1) % 3])

    def test_the_settled_shortlist_is_sonnets_and_the_close_calls_wait(self):
        verdict, _ = self.night(CH_TITLES=TC_TITLES, **SETTLED)
        sonnet = {n for n, p in enumerate(self.measured.values(), 1) if sum(fit >= 70 for fit in p['sonnet']) >= 2}
        self.assertEqual(sonnet, set(range(1, 7)), "Sonnet's settled shortlist: the six strong postings")
        rows = self.rows()
        shortlisted = {n for n, row in rows.items() if (row['ai_fit_score'] or 0) >= 70}
        self.assertEqual(shortlisted, sonnet)
        undecided = {n for n, row in rows.items() if row['ai_fit_score'] is None}
        self.assertEqual(undecided, {9, 12}, 'Data Engineer (GCP, Scala) 65/45/65 (band) and the pre-sales architect 45/72/25 (sides)')
        self.assertEqual(json.loads(rows[12]['ai_model']), {**json.loads(rows[12]['ai_model']), 'undecided': 1,
                                                            'runs': [45, 72, 25], 'why': 'sides'})
        self.assertTrue(rows[9]['ai_model'].startswith('{"undecided":1,"runs":[65,45,65],"why":"band"'))
        self.assertEqual(json.loads(rows[1]['ai_model'])['settled'], {'runs': [92, 92, 92], 'band': 6})
        self.assertEqual(rows[1]['ai_fit_score'], 92)
        self.assertEqual({k: verdict[k] for k in ('mode', 'scored', 'undecided', 'unreadable', 'failed', 'notReached',
                                                  'calls', 'stoppedForTime')},
                         {'mode': 'settled', 'scored': 22, 'undecided': 2, 'unreadable': 0, 'failed': 0, 'notReached': 0,
                          'calls': 72, 'stoppedForTime': False})
        self.assertEqual(sorted(set(self.asked.values())), [3], 'every posting asked exactly three times, no fourth call')
        for title in self.asked:
            bodies = {body for body in self.bodies if self.posting_of(json.loads(body)['prompt'])[1] == title}
            self.assertEqual(len(bodies), 1, f'three byte-identical calls for {title}')
        self.assertLessEqual(self.most_at_once, 3)
        self.bodies.clear()
        second, _ = self.night(CH_TITLES=TC_TITLES, **SETTLED)
        self.assertEqual((second['undecided'], second['calls'], second['scored']), (2, 6, 0), 'asked again the next night')
        self.assertTrue(self.rows()[12]['ai_model'].startswith('{"undecided":2,'))
        third, _ = self.night(CH_TITLES=TC_TITLES, **SETTLED)
        self.assertEqual((third['calls'], third['candidates'], third['notReached']), (0, 0, 0),
                         'after two nights a close call waits for Check my fit')


class EmptyAnswers(Night):
    """An answer with no text is refused by the kernel as unavailable; the rail says so with detail empty-answer."""

    def setUp(self):
        super().setUp()
        self.empty = {}  # posting -> how many of its calls come back with no text
        rail = self.rail

        def answer_or_empty(body):
            request = json.loads(body)
            if 'prompt' in request:
                n = int(re.search(r'posting (\d+)\.', request['prompt'])[1])
                with self.lock:
                    if self.empty.get(n, 0) > 0:
                        self.empty[n] -= 1
                        self.prompts.append(request['prompt'])
                        return 503, {'ok': False, 'error': 'career-worker-unavailable', 'detail': 'empty-answer'}
            return rail(body)
        self.stack.enter_context(patch.object(enrich, '_rail_post', side_effect=answer_or_empty))
        for n in range(1, 5):
            self.add(n, 1, 'Engineer', f'Invented duties of posting {n}. ' * 40, TODAY, fit_score=50 - n)

    def answer(self, prompt):
        return fit_document(90)

    def test_an_answer_with_no_text_is_one_unanswered_try_and_never_ends_the_pass(self):
        self.empty = {1: 1, 2: 2, 3: 4}  # 1: the retry answers; 2: one run fails; 3: two runs fail; 4: none
        verdict, _ = self.night(**{**SETTLED, 'CH_CONCURRENCY': '1'})
        rows = self.rows()
        self.assertEqual(rows[1]['ai_fit_score'], 90, 'an empty first try, then the retry answered: three valid runs')
        self.assertIsNone(rows[2]['ai_fit_score'])
        self.assertTrue(rows[2]['ai_model'].startswith('{"undecided":1,"runs":[null,90,90],"why":"failed-run"'),
                        'one failed run of three: a close call, no side counted for it')
        self.assertIsNone(rows[3]['ai_fit_score'])
        self.assertIsNone(rows[3]['ai_model'], 'one valid run of three: not scored yet, nothing recorded, pending')
        self.assertEqual(rows[4]['ai_fit_score'], 90, 'the pass went on after the empty answers')
        self.assertEqual({k: verdict[k] for k in ('scored', 'undecided', 'failed', 'notReached', 'calls')},
                         {'scored': 2, 'undecided': 1, 'failed': 1, 'notReached': 0, 'calls': 4 + 4 + 5 + 3})

    def test_switched_off_the_same_answer_ends_the_pass_as_in_1_63_0(self):
        self.empty = {2: 2}
        with self.assertRaises(enrich.CareerWorkerUnavailable):
            self.night()
        self.assertEqual(enrich._RAIL_FAILURE.reason, 'career-worker-unavailable')


class Order(Night):
    def answer(self, prompt):
        return fit_document(90)

    def test_the_best_candidates_are_asked_first_and_the_rest_are_not_reached(self):
        for n, title, posted, keyword in [(1, 'Engineer', TODAY, 10), (2, 'Data Engineer', EARLIER, 5),
                                          (3, 'Engineer', YESTERDAY, 40), (4, 'Engineer', TODAY, 40),
                                          (5, 'Senior Data Engineer', EARLIER, 1), (6, 'Engineer', EARLIER, 0)]:
            self.add(n, 1, title, f'Invented duties of posting {n}. ' * 40, posted, fit_score=keyword)
        verdict, _ = self.night(CH_TITLES='Data Engineer\nEngineer', **{**SETTLED, 'CH_CONCURRENCY': '1', 'CH_LIMIT': '4'})
        asked = [int(re.search(r'posting (\d+)\.', prompt)[1]) for prompt in self.prompts]
        self.assertEqual(asked, [n for n in (2, 5, 4, 3) for _ in range(3)],
                         'two saved titles first, then the keyword match, then the newest; three runs each in turn')
        self.assertEqual((verdict['scored'], verdict['notReached'], verdict['candidates']), (4, 2, 6))
        self.assertIsNone(self.rows()[1]['ai_fit_score'], 'a job not reached has no score, never a low one')


class Budget(Night):
    """A run whose time is up starts no further job, ends on its own and keeps what it scored."""

    def answer(self, prompt):
        self.now[0] += 10.0
        return fit_document(90)

    def test_a_night_that_runs_out_of_time_stops_cleanly_and_the_next_continues(self):
        from jobhunter import settle
        for n in range(1, 11):
            self.add(n, 1, 'Engineer', f'Invented duties {n}. ' * 80, TODAY, fit_score=100 - n)
        self.now = [1000.0]
        fake = type('Clock', (), {'monotonic': staticmethod(lambda: self.now[0])})
        with patch.object(settle, 'time', fake):
            first, _ = self.night(**{**SETTLED, 'CH_CONCURRENCY': '1', 'CH_BUDGET_SECONDS': '60'})
        self.assertEqual((first['scored'], first['notReached'], first['stoppedForTime'], first['seconds'], first['calls']),
                         (2, 8, True, 60, 6), 'jobs start at 0 s and 30 s; at 60 s the time is up')
        self.assertEqual({n for n, row in self.rows().items() if row['ai_fit_score'] is not None}, {1, 2})
        self.now = [5000.0]
        with patch.object(settle, 'time', fake):
            second, _ = self.night(**{**SETTLED, 'CH_CONCURRENCY': '1', 'CH_BUDGET_SECONDS': '60'})
        self.assertEqual((second['scored'], second['notReached']), (2, 6))
        self.assertEqual({n for n, row in self.rows().items() if row['ai_fit_score'] is not None}, {1, 2, 3, 4},
                         'the next run takes the next best jobs')

    def test_a_job_whose_time_runs_out_between_runs_stops_after_the_grace(self):
        from jobhunter import settle
        self.add(1, 1, 'Engineer', 'Invented duties. ' * 80, TODAY)
        self.now = [0.0]
        fake = type('Clock', (), {'monotonic': staticmethod(lambda: self.now[0])})
        slow = lambda prompt: (self.now.__setitem__(0, self.now[0] + 200.0), fit_document(90))[1]  # noqa: E731
        with patch.object(settle, 'time', fake), patch.object(self, 'answer', side_effect=slow):
            verdict, _ = self.night(**{**SETTLED, 'CH_BUDGET_SECONDS': '60'})
        self.assertEqual((verdict['scored'], verdict['calls'], verdict['notReached'], verdict['stoppedForTime']),
                         (0, 2, 1, True), 'the third run would start past 60 + 180 seconds')
        self.assertIsNone(self.rows()[1]['ai_fit_score'])


if __name__ == '__main__':
    classes = [OffSwitch] if MODE == 'record' else [Rule, OffSwitch, MeasuredNight, EmptyAnswers, Order, Budget]
    suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(cls) for cls in classes)
    result = unittest.TextTestRunner(verbosity=2, stream=sys.stderr).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
