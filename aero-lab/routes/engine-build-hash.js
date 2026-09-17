"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation — the content hash of
 *   |                                           | the engine tree the container image bakes in,
 *   |                                           | computed over THIS package so the adapter can
 *   |                                           | refuse a container built from a different
 *   |                                           | engine. Byte-for-byte the same algorithm as
 *   |                                           | build_hash() in engine/container/
 *   |                                           | aero_engine_bridge.py (cross-checked by spec).
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
exports.ENGINE_RUNTIME_TREES = exports.ENGINE_RUNTIME_FILES = void 0;
exports.engineBuildFiles = engineBuildFiles;
exports.engineBuildHash = engineBuildHash;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'aero-engine-build-hash' });
/** Top-level files the image bakes in — mirrors RUNTIME_FILES in aero_engine_bridge.py. */
exports.ENGINE_RUNTIME_FILES = [
    'aero_lab_worker.py', 'service.py', 'export_build_files.py',
    'HYBRID_common.py', 'HYBRID_piecewise.py', 'requirements.txt', 'requirements-lock.txt',
];
/** Trees the image bakes in whole, minus caches — mirrors RUNTIME_TREES. */
exports.ENGINE_RUNTIME_TREES = ['aerosim', 'container'];
const SKIP_DIRS = new Set(['__pycache__']);
const SKIP_SUFFIX = '.pyc';
/** Code-point order, matching Python's sorted() for the ASCII paths this tree uses. */
function byCodePoint(a, b) {
    if (a < b)
        return -1;
    return a > b ? 1 : 0;
}
/** Collect relative POSIX paths under one tree, skipping caches. */
function walkTree(engineDir, rel, out) {
    const abs = path.join(engineDir, rel);
    if (!fs.existsSync(abs))
        return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const childRel = `${rel}/${entry.name}`;
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name))
                walkTree(engineDir, childRel, out);
        }
        else if (entry.isFile() && !entry.name.endsWith(SKIP_SUFFIX)) {
            out.push(childRel);
        }
    }
}
/**
 * @description List every file the engine image bakes in, as sorted relative POSIX paths.
 * @param engineDir - The package's engine/ directory.
 * @returns Sorted relative paths (the hash input order).
 */
function engineBuildFiles(engineDir) {
    const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
    const out = exports.ENGINE_RUNTIME_FILES.filter((name) => isFile(path.join(engineDir, name)));
    for (const tree of exports.ENGINE_RUNTIME_TREES)
        walkTree(engineDir, tree, out);
    return out.sort(byCodePoint);
}
/** Fold CRLF to LF so a Windows checkout and the deployed Linux copy of one commit agree. */
function foldCrlf(data) {
    if (!data.includes(0x0d))
        return data;
    const out = Buffer.alloc(data.length);
    let n = 0;
    for (let i = 0; i < data.length; i++) {
        if (data[i] === 0x0d && data[i + 1] === 0x0a)
            continue;
        out[n++] = data[i];
    }
    return out.subarray(0, n);
}
/**
 * @description Content hash of the engine tree a container image built from this package
 * would carry. The bridge reports the same hash for the tree actually baked into the running
 * image; a mismatch means the container predates (or postdates) this package's engine.
 * @param engineDir - The package's engine/ directory.
 * @returns 64-hex sha256, or null when the tree cannot be read.
 */
function engineBuildHash(engineDir) {
    try {
        const h = crypto.createHash('sha256');
        for (const rel of engineBuildFiles(engineDir)) {
            const digest = crypto.createHash('sha256').update(foldCrlf(fs.readFileSync(path.join(engineDir, rel)))).digest('hex');
            h.update(Buffer.concat([Buffer.from(rel, 'utf8'), Buffer.from([0]), Buffer.from(`${digest}\n`, 'ascii')]));
        }
        return h.digest('hex');
    }
    catch (err) {
        logger.error({ err, stack: err.stack, engineDir }, 'engine tree unreadable — cannot compute its build hash');
        return null;
    }
}
