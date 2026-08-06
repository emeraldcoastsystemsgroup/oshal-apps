"use strict";
/**
 * Venture Plan - pure scheduled rebaseline policy and cost-cap mechanics.
 *
 * Scheduling is default-deny twice: an absent policy is disabled and every
 * enabled policy starts in dry-run. A paid scheduled run exists only after its
 * owner explicitly enables it, clears dry-run, and supplies a positive integer
 * micro-USD cap. The service tick has its own dry-run override as a third gate.
 *
 * Cost settlement accepts the framework's reported USD number at one boundary,
 * rounds it once to integer micro-USD, and uses integers thereafter. Zero,
 * negative, non-finite, or sub-micro reports are UNKNOWN cost and trip the gate;
 * scheduled automation never treats failed cost capture as free.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add default-off/dry-run scheduled rebaseline policy, deterministic UTC slots, and a fail-closed integer-micro cost gate.
 *
 * @module venture-rebaseline
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduledRunBudget = exports.RebaselineError = exports.REBASELINE_BOT_CALLS = exports.REBASELINE_PHASES = exports.REBASELINE_CADENCES = void 0;
exports.defaultRebaselinePolicy = defaultRebaselinePolicy;
exports.mergeRebaselinePolicy = mergeRebaselinePolicy;
exports.evaluateRebaselinePolicy = evaluateRebaselinePolicy;
exports.reportedCostUsdToMicros = reportedCostUsdToMicros;
exports.costCappedBotCall = costCappedBotCall;
const venture_primitives_1 = require("./venture-primitives");
/** Cadences the package can evaluate without accepting caller-authored cron. */
exports.REBASELINE_CADENCES = Object.freeze(['nightly', 'weekly']);
/** The paid scheduled path deliberately omits document narration. */
exports.REBASELINE_PHASES = Object.freeze(['bom', 'market', 'ops', 'compute']);
exports.REBASELINE_BOT_CALLS = 3;
/** Stable refusal at the policy, due-slot, or cost boundary. */
class RebaselineError extends Error {
    code;
    /** Create a response-safe scheduled-rebaseline refusal. */
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'RebaselineError';
    }
}
exports.RebaselineError = RebaselineError;
/** The no-row posture. It cannot spend and it mutates nothing. */
function defaultRebaselinePolicy(ventureId) {
    return Object.freeze({
        ventureId,
        enabled: false,
        dryRun: true,
        cadence: 'weekly',
        weeklyDay: 1,
        maxCostMicros: 0,
        updatedAt: null,
    });
}
const POLICY_FIELDS = new Set(['enabled', 'dryRun', 'cadence', 'weeklyDay', 'maxCostMicros']);
/**
 * Merge a closed policy patch over the stored/default policy and validate the
 * complete resulting state. Unknown fields are refused rather than ignored.
 */
function mergeRebaselinePolicy(current, patch) {
    const unknown = Object.keys(patch).find((key) => !POLICY_FIELDS.has(key));
    if (unknown) {
        throw new RebaselineError('unknown_rebaseline_policy_field', `unknown rebaseline policy field: ${unknown}`);
    }
    const enabled = patch.enabled === undefined ? current.enabled : patch.enabled;
    const dryRun = patch.dryRun === undefined ? current.dryRun : patch.dryRun;
    const cadence = patch.cadence === undefined ? current.cadence : patch.cadence;
    const weeklyDay = patch.weeklyDay === undefined ? current.weeklyDay : patch.weeklyDay;
    const maxCostMicros = patch.maxCostMicros === undefined
        ? current.maxCostMicros : patch.maxCostMicros;
    if (typeof enabled !== 'boolean' || typeof dryRun !== 'boolean') {
        throw new RebaselineError('invalid_rebaseline_switch', 'enabled and dryRun must be booleans');
    }
    if (!exports.REBASELINE_CADENCES.includes(cadence)) {
        throw new RebaselineError('invalid_rebaseline_cadence', 'cadence must be nightly or weekly');
    }
    if (typeof weeklyDay !== 'number' || !Number.isInteger(weeklyDay)
        || weeklyDay < 0 || weeklyDay > 6) {
        throw new RebaselineError('invalid_rebaseline_weekday', 'weeklyDay must be an integer from 0 through 6 UTC');
    }
    if (typeof maxCostMicros !== 'number' || !Number.isSafeInteger(maxCostMicros)
        || maxCostMicros < 0 || maxCostMicros > venture_primitives_1.MAX_SAFE_MICROS) {
        throw new RebaselineError('invalid_rebaseline_cost_cap', 'maxCostMicros must be non-negative exactly representable integer micro-USD');
    }
    if (enabled && !dryRun && maxCostMicros <= 0) {
        throw new RebaselineError('rebaseline_cost_cap_required', 'a paid scheduled rebaseline requires a positive maxCostMicros cap');
    }
    return Object.freeze({
        ventureId: current.ventureId,
        enabled,
        dryRun,
        cadence: cadence,
        weeklyDay,
        maxCostMicros,
        updatedAt: current.updatedAt,
    });
}
/** Parse a supplied scheduler timestamp without reading the wall clock. */
function schedulerDate(value) {
    const isoTimestamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
    const match = isoTimestamp.exec(value);
    const parsed = new Date(value);
    if (!match || !Number.isFinite(parsed.valueOf())) {
        throw new RebaselineError('invalid_rebaseline_time', 'scheduler time must be an ISO timestamp');
    }
    const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
        || hour > 23 || minute > 59 || second > 59) {
        throw new RebaselineError('invalid_rebaseline_time', 'scheduler time must be a real ISO timestamp');
    }
    return parsed;
}
/**
 * Evaluate one policy for one UTC scheduler instant. The external tick cadence
 * chooses the hour; this function owns only nightly/weekday due semantics.
 */
function evaluateRebaselinePolicy(policy, atIso, forceDryRun = false) {
    const at = schedulerDate(atIso);
    const onDate = at.toISOString().slice(0, 10);
    const due = policy.cadence === 'nightly' || at.getUTCDay() === policy.weeklyDay;
    const slot = due ? `${policy.cadence}:${onDate}` : null;
    const base = {
        slot,
        onDate,
        phases: exports.REBASELINE_PHASES,
        botCallsAtMost: exports.REBASELINE_BOT_CALLS,
        maxCostMicros: policy.maxCostMicros,
    };
    if (!policy.enabled)
        return Object.freeze({ ...base, outcome: 'disabled', wouldStart: false });
    if (!due)
        return Object.freeze({ ...base, outcome: 'not-due', wouldStart: false });
    if (forceDryRun || policy.dryRun) {
        return Object.freeze({ ...base, outcome: 'dry-run', wouldStart: false });
    }
    if (policy.maxCostMicros <= 0) {
        throw new RebaselineError('rebaseline_cost_cap_required', 'paid scheduled policy has no positive cost cap');
    }
    return Object.freeze({ ...base, outcome: 'ready', wouldStart: true });
}
/** Convert one provider-reported USD cost to exact persisted micro-USD. */
function reportedCostUsdToMicros(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new RebaselineError('rebaseline_cost_capture_failed', 'scheduled bot cost was missing or non-positive');
    }
    const micros = Math.round(value * 1_000_000);
    if (!Number.isSafeInteger(micros) || micros <= 0 || micros > venture_primitives_1.MAX_SAFE_MICROS) {
        throw new RebaselineError('rebaseline_cost_capture_failed', 'scheduled bot cost was not exactly representable in micro-USD');
    }
    return micros;
}
/** Per-run measured-cost gate. One instance belongs to one scheduled run. */
class ScheduledRunBudget {
    cap;
    spent = 0;
    started = 0;
    settled = 0;
    skipped = 0;
    captureFailed = false;
    /** Build a finite positive integer-micro cap. There is no unlimited arm. */
    constructor(cap) {
        this.cap = cap;
        if (!Number.isSafeInteger(cap) || cap <= 0 || cap > venture_primitives_1.MAX_SAFE_MICROS) {
            throw new RebaselineError('invalid_rebaseline_cost_cap', 'scheduled run cap must be positive integer micro-USD');
        }
    }
    /** Refuse the next call once known spend reaches the cap or capture failed. */
    beforeCall() {
        const state = this.status();
        return Object.freeze({
            allowed: state.status === 'within-cap',
            reason: state.status,
            capMicros: state.capMicros,
            spentMicros: state.spentMicros,
        });
    }
    /** Mark a provider call as having crossed the dispatch boundary. */
    noteStarted() {
        this.started += 1;
    }
    /** Settle one successful response from its provider-reported USD cost. */
    settleReportedCost(costUsd) {
        this.settled += 1;
        try {
            const micros = reportedCostUsdToMicros(costUsd);
            // Check before addition so the accumulator itself never crosses JS's
            // exact-integer boundary, even when two individually valid charges would.
            if (this.spent > venture_primitives_1.MAX_SAFE_MICROS - micros) {
                this.captureFailed = true;
                return;
            }
            this.spent += micros;
        }
        catch {
            this.captureFailed = true;
        }
    }
    /** A thrown provider call may still have spent; unknown settlement fails closed. */
    noteUnsettled() {
        this.captureFailed = true;
    }
    /** Record one phase refused before its provider boundary. */
    noteSkipped() {
        this.skipped += 1;
    }
    /** Return a frozen integer-only status snapshot. */
    status() {
        const status = this.captureFailed ? 'capture-failed'
            : this.spent > this.cap ? 'overshot'
                : this.spent >= this.cap ? 'exhausted' : 'within-cap';
        return Object.freeze({
            capMicros: this.cap,
            spentMicros: this.spent,
            status,
            callsStarted: this.started,
            callsSettled: this.settled,
            callsSkipped: this.skipped,
        });
    }
}
exports.ScheduledRunBudget = ScheduledRunBudget;
/**
 * Execute one bot boundary through the scheduled cost gate. The gate is checked
 * before dispatch and a thrown call marks cost unknown so all later calls stop.
 */
async function costCappedBotCall(budget, call) {
    const check = budget.beforeCall();
    if (!check.allowed) {
        budget.noteSkipped();
        throw new RebaselineError('rebaseline_cost_cap_blocked', `scheduled bot call blocked: ${check.reason} at ${check.spentMicros}/${check.capMicros} micro-USD`);
    }
    budget.noteStarted();
    let result;
    try {
        result = await call();
    }
    catch (err) {
        budget.noteUnsettled();
        throw err;
    }
    budget.settleReportedCost(result.costUsd);
    return result;
}
//# sourceMappingURL=venture-rebaseline.js.map