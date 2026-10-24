"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestMapping = ingestMapping;
exports.saveIngestMapping = saveIngestMapping;
exports.alertEvent = alertEvent;
exports.ingestAlertmanager = ingestAlertmanager;
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Carry the alert's summary, description and up to 24 labels (bounded) so the evidence packet can quote them. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Unattended producer adapter (R07/R08): an Alertmanager webhook delivery, admitted by the kernel's producer door as the source's owner, becomes one CloudEvents alert per Alertmanager alert, each admitted through the same validated intake as a hand-entered event (deduplication, quarantine, processing item). The owner maps each source once: the resource kind, the label that carries the resource id, the scope and the environment. A delivery for a source without that mapping, or for another person's source, admits nothing. */
// @ts-nocheck
const pipeline_1 = require("./pipeline");
const intake_1 = require("./intake");
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
/** @description One Alertmanager alert as the Operations alert envelope; the id is stable per alert fingerprint and status. */
function alertEvent(mapping, alert) {
    const labels = alert && typeof alert.labels === 'object' && alert.labels || {}, status = alert?.status === 'resolved' ? 'resolved' : 'firing';
    const ended = typeof alert?.endsAt === 'string' && !alert.endsAt.startsWith('0001') ? alert.endsAt : null;
    const fingerprint = typeof alert?.fingerprint === 'string' && /^[A-Za-z0-9]{1,64}$/.test(alert.fingerprint) ? alert.fingerprint : null;
    return { specversion: '1.0', id: (fingerprint || 'unfingerprinted') + '-' + status + (status === 'resolved' && ended ? '-' + ended.replace(/[^0-9]/g, '').slice(0, 14) : ''), source: mapping.source, type: 'operations.alert',
        time: status === 'resolved' && ended ? ended : alert?.startsAt, dataschema: SCHEMA, datacontenttype: 'application/json',
        data: { environment: mapping.environment, alertType: String(labels.alertname || 'UnnamedAlert').slice(0, 128),
            ...(typeof alert?.annotations?.summary === 'string' ? { summary: alert.annotations.summary.slice(0, 512) } : {}), ...(typeof alert?.annotations?.description === 'string' ? { description: alert.annotations.description.slice(0, 1024) } : {}),
            labels: Object.fromEntries(Object.entries(labels).filter(([k, v]) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k) && typeof v === 'string').slice(0, 24).map(([k, v]) => [k, v.slice(0, 128)])), severity: String(labels[mapping.severityLabel] || 'warning').slice(0, 32), status,
            resource: { kind: mapping.resourceKind, scope: mapping.scope, id: typeof labels[mapping.idLabel] === 'string' ? labels[mapping.idLabel] : '' } } };
}
/** @description Admit an Alertmanager webhook delivery for one mapped source: every alert goes through intake; nothing else runs. */
async function ingestAlertmanager(pool, owner, sources, sourceId, body) {
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
    const results = [];
    for (const alert of body.alerts) {
        try {
            const r = await (0, intake_1.admit)(pool, owner, source, alertEvent(mapping, alert));
            results.push({ status: r.status, id: r.record?.id || null, decision: r.record?.decision || null, retry: r.retry === true });
        }
        catch (error) {
            results.push({ status: error.status || 500, error: String(error.message || error).slice(0, 200) });
        }
    }
    return { sourceId, received: body.alerts.length, admitted: results.filter(r => r.decision === 'validated').length, quarantined: results.filter(r => r.decision === 'quarantined').length, results, executionAuthorized: false };
}
