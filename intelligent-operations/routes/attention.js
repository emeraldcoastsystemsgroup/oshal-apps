"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attentionSummary = attentionSummary;
exports.systemsSummary = systemsSummary;
exports.responsesSummary = responsesSummary;
exports.anomaliesSummary = anomaliesSummary;
/** CHANGE LOG: 2 | maintainer@emeraldcoastsystemsgroup.com | Jarvis-sized read-only summaries: systems health with scheduled discovery state, response plans with approval, execution and recovery state, and anomaly baselines; each bounded, from the person's own records, and says what to open next. */
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | One bounded, read-only summary of what waits on the person in Operations (response plans to approve, executions without verified recovery, overdue break-glass reconciliations, firing anomaly baselines, investigations started, refused or uncertain, processing that needs review, swarm hand-offs), so Jarvis and the Overview can answer "what needs my attention" from saved records only. */
// @ts-nocheck
const topology_store_1 = require("./topology-store");
const discovery_1 = require("./discovery");
const execution_1 = require("./execution");
const anomaly_engine_1 = require("./anomaly-engine");
const requireOwner = owner => { if (typeof owner !== 'string' || !owner.trim())
    throw Object.assign(Error('A verified caller is required.'), { status: 401 }); };
const rows = async (pool, sql, owner) => (await pool.query(sql, [owner])).rows.map(r => r.record);
/** @description Counts and short lines from the person's own saved records; nothing is run and no external system is read. */
async function attentionSummary(pool, owner, now = Date.now()) {
    requireOwner(owner);
    const plans = await rows(pool, 'SELECT record FROM operations_action_plans WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 64', owner);
    const approvals = await rows(pool, 'SELECT record FROM operations_action_approvals WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 200', owner);
    const executions = await rows(pool, 'SELECT record FROM operations_action_executions WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 200', owner);
    const promotions = await rows(pool, 'SELECT record FROM operations_git_promotions WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 100', owner);
    const investigations = await rows(pool, 'SELECT record FROM operations_investigations WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 100', owner);
    const delegations = await rows(pool, 'SELECT record FROM operations_delegations WHERE user_sub=$1 ORDER BY created_at DESC, id LIMIT 100', owner);
    const anomaly = (await pool.query('SELECT id, record FROM operations_anomaly_state WHERE user_sub=$1 LIMIT 400', [owner])).rows.filter(r => r.id.startsWith('baseline:')).map(r => r.record);
    const processing = (await pool.query('SELECT state FROM operations_processing WHERE user_sub=$1 LIMIT 500', [owner])).rows;
    const approved = new Set(approvals.filter(a => Date.parse(a.expiresAt) > now).map(a => a.planId)), executed = new Set(executions.map(e => e.planId));
    const count = (label, n, page, detail) => ({ label, count: n, page, detail: detail || null });
    const items = [
        count('Response plans awaiting your approval', plans.filter(p => !approved.has(p.id) && !executed.has(p.id)).length, 'incidents'),
        count('Executions without verified recovery', executions.filter(e => e.state !== 'reserved-outcome-unknown' && e.recovery?.outcome !== 'healthy').length, 'incidents'),
        count('Break-glass reconciliations overdue', promotions.filter(r => r.kind === 'break-glass-reconciliation' && !r.merged && Date.parse(r.deadline) < now).length, 'incidents'),
        count('Anomaly baselines firing', anomaly.filter(b => b.state?.firing === true).length, 'streams'),
        count('Investigations started automatically', investigations.filter(i => i.state === 'started' && i.trigger === 'scheduled-tick').length, 'data'),
        count('Automatic starts refused or uncertain', investigations.filter(i => ['start-refused', 'start-uncertain'].includes(i.state)).length, 'data', 'Open each in Data pipeline; a refused start says why, an uncertain one needs a check before starting again.'),
        count('Processing that needs review', processing.filter(p => ['attention', 'evidence-attention'].includes(p.state)).length, 'data'),
        count('Hand-offs sent to other swarms', delegations.filter(d => d.direction === 'outbound' && d.state === 'delivered').length, 'swarms'),
        count('Hand-offs that failed to send', delegations.filter(d => d.direction === 'outbound' && d.state === 'delivery-failed').length, 'swarms'),
        count('Delegations from other swarms filed as investigations', delegations.filter(d => d.direction === 'inbound' && d.ticketId).length, 'swarms')
    ];
    const needs = items.filter(i => i.count > 0 && !/^(Hand-offs sent|Delegations from other swarms filed|Investigations started automatically)/.test(i.label));
    return { asOf: new Date(now).toISOString(), items, summary: needs.length ? needs.map(i => i.count + ' ' + i.label.toLowerCase()).join('; ') + '.' : 'Nothing in Operations is waiting on you.', source: 'your own saved Operations records; nothing was run', executionAuthorized: false };
}
const local = v => v || null;
/** @description Inventory health for Jarvis: counts by health, the degraded and unknown assets (at most 25), and scheduled discovery's state. */
async function systemsSummary(pool, owner) {
    requireOwner(owner);
    const graph = await (0, topology_store_1.readGraph)(pool, owner), discovery = await (0, discovery_1.discoveryConfig)(pool, owner), assets = graph.assets || [];
    const by = h => assets.filter(a => a.health === h);
    const pick = a => ({ name: a.name, kind: a.kind, provider: a.provider, scope: a.scope, health: a.health, namespace: a.properties?.namespace || null, pressure: a.properties?.pressure || null, observedAt: local(a.observedAt) });
    const issues = [...by('degraded'), ...by('unknown')].slice(0, 25).map(pick);
    const d = discovery.enabled ? { enabled: true, namespace: discovery.namespace, intervalMinutes: discovery.intervalMinutes, last: discovery.lastResult || null } : { enabled: false };
    const summary = assets.length + ' assets: ' + by('healthy').length + ' healthy, ' + by('degraded').length + ' degraded, ' + by('unknown').length + ' unknown. ' + (d.enabled ? (d.last?.state === 'saved' ? 'Scheduled discovery last saved ' + d.last.assets + ' assets at ' + d.last.observedAt + '.' : 'Scheduled discovery is on' + (d.last ? ' but its last read was ' + d.last.state + ': ' + d.last.error : ' and waiting for its first read') + '.') : 'Scheduled discovery is off; turn it on in Systems to keep the inventory current.');
    return { summary, counts: { assets: assets.length, healthy: by('healthy').length, degraded: by('degraded').length, unknown: by('unknown').length }, issues, truncated: by('degraded').length + by('unknown').length > 25, discovery: d, open: 'Systems', source: 'your own saved inventory and discovery setting; nothing was read from a cluster now', executionAuthorized: false };
}
/** @description Response plans for Jarvis: target, approval, executions and verified recovery for the 20 newest plans. */
async function responsesSummary(ctx, owner) {
    const r = await (0, execution_1.responseRecords)(ctx, owner), now = Date.now();
    const plans = r.items.map(p => { const ex = p.executions || [], last = ex[0] || null; return { planId: p.id, ticket: p.ticket?.title || p.ticketId || null, target: p.target ? ((p.target.namespace || '') + '/' + (p.target.pod || '') + (p.target.container ? ' · ' + p.target.container : '')) : null, artifacts: (p.artifacts || []).map(a => a.name), approval: p.invalidated ? 'invalidated by a ticket change' : !p.approval ? 'not approved' : p.approval.expired || Date.parse(p.approval.expiresAt) <= now ? 'approval expired' : 'approved until ' + p.approval.expiresAt, executions: ex.length, lastExecution: last ? { state: last.state, exitCode: last.result?.exitCode ?? null, recovery: last.recovery?.outcome || 'not measured' } : null }; });
    const waiting = plans.filter(p => p.approval === 'not approved' && !p.executions).length, unverified = plans.filter(p => p.lastExecution && p.lastExecution.recovery !== 'healthy').length;
    return { summary: plans.length + ' response plans: ' + waiting + ' waiting for your approval, ' + unverified + ' executed without verified recovery.', plans, truncated: r.truncated, open: 'Incident work', approveAndRunIn: 'Incident work, with a fresh confirmation; Jarvis cannot approve or run a plan', executionAuthorized: false };
}
/** @description Anomaly baselines for Jarvis: firing first, then readiness, at most 25. */
async function anomaliesSummary(pool, owner) {
    const r = await (0, anomaly_engine_1.anomalyRecords)(pool, owner), base = r.baselines || [];
    const rows = base.slice().sort((a, b) => Number(b.firing) - Number(a.firing) || Math.abs(b.lastScore || 0) - Math.abs(a.lastScore || 0)).slice(0, 25).map(b => ({ metric: b.name, resource: b.resource?.id || b.resource || null, readiness: b.readiness, firing: b.firing, lastScore: b.lastScore ?? null, samples: b.samples, lastObservedAt: b.lastObservedAt || null }));
    const firing = base.filter(b => b.firing).length, ready = base.filter(b => b.readiness === 'ready').length;
    return { summary: (r.config?.enabled ? 'Detection is on. ' : 'Detection is off. ') + base.length + ' baselines: ' + firing + ' firing, ' + ready + ' ready.', baselines: rows, truncated: base.length > 25, open: 'Live context', executionAuthorized: false };
}
