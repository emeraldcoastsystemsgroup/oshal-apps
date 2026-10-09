/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — where a project's revisions and artifacts live
 *                     |                             | (never inside the package dir): <root>/<sha(sub)>/<projectId>/
 *                     |                             | {revisions,artifacts/<revision>}. Every path segment is a UUID,
 *                     |                             | an integer or an allowlisted artifact name we validated, so no
 *                     |                             | caller string is ever joined into a path.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const DATA_DIR_ENV = 'SCENE_STUDIO_DATA_DIR';
const CONTAINER_WORKSPACE_ROOT = '/app/workspace-shared';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Artifacts a project revision can carry, and the type each is served with. */
export const ARTIFACT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  'preview.png': 'image/png',
  'preview.glb': 'model/gltf-binary',
  'preview.stl': 'model/stl',
  'export.zip': 'application/zip',
  'export.glb': 'model/gltf-binary',
  'export.fbx': 'application/octet-stream',
  'export.obj': 'text/plain; charset=utf-8',
  'export.stl': 'model/stl',
});

/** @description Resolve the data root: explicit env, the shared workspace, or a local fallback. */
export function resolveDataRoot(env: Record<string, string | undefined>, exists: (p: string) => boolean = fs.existsSync): string {
  const explicit = (env[DATA_DIR_ENV] ?? '').trim();
  if (explicit) return path.resolve(explicit);
  const shared = (env.SHARED_WORKSPACE_ROOT ?? '').trim();
  if (shared) return path.join(path.resolve(shared), 'scene-studio');
  if (exists(CONTAINER_WORKSPACE_ROOT)) return path.join(CONTAINER_WORKSPACE_ROOT, 'scene-studio');
  return path.join(path.resolve(process.cwd(), 'workspace-shared'), 'scene-studio');
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
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 10_000_000) throw new RangeError('Expected a revision number');
  return n;
}

/** @description The directory holding everything of one project. */
export function projectDir(root: string, sub: string, projectId: string): string {
  return path.join(root, subHash(sub), requireUuid(projectId));
}

/** @description The directory of a project's revision blobs. */
export function revisionsDir(root: string, sub: string, projectId: string): string {
  return path.join(projectDir(root, sub, projectId), 'revisions');
}

/** @description The directory of one revision's artifacts. */
export function artifactsDir(root: string, sub: string, projectId: string, revision: number): string {
  return path.join(projectDir(root, sub, projectId), 'artifacts', String(requireRevision(revision)));
}

/** @description True for an artifact name this package serves. */
export function isArtifactName(name: unknown): name is string {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ARTIFACT_TYPES, name);
}

/** @description mkdir -p with owner-only permissions. */
export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
