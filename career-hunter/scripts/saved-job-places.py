#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | 1.67.4 (Roger, 2026-11-16: "the job location doesnt transfer to the my jobs page"): count, read-only, what My jobs shows about where each saved job is, for every person on one installation. There is no write step: a saved job is a reference to its posting and My jobs reads the place from the posting on every page load, so after delivery every job saved before it carries its place with nothing to fill. This is the dry run that proves it: it prints counts only and writes nothing.
"""Count, read-only, where every person's saved Career jobs are, as My jobs will show them.

Usage (counts only; no subject, principal, posting id, title, employer or place is printed):
    python3 -I career-hunter/scripts/saved-job-places.py <career data root>

The data root is the native layout the kernel mounts for Career: `corpus.db` (the shared corpus; a tenant's own
`<tenant>/corpus.db` serves while there is none) and `<tenant>/people/<principal>/current`, which names the person's
published generation under `generations/`. Every database is opened `mode=ro&immutable=1`; no file is written.

What each count means:
  saved                 jobs a person saved and has not removed (board-state favourites with a live signal row)
  missing_from_corpus   saved jobs whose posting the corpus does not hold (none can show a place)
  place_text            postings that name a place; place_unknown is the rest (My jobs says "Location unknown")
  fully_remote          by the board's own rule (engine work_arrangement.fully_remote_predicate)
  with_point            postings with the city point Find jobs maps
  with_distance         a point, not fully remote, and the person has a home (their saved Matching area)
  would_write           always 0: the place is read from the posting, there is no stored copy to fill
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import urllib.parse
from collections import Counter

ENGINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'engine')
sys.path.insert(0, ENGINE)
from jobhunter.work_arrangement import fully_remote_predicate  # noqa: E402  (the board's own rule)


def read_only(path: str) -> str:
    """The URI that opens a database without locks, journals or writes."""
    return 'file:' + urllib.parse.quote(os.path.abspath(path)) + '?mode=ro&immutable=1'


def corpus_path(root: str, tenant: str) -> str | None:
    """The corpus a person's reads attach: the shared one, else the tenant's own."""
    for path in (os.path.join(root, 'corpus.db'), os.path.join(root, tenant, 'corpus.db')):
        if os.path.isfile(path):
            return path
    return None


def generation(person_dir: str) -> str | None:
    """The person's published generation folder, or None when there is none."""
    current = os.path.join(person_dir, 'current')
    if not os.path.isfile(current):
        return None
    folder = os.path.join(person_dir, 'generations', open(current, encoding='utf-8').read().strip())
    return folder if os.path.isdir(folder) else None


def saved_ids(folder: str) -> list[int]:
    """The board-state favourites, as the board reads them."""
    path = os.path.join(folder, 'job-board-state.json')
    if not os.path.isfile(path):
        return []
    jobs = json.load(open(path, encoding='utf-8')).get('jobs') or {}
    return [int(key) for key, value in jobs.items() if isinstance(value, dict) and value.get('favorite') is True]


def has_home(folder: str) -> bool:
    """Whether the person saved a Matching area (job-search-scope.json with a point)."""
    path = os.path.join(folder, 'job-search-scope.json')
    try:
        value = json.load(open(path, encoding='utf-8'))
    except (OSError, ValueError):
        return False
    return isinstance(value.get('lat'), (int, float)) and isinstance(value.get('lon'), (int, float))


def count_person(folder: str, corpus: str, totals: Counter) -> None:
    """Add one person's saved jobs to the totals; reads only."""
    stores = [name for name in os.listdir(folder) if name.startswith('user-') and name.endswith('.db')]
    ids = saved_ids(folder)
    if len(stores) != 1 or not ids:
        totals['people_without_saved_jobs'] += 1
        return
    db = sqlite3.connect(read_only(os.path.join(folder, stores[0])), uri=True)
    try:
        db.execute('PRAGMA writable_schema=ON')  # the corpus carries views that name their own schema
        db.execute('ATTACH DATABASE ? AS corpus', (read_only(corpus),))
        marks = ','.join('?' * len(ids))
        live = [row[0] for row in db.execute(
            f"SELECT posting_id FROM user_signals WHERE posting_id IN ({marks}) AND COALESCE(status,'new')<>'dismissed'", ids)]
        totals['people_with_saved_jobs'] += 1
        home = has_home(folder)
        totals['people_with_home'] += home
        totals['saved'] += len(live)
        if not live:
            return
        marks = ','.join('?' * len(live))
        columns = {row[1] for row in db.execute('PRAGMA corpus.table_info(postings_corpus)')}
        point = '(p.lat IS NOT NULL AND p.lon IS NOT NULL)' if {'lat', 'lon'} <= columns else '0'
        remote = f'(CASE WHEN {fully_remote_predicate("p")} THEN 1 ELSE 0 END)'
        row = db.execute(f"""SELECT count(*),
              coalesce(sum(CASE WHEN trim(coalesce(p.location,''))<>'' THEN 1 ELSE 0 END),0),
              coalesce(sum({remote}),0), coalesce(sum(CASE WHEN {point} THEN 1 ELSE 0 END),0),
              coalesce(sum(CASE WHEN {point} AND {remote}=0 THEN 1 ELSE 0 END),0)
            FROM corpus.postings_corpus p WHERE p.id IN ({marks})""", live).fetchone()
        found, text, fully, with_point, local_point = row
        totals['missing_from_corpus'] += len(live) - found
        totals['place_text'] += text
        totals['place_unknown'] += found - text
        totals['fully_remote'] += fully
        totals['with_point'] += with_point
        totals['with_distance'] += local_point if home else 0
    finally:
        db.close()


def count(root: str) -> dict:
    """Every person with a published generation under the root."""
    totals = Counter(people=0)
    for tenant in sorted(os.listdir(root)):
        people = os.path.join(root, tenant, 'people')
        if not os.path.isdir(people):
            continue
        corpus = corpus_path(root, tenant)
        for principal in sorted(os.listdir(people)):
            folder = generation(os.path.join(people, principal))
            if folder is None:
                continue
            totals['people'] += 1
            if corpus is None:
                totals['people_without_corpus'] += 1
                continue
            count_person(folder, corpus, totals)
    keys = ['people', 'people_with_saved_jobs', 'people_with_home', 'saved', 'missing_from_corpus', 'place_text',
            'place_unknown', 'fully_remote', 'with_point', 'with_distance']
    out = {key: int(totals.get(key, 0)) for key in keys}
    out.update({key: int(value) for key, value in totals.items() if key not in out})
    out['would_write'] = 0
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not os.path.isdir(argv[1]):
        print('usage: saved-job-places.py <career data root>', file=sys.stderr)
        return 2
    print(json.dumps(count(argv[1]), indent=1, sort_keys=False))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
