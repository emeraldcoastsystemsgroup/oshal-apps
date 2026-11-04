# CHANGE LOG
# 2 | maintainer@emeraldcoastsystemsgroup.com | Execute the current score_batch selector against real SQLite, including contradictory legacy flags and legacy scores, rather than reconstructing an obsolete WHERE clause.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Contract for remote-only matching and its shared candidate gates.
"""Synthetic candidate selection only: no provider, employer request or persistent owner data."""
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'engine'))
from jobhunter import config, enrich, score

CHECKS = []
def check(name, condition):
    CHECKS.append((name, bool(condition)))


def main():
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    conn.execute('''CREATE TABLE postings(id INTEGER PRIMARY KEY, title TEXT, remote INTEGER,
        active INTEGER, target_role INTEGER, fit_score INTEGER, ai_fit_score INTEGER, location TEXT)''')
    conn.executemany('INSERT INTO postings VALUES(?,?,?,?,?,?,?,?)', [
        (1,'Remote Platform Lead',1,1,1,80,None,'Remote'),
        (2,'On-site Platform Lead',0,1,1,80,None,'Destin, FL'),
        (3,'Remote legacy score',1,1,1,80,72,'Remote'),
        (4,'Remote out of lane',1,1,0,80,None,'Remote'),
        (5,'Remote inactive',1,0,1,80,None,'Remote'),
        (6,'Remote low keyword fit',1,1,1,10,None,'Remote'),
        (7,'Remote Sensing Engineer',1,1,1,80,None,'Seattle, WA'),
        (8,'Developer',1,1,1,80,None,'Hybrid Remote'),
        (9,'Developer',1,1,1,80,None,'Not remote'),
    ])
    @contextmanager
    def connect():
        yield conn
    seen = []
    def assess(row, summary, **metadata):
        seen.append(row['id'])
        return {'id':row['id']}
    def candidates(remote_only=False, min_keyword=40):
        seen.clear()
        score.score_batch(workers=1, remote_only=remote_only, min_keyword=min_keyword)
        return set(seen)

    with tempfile.TemporaryDirectory(prefix='career-remote-only-') as tmp:
        with patch.object(config,'POSTGRES',False), patch.object(config,'CAREER_DB',Path(tmp)/'owner'/'career.db'), \
             patch.object(score.db,'connect',connect), patch.object(score.db,'score_fingerprints',return_value={}), \
             patch.object(enrich,'provider',return_value=True), \
             patch.object(enrich,'resolve_scoring_identity',return_value=enrich.ScoringIdentity('fixture','fixture')), \
             patch.object(score.profile,'scoring_context',return_value='Fixture candidate'), \
             patch.object(score,'_score_one',side_effect=assess), patch.object(score,'_commit_one',return_value=True):
            off, on = candidates(), candidates(True)
            check('off retains on-site and remote candidates', off == {1,2,3,7,8,9})
            check('on retains only supported fully remote candidates', on == {1,3})
            check('remote-only narrows the same candidate set', on < off)
            check('on-site is excluded', 2 not in on)
            check('occupational legacy flag is excluded', 7 not in on)
            check('hybrid legacy flag is excluded', 8 not in on)
            check('negated legacy flag is excluded', 9 not in on)
            check('legacy scores remain refreshable', 3 in on and 3 in off)
            check('out-of-lane stays excluded', 4 not in on and 4 not in off)
            check('inactive stays excluded', 5 not in on and 5 not in off)
            check('keyword floor stays applied', 6 not in on and 6 not in off)
            check('without keyword floor low-fit remote returns', candidates(True,0) == {1,3,6})
            check('selection does not rewrite corpus flags', conn.execute('SELECT SUM(remote) FROM postings').fetchone()[0] == 8)
    conn.close()
    failed = [name for name, ok in CHECKS if not ok]
    print(json.dumps({'checks':len(CHECKS), 'failed':failed}))
    return bool(failed)

if __name__ == '__main__':
    raise SystemExit(main())
