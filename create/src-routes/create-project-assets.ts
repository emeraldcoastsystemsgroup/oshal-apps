/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Normalize private immutable raster uploads outside the installed package and serve only exact-owner verified bytes.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, lstat, writeFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { ProjectError, PROJECT_LIMITS, PROJECT_ASSET_PREFIX, type ProjectAsset, type ProjectOwner, type ConfirmProjectAccess } from './create-project-types';
import { projectId } from './create-project-validation';
import type { CreateProjectStore } from './create-project-store';

/** Match the established package-private shared-workspace convention; never store under package source. */
export function projectAssetRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CREATE_PROJECT_DATA_DIR?.trim()) return resolve(env.CREATE_PROJECT_DATA_DIR);
  const shared = env.CLINE_WORKSPACE_ROOT || env.SHARED_WORKSPACE_ROOT
    || (existsSync('/app/workspace-shared') ? '/app/workspace-shared' : resolve(process.cwd(), 'workspace-shared'));
  return join(resolve(shared), 'create-projects');
}

function ownerDirectory(root: string, owner: ProjectOwner): string {
  return join(root, createHash('sha256').update(JSON.stringify([owner.issuer, owner.sub])).digest('hex'));
}
function imagePath(root: string, owner: ProjectOwner, id: string): string { return join(ownerDirectory(root, owner), `${projectId(id)}.png`); }

/** Inspect real decoder metadata, reject animated/oversized/non-raster input and strip metadata through PNG normalization. */
export async function normalizeProjectImage(bytes: Buffer): Promise<{ bytes: Buffer; width: number; height: number }> {
  if (!bytes.length || bytes.length > PROJECT_LIMITS.imageBytes) throw new ProjectError(413, 'project_image_too_large');
  try {
    const options = { limitInputPixels: PROJECT_LIMITS.pixels, failOn: 'error' as const };
    const metadata = await sharp(bytes, options).metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1
      || !metadata.width || !metadata.height || metadata.width > PROJECT_LIMITS.dimension || metadata.height > PROJECT_LIMITS.dimension) {
      throw new ProjectError(400, 'invalid_project_image');
    }
    const normalized = await sharp(bytes, options).rotate().png().toBuffer({ resolveWithObject: true });
    if (normalized.data.length > PROJECT_LIMITS.imageBytes) throw new ProjectError(413, 'project_image_too_large');
    return { bytes: normalized.data, width: normalized.info.width, height: normalized.info.height };
  } catch (error) {
    if (error instanceof ProjectError) throw error;
    throw new ProjectError(400, 'invalid_project_image');
  }
}

/** Create bytes once, then admit their metadata atomically; failed admissions remove only this newly created file. */
export async function saveProjectImage(root: string, store: CreateProjectStore, owner: ProjectOwner, bytes: Buffer, confirm: ConfirmProjectAccess): Promise<ProjectAsset> {
  const image = await normalizeProjectImage(bytes);
  await confirm();
  const id = randomUUID(), file = imagePath(root, owner, id), directory = ownerDirectory(root, owner);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw new ProjectError(503, 'project_asset_storage_unavailable');
  await writeFile(file, image.bytes, { flag: 'wx', mode: 0o600 });
  const value = { id, src: PROJECT_ASSET_PREFIX + id, width: image.width, height: image.height,
    bytes: image.bytes.length, sha256: createHash('sha256').update(image.bytes).digest('hex') };
  try { await store.addAsset(owner, value, confirm); return value; }
  catch (error) { await unlink(file); throw error; }
}

/** The database owner check precedes filesystem reads; changed or linked bytes are never served as the immutable asset. */
export async function readProjectImage(root: string, store: CreateProjectStore, owner: ProjectOwner, id: string): Promise<Buffer> {
  const value = await store.getAsset(owner, id), file = imagePath(root, owner, id);
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== value.bytes) throw new Error('asset_integrity');
    const bytes = await readFile(file);
    if (createHash('sha256').update(bytes).digest('hex') !== value.sha256) throw new Error('asset_integrity');
    return bytes;
  } catch { throw new ProjectError(503, 'project_asset_storage_unavailable'); }
}

/** Retry missing-file cleanup safely; only a server-selected stale unused UUID is accepted. */
export async function removeProjectImage(root: string, owner: ProjectOwner, id: string): Promise<void> {
  try { await unlink(imagePath(root, owner, id)); }
  catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
}
