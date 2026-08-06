"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readResumeIngestState = readResumeIngestState;
exports.registerCareerResumeUpload = registerCareerResumeUpload;
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const crypto_1 = require("crypto");
const multer_1 = __importDefault(require("multer"));
const logger_1 = require("@/shared/logger");
const career_user_store_1 = require("./career-user-store");
const career_engine_dispatch_1 = require("./career-engine-dispatch");
const career_engine_response_1 = require("./career-engine-response");
const career_engine_runner_1 = require("./career-engine-runner");
const career_file_transaction_1 = require("./career-file-transaction");
const logger = (0, logger_1.createChildLogger)({ module: 'career-resume-upload' });
const resumeUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 8 * 1024 * 1024,
        files: 1,
        fields: 0,
        parts: 2,
        fieldNameSize: 64,
        fieldSize: 4 * 1024,
        headerPairs: 32,
    },
});
const parseResumeFile = resumeUpload.single('resume');
const RESUME_LEASE = Symbol('career-resume-lease');
const RESUME_UPLOAD_TIMER = Symbol('career-resume-upload-timer');
const RESUME_UPLOAD_TIMED_OUT = Symbol('career-resume-upload-timed-out');
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md']);
const INGEST_STATUS_FILE = '.resume-ingest.json';
const INGEST_MARKER_FILE = '.indexing';
/** Resolve canonical lifecycle paths for one contained user store. */
function ingestPaths(userSub) {
    const userDir = (0, career_user_store_1.userPaths)(userSub).userDir;
    return {
        status: path_1.default.join(userDir, INGEST_STATUS_FILE),
        marker: path_1.default.join(userDir, INGEST_MARKER_FILE),
    };
}
/** Parse one status file and reject malformed lifecycle data. */
async function readStatusFile(filePath) {
    try {
        const value = JSON.parse(await fs_1.promises.readFile(filePath, 'utf8'));
        if (!['pending', 'succeeded', 'failed'].includes(value.state))
            throw new Error('invalid ingest state');
        return value;
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        logger.error({ err: error }, 'career resume ingest status is unreadable');
        return { state: 'failed', error: 'resume ingest status is unreadable' };
    }
}
/** Bound pending state across an API restart where no completion callback can survive. */
function expireInterruptedIngest(status) {
    if (status.state !== 'pending' || !status.startedAt)
        return status;
    const configured = Number(process.env.CAREER_HUNTER_CLI_TIMEOUT_MS) || 2 * 60 * 60 * 1_000;
    const maxAge = Math.min(24 * 60 * 60 * 1_000, Math.max(1_000, configured)) + 5 * 60 * 1_000;
    if (Date.now() - status.startedAt <= maxAge)
        return status;
    return { ...status, state: 'failed', finishedAt: status.startedAt + maxAge, error: 'resume ingest was interrupted' };
}
/** Read either the current pending marker or a legacy numeric timestamp marker. */
async function readIngestMarker(marker) {
    try {
        const raw = await fs_1.promises.readFile(marker, 'utf8');
        if (raw.trim().startsWith('{')) {
            const state = JSON.parse(raw);
            if (state.state !== 'pending' || !Number.isFinite(state.startedAt))
                throw new Error('invalid ingest marker');
            return expireInterruptedIngest(state);
        }
        const startedAt = Number(raw);
        if (!Number.isFinite(startedAt))
            return { state: 'failed', error: 'resume ingest marker is invalid' };
        return expireInterruptedIngest({ state: 'pending', operationId: 'legacy', startedAt });
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            logger.error({ err: error }, 'career resume ingest marker is unreadable');
        return error.code === 'ENOENT'
            ? null : { state: 'failed', error: 'resume ingest marker is unreadable' };
    }
}
/** Prefer a newer pending marker over stale success/failure left by an interrupted re-upload. */
function reconcileIngestState(status, marker) {
    if (!status)
        return marker || { state: 'idle' };
    if (!marker || marker.state !== 'pending' || !marker.startedAt)
        return expireInterruptedIngest(status);
    const statusAt = Math.max(status.startedAt || 0, status.finishedAt || 0);
    return marker.startedAt > statusAt ? marker : expireInterruptedIngest(status);
}
/**
 * @description Read the current resume-ingest lifecycle without using an old profile as completion.
 * @param userSub authenticated caller subject
 * @returns durable pending/success/failure state, including bounded legacy marker recovery
 */
async function readResumeIngestState(userSub) {
    const paths = ingestPaths(userSub);
    const [status, marker] = await Promise.all([
        readStatusFile(paths.status), readIngestMarker(paths.marker),
    ]);
    return reconcileIngestState(status, marker);
}
/** Allow a just-spawned child to outlive the short pending-state transaction before completing. */
async function claimResumeLifecycle(userSub, signal) {
    let lease = (0, career_engine_runner_1.tryAcquireStorageRun)(userSub, 'resume-lifecycle');
    for (let attempt = 0; lease.status === 'inflight' && attempt < 4; attempt += 1) {
        if (signal?.aborted)
            return lease;
        await new Promise((resolve) => setTimeout(resolve, 10));
        lease = (0, career_engine_runner_1.tryAcquireStorageRun)(userSub, 'resume-lifecycle');
    }
    return lease;
}
/** Finish only the operation whose marker is still current, then remove its legacy marker. */
async function finalizeResumeIngest(userSub, operationId, completion, signal) {
    const lifecycle = await claimResumeLifecycle(userSub, signal);
    if (lifecycle.status !== 'ok') {
        logger.warn({ userSub, operationId, reason: lifecycle.status }, 'resume completion lifecycle busy');
        return;
    }
    try {
        if (signal?.aborted)
            return;
        const paths = ingestPaths(userSub);
        const current = await readStatusFile(paths.status);
        if (!current || current.operationId !== operationId || current.state !== 'pending') {
            logger.warn({ userSub, operationId }, 'stale resume ingest completion ignored');
            return;
        }
        const state = {
            ...current,
            state: completion.ok ? 'succeeded' : 'failed',
            finishedAt: Date.now(),
            error: completion.ok ? undefined : (completion.timedOut ? 'resume ingest timed out' : 'resume ingest failed'),
        };
        if (signal?.aborted)
            return;
        await (0, career_file_transaction_1.writeFileAtomicAsync)(paths.status, JSON.stringify(state));
        await fs_1.promises.rm(paths.marker, { force: true });
    }
    finally {
        (0, career_engine_runner_1.releaseRun)(lifecycle);
    }
}
/** Convert a rejected lease to the same result shape as an OS-level start rejection. */
function rejectedLease(status) {
    return { started: false, err: `career engine ${status}`, limitReason: status };
}
/** Store the resume and transfer the already-held lease to the background engine child. */
async function startResumeIngest(pool, userSub, file, extension, lease) {
    const lifecycle = (0, career_engine_runner_1.tryAcquireStorageRun)(userSub, 'resume-lifecycle');
    if (lifecycle.status !== 'ok') {
        (0, career_engine_runner_1.releaseRun)(lease);
        return rejectedLease(lifecycle.status);
    }
    const userDir = (0, career_user_store_1.userPaths)(userSub).userDir;
    const uploadDir = path_1.default.join(userDir, 'uploads');
    const destination = path_1.default.join(uploadDir, `resume${extension}`);
    const { marker: indexing, status } = ingestPaths(userSub);
    const operationId = (0, crypto_1.randomUUID)();
    const pending = { state: 'pending', operationId, startedAt: Date.now() };
    let snapshots = [];
    let handedOff = false;
    try {
        await fs_1.promises.mkdir(uploadDir, { recursive: true });
        snapshots = await (0, career_file_transaction_1.snapshotFilesAsync)([destination, indexing, status]);
        await (0, career_file_transaction_1.writeFileAtomicAsync)(status, JSON.stringify(pending));
        await (0, career_file_transaction_1.writeFileAtomicAsync)(destination, file.buffer);
        await (0, career_file_transaction_1.writeFileAtomicAsync)(indexing, JSON.stringify(pending));
        const result = await (0, career_engine_dispatch_1.runCareerCliAsync)(pool, userSub, ['ingest'], {
            CH_RESUME: destination,
            CH_RESUME_OPERATION_ID: operationId,
        }, {
            preclaimed: lease, adoptPreclaim: true,
            onComplete: (completion, signal) => finalizeResumeIngest(userSub, operationId, completion, signal),
        });
        if (result.started)
            handedOff = true;
        else
            await (0, career_file_transaction_1.restoreFilesAsync)(snapshots);
        return result;
    }
    catch (error) {
        if (snapshots.length)
            await (0, career_file_transaction_1.restoreFilesAsync)(snapshots);
        throw error;
    }
    finally {
        (0, career_engine_runner_1.releaseRun)(lifecycle);
        if (!handedOff)
            (0, career_engine_runner_1.releaseRun)(lease);
    }
}
/** Release a request reservation on parser/validation failure. */
function releaseResumeLease(req) {
    if (req[RESUME_UPLOAD_TIMER])
        clearTimeout(req[RESUME_UPLOAD_TIMER]);
    delete req[RESUME_UPLOAD_TIMER];
    const lease = req[RESUME_LEASE];
    if (!lease)
        return;
    delete req[RESUME_LEASE];
    (0, career_engine_runner_1.releaseRun)(lease);
}
/** Clamp the multipart body deadline independently from the much longer engine deadline. */
function resumeUploadTimeout() {
    const configured = Number(process.env.CAREER_HUNTER_UPLOAD_TIMEOUT_MS) || 60_000;
    return Math.min(10 * 60_000, Math.max(1_000, configured));
}
/** End one slow request and release its upload-only lane without consuming engine capacity. */
function expireResumeUpload(req, res) {
    req[RESUME_UPLOAD_TIMED_OUT] = true;
    releaseResumeLease(req);
    if (!res.headersSent) {
        res.status(408).set('Connection', 'close').json({ error: 'resume upload timed out' });
    }
    setImmediate(() => req.destroy());
}
/** Reserve per-user and global upload lanes before Multer buffers the body, but not an engine slot. */
function admitResumeUpload(req, res, next) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const lease = (0, career_engine_runner_1.tryAcquireUploadRun)(userSub);
    if ((0, career_engine_response_1.rejectUploadClaim)(res, lease, 'resume upload'))
        return;
    req[RESUME_LEASE] = lease;
    req[RESUME_UPLOAD_TIMER] = setTimeout(() => expireResumeUpload(req, res), resumeUploadTimeout());
    req[RESUME_UPLOAD_TIMER]?.unref?.();
    req.once('aborted', () => releaseResumeLease(req));
    next();
}
/** Parse one bounded resume and map body-limit errors without leaking its reservation. */
function parseResumeUpload(req, res, next) {
    parseResumeFile(req, res, (error) => {
        if (req[RESUME_UPLOAD_TIMER])
            clearTimeout(req[RESUME_UPLOAD_TIMER]);
        delete req[RESUME_UPLOAD_TIMER];
        if (req[RESUME_UPLOAD_TIMED_OUT])
            return;
        if (!error) {
            next();
            return;
        }
        releaseResumeLease(req);
        const code = String(error.code || '');
        if (code.startsWith('LIMIT_')) {
            res.status(413).json({ error: 'resume exceeds the upload limit' });
            return;
        }
        next(error);
    });
}
/** Validate a parsed upload and execute its durable lease-to-child hand-off. */
async function handleResumeUpload(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        releaseResumeLease(req);
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const file = req.file;
    if (!file) {
        releaseResumeLease(req);
        res.status(400).json({ error: 'no file' });
        return;
    }
    const extension = path_1.default.extname(file.originalname || '').toLowerCase() || '.pdf';
    if (!ALLOWED_EXTENSIONS.has(extension)) {
        releaseResumeLease(req);
        res.status(400).json({ error: 'Upload a PDF, DOCX, TXT, or MD resume.' });
        return;
    }
    const lease = (0, career_engine_runner_1.tryAcquireRun)(userSub, 'user-store');
    releaseResumeLease(req);
    if (lease.status !== 'ok') {
        (0, career_engine_response_1.rejectEngineStart)(res, rejectedLease(lease.status), 'resume ingest');
        return;
    }
    try {
        const started = await startResumeIngest(ctx.pool, userSub, file, extension, lease);
        if ((0, career_engine_response_1.rejectEngineStart)(res, started, 'resume ingest'))
            return;
        logger.info({ userSub, extension }, 'career resume ingest started');
        res.status(202).json({ started: true });
    }
    catch (error) {
        logger.error({ err: error, userSub }, 'resume upload failed');
        res.status(500).json({ error: 'upload failed' });
    }
}
/**
 * @description Register pre-admitted, bounded resume upload on the authenticated Career router.
 * @param router parent package router
 * @param ctx kernel services used for credential brokerage
 * @returns nothing
 */
function registerCareerResumeUpload(router, ctx) {
    router.post('/resume/upload', admitResumeUpload, parseResumeUpload, (req, res) => handleResumeUpload(ctx, req, res));
}
//# sourceMappingURL=career-resume-upload.js.map