/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Validate editor request envelopes before any database or filesystem work: server-issued UUIDs, exact optimistic revisions, exact field sets, and timeline documents checked by the SAME shipped module the browser editor uses (tools/editor/timeline-validation.mjs), loaded once per installed revision.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EditorError, EDITOR_LIMITS, type EditorProjectInput, type TimelineDocument } from './video-editor-types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type TimelineValidator = (value: unknown) => TimelineDocument;

/**
 * @description Import the installed shared timeline validator once; the revision query pins the exact bytes loaded.
 * @param packageDir - Installed package root. @returns The validator.
 */
export function loadTimelineValidator(packageDir: string): Promise<TimelineValidator> {
  const file = resolve(packageDir, 'tools/editor/timeline-validation.mjs');
  const url = pathToFileURL(file); url.searchParams.set('revision', createHash('sha256').update(readFileSync(file)).digest('hex'));
  return import(url.href).then((module: { validateTimeline: TimelineValidator }) => module.validateTimeline);
}

/** @description A server-issued UUID, lower-cased. @param value - Candidate. @returns The UUID. */
export function editorId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new EditorError(400, 'invalid_video_edit_id');
  return value.toLowerCase();
}

/** @description The exact revision the caller last saw; never coerced from text or fractions. @param value - Candidate. @returns Revision. */
export function baseRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > EDITOR_LIMITS.revisionNumber) throw new EditorError(400, 'invalid_base_revision');
  return Number(value);
}

/** @description Parse a revision path segment of digits only. @param value - Path text. @returns Revision. */
export function revisionParam(value: unknown): number {
  return baseRevision(typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : NaN);
}

/** @description Plain JSON objects only (including prototype-less). @param value - Candidate. @returns True for a record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

/** @description Refuse any field outside the allowed set, so identity or tenant fields cannot ride along. @returns void */
export function exactFields(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new EditorError(400, 'invalid_video_edit_fields');
}

/**
 * @description Validate a create or save envelope: exact fields, a bounded title equal to the document name, and a
 * document the shared validator accepts within the 256 KiB bound.
 * @param value - Parsed body. @param validate - Shared validator. @param save - Whether baseRevision is required.
 * @returns Title and normalized document.
 */
export function projectInput(value: unknown, validate: TimelineValidator, save = false): EditorProjectInput {
  exactFields(value, save ? ['baseRevision', 'title', 'document'] : ['title', 'document']);
  if (save) baseRevision(value.baseRevision);
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > EDITOR_LIMITS.title) throw new EditorError(400, 'invalid_video_edit_title');
  let document: TimelineDocument;
  try { document = validate(value.document); } catch { throw new EditorError(400, 'invalid_video_edit_document'); }
  if (Buffer.byteLength(JSON.stringify(document)) > EDITOR_LIMITS.documentBytes) throw new EditorError(413, 'video_edit_document_too_large');
  if (document.name !== value.title) throw new EditorError(400, 'video_edit_title_mismatch');
  return { title: value.title, document };
}

/** @description The declared kind of an upload, from its query. @param value - Query value. @returns 'video' or 'audio'. */
export function mediaKind(value: unknown): 'video' | 'audio' {
  if (value !== 'video' && value !== 'audio') throw new EditorError(400, 'invalid_video_edit_media_kind');
  return value;
}
