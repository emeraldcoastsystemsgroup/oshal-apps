"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncLinkDefinition = syncLinkDefinition;
exports.syncPlan = syncPlan;
exports.saveSyncLink = saveSyncLink;
exports.syncRecords = syncRecords;
exports.reserveSync = reserveSync;
exports.reportSync = reportSync;
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Keep immutable original-person external links and reserve exact canonical phase/revision actions before manual confirmed native connector handoff; client observations remain explicitly operator-reported. */
// @ts-nocheck
const node_crypto_1 = require("node:crypto");
const intake_1 = require("./intake");
const pipeline_1 = require("./pipeline");
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const hash = value => (0, node_crypto_1.createHash)('sha256').update((0, intake_1.canonical)(value)).digest('hex');
const id = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const statuses = ['draft', 'queued', 'running', 'awaiting_approval', 'blocked', 'done', 'failed', 'cancelled'];
const phases = ['*', '-', 'investigate', 'review', 'revise', 'queue-deliver'];
function closed(input, fields) { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !fields.includes(k)))
    fail(400, 'Supply only the supported synchronization fields.'); }
function owner(value) { if (typeof value !== 'string' || !value.trim())
    fail(401, 'A verified caller is required.'); }
function target(provider, value) {
    closed(value, provider === 'gitlab' ? ['action'] : ['action', 'expectedState']);
    if (provider === 'jira') {
        if (typeof value.action !== 'string' || typeof value.expectedState !== 'string' || !/^[0-9]{1,20}$/.test(value.action) || !/^[0-9]{1,20}$/.test(value.expectedState))
            fail(400, 'Jira mappings need explicit transition and destination status IDs.');
        return { action: value.action, expectedState: value.expectedState };
    }
    if (provider === 'gitlab') {
        if (!['close', 'reopen'].includes(value.action))
            fail(400, 'GitLab state action must be close or reopen.');
        return { action: value.action, expectedState: value.action === 'close' ? 'closed' : 'opened' };
    }
    if (typeof value.action !== 'string' || !/^[-a-zA-Z0-9_]{1,32}$/.test(value.action) || typeof value.expectedState !== 'string' || !value.expectedState.trim() || value.expectedState.length > 80 || /[\r\n]/.test(value.expectedState))
        fail(400, 'Use the ServiceNow state value and expected displayed state.');
    return { action: value.action, expectedState: value.expectedState };
}
/** @description Freeze provider realm, external identity and explicit phase/status mappings; no credentials or arbitrary operation bodies are accepted. */
function syncLinkDefinition(input) {
    closed(input, ['ticketId', 'provider', 'recordKey', 'projectId', 'account', 'targetRevision', 'mapping']);
    if (!uuid(input.ticketId) || !['jira', 'gitlab', 'servicenow'].includes(input.provider) || !id(input.targetRevision))
        fail(400, 'Choose an owned Operations ticket and a configured supported service revision.');
    if (typeof input.account !== 'string' || !input.account.trim() || input.account.length > 128 || input.account.trim() !== input.account || /[\x00-\x1f\x7f]/.test(input.account))
        fail(400, 'Select an exact personal connection account.');
    const { provider } = input, recordKey = input.recordKey, projectId = provider === 'gitlab' ? input.projectId : null;
    if (typeof recordKey !== 'string' || (provider === 'gitlab' && typeof projectId !== 'string'))
        fail(400, 'External identifiers must be explicit strings.');
    if (provider === 'jira' && !/^[A-Z][A-Z0-9_]{0,39}-[0-9]{1,20}$/.test(recordKey))
        fail(400, 'Use the Jira issue key.');
    if (provider === 'gitlab' && (!/^[1-9][0-9]{0,19}$/.test(projectId) || !/^[1-9][0-9]{0,19}$/.test(recordKey)))
        fail(400, 'Use numeric GitLab project ID and issue IID.');
    if (provider === 'servicenow' && !/^[a-f0-9]{32}$/i.test(recordKey))
        fail(400, 'Use the ServiceNow incident sys_id.');
    if (provider !== 'gitlab' && input.projectId != null && input.projectId !== '')
        fail(400, 'Only GitLab uses a project ID.');
    if (!input.mapping || typeof input.mapping !== 'object' || Array.isArray(input.mapping) || Object.keys(input.mapping).length < 1 || Object.keys(input.mapping).length > 32)
        fail(400, 'Supply 1–32 explicit workflow mappings.');
    const mapping = {};
    for (const [key, value] of Object.entries(input.mapping)) {
        const parts = key.split(':');
        if (parts.length !== 2 || !statuses.includes(parts[0]) || !phases.includes(parts[1]))
            fail(400, 'Map status:phase, using an exact Operations phase or *.');
        mapping[key] = target(provider, value);
    }
    const body = { ticketId: input.ticketId, provider, recordKey, projectId, account: input.account, targetRevision: input.targetRevision, mapping };
    return { ...body, id: hash(['ticket-link-v1', body]) };
}
async function ticket(ctx, ticketId) {
    if (typeof ctx.ticketService?.getTicket !== 'function')
        fail(503, 'Canonical ticket reads are unavailable.');
    const result = await ctx.ticketService.getTicket(ticketId);
    if (!result || !['intelligent-operations'].includes(result.ticketType || result.kind))
        fail(404, 'The owned Operations ticket is unavailable.');
    if (!statuses.includes(result.status) || !Number.isSafeInteger(result.revision) || result.revision < 0)
        fail(503, 'The current canonical ticket revision is unavailable.');
    return result;
}
function syncPlan(link, current) {
    const trigger = current.status + ':' + (current.position?.name || '-'), selected = link.mapping[trigger] || link.mapping[current.status + ':*'];
    if (!selected)
        return null;
    let operation, input, readOperation, readInput;
    if (link.provider === 'jira') {
        operation = 'jira-transition-issue';
        input = { issueKey: link.recordKey, transitionId: selected.action };
        readOperation = 'jira-get-issue';
        readInput = { issueKey: link.recordKey };
    }
    else if (link.provider === 'gitlab') {
        operation = 'gitlab-update-issue-state';
        input = { projectId: link.projectId, issueIid: link.recordKey, stateEvent: selected.action };
        readOperation = 'gitlab-get-issue';
        readInput = { projectId: link.projectId, issueIid: link.recordKey };
    }
    else {
        operation = 'servicenow-update-incident-state';
        input = { sysId: link.recordKey, state: selected.action };
        readOperation = 'servicenow-record';
        readInput = { table: 'incident', sysId: link.recordKey };
    }
    const body = { linkId: link.id, ticketId: link.ticketId, ticketRevision: current.revision, trigger, provider: link.provider, account: link.account, recordKey: link.recordKey, targetRevision: link.targetRevision, operation, input, readOperation, readInput, expectedState: selected.expectedState };
    return { ...body, id: hash(['ticket-sync-v1', body]) };
}
/** @description Save only immutable own-ticket linkage, never a second ticket engine or a provider credential. */
async function saveSyncLink(ctx, sub, input) {
    owner(sub);
    const link = syncLinkDefinition(input);
    await ticket(ctx, link.ticketId);
    return (0, pipeline_1.processingTransaction)(ctx.pool, async (c) => {
        const anchor = (await c.query('SELECT record FROM operations_sync_owners WHERE user_sub=$1 AND id=$2 FOR UPDATE', [sub, 'link-capacity'])).rows[0];
        if (!anchor)
            await c.query('INSERT INTO operations_sync_owners(user_sub,id,record) VALUES($1,$2,$3)', [sub, 'link-capacity', JSON.stringify({ bounded: true })]);
        const previous = (await c.query('SELECT record FROM operations_ticket_links WHERE user_sub=$1 AND id=$2', [sub, link.id])).rows[0]?.record;
        if (previous)
            return previous;
        const rows = (await c.query('SELECT id FROM operations_ticket_links WHERE user_sub=$1 LIMIT 33', [sub])).rows;
        if (rows.length >= 32)
            fail(409, 'This workbench holds at most 32 immutable links.');
        const record = { ...link, createdAt: new Date().toISOString(), direction: 'manual-outbound', credentialsStored: false };
        await c.query('INSERT INTO operations_ticket_links(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)', [sub, link.id, record.createdAt, JSON.stringify(record)]);
        return record;
    });
}
/** @description Read current canonical state and bounded own attempts. Missing state remains unavailable, never an actionable stale plan. */
async function syncRecords(ctx, sub) {
    owner(sub);
    const records = (await ctx.pool.query('SELECT record FROM operations_ticket_links WHERE user_sub=$1 ORDER BY created_at DESC,id LIMIT 33', [sub])).rows.map(r => r.record), items = [];
    for (const link of records.slice(0, 32)) {
        try {
            const current = await ticket(ctx, link.ticketId);
            items.push({ ...link, ticket: current, plan: syncPlan(link, current) });
        }
        catch {
            items.push({ ...link, ticketUnavailable: true, plan: null });
        }
    }
    const attempts = (await ctx.pool.query('SELECT record FROM operations_sync_attempts WHERE user_sub=$1 ORDER BY created_at DESC,id LIMIT 101', [sub])).rows.map(r => r.record);
    return { items, attempts: attempts.slice(0, 100), truncated: records.length > 32 || attempts.length > 100, deliveryProof: 'operator-reported only; native action/read results are shown in the initiating browser', automaticSync: false };
}
/** @description Reserve before leaving the application; no repeated dispatch authorization after an unknown transport or lost acknowledgement. */
async function reserveSync(ctx, sub, input) {
    owner(sub);
    closed(input, ['linkId', 'planId']);
    if (!id(input.linkId) || !id(input.planId))
        fail(400, 'Choose a current saved link and plan.');
    const link = (await ctx.pool.query('SELECT record FROM operations_ticket_links WHERE user_sub=$1 AND id=$2', [sub, input.linkId])).rows[0]?.record;
    if (!link)
        fail(404, 'The owned external link is unavailable.');
    const plan = syncPlan(link, await ticket(ctx, link.ticketId));
    if (!plan || plan.id !== input.planId)
        fail(409, 'The canonical phase/revision or mapping changed. Refresh before any external action.');
    return (0, pipeline_1.processingTransaction)(ctx.pool, async (c) => {
        const old = (await c.query('SELECT record FROM operations_sync_attempts WHERE user_sub=$1 AND id=$2 FOR UPDATE', [sub, plan.id])).rows[0]?.record;
        if (old)
            fail(409, 'This phase/revision already has an attempt. Reconcile its outcome; no repeat dispatch was authorized.');
        const record = { id: plan.id, linkId: link.id, createdAt: new Date().toISOString(), state: 'reserved-outcome-unknown', plan, provenance: 'native-dispatch-reservation', verifiedByServer: false };
        await c.query('INSERT INTO operations_sync_attempts(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)', [sub, record.id, record.createdAt, JSON.stringify(record)]);
        return record;
    });
}
/** @description Keep a clearly labeled original-operator report; client input never establishes server-verified provider delivery or changes canonical status/recovery. */
async function reportSync(ctx, sub, input) {
    owner(sub);
    closed(input, ['attemptId', 'outcome']);
    if (!id(input.attemptId) || !['readback-matched', 'accepted-unverified', 'uncertain', 'readback-conflict'].includes(input.outcome))
        fail(400, 'Use a bounded reported attempt outcome.');
    return (0, pipeline_1.processingTransaction)(ctx.pool, async (c) => {
        const row = (await c.query('SELECT record FROM operations_sync_attempts WHERE user_sub=$1 AND id=$2 FOR UPDATE', [sub, input.attemptId])).rows[0]?.record;
        if (!row)
            fail(404, 'The owned attempt is unavailable.');
        const record = { ...row, state: 'operator-reported-' + input.outcome, reportedAt: new Date().toISOString(), provenance: 'operator-report', verifiedByServer: false };
        await c.query('UPDATE operations_sync_attempts SET record=$3 WHERE user_sub=$1 AND id=$2', [sub, row.id, JSON.stringify(record)]);
        return record;
    });
}
