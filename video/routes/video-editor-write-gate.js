"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EDITOR_WRITE_QUEUE = void 0;
exports.acquireEditorWrite = acquireEditorWrite;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Admit one editor write transaction per pool before a client is checked out, so the current-authorization reads a write repeats before commit can always get the pool's second connection. Waiters are bounded (32) and time out (5 s) without holding a database client.
 */
const video_editor_types_1 = require("./video-editor-types");
const gates = new WeakMap();
exports.EDITOR_WRITE_QUEUE = Object.freeze({ maximum: 32, timeoutMs: 5000 });
/** Hand the single admission to the oldest live waiter; releasing twice is harmless. */
function releaseAdmission(gate) {
    let released = false;
    return () => {
        if (released)
            return;
        released = true;
        const next = gate.waiting.shift();
        if (!next) {
            gate.active = false;
            return;
        }
        clearTimeout(next.timer);
        next.resolve(releaseAdmission(gate));
    };
}
/**
 * @description Wait for this pool's single write admission (at most 32 waiters, five seconds each).
 * @param pool - The package pool. @returns A release function.
 */
function acquireEditorWrite(pool) {
    let gate = gates.get(pool);
    if (!gate) {
        gate = { active: false, waiting: [] };
        gates.set(pool, gate);
    }
    if (!gate.active) {
        gate.active = true;
        return Promise.resolve(releaseAdmission(gate));
    }
    if (gate.waiting.length >= exports.EDITOR_WRITE_QUEUE.maximum)
        return Promise.reject(new video_editor_types_1.EditorError(503, 'video_edit_write_queue_full'));
    const current = gate;
    return new Promise((resolve, reject) => {
        const waiter = { resolve, timer: setTimeout(() => {
                const index = current.waiting.indexOf(waiter);
                if (index >= 0)
                    current.waiting.splice(index, 1);
                reject(new video_editor_types_1.EditorError(503, 'video_edit_write_queue_timeout'));
            }, exports.EDITOR_WRITE_QUEUE.timeoutMs) };
        current.waiting.push(waiter);
    });
}
