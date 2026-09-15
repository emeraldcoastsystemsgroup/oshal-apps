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
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const slicer_1 = require("./engine/print/slicer");
const export_stl_1 = require("./engine/geometry/export-stl");
const job_outputs_1 = require("./job-outputs");
const logger = (0, logger_1.createChildLogger)({ module: 'scan-to-print-print-routes' });
const execFile = (0, node_util_1.promisify)(node_child_process_1.execFile);
/** @description Printer creation body validation. */
function parsePrinterBody(raw) {
    const body = (raw ?? {});
    const label = String(body.label ?? '').trim().slice(0, 80);
    const kind = String(body.kind ?? '');
    const apiKey = String(body.apiKey ?? '').trim();
    if (!label)
        throw new RangeError('label is required');
    if (!printer_adapters_1.PRINTER_KINDS.includes(kind))
        throw new RangeError(`kind must be one of ${printer_adapters_1.PRINTER_KINDS.join(', ')}`);
    if (!apiKey || apiKey.length > 512)
        throw new RangeError('apiKey is required');
    const url = (0, printer_adapters_1.validatePrinterBaseUrl)(String(body.baseUrl ?? ''));
    if (!url.ok)
        throw new RangeError(`baseUrl: ${url.reason}`);
    return { label, kind: kind, baseUrl: url.url, apiKey };
}
/** @description Resolve a printer's profile with its decrypted key, or null. */
async function loadProfile(deps, sub, printerId) {
    const row = await (0, job_store_1.getPrinterWithKey)(deps.pool, sub, printerId);
    if (!row)
        return null;
    const apiKey = (0, personal_data_1.decryptField)(sub, row.api_key_ciphertext);
    if (!apiKey || (0, personal_data_1.isEncrypted)(apiKey))
        throw new Error('Printer key decryption failed closed');
    return { row, profile: { kind: row.kind, baseUrl: row.base_url, apiKey } };
}
/** @description Ensure the requested file exists, slicing STL → G-code on demand when configured. */
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
        try {
            const body = parsePrinterBody(req.body);
            const apiKeyCiphertext = (0, personal_data_1.encryptField)(sub, body.apiKey);
            if (!apiKeyCiphertext || !(0, personal_data_1.isEncrypted)(apiKeyCiphertext))
                throw new Error('Printer key encryption failed closed');
            const printer = await (0, job_store_1.insertPrinter)(deps.pool, sub, { label: body.label, kind: body.kind, baseUrl: body.baseUrl, apiKeyCiphertext });
            res.status(201).json({ printer });
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
/** @description Register status routes with their existing caller and confirmation contracts. */
function registerStatus(router, deps, fetchImpl) {
    router.post('/printers/:printerId/status', async (req, res) => {
        try {
            const loaded = await loadProfile(deps, req.scanSub, (0, data_dir_1.requireUuid)(req.params.printerId));
            if (!loaded) {
                res.status(404).json({ error: 'printer_not_found' });
                return;
            }
            const status = await (0, printer_adapters_1.adapterFor)(loaded.profile.kind).status(loaded.profile, fetchImpl);
            res.status(status.ok ? 200 : 502).json({ printer: loaded.row, status });
        }
        catch (error) {
            if (error instanceof RangeError) {
                res.status(400).json({ error: 'invalid_printer_id' });
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
/** @description Register print routes with their existing caller and confirmation contracts. */
function registerPrint(router, deps, fetchImpl) {
    router.post('/jobs/:jobId/print', (0, job_outputs_1.withCurrentJob)(deps, async (req, res) => {
        const sub = req.scanSub;
        const body = (req.body ?? {});
        if (!(0, explicit_write_confirmation_1.hasExplicitWriteConfirmation)(body)) {
            res.status(428).json((0, explicit_write_confirmation_1.confirmationRequiredPayload)('scan-to-print.print', 'Sending a job to a printer'));
            return;
        }
        let job = null;
        try {
            job = req.scanJob;
            if (!(0, job_outputs_1.requireCurrentOutput)(job, res, true))
                return;
            const loaded = await loadProfile(deps, sub, (0, data_dir_1.requireUuid)(body.printerId));
            if (!loaded) {
                res.status(404).json({ error: 'printer_not_found' });
                return;
            }
            const fileKind = body.fileKind === 'stl' ? 'stl' : 'gcode';
            const startPrint = body.startPrint === true;
            const resolved = await resolvePrintFile(deps, (0, data_dir_1.jobDir)(deps.dataRoot, sub, job.job_id), fileKind);
            if (!resolved.ok) {
                res.status(resolved.status).json(resolved.body);
                return;
            }
            const fileName = `${(0, export_stl_1.sanitizeSolidName)(job.title, 'part')}-${job.job_id.slice(0, 8)}.${fileKind}`;
            if (!(0, printer_adapters_1.hostAccepts)(loaded.profile.kind, fileName)) {
                res.status(409).json({ error: 'unsupported_file', message: `${loaded.profile.kind} does not accept .${fileKind} uploads; send G-code.` });
                return;
            }
            const outcome = await (0, printer_adapters_1.adapterFor)(loaded.profile.kind).upload(loaded.profile, { fileName, bytes: new Uint8Array(node_fs_1.default.readFileSync(resolved.path)), startPrint }, fetchImpl);
            const submission = await (0, job_store_1.insertSubmission)(deps.pool, sub, {
                jobId: job.job_id, printerId: loaded.row.printer_id, fileName, fileKind, started: outcome.started,
                state: outcome.ok ? (outcome.started ? 'printing' : 'uploaded') : 'failed', failureReason: outcome.ok ? null : outcome.message, remote: outcome.remote ?? null,
            });
            logger.info({ jobId: job.job_id, printerId: loaded.row.printer_id, ok: outcome.ok, started: outcome.started, status: outcome.status }, 'Print submission recorded');
            res.status(outcome.ok ? 201 : 502).json({ submission, outcome: { ok: outcome.ok, status: outcome.status, message: outcome.message } });
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
/** @description Compose printer management and guarded current-model submission. */
function createPrintRoutes(deps) {
    const router = (0, express_1.Router)();
    const fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));
    registerGuard(router, deps);
    registerPrinters(router, deps);
    registerStatus(router, deps, fetchImpl);
    registerHistory(router, deps);
    registerPrint(router, deps, fetchImpl);
    return router;
}
//# sourceMappingURL=print-routes.js.map