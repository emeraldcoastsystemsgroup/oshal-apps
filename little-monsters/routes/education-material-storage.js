"use strict";
/**
 * Filesystem, extraction, and RAG lifecycle helpers for education materials.
 *
 * CHANGE LOG
 * ---------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * ---------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Added no-clobber storage, content-derived media types, containment checks, and per-material RAG lifecycle
 * ---------------------------------------------------------------------------
 *
 * @module education-material-storage
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
exports.materialCollectionName = materialCollectionName;
exports.classifyMaterial = classifyMaterial;
exports.saveMaterialFile = saveMaterialFile;
exports.resolveStoredMaterialPath = resolveStoredMaterialPath;
exports.deleteStoredMaterial = deleteStoredMaterial;
exports.extractMaterialText = extractMaterialText;
exports.ingestMaterialText = ingestMaterialText;
exports.deleteMaterialCollection = deleteMaterialCollection;
exports.extractStoredMaterialText = extractStoredMaterialText;
const crypto_1 = require("crypto");
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const util_1 = require("util");
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'education-material-storage' });
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/** Create a collision-resistant collection without putting user input in a path. */
function materialCollectionName(materialId) {
    return `lm-material-${materialId.replace(/-/g, '').toLowerCase()}`;
}
/** Classify only signatures the server understands; everything else downloads as binary. */
function classifyMaterial(buffer, declaredMime) {
    if (buffer.subarray(0, 5).toString() === '%PDF-')
        return { mimeType: 'application/pdf', extension: '.pdf' };
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        return { mimeType: 'image/png', extension: '.png' };
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
        return { mimeType: 'image/jpeg', extension: '.jpg' };
    if (/^GIF8[79]a/.test(buffer.subarray(0, 6).toString('ascii')))
        return { mimeType: 'image/gif', extension: '.gif' };
    if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
        return { mimeType: 'image/webp', extension: '.webp' };
    }
    const declared = String(declaredMime || '').toLowerCase();
    if ((declared === 'text/plain' || declared === 'text/markdown') && !buffer.includes(0)) {
        return { mimeType: 'text/plain; charset=utf-8', extension: '.txt' };
    }
    return { mimeType: 'application/octet-stream', extension: '.bin' };
}
/** Persist one upload under validated UUID directories with an exclusive create. */
function saveMaterialFile(classId, studentId, file) {
    const classification = classifyMaterial(file.buffer, file.mimetype);
    const directory = path.resolve(process.cwd(), 'workspace-shared', 'education', classId, 'materials', studentId);
    fs.mkdirSync(directory, { recursive: true });
    const storedPath = path.join(directory, `${(0, crypto_1.randomUUID)()}${classification.extension}`);
    // The wx flag is intentional: random names should never overwrite an existing
    // file, and a collision must fail rather than becoming a confused-deputy write.
    fs.writeFileSync(storedPath, file.buffer, { flag: 'wx' });
    return { storedPath, mimeType: classification.mimeType };
}
/** Prove both lexical and symlink-resolved containment before a persisted-path read. */
function resolveStoredMaterialPath(row) {
    const expectedRoot = path.resolve(process.cwd(), 'workspace-shared', 'education', row.class_id, 'materials', row.uploaded_by);
    const candidate = path.resolve(String(row.stored_path));
    const lexicalRelative = path.relative(expectedRoot, candidate);
    if (lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative))
        throw new Error('Material path escaped its owner directory');
    const realRoot = fs.realpathSync(expectedRoot);
    const realCandidate = fs.realpathSync(candidate);
    const realRelative = path.relative(realRoot, realCandidate);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative))
        throw new Error('Material path resolved outside its owner directory');
    return realCandidate;
}
/** Remove the stored file after containment validation; absence is already deleted. */
function deleteStoredMaterial(row) {
    if (!fs.existsSync(row.stored_path))
        return;
    const resolved = resolveStoredMaterialPath(row);
    fs.unlinkSync(resolved);
    logger.info({ materialId: row.material_id }, 'Stored material file deleted');
}
/** Extract bounded text from a supported material format. */
async function extractMaterialText(file) {
    const type = classifyMaterial(file.buffer, file.mimetype).mimeType;
    if (type === 'application/pdf')
        return parsePdf(file.buffer);
    if (type.startsWith('image/'))
        return ocrImage(file.buffer);
    if (type.startsWith('text/plain'))
        return file.buffer.toString('utf8').slice(0, 500_000);
    return '';
}
/** Parse embedded PDF text, then use bounded OCR for scanned pages. */
async function parsePdf(buffer) {
    try {
        const pdfParse = require('pdf-parse');
        const text = String((await pdfParse(buffer)).text || '').trim();
        if (text)
            return text.slice(0, 500_000);
    }
    catch (err) {
        logger.warn({ err }, 'Embedded PDF text extraction failed; trying OCR');
    }
    return ocrPdf(buffer);
}
/** Delete a temporary file with an observable warning on unexpected cleanup failure. */
function removeTemporaryFile(filePath) {
    try {
        if (fs.existsSync(filePath))
            fs.unlinkSync(filePath);
    }
    catch (err) {
        logger.warn({ err, filePath }, 'Temporary material file cleanup failed');
    }
}
/** OCR at most ten scanned PDF pages using a random, request-unique prefix. */
async function ocrPdf(buffer) {
    const base = path.join(os.tmpdir(), `lm-pdf-${(0, crypto_1.randomUUID)()}`);
    const pdfPath = `${base}.pdf`;
    const pages = [];
    try {
        fs.writeFileSync(pdfPath, buffer, { flag: 'wx' });
        await execFileAsync('pdftoppm', ['-png', '-r', '150', '-l', '10', pdfPath, base]);
        const prefix = path.basename(base);
        pages.push(...fs.readdirSync(path.dirname(base))
            .filter(name => name.startsWith(prefix) && name.endsWith('.png'))
            .map(name => path.join(path.dirname(base), name))
            .sort());
        const output = [];
        for (const page of pages)
            output.push(await runTesseract(page));
        return output.join('\n').trim().slice(0, 500_000);
    }
    catch (err) {
        logger.warn({ err }, 'Scanned PDF OCR failed; material remains stored without grounding');
        return '';
    }
    finally {
        removeTemporaryFile(pdfPath);
        for (const page of pages)
            removeTemporaryFile(page);
    }
}
/** Run OCR for one already-contained temporary image. */
async function runTesseract(filePath) {
    const result = await execFileAsync('tesseract', [filePath, 'stdout', '-l', 'eng'], {
        maxBuffer: 10 * 1024 * 1024,
    });
    return String(result.stdout || '');
}
/** OCR a single uploaded image without exposing its client-supplied filename. */
async function ocrImage(buffer) {
    const temporaryPath = path.join(os.tmpdir(), `lm-image-${(0, crypto_1.randomUUID)()}`);
    try {
        fs.writeFileSync(temporaryPath, buffer, { flag: 'wx' });
        return (await runTesseract(temporaryPath)).trim().slice(0, 500_000);
    }
    catch (err) {
        logger.warn({ err }, 'Image OCR failed; material remains stored without grounding');
        return '';
    }
    finally {
        removeTemporaryFile(temporaryPath);
    }
}
/** Ingest one material into its own collection so moderation can revoke it exactly. */
async function ingestMaterialText(text, collection, metadata) {
    if (!text)
        return false;
    try {
        const { RagService } = require('@/features/rag');
        const result = await new RagService().ingest([text], collection, metadata);
        logger.info({ collection: result.collection, chunkCount: result.chunkCount }, 'Material text ingested');
        return true;
    }
    catch (err) {
        logger.warn({ err, collection }, 'Material RAG ingestion failed');
        return false;
    }
}
/** Delete an exact per-material collection; callers decide whether failure is fatal. */
async function deleteMaterialCollection(collection) {
    const { RagService } = require('@/features/rag');
    await new RagService().deleteCollection(collection);
}
/** Re-extract a safely contained stored material for first approval or reindexing. */
async function extractStoredMaterialText(row) {
    const storedPath = resolveStoredMaterialPath(row);
    return extractMaterialText({ buffer: fs.readFileSync(storedPath), mimetype: row.mime_type });
}
//# sourceMappingURL=education-material-storage.js.map