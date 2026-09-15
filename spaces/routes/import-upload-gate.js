"use strict";
/**
 * Spaces (ADR-111) — the streaming size gate of the model import lane.
 *
 * @module import-upload-gate
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | A multer storage engine that streams an upload into the scan dir while counting bytes and refuses a .ply the moment it crosses the kernel-configured gate (resolvePlyImportLimits — OSHAL_SPACES_PLY_MAX_BYTES; no number lives here): the partial file is unlinked once its handle closes, the rest of the part is drained, and the route answers 413 naming the limit. multer's own limits.fileSize is one number for every file and the extension is only known when the part header arrives, which is why the gate is an engine and not a limit. Why: a 117 MB .ply reached the kernel converter on the api's event loop and collapsed the Docker VM (2026-09-14). Guarded by tests/ply-import-off-loop.core.test.js.
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImportTooLargeError = void 0;
exports.importTooLargeBody = importTooLargeBody;
exports.createGatedDiskStorage = createGatedDiskStorage;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const spatial_mapping_1 = require("@/features/spatial-mapping");
const logger = (0, logger_1.createChildLogger)({ module: 'spaces-import-upload-gate' });
/**
 * @description Raised by the engine when a part crosses the gate for its extension. Carries what
 * the 413 body needs: the extension, the limit, and how many bytes had arrived when it was refused
 * (which is how a test proves the refusal happened while streaming, not after the whole file).
 */
class ImportTooLargeError extends Error {
    ext;
    limitBytes;
    receivedBytes;
    constructor(ext, limitBytes, receivedBytes) {
        super(`a ${ext} import may be at most ${(0, spatial_mapping_1.formatByteLimit)(limitBytes)} (${limitBytes} bytes)`);
        this.ext = ext;
        this.limitBytes = limitBytes;
        this.receivedBytes = receivedBytes;
        this.name = 'ImportTooLargeError';
    }
}
exports.ImportTooLargeError = ImportTooLargeError;
/**
 * @description The JSON body of the 413: the limit named as a label, as bytes, and in a sentence a
 * human can act on, plus the byte count at refusal.
 * @param err - The refusal
 * @returns The response body
 */
function importTooLargeBody(err) {
    return {
        error: 'model_too_large',
        format: err.ext,
        maxBytes: err.limitBytes,
        maxLabel: (0, spatial_mapping_1.formatByteLimit)(err.limitBytes),
        receivedBytes: err.receivedBytes,
        message: `${err.message}; reduce the capture or export a .splat`,
    };
}
/** Stream one part to disk under its gate; settle multer's callback exactly once. */
function streamWithGate(req, file, opts, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const limit = opts.limitFor(file);
    let settled = false;
    const settle = (err, info) => {
        if (settled)
            return;
        settled = true;
        cb(err, info);
    };
    opts.destination(req, file).then((dir) => {
        const finalPath = path.join(dir, opts.filename(file));
        const out = fs.createWriteStream(finalPath);
        let received = 0;
        const refuse = () => {
            file.stream.unpipe(out);
            out.once('close', () => {
                fs.promises.unlink(finalPath).catch((e) => logger.warn({ e, finalPath }, 'partial import unlink failed'));
            });
            out.destroy();
            file.stream.resume();
            logger.warn({ ext, limitBytes: limit, receivedBytes: received }, 'model import refused while streaming: over the gate');
            settle(new ImportTooLargeError(ext, limit, received));
        };
        file.stream.on('data', (chunk) => {
            received += chunk.length;
            if (limit !== undefined && received > limit && !settled)
                refuse();
        });
        out.on('error', (err) => {
            logger.error({ err, finalPath }, 'import write failed');
            settle(err);
        });
        out.on('finish', () => settle(null, { destination: dir, filename: path.basename(finalPath), path: finalPath, size: out.bytesWritten }));
        file.stream.pipe(out);
    }).catch((err) => {
        logger.error({ err }, 'import destination could not be prepared');
        settle(err);
    });
}
/**
 * @description A disk storage engine with a per-file byte gate. Everything multer's diskStorage
 * does (stream to `destination/filename`, report `path` and `size`) plus: when `limitFor` names a
 * gate for the file, the write stops at the first chunk past it and multer receives an
 * ImportTooLargeError — the remainder of the part is never written or parsed.
 * @param opts - Placement and gate callbacks
 * @returns The multer storage engine
 */
function createGatedDiskStorage(opts) {
    return {
        _handleFile(req, file, cb) {
            streamWithGate(req, file, opts, cb);
        },
        _removeFile(_req, file, cb) {
            fs.unlink(file.path, (err) => cb(err ?? null));
        },
    };
}
//# sourceMappingURL=import-upload-gate.js.map