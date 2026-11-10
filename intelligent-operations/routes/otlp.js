"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OTLP_RULES = exports.OTLP_THRESHOLDS = exports.OTLP_MAX_BYTES = exports.OTLP_PREFIX = void 0;
exports.otlpShape = otlpShape;
exports.otlpReadings = otlpReadings;
exports.mergedReadings = mergedReadings;
exports.advanceEvaluations = advanceEvaluations;
exports.dueTransitions = dueTransitions;
exports.ingestOtlp = ingestOtlp;
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | ADR-216 S2 (1.7.0): POST /ingest/otlp/:sourceId, where an OpenTelemetry Collector enrolled with a one-time code reports. The kernel's producer door hands it the collector's OTLP/HTTP JSON body (decompressed, at most 256 KiB) as the token's owner, with x-oshal-producer-path /v1/metrics, /v1/logs or /v1/traces when the collector used the door's aliases (none means metrics). The metrics the collector's hostmetrics and httpcheck receivers send are read onto the heartbeat's own keys (disk_used, memory_used, cpu_used, load5, cpus, site_up, site_seconds) and recorded through the same beat as an InstallationHeartbeat (installations.ts recordBeat), so lastHeardAt, the charts, the telemetry banks, Systems and InstallationSilent are unchanged. The collector has no rule engine, so the six alerts the Prometheus profile's rules raise from the same readings (SiteDown, SiteSlow, DiskFull, DiskHigh, MemoryLow, LoadHigh) are evaluated here, with the same names, thresholds and `for:` windows, per host, and admitted through intake and the source's policy as firing and resolved events. Logs and traces are answered and ignored. A removed source answers 410, which ends the token at the door. */
// @ts-nocheck
const intake_1 = require("./intake");
const ingest_1 = require("./ingest");
const installations_1 = require("./installations");
const pipeline_1 = require("./pipeline");
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
/** The prefix of the route an OpenTelemetry Collector's producer token names (oshal-app.yaml producers.enroll.routes). */
exports.OTLP_PREFIX = '/ingest/otlp/';
/** The largest delivery the kernel's producer door passes on (control::MAX_PRODUCER_BYTES), checked again here. */
exports.OTLP_MAX_BYTES = 256 * 1024;
/**
 * The thresholds an OTLP-fed installation is judged by. Disk, site and load are copied from oshal-kernel
 * ops/monitoring/platform-ops.default.json (thresholds, 2026-11-09); this is the package's single copy. Memory follows
 * the floor oshal-kernel platform/monitor/oswarm-monitor renders for MemoryLow on an enrolled server (memory_floor_gib:
 * 5% of the server's memory, at least 0.1 GiB), because platform-ops.default.json's 12 GiB is the Spark's own figure.
 */
exports.OTLP_THRESHOLDS = Object.freeze({ disk_used_percent_max: 85, disk_full_percent_max: 90, site_down_seconds: 300, site_slow_seconds: 3, load_per_cpu_max: 2, memory_available_share_min: 0.05, memory_available_gib_min: 0.1 });
const MIN = 60000, GIB = 1024 ** 3;
/** A breach unread for longer than this is no longer pending, as the rules' last_over_time over two minutes, with room for a delivery's jitter. */
const STALE_MS = 2 * MIN + 30000;
/** Hosts one delivery is read for, and evaluations one source keeps; a cluster's DaemonSet reports one host per node. */
const MOST_HOSTS = 64, MOST_KEPT = 256;
const SIGNALS = { '/v1/metrics': 'metrics', '/v1/logs': 'logs', '/v1/traces': 'traces' };
const known = Number.isFinite;
const evaluationKey = sourceId => 'otlp-evaluation:' + sourceId;
/**
 * The six alerts, as platform/monitor/rules/installation.yml writes them: name, severity, `for:` window and what breaches.
 * `breach` answers null when the delivery does not carry the reading, which leaves the alert's clock where it was.
 */
exports.OTLP_RULES = Object.freeze([
    { name: 'SiteDown', severity: 'critical', windowMs: t => t.site_down_seconds * 1000, breach: (r) => known(r.site_up) ? r.site_up < 1 : null,
        summary: () => 'The public site does not answer', description: (r, t) => (r.url || 'The site') + ' failed the check for ' + Math.round(t.site_down_seconds / 60) + 'm' },
    { name: 'SiteSlow', severity: 'warning', windowMs: () => 10 * MIN, breach: (r, t) => known(r.site_seconds) ? r.site_seconds > t.site_slow_seconds : null,
        summary: () => 'The public site is slow', description: r => (r.url || 'The site') + ' answers in ' + r.site_seconds.toFixed(1) + ' s' },
    { name: 'DiskFull', severity: 'critical', windowMs: () => 10 * MIN, breach: (r, t) => known(r.disk_used) ? r.disk_used > t.disk_full_percent_max : null,
        summary: (r, t) => 'The disk is ' + t.disk_full_percent_max + '% full', description: r => Math.round(r.disk_used) + '% of / is used' },
    { name: 'DiskHigh', severity: 'warning', windowMs: () => 30 * MIN, breach: (r, t) => known(r.disk_used) ? r.disk_used > t.disk_used_percent_max : null,
        summary: (r, t) => 'The disk is over ' + t.disk_used_percent_max + '% full', description: r => Math.round(r.disk_used) + '% of / is used' },
    { name: 'MemoryLow', severity: 'critical', windowMs: () => 10 * MIN, breach: (r, t) => memoryLow(r, t),
        summary: (r, t) => 'Under ' + memoryFloorText(r, t) + ' of memory available', description: r => memoryAvailableText(r) + ' available' },
    { name: 'LoadHigh', severity: 'warning', windowMs: () => 15 * MIN, breach: (r, t) => known(r.load5) && known(r.cpus) && r.cpus > 0 ? r.load5 > t.load_per_cpu_max * r.cpus : null,
        summary: (r, t) => 'Load is over ' + t.load_per_cpu_max + ' times the CPUs', description: r => '5-minute load ' + r.load5.toFixed(2) },
]);
/** MemoryLow's floor in bytes when the total is known: the share of it, at least the minimum. */
const memoryFloor = (r, t) => Math.max(t.memory_available_gib_min * GIB, t.memory_available_share_min * r.memory_total);
function memoryLow(r, t) {
    if (known(r.memory_total) && known(r.memory_available))
        return r.memory_available < memoryFloor(r, t);
    return known(r.memory_used) ? 100 - r.memory_used < t.memory_available_share_min * 100 : null;
}
const gib = bytes => (bytes / GIB).toFixed(1) + ' GiB';
const memoryFloorText = (r, t) => known(r.memory_total) ? gib(memoryFloor(r, t)) : Math.round(t.memory_available_share_min * 100) + '%';
const memoryAvailableText = r => known(r.memory_available) ? gib(r.memory_available) : known(r.memory_used) ? Math.round(100 - r.memory_used) + '%' : 'Too little';
/** One OTLP number: asDouble, or asInt as a number or as the string protobuf's JSON mapping gives an int64. */
function pointValue(point) {
    const raw = point?.asDouble !== undefined ? point.asDouble : point?.asInt;
    const value = typeof raw === 'string' && raw.trim() ? Number(raw) : raw;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
/** An OTLP attribute list as plain strings (stringValue, or another scalar as text). */
function attributesOf(list) {
    const out = {};
    for (const a of Array.isArray(list) ? list.slice(0, 64) : []) {
        if (typeof a?.key !== 'string' || !a.value || typeof a.value !== 'object')
            continue;
        const v = a.value, raw = v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue;
        if (raw !== undefined && raw !== null)
            out[a.key] = String(raw).slice(0, 256);
    }
    return out;
}
/** Each gauge or sum data point of one metric, with its attributes and value. */
function pointsOf(metric) {
    const points = metric?.gauge?.dataPoints ?? metric?.sum?.dataPoints;
    return (Array.isArray(points) ? points.slice(0, 512) : []).map(p => ({ attributes: attributesOf(p?.attributes), value: pointValue(p) })).filter(p => p.value !== null);
}
/**
 * @description Check an OTLP/HTTP JSON body's shape before anything is read: an object whose resourceMetrics, resourceLogs and resourceSpans are arrays when present.
 * @param body The delivered body.
 * @returns 'metrics', or 'ignored' for a body carrying only logs or spans.
 */
function otlpShape(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
        fail(400, 'An OTLP/HTTP JSON body is one object.');
    for (const key of ['resourceMetrics', 'resourceLogs', 'resourceSpans'])
        if (body[key] !== undefined && !Array.isArray(body[key]))
            fail(400, 'OTLP ' + key + ' is a list.');
    if (body.resourceMetrics !== undefined)
        return 'metrics';
    if (body.resourceLogs !== undefined || body.resourceSpans !== undefined)
        return 'ignored';
    return fail(400, 'An OTLP/HTTP JSON body carries resourceMetrics.');
}
/** The metrics of one resource, by name, each name's data points together. */
function metricsByName(resource) {
    const byName = new Map();
    for (const scope of Array.isArray(resource?.scopeMetrics) ? resource.scopeMetrics.slice(0, 64) : [])
        for (const metric of Array.isArray(scope?.metrics) ? scope.metrics.slice(0, 512) : []) {
            if (typeof metric?.name !== 'string')
                continue;
            byName.set(metric.name, [...(byName.get(metric.name) || []), ...pointsOf(metric)]);
        }
    return byName;
}
const sum = list => list.reduce((a, b) => a + b, 0);
/** Disk: system.filesystem.utilization at the mount point /, else used over used and free from system.filesystem.usage, as df counts it. */
function diskUsed(m) {
    const root = p => p.attributes.mountpoint === '/';
    const share = (m.get('system.filesystem.utilization') || []).filter(root).map(p => p.value);
    if (share.length)
        return Math.max(...share) * 100;
    const usage = (m.get('system.filesystem.usage') || []).filter(root), of = state => sum(usage.filter(p => p.attributes.state === state).map(p => p.value));
    const used = of('used'), free = of('free');
    return used + free > 0 ? used / (used + free) * 100 : null;
}
/** Memory: the used state's share (system.memory.utilization, else system.memory.usage over its total), the total, and what is available. */
function memory(m) {
    const usage = m.get('system.memory.usage') || [], limit = (m.get('system.memory.limit') || [])[0]?.value;
    const total = known(limit) ? limit : usage.length ? sum(usage.map(p => p.value)) : null;
    const util = (m.get('system.memory.utilization') || []).filter(p => !p.attributes.state || p.attributes.state === 'used');
    const usedShare = util.length ? util[0].value : total ? sum(usage.filter(p => p.attributes.state === 'used').map(p => p.value)) / total : null;
    if (!known(usedShare))
        return {};
    return { memory_used: usedShare * 100, ...(known(total) && total > 0 ? { memory_total: total, memory_available: total * (1 - usedShare) } : {}) };
}
/**
 * CPU: busy is 100 minus the idle share, averaged over the CPUs system.cpu.utilization names; without an idle state,
 * the sum of the states it does report. The number of CPUs is the CPUs it names, else system.cpu.logical.count.
 */
function cpu(m) {
    const perCpu = new Map();
    for (const p of m.get('system.cpu.utilization') || []) {
        const id = p.attributes.cpu || 'cpu';
        const s = perCpu.get(id) || { idle: null, busy: 0 };
        if (p.attributes.state === 'idle')
            s.idle = p.value;
        else
            s.busy += p.value;
        perCpu.set(id, s);
    }
    const shares = [...perCpu.values()].map(s => s.idle !== null ? 1 - s.idle : s.busy), count = (m.get('system.cpu.logical.count') || [])[0]?.value;
    const cpus = perCpu.size || (known(count) ? count : null), load = (m.get('system.cpu.load_average.5m') || [])[0]?.value;
    return { ...(shares.length ? { cpu_used: Math.min(100, Math.max(0, sum(shares) / shares.length * 100)) } : {}), ...(known(cpus) ? { cpus } : {}), ...(known(load) ? { load5: load } : {}) };
}
/** The site check: httpcheck.status is 1 on the status class it saw, so up is a 2xx; httpcheck.error alone is down; duration is in milliseconds. */
function site(m) {
    const status = m.get('httpcheck.status') || [], errors = (m.get('httpcheck.error') || []).filter(p => p.value > 0), duration = m.get('httpcheck.duration') || [];
    const url = [...status, ...errors, ...duration].map(p => p.attributes['http.url']).find(Boolean);
    const up = status.some(p => p.attributes['http.status_class'] === '2xx' && p.value >= 1) ? 1 : status.length || errors.length ? 0 : null;
    return { ...(up !== null ? { site_up: up } : {}), ...(duration.length ? { site_seconds: Math.max(...duration.map(p => p.value)) / 1000 } : {}), ...(url ? { url } : {}) };
}
/**
 * @description What one OTLP metrics body says about each host it covers, on the heartbeat's own keys. Pure.
 * @param body An OTLP/HTTP JSON ExportMetricsServiceRequest.
 * @returns One entry per host (resource host.name, else k8s.node.name, else 'host'), at most 64.
 */
function otlpReadings(body) {
    const hosts = new Map();
    for (const resource of (body.resourceMetrics || []).slice(0, MOST_HOSTS * 4)) {
        const attrs = attributesOf(resource?.resource?.attributes), host = String(attrs['host.name'] || attrs['k8s.node.name'] || 'host').slice(0, 128);
        if (!hosts.has(host) && hosts.size >= MOST_HOSTS)
            continue;
        const m = metricsByName(resource), disk = diskUsed(m);
        const read = { ...memory(m), ...cpu(m), ...site(m), ...(known(disk) ? { disk_used: disk } : {}) };
        hosts.set(host, { ...(hosts.get(host) || {}), ...read });
    }
    return [...hosts].map(([host, readings]) => ({ host, readings }));
}
/** One installation row for the whole delivery: one host's readings, or the worst of several (the fullest disk, the busiest CPU, the site down if any check is). */
function mergedReadings(list) {
    if (list.length === 1)
        return { ...list[0].readings, host: list[0].host };
    const out = { host: list.length + ' hosts' }, max = key => { const v = list.map(h => h.readings[key]).filter(known); if (v.length)
        out[key] = Math.max(...v); };
    for (const key of ['disk_used', 'memory_used', 'cpu_used', 'site_seconds'])
        max(key);
    const loaded = list.filter(h => known(h.readings.load5) && known(h.readings.cpus)).sort((a, b) => b.readings.load5 / b.readings.cpus - a.readings.load5 / a.readings.cpus)[0];
    if (loaded)
        Object.assign(out, { load5: loaded.readings.load5, cpus: loaded.readings.cpus });
    const up = list.map(h => h.readings.site_up).filter(known);
    if (up.length)
        out.site_up = Math.min(...up);
    const url = list.map(h => h.readings.url).find(Boolean);
    if (url)
        out.url = url;
    return out;
}
const text = v => String(Math.round(v * 1000) / 1000);
/** The checks a collector's readings answer; every other check on the card says it is not reported, rather than missing. */
const REPORTED = { site: ['site_up'], disk: ['disk_used'], memory: ['memory_used'], processor: ['cpu_used', 'load5'] };
/** The delivery as the InstallationHeartbeat the beat path takes: readings as annotations, which checks they answer, and the thresholds it is judged by as the probe's threshold snapshot. */
function heartbeatOf(mapping, merged, at) {
    const reports = Object.keys(REPORTED).filter(check => REPORTED[check].some(key => known(merged[key])));
    const annotations = { summary: "This installation's OpenTelemetry Collector is reporting", host: merged.host, reports: reports.join(' '), thresholds: JSON.stringify(exports.OTLP_THRESHOLDS), thresholds_file: 'Operations evaluates this OpenTelemetry installation (otlp.ts)' };
    for (const key of ['disk_used', 'memory_used', 'cpu_used', 'load5', 'cpus', 'site_up', 'site_seconds'])
        if (known(merged[key]))
            annotations[key] = text(merged[key]);
    if (merged.url)
        annotations.site_url = merged.url;
    return { status: 'firing', labels: { alertname: installations_1.HEARTBEAT, [mapping.severityLabel]: 'heartbeat', [mapping.idLabel]: mapping.scope }, annotations, startsAt: new Date(at).toISOString() };
}
/**
 * @description Move each alert's clock by what this delivery read: a breach starts or keeps its clock, a clear stops it and, on a firing alert, starts its resolve. A reading the delivery lacks moves nothing. Pure.
 * @param kept The stored evaluations, by alert and host.
 * @param hosts otlpReadings' result.
 * @param now Milliseconds now.
 * @returns The evaluations after this delivery.
 */
function advanceEvaluations(kept, hosts, now, thresholds = exports.OTLP_THRESHOLDS) {
    const next = { ...kept }, at = new Date(now).toISOString();
    for (const { host, readings } of hosts)
        for (const rule of exports.OTLP_RULES) {
            const breach = rule.breach(readings, thresholds);
            if (breach === null)
                continue;
            const key = rule.name + '|' + host, e = next[key] || { alertType: rule.name, host, breachSince: null, lastBreachAt: null, firing: false, startsAt: null, clearSince: null };
            // As the rules' last_over_time(...[2m]): a breach not read for over two minutes is no longer pending, and starts again.
            const held = e.breachSince && now - Date.parse(e.lastBreachAt || e.breachSince) <= STALE_MS;
            next[key] = breach ? { ...e, breachSince: held ? e.breachSince : at, lastBreachAt: at, clearSince: null, readings } : { ...e, breachSince: null, lastBreachAt: null, clearSince: e.firing ? e.clearSince || at : null, readings };
            if (!breach && !e.firing)
                delete next[key];
        }
    return Object.fromEntries(Object.entries(next).slice(-MOST_KEPT));
}
/** A firing alert is said again this often while it holds, as Alertmanager's repeat does, so the card never drops one that is still firing (installations.ts lets an alert nobody repeated for 9 hours fall off). */
const REPEAT_MS = 4 * 3600000;
/** The fires, repeats and resolves the evaluations owe: a breach held for its rule's window fires from when it began; a firing alert still breaching is repeated every 4 hours; a clear on a firing alert resolves at when it cleared. Pure. */
function dueTransitions(evaluations, now, thresholds = exports.OTLP_THRESHOLDS) {
    const due = [];
    for (const [key, e] of Object.entries(evaluations)) {
        const rule = exports.OTLP_RULES.find(r => r.name === e.alertType);
        if (!rule)
            continue;
        // Only a breach read just now can fire: an alert never starts on a delivery that did not carry its reading.
        if (!e.firing && e.breachSince && e.lastBreachAt === new Date(now).toISOString() && now - Date.parse(e.breachSince) >= rule.windowMs(thresholds))
            due.push({ key, status: 'firing', rule, e });
        else if (e.firing && e.clearSince)
            due.push({ key, status: 'resolved', rule, e });
        else if (e.firing && e.breachSince && now - Date.parse(e.notedAt || e.startsAt) >= REPEAT_MS)
            due.push({ key, status: 'repeat', rule, e });
    }
    return due;
}
/** One owed transition as an Alertmanager alert, so the source's one mapping, intake and the card take it as they take Prometheus'. */
function transitionAlert(source, mapping, { status: owed, rule, e }, thresholds) {
    const status = owed === 'resolved' ? 'resolved' : 'firing', startsAt = owed === 'firing' ? e.breachSince : e.startsAt, fingerprint = 'otlp' + (0, intake_1.hash)(['otlp-alert', source.id, rule.name, e.host]).slice(0, 32);
    const r = e.readings || {}, prefix = e.host === mapping.scope || e.host === 'host' ? '' : e.host + ': ';
    return { status, fingerprint, startsAt, ...(status === 'resolved' ? { endsAt: e.clearSince } : {}),
        labels: { alertname: rule.name, [mapping.severityLabel]: rule.severity, [mapping.idLabel]: mapping.scope, host: e.host, feed: 'otlp' },
        annotations: { summary: prefix + rule.summary(r, thresholds), description: rule.description(r, thresholds) } };
}
async function evaluationsOf(c, owner, sourceId) { return (await c.query('SELECT record FROM operations_processing_config WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, evaluationKey(sourceId)])).rows[0]?.record || null; }
async function putEvaluations(c, owner, sourceId, exists, record) {
    if (exists)
        await c.query('UPDATE operations_processing_config SET record=$3 WHERE user_sub=$1 AND id=$2', [owner, evaluationKey(sourceId), JSON.stringify(record)]);
    else
        await c.query('INSERT INTO operations_processing_config(user_sub,id,revision,record) VALUES($1,$2,1,$3)', [owner, evaluationKey(sourceId), JSON.stringify(record)]);
}
/** Record this delivery's clocks, then say what is owed: the clocks commit before any event is admitted, so a failed admit is simply owed again next delivery. */
async function clockIn(pool, owner, source, hosts, now) {
    return (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const held = await evaluationsOf(c, owner, source.id), evaluations = advanceEvaluations(held?.evaluations || {}, hosts, now);
        await putEvaluations(c, owner, source.id, Boolean(held), { sourceId: source.id, evaluations, updatedAt: new Date(now).toISOString() });
        return dueTransitions(evaluations, now);
    });
}
/** A transition is on record: a fire marks the alert firing from its start, a repeat notes when it was said, a resolve forgets the alert. */
async function settle(pool, owner, source, done, at) {
    if (!done.length)
        return;
    await (0, pipeline_1.processingTransaction)(pool, async (c) => {
        const held = await evaluationsOf(c, owner, source.id);
        if (!held)
            return;
        const evaluations = { ...held.evaluations };
        for (const { key, status, e } of done) {
            const now = evaluations[key];
            if (!now)
                continue;
            if (status === 'firing' && !now.firing)
                evaluations[key] = { ...now, firing: true, startsAt: e.breachSince, notedAt: at };
            else if (status === 'repeat' && now.firing)
                evaluations[key] = { ...now, notedAt: at };
            else if (status === 'resolved' && now.firing && now.clearSince === e.clearSince)
                delete evaluations[key];
        }
        await putEvaluations(c, owner, source.id, true, { ...held, evaluations });
    });
}
/** Admit each owed fire and resolve through intake and keep the card in step (a repeat only refreshes the card: intake already holds that occurrence); one that fails stays owed. */
async function admitTransitions(pool, owner, source, mapping, due, clock) {
    const done = [], alerts = [], results = [], errors = [];
    for (const t of due) {
        const alert = transitionAlert(source, mapping, t, exports.OTLP_THRESHOLDS);
        try {
            const r = t.status === 'repeat' ? null : await (0, intake_1.admit)(pool, owner, source, (0, ingest_1.alertEvent)(mapping, alert), { sameOccurrence: true });
            alerts.push(alert);
            results.push({ status: r?.status ?? null, id: r?.record?.id || null, decision: r?.record?.decision || null });
            done.push(t);
        }
        catch (error) {
            errors.push(t.rule.name + ': ' + String(error.message || error).slice(0, 200));
        }
    }
    if (alerts.length)
        await (0, installations_1.noteAlerts)(pool, owner, source, mapping, alerts, results, clock);
    await settle(pool, owner, source, done, new Date(clock()).toISOString());
    const named = status => done.filter(t => t.status === status).map(t => t.rule.name);
    return { fired: named('firing'), repeated: named('repeat'), resolved: named('resolved'), errors };
}
/**
 * @description Take one OpenTelemetry Collector delivery for a source: metrics become one heartbeat with readings and move the six alerts' clocks; logs and traces are answered and ignored. A removed source answers 410, an unknown one 404.
 * @param pool Owner-scoped SQL.
 * @param owner The producer token's owner, as the kernel admitted the delivery.
 * @param sources Every saved source revision, removed ones included.
 * @param sourceId The route's source.
 * @param body The OTLP/HTTP JSON body.
 * @param options {path, clock}: x-oshal-producer-path as the door passed it, and milliseconds now.
 * @returns The beat and the transitions admitted, for the logs; the route answers the collector `{}`.
 */
async function ingestOtlp(pool, owner, sources, sourceId, body, { path, clock = Date.now } = {}) {
    if (typeof owner !== 'string' || !owner)
        fail(401, 'A verified caller is required.');
    const source = sources.find(s => s.id === sourceId);
    if (!source)
        fail(404, 'No such source in your scope.');
    if (source.discardedAt)
        fail(410, ingest_1.REMOVED);
    const signal = path === undefined || path === null || path === '' ? 'metrics' : SIGNALS[path];
    if (!signal)
        fail(400, 'The producer door named an OTLP signal Operations does not know.');
    if (Buffer.byteLength(JSON.stringify(body ?? null)) > exports.OTLP_MAX_BYTES)
        fail(413, 'A delivery is at most 256 KiB.');
    if (signal !== 'metrics' || otlpShape(body) === 'ignored')
        return { sourceId, signal, ignored: true };
    const mapping = await (0, ingest_1.ingestMapping)(pool, owner, sourceId);
    if (!mapping)
        fail(409, 'Enrol this installation for OpenTelemetry first.');
    const now = clock(), hosts = otlpReadings(body);
    const heartbeat = await (0, installations_1.recordBeat)(pool, owner, source, mapping, heartbeatOf(mapping, hosts.length ? mergedReadings(hosts) : { host: null }, now), () => now);
    // A silence this delivery ended owes its resolve; one that fails stays owed in the row and the next tick retries it, as for a Prometheus heartbeat.
    if (heartbeat.owed?.length)
        try {
            await (0, ingest_1.settleResolves)(pool, owner, source, mapping, heartbeat.owed);
            heartbeat.owed = [];
        }
        catch (error) {
            heartbeat.resolveError = String(error.message || error).slice(0, 200);
        }
    const due = await clockIn(pool, owner, source, hosts, now);
    const transitions = due.length ? await admitTransitions(pool, owner, source, mapping, due, () => now) : { fired: [], repeated: [], resolved: [], errors: [] };
    return { sourceId, signal, hosts: hosts.length, heartbeat, ...transitions };
}
