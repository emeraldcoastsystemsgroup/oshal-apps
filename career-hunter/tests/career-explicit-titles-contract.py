# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise explicit-title selection outside the generic technology lane using real disposable SQLite and no model calls.
# 2 | maintainer@emeraldcoastsystemsgroup.com | Isolate the scoring traversal cursor and stub the complete scoring context used by the real batch selector.
# 3 | maintainer@emeraldcoastsystemsgroup.com | Exercise current scoring-worker metadata and workplace evidence columns in the pre-inference selector fixture.
from contextlib import contextmanager
import sqlite3
import tempfile
from pathlib import Path
from jobhunter import config, score

fixture = tempfile.TemporaryDirectory(prefix='career-explicit-score-')
config.DATA_DIR = Path(fixture.name)
config.CAREER_DB = Path(fixture.name)/'career.db'

conn = sqlite3.connect(':memory:')
conn.row_factory = sqlite3.Row
conn.executescript('''
CREATE TABLE postings(id INTEGER PRIMARY KEY, title TEXT, active INTEGER, target_role INTEGER,
 fit_score INTEGER, ai_fit_score INTEGER, posted_date TEXT, first_seen_at TEXT, remote INTEGER);
INSERT INTO postings VALUES
 (1,'Adjunct Business Instructor',1,0,0,NULL,date('now'),datetime('now'),0),
 (2,'Software Developer',1,1,80,NULL,date('now'),datetime('now'),1),
 (3,'Registered Nurse',1,0,0,NULL,date('now'),datetime('now'),0),
 (4,'Adjunct Computer Science Instructor',0,0,0,NULL,date('now'),datetime('now'),1),
 (5,'Adjunct Business Instructor',1,0,0,NULL,date('now','-30 days'),datetime('now'),1);
''')
conn.execute('ALTER TABLE postings ADD COLUMN location TEXT')

@contextmanager
def connect():
    yield conn

config.POSTGRES = False
score.db.connect = connect
score.enrich.provider = lambda: True
score.enrich.resolve_scoring_identity = lambda _: score.enrich.ScoringIdentity('fixture','fixture')
score.profile.scoring_context = lambda **_: 'Fixture candidate with an MBA and software experience.'
score._score_one = lambda row, _, **metadata: {'id': row['id']}
selected = []
def commit(result, _):
    selected.append(result['id'])
    return True
score._commit_one = commit

def check(terms, expected, remote_only=False):
    selected.clear()
    scored, skipped = score.score_batch(limit=10, workers=1, title_any=terms, fresh_days=7, remote_only=remote_only)
    assert selected == expected, (terms, selected, expected)
    assert (scored, skipped) == (len(expected), 0)

check(['Adjunct'], [1])
check(None, [2])
check([' ', ''], [2])
check(['Adjunct'], [], remote_only=True)
assert 'career-defining move' not in score.SYSTEM
assert 'Additional experience is not itself a missing qualification' in score.SYSTEM
print('explicit titles, freshness, active state, remote preference and generic lane passed')
