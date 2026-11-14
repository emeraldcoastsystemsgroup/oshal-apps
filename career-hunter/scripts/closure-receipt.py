#!/usr/bin/env python3
"""Print the newest closure receipt of the shared Career jobs corpus: closed, possibly re-keyed and re-keyed jobs, in
total and for the 25 employers with the most. Read-only: the corpus is attached immutably and nothing is written.

    python3 career-hunter/scripts/closure-receipt.py [path/to/corpus.db]

The default path is the native installation's published corpus on this host.

CHANGE LOG
1 | maintainer@emeraldcoastsystemsgroup.com | Read the nightly closure receipt (engine/jobhunter/closures.py) without opening the corpus for writing.
"""
import json
import sqlite3
import sys
from pathlib import Path
from urllib.parse import quote

DEFAULT = Path.home() / ".local/state/oshal-native/data/career/corpus.db"
SHOWN = 25


def newest(corpus):
    """The newest receipt, or None. The corpus is attached as `corpus` because its views name that schema."""
    conn = sqlite3.connect(":memory:", uri=True)
    try:
        conn.execute("ATTACH DATABASE ? AS corpus", (f"file:{quote(str(corpus))}?mode=ro&immutable=1",))
        if not conn.execute("SELECT 1 FROM corpus.sqlite_master WHERE type='table' AND name='closure_receipts'").fetchone():
            return None
        row = conn.execute("SELECT receipt FROM corpus.closure_receipts ORDER BY pull_started_at DESC LIMIT 1").fetchone()
        return json.loads(row[0]) if row else None
    finally:
        conn.close()


def lines(receipt):
    """The totals line, then one line for each of the employers with the most changes."""
    totals = receipt["totals"]
    yield (f"Pull started {receipt['pullStartedAt']}: {totals['closed']} closed, {totals['possibleRekey']} closed but "
           f"possibly re-keyed, {totals['rekeyed']} re-keyed (kept as the same job), across {totals['sources']} sources. "
           f"Reads reported {totals['sourceRunsClosed']} closed; the records add up to {totals['wentInactive']}.")
    ranked = sorted(receipt["sources"], key=lambda source: -(source["wentInactive"] + source["rekeyed"]))
    for source in ranked[:SHOWN]:
        yield (f"  {source['name']} ({source['reader']}): {source['closed']} closed, {source['possibleRekey']} possible "
               f"re-key, {source['rekeyed']} re-keyed")


def main(argv):
    corpus = Path(argv[1]) if len(argv) > 1 else DEFAULT
    if not corpus.is_file():
        print(f"No corpus at {corpus}.", file=sys.stderr)
        return 2
    receipt = newest(corpus)
    if receipt is None:
        print("No closure receipt yet: no full pull has finished on a Career version with closure receipts.")
        return 1
    for line in lines(receipt):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
