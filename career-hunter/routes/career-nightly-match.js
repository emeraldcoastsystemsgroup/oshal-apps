"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PULL_BOUNDARY = exports.NIGHTLY_MATCH_CONTRACT = exports.NIGHTLY_MATCH_FILE = exports.NIGHTLY_MATCH_LIMIT = void 0;
exports.nightlyPullBoundary = nightlyPullBoundary;
exports.nightlyPublicationCycle = nightlyPublicationCycle;
exports.readNightlyMatchReceipt = readNightlyMatchReceipt;
exports.nightlyMatchDecision = nightlyMatchDecision;
exports.nightlyMatchVerdict = nightlyMatchVerdict;
exports.nightlyMatchFailure = nightlyMatchFailure;
exports.startNightlyMatching = startNightlyMatching;
/**
 * CHANGE LOG
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Upgrade nightly receipts to the new-entry-only matching contract.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run private recent resume matching and bounded title scoring once per published corpus, with a durable owner receipt and daily cooldown.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Bound successful passes to the corpus's 18:00 Chicago refresh cycle, so midday catch-up never consumes the coming evening's publication.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A failed pass logs the engine's error type: six days of failures had said only "code 1".
 * 4 | maintainer@emeraldcoastsystemsgroup.com | A receipt names the match that wrote it, so a match that reaches more jobs runs once without waiting for the next publication.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Settled nightly scoring (career-nightly-settled.ts), only when the installation sets CAREER_NIGHTLY_SETTLE=1: the run carries its settings to the engine, its version-2 receipt says what was scored, left undecided, unreadable, failed and not reached, and a night stopped by its run's time is continued by the next half-hourly check while the night's time and limit remain. Without the setting the pass, its command inputs and its receipt are exactly 1.63.0's; a version-2 receipt left from a night with the setting on is read as a finished night.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | 1.62.2: the cycle starts at the installation's own pull time, from the per-package setting CAREER_INGEST_CRON (plain daily "minute hour * * *", Chicago), else 18:00. A pull moved to 01:00 published at 06:01 and the half-hourly check called it the previous evening's cycle, so 3,446 new jobs waited a day unmatched.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const career_user_store_1 = require("./career-user-store");
const career_engine_dispatch_1 = require("./career-engine-dispatch");
const career_file_transaction_1 = require("./career-file-transaction");
const logger_1 = require("@/shared/logger");
const career_nightly_settled_1 = require("./career-nightly-settled");
const logger = (0, logger_1.createChildLogger)({ module: 'career-nightly-match' });
exports.NIGHTLY_MATCH_LIMIT = 50;
exports.NIGHTLY_MATCH_FILE = 'nightly-match-success.json';
/** Raise this when people should not wait for the next publication: a receipt from an older match runs once more. */
exports.NIGHTLY_MATCH_CONTRACT = 3;
/** The Chicago time of day a pull cycle starts when the installation names no pull time. */
exports.DEFAULT_PULL_BOUNDARY = Object.freeze({ hour: 18, minute: 0 });
/**
 * @description The Chicago time of day the installation's shared pull starts, which is where one pull cycle ends and the
 * next begins. The kernel clears the package's environment, so the pull's own OSHAL_CAREER_INGEST_CRON never reaches
 * here; the operator passes the same cadence as the per-package setting CAREER_INGEST_CRON. Only a plain daily
 * "minute hour * * *" schedule is understood: anything else, or none, keeps 18:00, the cadence these cycles began with.
 * @param schedule - The pull's cron expression, read in America/Chicago.
 * @returns The boundary's hour (0-23) and minute (0-59).
 */
function nightlyPullBoundary(schedule = process.env.CAREER_INGEST_CRON) {
    const daily = /^\s*(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*\s*$/.exec(schedule || '');
    const minute = Number(daily?.[1]), hour = Number(daily?.[2]);
    return daily && minute <= 59 && hour <= 23 ? { hour, minute } : { ...exports.DEFAULT_PULL_BOUNDARY };
}
/** The pull cycle a published corpus belongs to, independent of when its owner catches up. */
function nightlyPublicationCycle(millis, boundary = nightlyPullBoundary()) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(millis));
    const get = (key) => Number(parts.find(p => p.type === key)?.value);
    const day = Date.UTC(get('year'), get('month') - 1, get('day'));
    const before = get('hour') * 60 + get('minute') < boundary.hour * 60 + boundary.minute;
    return new Date(day - (before ? 86400000 : 0)).toISOString().slice(0, 10);
}
/** Read only the exact caller's bounded regular receipt; corruption never starts more scoring. */
function readNightlyMatchReceipt(userDir) {
    try {
        const file = path_1.default.join(userDir, exports.NIGHTLY_MATCH_FILE), stat = fs_1.default.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048)
            throw new Error('Nightly matching receipt is unavailable.');
        const r = JSON.parse(fs_1.default.readFileSync(file, 'utf8'));
        const at = Date.parse(r?.completedAt);
        if (!/^\d+:\d+$/.test(r?.corpusVersion) || !Number.isFinite(at)
            || new Date(at).toISOString() !== r.completedAt || at > Date.now() + 60000)
            throw new Error('Nightly matching receipt is unavailable.');
        if (r.version === 2 && (0, career_nightly_settled_1.validSettledReceipt)(r))
            return r;
        if (r.version !== 1
            || ![r.keywordMatched, r.scored, r.skipped, r.limit].every(n => Number.isSafeInteger(n) && n >= 0)
            || r.limit !== exports.NIGHTLY_MATCH_LIMIT || r.scored + r.skipped > r.limit)
            throw new Error('Nightly matching receipt is unavailable.');
        return r;
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    }
}
/**
 * A published corpus is immutable during a native run; the ingest's private working copy is never mounted here.
 * With settled scoring on, a night its last run left unfinished (`continues`) in this same cycle is continued.
 */
function nightlyMatchDecision(userDir, corpusDb, settled = null) {
    const stat = fs_1.default.lstatSync(corpusDb);
    if (!stat.isFile() || stat.isSymbolicLink() || !Number.isFinite(stat.mtimeMs) || stat.size <= 0) {
        throw new Error('Published job corpus is unavailable.');
    }
    const corpusVersion = `${Math.trunc(stat.mtimeMs)}:${stat.size}`;
    const receipt = readNightlyMatchReceipt(userDir), boundary = nightlyPullBoundary();
    const sameCycle = receipt
        ? nightlyPublicationCycle(Number(receipt.corpusVersion.split(':')[0]), boundary) === nightlyPublicationCycle(stat.mtimeMs, boundary)
        : false;
    const reason = receipt?.matchContract !== exports.NIGHTLY_MATCH_CONTRACT ? null
        : receipt.corpusVersion === corpusVersion ? 'up-to-date'
            : sameCycle ? 'daily-cooldown' : null;
    if (settled && reason && receipt?.version === 2 && receipt.continues && sameCycle) {
        const continuation = { prior: receipt };
        return { corpusVersion, receipt, reason: null, continuation };
    }
    return { corpusVersion, receipt, reason };
}
/** Accept only the count-only terminal verdict after BOTH keyword matching and AI scoring succeed. */
function nightlyMatchVerdict(stdout) {
    for (const line of (stdout || '').split(/\r?\n/).reverse()) {
        if (!line.startsWith('{'))
            continue;
        try {
            const r = JSON.parse(line);
            if (r?.result === 'complete' && [r.keywordMatched, r.scored, r.skipped, r.terms].every(n => Number.isSafeInteger(n) && n >= 0)
                && r.terms > 0 && r.scored + r.skipped <= exports.NIGHTLY_MATCH_LIMIT) {
                return { keywordMatched: r.keywordMatched, scored: r.scored, skipped: r.skipped };
            }
        }
        catch { /* engine progress is not a completion receipt */ }
    }
    return null;
}
/** The error type from the engine's count-only failure line; it carries no job or person data. */
function nightlyMatchFailure(stdout) {
    for (const line of (stdout || '').split(/\r?\n/).reverse()) {
        if (!line.startsWith('{'))
            continue;
        try {
            const r = JSON.parse(line);
            if (r?.result === 'failed' && typeof r.errorType === 'string')
                return r.errorType.slice(0, 80);
        }
        catch { /* engine progress is not a failure line */ }
    }
    return undefined;
}
/** The receipt a completed run writes: 1.63.0's while settled scoring is off, else the night's version 2. */
function nightlyReceipt(stdout, decision, settled, inputs) {
    const base = { matchContract: exports.NIGHTLY_MATCH_CONTRACT, corpusVersion: decision.corpusVersion, completedAt: new Date().toISOString() };
    if (!settled) {
        const verdict = nightlyMatchVerdict(stdout);
        return verdict ? { version: 1, ...base, limit: exports.NIGHTLY_MATCH_LIMIT, ...verdict } : null;
    }
    const verdict = (0, career_nightly_settled_1.settledVerdict)(stdout, Number(inputs.CH_LIMIT));
    return verdict ? (0, career_nightly_settled_1.settledReceipt)(base, settled, verdict, decision.continuation) : null;
}
/** Start under the authenticated owner's schedule admission, shared score lease, and kept bot run. */
async function startNightlyMatching(pool, userSub, profile, onSuccess) {
    if (process.env.OSHAL_EGRESS !== 'kernel' || process.env.OSHAL_CAREER_OWNER_MOUNT !== '1') {
        return { started: false, reason: 'native-scheduler-required' };
    }
    const { userDir, corpusDb } = (0, career_user_store_1.userPaths)(userSub);
    const settled = (0, career_nightly_settled_1.nightlySettledSettings)();
    const decision = nightlyMatchDecision(userDir, corpusDb, settled);
    if (decision.reason)
        return { started: false, reason: decision.reason };
    if (!profile.titleTerms.length)
        return { started: false, reason: 'no-title-profile' };
    let runId;
    const inputs = settled ? (0, career_nightly_settled_1.settledRunInputs)(settled, decision.continuation) : {};
    const result = await (0, career_engine_dispatch_1.runCareerCliAsync)(pool, userSub, ['score-titles'], {
        CH_TITLES: profile.titleTerms.join('\n'), CH_LIMIT: String(exports.NIGHTLY_MATCH_LIMIT), CH_FRESH_DAYS: '7',
        CH_REMOTE_ONLY: profile.remoteOnly ? '1' : '0', CH_NIGHTLY_MATCH: '1', ...inputs,
    }, {
        slot: 'score', captureStdout: true, timeoutMs: 30 * 60000,
        onRunStarted: id => { runId = id; },
        onComplete: async (completion) => {
            const receipt = completion.ok ? nightlyReceipt(completion.stdout, decision, settled, inputs) : null;
            if (!receipt) {
                logger.warn({ userSub, runId, code: completion.code, timedOut: completion.timedOut,
                    errorType: nightlyMatchFailure(completion.stdout) }, 'nightly matching failed; receipt not advanced');
                return;
            }
            // Both cursors and private scores publish together. A failed completion or owner
            // publication cannot consume the next nightly attempt.
            await onSuccess();
            const file = path_1.default.join(userDir, exports.NIGHTLY_MATCH_FILE);
            await (0, career_file_transaction_1.writeFileAtomicAsync)(file, JSON.stringify(receipt) + '\n');
            await fs_1.default.promises.chmod(file, 0o600);
            if (receipt.version === 1) {
                const { keywordMatched, scored, skipped } = receipt;
                logger.info({ userSub, runId, keywordMatched, scored, skipped, limit: exports.NIGHTLY_MATCH_LIMIT }, 'nightly matching completed');
            }
            else {
                const { version, matchContract, corpusVersion, completedAt, ...counted } = receipt;
                logger.info({ userSub, runId, mode: 'settled', ...counted }, 'nightly matching completed');
            }
        },
    });
    if (result.limitReason)
        return { started: false, reason: result.limitReason === 'inflight' ? 'score-in-flight' : 'busy' };
    if (!result.started)
        return { started: false, reason: 'engine-failed' };
    return { started: true, ...(runId ? { runId } : {}) };
}
//# sourceMappingURL=career-nightly-match.js.map