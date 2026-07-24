"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-17 11:20:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Industrial-strength ops primitives for the generate path: retry-with-backoff (transient vendor errors only), a hard per-attempt timeout, and a process-wide concurrency semaphore. Pure module — no framework imports — so the package test suite can exercise it under plain node.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Semaphore = void 0;
exports.withRetries = withRetries;
exports.isTransientVendorError = isTransientVendorError;
exports.withTimeout = withTimeout;
/**
 * @description Run `fn` with exponential backoff, retrying ONLY errors `isRetryable` accepts.
 * A permanent error (bad request, auth) throws immediately — retrying it would just triple
 * the bill for the same failure.
 *
 * @param fn - The attempt.
 * @param isRetryable - Classifier deciding whether an error is transient.
 * @param opts - attempts (default 3), baseDelayMs (default 2000), injectable sleep.
 * @returns The first successful result.
 * @throws The last error once attempts are exhausted, or the first permanent error.
 */
async function withRetries(fn, isRetryable, opts = {}) {
    const attempts = Math.max(1, opts.attempts ?? 3);
    const base = opts.baseDelayMs ?? 2000;
    const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        }
        catch (err) {
            lastErr = err;
            if (i === attempts - 1 || !isRetryable(err))
                throw err;
            await sleep(base * Math.pow(2, i) + Math.floor(Math.random() * 250));
        }
    }
    throw lastErr;
}
/**
 * @description Is this vendor error worth retrying? Rate limits, 5xx, network flaps and
 * timeouts are transient; 4xx (bad key, bad request, content refusal) are permanent.
 * @param err - The error thrown by a generation attempt.
 * @returns True when a retry has a realistic chance of succeeding.
 */
function isTransientVendorError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/RATE_LIMITED/.test(msg))
        return true;
    if (/HTTP 5\d\d/.test(msg))
        return true;
    if (/HTTP 429/.test(msg))
        return true;
    if (/(fetch failed|network|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|abort|timed out)/i.test(msg))
        return true;
    return false;
}
/**
 * @description Bound a promise with a hard deadline. The underlying work is not cancelled
 * (fetch keeps running server-side) but the caller stops waiting, frees its concurrency slot,
 * and the attempt counts as failed — which is what keeps a hung vendor from wedging the queue.
 *
 * @param work - The promise to bound.
 * @param ms - Deadline in milliseconds.
 * @param label - What was being waited on, for the error message.
 * @returns The work's result if it beats the deadline.
 * @throws Error `<label> timed out after <ms>ms` on deadline.
 */
function withTimeout(work, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        work.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
}
/**
 * @description A minimal FIFO counting semaphore bounding concurrent vendor calls process-wide.
 * 25 users clicking Generate at once must not open 25 vendor connections.
 */
class Semaphore {
    limit;
    inFlight = 0;
    waiters = [];
    constructor(limit) {
        this.limit = limit;
        if (!Number.isFinite(limit) || limit < 1)
            throw new Error(`Semaphore limit must be >= 1, got ${limit}`);
    }
    /** @description Wait for a slot. @returns Resolves when the caller may proceed. */
    async acquire() {
        while (this.inFlight >= this.limit) {
            await new Promise((r) => this.waiters.push(r));
        }
        this.inFlight++;
    }
    /** @description Free a slot and wake the next waiter (call from finally). */
    release() {
        this.inFlight = Math.max(0, this.inFlight - 1);
        const next = this.waiters.shift();
        if (next)
            next();
    }
    /** @description Currently-running holders (for tests/observability). @returns The in-flight count. */
    get active() {
        return this.inFlight;
    }
}
exports.Semaphore = Semaphore;
//# sourceMappingURL=portrait-ops.js.map