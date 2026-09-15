"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadProjectValidator = loadProjectValidator;
exports.projectId = projectId;
exports.baseRevision = baseRevision;
exports.projectRecord = projectRecord;
exports.exactFields = exactFields;
exports.validateDocument = validateDocument;
exports.projectInput = projectInput;
exports.documentAssets = documentAssets;
/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Validate bounded inert project JSON and canonical immutable raster asset references without trusting identity fields.
 */
const create_project_types_1 = require("./create-project-types");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_url_1 = require("node:url");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
/** Capture the installed shared ESM model revision once; native import remains intact in Node16 emit. */
function loadProjectValidator(packageDir) {
    const file = (0, node_path_1.resolve)(packageDir, 'tools/editor/model-validation.mjs');
    const url = (0, node_url_1.pathToFileURL)(file);
    url.searchParams.set('revision', (0, node_crypto_1.createHash)('sha256').update((0, node_fs_1.readFileSync)(file)).digest('hex'));
    return import(url.href).then((module) => module.validateProject);
}
/** Validate server-generated record identifiers before database or filesystem use. */
function projectId(value) {
    if (typeof value !== 'string' || !UUID.test(value))
        throw new create_project_types_1.ProjectError(400, 'invalid_project_id');
    return value.toLowerCase();
}
/** Require the exact current optimistic revision; never coerce strings or fractions. */
function baseRevision(value) {
    if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > create_project_types_1.PROJECT_LIMITS.revisions) {
        throw new create_project_types_1.ProjectError(400, 'invalid_base_revision');
    }
    return Number(value);
}
/** Accept only plain JSON records, including objects parsed without a prototype. */
function projectRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
        && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
/** Reject unexpected envelope fields so identity and tenant selectors cannot be silently accepted. */
function exactFields(value, allowed) {
    if (!projectRecord(value) || Object.keys(value).some(key => !allowed.includes(key)))
        throw new create_project_types_1.ProjectError(400, 'invalid_project_fields');
}
/** Traverse before serializing, limiting depth, nodes and each scalar without invoking accessors. */
function inspectJson(value, state, depth) {
    if (++state.nodes > create_project_types_1.PROJECT_LIMITS.nodes || depth > create_project_types_1.PROJECT_LIMITS.depth)
        throw new create_project_types_1.ProjectError(400, 'project_document_too_complex');
    if (value === null || typeof value === 'boolean')
        return;
    if (typeof value === 'number' && Number.isFinite(value))
        return;
    if (typeof value === 'string') {
        if (value.length > create_project_types_1.PROJECT_LIMITS.documentBytes)
            throw new create_project_types_1.ProjectError(400, 'invalid_project_string');
        return;
    }
    if (!Array.isArray(value) && !projectRecord(value))
        throw new create_project_types_1.ProjectError(400, 'invalid_project_json');
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (Array.isArray(value) && key === 'length')
            continue;
        if (DANGEROUS_KEYS.has(key) || !('value' in descriptor))
            throw new create_project_types_1.ProjectError(400, 'invalid_project_json');
        inspectJson(descriptor.value, state, depth + 1);
    }
}
/** Check shared canvas bounds and asset reference syntax; asset ownership is verified by the store. */
function validateDocument(value, validate) {
    inspectJson(value, { nodes: 0 }, 0);
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > create_project_types_1.PROJECT_LIMITS.documentBytes)
        throw new create_project_types_1.ProjectError(413, 'project_document_too_large');
    try {
        return validate(JSON.parse(serialized), { assetMode: 'reference' });
    }
    catch {
        throw new create_project_types_1.ProjectError(400, 'invalid_project_document');
    }
}
/** Validate create/save envelopes independently of Express body-parser configuration. */
function projectInput(value, validate, save = false) {
    exactFields(value, save ? ['baseRevision', 'title', 'document'] : ['title', 'document']);
    if (save)
        baseRevision(value.baseRevision);
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > create_project_types_1.PROJECT_LIMITS.title)
        throw new create_project_types_1.ProjectError(400, 'invalid_project_title');
    const document = validateDocument(value.document, validate);
    if (document.name !== value.title)
        throw new create_project_types_1.ProjectError(400, 'project_title_mismatch');
    return { title: value.title, document };
}
/** Extract server-issued immutable IDs without imposing an identity on the document's local image keys. */
function documentAssets(document) {
    const images = document.images;
    return Object.values(images).map(image => {
        const id = projectId(image.src.slice(create_project_types_1.PROJECT_ASSET_PREFIX.length));
        if (image.src !== create_project_types_1.PROJECT_ASSET_PREFIX + id)
            throw new create_project_types_1.ProjectError(400, 'invalid_project_asset');
        return { id, width: image.width, height: image.height };
    });
}
//# sourceMappingURL=create-project-validation.js.map