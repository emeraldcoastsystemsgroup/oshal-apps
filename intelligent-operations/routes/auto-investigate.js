"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoInvestigate = autoInvestigate;
/** CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | A third review proved any permanent refusal held a slot the way the oversized packet did: a runbook saved after the packet made its input no longer match, every tick, for good (2026-11-04). What the investigation itself refuses for good (a bad reservation, input that no longer matches, an alert that is gone, a packet over the ceiling) is a definite no-start now. Another tick's claim, a 401, a 403 and a 5xx say nothing about this evidence and stay retryable. */
/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | A sealed packet over the input ceiling can never start, and two of them held both of this tick's slots for good, so no later evidence was ever investigated and nothing said so (independent review, 2026-11-03). It is recorded as start-refused, which frees the slot and shows under attention. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Record a kernel refusal (refused, invalid, not linked) as start-refused, a definite no-start held for the operator, apart from an uncertain start. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Automatic investigation dispatch: with the worker's opt-in, each tick starts at most two investigations for captured evidence that has none, through the kernel package-port ticket start (the HTTP start path). A starting marker is committed before the start; a ticket that is no longer queued is never started again, and an uncertain start is held for the operator instead of retried, because a second start of a running ticket would dispatch its phase twice. */
// @ts-nocheck
const processing_worker_1 = require("./processing-worker");
const investigations_1 = require("./investigations");
const pipeline_1 = require("./pipeline");
const PER_TICK = 2;
// The kernel answers a refused or invalid start before dispatch; nothing started. Anything else (lost reply, unavailable) is uncertain.
const REFUSED = /^(refused|invalid): |is not linked for this package/;
// What will not change on a later tick. A 409 alone will not do: another tick's claim on the same evidence answers 409 too.
const forGood = error => [400, 404, 413].includes(error.status) || (error.status === 409 && /no longer matches|is unavailable/.test(error.message));
async function mark(pool, owner, id, from, patch) {
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const row = (await c.query('SELECT record FROM operations_investigations WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, id])).rows[0]?.record;
        if (!row || (from && !from.includes(row.state)))
            return null;
        const record = { ...row, ...patch };
        await c.query('UPDATE operations_investigations SET record=$3 WHERE user_sub=$1 AND id=$2', [owner, id, JSON.stringify(record)]);
        return record;
    });
}
/** A definite refusal before any ticket exists: the row takes this evidence out of the pending query. */
async function refuse(pool, owner, id, message) {
    const at = new Date().toISOString();
    await (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const row = (await c.query('SELECT record FROM operations_investigations WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, id])).rows[0]?.record;
        const work = (await c.query('SELECT record FROM operations_evidence_work WHERE user_sub=$1 AND id=$2', [owner, id])).rows[0]?.record, record = { ...(row || { id, deliveryId: work?.deliveryId || null, createdAt: at, executionAuthorized: false }), state: 'start-refused', error: message, trigger: 'scheduled-tick' };
        if (row)
            await c.query('UPDATE operations_investigations SET record=$3 WHERE user_sub=$1 AND id=$2', [owner, id, JSON.stringify(record)]);
        else
            await c.query('INSERT INTO operations_investigations(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)', [owner, id, at, JSON.stringify(record)]);
    });
}
/** @description Start investigations for captured evidence without one; bounded, idempotent and never a blind retry. */
async function autoInvestigate(ctx, owner) {
    const config = await (0, processing_worker_1.processingConfig)(ctx.pool, owner);
    if (!config.enabled || !config.autoInvestigate)
        return { enabled: false };
    if (typeof ctx.ticketService?.startTicket !== 'function')
        return { enabled: true, available: false, reason: 'The kernel ticket start port is unavailable; start investigations from Data pipeline.' };
    const pending = (await ctx.pool.query("SELECT w.id FROM operations_evidence_work w LEFT JOIN operations_investigations i ON i.user_sub=w.user_sub AND i.id=w.id WHERE w.user_sub=$1 AND w.record->>'state'='captured' AND (i.id IS NULL OR i.record->>'state'='queued') ORDER BY w.created_at, w.id LIMIT " + PER_TICK, [owner])).rows;
    const results = [];
    for (const { id } of pending) {
        try {
            const prepared = await (0, investigations_1.prepareInvestigation)(ctx, owner, id);
            if (prepared.ticket?.status !== 'queued') {
                await mark(ctx.pool, owner, id, ['queued'], { state: 'started', reconciledAt: new Date().toISOString(), ticketStatus: prepared.ticket?.status || null });
                results.push({ id, ticketId: prepared.ticketId, state: 'already-started' });
                continue;
            }
            const claimed = await mark(ctx.pool, owner, id, ['queued'], { state: 'starting', startRequestedAt: new Date().toISOString(), trigger: 'scheduled-tick' });
            if (!claimed) {
                results.push({ id, state: 'skipped', reason: 'another tick claimed this start' });
                continue;
            }
            try {
                const started = await ctx.ticketService.startTicket(prepared.ticketId, prepared.startInput);
                await mark(ctx.pool, owner, id, ['starting'], { state: 'started', startedAt: new Date().toISOString(), ticketStatus: started?.ticket?.status || started?.status || null });
                results.push({ id, ticketId: prepared.ticketId, state: 'started' });
            }
            catch (error) {
                const message = String(error?.message || error).slice(0, 240), state = REFUSED.test(message) ? 'start-refused' : 'start-uncertain';
                await mark(ctx.pool, owner, id, ['starting'], { state, error: message });
                results.push({ id, ticketId: prepared.ticketId, state, error: message });
            }
        }
        catch (error) {
            if (forGood(error)) {
                const message = String(error.message).slice(0, 240);
                await refuse(ctx.pool, owner, id, message);
                results.push({ id, state: 'start-refused', error: message });
                continue;
            }
            results.push({ id, state: 'not-prepared', error: error.status ? String(error.message).slice(0, 240) : 'Investigation storage or ticket service is unavailable.' });
        }
    }
    return { enabled: true, available: true, started: results.filter(r => r.state === 'started').length, uncertain: results.filter(r => r.state === 'start-uncertain').length, refused: results.filter(r => r.state === 'start-refused').length, results };
}
