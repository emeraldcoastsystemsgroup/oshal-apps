"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — printers and print submission. A printer is
 *                     |                             | the person's own host (OctoPrint / Moonraker / PrusaLink) with
 *                     |                             | its API key held only as owner-key ciphertext; sending a job
 *                     |                             | is an OUTWARD, physical action, so it sits behind the kernel's
 *                     |                             | explicit `confirm: true` gate (428 without it) and the
 *                     |                             | manifest tool that exposes it to bots requires approval.
 *                     |                             | Slicing (STL → G-code) runs only when the operator configured
 *                     |                             | a slicer command; otherwise the route says so and offers the
 *                     |                             | STL upload for hosts that accept one. Every attempt, success
 *                     |                             | or failure, becomes a submission row with the host's answer.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Hold current output through slicing and upload, refuse stale/nonprintable models, and discard failed slicer output.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Bambu Lab LAN printers and the owner's print-service settings.
 *                     |                             | A Bambu printer is added from its address and access code
 *                     |                             | (identity read from its certificate, code proven before the row
 *                     |                             | exists); its jobs are sliced by the package's slicer engine and
 *                     |                             | go through print-service.ts, which the swarm print service
 *                     |                             | shares. PATCH /printers/:id changes the slice profile and the
 *                     |                             | per-printer AUTO_START opt-in; turning auto-start ON needs
 *                     |                             | `confirm: true`, and this mount is OIDC-only, so no service
 *                     |                             | caller can grant itself auto-start. GET /printers/profiles
 *                     |                             | lists what the engine slices for, or the engine's install hint.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Review fixes: the start decision may be evaluated at the last
 *                     |                             | moment (after slicing, before the HTTP upload or the Bambu
 *                     |                             | start) so the service honours auto-start being turned off while
 *                     |                             | a job is in flight; a busy slicer engine is reported busy, not
 *                     |                             | missing.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Second review: a Bambu job is stored under a name unique to the
 *                     |                             | attempt (title prefix + job id + random suffix), so a re-print can
 *                     |                             | never overwrite the file a printer is printing from and long
 *                     |                             | titles cannot collide; an HTTP host's decision that cannot be
 *                     |                             | read starts nothing; the engine profile list is a short request.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Third review: the per-attempt suffix carries 48 random bits; an
 *                     |                             | HTTP host's upload that was not started says why (auto-start off,
 *                     |                             | or it could not be read); a failed print answers with its reason
 *                     |                             | at the top level, which is what the page shows.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.serviceDepsOf = serviceDepsOf;
exports.printJob = printJob;
exports.createPrintRoutes = createPrintRoutes;
const express_1 = require("express");
const node_fs_1 = __importDefault(require("node:fs"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const logger_1 = require("@/shared/logger");
const personal_data_1 = require("@/features/personal-data");
const explicit_write_confirmation_1 = require("@/shared/security/explicit-write-confirmation");
const job_store_1 = require("./job-store");
const data_dir_1 = require("./data-dir");
const printer_adapters_1 = require("./engine/print/printer-adapters");
const slicer_engine_1 = require("./printing/slicer-engine");
const slicer_1 = require("./engine/print/slicer");
const export_stl_1 = require("./engine/geometry/export-stl");
const job_outputs_1 = require("./job-outputs");
const node_crypto_1 = require("node:crypto");
const print_service_1 = require("./print-service");
const printer_registration_1 = require("./printer-registration");
const logger = (0, logger_1.createChildLogger)({ module: 'scan-to-print-print-routes' });
const execFile = (0, node_util_1.promisify)(node_child_process_1.execFile);
/**
 * @description The shared print-service dependencies of this router.
 * @param deps - Router dependencies.
 * @returns What print-service.ts needs (pool, network client, slicer engine, printer sockets).
 */
function serviceDepsOf(deps) {
    return { pool: deps.pool, fetchImpl: deps.fetchImpl ?? ((url, init) => fetch(url, init)), slicer: deps.slicer, bambuIo: deps.bambuIo };
}
/** @description Ensure the requested file exists, slicing STL → G-code on demand when configured (HTTP hosts). */
async function resolvePrintFile(deps, dir, fileKind) {
    const stl = (0, data_dir_1.artifactPath)(dir, 'stl');
    if (!node_fs_1.default.existsSync(stl))
        return { ok: false, status: 409, body: { error: 'not_reconstructed', message: 'Reconstruct the object before printing.' } };
    if (fileKind === 'stl')
        return { ok: true, path: stl };
    const gcode = (0, data_dir_1.artifactPath)(dir, 'gcode');
    if (node_fs_1.default.existsSync(gcode))
        return { ok: true, path: gcode };
    const config = (0, slicer_1.resolveSlicerConfig)(deps.env);
    if (!config) {
        return { ok: false, status: 409, body: { error: 'needs_gcode', message: 'No slicer is configured on this swarm (SCAN_TO_PRINT_SLICER_CMD). Download the STL and slice it, or send the STL to an OctoPrint host that slices.' } };
    }
    let completed = false;
    try {
        const result = await (0, slicer_1.sliceStl)(config, stl, gcode, deps.execFile ?? ((f, a, o) => execFile(f, a, o)), (p) => node_fs_1.default.existsSync(p));
        if (!result.ok)
            return { ok: false, status: 502, body: { error: 'slicer_failed', message: result.error, stderr: result.stderr } };
        completed = true;
    }
    finally {
        if (!completed)
            node_fs_1.default.rmSync(gcode, { force: true });
    }
    return { ok: true, path: gcode };
}
/** @description Register guard routes with their existing caller and confirmation contracts. */
function registerGuard(router, deps) {
    router.use((req, res, next) => {
        const sub = deps.callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }
        req.scanSub = sub;
        next();
    });
}
/** @description Encrypt a draft's secret and store the printer. */
async function storeDraft(deps, sub, draft) {
    const { secret, ...printer } = draft;
    const apiKeyCiphertext = (0, personal_data_1.encryptField)(sub, secret);
    if (!apiKeyCiphertext || !(0, personal_data_1.isEncrypted)(apiKeyCiphertext))
        throw new Error('Printer key encryption failed closed');
    return (0, job_store_1.insertPrinter)(deps.pool, sub, { ...printer, apiKeyCiphertext });
}
/** @description Register printers routes with their existing caller and confirmation contracts. */
function registerPrinters(router, deps) {
    router.get('/printers', async (req, res) => {
        try {
            res.json({ printers: await (0, job_store_1.listPrinters)(deps.pool, req.scanSub), kinds: printer_adapters_1.PRINTER_KINDS, slicerConfigured: (0, slicer_1.resolveSlicerConfig)(deps.env) !== null });
        }
        catch (error) {
            logger.error({ err: error }, 'List printers failed');
            res.status(500).json({ error: 'list_failed' });
        }
    });
    router.post('/printers', async (req, res) => {
        const sub = req.scanSub;
        const body = (req.body ?? {});
        try {
            const draft = body.kind === printer_adapters_1.BAMBU_KIND ? await (0, printer_registration_1.registerBambuPrinter)(body, deps.bambuIo) : (0, printer_registration_1.parseHttpPrinter)(body);
            res.status(201).json({ printer: await storeDraft(deps, sub, draft) });
        }
        catch (error) {
            if (error instanceof RangeError) {
                res.status(400).json({ error: 'invalid_printer', message: error.message });
                return;
            }
            logger.error({ err: error }, 'Create printer failed');
            res.status(500).json({ error: 'create_failed' });
        }
    });
    router.delete('/printers/:printerId', async (req, res) => {
        try {
            const removed = await (0, job_store_1.deletePrinter)(deps.pool, req.scanSub, (0, data_dir_1.requireUuid)(req.params.printerId));
            if (!removed) {
                res.status(404).json({ error: 'printer_not_found' });
                return;
            }
            res.json({ deleted: true });
        }
        catch (error) {
            if (error instanceof RangeError) {
                res.status(400).json({ error: 'invalid_printer_id' });
                return;
            }
            logger.error({ err: error }, 'Delete printer failed');
            res.status(500).json({ error: 'delete_failed' });
        }
    });
}
/** @description Register the owner-only settings route (slice profile, auto-start). */
function registerSettings(router, deps) {
    router.patch('/printers/:printerId', async (req, res) => {
        const body = (req.body ?? {});
        try {
            const printerId = (0, data_dir_1.requireUuid)(req.params.printerId);
            const change = (0, printer_registration_1.parseSettingsChange)(body);
            if (change.needsConfirm) {
                res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('scan-to-print.auto-start', 'Letting jobs sent by agents and apps start this printer without a click'));
                return;
            }
            const printer = await (0, job_store_1.updatePrinterSettings)(deps.pool, req.scanSub, printerId, { autoStart: change.autoStart, sliceProfile: change.sliceProfile });
            if (!printer) {
                res.status(404).json({ error: 'printer_not_found' });
                return;
            }
            logger.info({ printerId, autoStart: printer.auto_start }, 'Printer settings changed');
            res.json({ printer });
        }
        catch (error) {
            if (error instanceof RangeError) {
                res.status(400).json({ error: 'invalid_settings', message: error.message });
                return;
            }
            logger.error({ err: error }, 'Printer settings failed');
            res.status(500).json({ error: 'settings_failed' });
        }
    });
    router.get('/printers/profiles', async (_req, res) => {
        try {
            res.json({ engine: { address: `${deps.slicer.host}:${deps.slicer.port}`, ready: true }, ...await (0, slicer_engine_1.slicerRequest)({ ...deps.slicer, timeoutMs: 20_000 }, 'profiles', {}) });
        }
        catch (error) {
            if (error instanceof slicer_engine_1.SlicerEngineError && error.code === 'busy') {
                res.json({ engine: { address: `${deps.slicer.host}:${deps.slicer.port}`, ready: true, busy: true }, printers: [], plates: [], reason: error.reason ?? error.message });
                return;
            }
            if (error instanceof slicer_engine_1.SlicerEngineError) {
                res.json({ engine: { address: `${deps.slicer.host}:${deps.slicer.port}`, ready: false }, printers: [], plates: [], reason: error.reason ?? error.message, installHint: deps.slicer.installHint });
                return;
            }
            logger.error({ err: error }, 'Slicer profiles failed');
            res.status(500).json({ error: 'profiles_failed' });
        }
    });
}
/** @description Register status routes with their existing caller and confirmation contracts. */
function registerStatus(router, deps) {
    router.post('/printers/:printerId/status', async (req, res) => {
        try {
            const loaded = await (0, print_service_1.loadPrinter)(deps.pool, req.scanSub, (0, data_dir_1.requireUuid)(req.params.printerId));
            if (!loaded) {
                res.status(404).json({ error: 'printer_not_found' });
                return;
            }
            const status = await (0, print_service_1.printerState)(serviceDepsOf(deps), loaded);
            res.status(status.ok ? 200 : 502).json({ printer: loaded.row, status });
        }
        catch (error) {
            if (error instanceof RangeError) {
                res.status(400).json({ error: 'invalid_printer_id', message: error.message });
                return;
            }
            logger.error({ err: error }, 'Printer status failed');
            res.status(500).json({ error: 'status_failed' });
        }
    });
}
/** @description Register history routes with their existing caller and confirmation contracts. */
function registerHistory(router, deps) {
    router.get('/jobs/:jobId/submissions', async (req, res) => {
        try {
            const jobId = (0, data_dir_1.requireUuid)(req.params.jobId);
            res.json({ submissions: await (0, job_store_1.listSubmissions)(deps.pool, req.scanSub, jobId) });
        }
        catch (error) {
            if (error instanceof RangeError) {
                res.status(400).json({ error: 'invalid_job_id' });
                return;
            }
            logger.error({ err: error }, 'List submissions failed');
            res.status(500).json({ error: 'list_failed' });
        }
    });
}
/** @description An HTTP host's outcome for a job's STL or (sliced) G-code. */
async function httpJobOutcome(deps, sub, job, printer, body, start) {
    const fileKind = body.fileKind === 'stl' ? 'stl' : 'gcode';
    const resolved = await resolvePrintFile(deps, (0, data_dir_1.jobDir)(deps.dataRoot, sub, job.job_id), fileKind);
    if (!resolved.ok)
        return { status: resolved.status, body: resolved.body };
    const fileName = `${(0, export_stl_1.sanitizeSolidName)(job.title, 'part')}-${job.job_id.slice(0, 8)}.${fileKind}`;
    // An HTTP host is told to start in the upload itself, so the decision is taken here, after slicing.
    const decision = await (0, print_service_1.evaluateStart)(start);
    const outcome = await (0, print_service_1.sendToHttpPrinter)(serviceDepsOf(deps), printer, { fileName, bytes: new Uint8Array(node_fs_1.default.readFileSync(resolved.path)) }, decision.go);
    if (outcome.uploaded && decision.error) {
        outcome.notStartedReason = `whether to start could not be read (${decision.error}); nothing was started`;
        outcome.message = `Uploaded, not started: ${outcome.notStartedReason}`;
    }
    else if (outcome.uploaded && !decision.go && typeof start === 'function') {
        outcome.message = 'Uploaded. Auto-start is off for this printer, so it waits on the printer for someone to start it.';
    }
    if (outcome.status === 409)
        return { status: 409, body: { error: 'unsupported_file', message: outcome.message } };
    return { outcome, fileKind };
}
/** @description A Bambu printer's outcome for a job's STL, sliced for that printer. */
async function bambuJobOutcome(deps, sub, job, printer, start, requestedBy) {
    const stl = (0, data_dir_1.artifactPath)((0, data_dir_1.jobDir)(deps.dataRoot, sub, job.job_id), 'stl');
    if (!node_fs_1.default.existsSync(stl))
        return { status: 409, body: { error: 'not_reconstructed', message: 'Reconstruct the object before printing.' } };
    // Unique per attempt: a re-print must never overwrite the file a printer is printing from.
    const name = `${(0, export_stl_1.sanitizeSolidName)(job.title, 'part').slice(0, 48)}-${job.job_id.slice(0, 8)}-${(0, node_crypto_1.randomBytes)(6).toString('hex')}`;
    return { outcome: await (0, print_service_1.sendToBambu)(serviceDepsOf(deps), printer, { kind: 'stl', bytes: new Uint8Array(node_fs_1.default.readFileSync(stl)), name }, start, requestedBy), fileKind: 'gcode.3mf' };
}
/**
 * @description Print a job's current model on one of the caller's printers and record the attempt.
 * Shared by the person's Print click and the print service.
 * @param deps - Router dependencies.
 * @param sub - Owner.
 * @param job - The current job.
 * @param body - `{ printerId, fileKind? }`.
 * @param start - The person's checkbox, or the service's last-moment re-read of the printer's auto-start.
 * @param requestedBy - Who asked.
 * @returns HTTP status and body.
 */
async function printJob(deps, sub, job, body, start, requestedBy) {
    const printer = await (0, print_service_1.loadPrinter)(deps.pool, sub, (0, data_dir_1.requireUuid)(body.printerId));
    if (!printer)
        return { status: 404, body: { error: 'printer_not_found' } };
    const result = printer.row.kind === printer_adapters_1.BAMBU_KIND
        ? await bambuJobOutcome(deps, sub, job, printer, start, requestedBy)
        : await httpJobOutcome(deps, sub, job, printer, body, start);
    if (!('outcome' in result))
        return result;
    const { outcome } = result;
    const submission = await (0, print_service_1.recordAttempt)(deps.pool, sub, { jobId: job.job_id, sourceName: null, printer, fileKind: result.fileKind, outcome, requestedBy });
    const failed = outcome.status >= 400 ? { error: 'print_not_sent', message: outcome.message, ...(outcome.installHint ? { installHint: outcome.installHint } : {}) } : {};
    return { status: outcome.status, body: { ...failed, submission, outcome: { ok: outcome.uploaded, uploaded: outcome.uploaded, started: outcome.started, fileName: outcome.fileName, message: outcome.message, estimate: outcome.estimate, sliceProfile: outcome.sliceProfile, installHint: outcome.installHint } } };
}
/** @description Register print routes with their existing caller and confirmation contracts. */
function registerPrint(router, deps) {
    router.post('/jobs/:jobId/print', (0, job_outputs_1.withCurrentJob)(deps, async (req, res) => {
        const sub = req.scanSub;
        const body = (req.body ?? {});
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('scan-to-print.print', 'Sending a job to a printer'));
            return;
        }
        const job = req.scanJob;
        try {
            if (!(0, job_outputs_1.requireCurrentOutput)(job, res, true))
                return;
            const result = await printJob(deps, sub, job, body, body.startPrint === true, 'person');
            res.status(result.status).json(result.body);
        }
        catch (error) {
            if (error instanceof RangeError) {
                res.status(400).json({ error: 'invalid_request', message: error.message });
                return;
            }
            logger.error({ err: error, jobId: job?.job_id }, 'Print submission failed');
            res.status(500).json({ error: 'print_failed' });
        }
    }));
}
/**
 * @description Compose printer management, owner settings and guarded current-model submission.
 * @param deps - Router dependencies.
 * @returns The router mounted under /api/scan-to-print (OIDC only).
 */
function createPrintRoutes(deps) {
    const router = (0, express_1.Router)();
    registerGuard(router, deps);
    registerPrinters(router, deps);
    registerSettings(router, deps);
    registerStatus(router, deps);
    registerHistory(router, deps);
    registerPrint(router, deps);
    return router;
}
//# sourceMappingURL=print-routes.js.map