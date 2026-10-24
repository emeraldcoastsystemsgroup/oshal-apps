"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.incidentTrace = incidentTrace;
/** CHANGE LOG: 1 | maintainer@emeraldcoastsystemsgroup.com | Read one canonical Operations ticket's exact owner-scoped incident lineage, with bounded indexed joins instead of recent global pages. */
// @ts-nocheck
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const ownerRequired = value => { if (typeof value !== 'string' || !value.trim())
    fail(401, 'A verified caller is required.'); };
const records = async (pool, sql, args, max = 20) => {
    const rows = (await pool.query(sql + ' LIMIT ' + (max + 1), args)).rows.map(row => row.record);
    return { items: rows.slice(0, max), truncated: rows.length > max };
};
const ids = items => [...new Set(items.map(item => item?.id).filter(value => typeof value === 'string' && value.length > 0))];
/** @description Ticket ownership is verified by the native ticket port first; every durable join also constrains user_sub. Empty exact sets mean no record, while any 20/100 cap is surfaced. */
async function incidentTrace(ctx, owner, ticketId) {
    ownerRequired(owner);
    if (!uuid(ticketId))
        fail(400, 'Choose a canonical Operations ticket.');
    if (typeof ctx.ticketService?.getTicket !== 'function')
        fail(503, 'Canonical ticket reads are unavailable.');
    const ticket = await ctx.ticketService.getTicket(ticketId);
    if (!ticket || (ticket.ticketType || ticket.kind) !== 'intelligent-operations' || (ticket.id || ticket.ticketId) !== ticketId)
        fail(404, 'The owned Operations ticket is unavailable.');
    const pool = ctx.pool;
    const investigations = await records(pool, "SELECT record FROM operations_investigations WHERE user_sub=$1 AND record->>'ticketId'=$2 ORDER BY created_at DESC,id", [owner, ticketId]);
    const workIds = ids(investigations.items), deliveryIds = [...new Set(investigations.items.map(item => item.deliveryId).filter(Boolean))];
    const deliveries = deliveryIds.length ? await records(pool, 'SELECT record FROM operations_deliveries WHERE user_sub=$1 AND id=ANY($2::text[]) ORDER BY received_at DESC,id', [owner, deliveryIds]) : { items: [], truncated: false };
    const decisions = deliveryIds.length ? await records(pool, 'SELECT record FROM operations_filter_decisions WHERE user_sub=$1 AND delivery_id=ANY($2::text[]) ORDER BY created_at DESC,id', [owner, deliveryIds]) : { items: [], truncated: false };
    const correlations = deliveryIds.length ? await records(pool, "SELECT record FROM operations_topology_decisions WHERE user_sub=$1 AND (record->'deliveryIds') ?| $2::text[] ORDER BY created_at DESC,id", [owner, deliveryIds]) : { items: [], truncated: false };
    const evidenceWork = workIds.length ? await records(pool, 'SELECT record FROM operations_evidence_work WHERE user_sub=$1 AND id=ANY($2::text[]) ORDER BY created_at DESC,id', [owner, workIds]) : { items: [], truncated: false };
    const external = workIds.length ? await records(pool, 'SELECT record FROM operations_external_evidence WHERE user_sub=$1 AND id=ANY($2::text[]) ORDER BY created_at DESC,id', [owner, workIds]) : { items: [], truncated: false };
    const plans = await records(pool, "SELECT record FROM operations_action_plans WHERE user_sub=$1 AND record->>'ticketId'=$2 ORDER BY created_at DESC,id", [owner, ticketId]);
    const planIds = ids(plans.items);
    const approvals = planIds.length ? await records(pool, "SELECT record FROM operations_action_approvals WHERE user_sub=$1 AND record->>'planId'=ANY($2::text[]) ORDER BY created_at DESC,id", [owner, planIds], 100) : { items: [], truncated: false };
    const executions = planIds.length ? await records(pool, "SELECT record FROM operations_action_executions WHERE user_sub=$1 AND record->>'planId'=ANY($2::text[]) ORDER BY created_at DESC,id", [owner, planIds], 100) : { items: [], truncated: false };
    const responseItems = plans.items.map(plan => {
        const approval = approvals.items.find(item => item.planId === plan.id);
        return { ...plan, ticket, invalidated: Number.isSafeInteger(ticket.revision) ? ticket.revision !== plan.ticketRevision : null,
            approval: approval ? { ...approval, expired: Date.parse(approval.expiresAt) <= Date.now() } : null,
            executions: executions.items.filter(item => item.planId === plan.id),
            downloads: (Array.isArray(plan.artifacts) ? plan.artifacts : []).map(file => ({ name: file.name, sha256: file.sha256, bytes: file.bytes, path: '/executions/plans/' + plan.id + '/artifacts/' + file.name })) };
    });
    const links = await records(pool, "SELECT record FROM operations_ticket_links WHERE user_sub=$1 AND record->>'ticketId'=$2 ORDER BY created_at DESC,id", [owner, ticketId]);
    const linkIds = ids(links.items);
    const attempts = linkIds.length ? await records(pool, "SELECT record FROM operations_sync_attempts WHERE user_sub=$1 AND record->>'linkId'=ANY($2::text[]) ORDER BY created_at DESC,id", [owner, linkIds], 100) : { items: [], truncated: false };
    const limits = { investigations: investigations.truncated, deliveries: deliveries.truncated, decisions: decisions.truncated, correlations: correlations.truncated, evidenceWork: evidenceWork.truncated, external: external.truncated, plans: plans.truncated, approvals: approvals.truncated, executions: executions.truncated, links: links.truncated, attempts: attempts.truncated };
    return { ticket, data: { exact: true, investigations, records: { events: deliveries.items }, pipeline: { decisions: decisions.items, correlations: correlations.items, evidenceWork: evidenceWork.items }, responses: { items: responseItems, truncated: plans.truncated || approvals.truncated || executions.truncated }, sync: { items: links.items, attempts: attempts.items, truncated: links.truncated || attempts.truncated }, external, limits }, limits };
}
