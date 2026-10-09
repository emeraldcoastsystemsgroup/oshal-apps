"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadTimelineValidator = loadTimelineValidator;
exports.editorId = editorId;
exports.baseRevision = baseRevision;
exports.revisionParam = revisionParam;
exports.isRecord = isRecord;
exports.exactFields = exactFields;
exports.projectInput = projectInput;
exports.mediaKind = mediaKind;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Validate editor request envelopes before any database or filesystem work: server-issued UUIDs, exact optimistic revisions, exact field sets, and timeline documents checked by the SAME shipped module the browser editor uses (tools/editor/timeline-validation.mjs), loaded once per installed revision.
 */
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_url_1 = require("node:url");
const video_editor_types_1 = require("./video-editor-types");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * @description Import the installed shared timeline validator once; the revision query pins the exact bytes loaded.
 * @param packageDir - Installed package root. @returns The validator.
 */
function loadTimelineValidator(packageDir) {
    const file = (0, node_path_1.resolve)(packageDir, 'tools/editor/timeline-validation.mjs');
    const url = (0, node_url_1.pathToFileURL)(file);
    url.searchParams.set('revision', (0, node_crypto_1.createHash)('sha256').update((0, node_fs_1.readFileSync)(file)).digest('hex'));
    return import(url.href).then((module) => module.validateTimeline);
}
/** @description A server-issued UUID, lower-cased. @param value - Candidate. @returns The UUID. */
function editorId(value) {
    if (typeof value !== 'string' || !UUID.test(value))
        throw new video_editor_types_1.EditorError(400, 'invalid_video_edit_id');
    return value.toLowerCase();
}
/** @description The exact revision the caller last saw; never coerced from text or fractions. @param value - Candidate. @returns Revision. */
function baseRevision(value) {
    if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > video_editor_types_1.EDITOR_LIMITS.revisionNumber)
        throw new video_editor_types_1.EditorError(400, 'invalid_base_revision');
    return Number(value);
}
/** @description Parse a revision path segment of digits only. @param value - Path text. @returns Revision. */
function revisionParam(value) {
    return baseRevision(typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : NaN);
}
/** @description Plain JSON objects only (including prototype-less). @param value - Candidate. @returns True for a record. */
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
/** @description Refuse any field outside the allowed set, so identity or tenant fields cannot ride along. @returns void */
function exactFields(value, allowed) {
    if (!isRecord(value) || Object.keys(value).some(key => !allowed.includes(key)))
        throw new video_editor_types_1.EditorError(400, 'invalid_video_edit_fields');
}
/**
 * @description Validate a create or save envelope: exact fields, a bounded title equal to the document name, and a
 * document the shared validator accepts within the 256 KiB bound.
 * @param value - Parsed body. @param validate - Shared validator. @param save - Whether baseRevision is required.
 * @returns Title and normalized document.
 */
function projectInput(value, validate, save = false) {
    exactFields(value, save ? ['baseRevision', 'title', 'document'] : ['title', 'document']);
    if (save)
        baseRevision(value.baseRevision);
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > video_editor_types_1.EDITOR_LIMITS.title)
        throw new video_editor_types_1.EditorError(400, 'invalid_video_edit_title');
    let document;
    try {
        document = validate(value.document);
    }
    catch {
        throw new video_editor_types_1.EditorError(400, 'invalid_video_edit_document');
    }
    if (Buffer.byteLength(JSON.stringify(document)) > video_editor_types_1.EDITOR_LIMITS.documentBytes)
        throw new video_editor_types_1.EditorError(413, 'video_edit_document_too_large');
    if (document.name !== value.title)
        throw new video_editor_types_1.EditorError(400, 'video_edit_title_mismatch');
    return { title: value.title, document };
}
/** @description The declared kind of an upload, from its query. @param value - Query value. @returns 'video' or 'audio'. */
function mediaKind(value) {
    if (value !== 'video' && value !== 'audio')
        throw new video_editor_types_1.EditorError(400, 'invalid_video_edit_media_kind');
    return value;
}
