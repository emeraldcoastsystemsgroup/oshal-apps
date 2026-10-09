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

import { EngineFailure } from './engine-client';
import { FileError } from './project-files';
import { ConflictError, NotFoundError, RequestError, previewView } from './project-service';
import type { ProjectRow } from './project-store';

/** @description A classified failure: the HTTP status and the JSON body the routes answer with. */
export interface ClassifiedFailure {
  status: number;
  body: Record<string, unknown>;
}

/**
 * @description The project as the API returns it (preview URLs resolved, totals as numbers).
 * @param p - The stored project row.
 * @returns The public project object.
 */
export function publicProject(p: ProjectRow): Record<string, unknown> {
  return {
    projectId: p.project_id, title: p.title, kind: p.kind, template: p.template, revision: p.revision,
    fileCount: p.file_count, totalBytes: Number(p.total_bytes),
    preview: p.preview ? previewView(p.project_id, p.preview) : null,
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
export function classifyFailure(error: unknown): ClassifiedFailure | null {
  if (error instanceof EngineFailure) {
    const status = error.code === 'refused' ? 400 : error.code === 'engine_timeout' ? 504 : error.code === 'engine_error' ? 502 : 503;
    return { status, body: { error: error.code, message: error.message, reason: error.reason ?? error.message } };
  }
  if (error instanceof FileError) return { status: error.status, body: { error: 'invalid_file', field: error.field, message: error.message } };
  if (error instanceof RequestError) return { status: 400, body: { error: 'invalid_request', field: error.field, message: error.message } };
  if (error instanceof NotFoundError) return { status: 404, body: { error: error.message } };
  if (error instanceof ConflictError) return { status: 409, body: { error: 'conflict', message: error.message } };
  if (error instanceof RangeError) return { status: 400, body: { error: 'invalid_id', message: error.message } };
  return null;
}

/**
 * @description A project title: whitespace folded, at most 120 characters, or the fallback.
 * @param value - The caller's title.
 * @param fallback - Used when the title is empty.
 * @returns The title to store.
 */
export function projectTitle(value: unknown, fallback: string): string {
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
export function intOption(value: unknown, field: string, lo: number, hi: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new RequestError(`${field} must be an integer from ${lo} to ${hi}`, field);
  return n;
}

/**
 * @description An optional string (absent, null and '' mean "not given").
 * @param value - The caller's value.
 * @param field - Its name, for the refusal.
 * @returns The string, or undefined when absent. @throws RequestError for a non-string.
 */
export function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new RequestError(`${field} must be a string`, field);
  return value;
}
