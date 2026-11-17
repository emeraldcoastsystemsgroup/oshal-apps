# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.6 (Roger, 2026-11-16, Torch Technologies on My jobs): scripts/backfill-job-descriptions.py over a disposable Career root built from the engine's own corpus schema, the employer answering from the saved real Torch Technologies posting: the dry run reads each candidate once (a rate-limited or failing answer is asked again after its Retry-After, else 5 then 15 seconds, three times at most) and prints counts only, writing nothing; plan, prepare and publish fill exactly the descriptions that read, in an edited copy proven to differ only there, under the pull's lock; a closed, refused or empty answer leaves its posting as it was; a second run fills nothing; a held lock, a changed corpus or a stopped pull's work refuses.
"""Run by tests/career-job-descriptions-backfill.test.mjs. No network: the engine client's session answers from fixtures."""
import contextlib
import fcntl
import hashlib
import importlib.util
import io
import json
import os
import sqlite3
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

ENGINE = Path(__file__).resolve().parents[1] / 'engine'
sys.path.insert(0, str(ENGINE))
os.environ['JOBHUNTER_MULTIUSER'] = '1'
os.environ['JOBHUNTER_STORE'] = 'sqlite'
from jobhunter import config, db, http  # noqa: E402

SPEC = importlib.util.spec_from_file_location('backfill', Path(__file__).resolve().parents[1] / 'scripts' / 'backfill-job-descriptions.py')
BACKFILL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BACKFILL)
FIXTURE = (Path(__file__).resolve().parent / 'employer-detail-fixtures' / 'workday-torch-R2197.json').read_text(encoding='utf-8')
CXS = 'https://starfish.wd501.myworkdayjobs.com/wday/cxs/starfish/Careers/job/Eglin-AFB-FL/'
POSTINGS = [  # id, company, ats job id, active, description
    (10, 635, 'Test-Operations-Support-Lead_R2197', 1, None),
    (11, 635, 'No-Such-Posting_R0000000', 1, None),
    (12, 635, 'Listed-Posting_R2000', 1, 'Invented listing text. ' * 40),
    (13, 635, 'Closed-Earlier_R1999', 0, None),
    (14, 635, 'Refused-Posting_R2001', 1, None),
    (15, 635, 'Empty-Posting_R2002', 1, None),
    (16, 635, 'Busy-Then-Open_R2003', 1, None),
    (17, 635, 'Down-Posting_R2004', 1, None),
    (20, 4, 'ef-20', 1, None),
]
ANSWERS = {CXS + 'Test-Operations-Support-Lead_R2197': (200, FIXTURE), CXS + 'No-Such-Posting_R0000000': (404, '{"httpStatus":404}'),
           CXS + 'Refused-Posting_R2001': (403, '<html>Forbidden</html>'),
           CXS + 'Empty-Posting_R2002': (200, '{"jobPostingInfo":{"title":"Empty Posting"}}'),
           CXS + 'Down-Posting_R2004': (503, '{}')}
# Rate-limited once (Retry-After: 1), then the posting answers.
ONCE_LIMITED = CXS + 'Busy-Then-Open_R2003'


def response(status, text, headers=None):
    out = requests.Response()
    out.status_code, out._content, out.encoding = status, text.encode('utf-8'), 'utf-8'
    out.headers.update(headers or {})
    return out


def corpus_bytes(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Backfill(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='career-backfill-')
        self.root = Path(self.temporary.name)
        (self.root / 'ingest').mkdir()
        (self.root / 'maintenance').mkdir()
        conn = sqlite3.connect(self.root / 'corpus.db')
        conn.executescript(db.CORPUS_SCHEMA.replace('corpus.', ''))
        conn.execute("INSERT INTO companies(id,name,ats_type,ats_token) VALUES (635,'Torch Technologies','workday','starfish:wd501:Careers'),"
                     "(4,'Invented Eightfold Employer','eightfold','invented.eightfold.ai|x')")
        for posting_id, company, job, active, text in POSTINGS:
            url = f'https://starfish.wd501.myworkdayjobs.com/en-US/Careers/job/Eglin-AFB-FL/{job}' if company == 635 else 'https://invented.eightfold.ai/careers/job/20'
            ats_job_id = f'/job/Eglin-AFB-FL/{job}' if company == 635 else job
            conn.execute('INSERT INTO postings_corpus(id,company_id,ats_job_id,title,location,url,description,active,target_role) VALUES (?,?,?,?,?,?,?,?,1)',
                         (posting_id, company, ats_job_id, job.replace('-', ' '), 'a regional federal hub, FL', url, text, active))
        conn.commit()
        conn.close()
        self.reads, self.pauses = [], []
        for item in (patch.object(config, 'PER_HOST_DELAY', 0.0), patch.object(http._session, 'get', side_effect=self.get),
                     patch.object(http, '_throttle', lambda url: None), patch.object(BACKFILL, '_pause', side_effect=self.pauses.append)):
            item.start()
            self.addCleanup(item.stop)
        self.addCleanup(self.temporary.cleanup)

    def get(self, url, **kwargs):
        self.assertIs(kwargs.get('allow_redirects'), False, 'never redirected')
        self.assertTrue(http._public_only_active, 'public addresses only')
        self.reads.append(url)
        if url == ONCE_LIMITED:
            first = self.reads.count(url) == 1
            return response(429, '{}', {'Retry-After': '1'}) if first else response(200, FIXTURE)
        return response(*ANSWERS.get(url, (404, '{}')))

    def run_main(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(BACKFILL.main([str(arg) for arg in args]), 0)
        return json.loads(out.getvalue())

    def description(self, posting_id, path=None):
        conn = sqlite3.connect(path or self.root / 'corpus.db')
        try:
            return conn.execute('SELECT description FROM postings_corpus WHERE id=?', (posting_id,)).fetchone()[0]
        finally:
            conn.close()

    def test_the_dry_run_reads_each_candidate_once_prints_counts_only_and_writes_nothing(self):
        before = corpus_bytes(self.root / 'corpus.db')
        counts = self.run_main('dry-run', self.root, '--company', 635)
        self.assertEqual(counts, {'employers': 1, 'candidates': 6, 'noReader': 0, 'read': 6, 'filled': 2, 'closed': 1,
                                  'refused': 1, 'empty': 1, 'unavailable': 1, 'statuses': {'404': 1, '403': 1, '503': 1},
                                  'wouldWrite': 0})
        once = sorted(CXS + job for _, company, job, active, text in POSTINGS if company == 635 and active and not text)
        self.assertEqual(sorted(set(self.reads)), once, 'every candidate, and nothing else')
        self.assertEqual(self.reads.count(ONCE_LIMITED), 2, 'a rate-limited answer is asked again once')
        self.assertEqual(self.reads.count(CXS + 'Down-Posting_R2004'), 3, 'a failing site is asked three times at most')
        self.assertEqual(sorted(self.pauses), [1, 5, 15], 'after its Retry-After, else 5 then 15 seconds')
        self.assertEqual(corpus_bytes(self.root / 'corpus.db'), before)
        self.assertEqual(list((self.root / 'maintenance').iterdir()), [])

    def test_plan_prepare_publish_fill_only_what_was_read_and_a_second_run_fills_nothing(self):
        folder = self.root / 'maintenance' / 'torch'
        counts = self.run_main('plan', self.root, folder, '--company', 635)
        self.assertEqual((counts['candidates'], counts['filled']), (6, 2))
        self.assertEqual(stat.S_IMODE((folder / 'plan.json').stat().st_mode), 0o600)
        before = corpus_bytes(self.root / 'corpus.db')
        prepared = self.run_main('prepare', self.root, folder)
        self.assertEqual((prepared['status'], prepared['planned'], prepared['filled']), ('prepared-not-published', 2, 2))
        self.assertEqual(corpus_bytes(self.root / 'corpus.db'), before, 'prepare edits a copy only')
        published = self.run_main('publish', self.root, folder)
        self.assertEqual(published['status'], 'published')
        expected, outcome = BACKFILL.describe('workday', json.loads(FIXTURE), '/job/Eglin-AFB-FL/Test-Operations-Support-Lead_R2197')
        self.assertEqual((self.description(10), self.description(16), outcome), (expected, expected, 'filled'))
        self.assertTrue(expected.startswith('Torch Technologies\nThank you for your interest'))
        for untouched in (11, 13, 14, 15, 17, 20):
            self.assertIsNone(self.description(untouched), f'{untouched}: nothing is invented')
        self.assertTrue(self.description(12).startswith('Invented listing text.'))
        self.assertEqual(corpus_bytes(folder / 'corpus.before.db'), before, 'the old corpus is kept')
        conn = sqlite3.connect(self.root / 'corpus.db')
        try:
            self.assertEqual(sorted(row[0] for row in conn.execute("SELECT rowid FROM postings_fts WHERE postings_fts MATCH 'Eglin'")),
                             [10, 16], 'the search index has the new text')
        finally:
            conn.close()
        self.reads.clear()
        again = self.root / 'maintenance' / 'torch-again'
        counts = self.run_main('plan', self.root, again, '--company', 635)
        self.assertEqual((counts['candidates'], counts['filled']), (4, 0), 'only the postings that did not read are read again')
        self.assertNotIn(CXS + 'Test-Operations-Support-Lead_R2197', self.reads)
        self.assertNotIn(ONCE_LIMITED, self.reads)
        before = corpus_bytes(self.root / 'corpus.db')
        self.assertEqual(self.run_main('prepare', self.root, again), {'status': 'nothing-to-fill', 'filled': 0})
        self.assertEqual(corpus_bytes(self.root / 'corpus.db'), before)

    def test_a_held_lock_a_changed_corpus_or_a_stopped_pulls_work_refuses(self):
        folder = self.root / 'maintenance' / 'torch'
        self.run_main('plan', self.root, folder, '--company', 635)
        with (self.root / '.corpus-ingest.lock').open('a+b') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(SystemExit, 'a pull holds the corpus'):
                BACKFILL.main(['prepare', str(self.root), str(folder)])
        (self.root / 'ingest' / 'current').mkdir()
        with self.assertRaisesRegex(SystemExit, 'a stopped pull has work in progress'):
            BACKFILL.main(['prepare', str(self.root), str(folder)])
        (self.root / 'ingest' / 'current').rmdir()
        conn = sqlite3.connect(self.root / 'corpus.db')
        conn.execute("UPDATE postings_corpus SET title='Changed' WHERE id=12")
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(SystemExit, 'the corpus changed since the plan'):
            BACKFILL.main(['prepare', str(self.root), str(folder)])
        self.assertFalse((folder / 'corpus.next.db').exists())
        with self.assertRaises(SystemExit):
            BACKFILL.main(['dry-run', str(self.root)])  # an employer must be named
        with self.assertRaises(SystemExit):
            BACKFILL.main(['plan', str(self.root), str(self.root / 'elsewhere'), '--company', '635'])


if __name__ == '__main__':
    unittest.main(argv=['backfill'], verbosity=1)
