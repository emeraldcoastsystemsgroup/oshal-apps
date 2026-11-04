# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Prove complete bounded resume/material intake and source-backed additive qualification persistence with immutable failure preimages and fixture-only inference.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Use a fictional candidate: this store is public-track and the publish gate rightly refused a real person's name in a fixture.
"""Focused intake proof; all inference is replaced before any intake function executes."""
from __future__ import annotations

import contextlib
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
from jobhunter import config, enrich, profile


class Intake(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix='career-intake-')))
        self.owner = self.root / 'owner'
        self.owner.mkdir()
        self.stack.enter_context(patch.object(config, 'CAREER_DB', self.owner / 'career_db.json'))
        self.previous = {'profile': {'name': 'Fixture Candidate', 'clearance': 'Recorded relevant certifications (inactive)'},
                         'roles': [{'title': 'Engineer', 'deliverables': ['Recorded work']}],
                         'skills': {}, 'certifications': ['Existing fixture certificate'],
                         'custom': {'preserve': True}}
        config.CAREER_DB.write_text(json.dumps(self.previous))
        self.before = config.CAREER_DB.read_bytes()
        self.other = self.root / 'other-owner.json'
        self.other.write_bytes(b'other owner profile, untouched')
        self.responses, self.calls = [], []
        self.model = self.stack.enter_context(patch.object(enrich, 'complete', side_effect=self.complete))
        profile.load.cache_clear()
        self.addCleanup(profile.load.cache_clear)

    def complete(self, system, prompt, **kwargs):
        self.calls.append((system, prompt, kwargs))
        if not self.responses:
            raise AssertionError('Unscripted fixture model call')
        value = self.responses.pop(0)
        return json.dumps(value) if isinstance(value, (dict, list)) else value

    def document(self, text, suffix='.txt'):
        path = self.root / ('document' + suffix)
        path.write_text(text)
        return str(path)

    def extracted(self, **extra):
        return {'profile': {'name': 'Fixture Candidate', 'experience_summary': 'Recorded engineering background.', 'clearance': ''},
                'roles': [{'title': 'Engineer', 'org': 'Fixture', 'start': '2020', 'end': None,
                           'deliverables': ['Recorded work']}],
                'skills': {'Systems': {'items': ['Linux']}}, 'metrics_bank': [], **extra}

    def assert_unchanged(self):
        self.assertEqual(config.CAREER_DB.read_bytes(), self.before)
        self.assertEqual(self.other.read_bytes(), b'other owner profile, untouched')
        self.assertFalse((self.owner / 'backups').exists())
        self.assertFalse((self.owner / 'enrichment_log.jsonl').exists())

    def test_resume_keeps_late_multiline_education_certification_and_license(self):
        education = 'Fixture University\nPursuing B.S. in Computing, expected 2028'
        certification = 'Fixture Certification — expired 2020'
        license = 'Fixture Professional License — pending, 2027'
        text = 'Recorded engineering work. ' * 1000 + '\n' + '\n'.join([education, certification, license])
        self.assertGreater(len(text), 24000)
        self.responses = [self.extracted(education=[education], certifications=[certification], licenses=[license])]
        result = profile.build_from_resume(self.document(text))
        self.assertTrue(result['ok'], result)
        self.assertIn(license, self.calls[0][1])
        saved = json.loads(profile.scoring_context())
        self.assertEqual(saved['education'], [education])
        self.assertEqual(saved['certifications'], [certification])
        self.assertEqual(saved['licenses'], [license])
        self.assertEqual(self.other.read_bytes(), b'other owner profile, untouched')

    def test_oversized_resume_refuses_before_inference(self):
        result = profile.build_from_resume(self.document('x' * 32001))
        self.assertFalse(result['ok'])
        self.assertIn('32000-character text limit', result['error'])
        self.model.assert_not_called()
        self.assert_unchanged()

    def test_exact_text_ceiling_is_supported_without_a_prefix_cut(self):
        text = 'x' * (32000 - len('\nLate fixture certification')) + '\nLate fixture certification'
        self.responses = [self.extracted(certifications=['Late fixture certification'])]
        self.assertTrue(profile.build_from_resume(self.document(text))['ok'])
        self.assertIn('Late fixture certification', self.calls[0][1])

    def test_unsupported_extraction_shapes_do_not_publish(self):
        for field, value in [('education', {'degree': 'MBA'}), ('certifications', ['Unsupported credential']),
                             ('skills', {'Group': ['wrong shape']}), ('profile', {'clearance': None})]:
            with self.subTest(field=field):
                self.responses = [self.extracted(**{field: value})]
                result = profile.build_from_resume(self.document('Recorded engineering background and work experience.'))
                self.assertFalse(result['ok'], result)
                self.assert_unchanged()

    def test_resume_cannot_upgrade_or_strip_clearance_status(self):
        for key, value in [('clearance', 'Top relevant certifications'), ('clearance', 'relevant certifications'), ('credential', 'Invented fixture PMP')]:
            with self.subTest(key=key, value=value):
                data = self.extracted()
                data['profile'][key] = value
                self.responses = [data]
                result = profile.build_from_resume(self.document('Recorded engineering experience.\nrelevant certifications (inactive since 2020)'))
                self.assertFalse(result['ok'])
                self.assertIn(key, result['error'])
                self.assert_unchanged()

    def test_name_credential_and_complete_contact_clearance_fields_are_supported(self):
        for field, clearance in [('Active Secret', 'Active Secret'), ('Secret (pending adjudication)', 'Secret (pending adjudication)'),
                                 ('Expired Secret — 2020', 'Expired Secret — 2020'), ('Clearance: Active Secret', 'Active Secret')]:
            with self.subTest(clearance=clearance, field=field):
                text = ('Jordan Fixture, MBA\nSpringfield |jordan@example.test | ' + field
                        + ' | U.S. Citizen\n\nExperience\nRecorded engineering work.')
                data = self.extracted()
                data['profile'].update(name='Jordan Fixture', credential='MBA', clearance=clearance)
                self.responses = [data]
                result = profile.build_from_resume(self.document(text))
                self.assertTrue(result['ok'], result)
                self.assertEqual(profile.load()['profile']['credential'], 'MBA')
                self.assertEqual(profile.load()['profile']['clearance'], clearance)

    def test_contact_headers_cannot_drop_clearance_status_or_table_columns(self):
        for header, value in [
                ('Springfield |jordan@example.test | Secret (pending adjudication) | U.S. Citizen', 'Secret'),
                ('Springfield |jordan@example.test | Expired Secret — 2020 | U.S. Citizen', 'Secret'),
                ('Springfield |jordan@example.test | Secret | Expired 2020 | U.S. Citizen', 'Secret'),
                ('Springfield |jordan@example.test | Secret | Pending | U.S. Citizen', 'Secret'),
                ('Springfield |jordan@example.test | Active Secret | 2027 | U.S. Citizen', 'Active Secret'),
                ('Springfield |jordan@example.test | Active Secret | 10/2027 | U.S. Citizen', 'Active Secret'),
                ('Springfield |jordan@example.test | Active Secret | U.S. Citizen\nStatus: expired', 'Active Secret'),
                ('Experience\nSecret | Expired 2020 | jordan@example.test', 'Secret')]:
            with self.subTest(header=header, value=value):
                data = self.extracted()
                data['profile'].update(name='Jordan Fixture', credential='MBA', clearance=value)
                self.responses = [data]
                result = profile.build_from_resume(self.document('Jordan Fixture, MBA\n' + header + '\nRecorded engineering work.'))
                self.assertFalse(result['ok'], result)
                self.assertIn('clearance', result['error'])
                self.assert_unchanged()

    def test_additive_qualifications_preserve_prior_state_backup_and_audit(self):
        education = 'Fixture University\nPursuing B.S. in Computing, expected 2028'
        cert = 'Fixture certification — expired 2020'
        license = 'Fixture license — pending, 2027'
        facts = '\n'.join([education, cert, license])
        self.responses = [{'education_add': [education], 'certifications_add': [cert], 'licenses_add': [license],
                           'profile': {'clearance': 'Invented Top Secret'}, 'changelog': ['Recorded qualification statements']}]
        result = profile.augment(facts)
        self.assertTrue(result['ok'], result)
        saved = profile.load()
        self.assertEqual(saved['profile'], self.previous['profile'])
        self.assertEqual(saved['roles'], self.previous['roles'])
        self.assertEqual(saved['custom'], self.previous['custom'])
        self.assertEqual(saved['certifications'], ['Existing fixture certificate', cert])
        self.assertEqual(saved['education'], [education])
        self.assertEqual(saved['licenses'], [license])
        self.assertEqual(next((self.owner / 'backups').glob('career_db.*.json')).read_bytes(), self.before)
        audit = json.loads((self.owner / 'enrichment_log.jsonl').read_text().strip())
        self.assertEqual(audit['facts'], facts)
        before = config.CAREER_DB.read_bytes()
        self.responses = [{'education_add': [education], 'certifications_add': [cert.upper()], 'licenses_add': [license]}]
        self.assertFalse(profile.augment(facts)['changed'])
        self.assertEqual(config.CAREER_DB.read_bytes(), before)

    def test_partial_or_invented_qualification_refuses_entire_update(self):
        for field, item, source in [
                ('education_add', 'B.S. in Computing', 'Pursuing B.S. in Computing, expected 2028'),
                ('certifications_add', 'Fixture certification', 'Fixture certification — expired 2020'),
                ('licenses_add', 'Active fixture license', 'Fixture license — pending, 2027'),
                ('certifications_add', 'Fixture certification', 'Fixture certification\nStatus: expired since 2020'),
                ('certifications_add', 'Fixture certification', 'Fixture certification\nDate awarded: May 2024'),
                ('licenses_add', 'Fixture professional license', 'Fixture professional license\nMay 2024'),
                ('licenses_add', 'Fixture professional license', 'Pending, 2027\nFixture professional license'),
                ('education_add', 'Fixture School\nB.S. in Computing', 'Fixture School\nB.S. in Computing\n2020–2024'),
                ('certifications_add', 'Fixture certification', '2020. Fixture certification')]:
            with self.subTest(field=field, item=item):
                self.responses = [{'skills_add': {'Group': ['Must not partially save']}, field: [item]}]
                result = profile.augment(source)
                self.assertFalse(result['ok'], result)
                self.assertIn('complete source lines', result['error'])
                self.assert_unchanged()

    def test_existing_incompatible_qualification_shape_is_not_rewritten(self):
        self.previous['education'] = {'legacy': 'Keep this original structure'}
        config.CAREER_DB.write_text(json.dumps(self.previous))
        self.before = config.CAREER_DB.read_bytes()
        self.responses = [{'education_add': ['Recorded fixture education']}]
        result = profile.augment('Recorded fixture education')
        self.assertFalse(result['ok'])
        self.assertIn('existing education', result['error'])
        self.assert_unchanged()

    def test_absorbed_material_keeps_late_source_evidence_and_status(self):
        qualification = 'Fixture certification — pending, 2027'
        text = 'Recorded supporting work. ' * 1100 + '\n' + qualification
        self.assertGreater(len(text), 24000)
        self.responses = ['- ' + qualification, {'certifications_add': [qualification], 'changelog': ['Recorded source credential status']}]
        result = profile.absorb(self.document(text), kind='resume-extra')
        self.assertTrue(result['ok'], result)
        self.assertIn(qualification, self.calls[0][1])
        self.assertIn(qualification, json.loads(profile.scoring_context())['certifications'])

    def test_artifact_extraction_cannot_invent_a_qualification_in_the_merge_stage(self):
        self.responses = ['Invented fixture MBA, awarded 2020', {'education_add': ['Invented fixture MBA, awarded 2020']}]
        result = profile.absorb(self.document('Fixture University\nPursuing B.S. in Computing, expected 2028'))
        self.assertFalse(result['ok'])
        self.assertIn('complete source lines', result['error'])
        self.assert_unchanged()

    def test_oversized_artifact_refuses_before_inference(self):
        result = profile.absorb(self.document('x' * 32001), kind='resume-extra')
        self.assertFalse(result['ok'])
        self.assertIn('32000-character text limit', result['error'])
        self.model.assert_not_called()
        self.assert_unchanged()

    def test_license_members_of_career_exports_are_supported(self):
        path = self.root / 'career.zip'
        qualification = 'Fixture license — pending, 2027'
        with zipfile.ZipFile(path, 'w') as archive:
            archive.writestr('Licenses.csv', qualification)
        self.responses = ['- ' + qualification, {'licenses_add': [qualification]}]
        result = profile.absorb(str(path), kind='linkedin-export')
        self.assertTrue(result['ok'], result)
        self.assertEqual(profile.load()['licenses'], [qualification])

    def test_bad_json_or_oversized_qualification_never_publishes(self):
        for response in ['invalid model JSON', {'certifications_add': ['x' * 2001]}]:
            with self.subTest(response=str(response)[:40]):
                self.responses = [response]
                result = profile.augment('x' * 2001)
                self.assertFalse(result['ok'])
                self.assert_unchanged()

    def test_credentials_from_truncated_facts_require_a_smaller_complete_update(self):
        self.responses = [{'certifications_add': ['Fixture certification']}]
        result = profile.augment('Fixture certification\n' + 'x' * 20000)
        self.assertFalse(result['ok'])
        self.assertIn('smaller update', result['error'])
        self.assert_unchanged()


if __name__ == '__main__':
    result = unittest.TextTestRunner(stream=sys.stderr).run(unittest.defaultTestLoader.loadTestsFromTestCase(Intake))
    print(json.dumps({'checks': result.testsRun, 'failed': [str(t) for t, _ in result.failures + result.errors]}))
    raise SystemExit(0 if result.wasSuccessful() else 1)
