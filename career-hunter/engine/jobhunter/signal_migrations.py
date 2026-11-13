# CHANGE LOG
# 1 | maintainer@emeraldcoastsystemsgroup.com | Apply the same owner relationship migration before nightly work, never against a read-only user or shared corpus.
from pathlib import Path

def migrate(conn):
    have = conn.execute("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('idx_user_queue_order','idx_user_tracked_order')").fetchall()
    if len(have) == 2:
        return
    sql = Path(__file__).resolve().parents[2] / 'migrations/sqlite/001-career-pipeline-order.sql'
    conn.executescript(sql.read_text())
