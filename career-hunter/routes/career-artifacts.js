"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCareerArtifacts = registerCareerArtifacts;
const path = __importStar(require("path"));
const fs_1 = require("fs");
const crypto_1 = require("crypto");
const multer_1 = __importDefault(require("multer"));
const logger_1 = require("@/shared/logger");
const career_user_store_1 = require("./career-user-store");
const career_engine_dispatch_1 = require("./career-engine-dispatch");
const career_engine_response_1 = require("./career-engine-response");
const career_engine_runner_1 = require("./career-engine-runner");
const career_file_transaction_1 = require("./career-file-transaction");
const logger = (0, logger_1.createChildLogger)({ module: 'career-artifacts' });
const ARTIFACT_KINDS = new Set(['resume-extra', 'linkedin-export', 'email', 'status-report', 'work-sample', 'other']);
const ALLOWED_EXT = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.tsv', '.html', '.htm', '.eml', '.json', '.zip']);
const MAX_ARTIFACT_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ARTIFACT_REQUEST_BYTES = 40 * 1024 * 1024;
const MAX_STORED_ARTIFACT_BYTES = 250 * 1024 * 1024;
const MAX_STORED_ARTIFACT_FILES = 200;
const MAX_LISTED_ARTIFACTS = 50;
const ENRICHMENT_LOG_READ_BYTES = 256 * 1024;
const ARTIFACT_REQUEST_BYTES = Symbol('career-artifact-request-bytes');
const ARTIFACT_LEASE = Symbol('career-artifact-lease');
const ARTIFACT_UPLOAD_TIMER = Symbol('career-artifact-upload-timer');
const ARTIFACT_UPLOAD_TIMED_OUT = Symbol('career-artifact-upload-timed-out');
/** Create an error Multer will propagate when all buffered files cross the aggregate ceiling. */
function aggregateLimitError() {
    return Object.assign(new Error('artifact upload exceeds the combined byte limit'), {
        code: 'LIMIT_TOTAL_FILE_SIZE',
    });
}
/** Buffer one file while atomically accounting bytes across every file in this request. */
function bufferArtifactFile(req, file, callback) {
    const chunks = [];
    let fileBytes = 0;
    let settled = false;
    const finish = (error) => {
        if (settled)
            return;
        settled = true;
        if (error)
            callback(error);
        else
            callback(undefined, { buffer: Buffer.concat(chunks, fileBytes), size: fileBytes });
    };
    file.stream.on('data', (raw) => {
        if (settled)
            return;
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        const requestBytes = (req[ARTIFACT_REQUEST_BYTES] || 0) + chunk.length;
        req[ARTIFACT_REQUEST_BYTES] = requestBytes;
        if (requestBytes > MAX_ARTIFACT_REQUEST_BYTES) {
            file.stream.resume();
            finish(aggregateLimitError());
            return;
        }
        chunks.push(chunk);
        fileBytes += chunk.length;
    });
    file.stream.once('error', finish);
    file.stream.once('end', () => finish());
}
/** Drop a buffered file if Multer rolls the request back. */
function removeBufferedArtifact(_req, file, callback) {
    delete file.buffer;
    callback(null);
}
const artifactUpload = (0, multer_1.default)({
    storage: { _handleFile: bufferArtifactFile, _removeFile: removeBufferedArtifact },
    limits: { fileSize: MAX_ARTIFACT_FILE_BYTES, files: 20, fields: 8, parts: 29 },
});
const parseArtifactFiles = artifactUpload.array('files', 20);
/** Sanitize an uploaded filename to a safe basename (no path segments, bounded length). */
function safeName(name) {
    return (path.basename(String(name || 'artifact')).replace(/[^\w.\- ]/g, '_')).slice(0, 120) || 'artifact';
}
/** The per-user artifacts dir (under the career store's uploads/). */
function artifactsDir(userSub) {
    return path.join((0, career_user_store_1.userPaths)(userSub).userDir, 'uploads', 'artifacts');
}
/** Count only supported files when reserving durable quota for an incoming request. */
function acceptedArtifactFootprint(files) {
    let count = 0;
    let bytes = 0;
    for (const file of files) {
        const extension = path.extname(safeName(file.originalname || 'artifact')).toLowerCase();
        if (!ALLOWED_EXT.has(extension))
            continue;
        count += 1;
        bytes += file.buffer.length;
    }
    return { count, bytes };
}
/** Stream existing entries under the held user lease and stop as soon as either quota is full. */
async function artifactQuotaAvailable(dir, incoming) {
    let count = incoming.count;
    let bytes = incoming.bytes;
    if (count > MAX_STORED_ARTIFACT_FILES || bytes > MAX_STORED_ARTIFACT_BYTES)
        return false;
    const directory = await fs_1.promises.opendir(dir);
    for await (const entry of directory) {
        count += 1;
        if (!entry.isFile() || count > MAX_STORED_ARTIFACT_FILES)
            return false;
        bytes += (await fs_1.promises.lstat(path.join(dir, entry.name))).size;
        if (bytes > MAX_STORED_ARTIFACT_BYTES)
            return false;
    }
    return true;
}
/** Retain only the lexically newest timestamp-prefixed names before opening any file metadata. */
async function recentArtifactNames(dir) {
    const names = [];
    const directory = await fs_1.promises.opendir(dir);
    for await (const entry of directory) {
        if (!entry.isFile())
            continue;
        names.push(entry.name);
        names.sort((left, right) => right.localeCompare(left));
        if (names.length > MAX_LISTED_ARTIFACTS)
            names.pop();
    }
    return names;
}
/** Stat only the bounded newest-name candidate set and return display-safe metadata. */
async function listRecentArtifacts(dir) {
    const names = await recentArtifactNames(dir);
    const uploaded = await Promise.all(names.map(async (name) => {
        const stat = await fs_1.promises.lstat(path.join(dir, name));
        return {
            name: name.replace(/^\d+-(?:[0-9a-f-]{36}-)?\d+-/i, ''),
            size: stat.size,
            at: stat.mtime.toISOString(),
        };
    }));
    return uploaded.sort((left, right) => right.at.localeCompare(left.at));
}
/** Read a bounded UTF-8 tail and discard the first partial line when seeking into a large file. */
async function readLogTail(filePath) {
    const handle = await fs_1.promises.open(filePath, 'r');
    try {
        const stat = await handle.stat();
        const length = Math.min(stat.size, ENRICHMENT_LOG_READ_BYTES);
        const offset = stat.size - length;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        const text = buffer.subarray(0, bytesRead).toString('utf8');
        return offset > 0 ? text.slice(Math.max(0, text.indexOf('\n') + 1)) : text;
    }
    finally {
        await handle.close();
    }
}
/** Validate and atomically store one request's files under a collision-resistant prefix. */
async function storeArtifactBatch(files, dir, kind, pending, rejected) {
    const requestId = (0, crypto_1.randomUUID)();
    let ordinal = 0;
    for (const file of files) {
        const name = safeName(file.originalname || 'artifact');
        if (!ALLOWED_EXT.has(path.extname(name).toLowerCase())) {
            rejected.push({ name, reason: 'unsupported type' });
            continue;
        }
        const destination = path.join(dir, `${Date.now()}-${requestId}-${ordinal++}-${name}`);
        await (0, career_file_transaction_1.writeFileAtomicAsync)(destination, file.buffer);
        pending.push({ name, kind, path: destination });
    }
}
/** Remove only the UUID-namespaced files created by this request. */
async function rollbackArtifactBatch(pending) {
    let firstError;
    for (const item of pending) {
        try {
            await fs_1.promises.rm(item.path, { force: true });
        }
        catch (error) {
            firstError ||= error;
        }
    }
    if (firstError)
        throw firstError;
}
/** Release and forget a parser-level lease; opaque lease tokens make repeats harmless. */
function releaseArtifactLease(req) {
    if (req[ARTIFACT_UPLOAD_TIMER])
        clearTimeout(req[ARTIFACT_UPLOAD_TIMER]);
    delete req[ARTIFACT_UPLOAD_TIMER];
    const lease = req[ARTIFACT_LEASE];
    if (!lease)
        return;
    delete req[ARTIFACT_LEASE];
    (0, career_engine_runner_1.releaseRun)(lease);
}
/** Clamp multipart time separately from the long-running artifact extraction deadline. */
function artifactUploadTimeout() {
    const configured = Number(process.env.CAREER_HUNTER_UPLOAD_TIMEOUT_MS) || 60_000;
    return Math.min(10 * 60_000, Math.max(1_000, configured));
}
/** Terminate a slow artifact body and return its upload-only reservation. */
function expireArtifactUpload(req, res) {
    req[ARTIFACT_UPLOAD_TIMED_OUT] = true;
    releaseArtifactLease(req);
    if (!res.headersSent) {
        res.status(408).set('Connection', 'close').json({ error: 'artifact upload timed out' });
    }
    setImmediate(() => req.destroy());
}
/** Reject per-user duplicates or global saturation before buffering, without taking engine capacity. */
function admitArtifactUpload(req, res, next) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const lease = (0, career_engine_runner_1.tryAcquireUploadRun)(userSub);
    if ((0, career_engine_response_1.rejectUploadClaim)(res, lease, 'artifact upload'))
        return;
    req[ARTIFACT_LEASE] = lease;
    req[ARTIFACT_UPLOAD_TIMER] = setTimeout(() => expireArtifactUpload(req, res), artifactUploadTimeout());
    req[ARTIFACT_UPLOAD_TIMER]?.unref?.();
    req.once('aborted', () => releaseArtifactLease(req));
    next();
}
/** Convert multipart ceilings to 413 and always return parser failures' reservation. */
function parseArtifactUpload(req, res, next) {
    parseArtifactFiles(req, res, (error) => {
        if (req[ARTIFACT_UPLOAD_TIMER])
            clearTimeout(req[ARTIFACT_UPLOAD_TIMER]);
        delete req[ARTIFACT_UPLOAD_TIMER];
        if (req[ARTIFACT_UPLOAD_TIMED_OUT])
            return;
        if (!error) {
            next();
            return;
        }
        releaseArtifactLease(req);
        const code = String(error.code || '');
        if (code.startsWith('LIMIT_')) {
            res.status(413).json({ error: 'artifact upload exceeds the file or request limit' });
            return;
        }
        next(error);
    });
}
/** Sum already-buffered fixture inputs so direct handler tests enforce the production ceiling. */
function bufferedArtifactBytes(files) {
    return files.reduce((total, file) => total + file.buffer.length, 0);
}
/** Validate direct-handler and parsed file arrays before any filesystem mutation. */
function validArtifactFiles(req, res) {
    const files = req.files || [];
    if (!files.length) {
        releaseArtifactLease(req);
        res.status(400).json({ error: 'no files' });
        return null;
    }
    const invalidFile = files.some((file) => !Buffer.isBuffer(file.buffer)
        || file.buffer.length > MAX_ARTIFACT_FILE_BYTES);
    if (!invalidFile && bufferedArtifactBytes(files) <= MAX_ARTIFACT_REQUEST_BYTES)
        return files;
    releaseArtifactLease(req);
    res.status(413).json({ error: 'artifact upload exceeds the combined byte limit' });
    return null;
}
/** Handle the leased write-to-child transaction for one authenticated artifact upload. */
async function handleArtifactUpload(ctx, req, res) {
    const userSub = (0, career_user_store_1.callerSub)(req);
    if (!userSub) {
        releaseArtifactLease(req);
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const files = validArtifactFiles(req, res);
    if (!files)
        return;
    const kindRaw = String((req.body?.kind || 'other')).trim();
    const kind = ARTIFACT_KINDS.has(kindRaw) ? kindRaw : 'other';
    const artifactReq = req;
    const lease = (0, career_engine_runner_1.tryAcquireRun)(userSub, 'user-store');
    releaseArtifactLease(artifactReq);
    if ((0, career_engine_response_1.rejectEngineClaim)(res, lease, 'artifact absorb'))
        return;
    const pending = [];
    const rejected = [];
    let handedOff = false;
    let rolledBack = false;
    try {
        const dir = artifactsDir(userSub);
        await fs_1.promises.mkdir(dir, { recursive: true });
        if (!await artifactQuotaAvailable(dir, acceptedArtifactFootprint(files))) {
            res.status(413).json({ error: 'artifact storage quota exceeded' });
            return;
        }
        await storeArtifactBatch(files, dir, kind, pending, rejected);
        if (!pending.length) {
            res.status(400).json({ started: false, accepted: [], rejected });
            return;
        }
        const items = pending.map((item) => ({ path: item.path, kind: item.kind }));
        const started = await (0, career_engine_dispatch_1.runCareerCliAsync)(ctx.pool, userSub, ['absorb-batch'], {
            CH_ARTIFACTS: JSON.stringify(items),
        }, { preclaimed: lease, adoptPreclaim: true });
        if (!started.started) {
            await rollbackArtifactBatch(pending);
            rolledBack = true;
            (0, career_engine_response_1.rejectEngineStart)(res, started, 'artifact absorb');
            return;
        }
        handedOff = true;
        delete artifactReq[ARTIFACT_LEASE];
        const accepted = pending.map(({ name, kind: acceptedKind }) => ({ name, kind: acceptedKind }));
        logger.info({ userSub, kind, accepted: accepted.length, rejected: rejected.length }, 'career artifacts uploaded');
        res.status(202).json({ started: true, accepted, rejected });
    }
    catch (error) {
        let rollbackError;
        if (!handedOff && !rolledBack) {
            try {
                await rollbackArtifactBatch(pending);
            }
            catch (failure) {
                rollbackError = failure;
            }
        }
        logger.error({ err: error, rollbackError, userSub }, 'artifact upload failed');
        if (!res.headersSent)
            res.status(500).json({ error: 'upload failed' });
    }
    finally {
        if (!handedOff) {
            if (artifactReq[ARTIFACT_LEASE] === lease)
                delete artifactReq[ARTIFACT_LEASE];
            (0, career_engine_runner_1.releaseRun)(lease);
        }
    }
}
/**
 * @description Register the career-artifact routes on the (already auth-gated) career-hunter router.
 * @param router the career-hunter router
 * @param ctx app context used to broker only this caller's Career credentials
 * @returns nothing
 */
function registerCareerArtifacts(router, ctx) {
    // POST /artifacts/upload — up to 20 files, one `kind` for the batch. Stores each and fires the
    // engine `absorb-batch` verb. Its acknowledged child owns the request's preclaimed lease.
    router.post('/artifacts/upload', admitArtifactUpload, parseArtifactUpload, (req, res) => handleArtifactUpload(ctx, req, res));
    // GET /artifacts — uploaded artifacts + the most recent profile additions (from enrichment_log),
    // so the surface/agent can show "here's what I learned" after an absorb completes.
    router.get('/artifacts', async (req, res) => {
        const userSub = (0, career_user_store_1.callerSub)(req);
        if (!userSub) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
        const dir = artifactsDir(userSub);
        let uploaded = [];
        try {
            uploaded = await listRecentArtifacts(dir);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                logger.error({ err: error, userSub }, 'career artifact listing failed');
        }
        // Recent enrichment-log changelogs (augment writes {at, facts, changelog} per merge).
        const learned = [];
        try {
            const logPath = path.join((0, career_user_store_1.userPaths)(userSub).userDir, 'enrichment_log.jsonl');
            const lines = (await readLogTail(logPath)).trim().split('\n').slice(-15);
            for (const line of lines) {
                try {
                    const e = JSON.parse(line);
                    if (Array.isArray(e.changelog) && e.changelog.length)
                        learned.push({ at: String(e.at || ''), changelog: e.changelog });
                }
                catch (error) {
                    logger.warn({ err: error, userSub }, 'career enrichment log line ignored');
                }
            }
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                logger.error({ err: error, userSub }, 'career enrichment log read failed');
        }
        res.json({ uploaded, learned: learned.reverse() });
    });
}
//# sourceMappingURL=career-artifacts.js.map