"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENGINE_MS = void 0;
exports.processingTick = processingTick;
/** CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | The four desks (spec lanes/monitoring-four-desks-spec-2026-11-08.md). After the alarms the tick activates the desks for the person it runs as (desks.ts: a missing spark/<desk> source, mapping, default policy and processing listing; nothing for a desk already present), inside the time budget and as its own step, so a dead engine stops only that. Every message the tick sends about a desk's source also goes to that desk's topic (app-attention, security-attention, platform-attention, release-attention): the silence notices, the named critical alerts, the undecided ones during an engine outage. operations-attention keeps everything, as the umbrella the attention tool reads. A desk send that fails holds the mark like the umbrella send, so a person who routes only one desk never loses a message. */
/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | What a fifth review proved (2026-11-04). A critical told while the engine was down gets its all-clear even when the resolve is evaluated first, which decides orphan-resolution. The newest undecided rows are named, from sources on the list, so old or foreign rows cannot fill the page and hide a new critical. A failed read of the mark no longer writes a blank one over it. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | What a fourth review proved on the real stack (2026-11-04). Only the worker's decisions reach the phone: telling from every decision on record paged the replay's synthetic alerts and old events re-evaluated after a policy edit. While evaluation is failing, a critical on an undecided delivery is told by name, once, because a percolator outage otherwise kept it off the phone until the percolator returned. A message fits the shortest rail, names what is firing before what cleared, and leaves out a firing InstallationSilent, which its notice already told. A step's failure is news per step, so a second failure inside a streak is told. A rail that keeps refusing goes on the attention list. Discovery and detection stop at the tick's deadline too. Correlation deferred by the deadline is owed to the next tick, and a re-fire is not promoted on a tick whose evaluation failed or fell behind, since a resolve may be waiting. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | The processing tick, out of its one-line route, with what a third review proved on the real stack (2026-11-04). Alarms come first and nothing after them can stop them: the watch, its notices and what the phone is owed run before discovery, detection and evaluation, and one step that throws no longer ends the tick. What the phone is told comes from the decisions on record, behind a mark that moves only once the rail has taken the message, so a failed send, a store failure after the decision or a tick the kernel ended still reaches the person. It names the latest word per symptom in the order the alerts happened, and does not say cleared while another alert of that type is on the card. A failing tick tells the phone once, not every minute. Nothing new starts after 25 s: a tick the kernel ends at 60 s keeps its budget reservation, and ten of those stop the schedule until midnight UTC. */
// @ts-nocheck
const installations_1 = require("./installations");
const ingest_1 = require("./ingest");
const intake_1 = require("./intake");
const pipeline_1 = require("./pipeline");
const processing_worker_1 = require("./processing-worker");
const evidence_worker_1 = require("./evidence-worker");
const correlation_tick_1 = require("./correlation-tick");
const auto_investigate_1 = require("./auto-investigate");
const discovery_1 = require("./discovery");
const anomaly_engine_1 = require("./anomaly-engine");
const desks_1 = require("./desks");
const TOLD = 'alerts-told', WORTH = ['admitted', 'escalated', 'refired', 'source-resolved'], PAGE = 64;
/** Past this the tick starts nothing new. One engine call is held to ENGINE_MS below, so what is running still ends inside the kernel's 60 s. */
const SOFT_MS = 25000;
exports.ENGINE_MS = 25000;
/** A step that keeps failing tells the phone once; only this long without that step failing makes its next failure news. */
const FAILURE_QUIET_MS = 900000;
/** The kernel's shortest rail, a voice alert, refuses over 500 characters, and a refused message would otherwise hold every later one. */
const MAX_MESSAGE = 480, MAX_LINE = 200;
const unavailable = (name, error) => error.status ? String(error.message).slice(0, 240) : name + ' is unavailable.';
/** @description Tell the person an installation went silent or came back. A notice stays pending while the rail throws, so an outage of the rail does not lose it; the rail's own skip (mute, quiet hours) counts as delivered to the rail. */
async function sendNotices(ctx, owner, notices, sources = []) {
    const sent = [];
    if (typeof ctx.notify !== 'function' || !notices?.length)
        return { requested: notices?.length || 0, sent: 0 };
    for (const notice of notices) {
        try {
            for (const topic of topicsFor(sources, [notice.sourceId]))
                await ctx.notify(topic, notice.text);
            sent.push(notice);
        }
        catch { }
    }
    for (const sourceId of new Set(sent.map(n => n.sourceId)))
        await (0, ingest_1.clearNotices)(ctx.pool, owner, sourceId, sent.filter(n => n.sourceId === sourceId).map(n => n.id));
    return { requested: notices.length, sent: sent.length };
}
/** The umbrella topic first, then each desk topic these sources belong to, once. */
const topicsFor = (sources, sourceIds) => ['operations-attention', ...new Set(sourceIds.map(id => (0, desks_1.deskOf)(sources, id)?.topic).filter(Boolean))];
/** A desk's share of the lines: its label leads the message, so a phone routed to one desk says which desk rang. */
function deskMessages(sources, entries, ending, rest = []) {
    const out = [];
    for (const topic of topicsFor(sources, entries.map(e => e.sourceId)).slice(1)) {
        const desk = entries.map(e => (0, desks_1.deskOf)(sources, e.sourceId)).find(d => d?.topic === topic);
        out.push([topic, messageFor(entries.filter(e => (0, desks_1.deskOf)(sources, e.sourceId)?.topic === topic).map(e => e.line), rest, ending, desk.label + ' attention: ')]);
    }
    return out;
}
async function saveTold(pool, owner, exists, record) {
    if (exists)
        await pool.query('UPDATE operations_processing_config SET record=$3 WHERE user_sub=$1 AND id=$2', [owner, TOLD, JSON.stringify(record)]);
    else
        await pool.query('INSERT INTO operations_processing_config(user_sub,id,revision,record) VALUES($1,$2,1,$3)', [owner, TOLD, JSON.stringify(record)]);
}
/** The decisions after the mark, oldest first. A mark records the ids at its own instant, because two decisions can share a millisecond. */
async function decisionsAfter(pool, owner, mark) {
    const rows = (await pool.query('SELECT record FROM operations_filter_decisions WHERE user_sub=$1 AND created_at>=$2 ORDER BY created_at, id LIMIT ' + PAGE, [owner, mark.through])).rows.map(r => r.record);
    return rows.filter(d => !(mark.ids || []).includes(d.id));
}
const markAfter = (mark, decisions) => { if (!decisions.length)
    return mark; const through = decisions.at(-1).at; return { ...mark, through, ids: [...(through === mark.through ? mark.ids || [] : []), ...decisions.filter(d => d.at === through).map(d => d.id)] }; };
const eventAt = record => Date.parse(record.normalized?.time) || 0;
const symptomOf = record => (0, intake_1.hash)(['told-early', record.identity?.symptom]);
/** @description What these decisions owe the phone, by name: a critical alert that fired, fired again or cleared, the latest word per symptom in the order the alerts happened, what is firing first. Only the worker's decisions count: a replay or an Evaluate pressed by hand is not news. A warning stays on the card and in the pipeline, as the droplet's rules say, and InstallationSilent has its own notices. Cleared is not said while another alert of that type and service is still on the card, nor for what stopping the watch closed. A read that fails throws, so the mark stays and nothing is lost. @param decisions Decisions or stand-ins. @param early Deliveries already told while evaluation was failing. @param firedEarly Symptoms told as firing then: a resolve evaluated ahead of its firing decides orphan-resolution, and is still that alert's all-clear. @returns The count and one line per alert. */
async function namedAlerts(pool, owner, decisions, early = [], firedEarly = []) {
    const told = decisions.filter(d => d.byWorker && (WORTH.includes(d.reduction?.outcome) || d.reduction?.outcome === 'orphan-resolution') && !early.includes(d.deliveryId)), ids = [...new Set(told.map(d => d.deliveryId))];
    if (!ids.length)
        return { critical: 0, lines: [], entries: [] };
    const records = new Map((await pool.query('SELECT record FROM operations_deliveries WHERE user_sub=$1 AND id IN (' + ids.map((_, i) => '$' + (i + 2)).join(',') + ')', [owner, ...ids])).rows.map(r => [r.record.id, r.record])), latest = new Map();
    for (const d of told) {
        const r = records.get(d.deliveryId);
        if (!r)
            continue;
        const held = latest.get(d.reduction.symptomKey);
        if (!held || eventAt(r) >= eventAt(held.r))
            latest.set(d.reduction.symptomKey, { r, outcome: d.reduction.outcome });
    }
    const firing = [], cleared = [];
    for (const { r, outcome } of [...latest.values()].sort((a, b) => eventAt(a.r) - eventAt(b.r))) {
        const x = r.normalized?.data || {}, labels = r.raw?.data?.labels || {}, service = typeof labels.service === 'string' ? labels.service : null;
        if (x.severity !== 'critical' || x.alertType === installations_1.SILENT || labels.closed_by || (outcome === 'orphan-resolution' && !firedEarly.includes(symptomOf(r))))
            continue;
        const name = '[critical] ' + (x.alertType || 'Alert') + (service ? ' (' + service + ')' : '') + ' on ' + (x.environment || 'an installation');
        if (x.status === 'resolved') {
            const row = await (0, installations_1.installationRow)(pool, owner, r.sourceId);
            if (!Object.values(row?.alerts || {}).some(a => a.alertType === x.alertType && (a.service || null) === service))
                cleared.push({ line: name + ' cleared', sourceId: r.sourceId });
        }
        else
            firing.push({ line: (name + (outcome === 'refired' ? ' again' : '') + (typeof r.raw?.data?.summary === 'string' ? ': ' + r.raw.data.summary : '')).slice(0, MAX_LINE), sourceId: r.sourceId });
    }
    const entries = [...firing, ...cleared];
    return { critical: entries.length, lines: entries.map(e => e.line), entries };
}
/** One message that fits the shortest rail: what will not fit is counted, and what is firing comes first, so a count only ever hides what is firing when too much is. */
function messageFor(lines, rest, ending, prefix = 'Operations attention: ') {
    const fixed = prefix.length + ending.length + rest.join(', ').length + 30, kept = [];
    let used = fixed;
    for (const line of lines) {
        if (kept.length && used + line.length + 2 > MAX_MESSAGE)
            break;
        kept.push(line);
        used += line.length + 2;
    }
    const list = kept.length ? kept.join('; ') + (lines.length > kept.length ? '; and ' + (lines.length - kept.length) + ' more' : '') : '';
    return prefix + [list, ...rest].filter(Boolean).join(', ') + ending;
}
/** @description Ask the kernel notification rail to tell the person what the decisions on record owe them, and move the mark only once it has taken the message. The rail chooses the channel from the person's preferences and may skip silently (mute, quiet hours, no address), so the result is a request, never proof of delivery. A rail that refuses is kept on the mark, for the attention list. @param extra This tick's anomaly candidates and captured packets, mentioned when there is a message. @returns The request's outcome. */
async function tellAlerts(ctx, owner, extra = {}, sources = []) {
    if (typeof ctx.notify !== 'function')
        return { requested: false, reason: 'notification port unavailable' };
    const held = await (0, installations_1.phoneMark)(ctx.pool, owner);
    if (!held) {
        await saveTold(ctx.pool, owner, false, { through: new Date().toISOString(), ids: [] });
        return { requested: false, reason: 'nothing needs attention' };
    }
    const decisions = await decisionsAfter(ctx.pool, owner, held), early = held.early || [], { critical, lines, entries } = await namedAlerts(ctx.pool, owner, decisions, early, held.firedEarly || []), candidates = extra.candidates || 0, captured = extra.captured || 0;
    const settle = sent => { const { railError, early: _, ...kept } = markAfter(held, decisions), left = early.filter(id => !decisions.some(d => d.deliveryId === id)); return decisions.length || (sent && railError) ? saveTold(ctx.pool, owner, true, { ...kept, ...(sent || !railError ? {} : { railError }), ...(left.length ? { early: left } : {}) }) : null; };
    if (!critical && !candidates) {
        await settle(false);
        return { requested: false, reason: 'nothing needs attention' };
    }
    const ending = '. Open Data pipeline to review; nothing was executed.', rest = [candidates ? candidates + ' anomaly candidate(s)' : '', captured ? captured + ' evidence packet(s) captured' : ''].filter(Boolean);
    const messages = [['operations-attention', messageFor(lines, rest, ending)], ...deskMessages(sources, entries, ending)];
    try {
        let accepted = true;
        for (const [topic, message] of messages) {
            const sent = await ctx.notify(topic, message);
            accepted = accepted && sent?.sent === true;
        }
        await settle(true);
        return { requested: true, topic: 'operations-attention', topics: messages.map(m => m[0]), accepted, deliveryProof: 'none; the kernel rail may skip by preference' };
    }
    catch (error) {
        const text = String(error.message || error).slice(0, 200);
        await saveTold(ctx.pool, owner, true, { ...held, railError: { since: held.railError?.since || new Date().toISOString(), error: text } });
        return { requested: true, topic: 'operations-attention', topics: messages.map(m => m[0]), accepted: false, error: text };
    }
}
/** @description While evaluation is failing there is no decision to tell from, and a percolator outage can outlast an outage of the site. A critical waiting on the queue is told by name, once, saying it is not evaluated yet; the decision that follows when the engine returns stays quiet about it. Sources off the processing list stay out, as a replay's do. */
async function tellUndecided(ctx, owner, sources = []) {
    if (typeof ctx.notify !== 'function')
        return;
    const held = await (0, installations_1.phoneMark)(ctx.pool, owner);
    if (!held)
        return;
    const early = held.early || [], config = await (0, processing_worker_1.processingConfig)(ctx.pool, owner);
    if (!config.sourceIds?.length)
        return;
    const ids = (await ctx.pool.query("SELECT id FROM operations_processing WHERE user_sub=$1 AND state IN ('pending','retry','evaluating') AND record->>'sourceId' IN (" + config.sourceIds.map((_, i) => '$' + (i + 2)).join(',') + ') ORDER BY created_at DESC, id LIMIT ' + PAGE, [owner, ...config.sourceIds])).rows.map(r => r.id).filter(id => !early.includes(id));
    if (!ids.length)
        return;
    const records = (await ctx.pool.query('SELECT record FROM operations_deliveries WHERE user_sub=$1 AND id IN (' + ids.map((_, i) => '$' + (i + 2)).join(',') + ')', [owner, ...ids])).rows.map(r => r.record).filter(r => r.normalized);
    const { critical, lines, entries } = await namedAlerts(ctx.pool, owner, records.map(r => ({ byWorker: true, deliveryId: r.id, reduction: { symptomKey: (0, intake_1.hash)(['undecided', r.identity?.symptom]), outcome: r.normalized.data.status === 'resolved' ? 'source-resolved' : 'admitted' } })));
    const ending = '. The detection engine is not answering, so these are not evaluated yet. Open Systems to review; nothing was executed.';
    if (critical)
        for (const [topic, message] of [['operations-attention', messageFor(lines, [], ending)], ...deskMessages(sources, entries, ending)])
            await ctx.notify(topic, message);
    const fired = records.filter(r => r.normalized.data.status !== 'resolved' && r.normalized.data.severity === 'critical').map(symptomOf);
    await saveTold(ctx.pool, owner, true, { ...held, early: [...early, ...records.map(r => r.id)].slice(-PAGE), firedEarly: [...new Set([...(held.firedEarly || []), ...fired])].slice(-PAGE) });
}
/** @description Tell the phone a step of the tick could not finish, once per step per failing streak: the same failure every minute is noise, a second step failing is news, and only 15 quiet minutes make a step's next failure news. A store too broken to read this mark has told the person nothing, but Data pipeline and the 503 still say so. */
async function tellFailure(ctx, owner, steps) {
    if (!steps.length || typeof ctx.notify !== 'function')
        return;
    const held = await (0, installations_1.phoneMark)(ctx.pool, owner), now = Date.now(), at = new Date(now).toISOString(), failed = held?.failedSteps || {}, news = [...new Set(steps)].filter(step => !failed[step] || now - Date.parse(failed[step]) >= FAILURE_QUIET_MS);
    if (news.length)
        await ctx.notify('operations-attention', 'Operations attention: ' + news.join(', ') + ' could not finish. Open Data pipeline to review; nothing was executed.');
    const kept = Object.fromEntries(Object.entries(failed).filter(([, when]) => now - Date.parse(when) < 86400000));
    await saveTold(ctx.pool, owner, Boolean(held), { through: at, ids: [], ...held, failedSteps: { ...kept, ...Object.fromEntries(steps.map(step => [step, at])) } });
}
/** @description One processing tick: alarms first, then whatever fits in the time, each step apart so one failure stops only itself. Work that does not fit stays durable for the next tick. @param ctx The package context. @param engine The detection engine, held to ENGINE_MS per call. @param owner The activating person. @param read The store read that gives the saved sources. @param softMs When to stop starting new work. @returns The JSON the route answers and whether anything failed. */
async function processingTick(ctx, engine, owner, read, softMs = SOFT_MS) {
    const soft = Date.now() + softMs, inTime = () => Date.now() < soft, failed = [];
    const step = async (name, fallback, run) => { try {
        return await run();
    }
    catch (error) {
        failed.push(name);
        return { ...fallback, error: unavailable(name, error) };
    } };
    const sources = await read('sources');
    const watch = await step('the silence watch', { silenced: [], notices: [], graceUntil: null }, () => (0, ingest_1.watchInstallations)(ctx.pool, owner, sources));
    const notices = await step('the silence notices', { requested: watch.notices?.length || 0, sent: 0 }, () => sendNotices(ctx, owner, watch.notices, sources));
    // What an earlier tick decided and did not get to tell, before anything slow can run.
    await step('the phone message', {}, () => tellAlerts(ctx, owner, {}, sources));
    // The four desks exist for this person from the first tick on; a desk already present costs a read and changes nothing.
    const desks = inTime() ? await step('desk activation', { desks: [] }, () => (0, desks_1.activateDesks)(ctx, engine, owner, read, { sources, inTime })) : { desks: [], deferred: true };
    if (desks.error && !failed.includes('desk activation'))
        failed.push('desk activation');
    const discovery = inTime() ? await step('discovery', { enabled: true }, () => (0, discovery_1.runDiscovery)(ctx, owner, sources, Date.now, false, soft)) : { enabled: true, deferred: true };
    const anomaly = inTime() ? await step('anomaly detection', { failed: 0, candidates: 0 }, () => (0, anomaly_engine_1.runDetection)(ctx.pool, owner, sources, Date.now, soft)) : { deferred: true, failed: 0, candidates: 0 };
    const result = inTime() ? await step('alert evaluation', { enabled: true, evaluated: 0, failed: 0, results: [] }, () => (0, processing_worker_1.processPending)(ctx.pool, engine, owner, Date.now, soft)) : { enabled: true, evaluated: 0, failed: 0, results: [], deferred: true };
    const evaluationBehind = Boolean(result.failed || result.deferred || failed.includes('alert evaluation'));
    // A resolve may be waiting behind a failed or deferred evaluation, and it would have ended the wait.
    const promoted = evaluationBehind ? { results: [] } : await step('evidence for a re-fired alert', { results: [] }, () => (0, pipeline_1.promoteRefired)(ctx.pool, owner));
    const fresh = [...(result.results || []), ...(promoted.results || [])], admitted = fresh.some(r => ['admitted', 'escalated'].includes(r.outcome));
    const refreshed = inTime() && admitted && discovery.enabled ? await step('discovery', { enabled: true }, () => (0, discovery_1.runDiscovery)(ctx, owner, sources, Date.now, true, soft)) : null;
    const evidence = inTime() ? await step('evidence capture', { enabled: true, captured: 0, notRequested: 0, failed: 0, results: [] }, () => (0, evidence_worker_1.capturePendingEvidence)(ctx.pool, owner, Date.now, soft)) : { enabled: true, captured: 0, notRequested: 0, failed: 0, results: [], deferred: true };
    // A failed read leaves this null, so nothing below writes a blank mark over the real one.
    const mark = await (0, installations_1.phoneMark)(ctx.pool, owner).catch(() => null);
    let correlation = { enabled: true, correlated: false, deferred: true };
    if (inTime())
        correlation = await step('correlation', { enabled: true, correlated: false }, () => (0, correlation_tick_1.correlateAdmitted)(ctx.pool, owner, admitted || !mark?.correlationOwed ? fresh : [{ outcome: 'admitted' }]));
    const owed = Boolean(correlation.deferred && (admitted || mark?.correlationOwed));
    if (mark && Boolean(mark.correlationOwed) !== owed)
        await step('the phone message', {}, () => saveTold(ctx.pool, owner, true, { ...mark, correlationOwed: owed }));
    const investigation = inTime() ? await step('investigations', { enabled: true }, () => (0, auto_investigate_1.autoInvestigate)(ctx, owner)) : { enabled: true, deferred: true };
    const notification = await step('the phone message', { requested: true, accepted: false }, () => tellAlerts(ctx, owner, { candidates: anomaly.candidates || 0, captured: evidence.captured || 0 }, sources));
    if (result.failed || failed.includes('alert evaluation'))
        await step('the phone message', {}, () => tellUndecided(ctx, owner, sources));
    const steps = [...failed, ...(result.failed ? ['alert evaluation'] : []), ...(evidence.failed ? ['evidence capture'] : []), ...(anomaly.failed ? ['anomaly detection'] : []), ...(watch.errors?.length ? ['the silence watch'] : [])];
    await step('the phone message', {}, () => tellFailure(ctx, owner, steps));
    const count = (result.failed || 0) + (evidence.failed || 0) + (anomaly.failed || 0) + (watch.errors?.length || 0) + failed.length;
    return { failed: count, body: { ...result, evidence, anomaly, correlation, investigation, notification, notices, desks, promoted: promoted.promoted || 0, watch: { silenced: watch.silenced, graceUntil: watch.graceUntil, ...(watch.errors ? { errors: watch.errors } : {}), ...(watch.error ? { error: watch.error } : {}) }, discovery, refreshed, ...(count ? { error: count + ' processing, capture or detection attempts need attention; refresh processing status.' } : {}) } };
}
