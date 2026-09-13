/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — where a model's exported artifacts live
 *                     |                             | (never inside the package dir): <root>/<sha(sub)>/<modelId>/
 *                     |                             | <revision>/… . Every path segment is a UUID or an integer we
 *                     |                             | validated, so no caller string is ever joined into a path.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const DATA_DIR_ENV = 'CAD_STUDIO_DATA_DIR';
const CONTAINER_WORKSPACE_ROOT = '/app/workspace-shared';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** @description Resolve the artifact root: explicit env, the shared workspace, or a local fallback. */
export function resolveDataRoot(env: Record<string, string | undefined>, exists: (p: string) => boolean = fs.existsSync): string {
  const explicit = (env[DATA_DIR_ENV] ?? '').trim();
  if (explicit) return path.resolve(explicit);
  const shared = (env.SHARED_WORKSPACE_ROOT ?? '').trim();
  if (shared) return path.join(path.resolve(shared), 'cad-studio');
  if (exists(CONTAINER_WORKSPACE_ROOT)) return path.join(CONTAINER_WORKSPACE_ROOT, 'cad-studio');
  return path.join(path.resolve(process.cwd(), 'workspace-shared'), 'cad-studio');
}

/** @description A short stable hash of the owner sub for the directory name (the sub itself is not a path). */
export function subHash(sub: string): string {
  return createHash('sha256').update(sub).digest('hex').slice(0, 16);
}

/** @description Accept only a UUID (lower-cased). @throws RangeError otherwise. */
export function requireUuid(value: unknown): string {
  const text = String(value ?? '').toLowerCase();
  if (!UUID.test(text)) throw new RangeError('Expected a UUID');
  return text;
}

/** @description Accept only a non-negative integer revision. @throws RangeError otherwise. */
export function requireRevision(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new RangeError('Expected a revision number');
  return n;
}

/** @description The directory of one model's revision artifacts. */
export function revisionDir(root: string, sub: string, modelId: string, revision: number): string {
  return path.join(root, subHash(sub), requireUuid(modelId), String(requireRevision(revision)));
}

/** @description The directory holding every revision of one model. */
export function modelDir(root: string, sub: string, modelId: string): string {
  return path.join(root, subHash(sub), requireUuid(modelId));
}

/** @description mkdir -p. */
export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** The artifact keys a revision can carry and their file names. */
export const ARTIFACT_FILES = Object.freeze({
  step: 'model.step', stl: 'model.stl', 'svg-front': 'front.svg', 'svg-top': 'top.svg', 'svg-right': 'right.svg', 'svg-iso': 'iso.svg', report: 'report.json',
});
export type ArtifactKey = keyof typeof ARTIFACT_FILES;
export const ARTIFACT_TYPES: Readonly<Record<ArtifactKey, string>> = Object.freeze({
  step: 'application/step', stl: 'model/stl', 'svg-front': 'image/svg+xml', 'svg-top': 'image/svg+xml', 'svg-right': 'image/svg+xml', 'svg-iso': 'image/svg+xml', report: 'application/json',
});

/** @description Is this string an artifact key? */
export function isArtifactKey(value: unknown): value is ArtifactKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ARTIFACT_FILES, value);
}

/** @description Path of one artifact inside a revision directory. */
export function artifactPath(dir: string, key: ArtifactKey): string {
  return path.join(dir, ARTIFACT_FILES[key]);
}
