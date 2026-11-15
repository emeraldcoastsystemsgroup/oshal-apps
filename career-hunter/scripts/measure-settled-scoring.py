#!/usr/bin/env python3
# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 1 | maintainer@emeraldcoastsystemsgroup.com | Measure Career's settled nightly scoring against Sonnet's own three-run shortlist on 50 made-up postings, under the rule docs/settled-scoring-measurement.md fixed before any model was asked: the settling rule is the shipped engine's own (jobhunter.settle.settle), the prompt and the account relay's call are the kernel's own scripts (ops/audit/career_scoring_agreement.py, ops/token_chase_career.py), Token Chase's stored Sonnet runs are reused under its three checks, Sonnet is asked one call at a time only when the relay is idle and never past 120 calls, the local model at most three calls at once.
# 2 | maintainer@emeraldcoastsystemsgroup.com | A local answer with no text (the production-shaped timing run met one at 16,800 prompt tokens and the script stopped on it) is read as the kernel reads it, as empty text, so Career's retry follows; each call records whether it came back empty.
"""Settled nightly scoring against Sonnet's settled shortlist (docs/settled-scoring-measurement.md).

Usage:
  python3 -B career-hunter/scripts/measure-settled-scoring.py --out <folder> [--kernel <oshal-kernel>] [--phase all|local|sonnet|speed|judge]

Writes <folder>/arms.json (each call's score, seconds, tokens and input digest; never a real person's data) and
<folder>/result.json, and prints the result. A call that raises stops the measurement; what was measured is kept.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
import pathlib
import statistics
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
PACKAGE = HERE.parent
TC2_ARMS = pathlib.Path.home() / 'Documents/projects/oshal-handover/lanes/lane-tc2/career-case-20261114/arms.json'
TC2_SHA256 = 'ac85fd803c98289b342c72967d2dc1bd8014393f9241ad1686514021b74c1fb3'
SONNET_CEILING = 120
LOCAL_AT_ONCE = 3
LINE = 70


def load_kernel(kernel):
    """The kernel's own prompt builder, postings and account relay call (read, never changed)."""
    sys.path.insert(0, str(kernel / 'ops' / 'audit'))
    sys.path.insert(0, str(kernel / 'ops'))
    import career_scoring_agreement as career  # noqa: E402
    import token_chase_career as chase  # noqa: E402
    from codex_account_protocol import conversation_json  # noqa: E402
    return career, chase, conversation_json


def load_rule():
    """The shipped engine's settling rule, imported with its data folder pointed away from any real store."""
    os.environ['JOBHUNTER_DATA'] = os.environ.get('CR9_SCRATCH_DATA', '/tmp/cr9-measure-data')
    sys.path.insert(0, str(PACKAGE / 'engine'))
    from jobhunter import settle  # noqa: E402
    return settle


def postings(career):
    new = json.loads((HERE / 'measure-settled-scoring-postings.json').read_text())['postings']
    return [tuple(job) for job in career.JOBS] + [tuple(job) for job in new]


def parts_for(career, kernel, long=False):
    parts = career.constants(PACKAGE / 'engine/jobhunter/score.py')
    parts['persona'] = career.perspective(PACKAGE / 'personas/career-hunter.yaml')
    parts['contract'] = career.contract(kernel / 'crates/inference/src/assembly.rs')
    parts['long'] = long
    return parts


def reused_sonnet(career, conversation_json, parts):
    """Token Chase's three Sonnet runs on the 24 kernel postings, under the rule's three checks, or stop."""
    raw = TC2_ARMS.read_bytes()
    if hashlib.sha256(raw).hexdigest() != TC2_SHA256:
        raise SystemExit('the stored Sonnet runs are not the file the rule names; nothing was asked')
    stored = json.loads(raw)
    if not stored['measuredFrom'].startswith(time.strftime('%Y-%m-%d', time.gmtime())):
        raise SystemExit('the stored Sonnet runs were not measured today; nothing was asked')
    runs = [stored['arms']['incumbent']] + stored['arms']['replays']
    for at, job in enumerate(career.JOBS):
        digest = hashlib.sha256(conversation_json(career.messages(parts, job, False)).encode()).hexdigest()
        if any(run[at]['calls'][0]['stdin'] != digest for run in runs):
            raise SystemExit(f'posting {at} was asked of the stored Sonnet runs with other input; nothing was asked')
    return [[{'fit': run[at]['fit'], 'seconds': run[at]['seconds'], 'calls': run[at]['calls'], 'reused': True}
             for run in runs] for at in range(len(career.JOBS))]


def three_local(chase, ask, parts, job):
    """One job as the shipped pass asks it: three runs one after another, each Career's call and its one retry."""
    return [chase.score(ask, parts, job) for _ in range(3)]


def local_answer(chase, args, msgs, limit):
    """One local call; an answer with no text (all of it spent thinking) is read as the kernel reads it, as empty
    text (crates/inference/src/generic.rs, `content` .as_str().unwrap_or("")), so Career's retry follows."""
    text, used = chase.ask_local(args.local_base, args.local_model, msgs, limit)
    used['emptyText'] = text is None
    return text or '', used


def local_phase(args, career, chase, parts, jobs):
    ask = lambda msgs, limit: local_answer(chase, args, msgs, limit)  # noqa: E731
    began = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=LOCAL_AT_ONCE) as pool:
        runs = list(pool.map(lambda job: three_local(chase, ask, parts, job), jobs))
    return {'runs': runs, 'wallSeconds': round(time.time() - began, 1), 'atOnce': LOCAL_AT_ONCE}


def sonnet_phase(chase, parts, jobs, first, made):
    """Three runs on each new posting, run after run, one call at a time; never past the ceiling."""
    import shutil
    executable = shutil.which('claude')
    if not executable:
        raise SystemExit('the claude CLI is not on PATH')
    counted = {'made': made}

    def ask(msgs, limit):
        if counted['made'] >= SONNET_CEILING:
            raise RuntimeError(f'the next Sonnet call would pass the ceiling of {SONNET_CEILING}')
        counted['made'] += 1
        return chase.ask_sonnet(executable, msgs, limit)
    runs = [[] for _ in jobs[first:]]
    for _ in range(3):
        for at, job in enumerate(jobs[first:]):
            runs[at].append(chase.score(ask, parts, job))
    return runs, counted['made']


def padded_profile(career):
    """Made-up surroundings that bring a call to about production's length (MODEL1: about 16,500 prompt tokens)."""
    extra = ('\nProject record (made up for this measurement): led a pipeline migration with careful backfills, '
             'documented every table, reviewed designs with analysts, kept on-call notes, wrote runbooks and tests, '
             'and measured cost and freshness each week. ') * 245
    return career.PROFILE + extra


def speed_phase(args, career, chase, kernel, jobs):
    """Time only, not judged: the 24 kernel postings, three runs each, three at once, at production length."""
    original = career.PROFILE
    career.PROFILE = padded_profile(career)
    try:
        parts = parts_for(career, kernel, long=True)
        measured = local_phase(args, career, chase, parts, jobs[:24])
    finally:
        career.PROFILE = original
    tokens = [call['input'] for runs in measured['runs'] for run in runs for call in run['calls']]
    measured['promptTokensMean'] = round(statistics.fmean(tokens)) if tokens else None
    return measured


def sonnet_settled(fits):
    """A posting is on Sonnet's shortlist when a strict majority of its runs is at or above the line."""
    sides = ['none' if fit is None else 'above' if fit >= LINE else 'below' for fit in fits]
    for side in ('above', 'below', 'none'):
        if sides.count(side) * 2 > len(sides):
            return side
    return 'tie'


def identical_inputs(arms, jobs):
    """Every posting's three runs on a model were asked on one input (the first call's digest), or stop."""
    for name, runs in (('local', arms['local']['runs']), ('sonnet', arms['sonnet'])):
        for at in range(len(jobs)):
            if len({run['calls'][0]['stdin'] for run in runs[at]}) != 1:
                raise SystemExit(f'posting {at} was asked of {name} on different inputs; nothing is judged')


def judge(arms, jobs, settle):
    identical_inputs(arms, jobs)
    rows, shortlist = [], {'sonnet': set(), 'withStronger': set(), 'withoutStronger': set()}
    for at, job in enumerate(jobs):
        sonnet = [run['fit'] for run in arms['sonnet'][at]]
        local = [run['fit'] for run in arms['local']['runs'][at]]
        reference = sonnet_settled(sonnet)
        if reference == 'tie':
            raise SystemExit(f'posting {at} has no strict Sonnet majority ({sonnet}); no verdict, as the rule says')
        verdict = settle.settle(local)
        stronger = sonnet[0] if verdict['outcome'] == 'close' else None
        on = {'sonnet': reference == 'above',
              'withoutStronger': verdict['outcome'] == 'settled' and verdict['above'],
              'withStronger': (verdict['outcome'] == 'settled' and verdict['above'])
              or (stronger is not None and stronger >= LINE)}
        for name, chosen in on.items():
            if chosen:
                shortlist[name].add(at)
        rows.append({'at': at, 'tier': job[0], 'title': job[2], 'company': job[1], 'sonnet': sonnet, 'local': local,
                     'settled': verdict, 'strongerAnswer': stronger, 'shortlisted': on})
    return rows, shortlist


def report(arms, jobs, settle):
    rows, shortlist = judge(arms, jobs, settle)
    differs = lambda name: sorted(shortlist[name] ^ shortlist['sonnet'])  # noqa: E731
    local_calls = sum(len(run['calls']) for runs in arms['local']['runs'] for run in runs)
    close = [row for row in rows if row['settled']['outcome'] == 'close']
    seconds = [run['seconds'] for runs in arms['local']['runs'] for run in runs]
    result = {
        'shortlists': {name: sorted(found) for name, found in shortlist.items()},
        'agreesWithStronger': not differs('withStronger'), 'agreesWithoutStronger': not differs('withoutStronger'),
        'differWithStronger': [rows[at] for at in differs('withStronger')],
        'differWithoutStronger': [rows[at] for at in differs('withoutStronger')],
        'closeCalls': [{'at': row['at'], 'title': row['title'], 'local': row['local'], 'why': row['settled']['why'],
                        'strongerAnswer': row['strongerAnswer']} for row in close],
        'calls': {'local': local_calls, 'sonnetMade': arms.get('sonnetMade', 0),
                  'sonnetReused': sum(len(run['calls']) for runs in arms['sonnet'][:24] for run in runs),
                  'strongerWouldMake': len(close)},
        'seconds': {'localCallMean': round(statistics.fmean(seconds), 1),
                    'localWall': arms['local']['wallSeconds'], 'atOnce': arms['local']['atOnce'],
                    'perJob': round(arms['local']['wallSeconds'] / len(jobs), 2)},
        'rows': rows,
    }
    if 'speed' in arms:
        speed = arms['speed']
        result['productionShaped'] = {'promptTokensMean': speed['promptTokensMean'], 'wallSeconds': speed['wallSeconds'],
                                      'jobs': len(speed['runs']), 'perJob': round(speed['wallSeconds'] / len(speed['runs']), 2),
                                      'callMean': round(statistics.fmean(run['seconds'] for runs in speed['runs'] for run in runs), 1)}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--out', required=True)
    parser.add_argument('--kernel', default=str(pathlib.Path.home() / 'Documents/projects/oshal-kernel'))
    parser.add_argument('--local-base', default='http://127.0.0.1:8000/v1')
    parser.add_argument('--local-model', default='bot-fast')
    parser.add_argument('--phase', choices=('all', 'local', 'sonnet', 'speed', 'judge'), default='all')
    args = parser.parse_args()
    kernel, out = pathlib.Path(args.kernel), pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    career, chase, conversation_json = load_kernel(kernel)
    settle = load_rule()
    jobs, parts = postings(career), parts_for(career, kernel)
    file = out / 'arms.json'
    arms = json.loads(file.read_text()) if file.exists() else {'measuredFrom': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    keep = lambda: file.write_text(json.dumps(arms, indent=1))  # noqa: E731 - each finished phase is kept
    try:
        if args.phase in ('all', 'local') and 'local' not in arms:
            arms['local'] = local_phase(args, career, chase, parts, jobs)
            keep()
        if args.phase in ('all', 'sonnet') and 'sonnet' not in arms:
            reused = reused_sonnet(career, conversation_json, parts)
            new, made = sonnet_phase(chase, parts, jobs, len(reused), arms.get('sonnetMade', 0))
            arms['sonnet'], arms['sonnetMade'] = reused + new, made
            keep()
        if args.phase in ('all', 'speed') and 'speed' not in arms:
            arms['speed'] = speed_phase(args, career, chase, kernel, jobs)
            keep()
    except Exception as stopped:  # noqa: BLE001 - kept with what was measured; nothing is judged
        arms['stopped'] = f'{type(stopped).__name__}: {str(stopped)[:200]}'
        (out / 'arms-partial.json').write_text(json.dumps(arms, indent=1))
        raise SystemExit(f'the measurement stopped and nothing is judged: {arms["stopped"]}') from stopped
    arms['measuredTo'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    file.write_text(json.dumps(arms, indent=1))
    if 'local' in arms and 'sonnet' in arms:
        result = report(arms, jobs, settle)
        (out / 'result.json').write_text(json.dumps(result, indent=1))
        print(json.dumps({key: value for key, value in result.items() if key != 'rows'}, indent=1))


if __name__ == '__main__':
    main()
