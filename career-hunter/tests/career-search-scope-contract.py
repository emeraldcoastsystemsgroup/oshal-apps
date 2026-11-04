# CHANGE LOG
# 3 | maintainer@emeraldcoastsystemsgroup.com | Exercise current scoring worker metadata and remote evidence columns in the real candidate selector.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Keep the batch freshness cursor inside the temporary owner scope and stub the complete scoring profile.
# 1 | maintainer@emeraldcoastsystemsgroup.com | Check remote-or-local selection before scoring, exact distance boundaries, owner isolation and both SQL dialect renderers without model calls.
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'engine'))
from jobhunter import config, score, search_scope

scope = dict(version=1, near='Destin, FL', lat=30.4044, lon=-86.4714, radiusMiles=70, includeRemote=True)
conn = sqlite3.connect(':memory:')
conn.row_factory = sqlite3.Row
conn.executescript('''
CREATE TABLE postings(id INTEGER PRIMARY KEY, title TEXT, active INTEGER, target_role INTEGER,
 fit_score INTEGER DEFAULT 0, ai_fit_score INTEGER, posted_date TEXT DEFAULT (date('now')),
 first_seen_at TEXT DEFAULT (datetime('now')), remote INTEGER, city TEXT, lat REAL, lon REAL, location TEXT);
INSERT INTO postings(id,title,active,target_role,remote,city,lat,lon) VALUES
 (1,'Developer',1,1,0,'destin',30.4044,-86.4714),
 (2,'Developer',1,1,0,'pensacola',30.4213,-87.2169),
 (3,'Developer',1,1,0,'los angeles',34.0522,-118.2437),
 (4,'Developer',1,1,1,'los angeles',34.0522,-118.2437),
 (5,'Developer',1,1,1,NULL,NULL,NULL),
 (6,'Developer',1,1,0,NULL,NULL,NULL),
 (7,'Developer',1,1,0,'bad',999,0),
 (8,'Developer',1,1,0,'',30.4044,-86.4714),
 (9,'Adjunct Business Instructor',1,0,0,'destin',30.4044,-86.4714),
 (10,'Developer',1,1,0,'east outside circle',31.3,-85.6),
 (11,'Developer',1,1,0,'destin',30.4044,-86.4714);
UPDATE postings SET posted_date=date('now','-2 days') WHERE id<>11;
CREATE INDEX idx_fixture_posted ON postings(posted_date);
CREATE INDEX idx_fixture_seen ON postings(first_seen_at);
''')
queries = []
conn.set_trace_callback(queries.append)

@contextmanager
def connect():
    yield conn

config.POSTGRES = False
score.db.connect = connect
score.enrich.provider = lambda: True
score.enrich.model_name = lambda _: 'fixture'
score.profile.scoring_context = lambda **_: 'Fixture candidate with MBA and software experience.'
seen = []
def assess(row, summary, *, prior_fingerprint=None, model_identity=None):
    assert 'Do not treat the headquarters location' in summary
    return {'id': row['id']}
score._score_one = assess
def commit(result, _):
    seen.append(result['id'])
    return True
score._commit_one = commit

with tempfile.TemporaryDirectory(prefix='career-score-area-') as tmp:
    root = Path(tmp)
    owner = root / 'owner'
    owner.mkdir()
    config.DATA_DIR = owner
    config.CAREER_DB = owner / 'career.db'
    file = owner / search_scope.FILE_NAME
    file.write_text(json.dumps(scope))
    assert search_scope.load(root / 'other-owner') is None
    assert score.score_batch(limit=10, workers=1, title_any=['Developer', 'Adjunct'], fresh_days=7) == (6,0)
    assert seen == [1,2,4,5,9,11], seen
    seen.clear()
    assert score.score_batch(limit=1, workers=1, title_any=['Developer'], fresh_days=7, recent_first=True) == (1,0)
    assert seen == [11], 'newest eligible job must receive the bounded pass'
    scope['includeRemote'] = False
    file.write_text(json.dumps(scope))
    seen.clear()
    score.score_batch(limit=10, workers=1, title_any=['Developer'], fresh_days=7)
    assert seen == [1,2,11], seen
    query = next(q for q in reversed(queries) if q.startswith('WITH seen_candidates'))
    plan = '\n'.join(r['detail'] for r in conn.execute('EXPLAIN QUERY PLAN '+query))
    assert 'idx_fixture_posted (posted_date>?)' in plan, plan
    assert 'idx_fixture_seen (first_seen_at>?)' in plan, plan
    file.write_text('{}')
    try:
        score.score_batch(limit=1, workers=1)
        raise AssertionError('corrupt preferences must never widen scoring')
    except ValueError:
        pass
    file.unlink()
    file.symlink_to(owner / 'missing')
    try:
        search_scope.load(owner)
        raise AssertionError('symlinks must fail closed')
    except ValueError:
        pass
    assert 'LEAST' in search_scope.predicate(scope, postgres=True)
    assert 'GREATEST' in search_scope.predicate(scope, postgres=True)
    for case in json.loads(Path(__file__).with_name('career-scope-geometry.json').read_text()):
        test_scope = dict(scope, lat=case['lat'], lon=case['lon'])
        conn.execute('DELETE FROM postings')
        for i, (lat, lon) in enumerate(case['points']):
            conn.execute("INSERT INTO postings(id,title,active,target_role,remote,city,lat,lon) VALUES(?,'Fixture',1,1,0,'fixture',?,?)", (i, lat, lon))
        got = [r['id'] for r in conn.execute('SELECT id FROM postings WHERE '+search_scope.predicate(test_scope)+' ORDER BY id')]
        assert got == case['eligible'], (case['name'], got)
print('remote and local scoring passed')
