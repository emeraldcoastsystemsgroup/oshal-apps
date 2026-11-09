"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIRM_MS = exports.GAP_MS = exports.SILENT_MS = exports.LATE_MS = exports.SILENT = exports.HEARTBEAT = void 0;
exports.readingsOf = readingsOf;
exports.thresholdsOf = thresholdsOf;
exports.assess = assess;
exports.installationScan = installationScan;
exports.recordBeat = recordBeat;
exports.recoveryDoubted = recoveryDoubted;
exports.noteAlerts = noteAlerts;
exports.holdResolves = holdResolves;
exports.clearedAlerts = clearedAlerts;
exports.retiringAlerts = retiringAlerts;
exports.settleCleared = settleCleared;
exports.watchClock = watchClock;
exports.claimSilence = claimSilence;
exports.settleSilence = settleSilence;
exports.settleResolve = settleResolve;
exports.scanSilence = scanSilence;
exports.phoneMark = phoneMark;
exports.installationRow = installationRow;
exports.pendingNotices = pendingNotices;
exports.clearNotices = clearNotices;
exports.forgetInstallation = forgetInstallation;
exports.installationState = installationState;
exports.watchStatus = watchStatus;
exports.installationStanding = installationStanding;
exports.installationRecords = installationRecords;
/** CHANGE LOG: 7 | maintainer@emeraldcoastsystemsgroup.com | installationStanding leaves out the installations of sources the person removed (sources.ts removeSource, P5-55b): the attention and systems summaries read every installation row rather than the saved sources, so a removed source still showed as stopped reporting to Jarvis and on the attention list. Its rows and history stay in place. */
/** CHANGE LOG: 6 | maintainer@emeraldcoastsystemsgroup.com | A heartbeat may carry the probe's threshold file (annotations thresholds, a JSON object of at most 4 KiB, and thresholds_file, its path on the host): the row keeps the last snapshot with when it was reported, and the desk's Settings shows it read-only. The package reads no host file; a beat without the annotation keeps the earlier snapshot. */
/** CHANGE LOG: 5 | maintainer@emeraldcoastsystemsgroup.com | What a fifth review proved (2026-11-04). A list that is present but blank means Prometheus has not settled or cannot store, because a settled one always lists its own heartbeat, so it holds; only a beat with no list at all falls back. An item the list cannot carry makes the whole list unjudgeable rather than a false all-clear. Prometheus must be seen moving: its uptime has to change on this side, so a heartbeat Alertmanager repeats after Prometheus died cannot clear anything. An alert on a row not reporting is not called clearing, so attention still counts it. */
/** CHANGE LOG: 4 | maintainer@emeraldcoastsystemsgroup.com | What a fourth review proved on the real stack (2026-11-04). Whether an alert has cleared no longer rests on clocks or on Alertmanager's word. The heartbeat now carries what Prometheus has firing or pending and how long Prometheus has been up, so a resolve is believed only from a Prometheus that has settled, reads every exporter and no longer lists the alert. That covers a quick restart, a dead exporter and a droplet with a wrong clock. The same list clears what Alertmanager never resolved, such as after a reboot: an alert unlisted for 3 minutes is cleared by the watch, instead of standing for 9 hours. A blank backup reading is unknown, not a problem, while the node exporter is unread or Prometheus has only just started. */
/** CHANGE LOG: 3 | maintainer@emeraldcoastsystemsgroup.com | What a third review proved on the real stack (2026-11-04). When Prometheus dies Alertmanager times out everything it was firing and delivers it as resolved, so the phone said cleared with the site still down and the silent card lost what was firing: a resolve from a Prometheus no longer evaluating is held on the card and admitted only once Prometheus has been back long enough to fire it again (recoveryDoubted, heartbeats now carry evaluated_at). A silence notice is pending only while the row is silent, and its age is worked out when it is sent, so a row left over from 1.1.6 cannot call a healthy droplet silent and four hours of rail outage does not say ten minutes. A resolve for a row that does not exist makes no empty card. */
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | What an independent review proved (2026-11-03). A silence is owed until its event is on record: the claim commits, then the raise is retried each tick until admit succeeds, and a recovery owes its resolve the same way, timed one millisecond before the beat that ended the silence so a second silence right after is a new occurrence. A silent card lists InstallationSilent with its delivery and keeps what was firing, because a dead droplet cannot repeat anything. A silence notice waits for the rail until the installation recovers. Stopping the watch and the history's retention delete by key range, so nothing older is left behind, and scans are deleted by source, so two sources on one scope leave each other alone. Scans come every 10 minutes, under the 15-minute staleness both Topology and correlation use, and are kept two days. Checks: the droplet's own scrape targets are a row, a blind core check keeps the health from saying healthy, a server with no heartbeat claims nothing, off-site is 'not reported here' where this droplet does not hold the copy, and other pending updates are counted. installationStanding gives Jarvis the same facts. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | A monitored installation's proof of life (Roger, 2026-11-03: "i dont see any proof that the dev droplet is being monitored"). An alert only speaks when something is wrong, so a quiet Operations could not tell a healthy droplet from a dead one. The droplet's InstallationHeartbeat alert arrives every minute through the producer door; it is never admitted as an event: its time and readings land here, with 15-minute history for the charts and the report, the readings in the source's telemetry banks for evidence packets, and the droplet with its containers in the topology for Systems. */
// @ts-nocheck
const pipeline_1 = require("./pipeline");
const telemetry_store_1 = require("./telemetry-store");
const topology_store_1 = require("./topology-store");
exports.HEARTBEAT = 'InstallationHeartbeat', exports.SILENT = 'InstallationSilent';
/** Late on screen after 3 minutes; silent after 10, so a Spark restart or a dropped delivery never pages anyone. */
exports.LATE_MS = 180000, exports.SILENT_MS = 600000, exports.GAP_MS = 300000;
/** For a heartbeat that does not carry what Prometheus is firing: a held resolve waits this long after reports resume, the longest critical `for` (10 minutes) plus Alertmanager's 5-minute group, with room to spare. */
exports.CONFIRM_MS = 1200000;
/** Prometheus has evaluated every rule group by then. An alert must also stay unlisted this long before the watch clears it, because a heartbeat can be about 90 s older than an alert that fires with no `for`. */
const SETTLED_S = 120, UNLISTED_MS = 180000;
/** A live Prometheus refreshes its heartbeat's readings about every 90 s and Alertmanager delivers them within a minute, so this is what a dead one looks like, and it is under UNLISTED_MS on purpose. */
const UPTIME_STALE_MS = 170000;
/** A dead one of these leaves alerts unable to say anything; a dead kernel is itself the fault being watched. */
const BLINDING = ['site', 'postgres', 'node'];
const SCAN_MS = 600000, SCAN_KEEP_MS = 2 * 86400000, STALE_ALERT_MS = 9 * 3600000, BUCKET_MS = 900000, KEEP_DAYS = 14, MAX_ALERTS = 64, MAX_NOTICES = 8, MAX_OWED = 4, NOTICE_MS = 3600000;
/** A blind one of these keeps the overall health from saying healthy. Off-site and updates have their own meaning when absent; a missing backup is already a problem. */
const CORE = ['site', 'kernel', 'postgres', 'containers', 'disk', 'memory'];
const NUMBERS = ['site_up', 'site_seconds', 'kernel_up', 'postgres_up', 'pg_connections', 'pg_bytes', 'restarts', 'disk_used', 'memory_used', 'cpu_used', 'load5', 'cpus', 'boot_seconds', 'http_rate', 'http_errors', 'backup_age_hours', 'backup_bytes', 'offsite_age_hours', 'offsite_bytes', 'reboot_required', 'security_updates', 'updates_pending', 'facts_age_seconds', 'prom_uptime'];
/** What the charts and the report read; containers_running is derived from the containers reading. */
const CHARTED = ['site_seconds', 'site_up', 'disk_used', 'memory_used', 'cpu_used', 'load5', 'pg_connections', 'http_rate', 'http_errors', 'containers_running'];
/** At most 13 a minute keeps a 15-minute evidence window inside its 200 observations; these are the eight an investigation reads. A packet seals them as one series per reading (telemetry-store.ts), so a full window costs a few KB of its 64 KiB. */
const STREAMED = { site_up: ['site.up', '1'], site_seconds: ['site.response', 's'], disk_used: ['host.disk.used', '%'], memory_used: ['host.memory.used', '%'], cpu_used: ['host.cpu.used', '%'], load5: ['host.load.5m', '1'], pg_connections: ['postgres.connections', '1'], containers_running: ['host.containers.running', '1'] };
const WATCH = 'installation-watch';
const stateKey = sourceId => 'installation:' + sourceId;
const dayKey = (sourceId, day) => 'installation-day:' + sourceId + ':' + day;
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const ownerRequired = owner => { if (typeof owner !== 'string' || !owner)
    fail(401, 'A verified caller is required.'); };
const bounded = (value, max) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const round = value => Math.round(value * 1000) / 1000;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
async function held(c, owner, id) { return (await c.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, id])).rows[0]?.record || null; }
async function put(c, owner, id, exists, record) {
    if (exists)
        await c.query('UPDATE operations_processing_config SET record=$3 WHERE user_sub=$1 AND id=$2', [owner, id, JSON.stringify(record)]);
    else
        await c.query('INSERT INTO operations_processing_config(user_sub,id,revision,record) VALUES($1,$2,1,$3)', [owner, id, JSON.stringify(record)]);
}
function pairs(raw, max = 32) {
    const out = {};
    if (typeof raw !== 'string')
        return out;
    for (const item of raw.trim().split(/\s+/).slice(0, max)) {
        const m = /^([A-Za-z0-9._-]{1,64})=([01])$/.exec(item);
        if (m && !FORBIDDEN.has(m[1]))
            out[m[1]] = Number(m[2]);
    }
    return out;
}
/** What the heartbeat says Prometheus lists: null when the beat has no such annotation (an older rule file), and empty when it is blank or holds an item it cannot carry, which can only be judged by holding. */
function alertList(raw) {
    if (typeof raw !== 'string')
        return null;
    const items = raw.trim().split(/\s+/).filter(Boolean);
    return items.length > MAX_ALERTS || items.some(item => !/^[A-Za-z0-9._-]{1,64}=[01]$/.test(item)) ? {} : pairs(raw, MAX_ALERTS);
}
function origin(raw) { try {
    const url = new URL(String(raw));
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : null;
}
catch {
    return null;
} }
/** @description The heartbeat's annotations as bounded readings: known keys only, finite numbers only, a missing or malformed value simply absent, so a check says "not reported" and never invents one. @param annotations The alert's annotations, producer-supplied. @returns Numbers, containers, targets, the host name and the public origin. */
function readingsOf(annotations) {
    const a = annotations && typeof annotations === 'object' && !Array.isArray(annotations) ? annotations : {}, values = {};
    for (const key of NUMBERS) {
        const raw = a[key];
        if (typeof raw !== 'string' || !raw.trim())
            continue;
        const n = Number(raw.trim());
        if (Number.isFinite(n))
            values[key] = n;
    }
    const containers = pairs(a.containers);
    if (Object.keys(containers).length)
        values.containers_running = Object.values(containers).filter(v => v === 1).length;
    return { values, containers, targets: pairs(a.targets), alerts: alertList(a.alerts), host: bounded(a.host, 128), url: origin(a.site_url) };
}
const THRESHOLDS_MAX = 4096;
/** @description The probe's threshold file as one heartbeat reported it: the thresholds annotation parsed as a JSON object (at most 4 KiB, scalars and one level of objects, no hostile keys) and thresholds_file as the path it was read from. Anything else is null: the package never reads a host file and never invents a threshold. @param annotations The alert's annotations. @param at When the beat arrived. @returns {reportedAt,file,body} or null. */
function thresholdsOf(annotations, at) {
    const a = annotations && typeof annotations === 'object' && !Array.isArray(annotations) ? annotations : {}, raw = a.thresholds;
    if (typeof raw !== 'string' || !raw.trim() || Buffer.byteLength(raw) > THRESHOLDS_MAX)
        return null;
    let body;
    try {
        body = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
        return null;
    const plain = (value, depth) => { if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
        return typeof value === 'string' ? value.slice(0, 256) : value; if (Array.isArray(value))
        return depth ? value.slice(0, 32).map(v => plain(v, depth - 1)) : null; if (!depth || typeof value !== 'object')
        return null; const out = {}; for (const [k, v] of Object.entries(value).slice(0, 64)) {
        if (FORBIDDEN.has(k) || k.length > 64)
            continue;
        const kept = plain(v, depth - 1);
        if (kept !== undefined)
            out[k] = kept;
    } return out; };
    return { reportedAt: at, file: bounded(a.thresholds_file, 256), body: plain(body, 3) };
}
const pct = v => Math.round(v) + '%';
const hours = h => h < 48 ? Math.round(h) + ' h' : Math.round(h / 24) + ' d';
const size = b => b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? Math.round(b / 1e6) + ' MB' : Math.round(b / 1e3) + ' KB';
/** @description One line per check, with the thresholds of the droplet's rules/installation.yml, so the card and the alerts disagree only while an alert's "for" time runs. @param readings readingsOf's result. @returns The overall health and the checks in reading order. */
function assess(readings) {
    const v = readings?.values || {}, c = readings?.containers || {}, checks = [];
    const known = k => Number.isFinite(v[k]);
    const add = (id, label, state, reading) => checks.push({ id, label, state, reading });
    add('site', 'Public site', !known('site_up') ? 'unknown' : v.site_up < 1 ? 'bad' : known('site_seconds') && v.site_seconds > 3 ? 'warn' : 'ok', !known('site_up') ? 'Not reported' : v.site_up < 1 ? 'Does not answer' : 'Answers' + (known('site_seconds') ? ' in ' + v.site_seconds.toFixed(2) + ' s' : ''));
    add('kernel', 'Kernel', !known('kernel_up') ? 'unknown' : v.kernel_up < 1 ? 'bad' : 'ok', !known('kernel_up') ? 'Not reported' : v.kernel_up < 1 ? 'Its metrics do not answer' : 'Its metrics answer' + (known('http_rate') ? ', ' + v.http_rate.toFixed(1) + ' requests a second' : ''));
    add('postgres', 'Postgres', !known('postgres_up') ? 'unknown' : v.postgres_up < 1 ? 'bad' : 'ok', !known('postgres_up') ? 'Not reported' : v.postgres_up < 1 ? 'Does not answer' : 'Answers' + (known('pg_connections') ? ', ' + Math.round(v.pg_connections) + ' connections' : '') + (known('pg_bytes') ? ', ' + size(v.pg_bytes) : ''));
    const names = Object.keys(c), stopped = names.filter(n => c[n] !== 1), stale = known('facts_age_seconds') && v.facts_age_seconds > 600;
    add('containers', 'Containers', !names.length ? 'unknown' : stopped.length ? 'bad' : stale ? 'warn' : 'ok', !names.length ? 'Not reported' : (stopped.length ? stopped.join(', ') + ' not running; ' : '') + (names.length - stopped.length) + ' of ' + names.length + ' running' + (stopped.length ? '' : ': ' + names.join(', ')) + (stale ? '; these facts are ' + Math.round(v.facts_age_seconds / 60) + ' min old' : ''));
    add('disk', 'Disk', !known('disk_used') ? 'unknown' : v.disk_used > 90 ? 'bad' : v.disk_used > 80 ? 'warn' : 'ok', known('disk_used') ? pct(v.disk_used) + ' used' : 'Not reported');
    add('memory', 'Memory', !known('memory_used') ? 'unknown' : v.memory_used > 95 ? 'bad' : 'ok', known('memory_used') ? pct(v.memory_used) + ' used' : 'Not reported');
    add('processor', 'Processor', !known('load5') && !known('cpu_used') ? 'unknown' : known('load5') && known('cpus') && v.load5 > 2 * v.cpus ? 'warn' : 'ok', !known('load5') && !known('cpu_used') ? 'Not reported' : [known('cpu_used') ? pct(v.cpu_used) + ' busy' : null, known('load5') ? 'load ' + v.load5.toFixed(2) + (known('cpus') ? ' on ' + Math.round(v.cpus) + ' CPUs' : '') : null].filter(Boolean).join(', '));
    const backupBlind = readings?.targets?.node === 0 || (known('prom_uptime') && v.prom_uptime < SETTLED_S);
    add('backup', 'Nightly backup', !known('backup_age_hours') ? (backupBlind ? 'unknown' : 'bad') : v.backup_age_hours > 26 || known('backup_bytes') && v.backup_bytes < 1048576 ? 'bad' : 'ok', !known('backup_age_hours') ? (backupBlind ? 'Not reported' : 'None reported') : 'Finished ' + hours(v.backup_age_hours) + ' ago' + (known('backup_bytes') ? ', ' + size(v.backup_bytes) : ''));
    add('offsite', 'Off-site copy', !known('offsite_age_hours') ? 'unknown' : v.offsite_age_hours > 26 ? 'bad' : 'ok', !known('offsite_age_hours') ? 'Not reported here' : 'Arrived ' + hours(v.offsite_age_hours) + ' ago' + (known('offsite_bytes') ? ', ' + size(v.offsite_bytes) : ''));
    const waiting = [known('reboot_required') && v.reboot_required > 0 ? 'a restart is waiting' : null, known('security_updates') && v.security_updates > 0 ? Math.round(v.security_updates) + ' security updates' : null].filter(Boolean);
    const other = known('updates_pending') ? v.updates_pending - (known('security_updates') ? v.security_updates : 0) : 0;
    add('updates', 'Updates and restarts', !known('reboot_required') && !known('updates_pending') ? 'unknown' : waiting.length ? 'warn' : 'ok', !known('reboot_required') && !known('updates_pending') ? 'Not reported' : [...waiting, other > 0 ? Math.round(other) + ' other updates waiting' : null].filter(Boolean).join(', ') || 'Nothing waiting');
    const targets = readings?.targets || {}, jobs = Object.keys(targets), blind = jobs.filter(job => targets[job] !== 1);
    add('monitoring', 'Its own monitoring', !jobs.length ? 'unknown' : blind.length ? 'bad' : 'ok', !jobs.length ? 'Not reported' : blind.length ? 'Cannot read ' + blind.join(', ') + ': those checks are blind' : 'Reads all ' + jobs.length + ' of its sources');
    return { health: checks.some(x => x.state === 'bad') ? 'degraded' : checks.every(x => x.state === 'unknown') || checks.some(x => x.state === 'unknown' && CORE.includes(x.id)) ? 'unknown' : 'healthy', checks };
}
function addToHistory(row, now, values) {
    const date = new Date(now), minute = Math.floor((date.getUTCHours() * 60 + date.getUTCMinutes()) / 15) * 15, bucket = row.buckets[minute] || (row.buckets[minute] = { n: 0, m: {} });
    bucket.n++;
    for (const name of CHARTED) {
        const v = values[name];
        if (!Number.isFinite(v))
            continue;
        const s = bucket.m[name];
        if (s) {
            s[0] = Math.min(s[0], round(v));
            s[1] = Math.max(s[1], round(v));
            s[2] = round(s[2] + v);
            s[3]++;
        }
        else
            bucket.m[name] = [round(v), round(v), round(v), 1];
    }
}
async function recordHistory(c, owner, sourceId, now, values) {
    const day = dayOf(now), id = dayKey(sourceId, day), row = await held(c, owner, id), next = row || { sourceId, day, buckets: {} };
    addToHistory(next, now, values);
    await put(c, owner, id, Boolean(row), next);
    if (!row)
        await c.query('DELETE FROM operations_processing_config WHERE user_sub=$1 AND id LIKE $2 AND id<$3', [owner, dayKey(sourceId, '%'), dayKey(sourceId, dayOf(now - KEEP_DAYS * 86400000))]);
}
function signature(record, health) { const c = record.readings?.containers || {}; return [health, ...Object.keys(c).sort().map(n => n + '=' + c[n])].join(' '); }
/** @description The droplet and its containers as one complete topology scan: Systems shows them, alerts naming this host attach to it, and an evidence packet's inventory facts find it. */
function installationScan(source, record, health, at) {
    const scope = record.scope, host = { provider: 'import', scope, kind: 'host', nativeId: record.resourceId }, r = record.readings || {};
    const properties = Object.fromEntries(Object.entries({ hostName: r.host, publicAddress: r.url, monitoredBy: 'InstallationHeartbeat' }).filter(([, v]) => v));
    const assets = [{ ...host, name: source.name, health, properties }], relationships = [];
    for (const [name, running] of Object.entries(r.containers || {})) {
        const c = { provider: 'import', scope, kind: 'container', nativeId: record.resourceId + '/' + name };
        assets.push({ ...c, name, health: health === 'unknown' ? 'unknown' : running === 1 ? 'healthy' : 'degraded', properties: { running: running === 1 } });
        relationships.push({ type: 'RUNS_ON', from: c, to: host, evidence: "Reported by this installation's heartbeat." });
    }
    return { scanId: 'installation-' + at.replace(/[^0-9]/g, ''), collectionId: 'installation:' + scope, observedAt: at, complete: true, failures: [], assets, relationships };
}
async function saveInstallationScan(pool, owner, source, record, health, now) {
    const at = new Date(now).toISOString(), collection = 'installation:' + record.scope;
    await (0, topology_store_1.saveScan)(pool, owner, source, installationScan(source, record, health, at));
    await pool.query('DELETE FROM operations_topology_scans WHERE user_sub=$1 AND source_uri=$2 AND collection_id=$3 AND observed_at<$4', [owner, source.source, collection, new Date(now - SCAN_KEEP_MS).toISOString()]);
    await (0, pipeline_1.processingTransaction)(pool, async (c) => { const row = await held(c, owner, stateKey(source.id)); if (row)
        await put(c, owner, stateKey(source.id), true, { ...row, lastScanAt: at, lastScanSignature: signature(record, health) }); });
}
/** The beat's readings as OTLP gauges through the same ingest as any telemetry source; the stream is configured once, on the first beat. */
async function feedTelemetry(pool, owner, source, mapping, resourceId, readings, now) {
    const state = (await pool.query('SELECT record FROM operations_streams WHERE user_sub=$1 AND id=$2', [owner, source.id])).rows[0]?.record;
    const config = state?.config || (await (0, telemetry_store_1.configureStream)(pool, owner, source, { resourceKind: mapping.resourceKind, idAttribute: 'host.id', scopeAttribute: 'site.id' }, 0)).config;
    if (config.resourceKind !== mapping.resourceKind)
        return 'This source is mapped for another kind of resource; its readings stay out of the telemetry banks.';
    const metrics = Object.entries(STREAMED).filter(([key]) => Number.isFinite(readings.values[key])).map(([key, [name, unit]]) => ({ name, unit, gauge: { dataPoints: [{ timeUnixNano: String(BigInt(now) * 1000000n), asDouble: readings.values[key] }] } }));
    if (!metrics.length)
        return null;
    await (0, telemetry_store_1.ingestTelemetry)(pool, owner, source, 'otlp-metrics', { resourceMetrics: [{ resource: { attributes: [{ key: config.idAttribute, value: { stringValue: resourceId } }, { key: config.scopeAttribute, value: { stringValue: mapping.scope } }] }, scopeMetrics: [{ metrics }] }] }, () => new Date(now).toISOString());
    return null;
}
/** @description One heartbeat. The time and readings commit first; the telemetry feed and the topology scan follow and only note a failure, because a full bank must never make a live droplet look dead. @param pool Owner-scoped SQL. @param owner The token's owner. @param source Saved source revision. @param mapping Its Alertmanager mapping. @param alert The InstallationHeartbeat alert. @param clock Milliseconds now. @returns What changed: a silence this beat ended, and any feed failure. */
async function recordBeat(pool, owner, source, mapping, alert, clock = Date.now) {
    ownerRequired(owner);
    const now = clock(), at = new Date(now).toISOString(), id = stateKey(source.id);
    if (alert?.status === 'resolved') {
        await (0, pipeline_1.processingTransaction)(pool, async (c) => { const row = await held(c, owner, id); if (row)
            await put(c, owner, id, true, { ...row, heartbeatEndedAt: at }); });
        return { recorded: false, reason: "This installation's Prometheus stopped sending its heartbeat; its Alertmanager said so." };
    }
    const label = alert?.labels?.[mapping.idLabel], resourceId = typeof label === 'string' && label ? label : mapping.scope, readings = readingsOf(alert?.annotations), { health } = assess(readings);
    const { record, silence } = await (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const previous = await held(c, owner, id), resumed = previous?.lastHeardAt && (previous.state === 'silent' || previous.heartbeatEndedAt || now - Date.parse(previous.lastHeardAt) >= exports.LATE_MS), silence = previous?.state === 'silent' ? { fingerprint: previous.silenceFingerprint, since: previous.silentSince, resourceId: previous.resourceId, minutes: Math.max(1, Math.round((now - Date.parse(previous.silentSince)) / 60000)), endedAt: new Date(now - 1).toISOString() } : null;
        const notices = [...(previous?.notices || []).filter(n => !(silence && String(n.id).startsWith('silent-'))), ...(silence ? [{ id: 'recovered-' + at, at, text: source.name + ' is reporting again after ' + silence.minutes + ' minutes of silence.' }] : [])].slice(-MAX_NOTICES);
        const owedResolves = [...(previous?.owedResolves || []), ...(silence ? [{ fingerprint: silence.fingerprint, since: silence.since, resourceId: silence.resourceId, endedAt: silence.endedAt }] : [])].slice(-MAX_OWED);
        const record = { sourceId: source.id, name: source.name, scope: mapping.scope, resourceId, firstHeardAt: previous?.firstHeardAt || at, lastHeardAt: at, beats: (previous?.beats || 0) + 1, state: 'reporting', silentSince: null, silenceFingerprint: null, alarmOwed: false, silenceDeliveryId: null, heartbeatEndedAt: null, resumedAt: resumed ? at : previous?.resumedAt || null, uptimeMovedAt: readings.values.prom_uptime !== previous?.readings?.values?.prom_uptime ? at : previous?.uptimeMovedAt || at, readings, health, alerts: previous?.alerts || {}, notices, owedResolves, lastScanAt: previous?.lastScanAt || null, lastScanSignature: previous?.lastScanSignature || null, feedError: previous?.feedError || null, thresholds: thresholdsOf(alert?.annotations, at) || previous?.thresholds || null };
        await put(c, owner, id, Boolean(previous), record);
        await recordHistory(c, owner, source.id, now, readings.values);
        return { record, silence };
    });
    let feedError = null;
    try {
        feedError = await feedTelemetry(pool, owner, source, mapping, resourceId, readings, now);
    }
    catch (error) {
        feedError = String(error.message || error).slice(0, 240);
    }
    const scanDue = !record.lastScanAt || now - Date.parse(record.lastScanAt) >= SCAN_MS || record.lastScanSignature !== signature(record, health);
    if (scanDue)
        try {
            await saveInstallationScan(pool, owner, source, record, health, now);
        }
        catch (error) {
            feedError = feedError || String(error.message || error).slice(0, 240);
        }
    if (feedError !== record.feedError)
        await (0, pipeline_1.processingTransaction)(pool, async (c) => { const row = await held(c, owner, id); if (row)
            await put(c, owner, id, true, { ...row, feedError }); });
    return { recorded: true, health, beats: record.beats, silence, owed: record.owedResolves, ...(feedError ? { feedError } : {}) };
}
const listedNow = row => row?.readings?.alerts || null;
const alertKey = (name, service) => name + (service ? '.' + service : '');
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
/** Prometheus can be believed: reports are arriving and it is seen moving, it has been up long enough to have evaluated every rule, it lists at least its own heartbeat, and every exporter answers. */
function promLooking(row, now) {
    const targets = row?.readings?.targets || {}, uptime = row?.readings?.values?.prom_uptime;
    return Object.keys(row?.readings?.alerts || {}).length > 0 && now - Date.parse(row?.uptimeMovedAt) < UPTIME_STALE_MS && Number.isFinite(uptime) && uptime >= SETTLED_S && !BLINDING.some(job => targets[job] === 0) && row.state !== 'silent' && !row.heartbeatEndedAt && now - Date.parse(row.lastHeardAt) < exports.LATE_MS;
}
/** @description Whether a resolve delivered now can be believed. When Prometheus dies or restarts Alertmanager times out its alerts about 4 minutes later and delivers them as resolved, whatever the site is doing, and past that an exporter that stays dead ends what it held. So a heartbeat carrying what Prometheus has firing or pending decides: the alert must be off that list, from a Prometheus that is settled and reads every exporter. A heartbeat without the list can only say Prometheus stopped; a row with no heartbeat has nothing to doubt with. @param row The installation's row. @param now Milliseconds now. @param alert The delivered resolve. @returns True when the resolve must wait. */
function recoveryDoubted(row, now, alert) {
    if (!row?.lastHeardAt)
        return false;
    const listed = listedNow(row);
    if (listed)
        return !promLooking(row, now) || has(listed, alertKey(alert?.labels?.alertname, alert?.labels?.service));
    return row.state === 'silent' || Boolean(row.heartbeatEndedAt) || now - Date.parse(row.lastHeardAt) >= exports.LATE_MS;
}
/** @description Keep what is firing on this installation from the alerts just delivered: a repeat refreshes it, a resolve removes it, and an alert no repeat refreshed for 9 hours (the repeat is every 4) falls off when read. A resolve for a row that does not exist makes no card: stop watching had removed it and the server has nothing to say. @param alerts The delivered non-heartbeat alerts. @param results Their intake results, index for index. */
async function noteAlerts(pool, owner, source, mapping, alerts, results, clock = Date.now) {
    ownerRequired(owner);
    if (!alerts.length)
        return;
    const at = new Date(clock()).toISOString(), id = stateKey(source.id);
    await (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const row = await held(c, owner, id);
        if (!row && alerts.every(a => a?.status === 'resolved'))
            return;
        const record = row || { sourceId: source.id, name: source.name, scope: mapping.scope, resourceId: null, firstHeardAt: null, lastHeardAt: null, beats: 0, state: 'never', readings: null, health: 'unknown', alerts: {}, notices: [] }, map = { ...record.alerts };
        alerts.forEach((alert, i) => {
            const fingerprint = typeof alert?.fingerprint === 'string' && /^[A-Za-z0-9]{1,64}$/.test(alert.fingerprint) ? alert.fingerprint : null;
            if (!fingerprint)
                return;
            if (alert.status === 'resolved') {
                delete map[fingerprint];
                return;
            }
            map[fingerprint] = { alertType: bounded(alert.labels?.alertname, 128) || 'UnnamedAlert', severity: bounded(alert.labels?.[mapping.severityLabel], 32) || 'warning', summary: bounded(alert.annotations?.summary, 512), description: bounded(alert.annotations?.description, 1024), service: bounded(alert.labels?.service, 128), startsAt: bounded(alert.startsAt, 64), lastSeenAt: at, deliveryId: results[i]?.id || map[fingerprint]?.deliveryId || null };
        });
        const kept = Object.entries(map).sort((a, b) => String(b[1].lastSeenAt).localeCompare(String(a[1].lastSeenAt))).slice(0, MAX_ALERTS);
        await put(c, owner, id, Boolean(row), { ...record, alerts: Object.fromEntries(kept) });
    });
}
/** @description Keep a doubted resolve on the card with what it would admit: the phone is not told, and the watch admits it once Prometheus has been back long enough (CONFIRM_MS). A firing delivery of the same alert replaces the entry, so a held resolve never outlives a re-fire. @param alerts The delivered resolves, each already on the row. */
async function holdResolves(pool, owner, source, alerts, clock = Date.now) {
    const at = new Date(clock()).toISOString(), id = stateKey(source.id);
    await (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const row = await held(c, owner, id);
        if (!row)
            return;
        const map = { ...row.alerts };
        for (const a of alerts)
            if (map[a.fingerprint])
                map[a.fingerprint] = { ...map[a.fingerprint], heldResolve: { at, status: 'resolved', fingerprint: a.fingerprint, startsAt: a.startsAt, endsAt: a.endsAt, labels: a.labels, annotations: a.annotations } };
        await put(c, owner, id, true, { ...row, alerts: map });
    });
}
/** One alert on the card as the resolve its event needs: the one delivered and held, else one in the same shape. */
function closingAlert(mapping, row, fingerprint, a, now) {
    return a.heldResolve || { status: 'resolved', fingerprint, startsAt: a.startsAt, endsAt: new Date(now).toISOString(), labels: { alertname: a.alertType, [mapping.severityLabel]: a.severity, [mapping.idLabel]: row.resourceId || mapping.scope, ...(a.service ? { service: a.service } : {}) }, annotations: { summary: a.summary || undefined, description: a.description || undefined } };
}
/** @description What the card holds that has really cleared, and the pass's note of what stopped being listed. Alertmanager can lose a resolve for good: it keeps alerts only in memory, and after a reboot nobody sends one. So what Prometheus lists decides, once it is settled and reads every exporter, and an alert must stay off the list for 3 minutes first. A firing delivery replaces the entry and its note. A heartbeat without the list falls back on time since reports resumed. @param mapping The source's mapping. @param row The installation's row. @param now Milliseconds now. @returns Each alert to admit as resolved, with what drops it from the card. */
async function clearedAlerts(pool, owner, source, mapping, row, now) {
    const entries = Object.entries(row?.alerts || {}), listed = listedNow(row);
    if (!entries.length)
        return [];
    const ready = (fingerprint, a) => ({ fingerprint, seenAt: a.lastSeenAt, alert: closingAlert(mapping, row, fingerprint, a, now) });
    if (!listed) {
        if (!row.lastHeardAt || row.state === 'silent' || row.heartbeatEndedAt || now - Date.parse(row.lastHeardAt) >= exports.LATE_MS)
            return [];
        const back = Date.parse(row.resumedAt) || 0;
        return entries.filter(([, a]) => a.heldResolve && now - Math.max(Date.parse(a.heldResolve.at), back) >= exports.CONFIRM_MS).map(([f, a]) => ready(f, a));
    }
    if (!promLooking(row, now))
        return [];
    const out = [], notes = {};
    for (const [fingerprint, a] of entries) {
        if (has(listed, alertKey(a.alertType, a.service))) {
            if (a.unlistedSince)
                notes[fingerprint] = null;
            continue;
        }
        if (!a.unlistedSince)
            notes[fingerprint] = new Date(now).toISOString();
        else if (now - Date.parse(a.unlistedSince) >= UNLISTED_MS)
            out.push(ready(fingerprint, a));
    }
    if (Object.keys(notes).length)
        await (0, pipeline_1.processingTransaction)(pool, async (c) => {
            const id = stateKey(source.id), held_ = await held(c, owner, id);
            if (!held_)
                return;
            const alerts = { ...held_.alerts };
            for (const [fingerprint, since] of Object.entries(notes))
                if (alerts[fingerprint]) {
                    const { unlistedSince, ...rest } = alerts[fingerprint];
                    alerts[fingerprint] = since ? { ...rest, unlistedSince: since } : rest;
                }
            await put(c, owner, id, true, { ...held_, alerts });
        });
    return out;
}
/** @description Every alert on a row being retired, closed so no symptom stands forever. The label keeps it off the phone: nothing cleared, the server was retired. */
function retiringAlerts(mapping, row, now) {
    return Object.entries(row?.alerts || {}).map(([fingerprint, a]) => { const alert = closingAlert(mapping, row, fingerprint, a, now); return { fingerprint, seenAt: a.lastSeenAt, alert: { ...alert, labels: { ...alert.labels, closed_by: 'stop-watching' } } }; });
}
/** @description A cleared alert's resolve is on record: drop it from the card, unless it fired again meanwhile. */
async function settleCleared(pool, owner, source, fingerprint, seenAt) {
    await (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const id = stateKey(source.id), row = await held(c, owner, id);
        if (!row?.alerts?.[fingerprint] || row.alerts[fingerprint].lastSeenAt !== seenAt)
            return;
        const { [fingerprint]: _, ...alerts } = row.alerts;
        await put(c, owner, id, true, { ...row, alerts });
    });
}
/** @description One watch pass's clock: a gap in the schedule means nothing was listening here, so no installation is blamed until a full silence period has passed since the watch came back. @returns When silence may next be called. */
async function watchClock(pool, owner, now) {
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const row = await held(c, owner, WATCH), gap = row?.lastTickAt ? now - Date.parse(row.lastTickAt) : 0, kept = Date.parse(row?.graceUntil) || 0, graceUntil = gap > exports.GAP_MS ? now + exports.SILENT_MS : kept;
        await put(c, owner, WATCH, Boolean(row), { lastTickAt: new Date(now).toISOString(), graceUntil: new Date(graceUntil).toISOString() });
        return graceUntil;
    });
}
const owedAlarm = (row, now) => Boolean(row?.lastHeardAt) && (row.state === 'silent' ? row.alarmOwed === true : now - Date.parse(row.lastHeardAt) >= exports.SILENT_MS);
/** @description Mark one installation silent once, and keep answering with it until its event is on record: the claim commits first so the card and the notice never depend on the event, and settleSilence ends the debt. Read outside a transaction first, so a tick that owes nothing writes nothing. @returns The record while its alarm is owed, else null. */
async function claimSilence(pool, owner, source, now, fingerprintOf) {
    if (!owedAlarm(await installationRow(pool, owner, source.id), now))
        return null;
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const id = stateKey(source.id), row = await held(c, owner, id);
        if (!owedAlarm(row, now))
            return null;
        if (row.state === 'silent')
            return row;
        const record = { ...row, state: 'silent', silentSince: row.lastHeardAt, silenceFingerprint: fingerprintOf(source, row), alarmOwed: true, silenceDeliveryId: null, notices: [...(row.notices || []), { id: 'silent-' + row.lastHeardAt, at: new Date(now).toISOString() }].slice(-MAX_NOTICES) };
        await put(c, owner, id, true, record);
        return record;
    });
}
/** @description InstallationSilent is on record: the card links to it and the tick stops raising it. */
async function settleSilence(pool, owner, source, deliveryId) {
    await (0, pipeline_1.processingTransaction)(pool, async (c) => { const id = stateKey(source.id), row = await held(c, owner, id); if (row)
        await put(c, owner, id, true, { ...row, alarmOwed: false, silenceDeliveryId: deliveryId }); });
}
/** @description A resolve is on record: drop it from what this installation still owes. */
async function settleResolve(pool, owner, source, fingerprint) {
    await (0, pipeline_1.processingTransaction)(pool, async (c) => { const id = stateKey(source.id), row = await held(c, owner, id); if (row)
        await put(c, owner, id, true, { ...row, owedResolves: (row.owedResolves || []).filter(o => o.fingerprint !== fingerprint) }); });
}
/** A silent installation's host turns unknown in Systems: its last readings are history now, not its health. */
async function scanSilence(pool, owner, source, record, now) { try {
    await saveInstallationScan(pool, owner, source, record, 'unknown', now);
}
catch { } }
/** @description The phone mark's state: whether the rail has been refusing messages, and since when. */
async function phoneMark(pool, owner) { return (await pool.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2', [owner, 'alerts-told'])).rows[0]?.record || null; }
/** @description One installation's saved state, or null. */
async function installationRow(pool, owner, sourceId) { return (await pool.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2', [owner, stateKey(sourceId)])).rows[0]?.record || null; }
const isSilence = notice => String(notice.id).startsWith('silent-');
/** @description What the attention rail still owes the person, oldest first. A silence's notice waits while the row is silent, however long the rail is down, and says the age it has when sent; a "reporting again" notice is dropped once sent or an hour old. */
function pendingNotices(row, now) {
    return (row?.notices || []).filter(n => isSilence(n) ? row.state === 'silent' : now - Date.parse(n.at) < NOTICE_MS).map(n => isSilence(n) ? { ...n, text: (row.name || row.scope || 'An installation') + ' has stopped reporting: Operations last heard from it ' + Math.round((now - Date.parse(row.lastHeardAt)) / 60000) + ' minutes ago. The server, its monitoring or the path to this Operations is down. Open Operations, Systems.' } : n);
}
async function clearNotices(pool, owner, sourceId, ids) {
    if (!ids.length)
        return;
    await (0, pipeline_1.processingTransaction)(pool, async (c) => { const id = stateKey(sourceId), row = await held(c, owner, id); if (row)
        await put(c, owner, id, true, { ...row, notices: (row.notices || []).filter(n => !ids.includes(n.id)) }); });
}
/** @description Forget one installation (a retired server): its state, history, readings in the telemetry banks and its host in Systems go; its source, its alerts and their investigations stay, and an evidence packet already pinned keeps its copy. @returns The record that was forgotten, or null. */
async function forgetInstallation(pool, owner, source, scope) {
    ownerRequired(owner);
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const row = await held(c, owner, stateKey(source.id));
        await c.query('DELETE FROM operations_processing_config WHERE user_sub=$1 AND id=$2', [owner, stateKey(source.id)]);
        await c.query('DELETE FROM operations_processing_config WHERE user_sub=$1 AND id LIKE $2', [owner, dayKey(source.id, '%')]);
        if (scope)
            await c.query('DELETE FROM operations_topology_scans WHERE user_sub=$1 AND source_uri=$2 AND collection_id=$3', [owner, source.source, 'installation:' + scope]);
        for (const table of ['operations_telemetry_0', 'operations_telemetry_1', 'operations_telemetry_2'])
            await c.query('DELETE FROM ' + table + ' WHERE user_sub=$1 AND source_id=$2', [owner, source.id]);
        await c.query('DELETE FROM operations_streams WHERE user_sub=$1 AND id=$2', [owner, source.id]);
        return row;
    });
}
function series(rows, days) {
    const size = BUCKET_MS * Math.max(1, days), groups = new Map();
    for (const row of rows)
        for (const [minute, bucket] of Object.entries(row.buckets || {})) {
            const start = Date.parse(row.day + 'T00:00:00.000Z') + Number(minute) * 60000, key = Math.floor(start / size) * size;
            for (const [name, [min, max, sum, count]] of Object.entries(bucket.m || {})) {
                const metric = groups.get(name) || new Map();
                groups.set(name, metric);
                const g = metric.get(key);
                if (g) {
                    g[0] = Math.min(g[0], min);
                    g[1] = Math.max(g[1], max);
                    g[2] += sum;
                    g[3] += count;
                }
                else
                    metric.set(key, [min, max, sum, count]);
            }
        }
    return Object.fromEntries([...groups].map(([name, metric]) => [name, [...metric].sort((a, b) => a[0] - b[0]).map(([at, [min, max, sum, count]]) => [at, round(sum / count), min, max])]));
}
/** The standing every reader agrees on: computed from the age, so the card does not wait for the tick. */
function standing(record, now) {
    const last = Date.parse(record.lastHeardAt), age = Number.isFinite(last) ? Math.max(0, now - last) : null;
    return { age, state: age === null ? 'never' : record.state === 'silent' || age >= exports.SILENT_MS ? 'silent' : age >= exports.LATE_MS ? 'late' : 'reporting' };
}
/** @description What a row reads as now: reporting, late, silent or never. Stopping the watch asks this, not the page. */
function installationState(record, now) { return standing(record, now).state; }
/** What is firing. A dead droplet cannot repeat anything, so while it is silent nothing falls off, and the silence itself comes first with its delivery. */
function firingOf(record, name, state, now) {
    const raised = record.state === 'silent' && record.silenceFingerprint ? [{ fingerprint: record.silenceFingerprint, alertType: exports.SILENT, severity: 'critical', summary: name + ' has stopped reporting', description: "Operations has not received this installation's heartbeat. The server, its monitoring or the path to this Operations is down.", service: null, startsAt: record.silentSince, lastSeenAt: new Date(now).toISOString(), deliveryId: record.silenceDeliveryId || null }] : [];
    return [...raised, ...Object.entries(record.alerts || {}).map(([fingerprint, { heldResolve, unlistedSince, ...a }]) => ({ fingerprint, ...a, ...(state === 'reporting' && (heldResolve || unlistedSince) ? { clearing: true } : {}) })).filter(a => state === 'silent' || now - Date.parse(a.lastSeenAt) < STALE_ALERT_MS).sort((a, b) => String(a.severity).localeCompare(String(b.severity)) || String(a.startsAt).localeCompare(String(b.startsAt)))];
}
function view(record, source, now, history, days) {
    const { age, state } = standing(record, now), assessed = assess(record.readings);
    return { sourceId: source.id, name: source.name, environment: source.environment, state, lastHeardAt: record.lastHeardAt || null, ageSeconds: age === null ? null : Math.round(age / 1000), lateAfterSeconds: exports.LATE_MS / 1000, silentAfterSeconds: exports.SILENT_MS / 1000, firstHeardAt: record.firstHeardAt || null, reports: record.beats || 0, silentSince: record.silentSince || (state === 'silent' ? record.lastHeardAt : null), heartbeatEndedAt: record.heartbeatEndedAt || null, host: record.readings?.host || null, url: record.readings?.url || null, health: state === 'silent' || state === 'never' ? 'unknown' : assessed.health, checks: state === 'never' ? assessed.checks.map(c => ({ ...c, state: 'unknown', reading: 'Not reported' })) : assessed.checks, uptimeSeconds: record.readings?.values?.boot_seconds ?? null, feedError: record.feedError || null, thresholds: record.thresholds || null,
        firing: firingOf(record, source.name, state, now),
        history: { days, bucketMinutes: 15 * days, since: now - days * 86400000, now, series: series(history, days) } };
}
/** @description When the silence watch last ran: heartbeats do not depend on the schedule, so a page can look alive while no alarm can be raised. @param pool Owner-scoped SQL. @param owner The caller. @param clock Milliseconds now. @returns Its last tick, age, whether it is overdue, and any grace after a gap. */
async function watchStatus(pool, owner, clock = Date.now) {
    ownerRequired(owner);
    const now = clock(), row = (await pool.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2', [owner, WATCH])).rows[0]?.record, last = Date.parse(row?.lastTickAt), age = Number.isFinite(last) ? Math.max(0, now - last) : null;
    return { lastTickAt: row?.lastTickAt || null, ageSeconds: age === null ? null : Math.round(age / 1000), overdue: age === null || age > exports.GAP_MS, graceUntil: Date.parse(row?.graceUntil) > now ? row.graceUntil : null };
}
/** @description Every installation's standing for Jarvis and the attention summary, without the charts. @param pool Owner-scoped SQL. @param owner The caller. @param clock Milliseconds now. @param removed Ids of sources the person removed; their installations are left out, their rows kept. @returns Name, state, age, health and what is firing, per installation. */
async function installationStanding(pool, owner, clock = Date.now, removed = new Set()) {
    ownerRequired(owner);
    const now = clock();
    const rows = (await pool.query("SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id LIKE 'installation:%' LIMIT 64", [owner])).rows.map(r => r.record).filter(record => !removed.has(record?.sourceId));
    return rows.map(record => { const { age, state } = standing(record, now), name = record.name || record.scope || 'an installation'; return { name, state, ageSeconds: age === null ? null : Math.round(age / 1000), health: state === 'silent' || state === 'never' ? 'unknown' : assess(record.readings).health, firing: firingOf(record, name, state, now).map(({ alertType, severity, service, summary, clearing }) => ({ alertType, severity, service: service || null, summary: summary || null, ...(clearing ? { clearing: true } : {}) })) }; }).sort((a, b) => a.name.localeCompare(b.name));
}
/** @description Each monitored installation as Systems shows it, computed now, with its charts over the chosen days (1, 7 or 14, in about 96 points whichever). Read-only: a GET route serves it. @param sources Saved source revisions. @param days The chart range. @returns One view per source that has ever reported or alerted. */
async function installationRecords(pool, owner, sources, days = 1, clock = Date.now) {
    ownerRequired(owner);
    if (!sources.length)
        return [];
    const range = [1, 7, 14].includes(days) ? days : 1, now = clock(), out = [];
    const states = (await pool.query('SELECT id,record FROM operations_processing_config WHERE user_sub=$1 AND id IN (' + sources.map((_, i) => '$' + (i + 2)).join(',') + ')', [owner, ...sources.map(s => stateKey(s.id))])).rows;
    const byId = new Map(states.map(r => [r.id, r.record]));
    for (const source of sources) {
        const record = byId.get(stateKey(source.id));
        if (!record)
            continue;
        const ids = Array.from({ length: range + 1 }, (_, i) => dayKey(source.id, dayOf(now - i * 86400000)));
        const rows = (await pool.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id IN (' + ids.map((_, i) => '$' + (i + 2)).join(',') + ')', [owner, ...ids])).rows.map(r => r.record);
        const since = now - range * 86400000;
        out.push(view(record, source, now, rows.map(r => ({ ...r, buckets: Object.fromEntries(Object.entries(r.buckets || {}).filter(([minute]) => Date.parse(r.day + 'T00:00:00.000Z') + Number(minute) * 60000 >= since)) })), range));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}
