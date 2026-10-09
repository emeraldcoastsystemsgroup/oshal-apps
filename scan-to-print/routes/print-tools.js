"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | 0.7.0: the print service's agent tools run in-process as package
 *                     |                             | tools (executor builtin/package). As loopback api calls they could
 *                     |                             | never run on an enforce box: core sent the service secret and a
 *                     |                             | user header, and the application guard admits only a session or a
 *                     |                             | verified delegation (BACKLOG B18). Each handler runs in the api
 *                     |                             | under the caller's verified actor, read from the kernel on every
 *                     |                             | call and never from the input; reads a closed input; and calls the
 *                     |                             | same functions the print service routes call, with actor.sub as the
 *                     |                             | owner key. A print takes the same per-job lock and gives the same
 *                     |                             | refusals as the routes, starts only under the printer owner's
 *                     |                             | auto-start (read when the start would be sent) and is recorded
 *                     |                             | requested_by service. Its reply carries ok/status and the full
 *                     |                             | outcome, so an agent reports "uploaded, not started" truthfully.
 *                     |                             | Entry and exit are logged with the tool, ids, duration and outcome.
 *                     |                             | (Review: the computed ok/status are written after the print body,
 *                     |                             | so nothing in a reply can override them.)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRINT_TOOL_SPECS = exports.PrintToolError = void 0;
exports.readPrintToolInput = readPrintToolInput;
exports.createPrintToolHandlers = createPrintToolHandlers;
exports.registerPrintTools = registerPrintTools;
const logger_1 = require("@/shared/logger");
const data_dir_1 = require("./data-dir");
const job_outputs_1 = require("./job-outputs");
const job_store_1 = require("./job-store");
const print_routes_1 = require("./print-routes");
const print_service_1 = require("./print-service");
const service_routes_1 = require("./service-routes");
const logger = (0, logger_1.createChildLogger)({ module: 'scan-to-print-tools' });
/** @description A refused tool call: a stable code, an HTTP-like status and a sentence for the agent. */
class PrintToolError extends Error {
    code;
    status;
    constructor(code, status, message) {
        super(`${code}: ${message}`);
        this.code = code;
        this.status = status;
        this.name = 'PrintToolError';
    }
}
exports.PrintToolError = PrintToolError;
/**
 * @description Close a tool input: an object (or nothing) with only the named string fields.
 * @param spec - The tool.
 * @param input - What the agent sent.
 * @returns The fields, as strings.
 * @throws PrintToolError for anything else.
 */
function readPrintToolInput(spec, input) {
    const value = input === undefined || input === null ? {} : input;
    if (typeof value !== 'object' || Array.isArray(value))
        throw new PrintToolError('invalid_tool_input', 400, `${spec.name} takes an object`);
    const fields = value;
    const unknown = Object.keys(fields).filter((key) => !spec.allowed.includes(key));
    if (unknown.length)
        throw new PrintToolError('invalid_tool_input', 400, `${spec.name} does not take ${unknown.join(', ')}`);
    const out = {};
    for (const key of spec.allowed) {
        const v = fields[key];
        if (v === undefined || v === null || v === '') {
            if (spec.required.includes(key))
                throw new PrintToolError('invalid_tool_input', 400, `${spec.name} needs ${key}`);
            continue;
        }
        if (typeof v !== 'string')
            throw new PrintToolError('invalid_tool_input', 400, `${key} must be a string`);
        out[key] = v;
    }
    return out;
}
/** @description The person's printers, without addresses or secrets. */
async function printers(deps, sub) {
    const rows = await (0, job_store_1.listPrinters)(deps.pool, sub);
    return { printers: rows.map((p) => ({ printerId: p.printer_id, label: p.label, kind: p.kind, model: p.device_model, autoStart: p.auto_start, sliceProfile: p.slice_profile })) };
}
/** @description The person's scan jobs, with whether each current model is printable. */
async function jobs(deps, sub) {
    const rows = await (0, job_store_1.listJobs)(deps.pool, sub);
    return { jobs: rows.map((j) => ({ jobId: j.job_id, title: j.title, state: j.state, source: j.source_kind, printable: j.state === 'reconstructed' && j.report?.printable === true, updatedAt: j.updated_at })) };
}
/** @description One printer's live state, read from the printer. */
async function status(deps, sub, input) {
    const printer = await (0, print_service_1.loadPrinter)(deps.pool, sub, (0, data_dir_1.requireUuid)(input.printerId));
    if (!printer)
        throw new PrintToolError('printer_not_found', 404, 'no printer with that id belongs to this person');
    const state = await (0, print_service_1.printerState)((0, print_routes_1.serviceDepsOf)(deps), printer);
    return { ok: state.ok, printer: { printerId: printer.row.printer_id, label: printer.row.label, kind: printer.row.kind, autoStart: printer.row.auto_start }, status: state };
}
/** @description Print one job's current model, holding the job's write lock for the whole attempt. */
async function print(deps, sub, input) {
    const jobId = (0, data_dir_1.requireUuid)(input.jobId);
    const claim = (0, job_outputs_1.claimJobOperation)(deps, sub, jobId, 'write');
    if (!('release' in claim))
        return { ok: false, status: claim.status, ...claim.body };
    try {
        const job = await (0, job_store_1.getJob)(deps.pool, sub, jobId);
        if (!job)
            return { ok: false, status: 404, error: 'job_not_found' };
        const refusal = (0, job_outputs_1.currentOutputRefusal)(job, true);
        if (refusal)
            return { ok: false, status: refusal.status, ...refusal.body };
        const chosen = await (0, service_routes_1.choosePrinter)(deps, sub, input.printerId);
        if (!('printerId' in chosen))
            return { ok: false, status: chosen.status, ...chosen.body };
        const printer = await (0, print_service_1.loadPrinter)(deps.pool, sub, chosen.printerId);
        if (!printer)
            return { ok: false, status: 404, error: 'printer_not_found' };
        const result = await (0, print_routes_1.printJob)(deps, sub, job, { printerId: chosen.printerId, fileKind: 'gcode' }, (0, service_routes_1.autoStartNow)(deps, sub, chosen.printerId), 'service');
        const autoStart = await (0, service_routes_1.autoStartForReply)(deps, sub, chosen.printerId);
        return { ...result.body, ok: result.status < 400, status: result.status, printer: { printerId: printer.row.printer_id, label: printer.row.label, kind: printer.row.kind, autoStart } };
    }
    finally {
        claim.release();
    }
}
/** @description The five package tools, in manifest order. */
exports.PRINT_TOOL_SPECS = [
    { name: 'scan-to-print-capabilities', allowed: [], required: [], run: async (deps) => deps.capabilities() },
    { name: 'print-service-jobs', allowed: [], required: [], run: (deps, sub) => jobs(deps, sub) },
    { name: 'print-service-printers', allowed: [], required: [], run: (deps, sub) => printers(deps, sub) },
    { name: 'print-service-printer-status', allowed: ['printerId'], required: ['printerId'], run: status },
    { name: 'print-to-3d-printer', allowed: ['jobId', 'printerId'], required: ['jobId'], run: print },
];
/** @description Run one tool for the current actor; refuse before any query when there is none. */
async function runTool(spec, deps, currentActor, input) {
    const actor = currentActor();
    if (!actor || actor.isActive !== true || !actor.sub || !actor.issuer) {
        logger.warn({ tool: spec.name }, 'Scan to Print tool refused: no verified signed-in owner');
        throw new PrintToolError('signed_in_owner_required', 401, `${spec.name} runs only for a verified, active, signed-in person`);
    }
    const started = Date.now();
    try {
        const args = readPrintToolInput(spec, input);
        logger.info({ tool: spec.name, jobId: args.jobId ?? null, printerId: args.printerId ?? null }, 'Scan to Print tool started');
        const reply = await spec.run(deps, actor.sub, args);
        logger.info({ tool: spec.name, durationMs: Date.now() - started, ok: reply.ok ?? true, status: reply.status ?? 200 }, 'Scan to Print tool finished');
        return reply;
    }
    catch (error) {
        const failure = error instanceof PrintToolError ? error
            : error instanceof RangeError ? new PrintToolError('invalid_tool_input', 400, error.message)
                : new PrintToolError('tool_failed', 500, `${spec.name} failed`);
        if (failure.status >= 500)
            logger.error({ err: error, tool: spec.name, durationMs: Date.now() - started }, 'Scan to Print tool failed');
        else
            logger.warn({ tool: spec.name, durationMs: Date.now() - started, error: failure.code }, 'Scan to Print tool refused');
        throw failure;
    }
}
/**
 * @description Build the tool handlers. The actor is read from `currentActor` on every call and is never
 * taken from the input; the owner key is `actor.sub`, the same value the routes use.
 * @param deps - Print dependencies and the capabilities reader.
 * @param currentActor - The kernel's current application actor.
 * @returns Tool name → handler, in manifest order.
 */
function createPrintToolHandlers(deps, currentActor) {
    return new Map(exports.PRINT_TOOL_SPECS.map((spec) => [spec.name, (input) => runTool(spec, deps, currentActor, input)]));
}
/**
 * @description Register every tool on the kernel's activation-scoped package-tool port. Only the route
 * entry factory calls this (the kernel refuses a duplicate name); a context without the port — an
 * isolated route test — registers nothing. In production a missing handler fails the activation.
 * @param ctx - Package context from the route mounter (`tools`, `authorization`).
 * @param deps - What the handlers need.
 * @returns Nothing.
 */
function registerPrintTools(ctx, deps) {
    const port = ctx.tools;
    if (!port)
        return;
    const handlers = createPrintToolHandlers(deps, () => ctx.authorization?.currentActor());
    for (const [name, handler] of handlers)
        port.register(name, handler);
    logger.info({ tools: handlers.size }, 'Registered the Scan to Print package tools');
}
//# sourceMappingURL=print-tools.js.map