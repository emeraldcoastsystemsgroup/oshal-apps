#!/usr/bin/env python3
"""Record and film a set of lessons, a few at a time, and report what happened to each.

CHANGE LOG
-----------------------------------------------------------------------------
SEQ | AUTHOR                                  | DESCRIPTION
-----------------------------------------------------------------------------
1   | maintainer@emeraldcoastsystemsgroup.com | Runs narrate.py and render.mjs over many lessons: one take at a time per speech model, because each has a small daily quota and a per-minute limit, and a handful of renders at once at low priority

Usage: produce.py [--record] [--render] [--jobs N] [lesson ...]   (all lessons when none are named)
A take already recorded for the current words is reused, so this is safe to run again.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = os.environ.get('LESSON_PYTHON', sys.executable)


def lesson_ids():
    return json.loads(subprocess.check_output(['node', str(HERE / 'lessons-json.cjs'), '--ids'], text=True))


def describe(lesson):
    return json.loads(subprocess.check_output(['node', str(HERE / 'lessons-json.cjs'), lesson], text=True))


def run(command, label):
    """Run one step and return its exit code with the last lines of its output."""
    started = time.time()
    done = subprocess.run(command, cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    lines = [line for line in done.stdout.splitlines() if 'warn' not in line.lower()]
    print(f'{label}: exit {done.returncode} in {time.time() - started:.0f}s', flush=True)
    for line in lines[-4:]:
        print(f'  {line[:300]}', flush=True)
    return done.returncode


def record_group(lessons, spacing):
    """Takes that share a speech model, one after another."""
    failed = []
    for i, lesson in enumerate(lessons):
        if i:
            time.sleep(spacing)
        if run([PY, 'narrate.py', lesson], f'record {lesson}'):
            failed.append(lesson)
    return failed


def record_all(lessons, spacing):
    groups = {}
    for lesson in lessons:
        groups.setdefault(describe(lesson)['teacher']['model'], []).append(lesson)
    print({model: len(items) for model, items in groups.items()}, flush=True)
    with ThreadPoolExecutor(max_workers=len(groups)) as pool:
        results = list(pool.map(lambda items: record_group(items, spacing), groups.values()))
    return [lesson for failed in results for lesson in failed]


def render_all(lessons, jobs):
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        codes = list(pool.map(lambda lesson: run(['nice', '-n', '6', 'node', 'render.mjs', lesson], f'render {lesson}'), lessons))
    return [lesson for lesson, code in zip(lessons, codes) if code]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('lessons', nargs='*')
    ap.add_argument('--record', action='store_true')
    ap.add_argument('--render', action='store_true')
    ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('--spacing', type=float, default=12, help='seconds between takes on one model')
    args = ap.parse_args()
    lessons = args.lessons or lesson_ids()
    failed = []
    if args.record:
        failed += record_all(lessons, args.spacing)
    if args.render:
        failed += render_all([lesson for lesson in lessons if lesson not in failed], args.jobs)
    print('FAILED: ' + ' '.join(failed) if failed else 'all done', flush=True)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
