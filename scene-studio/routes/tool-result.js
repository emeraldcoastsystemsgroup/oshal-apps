"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (0.2.0) — what an in-process package tool may
 *                     |                             | hand back, and how it fails. The kernel's package-tool registry
 *                     |                             | sets no timer and refuses a result over 256 KiB only AFTER the
 *                     |                             | handler ran, so an oversized reply to a write would hide a change
 *                     |                             | that already landed. Every tool therefore runs under a 285 s
 *                     |                             | deadline (inside the node bridge's 300 s fetch ceiling), replies
 *                     |                             | are bounded at 192 KiB (lists trimmed with honest counts, text
 *                     |                             | halved on a code-point boundary), deltas are capped per list with
 *                     |                             | their real counts, and a refusal carries the same code, field and
 *                     |                             | reason the routes answer with.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolFailure = exports.TOOL_RUN_ERRORS_SHOWN = exports.TOOL_DELTA_LIST_MAX = exports.TOOL_TEXT_READ_BYTES = exports.TOOL_RESULT_BUDGET_BYTES = exports.TOOL_DEADLINE_MS = void 0;
exports.toolFailure = toolFailure;
exports.withToolDeadline = withToolDeadline;
exports.clipUtf8 = clipUtf8;
exports.compactDelta = compactDelta;
exports.toolProject = toolProject;
exports.boundResult = boundResult;
const logger_1 = require("@/shared/logger");
const project_view_1 = require("./project-view");
const logger = (0, logger_1.createChildLogger)({ module: 'scene-studio-tool-result' });
/** @description A tool's wall clock: under the node bridge's 300 s fetch ceiling, with room for its three authorizations. */
exports.TOOL_DEADLINE_MS = 285_000;
/** @description The largest reply a tool hands the kernel (the registry refuses anything over 256 KiB after the work ran). */
exports.TOOL_RESULT_BUDGET_BYTES = 192 * 1024;
/** @description The most text scene-read-file returns from one file. */
exports.TOOL_TEXT_READ_BYTES = 96 * 1024;
/** @description Paths shown per delta list (added, modified, deleted); the real count rides along. */
exports.TOOL_DELTA_LIST_MAX = 50;
/** @description Error lines a project's last run shows in a project reply; the run's own reply carries all of them. */
exports.TOOL_RUN_ERRORS_SHOWN = 20;
/** Bytes the trimmed-count fields may add to a reply. */
const COUNTER_MARGIN_BYTES = 64;
/** Lists a reply may be trimmed from the end of, each with the field that counts what was dropped. */
const TRIMMABLE_LISTS = [['files', 'more'], ['projects', 'more'], ['revisions', 'moreRevisions']];
/** @description A refused or failed tool call: a stable code, the HTTP-equivalent status and the field at fault. */
class ToolFailure extends Error {
    code;
    status;
    field;
    constructor(code, status, message, field) {
        super(message);
        this.code = code;
        this.status = status;
        this.field = field;
        this.name = 'ToolFailure';
    }
}
exports.ToolFailure = ToolFailure;
function describe(code, field, text) {
    const where = typeof field === 'string' && field ? ` (${field})` : '';
    const detail = typeof text === 'string' && text && text !== code ? `: ${text}` : '';
    return `${code}${where}${detail}`;
}
function duration(ms) {
    return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}
/**
 * @description Turn whatever a tool's operation threw into the refusal the model reads: a known
 * refusal keeps the route's code, field and reason (`invalid_file (path): …`); anything else is
 * logged with its stack and answered with an opaque code so no internal detail reaches the model.
 * @param error - What the operation threw.
 * @param tool - The tool's name, for the log.
 * @returns The ToolFailure to throw.
 */
function toolFailure(error, tool) {
    if (error instanceof ToolFailure)
        return error;
    const classified = (0, project_view_1.classifyFailure)(error);
    if (classified) {
        const { error: code, field, reason, message } = classified.body;
        return new ToolFailure(String(code), classified.status, describe(String(code), field, reason ?? message), typeof field === 'string' ? field : undefined);
    }
    logger.error({ err: error, tool }, 'Scene Studio tool failed unexpectedly');
    return new ToolFailure('scene_tool_failed', 500, `scene_tool_failed: ${tool} failed unexpectedly; the cause is in the api log`);
}
/**
 * @description Run one tool operation against a wall clock. On expiry the call is refused with
 * `tool_deadline_exceeded`; the operation is not cancelled (the engine may still finish, and a change
 * it finishes lands as a revision), so its late outcome is caught and logged — never an unhandled
 * rejection. The timer is unref'd and cleared on settle.
 * @param tool - The tool's name (message and log).
 * @param ms - The deadline in milliseconds.
 * @param run - The operation.
 * @returns The operation's value. @throws ToolFailure tool_deadline_exceeded, or what the operation threw.
 */
function withToolDeadline(tool, ms, run) {
    return new Promise((resolve, reject) => {
        let late = false;
        const timer = setTimeout(() => {
            late = true;
            logger.warn({ tool, deadlineMs: ms }, 'Scene Studio tool passed its deadline');
            reject(new ToolFailure('tool_deadline_exceeded', 504, `tool_deadline_exceeded: Scene Studio did not finish ${tool} within ${duration(ms)}; `
                + 'the engine may still be working and a change it finishes still lands as a revision. Read the project before retrying.'));
        }, ms);
        timer.unref();
        Promise.resolve().then(run).then((value) => {
            if (late) {
                logger.warn({ tool }, 'Scene Studio tool finished after its deadline');
                return;
            }
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            if (late) {
                logger.error({ err: error, tool }, 'Scene Studio tool failed after its deadline');
                return;
            }
            clearTimeout(timer);
            reject(error);
        });
    });
}
/**
 * @description Cut UTF-8 text to at most `maxBytes` without splitting a character.
 * @param text - The text.
 * @param maxBytes - The byte budget.
 * @returns The text that fits, its byte length, and whether anything was cut.
 */
function clipUtf8(text, maxBytes) {
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length <= maxBytes)
        return { text, shownBytes: bytes.length, truncated: false };
    let end = Math.max(0, Math.floor(maxBytes));
    while (end > 0 && (bytes[end] & 0xc0) === 0x80)
        end -= 1;
    return { text: bytes.subarray(0, end).toString('utf8'), shownBytes: end, truncated: true };
}
/**
 * @description Cap each list of an engine delta (`{added, modified, deleted}`) and keep the real counts,
 * so a change to thousands of files never floods a reply and the model still learns how many changed.
 * @param delta - The engine's delta (anything not a mapping is treated as empty).
 * @returns The capped lists, their full counts and whether any list was cut.
 */
function compactDelta(delta) {
    const lists = [];
    const counts = [];
    let truncated = false;
    if (delta && typeof delta === 'object' && !Array.isArray(delta)) {
        for (const [key, list] of Object.entries(delta)) {
            const items = Array.isArray(list) ? list.map((item) => String(item)) : [];
            counts.push([key, items.length]);
            lists.push([key, items.slice(0, exports.TOOL_DELTA_LIST_MAX)]);
            if (items.length > exports.TOOL_DELTA_LIST_MAX)
                truncated = true;
        }
    }
    return { delta: Object.fromEntries(lists), deltaCounts: Object.fromEntries(counts), deltaTruncated: truncated };
}
/**
 * @description The public project for a tool reply: the last run is summarised (counts plus the first
 * error lines) because godot-run-project's own reply already carries the whole run.
 * @param p - The stored project row.
 * @returns The public project with a compact lastRun.
 */
function toolProject(p) {
    const view = (0, project_view_1.publicProject)(p);
    const run = p.last_run;
    if (!run || typeof run !== 'object')
        return view;
    const output = Array.isArray(run.output) ? run.output : [];
    const errors = Array.isArray(run.errors) ? run.errors : [];
    return {
        ...view,
        lastRun: {
            revision: run.revision ?? null, seconds: run.seconds ?? null, scene: run.scene ?? null, at: run.at ?? null,
            outputLines: output.length, errorLines: errors.length, errors: errors.slice(0, exports.TOOL_RUN_ERRORS_SHOWN),
        },
    };
}
function sizeOf(value) {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
}
function trimList(value, key, counter) {
    const list = value[key];
    if (!Array.isArray(list) || !list.length)
        return value;
    let excess = sizeOf(value) - exports.TOOL_RESULT_BUDGET_BYTES + COUNTER_MARGIN_BYTES;
    let keep = list.length;
    while (keep > 0 && excess > 0) {
        keep -= 1;
        excess -= sizeOf(list[keep]) + 1;
    }
    const prior = typeof value[counter] === 'number' ? value[counter] : 0;
    return { ...value, [key]: list.slice(0, keep), [counter]: prior + (list.length - keep) };
}
function halveText(value) {
    if (typeof value.text !== 'string')
        return value;
    let current = value;
    let shown = Buffer.byteLength(value.text, 'utf8');
    while (sizeOf(current) > exports.TOOL_RESULT_BUDGET_BYTES && shown > 0) {
        const clipped = clipUtf8(current.text, Math.floor(shown / 2));
        shown = clipped.shownBytes;
        current = { ...current, text: clipped.text, truncated: true, shownBytes: clipped.shownBytes };
    }
    return current;
}
/**
 * @description Keep a reply inside TOOL_RESULT_BUDGET_BYTES. A reply that fits is returned as is;
 * otherwise lists are trimmed from the end (files and projects, counted in `more`; the oldest
 * revisions, counted in `moreRevisions`) and a text reply is halved (truncated: true, shownBytes).
 * @param tool - The tool's name (refusal and log).
 * @param value - The operation's reply.
 * @returns A reply within the budget. @throws ToolFailure tool_result_too_large when nothing trimmable is left.
 */
function boundResult(tool, value) {
    let current = value;
    for (const [key, counter] of TRIMMABLE_LISTS) {
        if (sizeOf(current) <= exports.TOOL_RESULT_BUDGET_BYTES)
            return current;
        current = trimList(current, key, counter);
    }
    current = halveText(current);
    if (sizeOf(current) <= exports.TOOL_RESULT_BUDGET_BYTES)
        return current;
    logger.warn({ tool, bytes: sizeOf(current) }, 'Scene Studio tool reply is over the result budget');
    throw new ToolFailure('tool_result_too_large', 413, `tool_result_too_large: the ${tool} reply is over ${exports.TOOL_RESULT_BUDGET_BYTES} bytes and could not be `
        + 'trimmed; anything the tool changed has landed — read the project (scene-get-project) before retrying.');
}
//# sourceMappingURL=tool-result.js.map