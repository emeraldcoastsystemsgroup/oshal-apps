/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run private recent resume matching and bounded title scoring once per published corpus, with a durable owner receipt and daily cooldown.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Bound successful passes to the corpus's 18:00 Chicago refresh cycle, so midday catch-up never consumes the coming evening's publication.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A failed pass logs the engine's error type: six days of failures had said only "code 1".
 */
import fs from 'fs';
import path from 'path';
import type { AppContext } from '@/app/composition/app-context';
import { userPaths } from './career-user-store';
import { runCareerCliAsync } from './career-engine-dispatch';
import { writeFileAtomicAsync } from './career-file-transaction';
import { createChildLogger } from '@/shared/logger';

const logger = createChildLogger({ module: 'career-nightly-match' });
export const NIGHTLY_MATCH_LIMIT = 50;
export const NIGHTLY_MATCH_FILE = 'nightly-match-success.json';

/** The evening refresh cycle a published corpus belongs to, independent of when its owner catches up. */
export function nightlyPublicationCycle(millis: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(millis));
  const get = (key: string) => Number(parts.find(p => p.type === key)?.value);
  const day = Date.UTC(get('year'), get('month') - 1, get('day'));
  return new Date(day - (get('hour') < 18 ? 86400_000 : 0)).toISOString().slice(0, 10);
}

export interface NightlyMatchReceipt {
  version: 1;
  corpusVersion: string;
  completedAt: string;
  keywordMatched: number;
  scored: number;
  skipped: number;
  limit: number;
}

/** Read only the exact caller's bounded regular receipt; corruption never starts more scoring. */
export function readNightlyMatchReceipt(userDir: string): NightlyMatchReceipt | null {
  try {
    const file = path.join(userDir, NIGHTLY_MATCH_FILE), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048) throw new Error('Nightly matching receipt is unavailable.');
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    const at = Date.parse(r?.completedAt);
    if (r?.version !== 1 || !/^\d+:\d+$/.test(r.corpusVersion) || !Number.isFinite(at)
      || new Date(at).toISOString() !== r.completedAt || at > Date.now() + 60_000
      || ![r.keywordMatched, r.scored, r.skipped, r.limit].every(n => Number.isSafeInteger(n) && n >= 0)
      || r.limit !== NIGHTLY_MATCH_LIMIT || r.scored + r.skipped > r.limit) throw new Error('Nightly matching receipt is unavailable.');
    return r;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** A published corpus is immutable during a native run; the ingest's private working copy is never mounted here. */
export function nightlyMatchDecision(userDir: string, corpusDb: string) {
  const stat = fs.lstatSync(corpusDb);
  if (!stat.isFile() || stat.isSymbolicLink() || !Number.isFinite(stat.mtimeMs) || stat.size <= 0) {
    throw new Error('Published job corpus is unavailable.');
  }
  const corpusVersion = `${Math.trunc(stat.mtimeMs)}:${stat.size}`;
  const receipt = readNightlyMatchReceipt(userDir);
  const reason = receipt?.corpusVersion === corpusVersion ? 'up-to-date'
    : receipt && nightlyPublicationCycle(Number(receipt.corpusVersion.split(':')[0])) === nightlyPublicationCycle(stat.mtimeMs)
      ? 'daily-cooldown' : null;
  return { corpusVersion, receipt, reason };
}

/** Accept only the count-only terminal verdict after BOTH keyword matching and AI scoring succeed. */
export function nightlyMatchVerdict(stdout?: string) {
  for (const line of (stdout || '').split(/\r?\n/).reverse()) {
    if (!line.startsWith('{')) continue;
    try {
      const r = JSON.parse(line);
      if (r?.result === 'complete' && [r.keywordMatched, r.scored, r.skipped, r.terms].every(n => Number.isSafeInteger(n) && n >= 0)
        && r.terms > 0 && r.scored + r.skipped <= NIGHTLY_MATCH_LIMIT) {
        return { keywordMatched: r.keywordMatched, scored: r.scored, skipped: r.skipped };
      }
    } catch { /* engine progress is not a completion receipt */ }
  }
  return null;
}

/** The error type from the engine's count-only failure line; it carries no job or person data. */
export function nightlyMatchFailure(stdout?: string): string | undefined {
  for (const line of (stdout || '').split(/\r?\n/).reverse()) {
    if (!line.startsWith('{')) continue;
    try {
      const r = JSON.parse(line);
      if (r?.result === 'failed' && typeof r.errorType === 'string') return r.errorType.slice(0, 80);
    } catch { /* engine progress is not a failure line */ }
  }
  return undefined;
}

/** Start under the authenticated owner's schedule admission, shared score lease, and kept bot run. */
export async function startNightlyMatching(
  pool: AppContext['pool'], userSub: string,
  profile: { titleTerms: string[]; remoteOnly: boolean }, onSuccess: () => Promise<void>,
): Promise<{ started: boolean; reason?: string; runId?: string }> {
  if (process.env.OSHAL_EGRESS !== 'kernel' || process.env.OSHAL_CAREER_OWNER_MOUNT !== '1') {
    return { started: false, reason: 'native-scheduler-required' };
  }
  const { userDir, corpusDb } = userPaths(userSub);
  const decision = nightlyMatchDecision(userDir, corpusDb);
  if (decision.reason) return { started: false, reason: decision.reason };
  if (!profile.titleTerms.length) return { started: false, reason: 'no-title-profile' };
  let runId: string | undefined;
  const result = await runCareerCliAsync(pool, userSub, ['score-titles'], {
    CH_TITLES: profile.titleTerms.join('\n'), CH_LIMIT: String(NIGHTLY_MATCH_LIMIT), CH_FRESH_DAYS: '7',
    CH_REMOTE_ONLY: profile.remoteOnly ? '1' : '0', CH_NIGHTLY_MATCH: '1',
  }, {
    slot: 'score', captureStdout: true, timeoutMs: 30 * 60_000,
    onRunStarted: id => { runId = id; },
    onComplete: async completion => {
      const verdict = completion.ok ? nightlyMatchVerdict(completion.stdout) : null;
      if (!verdict) {
        logger.warn({ userSub, runId, code: completion.code, timedOut: completion.timedOut,
          errorType: nightlyMatchFailure(completion.stdout) }, 'nightly matching failed; receipt not advanced');
        return;
      }
      const receipt: NightlyMatchReceipt = { version: 1, corpusVersion: decision.corpusVersion,
        completedAt: new Date().toISOString(), limit: NIGHTLY_MATCH_LIMIT, ...verdict };
      // Both cursors and private scores publish together. A failed completion or owner
      // publication cannot consume the next nightly attempt.
      await onSuccess();
      const file = path.join(userDir, NIGHTLY_MATCH_FILE);
      await writeFileAtomicAsync(file, JSON.stringify(receipt) + '\n');
      await fs.promises.chmod(file, 0o600);
      logger.info({ userSub, runId, ...verdict, limit: NIGHTLY_MATCH_LIMIT }, 'nightly matching completed');
    },
  });
  if (result.limitReason) return { started: false, reason: result.limitReason === 'inflight' ? 'score-in-flight' : 'busy' };
  if (!result.started) return { started: false, reason: 'engine-failed' };
  return { started: true, ...(runId ? { runId } : {}) };
}
