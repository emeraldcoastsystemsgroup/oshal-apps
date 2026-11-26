/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 2.20.14: owner-scoped Meeting Recap persistence (OSHAL_PACKAGE_DATA_DIR workspace + read-only GET SQL helpers).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export const STATIC_ARTIFACTS = new Map([
  ['timeline.md', { rel: 'timeline.md', mime: 'text/markdown; charset=utf-8' }],
  ['summary.md', { rel: 'summary.md', mime: 'text/markdown; charset=utf-8' }],
  ['review.pptx', { rel: 'review.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }],
]);
const KEYFRAME_RE = /^keyframe-([1-9][0-9]{0,3})\.png$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validate a recap job ID (UUID v4). */
export function isValidJobId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

/** Resolve writable root exclusively under OSHAL_PACKAGE_DATA_DIR (tmpdir only in tests). */
export function resolveDataRoot() {
  const envDir = process.env.OSHAL_PACKAGE_DATA_DIR;
  if (envDir && envDir.trim()) return path.resolve(envDir.trim());
  return path.join(os.tmpdir(), 'oshal-presentations-recap');
}

/** Deterministic owner hash directory so raw subjects never become path segments. */
export function ownerDirectoryHash(ownerSub) {
  return createHash('sha256').update(String(ownerSub || '')).digest('hex').slice(0, 32);
}

/** Compute an owner's job directory without creating it (read-only safe). */
export function jobDirectoryPath(ownerSub, jobId) {
  if (!isValidJobId(jobId)) throw new Error('Invalid recap job identity');
  return path.join(resolveDataRoot(), 'recaps', ownerDirectoryHash(ownerSub), jobId);
}

/** Ensure owner job subdirectories exist on disk (write paths only). */
export function ensureJobWorkspace(ownerSub, jobId) {
  const dir = jobDirectoryPath(ownerSub, jobId);
  mkdirSync(path.join(dir, 'keyframes'), { recursive: true });
  mkdirSync(path.join(dir, 'tmp'), { recursive: true });
  return dir;
}

/** Resolve an allowlisted shareable artifact path inside the owner's job workspace. */
export function resolveArtifactFile(ownerSub, jobId, artifactName) {
  const name = String(artifactName || '').trim();
  const baseDir = path.resolve(jobDirectoryPath(ownerSub, jobId));
  let target = null;
  let mime = 'application/octet-stream';
  if (STATIC_ARTIFACTS.has(name)) {
    const entry = STATIC_ARTIFACTS.get(name);
    target = path.resolve(baseDir, entry.rel);
    mime = entry.mime;
  } else if (KEYFRAME_RE.test(name)) {
    target = path.resolve(baseDir, 'keyframes', name);
    mime = 'image/png';
  }
  if (!target) return null;
  const rel = path.relative(baseDir, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return { filePath: target, mime, name };
}

/** Append raw binary media chunk straight to disk (supports multi-GB uploads without RAM buffering). */
export async function appendMediaChunk(ownerSub, jobId, ext, chunkBuf) {
  const dir = ensureJobWorkspace(ownerSub, jobId);
  const mediaPath = path.join(dir, `source${ext}`);
  await appendFile(mediaPath, chunkBuf);
  const stats = statSync(mediaPath);
  return { mediaPath, totalBytes: stats.size };
}

/** Persist optional caller-provided local transcript in the owner job directory. */
export async function saveTranscriptText(ownerSub, jobId, text, format = 'auto') {
  const dir = ensureJobWorkspace(ownerSub, jobId);
  const payload = JSON.stringify({ format: String(format || 'auto'), text: String(text || '') });
  await writeFile(path.join(dir, 'transcript-input.json'), payload, 'utf8');
}

/** Read optional caller-provided local transcript if present (read-only). */
export async function loadTranscriptText(ownerSub, jobId) {
  const file = path.join(jobDirectoryPath(ownerSub, jobId), 'transcript-input.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Remove an owner's job directory from disk cleanly. */
export function removeJobWorkspace(ownerSub, jobId) {
  const dir = jobDirectoryPath(ownerSub, jobId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

/** Parse meta_json safely whether PostgreSQL JSONB object or SQLite text. */
export function parseMetaJson(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch { return {}; }
}

/** Map a DB row into the public API response shape. */
export function serializeRecapRow(row, includeDetails = false) {
  const meta = parseMetaJson(row.meta_json);
  const base = {
    id: row.id,
    title: row.title,
    sourceFilename: row.source_filename,
    sourceBytes: Number(row.source_bytes || 0),
    durationSeconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
    status: row.status,
    stageMessage: row.stage_message || '',
    minutesProcessed: Number(row.minutes_processed || 0),
    totalMinutes: Number(row.total_minutes || 0),
    keyframesCount: Number(row.keyframes_count || 0),
    cropMode: row.crop_mode || 'right-strip',
    sampleIntervalSec: Number(row.sample_interval_sec || 15),
    theme: row.theme || 'executive',
    savedDeckPath: row.saved_deck_path || null,
    savedDeckOpenUrl: row.saved_deck_open_url || null,
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (!includeDetails) return base;
  return {
    ...base,
    keyframes: Array.isArray(meta.keyframes) ? meta.keyframes : [],
    notes: meta.notes || null,
    artifacts: Array.isArray(meta.artifacts) ? meta.artifacts : [],
    transcriptSource: meta.transcriptSource || null,
  };
}

/** Read-only query: list all recaps owned by ownerSub (newest first, zero writes). */
export async function listOwnerRecaps(pool, ownerSub) {
  const res = await pool.query(
    `SELECT id, owner_sub, title, source_filename, source_bytes, duration_seconds, status,
            stage_message, minutes_processed, total_minutes, keyframes_count, crop_mode,
            sample_interval_sec, theme, saved_deck_path, saved_deck_open_url,
            error_code, error_message, meta_json, created_at, updated_at
       FROM oshal_presentation_recaps
      WHERE owner_sub = $1
      ORDER BY created_at DESC
      LIMIT 50`,
    [ownerSub],
  );
  return (res.rows || []).map((r) => serializeRecapRow(r, false));
}

/** Read-only query: fetch a single recap strictly owned by ownerSub (zero writes). */
export async function getOwnerRecap(pool, ownerSub, jobId) {
  if (!isValidJobId(jobId)) return null;
  const res = await pool.query(
    `SELECT id, owner_sub, title, source_filename, source_sha256, source_bytes, duration_seconds, status,
            stage_message, minutes_processed, total_minutes, keyframes_count, crop_mode,
            sample_interval_sec, theme, saved_deck_path, saved_deck_open_url,
            error_code, error_message, meta_json, created_at, updated_at
       FROM oshal_presentation_recaps
      WHERE owner_sub = $1 AND id = $2
      LIMIT 1`,
    [ownerSub, jobId],
  );
  return res.rows?.[0] || null;
}

/** Insert a new owner-scoped recap job row. */
export async function insertRecapRow(pool, job) {
  await pool.query(
    `INSERT INTO oshal_presentation_recaps
       (id, owner_sub, title, source_filename, source_sha256, source_bytes, status, stage_message,
        crop_mode, sample_interval_sec, theme, meta_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      job.id, job.ownerSub, job.title, job.sourceFilename, job.sourceSha256 || null,
      Number(job.sourceBytes || 0), job.status || 'queued', job.stageMessage || 'Queued for processing',
      job.cropMode || 'right-strip', Number(job.sampleIntervalSec || 15), job.theme || 'executive',
      JSON.stringify(job.meta || {}),
    ],
  );
}

/** Update progress / status / metadata fields on an owner-scoped recap row. */
export async function updateRecapRow(pool, ownerSub, jobId, patch) {
  const fields = [];
  const values = [ownerSub, jobId];
  const map = {
    sourceSha256: 'source_sha256', sourceBytes: 'source_bytes', durationSeconds: 'duration_seconds',
    status: 'status', stageMessage: 'stage_message', minutesProcessed: 'minutes_processed',
    totalMinutes: 'total_minutes', keyframesCount: 'keyframes_count', cropMode: 'crop_mode',
    sampleIntervalSec: 'sample_interval_sec', theme: 'theme', savedDeckPath: 'saved_deck_path',
    savedDeckOpenUrl: 'saved_deck_open_url', errorCode: 'error_code', errorMessage: 'error_message',
  };
  for (const [key, col] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      values.push(patch[key]);
      fields.push(`${col} = $${values.length}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'meta')) {
    values.push(JSON.stringify(patch.meta || {}));
    fields.push(`meta_json = $${values.length}`);
  }
  if (!fields.length) return;
  fields.push('updated_at = NOW()');
  await pool.query(
    `UPDATE oshal_presentation_recaps SET ${fields.join(', ')} WHERE owner_sub = $1 AND id = $2`,
    values,
  );
}

/** Delete an owner-scoped recap row from DB and return whether a row was removed. */
export async function deleteOwnerRecap(pool, ownerSub, jobId) {
  if (!isValidJobId(jobId)) return false;
  const res = await pool.query(
    'DELETE FROM oshal_presentation_recaps WHERE owner_sub = $1 AND id = $2',
    [ownerSub, jobId],
  );
  return (res.rowCount ?? 0) > 0;
}
