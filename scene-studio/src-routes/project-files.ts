/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — a project's files as the engine sees them
 *                     |                             | (the FILE MAP: [{path, data: base64}]) and as the api stores
 *                     |                             | them (one gzip blob per revision, under a name no other writer
 *                     |                             | can collide with). Paths are validated by the same rules as
 *                     |                             | engine/scene_ops.py validate_path — a spec runs both.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Disclose and enforce finite native project limits below the kernel frame and atomic storage ceilings.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomBytes } from 'node:crypto';

/** One file as it travels to and from the engine. */
export interface WireFile { path: string; data: string }

const NATIVE = process.env.OSHAL_SCENE_NATIVE_RUNTIME === '1';
export const FILE_LIMITS = Object.freeze({
  maxFiles: 4000,
  maxFileBytes: (NATIVE ? 8 : 48) * 1024 * 1024,
  maxTotalBytes: (NATIVE ? 8 : 64) * 1024 * 1024,
  maxPathChars: 240,
  maxDepth: 12,
  /** A text write rides the api's global JSON body limit (100 kB by default). */
  maxTextWriteBytes: 90 * 1024,
  maxUploadBytes: (NATIVE ? 8 : 32) * 1024 * 1024,
  ...(NATIVE ? {maxStoredBytes:32*1024*1024, maxStoredFiles:4096, maxEngineRequestMs:45_000} : {}),
  maxTextReadBytes: 2 * 1024 * 1024,
  /** Revisions kept per project; older ones (and their artifacts) are pruned. */
  keepRevisions: 40,
  /** Files listed in a project reply; the rest are counted. */
  listedFiles: 500,
});

const SEGMENT = /^[A-Za-z0-9 _.@()+,=~[\]-]{1,120}$/;
/** Godot's derived import state: stored, never listed. */
const DERIVED_PREFIX = '.godot/';

/** @description A refused file operation (bad path, size limit, missing file). */
export class FileError extends Error {
  constructor(message: string, readonly field = 'path', readonly status = 400) { super(message); this.name = 'FileError'; }
}

/**
 * @description Accept a project-relative POSIX path, or refuse it. A leading res:// is dropped.
 * @param raw - Caller-supplied path.
 * @returns The normalised path.
 * @throws FileError
 */
export function validatePath(raw: unknown): string {
  if (typeof raw !== 'string') throw new FileError('a file path must be a string');
  const p = raw.startsWith('res://') ? raw.slice(6) : raw;
  if (!p || p.length > FILE_LIMITS.maxPathChars) throw new FileError(`file path must be 1-${FILE_LIMITS.maxPathChars} characters`);
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0')) throw new FileError(`file path ${JSON.stringify(raw)} must be relative, with forward slashes`);
  const segments = p.split('/');
  if (segments.length > FILE_LIMITS.maxDepth) throw new FileError(`file path ${JSON.stringify(raw)} is nested too deep`);
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..' || !SEGMENT.test(segment)) {
      throw new FileError(`file path ${JSON.stringify(raw)} has an unsafe segment ${JSON.stringify(segment)}`);
    }
  }
  return p;
}

/** @description Decoded size of one wire file. */
export function wireBytes(file: WireFile): number {
  return Buffer.byteLength(file.data, 'base64');
}

/** @description File count and total bytes of a file map. */
export function summarize(files: WireFile[]): { fileCount: number; totalBytes: number } {
  return { fileCount: files.length, totalBytes: files.reduce((sum, f) => sum + wireBytes(f), 0) };
}

/**
 * @description Check a file map against the limits and validate every path (an engine reply is
 * checked exactly like a caller's input). @throws FileError
 */
export function assertWithinLimits(files: WireFile[]): void {
  if (!Array.isArray(files)) throw new FileError('files must be a list', 'files');
  if (files.length > FILE_LIMITS.maxFiles) throw new FileError(`a project holds at most ${FILE_LIMITS.maxFiles} files`, 'files');
  const seen = new Set<string>();
  let total = 0;
  for (const file of files) {
    const p = validatePath(file?.path);
    if (seen.has(p)) throw new FileError(`duplicate file path ${p}`);
    seen.add(p);
    if (typeof file.data !== 'string') throw new FileError(`file ${p} has no data`);
    const bytes = wireBytes(file);
    if (bytes > FILE_LIMITS.maxFileBytes) throw new FileError(`file ${p} is over ${FILE_LIMITS.maxFileBytes / 1048576} MB`, 'path', 413);
    total += bytes;
    if (total > FILE_LIMITS.maxTotalBytes) throw new FileError(`project is over ${FILE_LIMITS.maxTotalBytes / 1048576} MB`, 'files', 413);
  }
}

/** @description A copy of the map with `filePath` set to `data` (added or replaced), sorted. */
export function withFile(files: WireFile[], filePath: string, data: Buffer): WireFile[] {
  const p = validatePath(filePath);
  const next = files.filter((f) => f.path !== p).concat({ path: p, data: data.toString('base64') });
  next.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  assertWithinLimits(next);
  return next;
}

/** @description A copy of the map without `filePath`. @throws FileError when it is not there. */
export function withoutFile(files: WireFile[], filePath: string): WireFile[] {
  const p = validatePath(filePath);
  if (!files.some((f) => f.path === p)) throw new FileError(`${p} is not in this project`, 'path', 404);
  return files.filter((f) => f.path !== p);
}

/** @description One file's bytes, or null. */
export function fileData(files: WireFile[], filePath: string): Buffer | null {
  const p = validatePath(filePath);
  const file = files.find((f) => f.path === p);
  return file ? Buffer.from(file.data, 'base64') : null;
}

/** @description True when the bytes read as UTF-8 text (no NUL, round-trips). */
export function isText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  return Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);
}

/** @description The listing a project reply carries: derived Godot state hidden, the rest capped. */
export function listing(files: WireFile[]): { files: Array<{ path: string; bytes: number }>; hidden: number; more: number } {
  const visible = files.filter((f) => !f.path.startsWith(DERIVED_PREFIX));
  const shown = visible.slice(0, FILE_LIMITS.listedFiles).map((f) => ({ path: f.path, bytes: wireBytes(f) }));
  return { files: shown, hidden: files.length - visible.length, more: Math.max(0, visible.length - shown.length) };
}

/**
 * @description Store one revision's file map: gzip(JSON) under a name unique to this write, so two
 * writers racing for the same revision number never overwrite each other's bytes.
 * @returns The blob's file name (recorded on the revision row).
 */
export function writeRevisionBlob(dir: string, revision: number, files: WireFile[]): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = `${revision}-${randomBytes(6).toString('hex')}.json.gz`;
  const tmp = path.join(dir, `.${name}.tmp`);
  fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(JSON.stringify({ files }), 'utf8')), { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, name));
  return name;
}

/** @description Read a revision blob back. @throws FileError when it is missing or unreadable. */
export function readRevisionBlob(dir: string, blob: string): WireFile[] {
  if (!/^\d+-[0-9a-f]{12}\.json\.gz$/.test(blob)) throw new FileError('revision blob name is invalid', 'revision', 500);
  try {
    const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, blob))).toString('utf8')) as { files?: WireFile[] };
    return Array.isArray(parsed.files) ? parsed.files : [];
  } catch (error) {
    throw new FileError(`revision files are unreadable (${(error as Error).message})`, 'revision', 500);
  }
}

/** @description Delete revision blobs by name (pruning); a missing one is fine. */
export function removeRevisionBlobs(dir: string, blobs: string[]): void {
  for (const blob of blobs) {
    if (/^\d+-[0-9a-f]{12}\.json\.gz$/.test(blob)) fs.rmSync(path.join(dir, blob), { force: true });
  }
}
