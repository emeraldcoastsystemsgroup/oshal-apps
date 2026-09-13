"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — every SQL statement the package runs, in one
 *                     |                             | file, each carrying `owner_sub = $n` in addition to the owner
 *                     |                             | RLS the migration installs (belt and braces: RLS protects
 *                     |                             | against a missing predicate, the predicate protects against a
 *                     |                             | request that reached the pool without its GUC). Printer API
 *                     |                             | keys are stored only as owner-key ciphertext through the
 *                     |                             | personal-data vault and the list query never selects the
 *                     |                             | column at all — the plaintext exists in memory for the length
 *                     |                             | of one upload and nowhere else.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listJobs = listJobs;
exports.createJob = createJob;
exports.getJob = getJob;
exports.updateJob = updateJob;
exports.deleteJob = deleteJob;
exports.listImages = listImages;
exports.insertImage = insertImage;
exports.assignView = assignView;
exports.deleteImage = deleteImage;
exports.listPrinters = listPrinters;
exports.insertPrinter = insertPrinter;
exports.getPrinterWithKey = getPrinterWithKey;
exports.deletePrinter = deletePrinter;
exports.insertSubmission = insertSubmission;
exports.listSubmissions = listSubmissions;
const JOB_COLUMNS = 'job_id, owner_sub, title, source_kind, state, known_dimensions, settings, report, failure_reason, created_at, updated_at';
const IMAGE_COLUMNS = 'image_id, job_id, file_name, view, width, height, silhouette, created_at';
const PRINTER_COLUMNS = 'printer_id, label, kind, base_url, created_at';
const SUBMISSION_COLUMNS = 'submission_id, job_id, printer_id, file_name, file_kind, started, state, failure_reason, remote_response, created_at';
/** @description Jobs newest first, capped so a runaway owner cannot make the list unbounded. */
async function listJobs(pool, sub) {
    const { rows } = await pool.query(`SELECT ${JOB_COLUMNS} FROM scan_print_job WHERE owner_sub = $1 ORDER BY updated_at DESC LIMIT 200`, [sub]);
    return rows;
}
/** @description Insert a job. */
async function createJob(pool, sub, title, sourceKind) {
    const { rows } = await pool.query(`INSERT INTO scan_print_job (owner_sub, title, source_kind) VALUES ($1, $2, $3) RETURNING ${JOB_COLUMNS}`, [sub, title, sourceKind]);
    return rows[0];
}
/** @description One job, or null when it is not the caller's. */
async function getJob(pool, sub, jobId) {
    const { rows } = await pool.query(`SELECT ${JOB_COLUMNS} FROM scan_print_job WHERE owner_sub = $1 AND job_id = $2`, [sub, jobId]);
    return rows[0] ?? null;
}
/** @description Update the given fields; unspecified ones keep their value. */
async function updateJob(pool, sub, jobId, patch) {
    const { rows } = await pool.query(`UPDATE scan_print_job SET
       title = COALESCE($3, title), known_dimensions = COALESCE($4::jsonb, known_dimensions), settings = COALESCE($5::jsonb, settings),
       state = COALESCE($6, state), report = CASE WHEN $7::boolean THEN $8::jsonb ELSE report END,
       failure_reason = CASE WHEN $9::boolean THEN $10 ELSE failure_reason END, source_kind = COALESCE($11, source_kind), updated_at = now()
     WHERE owner_sub = $1 AND job_id = $2 RETURNING ${JOB_COLUMNS}`, [sub, jobId, patch.title ?? null, patch.known_dimensions === undefined ? null : JSON.stringify(patch.known_dimensions),
        patch.settings === undefined ? null : JSON.stringify(patch.settings), patch.state ?? null,
        patch.report !== undefined, patch.report === undefined || patch.report === null ? null : JSON.stringify(patch.report),
        patch.failure_reason !== undefined, patch.failure_reason ?? null, patch.source_kind ?? null]);
    return rows[0] ?? null;
}
/** @description Delete a job (images and submissions cascade). */
async function deleteJob(pool, sub, jobId) {
    const { rowCount } = await pool.query('DELETE FROM scan_print_job WHERE owner_sub = $1 AND job_id = $2', [sub, jobId]);
    return (rowCount ?? 0) > 0;
}
/** @description Images of a job, oldest first. */
async function listImages(pool, sub, jobId) {
    const { rows } = await pool.query(`SELECT ${IMAGE_COLUMNS} FROM scan_print_image WHERE owner_sub = $1 AND job_id = $2 ORDER BY created_at, image_id`, [sub, jobId]);
    return rows;
}
/** @description Insert an image record. */
async function insertImage(pool, sub, jobId, image) {
    const { rows } = await pool.query(`INSERT INTO scan_print_image (owner_sub, job_id, file_name, width, height, silhouette) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING ${IMAGE_COLUMNS}`, [sub, jobId, image.fileName, image.width, image.height, JSON.stringify(image.silhouette)]);
    return rows[0];
}
/** @description Assign a view to an image (clearing any other image holding it) or clear it with null. */
async function assignView(pool, sub, jobId, imageId, view) {
    if (view) {
        await pool.query('UPDATE scan_print_image SET view = NULL WHERE owner_sub = $1 AND job_id = $2 AND view = $3 AND image_id <> $4', [sub, jobId, view, imageId]);
    }
    const { rows } = await pool.query(`UPDATE scan_print_image SET view = $4 WHERE owner_sub = $1 AND job_id = $2 AND image_id = $3 RETURNING ${IMAGE_COLUMNS}`, [sub, jobId, imageId, view]);
    return rows[0] ?? null;
}
/** @description Delete an image record. */
async function deleteImage(pool, sub, jobId, imageId) {
    const { rowCount } = await pool.query('DELETE FROM scan_print_image WHERE owner_sub = $1 AND job_id = $2 AND image_id = $3', [sub, jobId, imageId]);
    return (rowCount ?? 0) > 0;
}
/** @description Printers without their keys. */
async function listPrinters(pool, sub) {
    const { rows } = await pool.query(`SELECT ${PRINTER_COLUMNS} FROM scan_print_printer WHERE owner_sub = $1 ORDER BY created_at`, [sub]);
    return rows;
}
/** @description Insert a printer; `apiKeyCiphertext` must already be vault-encrypted. */
async function insertPrinter(pool, sub, printer) {
    const { rows } = await pool.query(`INSERT INTO scan_print_printer (owner_sub, label, kind, base_url, api_key_ciphertext) VALUES ($1, $2, $3, $4, $5) RETURNING ${PRINTER_COLUMNS}`, [sub, printer.label, printer.kind, printer.baseUrl, printer.apiKeyCiphertext]);
    return rows[0];
}
/** @description One printer WITH its ciphertext — only the upload and status paths call this. */
async function getPrinterWithKey(pool, sub, printerId) {
    const { rows } = await pool.query(`SELECT ${PRINTER_COLUMNS}, api_key_ciphertext FROM scan_print_printer WHERE owner_sub = $1 AND printer_id = $2`, [sub, printerId]);
    return rows[0] ?? null;
}
/** @description Delete a printer (its submissions cascade). */
async function deletePrinter(pool, sub, printerId) {
    const { rowCount } = await pool.query('DELETE FROM scan_print_printer WHERE owner_sub = $1 AND printer_id = $2', [sub, printerId]);
    return (rowCount ?? 0) > 0;
}
/** @description Record a print submission attempt. */
async function insertSubmission(pool, sub, s) {
    const { rows } = await pool.query(`INSERT INTO scan_print_submission (owner_sub, job_id, printer_id, file_name, file_kind, started, state, failure_reason, remote_response)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) RETURNING ${SUBMISSION_COLUMNS}`, [sub, s.jobId, s.printerId, s.fileName, s.fileKind, s.started, s.state, s.failureReason, JSON.stringify(s.remote ?? null)]);
    return rows[0];
}
/** @description Submissions of a job, newest first. */
async function listSubmissions(pool, sub, jobId) {
    const { rows } = await pool.query(`SELECT ${SUBMISSION_COLUMNS} FROM scan_print_submission WHERE owner_sub = $1 AND job_id = $2 ORDER BY created_at DESC LIMIT 100`, [sub, jobId]);
    return rows;
}
//# sourceMappingURL=job-store.js.map