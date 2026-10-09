"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (0.2.0) — a pure move out of project-routes.ts so
 *                     |                             | the in-process package tools shape replies and refusals exactly
 *                     |                             | like the routes without loading express or multer: the public
 *                     |                             | project view, the title and option readers, and the error
 *                     |                             | classification behind the routes' refuse(). Behaviour is
 *                     |                             | unchanged; project-routes.ts now imports these.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicProject = publicProject;
exports.classifyFailure = classifyFailure;
exports.projectTitle = projectTitle;
exports.intOption = intOption;
exports.optionalString = optionalString;
const engine_client_1 = require("./engine-client");
const project_files_1 = require("./project-files");
const project_service_1 = require("./project-service");
/**
 * @description The project as the API returns it (preview URLs resolved, totals as numbers).
 * @param p - The stored project row.
 * @returns The public project object.
 */
function publicProject(p) {
    return {
        projectId: p.project_id, title: p.title, kind: p.kind, template: p.template, revision: p.revision,
        fileCount: p.file_count, totalBytes: Number(p.total_bytes),
        preview: p.preview ? (0, project_service_1.previewView)(p.project_id, p.preview) : null,
        lastRun: p.last_run ?? null, createdAt: p.created_at, updatedAt: p.updated_at,
    };
}
/**
 * @description Classify a thrown error the way the routes answer it. Known refusals keep their own
 * status, code and field so a person in the studio and a concierge calling a tool read the same
 * reason; anything else is unexpected and the caller logs it.
 * @param error - What the service threw.
 * @returns The status and body, or null when the error is not a known refusal.
 */
function classifyFailure(error) {
    if (error instanceof engine_client_1.EngineFailure) {
        const status = error.code === 'refused' ? 400 : error.code === 'engine_timeout' ? 504 : error.code === 'engine_error' ? 502 : 503;
        return { status, body: { error: error.code, message: error.message, reason: error.reason ?? error.message } };
    }
    if (error instanceof project_files_1.FileError)
        return { status: error.status, body: { error: 'invalid_file', field: error.field, message: error.message } };
    if (error instanceof project_service_1.RequestError)
        return { status: 400, body: { error: 'invalid_request', field: error.field, message: error.message } };
    if (error instanceof project_service_1.NotFoundError)
        return { status: 404, body: { error: error.message } };
    if (error instanceof project_service_1.ConflictError)
        return { status: 409, body: { error: 'conflict', message: error.message } };
    if (error instanceof RangeError)
        return { status: 400, body: { error: 'invalid_id', message: error.message } };
    return null;
}
/**
 * @description A project title: whitespace folded, at most 120 characters, or the fallback.
 * @param value - The caller's title.
 * @param fallback - Used when the title is empty.
 * @returns The title to store.
 */
function projectTitle(value, fallback) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return text || fallback;
}
/**
 * @description An optional integer within bounds (absent, null and '' mean "not given").
 * @param value - The caller's value.
 * @param field - Its name, for the refusal.
 * @param lo - Smallest accepted value.
 * @param hi - Largest accepted value.
 * @returns The integer, or undefined when absent. @throws RequestError outside the bounds.
 */
function intOption(value, field, lo, hi) {
    if (value === undefined || value === null || value === '')
        return undefined;
    const n = Number(value);
    if (!Number.isInteger(n) || n < lo || n > hi)
        throw new project_service_1.RequestError(`${field} must be an integer from ${lo} to ${hi}`, field);
    return n;
}
/**
 * @description An optional string (absent, null and '' mean "not given").
 * @param value - The caller's value.
 * @param field - Its name, for the refusal.
 * @returns The string, or undefined when absent. @throws RequestError for a non-string.
 */
function optionalString(value, field) {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (typeof value !== 'string')
        throw new project_service_1.RequestError(`${field} must be a string`, field);
    return value;
}
//# sourceMappingURL=project-view.js.map