"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrder = createOrder;
exports.getOrder = getOrder;
exports.pendingOrders = pendingOrders;
exports.claimOrder = claimOrder;
exports.finishOrder = finishOrder;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D3 as built (0.4.0): the design_order rows. A claim writes a token and reads it back, so two open tabs cannot both run one order.
 */
const node_crypto_1 = require("node:crypto");
const COLUMNS = 'id, project_id, action, input, status, claim, result, created_at, finished_at';
const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const iso = (v) => { const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toISOString() : String(v); };
const row = (r) => ({ id: String(r.id), project_id: String(r.project_id), action: String(r.action), input: j(r.input), status: String(r.status), claim: r.claim === null || r.claim === undefined ? null : String(r.claim), result: r.result === null || r.result === undefined ? null : j(r.result), created_at: iso(r.created_at), finished_at: r.finished_at ? iso(r.finished_at) : null });
/**
 * @description File an order.
 * @param pool - The pool. @param sub - The owner. @param projectId - The product. @param action - The action. @param input - The validated input.
 * @returns The new row.
 */
async function createOrder(pool, sub, projectId, action, input) {
    const id = (0, node_crypto_1.randomUUID)();
    const now = new Date().toISOString();
    await pool.query('INSERT INTO design_order (id, project_id, owner_sub, action, input, status, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)', [id, projectId, sub, action, JSON.stringify(input), 'pending', now]);
    return { id, project_id: projectId, action, input, status: 'pending', result: null, created_at: now, finished_at: null };
}
/**
 * @description One order, or null.
 * @param pool - The pool. @param sub - The owner. @param id - The order.
 * @returns The row or null.
 */
async function getOrder(pool, sub, id) {
    const r = await pool.query(`SELECT ${COLUMNS} FROM design_order WHERE owner_sub = $1 AND id = $2`, [sub, id]);
    return r.rows.length ? row(r.rows[0]) : null;
}
/**
 * @description The owner's pending orders younger than the age limit, oldest first.
 * @param pool - The pool. @param sub - The owner. @param maxAgeMs - Older orders are no longer offered.
 * @returns The rows.
 */
async function pendingOrders(pool, sub, maxAgeMs) {
    const r = await pool.query(`SELECT ${COLUMNS} FROM design_order WHERE owner_sub = $1 AND status = $2`, [sub, 'pending']);
    const since = Date.now() - maxAgeMs;
    return r.rows.map(row).filter((o) => new Date(o.created_at).getTime() >= since).sort((a, b) => a.created_at.localeCompare(b.created_at));
}
/**
 * @description Take a pending order for one page.
 * @param pool - The pool. @param sub - The owner. @param id - The order.
 * @returns The row when this call took it, null when another page did or it is gone.
 */
async function claimOrder(pool, sub, id) {
    const claim = (0, node_crypto_1.randomUUID)();
    await pool.query('UPDATE design_order SET status = $3, claim = $4 WHERE owner_sub = $1 AND id = $2 AND status = $5', [sub, id, 'running', claim, 'pending']);
    const after = await getOrder(pool, sub, id);
    return after && after.claim === claim ? after : null;
}
/**
 * @description Record what the engine answered.
 * @param pool - The pool. @param sub - The owner. @param id - The order. @param ok - Whether the action succeeded. @param result - The bounded reply.
 * @returns The row, or null when no running order has that id.
 */
async function finishOrder(pool, sub, id, ok, result) {
    const now = new Date().toISOString();
    await pool.query('UPDATE design_order SET status = $3, result = $4::jsonb, finished_at = $5 WHERE owner_sub = $1 AND id = $2 AND status = $6', [sub, id, ok ? 'done' : 'failed', JSON.stringify(result ?? null), now, 'running']);
    const after = await getOrder(pool, sub, id);
    return after && after.finished_at ? after : null;
}
//# sourceMappingURL=order-store.js.map