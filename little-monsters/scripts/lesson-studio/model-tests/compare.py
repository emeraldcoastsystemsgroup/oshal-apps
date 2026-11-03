#!/usr/bin/env python3
"""One table per lesson: the published script against each model run, on the same measures.

CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                  | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com | Comparison of author.py runs with the published lessons: passed, rounds, words, beats, length, moving parts, highlights, layout problems, problems left, model minutes and tokens; the published lessons are measured with their committed takes' timing

Usage: python3 compare.py <run dir> [<run dir> ...] [--targets percent,transitions]
"""
import argparse
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
STUDIO = HERE.parent
CATALOG = STUDIO.parent.parent / 'data/test-prep/catalog.json'


def published(target, domain):
    """The published lesson, measured with its committed take's timing."""
    check = json.loads(subprocess.run(['node', str(HERE / 'check.cjs'), str(STUDIO), target, domain], capture_output=True, text=True).stdout)
    timing = STUDIO / 'takes' / f'{target}.timing.json'
    build = json.loads(subprocess.run(['node', str(HERE / 'build-audit.cjs'), str(STUDIO), target, str(timing)], capture_output=True, text=True).stdout)
    return {'passed': check['ok'] and build.get('built', False) and not build.get('problems'), 'rounds': '-', 'words': check['stats']['words'],
            'beats': check['stats']['beats'], 'seconds': round(build['duration']), 'moving': build['movingParts'],
            'highlights': build['highlights'], 'audit': len(build['problems'])}


def run_row(run, target):
    """The last round of one model run on one lesson, or None when that run did not write it."""
    f = Path(run) / target / 'result.json'
    if not f.exists():
        return None
    r = json.loads(f.read_text())
    rounds = r['rounds']
    last = rounds[-1] if rounds else {}
    stats = last.get('stats') or {}
    return {'passed': r['passed'], 'rounds': len(rounds), 'words': stats.get('words'), 'beats': stats.get('beats'),
            'seconds': round(last['duration']) if last.get('duration') else None, 'moving': last.get('movingParts'),
            'highlights': last.get('highlights'), 'audit': len(last.get('audit') or []), 'left': len(last.get('problems') or []),
            'minutes': round(sum(x.get('seconds', 0) for x in rounds) / 60, 1),
            'tokens': sum((x.get('usage') or {}).get('completion_tokens', 0) for x in rounds)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('runs', nargs='+')
    ap.add_argument('--targets', default='percent,transitions,mainidea,science-design')
    args = ap.parse_args()
    domains = {l['id']: l['domain'] for l in json.loads(CATALOG.read_text())['lessons']}
    cols = ['passed', 'rounds', 'words', 'beats', 'seconds', 'moving', 'highlights', 'audit', 'left', 'minutes', 'tokens']
    for target in args.targets.split(','):
        print(f'\n== {target}')
        print('  ' + f"{'source':28}" + ''.join(f'{c:>11}' for c in cols))
        rows = [('published', published(target, domains[target]))] + [(Path(r).name, run_row(r, target)) for r in args.runs]
        for name, row in rows:
            if row is None:
                print(f'  {name:28}(not run)')
                continue
            print(f'  {name:28}' + ''.join(f"{str(row.get(c, '-')):>11}" for c in cols))


if __name__ == '__main__':
    main()
