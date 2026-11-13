# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Execute the real nightly launcher code against disposable owner/corpus stores and count keyword and AI scoring work.
import contextlib
import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
from jobhunter import config, db, match, score, enrich, profile
CODE = json.loads(sys.stdin.read())

class Delta(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        root = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix='nightly-delta-')))
        for key, value in dict(DATA_DIR=root, USER_DB=root/'user.db', CORPUS_DB=root/'corpus.db',
                               CAREER_DB=root/'career_db.json', POSTGRES=False, MULTIUSER=True,
                               STORE='sqlite', USER_SUB='invented-person').items():
            self.stack.enter_context(patch.object(config, key, value))
        self.addCleanup(db._portable_paths.discard, str(config.USER_DB))
        config.CAREER_DB.write_text(json.dumps({'profile': {'experience_summary': 'Fictional engineer'}, 'roles': []}))
        self.addCleanup(profile.load.cache_clear)
        with db.connect() as conn:
            conn.execute("INSERT INTO corpus.companies(id,name) VALUES(1,'Invented employer')")
        self.stack.enter_context(patch.dict(os.environ, {'CH_NIGHTLY_MATCH':'1', 'CH_TITLES':'Engineer', 'CH_LIMIT':'50'}))
        self.stack.enter_context(patch.object(enrich, 'provider', return_value='fixture'))
        self.stack.enter_context(patch.object(enrich, 'model_name', return_value='fixture-model'))
        self.stack.enter_context(patch.object(score.detail, 'fetch', side_effect=AssertionError('No employer page allowed')))

    def add(self, count=4, completed=True):
        with db.connect() as conn:
            conn.execute('PRAGMA corpus.synchronous=OFF')
            conn.execute('PRAGMA main.synchronous=OFF')
            for n in range(1, count+1):
                conn.execute("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,active,target_role,posted_date,first_seen_at) VALUES(?,1,?,'Engineer',?,1,1,date('now'),datetime('now'))", (n,str(n),'Fictional Linux cloud skills. '*(1 if count>1000 else 100)))
                if completed:
                    db.user_set(conn,n,fit_score=70,ai_fit_score=80)

    def run_night(self):
        with contextlib.redirect_stdout(io.StringIO()):
            exec(compile(CODE, 'shipped-nightly-launcher', 'exec'), {})

    def worker(self, row, *args, **kwargs):
        return {'id':row['id'], 'data':{'fit_score':88,'rationale':'Invented fit','matched':[],'gaps':[]}, 'fingerprint':'fixture', 'model':'fixture'}

    def test_only_new_keyword_jobs_are_scored_and_old_unmatched_jobs_are_retried(self):
        self.add()
        with db.connect() as conn:
            db.user_set(conn,2,fit_score=None)
            conn.execute("UPDATE corpus.postings_corpus SET posted_date=NULL,first_seen_at='2020-01-01' WHERE id=2")
        with patch.object(score,'score_batch',return_value=(0,0)), patch.object(match,'score_text',wraps=match.score_text) as calls:
            self.run_night()
            self.assertEqual(calls.call_count,1)
            self.run_night()
            self.assertEqual(calls.call_count,1,'already scored relationships never cost another keyword call')
            with db.connect() as conn:
                conn.execute("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,active,target_role,first_seen_at) VALUES(5,1,'new-5','Engineer','Invented skills',1,1,datetime('now'))")
            self.run_night()
            self.assertEqual(calls.call_count,2,'only the newly added posting costs a scoring call')

    def test_only_new_ai_jobs_are_scored_and_shrinking_backlog_never_skips(self):
        self.add(104)
        with db.connect() as conn:
            conn.execute('UPDATE user_signals SET ai_fit_score=NULL WHERE posting_id>2')
            conn.execute("UPDATE user_signals SET status='dismissed' WHERE posting_id=104")
            conn.execute("UPDATE corpus.postings_corpus SET posted_date='2020-01-01',first_seen_at='2020-01-01' WHERE id=3")
        with patch.object(score,'_score_one',side_effect=self.worker) as calls:
            for _ in range(4): self.run_night()
            self.assertEqual(sorted(c.args[0]['id'] for c in calls.call_args_list),list(range(3,104)))

    def test_removed_stays_removed_and_is_never_scored_by_the_next_nightly_pass(self):
        self.add(completed=False)
        with db.connect() as conn: db.user_set(conn,1,status='dismissed')
        with patch.object(match,'score_text',wraps=match.score_text) as keyword, patch.object(score,'_score_one',side_effect=self.worker) as ai:
            self.run_night(); self.run_night()
            self.assertNotIn(1,[c.args[0]['id'] for c in ai.call_args_list])
            self.assertEqual(keyword.call_count,3)
        with db.connect() as conn:
            self.assertEqual(conn.execute('SELECT status,ai_fit_score,fit_score FROM user_signals WHERE posting_id=1').fetchone()[:],('dismissed',None,None))

    def test_repeated_night_at_fixture_volume_has_no_scoring_calls_and_finishes_under_two_seconds(self):
        self.add(60000)
        plans, iterate = [], match._iter_postings
        def observe(conn, sql, params=()):
            plans.append({'sql':sql,'bindings':params,'plan':[row[3] for row in conn.execute('EXPLAIN QUERY PLAN '+sql,params)]})
            return iterate(conn,sql,params)
        with patch.object(score,'score_batch',return_value=(0,0)), patch.object(match,'score_text',wraps=match.score_text) as calls, patch.object(match,'_iter_postings',side_effect=observe):
            start=time.monotonic(); self.run_night(); elapsed=time.monotonic()-start
            print(json.dumps({'nightlyRepeatMs':elapsed*1000,'scoringCalls':calls.call_count,'plans':plans}),file=sys.stderr)
            self.assertLess(elapsed,2.0)
            self.assertEqual(calls.call_count,0)

if __name__ == '__main__': unittest.main(argv=['nightly-delta'],verbosity=2)
