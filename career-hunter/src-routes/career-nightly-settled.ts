/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Settled nightly scoring, off unless the installation sets CAREER_NIGHTLY_SETTLE=1: its package settings with safe defaults (limit, three calls at once at most, the band, the night's time), the engine's count line, the version-2 receipt with what was scored, left undecided, unreadable, failed and not reached, and the night split into kept runs of at most 20 minutes on consecutive half-hourly checks, because the kernel keeps a run alive for 1800 seconds at most.
 */
/**
 * Settled nightly scoring: the package settings, the engine's count line and the night's receipt.
 *
 * The engine (engine/jobhunter/settle.py) asks each job three times on the batch model order and settles it on the
 * side of Career's 70 line; a close call is left undecided. A kept run lives at most 1800 s on the native kernel
 * (crates/oshald/src/package_runs.rs MAX_SECONDS) and its writes are published only when it ends well, so a night longer
 * than one run is several runs: each at most NIGHTLY_RUN_SECONDS, the next started by the next half-hourly check while
 * the night's time and limit remain.
 *
 * @module career-nightly-settled
 */

/** One kept run's own time: 20 minutes, its last job's runs, the grace (180 s) and one call still fit in 1800 s. */
export const NIGHTLY_RUN_SECONDS = 1200;
/** A night with less than this left does not start another run. */
export const NIGHTLY_MIN_RUN_SECONDS = 120;

/** The settings' defaults: the limit comes from the measured seconds a job (docs/settled-scoring-measurement.md). */
export const NIGHTLY_SETTLED_DEFAULTS = Object.freeze({ limit: 400, concurrency: 3, band: 6, budgetMinutes: 60 });
const BOUNDS = Object.freeze({ limit: [1, 2000], concurrency: [1, 3], band: [0, 15], budgetMinutes: [5, 240] });

export interface NightlySettledSettings { limit: number; concurrency: number; band: number; budgetSeconds: number }

/** The counts one run's engine line reports. */
export interface SettledVerdict {
  keywordMatched: number; scored: number; undecided: number; unreadable: number; failed: number;
  notReached: number; calls: number; seconds: number; stoppedForTime: boolean;
}

/** The night's receipt: totals over its runs, and whether the next check continues it. */
export interface SettledReceipt {
  version: 2; matchContract: number; mode: 'settled'; corpusVersion: string; completedAt: string;
  limit: number; budgetSeconds: number; usedSeconds: number; runs: number; keywordMatched: number;
  scored: number; undecided: number; unreadable: number; failed: number; notReached: number; calls: number;
  continues: boolean;
}

/** What the next run of a continued night may still take. */
export interface SettledContinuation { prior: SettledReceipt }

const COUNTS = ['keywordMatched', 'scored', 'undecided', 'unreadable', 'failed', 'notReached', 'calls'] as const;

function clamped(env: NodeJS.ProcessEnv, name: string, fallback: number, [low, high]: readonly number[]): number {
  const text = String(env[name] ?? '').trim();
  if (!/^\d+$/.test(text)) return fallback;
  return Math.min(high, Math.max(low, Number(text)));
}

/**
 * @description The installation's settled-scoring settings, or null while it is off (the 1.63.0 nightly pass: one
 * call a job on the package's own order, 50 jobs). Per-package settings reach the route as plain environment names.
 * @param env - The package's environment.
 * @returns The settings, each clamped to its bounds, or null.
 */
export function nightlySettledSettings(env: NodeJS.ProcessEnv = process.env): NightlySettledSettings | null {
  if (String(env.CAREER_NIGHTLY_SETTLE ?? '').trim() !== '1') return null;
  const d = NIGHTLY_SETTLED_DEFAULTS;
  return {
    limit: clamped(env, 'CAREER_NIGHTLY_LIMIT', d.limit, BOUNDS.limit),
    concurrency: clamped(env, 'CAREER_NIGHTLY_CONCURRENCY', d.concurrency, BOUNDS.concurrency),
    band: clamped(env, 'CAREER_NIGHTLY_BAND', d.band, BOUNDS.band),
    budgetSeconds: clamped(env, 'CAREER_NIGHTLY_BUDGET_MINUTES', d.budgetMinutes, BOUNDS.budgetMinutes) * 60,
  };
}

/**
 * @description This run's bounds: what the night has left of its limit and time, the run capped at NIGHTLY_RUN_SECONDS.
 * @param settings - The installation's settings.
 * @param continuation - The night so far, when this run continues it.
 * @returns The engine's command inputs for this run.
 */
export function settledRunInputs(settings: NightlySettledSettings, continuation?: SettledContinuation | null): Record<string, string> {
  const prior = continuation?.prior;
  const attempted = prior ? prior.scored + prior.undecided + prior.unreadable + prior.failed : 0;
  const left = settings.budgetSeconds - (prior?.usedSeconds ?? 0);
  return {
    CH_SETTLE: '1', CH_LIMIT: String(Math.max(1, settings.limit - attempted)),
    CH_CONCURRENCY: String(settings.concurrency), CH_BAND: String(settings.band),
    CH_BUDGET_SECONDS: String(Math.max(60, Math.min(NIGHTLY_RUN_SECONDS, left))),
  };
}

function counts(value: Record<string, unknown>): boolean {
  return COUNTS.every(key => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0);
}

/**
 * @description The settled engine's count-only terminal line, or null. Attempted jobs may not exceed the run's limit.
 * @param stdout - The engine's output.
 * @param limit - The run's CH_LIMIT.
 * @returns The run's counts, or null when the run did not complete.
 */
export function settledVerdict(stdout: string | undefined, limit: number): SettledVerdict | null {
  for (const line of (stdout || '').split(/\r?\n/).reverse()) {
    if (!line.startsWith('{')) continue;
    try {
      const r = JSON.parse(line);
      if (r?.result !== 'complete' || r.mode !== 'settled' || !counts(r) || !Number.isSafeInteger(r.seconds) || r.seconds < 0
        || !Number.isSafeInteger(r.terms) || r.terms <= 0 || typeof r.stoppedForTime !== 'boolean'
        || r.scored + r.undecided + r.unreadable + r.failed > limit) continue;
      return { keywordMatched: r.keywordMatched, scored: r.scored, undecided: r.undecided, unreadable: r.unreadable,
        failed: r.failed, notReached: r.notReached, calls: r.calls, seconds: r.seconds, stoppedForTime: r.stoppedForTime };
    } catch { /* engine progress is not a completion receipt */ }
  }
  return null;
}

/**
 * @description The night's receipt after one run: this run's counts added to the night's so far (not reached is this
 * run's own), and whether the next half-hourly check continues the night.
 * @param base - The receipt's identity: contract, corpus version and completion time.
 * @param settings - The installation's settings.
 * @param verdict - This run's counts.
 * @param continuation - The night so far, when this run continued it.
 * @returns The version-2 receipt.
 */
export function settledReceipt(
  base: { matchContract: number; corpusVersion: string; completedAt: string },
  settings: NightlySettledSettings, verdict: SettledVerdict, continuation?: SettledContinuation | null,
): SettledReceipt {
  const prior = continuation?.prior;
  const sum = (key: 'keywordMatched' | 'scored' | 'undecided' | 'unreadable' | 'failed' | 'calls') => (prior?.[key] ?? 0) + verdict[key];
  const receipt: SettledReceipt = {
    version: 2, matchContract: base.matchContract, mode: 'settled', corpusVersion: base.corpusVersion,
    completedAt: base.completedAt, limit: settings.limit, budgetSeconds: settings.budgetSeconds,
    usedSeconds: (prior?.usedSeconds ?? 0) + verdict.seconds, runs: (prior?.runs ?? 0) + 1,
    keywordMatched: sum('keywordMatched'), scored: sum('scored'), undecided: sum('undecided'),
    unreadable: sum('unreadable'), failed: sum('failed'), notReached: verdict.notReached, calls: sum('calls'),
    continues: false,
  };
  const attempted = receipt.scored + receipt.undecided + receipt.unreadable + receipt.failed;
  receipt.continues = verdict.stoppedForTime && verdict.notReached > 0 && attempted < settings.limit
    && settings.budgetSeconds - receipt.usedSeconds >= NIGHTLY_MIN_RUN_SECONDS;
  return receipt;
}

/**
 * @description Whether a parsed receipt is a well-formed version-2 (settled) receipt.
 * @param r - The parsed receipt.
 * @returns True when every field is present and in bounds.
 */
export function validSettledReceipt(r: Record<string, unknown>): boolean {
  return r.version === 2 && r.mode === 'settled' && counts(r) && typeof r.continues === 'boolean'
    && [r.limit, r.budgetSeconds, r.usedSeconds, r.runs].every(n => Number.isSafeInteger(n) && (n as number) >= 0)
    && (r.runs as number) >= 1 && (r.limit as number) >= 1 && (r.limit as number) <= BOUNDS.limit[1]
    && (r.scored as number) + (r.undecided as number) + (r.unreadable as number) + (r.failed as number) <= (r.limit as number);
}
