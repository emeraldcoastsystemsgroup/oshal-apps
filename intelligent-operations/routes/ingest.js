"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearNotices = void 0;
exports.ingestMapping = ingestMapping;
exports.saveIngestMapping = saveIngestMapping;
exports.alertEvent = alertEvent;
exports.ingestAlertmanager = ingestAlertmanager;
exports.watchInstallations = watchInstallations;
exports.stopWatching = stopWatching;
/** CHANGE LOG: 6 | maintainer@emeraldcoastsystemsgroup.com | What a fourth review proved on the real stack (2026-11-04). Whether a resolve can be believed is asked per alert, from what the heartbeat says Prometheus lists. The watch also clears what no resolve ever came for, as after a reboot. Stopping the watch closes everything on the row, with a label that keeps it off the phone, because a retired server cleared nothing. */
/** CHANGE LOG: 5 | maintainer@emeraldcoastsystemsgroup.com | What a third review proved on the real stack (2026-11-04). A resolve Alertmanager delivered because Prometheus died is not admitted: it waits on the card until Prometheus has been back long enough to fire it again, so 'cleared' means cleared. Stop watching refuses an installation that is still reporting, because the next report would bring back an empty card and hide what is firing for up to 4 hours; it admits what is held first, and leaves the scans alone when another revision of the source still reports on them. */
/** CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | What an independent review proved (2026-11-03). A failed admit no longer loses the alarm: a silence and a recovery each stay owed in the installation's row and are retried until admit succeeds, one source's failure no longer stops the others, and stopping the watch resolves first. InstallationSilent names the host the heartbeats filed, not the scope. */
/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | Three holes Roger's question exposed (2026-11-03). An event id of fingerprint and status made every later outage of the same alert a "conflict" (its start time differed), so only the first ContainerMissing an installation ever had was processed: the firing id now carries the alert's start time, one id per occurrence. A repeat of one occurrence whose description moved (DiskHigh's percentage) is that same occurrence, not a conflict. InstallationHeartbeat is taken out before intake and recorded as proof of life (installations.ts), and watchInstallations raises InstallationSilent when one stops: a dead droplet cannot report its own death. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Carry the alert's summary, description and up to 24 labels (bounded) so the evidence packet can quote them. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Unattended producer adapter (R07/R08): an Alertmanager webhook delivery, admitted by the kernel's producer door as the source's owner, becomes one CloudEvents alert per Alertmanager alert, each admitted through the same validated intake as a hand-entered event (deduplication, quarantine, processing item). The owner maps each source once: the resource kind, the label that carries the resource id, the scope and the environment. A delivery for a source without that mapping, or for another person's source, admits nothing. */
// @ts-nocheck
const pipeline_1 = require("./pipeline");
const intake_1 = require("./intake");
const installations_1 = require("./installations");
Object.defineProperty(exports, "clearNotices", { enumerable: true, get: function () { return installations_1.clearNotices; } });
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const KINDS = ['kubernetes-pod', 'container', 'workload', 'host'], LABEL = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/, TEXT = /^[\x20-\x7e]{1,128}$/;
const SCHEMA = 'urn:oshal:operations:alert:1', MAX_ALERTS = 100;
const ownerRequired = owner => { if (typeof owner !== 'string' || !owner)
    fail(401, 'A verified caller is required.'); };
const key = sourceId => 'ingest:' + sourceId;
/** @description The owner's Alertmanager mapping for one saved source revision, or null. */
async function ingestMapping(pool, owner, sourceId) {
    ownerRequired(owner);
    return (await pool.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2', [owner, key(sourceId)])).rows[0]?.record || null;
}
/** @description Save how this source's Alertmanager alerts name their resource: kind, id label, scope and environment. */
async function saveIngestMapping(pool, owner, input, sources) {
    ownerRequired(owner);
    const allowed = ['sourceId', 'resourceKind', 'idLabel', 'scope', 'severityLabel'];
    if (!input || typeof input !== 'object' || Object.keys(input).some(k => !allowed.includes(k)))
        fail(400, 'Map a source with resourceKind, idLabel, scope and optionally severityLabel.');
    const source = sources.find(s => s.id === input.sourceId);
    if (!source)
        fail(400, 'Choose one of your saved source revisions.');
    if (!KINDS.includes(input.resourceKind))
        fail(400, 'resourceKind is one of ' + KINDS.join(', ') + '.');
    if (!LABEL.test(input.idLabel || ''))
        fail(400, 'idLabel names one Alertmanager label.');
    if (input.severityLabel !== undefined && !LABEL.test(input.severityLabel))
        fail(400, 'severityLabel names one Alertmanager label.');
    if (!TEXT.test(input.scope || ''))
        fail(400, 'scope is the resource scope, e.g. the cluster UID.');
    const record = { sourceId: source.id, source: source.source, environment: source.environment, resourceKind: input.resourceKind, idLabel: input.idLabel, severityLabel: input.severityLabel || 'severity', scope: input.scope, updatedAt: new Date().toISOString() };
    await (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const held = (await c.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, key(source.id)])).rows[0];
        if (held)
            await c.query('UPDATE operations_processing_config SET record=$3 WHERE user_sub=$1 AND id=$2', [owner, key(source.id), JSON.stringify(record)]);
        else
            await c.query('INSERT INTO operations_processing_config(user_sub,id,revision,record) VALUES($1,$2,1,$3)', [owner, key(source.id), JSON.stringify(record)]);
    });
    return record;
}
const digits = value => String(value || '').replace(/[^0-9]/g, '').slice(0, 14);
/** @description One Alertmanager alert as the Operations alert envelope. The id is stable per occurrence: a repeat of one firing alert is the same event, and the same alert firing again later is a new one. */
function alertEvent(mapping, alert) {
    const labels = alert && typeof alert.labels === 'object' && alert.labels || {}, status = alert?.status === 'resolved' ? 'resolved' : 'firing';
    const ended = typeof alert?.endsAt === 'string' && !alert.endsAt.startsWith('0001') ? alert.endsAt : null;
    const fingerprint = typeof alert?.fingerprint === 'string' && /^[A-Za-z0-9]{1,64}$/.test(alert.fingerprint) ? alert.fingerprint : null;
    return { specversion: '1.0', id: (fingerprint || 'unfingerprinted') + '-' + status + (status === 'resolved' ? (ended ? '-' + digits(ended) : '') : (digits(alert?.startsAt) ? '-' + digits(alert.startsAt) : '')), source: mapping.source, type: 'operations.alert',
        time: status === 'resolved' && ended ? ended : alert?.startsAt, dataschema: SCHEMA, datacontenttype: 'application/json',
        data: { environment: mapping.environment, alertType: String(labels.alertname || 'UnnamedAlert').slice(0, 128),
            ...(typeof alert?.annotations?.summary === 'string' ? { summary: alert.annotations.summary.slice(0, 512) } : {}), ...(typeof alert?.annotations?.description === 'string' ? { description: alert.annotations.description.slice(0, 1024) } : {}),
            labels: Object.fromEntries(Object.entries(labels).filter(([k, v]) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k) && typeof v === 'string').slice(0, 24).map(([k, v]) => [k, v.slice(0, 128)])), severity: String(labels[mapping.severityLabel] || 'warning').slice(0, 32), status,
            resource: { kind: mapping.resourceKind, scope: mapping.scope, id: typeof labels[mapping.idLabel] === 'string' ? labels[mapping.idLabel] : '' } } };
}
/** @description Admit an Alertmanager webhook delivery for one mapped source: every alert goes through intake; nothing else runs. */
async function ingestAlertmanager(pool, owner, sources, sourceId, body, clock = Date.now) {
    ownerRequired(owner);
    const source = sources.find(s => s.id === sourceId);
    if (!source)
        fail(404, 'No such source in your scope.');
    const mapping = await ingestMapping(pool, owner, sourceId);
    if (!mapping)
        fail(409, 'Map this source for Alertmanager first.');
    if (!body || typeof body !== 'object' || !Array.isArray(body.alerts))
        fail(400, 'An Alertmanager webhook body with alerts is required.');
    if (body.alerts.length > MAX_ALERTS)
        fail(413, 'At most ' + MAX_ALERTS + ' alerts per delivery.');
    const beats = body.alerts.filter(isHeartbeat), delivered = body.alerts.filter(a => !isHeartbeat(a)), results = [];
    // Decided before anything is admitted: a resolve from a Prometheus that stopped evaluating says nothing about the site.
    const row = await (0, installations_1.installationRow)(pool, owner, sourceId), at = clock();
    const held = delivered.filter(a => a?.status === 'resolved' && row?.alerts?.[a?.fingerprint] && (0, installations_1.recoveryDoubted)(row, at, a)), alerts = delivered.filter(a => !held.includes(a));
    for (const alert of alerts) {
        try {
            const r = await (0, intake_1.admit)(pool, owner, source, alertEvent(mapping, alert), { sameOccurrence: true });
            results.push({ status: r.status, id: r.record?.id || null, decision: r.record?.decision || null, retry: r.retry === true });
        }
        catch (error) {
            results.push({ status: error.status || 500, error: String(error.message || error).slice(0, 200) });
        }
    }
    await (0, installations_1.noteAlerts)(pool, owner, source, mapping, alerts, results, clock);
    if (held.length)
        await (0, installations_1.holdResolves)(pool, owner, source, held, clock);
    let heartbeat = null;
    for (const beat of beats) {
        heartbeat = await (0, installations_1.recordBeat)(pool, owner, source, mapping, beat, clock);
        // A resolve that fails stays owed in the installation's row; the next tick retries it, so the beat itself still succeeded.
        if (heartbeat.owed?.length)
            try {
                await settleResolves(pool, owner, source, mapping, heartbeat.owed);
                heartbeat.owed = [];
            }
            catch (error) {
                heartbeat.resolveError = String(error.message || error).slice(0, 200);
            }
    }
    return { sourceId, received: body.alerts.length, admitted: results.filter(r => r.decision === 'validated' && !r.retry).length, quarantined: results.filter(r => r.decision === 'quarantined').length, results, ...(held.length ? { heldResolves: held.length } : {}), ...(heartbeat ? { heartbeat } : {}), executionAuthorized: false };
}
const isHeartbeat = alert => alert?.labels?.alertname === installations_1.HEARTBEAT;
const silenceFingerprint = (source, record) => 'silent' + (0, intake_1.hash)(['installation-silence', source.id, record.lastHeardAt]).slice(0, 32);
/** The alert Operations raises for an installation that stopped reporting, in Alertmanager's shape so the one mapping serves it. It starts at the last heartbeat, so its evidence window holds the readings before the silence. */
function silenceAlert(mapping, fingerprint, since, status, now, source, resourceId) {
    const minutes = Math.round((now - Date.parse(since)) / 60000);
    return { status, fingerprint, startsAt: since, ...(status === 'resolved' ? { endsAt: new Date(now).toISOString() } : {}), labels: { alertname: installations_1.SILENT, [mapping.severityLabel]: 'critical', [mapping.idLabel]: resourceId || mapping.scope }, annotations: { summary: source.name + ' has stopped reporting', description: 'Operations has not received this installation\'s heartbeat for ' + minutes + ' minutes. The server, its monitoring or the path to this Operations is down.' } };
}
/** Admit each resolve this installation owes, timed by its stored end so a retry is the same event, and clear it only once admitted. */
async function settleResolves(pool, owner, source, mapping, owed) {
    for (const o of owed) {
        await (0, intake_1.admit)(pool, owner, source, alertEvent(mapping, silenceAlert(mapping, o.fingerprint, o.since, 'resolved', Date.parse(o.endedAt), source, o.resourceId)), { sameOccurrence: true });
        await (0, installations_1.settleResolve)(pool, owner, source, o.fingerprint);
    }
}
/** Admit one cleared alert's resolve, then drop it from the card. */
async function admitCleared(pool, owner, source, mapping, { fingerprint, seenAt, alert }) { await (0, intake_1.admit)(pool, owner, source, alertEvent(mapping, alert), { sameOccurrence: true }); await (0, installations_1.settleCleared)(pool, owner, source, fingerprint, seenAt); }
/** @description The processing tick's watch over every installation that has reported: raise InstallationSilent for each that went quiet, retrying until its event is on record, settle any resolve still owed, clear what Prometheus no longer lists, and hand back what the attention rail owes the person. Nothing new is called silent during the grace after a gap in the schedule itself: this Spark was not listening then. One source's failure is reported and does not stop the others. @param pool Owner-scoped SQL. @param owner The activating person. @param sources Saved source revisions. @param clock Milliseconds now. @returns The installations silenced in this pass, the pending notices with their source, the grace, and any failures. */
async function watchInstallations(pool, owner, sources, clock = Date.now) {
    ownerRequired(owner);
    const now = clock(), graceUntil = await (0, installations_1.watchClock)(pool, owner, now), silenced = [], notices = [], errors = [];
    for (const source of sources) {
        const failed = error => errors.push(source.name + ': ' + String(error.message || error).slice(0, 200));
        try {
            const mapping = await ingestMapping(pool, owner, source.id);
            if (!mapping)
                continue;
            if (now >= graceUntil)
                try {
                    const record = await (0, installations_1.claimSilence)(pool, owner, source, now, silenceFingerprint);
                    if (record) {
                        const raised = await (0, intake_1.admit)(pool, owner, source, alertEvent(mapping, silenceAlert(mapping, record.silenceFingerprint, record.silentSince, 'firing', now, source, record.resourceId)), { sameOccurrence: true });
                        await (0, installations_1.settleSilence)(pool, owner, source, raised.record?.id || null);
                        await (0, installations_1.scanSilence)(pool, owner, source, record, now);
                        silenced.push(source.name);
                    }
                }
                catch (error) {
                    failed(error);
                }
            const row = await (0, installations_1.installationRow)(pool, owner, source.id);
            // The notice never waits on the event: the person is told even while the store refuses the alarm.
            for (const notice of (0, installations_1.pendingNotices)(row, now))
                notices.push({ sourceId: source.id, ...notice });
            if (row?.owedResolves?.length)
                await settleResolves(pool, owner, source, mapping, row.owedResolves);
            for (const cleared of await (0, installations_1.clearedAlerts)(pool, owner, source, mapping, row, now))
                await admitCleared(pool, owner, source, mapping, cleared);
        }
        catch (error) {
            failed(error);
        }
    }
    return { silenced, notices, graceUntil: now < graceUntil ? new Date(graceUntil).toISOString() : null, ...(errors.length ? { errors } : {}) };
}
/** @description Stop watching a retired installation. One still reporting is refused: its next report would bring back a card with nothing firing on it. What it owes is resolved first, so a failure leaves everything in place for a second press and no symptom stands forever. */
async function stopWatching(pool, owner, sources, sourceId, clock = Date.now) {
    ownerRequired(owner);
    const source = sources.find(s => s.id === sourceId);
    if (!source)
        fail(404, 'No such source in your scope.');
    const mapping = await ingestMapping(pool, owner, sourceId), held = await (0, installations_1.installationRow)(pool, owner, sourceId);
    if (held && !['silent', 'never'].includes((0, installations_1.installationState)(held, clock())))
        fail(409, source.name + ' is still reporting, so there is nothing to stop. Stop its monitoring first; this offer comes back once it has been silent for 10 minutes.');
    if (mapping && held) {
        for (const closed of (0, installations_1.retiringAlerts)(mapping, held, clock()))
            await admitCleared(pool, owner, source, mapping, closed);
        if (held.owedResolves?.length)
            await settleResolves(pool, owner, source, mapping, held.owedResolves);
        if (held.state === 'silent')
            await (0, intake_1.admit)(pool, owner, source, alertEvent(mapping, silenceAlert(mapping, held.silenceFingerprint, held.silentSince, 'resolved', clock(), source, held.resourceId)), { sameOccurrence: true });
    }
    // The scans are filed by source URI and scope, so a second revision of this source reporting on the same scope keeps them.
    let shared = false;
    for (const other of sources)
        if (other.id !== sourceId && other.source === source.source && (await (0, installations_1.installationRow)(pool, owner, other.id))?.scope === mapping?.scope)
            shared = true;
    return { forgotten: Boolean(await (0, installations_1.forgetInstallation)(pool, owner, source, shared ? null : mapping?.scope || null)), sourceId };
}
