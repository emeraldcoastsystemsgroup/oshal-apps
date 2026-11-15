# CHANGE LOG
# -----------------------------------------------------------------------------
# SEQ | AUTHOR                                    | DESCRIPTION
# -----------------------------------------------------------------------------
# 3 | maintainer@emeraldcoastsystemsgroup.com | 1.66.0 (Roger, 2026-11-15: "i want jobs flowing in.. even if we can only see their title"): a job whose details could not be read (outcome unreadable, job_details_unavailable) is marked "details needed" for the person's list (score.mark_needs_details) instead of only being counted; it still costs no model call and is counted as unreadable. A close call already left undecided keeps its runs.
# 2 | maintainer@emeraldcoastsystemsgroup.com | A job with fewer than two valid runs is not scored (it stays pending and reads Not scored yet) instead of a close call, and an answer with no text, which the kernel refuses as unavailable, is one unanswered run (Career's retry follows) instead of ending the whole pass (coordinator, 2026-11-14: a local answer with no text stopped the measurement's timing run and will happen on production some night).
# 1 | maintainer@emeraldcoastsystemsgroup.com | Settled nightly scoring (off unless the installation sets CAREER_NIGHTLY_SETTLE=1): each job is asked three times on byte-identical input, settles on the side of Career's 70 line all three runs share when their median lies outside the band (64 to 75 at the default 6 points) and keeps the median; anything else is a close call, left undecided (no score, so never on a shortlist) and asked again the next night once. The pass takes the best candidates first, at most three calls at once, and stops starting jobs when its time is up, so it ends on its own, keeps what it scored and says what it did not reach.
"""Settled nightly scoring: three runs per job on the batch model order, settled on Career's 70 line.

Measured first (Token Chase, 2026-11-14, oshal-handover lanes TC1 and TC2): the local model asked once put a job on the
shortlist that Sonnet holds back (85 against 52, 55, 52; on identical input it answered 62, 85, 45, 72 and 25), and asked
three times with this rule its shortlist equalled Sonnet's on all 24 made-up postings. docs/settled-scoring-measurement.md
holds the second measurement's rule, fixed before it ran.

THE RULE (settle):
  settled   - all three runs have a valid score, all three are on one side of LINE, and their median lies outside the
              band [LINE - band, LINE + band); the job's score is the median.
  close     - anything else with at least two valid runs: the runs disagree about the side, the median is inside the
              band, or one run gave no valid score. A failed run counts as a run on neither side: the rule was
              measured with three answers, and two answers that agree are not a majority of three.
  failed    - fewer than two runs gave a valid score: nothing is saved, the job reads "Not scored yet" and stays
              pending for the next night, as a skipped job does today. A run is failed when Career's call and its
              one retry both gave no valid score, including an answer with no text, which the kernel refuses as
              unavailable (the rail's `empty-answer` detail): that ends only the run, never the pass.

A close call belongs to a stronger model. A package cannot send one call of a nightly run to another model order today
(the kernel serves every call of a kept scheduled run as background work, crates/oshald/src/package_runs.rs line 845),
so a close call is left UNDECIDED: no score is saved, so no screen can put it above the line; its three scores are
kept in the job's model attribution (UNDECIDED_PREFIX), it is asked again the next night, and after UNDECIDED_NIGHTS
nights it waits for the person's own Check my fit, which runs on the order a person's request reads.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import statistics
import time
from dataclasses import dataclass, field

from . import config, db, enrich, score

LINE = 70  # Career's shortlist line: dashboard.py draws ai_fit_score >= 70.
RUNS = 3
DEFAULT_BAND = 6  # Token Chase's band: the largest run-to-run movement of one posting in its pilot.
# A close call is asked on this many nights at most, then waits for the person's own Check my fit.
UNDECIDED_NIGHTS = 2
# An undecided job's model attribution starts with this, then its night count: a fixed shape a dialect-neutral LIKE can
# read in the selection (score._settled_sql). Readers that only look at a scored job ignore it (lib/career-fit.js).
UNDECIDED_PREFIX = '{"undecided":'
# After the pass's time is up, a job already started may still finish its runs for this long; then it stops between
# runs, so a hanging model cannot carry the run past the kernel's 1800-second limit for a kept run.
GRACE_SECONDS = 180
BOUNDS = {'limit': (1, 2000), 'concurrency': (1, 3), 'band': (0, 15), 'budget': (60, 1500)}


def _valid(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 100


def settle(fits, band: int = DEFAULT_BAND) -> dict:
    """Settle one job's runs under the rule above.

    @param fits: The three runs' fit scores, None for a run with no valid score after Career's one retry.
    @param band: Points on either side of LINE that make a median a close call.
    @returns {'outcome': 'settled'|'close'|'failed', 'score': the median or None, 'above': bool or None,
             'why': None|'failed-run'|'sides'|'band'} - 'above' is the side all runs share, or the majority's side of a
             close call when one exists (a failed run is a side of its own).
    """
    fits = list(fits)
    valid = [fit for fit in fits if _valid(fit)]
    if len(valid) < 2:
        return {'outcome': 'failed', 'score': None, 'above': None, 'why': None}
    sides = [(fit >= LINE) if _valid(fit) else None for fit in fits]
    counts = {side: sides.count(side) for side in set(sides)}
    majority = next((side for side, count in counts.items() if count * 2 > len(fits)), None)
    median = statistics.median_low(valid)
    if len(valid) < len(fits):
        return {'outcome': 'close', 'score': None, 'above': majority, 'why': 'failed-run'}
    if len(counts) > 1:
        return {'outcome': 'close', 'score': None, 'above': majority, 'why': 'sides'}
    if LINE - band <= median < LINE + band:
        return {'outcome': 'close', 'score': None, 'above': majority, 'why': 'band'}
    return {'outcome': 'settled', 'score': median, 'above': median >= LINE, 'why': None}


@dataclass
class Night:
    """One run of the nightly pass: how much it may take and when it must stop starting jobs.

    The clock starts when the engine reads its bounds, before keyword matching, so the whole run counts.
    """
    limit: int
    concurrency: int
    band: int
    budget: int
    clock: object = time.monotonic
    started: float = field(default=0.0)

    def __post_init__(self):
        self.started = self.clock()

    @property
    def deadline(self) -> float:
        return self.started + self.budget

    def elapsed(self) -> int:
        return int(round(self.clock() - self.started))


def night_from_env(env, clock=None) -> Night:
    """The run's bounds from the controller's command inputs; anything outside them refuses the run.

    @param env: CH_LIMIT, CH_CONCURRENCY, CH_BAND and CH_BUDGET_SECONDS as the nightly route sets them.
    @param clock: A monotonic clock; time.monotonic when none is given.
    @returns The run's Night.
    """
    values = {}
    for key, name in (('limit', 'CH_LIMIT'), ('concurrency', 'CH_CONCURRENCY'), ('band', 'CH_BAND'),
                      ('budget', 'CH_BUDGET_SECONDS')):
        text = str(env.get(name, '')).strip()
        low, high = BOUNDS[key]
        if not text.isdigit() or not low <= int(text) <= high:
            raise ValueError('Invalid nightly matching bounds')
        values[key] = int(text)
    return Night(clock=clock or time.monotonic, **values)


@dataclass
class Tally:
    """What one run of the settled pass did, as the receipt reports it."""
    scored: int = 0
    undecided: int = 0
    unreadable: int = 0
    failed: int = 0
    calls: int = 0
    needs_details: int = 0
    stopped_for_time: bool = False

    def attempted(self) -> int:
        return self.scored + self.undecided + self.unreadable + self.failed


def _nights(attribution) -> int:
    """How many nights a job was already left undecided, from its saved attribution (0 when it was not)."""
    if not isinstance(attribution, str) or not attribution.startswith(UNDECIDED_PREFIX):
        return 0
    try:
        return max(0, int(json.loads(attribution)['undecided']))
    except (ValueError, KeyError, TypeError):
        return 0


def _undecided(res) -> str:
    """The attribution an undecided job keeps: the night count first (the selection reads it), then its three runs."""
    return json.dumps({'undecided': res['nights'] + 1, 'runs': res['fits'], 'why': res['verdict']['why'],
                       'at': db.now()}, ensure_ascii=False, separators=(',', ':'))


def _settled(res, band) -> tuple[dict, str | None]:
    """The run whose score is the median, and its attribution with the three runs it was settled on."""
    data, answered = next(run for run in res['runs'] if run[0] and run[0]['fit_score'] == res['verdict']['score'])
    try:
        parsed = json.loads(answered) if isinstance(answered, str) else None
    except ValueError:
        parsed = None
    if isinstance(parsed, dict):
        answered = json.dumps({**parsed, 'settled': {'runs': res['fits'], 'band': band}},
                              ensure_ascii=False, separators=(',', ':'))
    return data, answered


def _job(row, prof_summary, identity, night) -> dict:
    """One job: its details once, then three runs on byte-identical input. Never started after the time is up."""
    base = {'id': row['id'], 'outcome': 'not-reached', 'fetched': None, 'calls': 0, 'nights': _nights(row.get('ai_model')),
            'ai_model': row.get('ai_model'), 'ai_fit_score': row.get('ai_fit_score')}
    if night.clock() >= night.deadline:
        return base
    with db.connect() as conn:
        company = conn.execute(f"SELECT name, ats_type, ats_token FROM {db.companies_table()} WHERE id=?",
                               (row['company_id'],)).fetchone()
    try:
        prompt, fingerprint, fetched, _ = score._scoring_inputs(row, prof_summary, company, fetch_detail=True,
                                                               model_identity=identity)
    except ValueError as error:
        return {**base, 'outcome': 'unreadable', 'refused': str(error)}
    base.update(fetched=fetched, fingerprint=fingerprint)
    runs = []
    for at in range(RUNS):
        if at and night.clock() >= night.deadline + GRACE_SECONDS:
            return base  # stopped between runs; the details it read are still kept
        data, answered, used = score.ask(prompt, identity, empty_is_unanswered=True)
        runs.append((data, answered))
        base['calls'] += used
    fits = [data['fit_score'] if data else None for data, _ in runs]
    verdict = settle(fits, night.band)
    return {**base, 'outcome': verdict['outcome'], 'verdict': verdict, 'runs': runs, 'fits': fits}


def _commit(res, cache_key, night, tally) -> None:
    """Keep one job's result: a settled score, an undecided job's three runs, or only the facts its detail read."""
    tally.calls += res['calls']
    kept = {'id': res['id'], 'fetched': res.get('fetched'), 'context_cached': bool(res.get('fetched')), 'data': None,
            'fingerprint': res.get('fingerprint'), 'model': None}
    outcome = res['outcome']
    if outcome == 'settled':
        kept['data'], kept['model'] = _settled(res, night.band)
    if outcome != 'unreadable':
        score._commit_one(kept, cache_key)
    elif res.get('refused') == 'job_details_unavailable':
        with db.connect() as conn:
            tally.needs_details += score.mark_needs_details(conn, res)
    if outcome == 'close':
        with db.connect() as conn:
            db.user_set(conn, res['id'], ai_model=_undecided(res))
    counted = {'settled': 'scored', 'close': 'undecided', 'unreadable': 'unreadable', 'failed': 'failed'}
    if outcome in counted:
        setattr(tally, counted[outcome], getattr(tally, counted[outcome]) + 1)
    else:
        tally.stopped_for_time = True


def score_night(title_any, remote_only, night) -> dict:
    """One run of the settled nightly pass over the person's pending readable jobs, best candidates first.

    @param title_any: The person's saved titles (the same selection as the nightly pass of today).
    @param remote_only: The person's remote-only preference.
    @param night: The run's bounds and clock (night_from_env).
    @returns The run's counts for the receipt: scored, undecided, unreadable, failed, notReached and the rest.
    """
    if not enrich.provider():
        raise RuntimeError("No AI auth found. Log into Claude Code, or set ANTHROPIC_API_KEY.")
    identity = enrich.resolve_scoring_identity(config.ANTHROPIC_SCORE_MODEL)
    prof_summary, scope = score.pass_context()
    select, params, count, count_params = score.settled_sql(title_any, scope, remote_only, UNDECIDED_PREFIX,
                                                            UNDECIDED_NIGHTS)
    with db.connect() as conn:
        candidates = conn.execute(count, count_params).fetchone()[0]
        rows = [dict(row) for row in conn.execute(select + f" LIMIT {int(night.limit)}", params).fetchall()]
    tally = Tally()
    with cf.ThreadPoolExecutor(max_workers=night.concurrency) as pool:
        for done, res in enumerate(pool.map(lambda row: _job(row, prof_summary, identity, night), rows), 1):
            _commit(res, identity.cache_key, night, tally)
            if done % 25 == 0 or done == len(rows):
                print(f"   {done}/{len(rows)}  ({tally.scored} scored)", flush=True)
    return {'mode': 'settled', 'scored': tally.scored, 'undecided': tally.undecided, 'unreadable': tally.unreadable,
            'failed': tally.failed, 'notReached': max(0, candidates - tally.attempted()), 'candidates': candidates,
            'calls': tally.calls, 'seconds': night.elapsed(), 'stoppedForTime': tally.stopped_for_time,
            'limit': night.limit, 'needsDetails': tally.needs_details}
