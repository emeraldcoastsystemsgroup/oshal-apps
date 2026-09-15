"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the two durable tables behind the app: a TASK
 *                     |                             | (a drafted skill plan with its rehearsal, its status and where
 *                     |                             | it stopped) and the COMMAND LOG (every command any actor issued
 *                     |                             | to any node, with its outcome). Owner-scoped SQL only; the
 *                     |                             | world itself is in memory and is not stored here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertTask = insertTask;
exports.getTask = getTask;
exports.listTasks = listTasks;
exports.updateTaskStatus = updateTaskStatus;
exports.insertLog = insertLog;
exports.listLog = listLog;
const TASK_COLUMNS = 'task_id, owner_sub, task, title, plan, rehearsal, status, current_step, failure, created_at, updated_at';
/**
 * @description Persist a drafted plan with its rehearsal.
 * @param pool - The pool.
 * @param sub - Owner.
 * @param plan - The plan.
 * @param rehearsal - Its rehearsal.
 * @returns The stored row.
 */
async function insertTask(pool, sub, plan, rehearsal) {
    const r = await pool.query(`INSERT INTO embodied_task (owner_sub, task, title, plan, rehearsal) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb) RETURNING ${TASK_COLUMNS}`, [sub, plan.task, plan.title, JSON.stringify(plan), JSON.stringify(rehearsal)]);
    return r.rows[0];
}
/** @description One task by id, owner-scoped. */
async function getTask(pool, sub, taskId) {
    const r = await pool.query(`SELECT ${TASK_COLUMNS} FROM embodied_task WHERE owner_sub = $1 AND task_id = $2`, [sub, taskId]);
    return r.rows[0] ?? null;
}
/** @description The owner's most recent tasks. */
async function listTasks(pool, sub, limit = 20) {
    const r = await pool.query(`SELECT ${TASK_COLUMNS} FROM embodied_task WHERE owner_sub = $1 ORDER BY created_at DESC LIMIT $2`, [sub, limit]);
    return r.rows;
}
/**
 * @description Record a status transition.
 * @param pool - The pool.
 * @param sub - Owner.
 * @param taskId - The task.
 * @param status - New status.
 * @param currentStep - Step index reached.
 * @param failure - Failure text when any.
 */
async function updateTaskStatus(pool, sub, taskId, status, currentStep, failure) {
    await pool.query('UPDATE embodied_task SET status = $3, current_step = $4, failure = $5, updated_at = now() WHERE owner_sub = $1 AND task_id = $2', [sub, taskId, status, currentStep, failure]);
}
/**
 * @description Append one command record.
 * @param pool - The pool.
 * @param sub - Owner.
 * @param taskId - The task the command belongs to, or null for manual work.
 * @param record - The record.
 */
async function insertLog(pool, sub, taskId, record) {
    await pool.query('INSERT INTO embodied_command_log (owner_sub, task_id, sim_ms, actor, node_id, command, params, outcome, reason) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)', [sub, taskId, Math.round(record.tMs), record.actor, record.nodeId, record.command, JSON.stringify(record.params ?? {}), record.outcome, record.reason ?? null]);
}
/** @description The owner's latest command records, newest first. */
async function listLog(pool, sub, limit = 100) {
    const r = await pool.query('SELECT log_id, task_id, sim_ms, actor, node_id, command, params, outcome, reason, created_at FROM embodied_command_log WHERE owner_sub = $1 ORDER BY log_id DESC LIMIT $2', [sub, limit]);
    return r.rows;
}
//# sourceMappingURL=task-store.js.map