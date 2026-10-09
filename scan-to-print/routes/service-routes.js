"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the swarm PRINT SERVICE (operator decision
 *                     |                             | 2026-10-06: "build it into the app as a service", the way agents
 *                     |                             | already call the RAG service). Mounted `service-or-oidc` at
 *                     |                             | /api/scan-to-print/service: an agent tool, a persona script or
 *                     |                             | another app reaches it with the framework's service secret plus
 *                     |                             | the user it acts for, and every database call is narrowed to that
 *                     |                             | user (requireTrustedServiceUserIdentity) before any route runs.
 *                     |                             | It lists the caller's printers, reads their state, and prints a
 *                     |                             | scan job or a posted model (.stl sliced for the printer, or a
 *                     |                             | sliced .gcode.3mf / .gcode as is). It NEVER decides to start a
 *                     |                             | machine by itself: a job starts only when the printer's owner
 *                     |                             | turned auto-start on for that printer (an OIDC-only setting this
 *                     |                             | mount cannot change); otherwise the file is uploaded and the reply
 *                     |                             | says to start it on the printer. Whether an agent may call the
 *                     |                             | print tool unattended is the operator's per-agent grant
 *                     |                             | (auto / ask / off), not anything this router chooses.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fixes, and the trust model stated as it is: the owner's
 *                     |                             | auto-start is the gate this router enforces for EVERY caller,
 *                     |                             | re-read from the database at the moment a start would be sent
 *                     |                             | (after slicing and upload), so switching it off stops a job in
 *                     |                             | flight. The operator's per-agent grant governs only calls made
 *                     |                             | through the manifest's print tool; the router cannot see it.
 *                     |                             | Under core application authorization in enforce mode a bare
 *                     |                             | service-secret call has no verified identity and core refuses it
 *                     |                             | (401) before this router runs. GET /jobs lists the user's scan
 *                     |                             | jobs for the tools; a posted model gets a unique name on the
 *                     |                             | printer and is recorded under the kind actually sent.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Second review: a caller's own machine instructions — raw G-code,
 *                     |                             | like a sliced .gcode.3mf — are uploaded but never auto-started
 *                     |                             | (auto-start covers models this package slices); replies report
 *                     |                             | the printer's auto-start as it stands after the attempt.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | A failed posted-model print carries installHint at the top level
 *                     |                             | too, the same shape the job print routes answer with.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | 0.7.0: choosePrinter, autoStartNow and autoStartForReply are
 *                     |                             | exported for the package tools (print-tools.ts), so an agent's
 *                     |                             | print and a service call choose the printer and read the owner's
 *                     |                             | auto-start the same way.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_MODEL_MAX_BYTES = void 0;
exports.choosePrinter = choosePrinter;
exports.autoStartForReply = autoStartForReply;
exports.autoStartNow = autoStartNow;
exports.createPrintServiceRouter = createPrintServiceRouter;
const express_1 = require("express");
const node_async_hooks_1 = require("node:async_hooks");
const multer_1 = __importDefault(require("multer"));
const logger_1 = require("@/shared/logger");
const trusted_service_user_identity_1 = require("@/shared/middleware/trusted-service-user-identity");
const node_crypto_1 = require("node:crypto");
const job_store_1 = require("./job-store");
const data_dir_1 = require("./data-dir");
const printer_adapters_1 = require("./engine/print/printer-adapters");
const job_outputs_1 = require("./job-outputs");
const print_routes_1 = require("./print-routes");
const print_service_1 = require("./print-service");
const logger = (0, logger_1.createChildLogger)({ module: 'scan-to-print-service-routes' });
/** @description Largest model the service accepts in one request. */
exports.SERVICE_MODEL_MAX_BYTES = 64 * 1024 * 1024;
/** @description Keep the request identity across multer's callbacks (it leaves the async context). */
function preserveUploadContext(upload) {
    return (req, res, next) => upload(req, res, node_async_hooks_1.AsyncResource.bind(next));
}
/**
 * @description Pick the printer: the one named, else the caller's only printer.
 * @param deps - Print dependencies.
 * @param sub - The owner.
 * @param requested - The printer id the caller named, if any.
 * @returns The printer id, or the refusal to answer.
 */
async function choosePrinter(deps, sub, requested) {
    if (requested !== undefined && requested !== null && requested !== '')
        return { printerId: (0, data_dir_1.requireUuid)(requested) };
    const printers = await (0, job_store_1.listPrinters)(deps.pool, sub);
    if (printers.length === 1)
        return { printerId: printers[0].printer_id };
    return { status: 400, body: { error: printers.length ? 'printer_required' : 'no_printers', message: printers.length ? 'This person has more than one printer; name one with printerId.' : 'This person has no printer registered in Scan to Print.', printers: printers.map((p) => ({ printerId: p.printer_id, label: p.label, kind: p.kind })) } };
}
/**
 * @description The printer's auto-start for a reply: as it stands now, or null when it cannot be read (the attempt already happened).
 * @param deps - Print dependencies.
 * @param sub - The owner.
 * @param printerId - The printer.
 * @returns The setting, or null.
 */
async function autoStartForReply(deps, sub, printerId) {
    try {
        return await (0, job_store_1.getPrinterAutoStart)(deps.pool, sub, printerId);
    }
    catch (error) {
        logger.error({ err: error, printerId }, 'Could not read auto-start for the reply');
        return null;
    }
}
/**
 * @description The owner's auto-start, read when the start would be sent — never earlier.
 * @param deps - Print dependencies.
 * @param sub - The owner.
 * @param printerId - The printer.
 * @returns A decision the print path evaluates at start time.
 */
function autoStartNow(deps, sub, printerId) {
    return () => (0, job_store_1.getPrinterAutoStart)(deps.pool, sub, printerId);
}
/** @description The model a posted file represents, with a name unique on the printer's storage. */
function modelOf(file) {
    const original = String(file.originalname || 'model');
    const name = `${original.replace(/\.(gcode\.3mf|stl|gcode|gco|g|bgcode|3mf)$/i, '').slice(0, 64)}-${(0, node_crypto_1.randomBytes)(6).toString('hex')}`;
    if (/\.gcode\.3mf$/i.test(original))
        return { kind: 'gcode.3mf', bytes: new Uint8Array(file.buffer), name };
    const kind = (0, printer_adapters_1.fileKindOf)(original);
    if (kind === 'stl')
        return { kind: 'stl', bytes: new Uint8Array(file.buffer), name };
    if (kind === 'gcode')
        return { kind: 'gcode', bytes: new Uint8Array(file.buffer), name: (0, print_service_1.printerFileName)(name, original.slice(original.lastIndexOf('.')).toLowerCase()) };
    return null;
}
/**
 * @description Send a posted model to a loaded printer. A model this package slices (STL) starts under
 * the owner's auto-start, read at start time; the caller's own machine instructions (a sliced
 * .gcode.3mf, raw G-code) are uploaded and never auto-started.
 */
async function sendModel(deps, sub, printer, model) {
    if (printer.row.kind === printer_adapters_1.BAMBU_KIND)
        return (0, print_service_1.sendToBambu)((0, print_routes_1.serviceDepsOf)(deps), printer, model, autoStartNow(deps, sub, printer.row.printer_id), 'service');
    if (model.kind !== 'gcode')
        return { status: 409, uploaded: false, started: false, fileName: null, message: `${printer.row.kind} hosts take sliced G-code from the print service; slice the model first.` };
    const outcome = await (0, print_service_1.sendToHttpPrinter)((0, print_routes_1.serviceDepsOf)(deps), printer, { fileName: model.name, bytes: model.bytes }, false);
    return outcome.uploaded ? { ...outcome, message: 'Uploaded. Posted G-code waits on the printer host for someone to start it.' } : outcome;
}
/** @description The reply for one recorded attempt; `autoStart` is the printer's setting as it stands now. */
function answer(outcome, printer, submission, autoStart) {
    return {
        submission,
        printer: { printerId: printer.row.printer_id, label: printer.row.label, kind: printer.row.kind, autoStart },
        outcome: { uploaded: outcome.uploaded, started: outcome.started, fileName: outcome.fileName, message: outcome.message, estimate: outcome.estimate, sliceProfile: outcome.sliceProfile, installHint: outcome.installHint },
    };
}
/** @description Identity: narrow service callers to their user, then require one. */
function registerGuard(router, deps) {
    router.use(trusted_service_user_identity_1.requireTrustedServiceUserIdentity);
    router.use((req, res, next) => {
        const sub = deps.callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }
        req.scanSub = sub;
        res.setHeader('Cache-Control', 'private, no-store');
        next();
    });
}
/** @description Read-only: printers, one printer's state, recent submissions. */
function registerReads(router, deps) {
    router.get('/printers', async (req, res) => {
        try {
            const printers = await (0, job_store_1.listPrinters)(deps.pool, req.scanSub);
            res.json({ printers: printers.map((p) => ({ printerId: p.printer_id, label: p.label, kind: p.kind, model: p.device_model, autoStart: p.auto_start, sliceProfile: p.slice_profile })) });
        }
        catch (error) {
            logger.error({ err: error }, 'Service printer list failed');
            res.status(500).json({ error: 'list_failed' });
        }
    });
    router.get('/printers/:printerId/status', async (req, res) => {
        try {
            const printer = await (0, print_service_1.loadPrinter)(deps.pool, req.scanSub, (0, data_dir_1.requireUuid)(req.params.printerId));
            if (!printer) {
                res.status(404).json({ error: 'printer_not_found' });
                return;
            }
            const status = await (0, print_service_1.printerState)((0, print_routes_1.serviceDepsOf)(deps), printer);
            res.status(status.ok ? 200 : 502).json({ printer: { printerId: printer.row.printer_id, label: printer.row.label, kind: printer.row.kind, autoStart: printer.row.auto_start }, status });
        }
        catch (error) {
            if (error instanceof RangeError) {
                res.status(400).json({ error: 'invalid_printer_id', message: error.message });
                return;
            }
            logger.error({ err: error }, 'Service printer status failed');
            res.status(500).json({ error: 'status_failed' });
        }
    });
    router.get('/jobs', async (req, res) => {
        try {
            const jobs = await (0, job_store_1.listJobs)(deps.pool, req.scanSub);
            res.json({ jobs: jobs.map((j) => ({ jobId: j.job_id, title: j.title, state: j.state, source: j.source_kind, printable: j.state === 'reconstructed' && j.report?.printable === true, updatedAt: j.updated_at })) });
        }
        catch (error) {
            logger.error({ err: error }, 'Service job list failed');
            res.status(500).json({ error: 'list_failed' });
        }
    });
    router.get('/submissions', async (req, res) => {
        try {
            res.json({ submissions: await (0, job_store_1.listRecentSubmissions)(deps.pool, req.scanSub) });
        }
        catch (error) {
            logger.error({ err: error }, 'Service submissions failed');
            res.status(500).json({ error: 'list_failed' });
        }
    });
}
/** @description Print a scan job's current model. */
function registerJobPrint(router, deps) {
    router.post('/jobs/:jobId/print', (0, job_outputs_1.withCurrentJob)(deps, async (req, res) => {
        const sub = req.scanSub;
        const job = req.scanJob;
        try {
            if (!(0, job_outputs_1.requireCurrentOutput)(job, res, true))
                return;
            const body = (req.body ?? {});
            const chosen = await choosePrinter(deps, sub, body.printerId);
            if (!('printerId' in chosen)) {
                res.status(chosen.status).json(chosen.body);
                return;
            }
            const printer = await (0, print_service_1.loadPrinter)(deps.pool, sub, chosen.printerId);
            if (!printer) {
                res.status(404).json({ error: 'printer_not_found' });
                return;
            }
            const result = await (0, print_routes_1.printJob)(deps, sub, job, { printerId: chosen.printerId, fileKind: 'gcode' }, autoStartNow(deps, sub, chosen.printerId), 'service');
            const autoStart = await autoStartForReply(deps, sub, chosen.printerId);
            res.status(result.status).json({ ...result.body, printer: { printerId: printer.row.printer_id, label: printer.row.label, kind: printer.row.kind, autoStart } });
        }
        catch (error) {
            if (error instanceof RangeError) {
                res.status(400).json({ error: 'invalid_request', message: error.message });
                return;
            }
            logger.error({ err: error, jobId: job?.job_id }, 'Service job print failed');
            res.status(500).json({ error: 'print_failed' });
        }
    }));
}
/** @description Print a posted model file (multipart field `model`). */
function registerFilePrint(router, deps) {
    const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: exports.SERVICE_MODEL_MAX_BYTES, files: 1 } });
    router.post('/print', preserveUploadContext(upload.single('model')), async (req, res) => {
        const sub = req.scanSub;
        try {
            if (!req.file) {
                res.status(400).json({ error: 'model_required', message: 'Post the model as multipart field "model" (.stl, .gcode.3mf or .gcode).' });
                return;
            }
            const model = modelOf(req.file);
            if (!model) {
                res.status(415).json({ error: 'unsupported_model', message: 'The print service takes .stl, .gcode.3mf or .gcode.' });
                return;
            }
            const chosen = await choosePrinter(deps, sub, (req.body ?? {}).printerId);
            if (!('printerId' in chosen)) {
                res.status(chosen.status).json(chosen.body);
                return;
            }
            const printer = await (0, print_service_1.loadPrinter)(deps.pool, sub, chosen.printerId);
            if (!printer) {
                res.status(404).json({ error: 'printer_not_found' });
                return;
            }
            const outcome = await sendModel(deps, sub, printer, model);
            const fileKind = printer.row.kind === printer_adapters_1.BAMBU_KIND ? 'gcode.3mf' : model.kind;
            const submission = outcome.status === 409 ? null : await (0, print_service_1.recordAttempt)(deps.pool, sub, { jobId: null, sourceName: String(req.file.originalname || 'model').slice(0, 200), printer, fileKind, outcome, requestedBy: 'service' });
            const failed = outcome.status >= 400 ? { error: 'print_not_sent', message: outcome.message, ...(outcome.installHint ? { installHint: outcome.installHint } : {}) } : {};
            res.status(outcome.status).json({ ...failed, ...answer(outcome, printer, submission, await autoStartForReply(deps, sub, printer.row.printer_id)) });
        }
        catch (error) {
            if (error instanceof RangeError) {
                res.status(400).json({ error: 'invalid_request', message: error.message });
                return;
            }
            logger.error({ err: error }, 'Service file print failed');
            res.status(500).json({ error: 'print_failed' });
        }
    });
    router.use((error, _req, res, next) => {
        if (error instanceof multer_1.default.MulterError) {
            res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'upload_rejected', message: error.message });
            return;
        }
        next(error);
    });
}
/**
 * @description Compose the print service router.
 * @param deps - The same dependencies the person's print routes use.
 * @returns The router mounted at /api/scan-to-print/service.
 */
function createPrintServiceRouter(deps) {
    const router = (0, express_1.Router)();
    registerGuard(router, deps);
    registerReads(router, deps);
    registerJobPrint(router, deps);
    registerFilePrint(router, deps);
    return router;
}
//# sourceMappingURL=service-routes.js.map