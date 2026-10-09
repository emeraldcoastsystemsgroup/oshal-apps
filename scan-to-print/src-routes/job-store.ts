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
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Bambu Lab LAN printers for the print service (operator-approved
 *                     |                             | 2026-10-06): the printer row carries the device serial and model
 *                     |                             | code read from the printer's certificate, the slice profile the
 *                     |                             | slicer engine needs, and the owner's per-printer AUTO_START
 *                     |                             | opt-in (migration 002, default off). updatePrinterSettings
 *                     |                             | changes only those owner choices; identity and the key are fixed
 *                     |                             | at registration. A submission may now come from the print
 *                     |                             | service with a posted file instead of a scan job: job_id is
 *                     |                             | optional, source_name names the file, requested_by says who.
 *                     |                             | The printer's certificate fingerprint is pinned at registration
 *                     |                             | (device_cert_sha256); getPrinterAutoStart re-reads the owner's
 *                     |                             | choice at the moment a service job would start.
 */

import type { AppContext } from '@/app/composition/app-context';

/** @description The pool surface package routes ride on — derived from the framework's own type. */
export type QueryablePool = AppContext['pool'];

/** @description A job row as the API returns it. */
export interface JobRow {
  job_id: string;
  owner_sub: string;
  title: string;
  source_kind: string;
  state: string;
  known_dimensions: Array<{ axis: 'x' | 'y' | 'z'; mm: number }>;
  settings: Record<string, unknown>;
  report: Record<string, unknown> | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** @description An image row. */
export interface ImageRow {
  image_id: string;
  job_id: string;
  file_name: string;
  view: string | null;
  width: number;
  height: number;
  silhouette: Record<string, unknown>;
  created_at: string;
}

/** @description A printer row WITHOUT its key. */
export interface PrinterRow {
  printer_id: string;
  label: string;
  kind: string;
  base_url: string;
  /** Certificate serial (bambu-lan only). */
  device_serial: string | null;
  /** Vendor model code from the device CA (bambu-lan only). */
  device_model: string | null;
  /** SHA-256 fingerprint of the printer's certificate, pinned at registration (bambu-lan only). */
  device_cert_sha256: string | null;
  /** Slicer settings for this printer (bambu-lan: modelId, nozzle, filament, plate). */
  slice_profile: Record<string, unknown>;
  /** The owner's opt-in: a job sent through the print service starts without a click. Default false. */
  auto_start: boolean;
  created_at: string;
}

/** @description A submission row. */
export interface SubmissionRow {
  submission_id: string;
  /** The scan job printed, or null for a file posted to the print service. */
  job_id: string | null;
  /** The posted file's name when there is no job. */
  source_name: string | null;
  /** `person` (the Print click) or `service` (an agent or app through the print service). */
  requested_by: string;
  printer_id: string;
  file_name: string;
  file_kind: string;
  started: boolean;
  state: string;
  failure_reason: string | null;
  remote_response: unknown;
  created_at: string;
}

const JOB_COLUMNS = 'job_id, owner_sub, title, source_kind, state, known_dimensions, settings, report, failure_reason, created_at, updated_at';
const IMAGE_COLUMNS = 'image_id, job_id, file_name, view, width, height, silhouette, created_at';
const PRINTER_COLUMNS = 'printer_id, label, kind, base_url, device_serial, device_model, device_cert_sha256, slice_profile, auto_start, created_at';
const SUBMISSION_COLUMNS = 'submission_id, job_id, source_name, requested_by, printer_id, file_name, file_kind, started, state, failure_reason, remote_response, created_at';

/** @description Jobs newest first, capped so a runaway owner cannot make the list unbounded. */
export async function listJobs(pool: QueryablePool, sub: string): Promise<JobRow[]> {
  const { rows } = await pool.query(`SELECT ${JOB_COLUMNS} FROM scan_print_job WHERE owner_sub = $1 ORDER BY updated_at DESC LIMIT 200`, [sub]);
  return rows as JobRow[];
}

/** @description Insert a job. */
export async function createJob(pool: QueryablePool, sub: string, title: string, sourceKind: string): Promise<JobRow> {
  const { rows } = await pool.query(
    `INSERT INTO scan_print_job (owner_sub, title, source_kind) VALUES ($1, $2, $3) RETURNING ${JOB_COLUMNS}`, [sub, title, sourceKind],
  );
  return rows[0] as JobRow;
}

/** @description One job, or null when it is not the caller's. */
export async function getJob(pool: QueryablePool, sub: string, jobId: string): Promise<JobRow | null> {
  const { rows } = await pool.query(`SELECT ${JOB_COLUMNS} FROM scan_print_job WHERE owner_sub = $1 AND job_id = $2`, [sub, jobId]);
  return (rows[0] as JobRow | undefined) ?? null;
}

/** @description Fields a PATCH or the pipeline may change. */
export interface JobPatch {
  title?: string;
  known_dimensions?: Array<{ axis: 'x' | 'y' | 'z'; mm: number }>;
  settings?: Record<string, unknown>;
  state?: string;
  report?: Record<string, unknown> | null;
  failure_reason?: string | null;
  source_kind?: string;
}

/** @description Update the given fields; unspecified ones keep their value. */
export async function updateJob(pool: QueryablePool, sub: string, jobId: string, patch: JobPatch): Promise<JobRow | null> {
  const { rows } = await pool.query(
    `UPDATE scan_print_job SET
       title = COALESCE($3, title), known_dimensions = COALESCE($4::jsonb, known_dimensions), settings = COALESCE($5::jsonb, settings),
       state = COALESCE($6, state), report = CASE WHEN $7::boolean THEN $8::jsonb ELSE report END,
       failure_reason = CASE WHEN $9::boolean THEN $10 ELSE failure_reason END, source_kind = COALESCE($11, source_kind), updated_at = now()
     WHERE owner_sub = $1 AND job_id = $2 RETURNING ${JOB_COLUMNS}`,
    [sub, jobId, patch.title ?? null, patch.known_dimensions === undefined ? null : JSON.stringify(patch.known_dimensions),
      patch.settings === undefined ? null : JSON.stringify(patch.settings), patch.state ?? null,
      patch.report !== undefined, patch.report === undefined || patch.report === null ? null : JSON.stringify(patch.report),
      patch.failure_reason !== undefined, patch.failure_reason ?? null, patch.source_kind ?? null],
  );
  return (rows[0] as JobRow | undefined) ?? null;
}

/** @description Delete a job (images and submissions cascade). */
export async function deleteJob(pool: QueryablePool, sub: string, jobId: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM scan_print_job WHERE owner_sub = $1 AND job_id = $2', [sub, jobId]);
  return (rowCount ?? 0) > 0;
}

/** @description Images of a job, oldest first. */
export async function listImages(pool: QueryablePool, sub: string, jobId: string): Promise<ImageRow[]> {
  const { rows } = await pool.query(`SELECT ${IMAGE_COLUMNS} FROM scan_print_image WHERE owner_sub = $1 AND job_id = $2 ORDER BY created_at, image_id`, [sub, jobId]);
  return rows as ImageRow[];
}

/** @description Insert an image record. */
export async function insertImage(
  pool: QueryablePool, sub: string, jobId: string, image: { fileName: string; width: number; height: number; silhouette: Record<string, unknown> },
): Promise<ImageRow> {
  const { rows } = await pool.query(
    `INSERT INTO scan_print_image (owner_sub, job_id, file_name, width, height, silhouette) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING ${IMAGE_COLUMNS}`,
    [sub, jobId, image.fileName, image.width, image.height, JSON.stringify(image.silhouette)],
  );
  return rows[0] as ImageRow;
}

/** @description Assign a view to an image (clearing any other image holding it) or clear it with null. */
export async function assignView(pool: QueryablePool, sub: string, jobId: string, imageId: string, view: string | null): Promise<ImageRow | null> {
  if (view) {
    await pool.query('UPDATE scan_print_image SET view = NULL WHERE owner_sub = $1 AND job_id = $2 AND view = $3 AND image_id <> $4', [sub, jobId, view, imageId]);
  }
  const { rows } = await pool.query(
    `UPDATE scan_print_image SET view = $4 WHERE owner_sub = $1 AND job_id = $2 AND image_id = $3 RETURNING ${IMAGE_COLUMNS}`, [sub, jobId, imageId, view],
  );
  return (rows[0] as ImageRow | undefined) ?? null;
}

/** @description Delete an image record. */
export async function deleteImage(pool: QueryablePool, sub: string, jobId: string, imageId: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM scan_print_image WHERE owner_sub = $1 AND job_id = $2 AND image_id = $3', [sub, jobId, imageId]);
  return (rowCount ?? 0) > 0;
}

/** @description Printers without their keys. */
export async function listPrinters(pool: QueryablePool, sub: string): Promise<PrinterRow[]> {
  const { rows } = await pool.query(`SELECT ${PRINTER_COLUMNS} FROM scan_print_printer WHERE owner_sub = $1 ORDER BY created_at`, [sub]);
  return rows as PrinterRow[];
}

/** @description What registration stores; `apiKeyCiphertext` must already be vault-encrypted. */
export interface NewPrinter {
  label: string;
  kind: string;
  baseUrl: string;
  apiKeyCiphertext: string;
  deviceSerial?: string | null;
  deviceModel?: string | null;
  deviceCertSha256?: string | null;
  sliceProfile?: Record<string, unknown>;
}

/**
 * @description Insert a printer. Auto-start is never set here: it is a separate, explicit owner choice.
 * @param pool - Pool.
 * @param sub - Owner.
 * @param printer - What registration validated, with the key already vault-encrypted.
 * @returns The stored row, without its key.
 */
export async function insertPrinter(pool: QueryablePool, sub: string, printer: NewPrinter): Promise<PrinterRow> {
  const { rows } = await pool.query(
    `INSERT INTO scan_print_printer (owner_sub, label, kind, base_url, api_key_ciphertext, device_serial, device_model, device_cert_sha256, slice_profile) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${PRINTER_COLUMNS}`,
    [sub, printer.label, printer.kind, printer.baseUrl, printer.apiKeyCiphertext, printer.deviceSerial ?? null, printer.deviceModel ?? null,
      printer.deviceCertSha256 ?? null, JSON.stringify(printer.sliceProfile ?? {})],
  );
  return rows[0] as PrinterRow;
}

/**
 * @description The owner's auto-start choice as it stands now (re-read just before a service job would start).
 * @param pool - Pool.
 * @param sub - Owner.
 * @param printerId - Printer.
 * @returns True only when the printer still exists and auto-start is on.
 */
export async function getPrinterAutoStart(pool: QueryablePool, sub: string, printerId: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT auto_start FROM scan_print_printer WHERE owner_sub = $1 AND printer_id = $2', [sub, printerId]);
  return (rows[0] as { auto_start?: boolean } | undefined)?.auto_start === true;
}

/**
 * @description Change the owner's choices on a printer. Null leaves a value as it is.
 * @param pool - Pool.
 * @param sub - Owner.
 * @param printerId - Printer.
 * @param change - New auto-start flag and/or slice profile.
 * @returns The updated row, or null when the printer is not the caller's.
 */
export async function updatePrinterSettings(
  pool: QueryablePool, sub: string, printerId: string, change: { autoStart: boolean | null; sliceProfile: Record<string, unknown> | null },
): Promise<PrinterRow | null> {
  const { rows } = await pool.query(
    `UPDATE scan_print_printer SET auto_start = COALESCE($3, auto_start), slice_profile = COALESCE($4::jsonb, slice_profile), updated_at = now() WHERE owner_sub = $1 AND printer_id = $2 RETURNING ${PRINTER_COLUMNS}`,
    [sub, printerId, change.autoStart, change.sliceProfile === null ? null : JSON.stringify(change.sliceProfile)],
  );
  return (rows[0] as PrinterRow | undefined) ?? null;
}

/** @description One printer WITH its ciphertext — only the upload and status paths call this. */
export async function getPrinterWithKey(pool: QueryablePool, sub: string, printerId: string): Promise<(PrinterRow & { api_key_ciphertext: string }) | null> {
  const { rows } = await pool.query(`SELECT ${PRINTER_COLUMNS}, api_key_ciphertext FROM scan_print_printer WHERE owner_sub = $1 AND printer_id = $2`, [sub, printerId]);
  return (rows[0] as (PrinterRow & { api_key_ciphertext: string }) | undefined) ?? null;
}

/** @description Delete a printer (its submissions cascade). */
export async function deletePrinter(pool: QueryablePool, sub: string, printerId: string): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM scan_print_printer WHERE owner_sub = $1 AND printer_id = $2', [sub, printerId]);
  return (rowCount ?? 0) > 0;
}

/** @description What one print attempt records. */
export interface NewSubmission {
  jobId: string | null;
  sourceName?: string | null;
  requestedBy?: 'person' | 'service';
  printerId: string;
  fileName: string;
  fileKind: string;
  started: boolean;
  state: string;
  failureReason: string | null;
  remote: unknown;
}

/**
 * @description Record a print submission attempt.
 * @param pool - Pool.
 * @param sub - Owner.
 * @param s - The attempt: job or source name, printer, file, outcome, requester.
 * @returns The stored row.
 */
export async function insertSubmission(pool: QueryablePool, sub: string, s: NewSubmission): Promise<SubmissionRow> {
  const { rows } = await pool.query(
    `INSERT INTO scan_print_submission (owner_sub, job_id, source_name, requested_by, printer_id, file_name, file_kind, started, state, failure_reason, remote_response)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${SUBMISSION_COLUMNS}`,
    [sub, s.jobId, s.sourceName ?? null, s.requestedBy ?? 'person', s.printerId, s.fileName, s.fileKind, s.started, s.state, s.failureReason, JSON.stringify(s.remote ?? null)],
  );
  return rows[0] as SubmissionRow;
}

/**
 * @description The caller's latest submissions across all printers, newest first.
 * @param pool - Pool.
 * @param sub - Owner.
 * @returns Up to 50 rows.
 */
export async function listRecentSubmissions(pool: QueryablePool, sub: string): Promise<SubmissionRow[]> {
  const { rows } = await pool.query(`SELECT ${SUBMISSION_COLUMNS} FROM scan_print_submission WHERE owner_sub = $1 ORDER BY created_at DESC LIMIT 50`, [sub]);
  return rows as SubmissionRow[];
}

/** @description Submissions of a job, newest first. */
export async function listSubmissions(pool: QueryablePool, sub: string, jobId: string): Promise<SubmissionRow[]> {
  const { rows } = await pool.query(`SELECT ${SUBMISSION_COLUMNS} FROM scan_print_submission WHERE owner_sub = $1 AND job_id = $2 ORDER BY created_at DESC LIMIT 100`, [sub, jobId]);
  return rows as SubmissionRow[];
}
