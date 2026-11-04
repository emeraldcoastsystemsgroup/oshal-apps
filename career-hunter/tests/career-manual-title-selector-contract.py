# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Execute the actual title-scoring launcher against synthetic SQLite and stop at the inference boundary to verify manual saved-title, freshness, remote, radius and budget gates.
from contextlib import contextmanager, redirect_stdout
from io import StringIO
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile

sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'engine'))
from jobhunter import config, enrich, score, search_scope

with tempfile.TemporaryDirectory(prefix='career-manual-titles-') as temporary:
    root = Path(temporary)
    config.DATA_DIR, config.CAREER_DB, config.POSTGRES = root, root/'career.db', False
    (root/search_scope.FILE_NAME).write_text(json.dumps(dict(version=1,near='Destin, FL',lat=30.4044,lon=-86.4714,radiusMiles=70,includeRemote=True)))
    conn = sqlite3.connect(':memory:');conn.row_factory=sqlite3.Row
    conn.executescript('''
      CREATE TABLE postings(id INTEGER PRIMARY KEY,title TEXT,active INTEGER,target_role INTEGER,
        fit_score INTEGER,ai_fit_score INTEGER,posted_date TEXT,first_seen_at TEXT,remote INTEGER,
        location TEXT,city TEXT,lat REAL,lon REAL);
      INSERT INTO postings VALUES
        (1,'Adjunct Business Instructor',1,0,0,NULL,date('now'),datetime('now'),0,'Destin, FL','destin',30.4044,-86.4714),
        (2,'Desktop Support Technician',1,0,0,NULL,date('now'),datetime('now'),0,'Destin, FL','destin',30.4044,-86.4714),
        (3,'Software Developer',1,1,90,NULL,date('now'),datetime('now'),1,'Remote US',NULL,NULL,NULL),
        (4,'Adjunct Business Instructor',0,0,0,NULL,date('now'),datetime('now'),0,'Destin, FL','destin',30.4044,-86.4714),
        (5,'Adjunct Business Instructor',1,0,0,NULL,date('now','-30 days'),datetime('now'),0,'Destin, FL','destin',30.4044,-86.4714),
        (6,'Desktop Support Technician',1,0,0,NULL,date('now'),datetime('now'),0,'Seattle, WA','seattle',47.6062,-122.3321),
        (7,'Desktop Support Technician',1,0,0,NULL,date('now'),datetime('now'),1,'Remote US','seattle',47.6062,-122.3321);
    ''')
    before = [tuple(row) for row in conn.execute('SELECT * FROM postings ORDER BY id')]
    @contextmanager
    def connect():
        yield conn
    score.db.connect = connect
    score.db.init_db = lambda: None
    score.db.score_fingerprints = lambda *_: {}
    enrich.provider = lambda: True
    enrich.resolve_scoring_identity = lambda *_: enrich.ScoringIdentity('fixture','fixture')
    score.profile.scoring_context = lambda **_: 'Fixture candidate with an actual MBA and support experience.'
    selected = []
    def before_inference(row, summary, **metadata):
        assert 'actual MBA' in summary
        selected.append(row['id'])
        return {'id':row['id']}
    score._score_one = before_inference
    score._commit_one = lambda *_: True
    # Any accidental direct model dispatch fails rather than spending a fixture call.
    enrich.complete = lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError('model call escaped selector fixture'))
    output = StringIO()
    with redirect_stdout(output):
        exec(os.environ['CAREER_TEST_SCORE_CODE'],{})
    assert [tuple(row) for row in conn.execute('SELECT * FROM postings ORDER BY id')] == before
    print(json.dumps({'selected':sorted(selected),'terminal':output.getvalue().strip().splitlines()[-1]}))
