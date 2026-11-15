# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Apply the same owner relationship migration before nightly work, never against a read-only user or shared corpus.
# 2 | maintainer@emeraldcoastsystemsgroup.com | 1.66.0: also apply 002, the index of jobs marked "details needed" that New matches lists; each migration is applied when its own indexes are missing.
from pathlib import Path

MIGRATIONS = (('001-career-pipeline-order.sql', ('idx_user_queue_order', 'idx_user_tracked_order')),
              ('002-career-needs-details.sql', ('idx_user_needs_details',)))


def migrate(conn):
    folder = Path(__file__).resolve().parents[2] / 'migrations/sqlite'
    for name, indexes in MIGRATIONS:
        marks = ','.join('?' for _ in indexes)
        have = conn.execute(f"SELECT name FROM sqlite_master WHERE type='index' AND name IN ({marks})", indexes).fetchall()
        if len(have) != len(indexes):
            conn.executescript((folder / name).read_text())
