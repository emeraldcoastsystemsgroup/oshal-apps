"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preparePlan = preparePlan;
exports.approvePlan = approvePlan;
exports.reserveExecution = reserveExecution;
exports.reportExecution = reportExecution;
exports.reserveVerification = reserveVerification;
exports.reportVerification = reportVerification;
exports.recordTicketUpdate = recordTicketUpdate;
exports.responseRecords = responseRecords;
exports.artifactContent = artifactContent;
exports.executionReceipt = executionReceipt;
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Include each plan's Git promotions (standard path or break-glass reconciliation) in the response page. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Response stage: persist workflow-generated response files byte-exact with provenance, bind an approval to exact artifact digests/target/principal/ticket revision with an expiry, reserve one exec dispatch per approval before the browser's confirmed native action, record operator-reported action/verification receipts without server proof, compute recovery outcomes from the verification result plus a resolved admitted signal, and re-read the canonical ticket to record its update. */
// @ts-nocheck
const node_crypto_1 = require("node:crypto");
const intake_1 = require("./intake");
const pipeline_1 = require("./pipeline");
const topology_store_1 = require("./topology-store");
const promotion_1 = require("./promotion");
const Artifacts = require('../ui/response-artifacts.js');
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const sha = value => (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
const id64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const clean = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
const requireOwner = owner => { if (typeof owner !== 'string' || !owner.trim())
    fail(401, 'A verified caller is required.'); };
const closed = (input, fields) => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !fields.includes(k)))
    fail(400, 'Supply only the supported response fields.'); };
const APPROVAL_SECONDS = 1800, RECOVERY_WINDOW_SECONDS = 900, MAX_VERIFICATIONS = 10;
const clip = (value, limit) => { const text = typeof value === 'string' ? value : ''; return { text: Buffer.from(text).subarray(0, limit).toString(), originalBytes: Buffer.byteLength(text), truncated: Buffer.byteLength(text) > limit }; };
async function ticket(ctx, ticketId) {
    if (typeof ctx.ticketService?.getTicket !== 'function')
        fail(503, 'Canonical ticket reads are unavailable.');
    const result = await ctx.ticketService.getTicket(ticketId);
    if (!result || !['intelligent-operations'].includes(result.ticketType || result.kind))
        fail(404, 'The owned Operations ticket is unavailable.');
    if (typeof result.status !== 'string' || !Number.isSafeInteger(result.revision) || result.revision < 0)
        fail(503, 'The current canonical ticket revision is unavailable.');
    return result;
}
function target(input) {
    closed(input, ['namespace', 'pod', 'uid', 'container']);
    if (![input.namespace, input.pod, input.uid, input.container].every(v => clean(v, 253)))
        fail(400, 'Supply the exact namespace, pod name, pod UID and container.');
    return { namespace: input.namespace, pod: input.pod, uid: input.uid, container: input.container };
}
/** @description A target is only an asset the caller's own recorded inventory has observed; never a free-text cluster location. */
async function observedPod(ctx, owner, t) {
    const graph = await (0, topology_store_1.readGraph)(ctx.pool, owner);
    const match = (graph.assets || []).find(a => a.provider === 'kubernetes' && a.kind === 'pod' && a.nativeId === t.uid && a.name === t.pod && (a.properties?.namespace == null || a.properties.namespace === t.namespace));
    if (!match)
        fail(409, 'The target pod is not an observed asset in your recorded inventory. Import a current scan before planning a response.');
    return { scope: match.scope, observedHealth: match.health, graphRevision: graph.revision };
}
const script = content => ['/bin/sh', '-eu', '-c', content];
/** @description Freeze the exact response plan: artifacts, their digests, the target and the canonical revision they were generated under. */
async function preparePlan(ctx, owner, input) {
    requireOwner(owner);
    closed(input, ['ticketId', 'workId', 'phase', 'answer', 'target']);
    if (!uuid(input.ticketId) || !uuid(input.workId) || !clean(input.phase, 40) || typeof input.answer !== 'string' || !input.answer.length)
        fail(400, 'Choose an owned ticket, its completed work record and the accepted answer.');
    if (Buffer.byteLength(input.answer) > 262144)
        fail(413, 'The accepted answer exceeds 256 KiB.');
    const t = target(input.target), current = await ticket(ctx, input.ticketId);
    if (!['awaiting_approval', 'done'].includes(current.status))
        fail(409, 'Plan a response only from a workflow that reached its report gate or acceptance.');
    const observed = await observedPod(ctx, owner, t), extracted = Artifacts.extract(input.answer, sha);
    if (!extracted.executable)
        fail(422, 'The accepted answer has no complete generated response file set: ' + [...extracted.missing.map(m => 'missing ' + m), ...extracted.problems].join('; '));
    const investigation = (await ctx.pool.query("SELECT record FROM operations_investigations WHERE user_sub=$1 AND record->>'ticketId'=$2 LIMIT 1", [owner, input.ticketId])).rows[0]?.record || null;
    const delivery = investigation ? (await ctx.pool.query('SELECT record FROM operations_deliveries WHERE user_sub=$1 AND id=$2', [owner, investigation.deliveryId])).rows[0]?.record : null;
    const alert = delivery?.normalized ? { deliveryId: delivery.id, alertType: delivery.normalized.data.alertType, resource: delivery.normalized.data.resource, time: delivery.normalized.time } : null;
    const files = extracted.artifacts.map(a => ({ name: a.name, sha256: a.sha256, bytes: a.bytes, language: a.language, range: a.range, origin: 'workflow-answer-section' }));
    const remediate = extracted.artifacts.find(a => a.name === 'remediate.sh'), verify = extracted.artifacts.find(a => a.name === 'verify.sh');
    const body = { ticketId: current.ticketId || current.id || input.ticketId, ticketRevision: current.revision, ticketStatus: current.status, workId: input.workId, phase: input.phase, answerSha256: sha(input.answer), answerBytes: Buffer.byteLength(input.answer), target: t, targetObserved: observed, targetMatchesAlert: alert ? alert.resource?.id === t.uid : null, alert, artifacts: files,
        dispatch: { operation: 'kubernetes-exec', input: { ...t, argv: script(remediate.content) } }, verification: { operation: 'kubernetes-exec', input: { ...t, argv: script(verify.content) } }, readback: { operation: 'kubernetes-inspect-pod', input: { namespace: t.namespace, pod: t.pod, uid: t.uid } } };
    const planId = (0, intake_1.hash)(['action-plan-v1', body]);
    return (0, pipeline_1.processingTransaction)(ctx.pool, async (c) => {
        const previous = (await c.query('SELECT record FROM operations_action_plans WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, planId])).rows[0]?.record;
        if (previous)
            return previous;
        const count = (await c.query('SELECT count(*)::int AS n FROM operations_action_plans WHERE user_sub=$1', [owner])).rows[0].n;
        if (count >= 64)
            fail(409, 'This workbench holds at most 64 response plans.');
        const record = { ...body, id: planId, createdAt: new Date().toISOString(), answerProvenance: 'operator-forwarded-canonical-work', answerVerifiedByServer: false, executionAuthorized: false, sourceLabel: 'Generated by workflow phase ' + input.phase + ' of ticket ' + body.ticketId };
        await c.query('INSERT INTO operations_action_plans(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)', [owner, planId, record.createdAt, JSON.stringify(record)]);
        for (const a of extracted.artifacts)
            await c.query('INSERT INTO operations_action_artifacts(user_sub,plan_id,name,sha256,content) VALUES($1,$2,$3,$4,$5)', [owner, planId, a.name, a.sha256, Buffer.from(a.content)]);
        return record;
    });
}
async function plan(pool, owner, planId, c = pool) { if (!id64(planId))
    fail(400, 'Choose a saved response plan.'); const row = (await c.query('SELECT record FROM operations_action_plans WHERE user_sub=$1 AND id=$2', [owner, planId])).rows[0]?.record; if (!row)
    fail(404, 'The owned response plan is unavailable.'); return row; }
/** @description Approval binds principal, exact artifact digests, target and canonical revision, and expires; a changed revision invalidates it before anything runs. */
async function approvePlan(ctx, owner, input) {
    requireOwner(owner);
    closed(input, ['planId']);
    const p = await plan(ctx.pool, owner, input.planId), current = await ticket(ctx, p.ticketId);
    if (current.revision !== p.ticketRevision)
        fail(409, 'The canonical ticket revision changed since this plan was generated. Prepare a new plan; no approval was granted.');
    if (!['awaiting_approval', 'done'].includes(current.status))
        fail(409, 'The canonical ticket is no longer at its report gate or accepted.');
    return (0, pipeline_1.processingTransaction)(ctx.pool, async (c) => {
        await c.query('SELECT 1 FROM operations_action_plans WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, p.id]);
        const now = Date.now(), existing = (await c.query("SELECT record FROM operations_action_approvals WHERE user_sub=$1 AND record->>'planId'=$2 ORDER BY created_at DESC LIMIT 1", [owner, p.id])).rows[0]?.record;
        if (existing && existing.state === 'granted' && Date.parse(existing.expiresAt) > now)
            return existing;
        const body = { planId: p.id, principal: owner, ticketId: p.ticketId, ticketRevision: p.ticketRevision, artifacts: p.artifacts.map(a => ({ name: a.name, sha256: a.sha256 })), target: p.target, grantedAt: new Date(now).toISOString(), expiresAt: new Date(now + APPROVAL_SECONDS * 1000).toISOString() };
        const record = { ...body, id: (0, intake_1.hash)(['action-approval-v1', body]), state: 'granted', oneShot: true, reportAcceptance: false };
        await c.query('INSERT INTO operations_action_approvals(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)', [owner, record.id, record.grantedAt, JSON.stringify(record)]);
        return record;
    });
}
/** @description One reservation per approval, written before the browser's confirmed native dispatch; an unknown outcome is never a license to dispatch again. */
async function reserveExecution(ctx, owner, input) {
    requireOwner(owner);
    closed(input, ['approvalId', 'account']);
    if (!id64(input.approvalId) || !clean(input.account, 128))
        fail(400, 'Choose a granted approval and your exact Kubernetes connection account.');
    return (0, pipeline_1.processingTransaction)(ctx.pool, async (c) => {
        const approval = (await c.query('SELECT record FROM operations_action_approvals WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, input.approvalId])).rows[0]?.record;
        if (!approval)
            fail(404, 'The owned approval is unavailable.');
        if (approval.principal !== owner || approval.state !== 'granted')
            fail(403, 'Only the approving person may dispatch this approval, and only while it is granted.');
        if (Date.parse(approval.expiresAt) <= Date.now())
            fail(409, 'This approval expired. Review and approve the exact plan again.');
        const p = await plan(ctx.pool, owner, approval.planId, c), current = await ticket(ctx, p.ticketId);
        if (current.revision !== p.ticketRevision || p.artifacts.some((a, i) => approval.artifacts[i]?.sha256 !== a.sha256))
            fail(409, 'The canonical revision or artifact digests changed after approval. Nothing was dispatched.');
        const executionId = (0, intake_1.hash)(['action-execution-v1', { approvalId: approval.id }]);
        if ((await c.query('SELECT 1 FROM operations_action_executions WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, executionId])).rows.length)
            fail(409, 'This approval already has a reserved dispatch. Reconcile its outcome; no repeat dispatch was authorized.');
        const record = { id: executionId, planId: p.id, approvalId: approval.id, ticketId: p.ticketId, ticketRevision: p.ticketRevision, createdAt: new Date().toISOString(), state: 'reserved-outcome-unknown', dispatch: { ...p.dispatch, account: input.account }, readback: p.readback, action: null, verifications: [], recovery: { outcome: 'not-verified' }, ticketUpdate: null, provenance: 'native-dispatch-reservation', verifiedByServer: false };
        await c.query('INSERT INTO operations_action_executions(user_sub,id,created_at,record) VALUES($1,$2,$3,$4)', [owner, executionId, record.createdAt, JSON.stringify(record)]);
        return record;
    });
}
function receipt(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result))
        fail(400, 'Supply the bounded native action result.');
    const outcome = ['completed', 'failed', 'unknown'].includes(result.outcome) ? result.outcome : 'unknown';
    const exitCode = Number.isSafeInteger(result.exitCode) ? result.exitCode : null;
    return { outcome, exitCode, stdout: clip(result.stdout, 4000), stderr: clip(result.stderr, 2000), observedAt: typeof result.observedAt === 'string' ? result.observedAt.slice(0, 64) : null, observedUid: typeof result.target?.observedUid === 'string' ? result.target.observedUid.slice(0, 128) : null, transport: typeof result.transport === 'string' ? result.transport.slice(0, 64) : null, reportedAt: new Date().toISOString(), provenance: 'operator-report', verifiedByServer: false };
}
async function execution(c, owner, executionId) { if (!id64(executionId))
    fail(400, 'Choose a reserved execution.'); const row = (await c.query('SELECT record FROM operations_action_executions WHERE user_sub=$1 AND id=$2 FOR UPDATE', [owner, executionId])).rows[0]?.record; if (!row)
    fail(404, 'The owned execution is unavailable.'); return row; }
/** @description The action receipt is the operator's report of the native answer; it never changes canonical status or counts as recovery. */
async function reportExecution(ctx, owner, input) {
    requireOwner(owner);
    closed(input, ['executionId', 'result']);
    return (0, pipeline_1.processingTransaction)(ctx.pool, async (c) => {
        const row = await execution(c, owner, input.executionId);
        if (row.state !== 'reserved-outcome-unknown')
            fail(409, 'This dispatch already has a reported outcome.');
        const action = receipt(input.result), identity = action.observedUid === null || action.observedUid === row.dispatch.input.uid;
        const state = action.outcome === 'completed' && action.exitCode === 0 && identity ? 'completed' : action.outcome === 'unknown' || !identity ? 'uncertain' : 'failed';
        const record = { ...row, state, action: { ...action, targetIdentityMatched: identity }, recovery: { outcome: 'not-verified' } };
        await c.query('UPDATE operations_action_executions SET record=$3 WHERE user_sub=$1 AND id=$2', [owner, row.id, JSON.stringify(record)]);
        return record;
    });
}
/** @description Verification is a reserved read-only command plus a current pod readback; at most ten attempts. */
async function reserveVerification(ctx, owner, input) {
    requireOwner(owner);
    closed(input, ['executionId']);
    return (0, pipeline_1.processingTransaction)(ctx.pool, async (c) => {
        const row = await execution(c, owner, input.executionId), p = await plan(ctx.pool, owner, row.planId, c);
        if (row.state === 'reserved-outcome-unknown')
            fail(409, 'Report the action outcome before verifying recovery.');
        if (row.verifications.some(v => v.state === 'reserved-outcome-unknown'))
            fail(409, 'A verification is already reserved. Report its outcome first.');
        if (row.verifications.length >= MAX_VERIFICATIONS)
            fail(409, 'The verification budget for this execution is exhausted.');
        const verification = { id: (0, node_crypto_1.randomUUID)(), index: row.verifications.length, createdAt: new Date().toISOString(), state: 'reserved-outcome-unknown', dispatch: { ...p.verification, account: row.dispatch.account }, readback: row.readback };
        const record = { ...row, verifications: [...row.verifications, verification] };
        await c.query('UPDATE operations_action_executions SET record=$3 WHERE user_sub=$1 AND id=$2', [owner, row.id, JSON.stringify(record)]);
        return verification;
    });
}
/** @description A resolved source symptom for the same resource, admitted after the action, is the signal half of recovery; command success alone is not recovery. */
async function resolvedSignal(c, owner, p, since) {
    const rows = (await c.query("SELECT record FROM operations_deliveries WHERE user_sub=$1 AND received_at>$2 AND record->>'decision'='validated' AND record->'normalized'->'data'->>'status'='resolved' AND record->'normalized'->'data'->'resource'->>'id'=$3 ORDER BY received_at DESC LIMIT 20", [owner, since, p.target.uid])).rows.map(r => r.record);
    const match = rows.find(r => !p.alert || r.normalized.data.alertType === p.alert.alertType);
    return match ? { resolved: true, deliveryId: match.id, alertType: match.normalized.data.alertType, receivedAt: match.receivedAt } : { resolved: false, checkedAt: new Date().toISOString(), window: 'validated resolved deliveries for the same resource since the action report' };
}
function outcome(check, readback, signal, action) {
    const elapsed = (Date.now() - Date.parse(action.reportedAt)) / 1000;
    if (check.outcome === 'unknown' || !readback.identityMatched)
        return { outcome: 'inconclusive', reason: check.outcome === 'unknown' ? 'the verification command has an unknown remote outcome' : 'the pod readback did not return the same identity' };
    if (check.exitCode !== 0)
        return { outcome: 'regressed', reason: 'the verification command failed (exit ' + check.exitCode + ')' };
    if (signal.resolved)
        return { outcome: 'healthy', reason: 'verification command passed and a resolved signal for the same resource was admitted after the action' };
    if (elapsed > RECOVERY_WINDOW_SECONDS)
        return { outcome: 'timed-out', reason: 'no resolved signal for the resource within ' + RECOVERY_WINDOW_SECONDS + ' seconds of the action' };
    return { outcome: 'inconclusive', reason: 'verification command passed; no resolved signal for the resource has been admitted yet' };
}
async function reportVerification(ctx, owner, input) {
    requireOwner(owner);
    closed(input, ['executionId', 'verificationId', 'result', 'readback']);
    return (0, pipeline_1.processingTransaction)(ctx.pool, async (c) => {
        const row = await execution(c, owner, input.executionId), p = await plan(ctx.pool, owner, row.planId, c), index = row.verifications.findIndex(v => v.id === input.verificationId && v.state === 'reserved-outcome-unknown');
        if (index < 0)
            fail(404, 'The reserved verification is unavailable or already reported.');
        const check = receipt(input.result), pod = input.readback && typeof input.readback === 'object' ? input.readback.pod : null;
        const readback = { observedAt: typeof input.readback?.observedAt === 'string' ? input.readback.observedAt.slice(0, 64) : null, uid: typeof pod?.uid === 'string' ? pod.uid.slice(0, 128) : null, phase: typeof pod?.phase === 'string' ? pod.phase.slice(0, 40) : null, identityMatched: pod?.uid === p.target.uid, provenance: 'operator-report', verifiedByServer: false };
        const signal = await resolvedSignal(c, owner, p, row.action.reportedAt), decided = outcome(check, readback, signal, row.action);
        const verification = { ...row.verifications[index], state: 'reported', check, readback, signal, ...decided, reportedAt: new Date().toISOString() };
        const verifications = row.verifications.slice();
        verifications[index] = verification;
        const record = { ...row, verifications, recovery: { outcome: decided.outcome, reason: decided.reason, verificationId: verification.id, at: verification.reportedAt, signalVerifiedByServer: true, commandVerifiedByServer: false } };
        await c.query('UPDATE operations_action_executions SET record=$3 WHERE user_sub=$1 AND id=$2', [owner, row.id, JSON.stringify(record)]);
        return record;
    });
}
/** @description The ticket update is read back through the original ticket port, so this half is server-verified. */
async function recordTicketUpdate(ctx, owner, input) {
    requireOwner(owner);
    closed(input, ['executionId']);
    return (0, pipeline_1.processingTransaction)(ctx.pool, async (c) => {
        const row = await execution(c, owner, input.executionId), current = await ticket(ctx, row.ticketId);
        const record = { ...row, ticketUpdate: { status: current.status, revision: current.revision, position: current.position || null, readAt: new Date().toISOString(), verifiedByServer: true, recoveryOutcomeAtUpdate: row.recovery.outcome } };
        await c.query('UPDATE operations_action_executions SET record=$3 WHERE user_sub=$1 AND id=$2', [owner, row.id, JSON.stringify(record)]);
        return record;
    });
}
/** @description Bounded own-scope page with current canonical ticket states and download references; unreadable tickets stay explicit. */
async function responseRecords(ctx, owner) {
    requireOwner(owner);
    const plans = (await ctx.pool.query('SELECT record FROM operations_action_plans WHERE user_sub=$1 ORDER BY created_at DESC,id LIMIT 21', [owner])).rows.map(r => r.record);
    const approvals = (await ctx.pool.query('SELECT record FROM operations_action_approvals WHERE user_sub=$1 ORDER BY created_at DESC,id LIMIT 100', [owner])).rows.map(r => r.record);
    const executions = (await ctx.pool.query('SELECT record FROM operations_action_executions WHERE user_sub=$1 ORDER BY created_at DESC,id LIMIT 100', [owner])).rows.map(r => r.record);
    const items = [], promotions = await (0, promotion_1.promotionRecords)(ctx.pool, owner);
    for (const p of plans.slice(0, 20)) {
        let current = null, ticketUnavailable = false;
        try {
            current = await ticket(ctx, p.ticketId);
        }
        catch {
            ticketUnavailable = true;
        }
        const approval = approvals.filter(a => a.planId === p.id).map(a => ({ ...a, expired: Date.parse(a.expiresAt) <= Date.now() }))[0] || null;
        items.push({ ...p, ticket: current, ticketUnavailable, invalidated: current ? current.revision !== p.ticketRevision : null, approval, executions: executions.filter(e => e.planId === p.id), promotions: promotions.filter(r => r.planId === p.id), downloads: p.artifacts.map(a => ({ name: a.name, sha256: a.sha256, bytes: a.bytes, path: '/executions/plans/' + p.id + '/artifacts/' + a.name })) });
    }
    return { items, truncated: plans.length > 20, limit: 20, approvalSeconds: APPROVAL_SECONDS, recoveryWindowSeconds: RECOVERY_WINDOW_SECONDS, executionAuthority: 'original-person native Kubernetes connection, confirmed per action in the browser', automaticExecution: false };
}
/** @description Exact stored bytes for an authenticated own-scope download; the digest is rechecked before sending. */
async function artifactContent(ctx, owner, planId, name) {
    requireOwner(owner);
    if (!id64(planId) || !/^[a-z][a-z0-9-]{0,39}\.(sh|md)$/.test(name || ''))
        fail(400, 'Choose a saved response artifact.');
    const row = (await ctx.pool.query('SELECT sha256, content FROM operations_action_artifacts WHERE user_sub=$1 AND plan_id=$2 AND name=$3', [owner, planId, name])).rows[0];
    if (!row)
        fail(404, 'The owned response artifact is unavailable.');
    const content = Buffer.from(row.content);
    if (sha(content) !== row.sha256)
        fail(503, 'Stored artifact bytes no longer match their digest.');
    return { name, sha256: row.sha256, content, contentType: name.endsWith('.sh') ? 'text/x-shellscript; charset=utf-8' : 'text/markdown; charset=utf-8' };
}
/** @description The execution receipt is itself downloadable, with every operator-reported field labeled. */
async function executionReceipt(ctx, owner, executionId) {
    requireOwner(owner);
    if (!id64(executionId))
        fail(400, 'Choose a reserved execution.');
    const row = (await ctx.pool.query('SELECT record FROM operations_action_executions WHERE user_sub=$1 AND id=$2', [owner, executionId])).rows[0]?.record;
    if (!row)
        fail(404, 'The owned execution is unavailable.');
    const p = await plan(ctx.pool, owner, row.planId);
    return { schema: 'triagenorth-execution-receipt/1', execution: row, plan: { id: p.id, ticketId: p.ticketId, ticketRevision: p.ticketRevision, workId: p.workId, phase: p.phase, answerSha256: p.answerSha256, target: p.target, artifacts: p.artifacts }, labels: { actionAndVerificationCommands: 'operator-reported native results (verifiedByServer=false)', resolvedSignalAndTicketUpdate: 'server-read from own records and the canonical ticket port' } };
}
