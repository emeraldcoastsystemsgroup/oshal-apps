# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Prove evidence invalidation, budgeted cursor rotation, old-schema upgrades and owner isolation on real disposable SQLite and FORCE-RLS PostgreSQL stores without live inference.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Prove a saved copy outlives a day without a request, and that one job an employer refuses leaves the rest of the pass scored and saved.
"""Real disposable scoring stores, with every model and employer call replaced by fixtures."""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PACKAGE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE / 'engine'))
sys.path.insert(0, str(PACKAGE / 'tests' / 'helpers'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
from jobhunter import config, db, enrich, job_context, profile, score, score_freshness


class Freshness(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix='career-freshness-')))
        owner = self.root / 'owner-a'
        owner.mkdir()
        for key, value in dict(DATA_DIR=owner, USER_DB=owner / 'user.db', CORPUS_DB=self.root / 'corpus.db',
                               CAREER_DB=owner / 'career_db.json', DB_PATH=owner / 'jobs.db',
                               POSTGRES=False, STORE='sqlite', MULTIUSER=True, USER_SUB='fixture-owner-a').items():
            self.stack.enter_context(patch.object(config, key, value))
        self.candidate = {'profile': {'experience_summary': 'Recorded engineer. ' * 300},
                          'roles': [{'title': 'Engineer', 'deliverables': ['Verified Linux operations']}],
                          'certifications': ['Recorded fixture certification']}
        self.write_profile()
        self.model = 'fixture-model-v1'
        self.calls = []
        self.stack.enter_context(patch.object(enrich, 'provider', return_value='fixture'))
        self.stack.enter_context(patch.object(enrich, 'model_name', side_effect=lambda _: self.model))
        self.stack.enter_context(patch.object(enrich, 'complete', side_effect=self.complete))
        self.fetch = self.stack.enter_context(patch.object(score.detail, 'fetch', return_value={}))
        with db.connect() as conn:
            conn.execute("INSERT INTO corpus.companies(id,name,ats_type,ats_token) VALUES(1,'Fixture Employer','fixture','fixture')")
        self.addCleanup(profile.load.cache_clear)

    def write_profile(self):
        config.CAREER_DB.write_text(json.dumps(self.candidate))
        profile.load.cache_clear()

    def complete(self, system, prompt, **kwargs):
        self.calls.append(prompt)
        return json.dumps({'fit_score': 84, 'rationale': 'Fixture evidence.', 'matched': ['Linux'], 'gaps': []})

    def add_jobs(self, count=1, description=None):
        config.CORPUS_DB.chmod(0o660)
        with db.connect() as conn:
            for posting_id in range(1, count + 1):
                conn.execute("INSERT INTO corpus.postings_corpus(id,company_id,ats_job_id,title,description,active,target_role,remote,posted_date,first_seen_at) "
                             "VALUES(?,1,?,'Linux Engineer',?,1,1,1,date('now'),?)",
                             (posting_id, str(posting_id), description or ('Operate verified Linux systems. ' * 60), db.now()))
        config.CORPUS_DB.chmod(0o440)

    def run_batch(self, limit=1, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            return score.score_batch(limit=limit, workers=1, fresh_days=7, **kwargs)

    def row(self, posting_id=1):
        with db.connect() as conn:
            return dict(conn.execute('SELECT * FROM postings WHERE id=?', (posting_id,)).fetchone())

    def fingerprint(self, row=None, candidate=None):
        return score._scoring_inputs(row or self.row(), candidate or profile.scoring_context(), {'name': 'Fixture Employer'})[1]

    @contextlib.contextmanager
    def native_rail(self):
        self.identity_reads = []
        self.native_requests = []
        self.native_identity = {'version': 1, 'identity': 'a' * 64,
                                'primary': {'provider': 'native-primary', 'model': 'model-one'}}
        self.native_metadata = lambda request: {}
        self.native_refusal = None
        def rail(body):
            request = json.loads(body)
            if request.get('operation') == 'model-identity':
                self.identity_reads.append(request)
                return 200, {'ok': True, 'identity': self.native_identity}
            self.native_requests.append(request)
            if self.native_refusal:
                return 409, {'ok': False, 'error': self.native_refusal}
            primary = self.native_identity['primary']
            payload = {'ok': True, 'text': self.complete('', request['prompt']),
                       'provider': primary['provider'], 'model': primary['model'],
                       'modelIdentity': self.native_identity['identity'], 'fallback': False}
            payload.update(self.native_metadata(request))
            return 200, payload
        with patch.dict(os.environ, {'OSHAL_EGRESS': 'kernel'}), patch.object(enrich, '_rail_configured', return_value=True), \
                patch.object(enrich, '_rail_post', side_effect=rail), patch.object(enrich, '_RAIL_FAILURE', None):
            yield

    def test_native_primary_identity_resolves_once_per_pass_and_invalidates_without_probe_inference(self):
        self.add_jobs()
        with self.native_rail():
            self.assertEqual(self.run_batch(), (1, 0))
            self.assertEqual(self.run_batch(), (0, 0))
            self.native_identity = {**self.native_identity, 'identity': 'b' * 64,
                                    'primary': {'provider': 'native-primary', 'model': 'model-two'}}
            self.assertEqual(self.run_batch(), (1, 0))
            self.assertEqual(self.run_batch(), (0, 0))
            self.native_identity = {**self.native_identity, 'identity': 'c' * 64,
                                    'primary': {'provider': 'different-provider', 'model': 'model-two'}}
            self.assertEqual(self.run_batch(), (1, 0))
            self.assertEqual(len(self.identity_reads), 5)
            self.assertTrue(all(request == {'operation': 'model-identity'} for request in self.identity_reads))
            self.assertEqual(len(self.native_requests), 3)
            self.assertEqual([r['expectedModelIdentity'] for r in self.native_requests], [key * 64 for key in 'abc'])
            self.assertEqual(json.loads(self.row()['ai_model']), {'provider': 'different-provider', 'model': 'model-two', 'fallback': False})

    def test_native_unsupported_identity_preserves_scores_workflow_and_cursor_without_models(self):
        self.add_jobs()
        with self.native_rail():
            self.run_batch()
            with db.connect() as conn:
                db.user_set(conn, 1, status='applied', applied_at='2026-01-01T00:00:00+00:00', resume_path='retained.pdf')
                saved = db.score_fingerprints(conn, [1])
            cursor = config.DATA_DIR / score_freshness.CURSOR_FILE
            before = cursor.read_bytes()
            self.native_identity = None
            for _ in range(2):
                with self.assertRaises(enrich.CareerWorkerUnavailable) as error:
                    self.run_batch()
                self.assertEqual(error.exception.reason, 'model-identity-unavailable')
            self.assertEqual(len(self.native_requests), 1)
            self.assertEqual(len(self.identity_reads), 2, 'the failed identity circuit sends no repeated request')
            self.assertEqual(cursor.read_bytes(), before)
            with db.connect() as conn:
                self.assertEqual(db.score_fingerprints(conn, [1]), saved)
            self.assertEqual((self.row()['status'], self.row()['resume_path']), ('applied', 'retained.pdf'))

    def test_native_missing_guarded_metadata_retains_prior_score_and_does_not_retry_inference(self):
        self.add_jobs()
        with self.native_rail():
            self.run_batch()
            with db.connect() as conn:
                saved = db.score_fingerprints(conn, [1])
            cursor = config.DATA_DIR / score_freshness.CURSOR_FILE
            before = cursor.read_bytes()
            self.candidate['certifications'].append('New recorded fact')
            self.write_profile()
            self.native_metadata = lambda request: {'modelIdentity': None, 'fallback': None}
            with self.assertRaises(enrich.CareerWorkerUnavailable) as error:
                self.run_batch()
            self.assertEqual(error.exception.reason, 'model-identity-unavailable')
            self.assertEqual(len(self.native_requests), 2)
            self.assertEqual(cursor.read_bytes(), before)
            with db.connect() as conn:
                self.assertEqual(db.score_fingerprints(conn, [1]), saved)

    def test_native_guard_mismatch_preserves_prior_score_with_no_model_retry(self):
        self.add_jobs()
        with self.native_rail():
            self.run_batch()
            with db.connect() as conn:
                saved = db.score_fingerprints(conn, [1])
            self.candidate['certifications'].append('Another recorded fact')
            self.write_profile()
            self.native_refusal = 'model-identity-mismatch'
            for _ in range(2):
                with self.assertRaises(enrich.CareerWorkerUnavailable) as error:
                    self.run_batch()
                self.assertEqual((error.exception.reason, error.exception.status), ('model-identity-mismatch', 409))
            self.assertEqual(len(self.calls), 1, 'guard refusal never reaches the fixture model')
            self.assertEqual(len(self.native_requests), 2, 'only the original completion and one refused turn were attempted')
            with db.connect() as conn:
                self.assertEqual(db.score_fingerprints(conn, [1]), saved)

    def test_native_fallback_provenance_reuses_configured_policy_until_policy_changes(self):
        self.add_jobs()
        with self.native_rail():
            self.native_metadata = lambda request: {'provider': 'fallback-provider', 'model': 'fallback-model', 'fallback': True}
            self.assertEqual(self.run_batch(), (1, 0))
            self.assertEqual(json.loads(self.row()['ai_model']), {'provider': 'fallback-provider', 'model': 'fallback-model', 'fallback': True})
            self.native_metadata = lambda request: {}
            self.assertEqual(self.run_batch(), (0, 0))
            self.assertEqual(len(self.native_requests), 1)
            self.native_identity['identity'] = 'b' * 64
            self.assertEqual(self.run_batch(), (1, 0))
            self.assertEqual(json.loads(self.row()['ai_model'])['fallback'], False)

    def test_native_configured_alias_can_report_versioned_model_without_false_invalidation(self):
        self.add_jobs()
        with self.native_rail():
            self.native_metadata = lambda request: {'model': 'model-one-versioned-2026-10'}
            self.assertEqual(self.run_batch(), (1, 0))
            self.assertEqual(json.loads(self.row()['ai_model']), {'provider': 'native-primary', 'model': 'model-one-versioned-2026-10', 'fallback': False})
            self.assertEqual(self.run_batch(), (0, 0))
            self.assertEqual(len(self.native_requests), 1)
            self.native_identity = {**self.native_identity, 'identity': 'b' * 64,
                                    'primary': {'provider': 'native-primary', 'model': 'new-configured-alias'}}
            self.assertEqual(self.run_batch(), (1, 0))
            self.assertEqual(len(self.native_requests), 2)

    def test_native_concurrent_workers_keep_completion_metadata_per_result(self):
        self.add_jobs(2)
        config.CORPUS_DB.chmod(0o660)
        with db.connect() as conn:
            conn.execute("UPDATE corpus.postings_corpus SET title='Linux Engineer One' WHERE id=1")
            conn.execute("UPDATE corpus.postings_corpus SET title='Linux Engineer Two' WHERE id=2")
        config.CORPUS_DB.chmod(0o440)
        with self.native_rail():
            self.native_metadata = lambda request: ({'provider': 'fallback-provider', 'model': 'fallback-model', 'fallback': True}
                                                     if 'Linux Engineer Two' in request['prompt'] else {})
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(score.score_batch(limit=2, workers=2, fresh_days=7), (2, 0))
            self.assertEqual(len(self.identity_reads), 1)
            self.assertEqual(json.loads(self.row(1)['ai_model']), {'provider': 'native-primary', 'model': 'model-one', 'fallback': False})
            self.assertEqual(json.loads(self.row(2)['ai_model']), {'provider': 'fallback-provider', 'model': 'fallback-model', 'fallback': True})

    def test_legacy_refresh_then_no_model_and_workflow_preserved(self):
        self.add_jobs()
        with db.connect() as conn:
            db.user_set(conn, 1, ai_fit_score=70, status='applied', applied_at='2026-01-01T00:00:00+00:00',
                        resume_path='retained-resume.pdf', application_source='verified-submission', apply_run_id='retained-run')
            columns = [r[1] for r in conn.execute('PRAGMA table_info(postings)')]
        before = hashlib.sha256(config.CORPUS_DB.read_bytes()).hexdigest()
        self.assertEqual(self.run_batch(), (1, 0))
        with db.connect() as conn:
            saved = db.score_fingerprints(conn, [1])[1]
            self.assertEqual(columns, [r[1] for r in conn.execute('PRAGMA table_info(postings)')])
        self.assertRegex(saved, r'^[0-9a-f]{64}$')
        self.assertEqual(self.run_batch(), (0, 0))
        self.assertEqual(len(self.calls), 1)
        row = self.row()
        self.assertEqual((row['status'], row['applied_at'], row['resume_path'], row['application_source'], row['apply_run_id']),
                         ('applied', '2026-01-01T00:00:00+00:00', 'retained-resume.pdf', 'verified-submission', 'retained-run'))
        self.assertEqual(hashlib.sha256(config.CORPUS_DB.read_bytes()).hexdigest(), before)
        self.assertEqual((config.DATA_DIR / score_freshness.CURSOR_FILE).stat().st_mode & 0o777, 0o600)

    def test_full_profile_job_contract_and_resolved_model_changes_refresh(self):
        self.add_jobs()
        self.assertEqual(self.run_batch(), (1, 0))
        self.candidate['certifications'].append('Late verified credential beyond the old overview')
        self.write_profile()
        self.assertEqual(self.run_batch(), (1, 0))
        self.assertIn('Late verified credential', self.calls[-1])
        config.CORPUS_DB.chmod(0o660)
        with db.connect() as conn:
            conn.execute("UPDATE corpus.postings_corpus SET description=description || ' Mandatory fixture clearance.' WHERE id=1")
        config.CORPUS_DB.chmod(0o440)
        self.assertEqual(self.run_batch(), (1, 0))
        self.model = 'fixture-model-v2'
        self.assertEqual(self.run_batch(), (1, 0))
        self.assertEqual(self.row()['ai_model'], self.model)
        with patch.object(score, 'SCORING_CONTRACT_VERSION', score.SCORING_CONTRACT_VERSION + 1):
            self.assertEqual(self.run_batch(), (1, 0))
        self.assertEqual(len(self.calls), 5)

    def test_only_considered_text_and_semantic_source_affect_identity(self):
        self.add_jobs(description='x' * 17000)
        row = self.row()
        original = self.fingerprint(row)
        self.assertEqual(original, self.fingerprint({**row, 'description': 'x' * 16000 + 'unseen changed tail'}))
        self.assertNotEqual(original, self.fingerprint({**row, 'description': 'changed prefix' + 'x' * 17000}))
        for key, value in [('title', 'Another Engineer'), ('location', 'Different location'), ('remote', 0)]:
            self.assertNotEqual(original, self.fingerprint({**row, key: value}))
        source = {**row, 'description_context': {'basis': 'employer-detail', 'retrievedAt': '2026-01-01'}}
        self.assertEqual(original, self.fingerprint(source))
        self.assertEqual(original, self.fingerprint({**row, 'description_context': {'basis': 'corpus-description'}}))
        self.assertEqual(self.fingerprint(source), self.fingerprint({**source, 'description_context': {'basis': 'employer-detail', 'retrievedAt': '2027-01-01'}}))
        self.assertNotEqual(self.fingerprint(source), self.fingerprint({**source, 'description_context': {'basis': 'listing-summary'}}))

    def test_cached_detail_reused_without_network_on_fresh_pass(self):
        self.add_jobs(description='A short source summary')
        self.fetch.return_value = {'description': 'Employer-provided Linux evidence. ' * 70}
        self.assertEqual(self.run_batch(), (1, 0))
        self.assertEqual(self.fetch.call_count, 1)
        self.assertEqual(self.run_batch(), (0, 0))
        self.assertEqual(self.fetch.call_count, 1)
        self.assertEqual(len(self.calls), 1)

    def age_cache(self, posting_id=1):
        path = config.DATA_DIR / 'job-context' / f'{posting_id}.json'
        value = json.loads(path.read_text())
        value['retrievedAt'] = '2000-01-01T00:00:00Z'
        path.write_text(json.dumps(value))
        return path

    def change_listing(self, *posting_ids):
        config.CORPUS_DB.chmod(0o660)
        with db.connect() as conn:
            for posting_id in posting_ids:
                conn.execute("UPDATE corpus.postings_corpus SET location='Canada' WHERE id=?", (posting_id,))
        config.CORPUS_DB.chmod(0o440)

    def test_old_saved_detail_is_reused_without_a_request_or_model_call(self):
        self.add_jobs(description='A short source summary')
        self.fetch.return_value = {'description': 'Verified employer requirements. ' * 60}
        self.assertEqual(self.run_batch(), (1, 0))
        path = self.age_cache()
        before = hashlib.sha256(config.CORPUS_DB.read_bytes()).hexdigest()
        self.assertEqual(self.run_batch(), (0, 0))
        self.assertEqual(self.fetch.call_count, 1)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(json.loads(path.read_text())['retrievedAt'], '2000-01-01T00:00:00Z')
        self.assertEqual(hashlib.sha256(config.CORPUS_DB.read_bytes()).hexdigest(), before)
        self.assertIn('Verified employer requirements.', job_context.apply(self.row())['description'])

    def test_a_persons_recheck_of_an_old_copy_takes_the_employers_shorter_answer(self):
        self.add_jobs(description='A short source summary')
        self.fetch.return_value = {'description': 'Verified employer operations. ' * 60 + ' REMOVED mandatory requirement.'}
        self.assertEqual(self.run_batch(), (1, 0))
        self.age_cache()
        self.fetch.return_value = {'description': 'Verified revised employer requirement.'}
        self.assertEqual(job_context.ensure(self.row())['description'], self.fetch.return_value['description'])
        self.assertEqual(self.run_batch(), (1, 0))
        self.assertNotIn('REMOVED mandatory', self.calls[-1])
        self.assertIn('employer-detail-short', self.calls[-1])
        self.assertIn('SOURCE LIMITATION', self.calls[-1])
        self.assertEqual(job_context.read(self.row())['description'], self.fetch.return_value['description'])
        self.assertEqual(self.run_batch(), (0, 0))
        self.assertEqual((self.fetch.call_count, len(self.calls)), (2, 2))

    def test_a_persons_recheck_the_employer_refuses_keeps_the_old_copy(self):
        self.add_jobs(description='A short source summary')
        self.fetch.return_value = {'description': 'Verified employer requirement. ' * 60}
        self.run_batch()
        path = self.age_cache()
        before = path.read_bytes()
        self.fetch.return_value = {}
        self.assertIn('Verified employer requirement.', job_context.ensure(self.row())['description'])
        self.assertEqual(self.fetch.call_count, 2)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(self.run_batch(), (0, 0))
        self.assertEqual(len(self.calls), 1)

    def test_changed_listing_revalidates_detail_even_when_original_listing_is_long(self):
        self.add_jobs()
        job_context.remember(self.row(), {'description': 'Old employer requirement. ' * 100})
        self.assertEqual(self.run_batch(), (1, 0))
        config.CORPUS_DB.chmod(0o660)
        with db.connect() as conn:
            conn.execute("UPDATE corpus.postings_corpus SET location='Canada' WHERE id=1")
        config.CORPUS_DB.chmod(0o440)
        self.fetch.return_value = {'description': 'Revised Canada eligibility.'}
        self.assertEqual(self.run_batch(), (1, 0))
        self.assertEqual(self.fetch.call_count, 1)
        self.assertIn('Revised Canada eligibility.', self.calls[-1])
        self.assertNotIn('Old employer requirement.', self.calls[-1])
        self.assertEqual(self.run_batch(), (0, 0))

    def test_one_refused_job_leaves_the_rest_of_the_pass_scored_and_saved(self):
        # The production failure of 2026-10-29 onward: one employer answered 403 and the
        # exception ended the pass, so every other job's score was discarded, every run.
        self.add_jobs(3)
        job_context.remember(self.row(2), {'description': 'Old employer requirement. ' * 100})
        self.assertEqual(self.run_batch(3), (3, 0))
        path = config.DATA_DIR / 'job-context' / '2.json'
        before = path.read_bytes()
        with db.connect() as conn:
            saved = db.score_fingerprints(conn, [2])
        self.change_listing(1, 2, 3)
        self.fetch.return_value = {}
        self.assertEqual(self.run_batch(3), (2, 1))
        self.assertEqual(path.read_bytes(), before, 'the refused job keeps its previous details')
        with db.connect() as conn:
            self.assertEqual(db.score_fingerprints(conn, [2]), saved, 'and its previous score')
            self.assertEqual(len(db.score_fingerprints(conn, [1, 3])), 2)
        self.fetch.return_value = {'description': 'Revised Canada eligibility. ' * 60}
        self.assertEqual(self.run_batch(3), (1, 0))
        self.assertIn('Revised Canada eligibility.', self.calls[-1])

    def test_a_refusing_employer_does_not_hold_the_cursor_on_later_jobs(self):
        self.add_jobs(3)
        body = 'Verified employer evidence. ' * 70
        for posting_id in range(1, 4):
            job_context.remember(self.row(posting_id), {'description': body})
        self.assertEqual(self.run_batch(3), (3, 0))
        self.change_listing(1, 2, 3)
        asked = []

        def employer(_ats_type, _token, job_id, _url):
            asked.append(job_id)
            return {} if job_id == asked[0] else {'description': body}

        self.fetch.side_effect = employer
        self.assertEqual(self.run_batch(), (0, 1))
        self.assertEqual(self.run_batch(), (1, 0), 'the next pass moves on instead of retrying the refusal')

    def test_one_unreadable_saved_copy_costs_only_that_job(self):
        self.add_jobs(2)
        job_context.remember(self.row(1), {'description': 'Verified employer evidence. ' * 70})
        self.assertEqual(self.run_batch(2), (2, 0))
        (config.DATA_DIR / 'job-context' / '1.json').write_text('{not json')
        self.change_listing(2)
        self.assertEqual(self.run_batch(2), (1, 1))
        self.assertIn('Canada', self.calls[-1])

    def test_changed_listing_gets_stay_within_the_pass_budget(self):
        self.add_jobs(12)
        body = 'Verified employer evidence. ' * 70
        for posting_id in range(1, 13):
            job_context.remember(self.row(posting_id), {'description': body})
        self.assertEqual(self.run_batch(12), (12, 0))
        self.assertEqual(len(self.calls), 12)
        self.change_listing(*range(1, 13))
        self.fetch.return_value = {'description': body}
        self.assertEqual(self.run_batch(2), (2, 0))
        self.assertEqual(self.fetch.call_count, 2)
        self.assertEqual(self.run_batch(2), (2, 0))
        self.assertEqual(self.fetch.call_count, 4)
        self.assertEqual(len(self.calls), 16)

    def test_oversized_employer_refresh_skips_before_model_and_preserves_evidence(self):
        self.add_jobs(description='A short source summary')
        self.fetch.return_value = {'description': 'Verified employer evidence. ' * 70}
        self.run_batch()
        path = config.DATA_DIR / 'job-context' / '1.json'
        before = path.read_bytes()
        self.change_listing(1)
        self.fetch.return_value = {'description': 'x' * 64001}
        self.assertEqual(self.run_batch(), (0, 1))
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(len(self.calls), 1)

    def test_writable_corpus_detail_has_same_identity_as_fetched_text(self):
        self.add_jobs(description='A short source summary')
        config.CORPUS_DB.chmod(0o660)
        self.fetch.return_value = {'description': 'Employer-provided Linux evidence. ' * 70}
        self.assertEqual(self.run_batch(), (1, 0))
        self.assertEqual(self.run_batch(), (0, 0))
        self.assertEqual(self.fetch.call_count, 1)
        self.assertEqual(len(self.calls), 1)

    def test_cursor_rotates_past_fresh_inputs_with_bounded_inspection(self):
        self.add_jobs(12)
        for posting_id in range(1, 13):
            fingerprint = self.fingerprint(self.row(posting_id)) if posting_id < 12 else None
            with db.connect() as conn:
                db.save_ai_fit(conn, posting_id, 84, 'Fixture', [], [], self.model, fingerprint)
        with patch.object(score, '_scoring_inputs', wraps=score._scoring_inputs) as inputs:
            self.assertEqual(self.run_batch(), (0, 0))
            self.assertEqual(inputs.call_count, 10)
        self.assertEqual(self.run_batch(), (1, 0))
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.run_batch(), (0, 0))

    def test_legacy_model_budget_and_selection_gates_remain(self):
        self.add_jobs(6)
        config.CORPUS_DB.chmod(0o660)
        with db.connect() as conn:
            conn.execute('UPDATE corpus.postings_corpus SET active=0 WHERE id=4')
            conn.execute('UPDATE corpus.postings_corpus SET target_role=0 WHERE id=5')
            conn.execute("UPDATE corpus.postings_corpus SET posted_date='2020-01-01' WHERE id=6")
            for posting_id in range(1, 7):
                db.user_set(conn, posting_id, ai_fit_score=60)
        config.CORPUS_DB.chmod(0o440)
        self.assertEqual(self.run_batch(2), (2, 0))
        self.assertEqual(self.run_batch(2), (1, 0))
        self.assertEqual(len(self.calls), 3)
        with db.connect() as conn:
            self.assertEqual([bool(v) for v in db.score_fingerprints(conn, [1, 2, 3, 4, 5, 6]).values()], [True, True, True, False, False, False])

    def test_owners_have_independent_fingerprints_and_scan_state(self):
        self.add_jobs()
        self.assertEqual(self.run_batch(), (1, 0))
        other = self.root / 'owner-b'
        other.mkdir()
        with patch.object(config, 'DATA_DIR', other), patch.object(config, 'USER_DB', other / 'user.db'), patch.object(config, 'CAREER_DB', other / 'career_db.json'), patch.object(config, 'USER_SUB', 'fixture-owner-b'):
            self.write_profile()
            self.assertEqual(self.run_batch(), (1, 0))
            self.assertTrue((other / score_freshness.CURSOR_FILE).is_file())
        self.assertEqual(len(self.calls), 2)
        profile.load.cache_clear()
        self.assertEqual(self.run_batch(), (0, 0))

    def test_worker_failure_does_not_advance_cursor_or_claim_freshness(self):
        self.add_jobs()
        score_freshness.write_cursor({}, 'a' * 64, 3)
        cursor = config.DATA_DIR / score_freshness.CURSOR_FILE
        before = cursor.read_bytes()
        with patch.object(enrich, 'complete', side_effect=enrich.CareerWorkerUnavailable('fixture-failure')):
            with self.assertRaises(enrich.CareerWorkerUnavailable):
                self.run_batch()
        self.assertEqual(cursor.read_bytes(), before)
        with db.connect() as conn:
            self.assertIsNone(db.score_fingerprints(conn, [1]).get(1))

    def test_invalid_completion_retains_cursor_for_next_attempt(self):
        self.add_jobs(3)
        score_freshness.write_cursor({}, 'a' * 64, 3)
        cursor = config.DATA_DIR / score_freshness.CURSOR_FILE
        before = cursor.read_bytes()
        with patch.object(enrich, 'complete', return_value='{}') as invalid:
            self.assertEqual(self.run_batch(), (0, 1))
            self.assertEqual(invalid.call_count, 2)
        self.assertEqual(cursor.read_bytes(), before)
        self.assertEqual(self.run_batch(), (1, 0))
        with db.connect() as conn:
            self.assertTrue(db.score_fingerprints(conn, [1])[1])
            self.assertIsNone(db.score_fingerprints(conn, [2]).get(2))

    def test_cursor_refuses_invalid_or_unbounded_state(self):
        key = 'a' * 64
        path = config.DATA_DIR / score_freshness.CURSOR_FILE
        for value in [[], {}, {'version': 1, 'positions': {key: True}}, {'version': 1, 'positions': {key: 10**20}}, {'version': 1, 'positions': {'bad': 1}}]:
            path.write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                score_freshness.read_cursor(key)
        path.unlink()
        path.symlink_to(self.root / 'missing')
        with self.assertRaises(ValueError):
            score_freshness.read_cursor(key)

    def test_old_sqlite_private_and_inline_schemas_upgrade(self):
        other = self.root / 'old-user.db'
        with sqlite3.connect(other) as conn:
            conn.executescript(db.USER_SCHEMA.replace(', ai_input_fingerprint TEXT', ''))
        with patch.object(config, 'USER_DB', other):
            with db.connect() as conn:
                self.assertIn('ai_input_fingerprint', {r[1] for r in conn.execute('PRAGMA table_info(user_signals)')})
                db.save_ai_fit(conn, 1, 80, 'Fixture', [], [], self.model, 'a' * 64)
                self.assertEqual(db.score_fingerprints(conn, [1]), {1: 'a' * 64})
        with patch.object(config, 'MULTIUSER', False):
            with db.connect() as conn:
                conn.executescript(db.SCHEMA.replace('    ai_input_fingerprint TEXT,\n', ''))
                db.migrate(conn)
                conn.execute("INSERT INTO companies(id,name) VALUES(1,'Inline Fixture')")
                conn.execute("INSERT INTO postings(id,company_id,ats_job_id,title) VALUES(1,1,'1','Engineer')")
                db.save_ai_fit(conn, 1, 80, 'Fixture', [], [], self.model, 'b' * 64)
                self.assertEqual(db.score_fingerprints(conn, [1]), {1: 'b' * 64})


def postgres_contract():
    """Use only a newly created database and its NOSUPERUSER/NOBYPASSRLS owner role."""
    from career_pg import disposable_postgres
    admin_url = os.environ['CAREER_TEST_DATABASE_URL']
    with disposable_postgres(admin_url) as app_url, tempfile.TemporaryDirectory(prefix='career-freshness-pg-') as temporary:
        root = Path(temporary)
        values = dict(POSTGRES=True, STORE='postgres', MULTIUSER=True, DATABASE_URL=app_url,
                      USER_SUB='freshness-owner-a', DATA_DIR=root, CAREER_DB=root / 'career_db.json')
        with contextlib.ExitStack() as stack:
            for key, value in values.items():
                stack.enter_context(patch.object(config, key, value))
            stack.enter_context(patch.object(enrich, 'provider', return_value='fixture'))
            stack.enter_context(patch.object(enrich, 'model_name', return_value='fixture-pg-model'))
            model = stack.enter_context(patch.object(enrich, 'complete', return_value='{"fit_score":84,"rationale":"Fixture evidence"}'))
            stack.enter_context(patch.object(score.detail, 'fetch', side_effect=AssertionError('No employer network call allowed')))
            config.CAREER_DB.write_text('{"roles":[{"title":"Engineer"}],"profile":{"experience_summary":"Fixture"}}')
            profile.load.cache_clear()
            with db.connect() as conn:
                company_id = db.upsert_company(conn, 'Freshness Fixture')
                db.upsert_posting(conn, company_id, {'ats_job_id': 'fixture-1', 'title': 'Engineer', 'description': 'Verified engineering evidence. ' * 60, 'remote': True})
                posting_id = conn.execute('SELECT id FROM career_postings').fetchone()['id']
                db.user_set(conn, posting_id, target_role=1, ai_fit_score=60, status='applied', applied_at='2026-01-01T00:00:00+00:00', application_source='verified-submission')
                view_columns = [d[0] for d in conn.execute('SELECT * FROM postings LIMIT 0').description]
            with contextlib.redirect_stdout(io.StringIO()):
                assert score.score_batch(limit=1, workers=1, first_seen_days=7) == (1, 0)
                assert score.score_batch(limit=1, workers=1, first_seen_days=7) == (0, 0)
            assert model.call_count == 1
            with db.connect() as conn:
                fingerprint = db.score_fingerprints(conn, [posting_id])[posting_id]
                assert len(fingerprint) == 64
                assert [d[0] for d in conn.execute('SELECT * FROM postings LIMIT 0').description] == view_columns
                assert conn.execute('SELECT status FROM career_user_applications WHERE posting_id=?', (posting_id,)).fetchone()['status'] == 'applied'
                score_row = dict(conn.execute('SELECT * FROM career_user_job_scores WHERE posting_id=?', (posting_id,)).fetchone())
            # The strict rollback projector must recognize and retain this new score field.
            from sync import reverse_sync
            with sqlite3.connect(root / 'projection.db') as projection:
                projection.executescript(db.USER_SCHEMA)
                reverse_sync.apply_score(projection, 'main', reverse_sync.SPECS['career_user_job_scores'],
                    {'operation': 'UPSERT', 'row_key': {'posting_id': posting_id}, 'row_after': score_row})
                assert projection.execute('SELECT ai_input_fingerprint FROM user_signals WHERE posting_id=?', (posting_id,)).fetchone()[0] == fingerprint
            with patch.object(config, 'USER_SUB', 'freshness-owner-b'):
                with db.connect() as conn:
                    assert db.score_fingerprints(conn, [posting_id]) == {}
                    db.save_ai_fit(conn, posting_id, 70, 'Other owner', [], [], 'fixture-pg-model', 'b' * 64)
                    assert db.score_fingerprints(conn, [posting_id]) == {posting_id: 'b' * 64}
            with db.connect() as conn:
                assert db.score_fingerprints(conn, [posting_id]) == {posting_id: fingerprint}
            profile.load.cache_clear()
    return {'checks': 9, 'failed': []}


if __name__ == '__main__':
    if '--postgres' in sys.argv:
        print(json.dumps(postgres_contract()))
    else:
        result = unittest.TextTestRunner(stream=sys.stderr).run(unittest.defaultTestLoader.loadTestsFromTestCase(Freshness))
        print(json.dumps({'checks': result.testsRun, 'failed': [str(t) for t, _ in result.failures + result.errors]}))
        raise SystemExit(0 if result.wasSuccessful() else 1)
