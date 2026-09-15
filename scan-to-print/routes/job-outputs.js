"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withCurrentJob = withCurrentJob;
exports.hasCurrentOutput = hasCurrentOutput;
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
            const id = (0, data_dir_1.requireUuid)(req.params.jobId), key = JSON.stringify([deps.dataRoot, sub, id]);
            const jobs = active.get(deps.pool) ?? new Map();
            active.set(deps.pool, jobs);
            const operation = jobs.get(key) ?? { readers: 0, writing: false };
            if (operation.writing || mode === 'write' && operation.readers > 0) {
                res.status(409).json({ error: 'job_busy', message: 'This object is busy. Wait for the current operation, then try again.' });
                return;
            }
            if (!jobs.has(key) && jobs.size >= MAX_ACTIVE_JOBS) {
                res.status(503).json({ error: 'jobs_busy', message: 'Scan storage is busy. Try again shortly.' });
                return;
            }
            if (mode === 'read')
                operation.readers += 1;
            else
                operation.writing = true;
            jobs.set(key, operation);
            release = () => {
                if (mode === 'read')
                    operation.readers -= 1;
                else
                    operation.writing = false;
                if (!operation.writing && operation.readers === 0)
                    jobs.delete(key);
            };
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
/** @description Explain stale output consistently; nonprintable current geometry remains available for inspection. */
function requireCurrentOutput(job, res, printing = false) {
    if (!hasCurrentOutput(job)) {
        res.status(409).json({ error: 'output_stale', message: 'Reconstruct this object after changing its inputs before downloading or printing.' });
        return false;
    }
    if (printing && job.report?.printable !== true) {
        res.status(409).json({ error: 'model_not_printable', message: 'The current model failed its mesh checks. Inspect the report and reconstruct before printing.' });
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