"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimJobOperation = claimJobOperation;
exports.withCurrentJob = withCurrentJob;
exports.hasCurrentOutput = hasCurrentOutput;
exports.currentOutputRefusal = currentOutputRefusal;
exports.requireCurrentOutput = requireCurrentOutput;
exports.artifactPresence = artifactPresence;
exports.retireOutput = retireOutput;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const job_store_1 = require("./job-store");
const data_dir_1 = require("./data-dir");
const active = new WeakMap();
const MAX_ACTIVE_JOBS = 128;
/** @description Retire only this request's bounded disk upload, including a busy/not-found refusal before its handler runs. */
function cleanupUpload(deps, req) {
    if (!req.file?.path || !req.scanSub)
        return;
    try {
        const expected = node_path_1.default.join((0, data_dir_1.jobDir)(deps.dataRoot, req.scanSub, (0, data_dir_1.requireUuid)(req.params.jobId)), 'uploads');
        if (node_path_1.default.dirname(node_path_1.default.resolve(req.file.path)) === node_path_1.default.resolve(expected))
            node_fs_1.default.rmSync(req.file.path, { force: true });
    }
    catch { /* A failed cleanup cannot release or publish stale geometry. */ }
}
/**
 * @description Admit one operation on one job without a queue: readers share, a writer is alone. This is a
 * single-API guard, not a distributed lock. The caller MUST call `release` once its whole operation settles.
 * @param deps - Pool and data root (the lock is per pool and per data root).
 * @param sub - The owner.
 * @param jobId - The job (already a validated UUID).
 * @param mode - `read` or `write`.
 * @returns A release function, or why the job cannot be admitted now.
 */
function claimJobOperation(deps, sub, jobId, mode) {
    const key = JSON.stringify([deps.dataRoot, sub, jobId]);
    const jobs = active.get(deps.pool) ?? new Map();
    active.set(deps.pool, jobs);
    const operation = jobs.get(key) ?? { readers: 0, writing: false };
    if (operation.writing || mode === 'write' && operation.readers > 0)
        return { status: 409, body: { error: 'job_busy', message: 'This object is busy. Wait for the current operation, then try again.' } };
    if (!jobs.has(key) && jobs.size >= MAX_ACTIVE_JOBS)
        return { status: 503, body: { error: 'jobs_busy', message: 'Scan storage is busy. Try again shortly.' } };
    if (mode === 'read')
        operation.readers += 1;
    else
        operation.writing = true;
    jobs.set(key, operation);
    return { release: () => {
            if (mode === 'read')
                operation.readers -= 1;
            else
                operation.writing = false;
            if (!operation.writing && operation.readers === 0)
                jobs.delete(key);
        } };
}
/** @description Admit once without a queue; release only after the complete handler settles. This is a single-API guard, not a distributed lock. */
function withCurrentJob(deps, handler, mode = 'write') {
    return async (req, res) => {
        let release;
        res.setHeader('Cache-Control', 'private, no-store');
        try {
            const sub = req.scanSub;
            if (!sub) {
                res.status(401).json({ error: 'unauthenticated' });
                return;
            }
            const id = (0, data_dir_1.requireUuid)(req.params.jobId);
            const claim = claimJobOperation(deps, sub, id, mode);
            if (!('release' in claim)) {
                res.status(claim.status).json(claim.body);
                return;
            }
            release = claim.release;
            const job = await (0, job_store_1.getJob)(deps.pool, sub, id);
            if (!job) {
                res.status(404).json({ error: 'job_not_found' });
                return;
            }
            req.scanJob = job;
            await handler(req, res);
        }
        catch (error) {
            if (!res.headersSent)
                res.status(error instanceof RangeError ? 400 : 500).json({ error: error instanceof RangeError ? 'invalid_job_id' : 'job_operation_failed' });
        }
        finally {
            cleanupUpload(deps, req);
            release?.();
        }
    };
}
/** @description Current legacy results remain readable; changed or failed inputs cannot expose retired files. */
function hasCurrentOutput(job) { return job.state === 'reconstructed' && typeof job.report === 'object' && job.report !== null && !Array.isArray(job.report); }
/**
 * @description Why a job's output cannot be downloaded or printed now, or null when it can.
 * @param job - The job.
 * @param printing - True when the output is about to be printed (it must also be printable).
 * @returns The refusal the routes and the print tool answer with, or null.
 */
function currentOutputRefusal(job, printing = false) {
    if (!hasCurrentOutput(job))
        return { status: 409, body: { error: 'output_stale', message: 'Reconstruct this object after changing its inputs before downloading or printing.' } };
    if (printing && job.report?.printable !== true)
        return { status: 409, body: { error: 'model_not_printable', message: 'The current model failed its mesh checks. Inspect the report and reconstruct before printing.' } };
    return null;
}
/** @description Explain stale output consistently; nonprintable current geometry remains available for inspection. */
function requireCurrentOutput(job, res, printing = false) {
    const refusal = currentOutputRefusal(job, printing);
    if (refusal) {
        res.status(refusal.status).json(refusal.body);
        return false;
    }
    return true;
}
/** @description Presence never overrides the persisted freshness state. */
function artifactPresence(dir, job) {
    return Object.fromEntries(Object.keys(data_dir_1.ARTIFACT_FILES).map(key => [key, hasCurrentOutput(job) && node_fs_1.default.existsSync((0, data_dir_1.artifactPath)(dir, key))]));
}
/** @description Persist invalidation before removing fixed known output files; failed deletion leaves downloads and printing denied. */
async function retireOutput(deps, sub, job) {
    const updated = await (0, job_store_1.updateJob)(deps.pool, sub, job.job_id, { state: 'capturing', report: null, failure_reason: null });
    if (!updated)
        throw new Error('Job disappeared before output invalidation');
    const dir = (0, data_dir_1.jobDir)(deps.dataRoot, sub, job.job_id);
    for (const key of Object.keys(data_dir_1.ARTIFACT_FILES))
        node_fs_1.default.rmSync((0, data_dir_1.artifactPath)(dir, key), { force: true });
    return updated;
}
//# sourceMappingURL=job-outputs.js.map