/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Serve a caller-scoped, bounded offline autofill bookmarklet from the canonical Career and Apply profiles.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Read profile JSON through one link-free bounded descriptor and describe the host-page event boundary without promising page-script behavior.
 */

/**
 * Caller-scoped offline application autofill route.
 * @module career-autofill-routes
 */
import { constants, promises as fs } from 'fs';
import type { Stats } from 'fs';
import type { FileHandle } from 'fs/promises';
import path from 'path';
import { type Request, type Response, type Router } from 'express';
import { createChildLogger } from '@/shared/logger';
import { callerSub, userPaths } from './career-user-store';

const autofill = require('../lib/autofill-bookmarklet') as {
  createAutofillBookmarklet: (profile: Record<string, string>) => string;
  normalizeAutofillProfile: (careerDb: unknown, applyProfile: unknown) => Record<string, string>;
};

const logger = createChildLogger({ module: 'career-autofill-routes' });
const PROFILE_MAX_BYTES = 4 * 1024 * 1024;
const BOOKMARKLET_MAX_BYTES = 64 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

/** Mark a PII-bearing response as browser- and proxy-noncacheable. */
function setPrivateNoStore(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

/** Reject a nonregular, linked, or oversized profile descriptor. */
function assertProfileStats(metadata: Stats): void {
  if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > PROFILE_MAX_BYTES) {
    throw new Error('invalid Career profile file');
  }
}

/** Compare the stable identity and content-shape facts used across the descriptor read. */
function sameProfileFile(
  left: Stats,
  right: Stats,
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.nlink === right.nlink
    && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

/** Read at most PROFILE_MAX_BYTES + 1 so concurrent growth cannot cause an unbounded allocation. */
async function readBoundedProfile(handle: FileHandle): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let position = 0;
  while (position <= PROFILE_MAX_BYTES) {
    const length = Math.min(READ_CHUNK_BYTES, PROFILE_MAX_BYTES + 1 - position);
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead === 0) break;
    chunks.push(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  if (position > PROFILE_MAX_BYTES) throw new Error('Career profile exceeds its size limit');
  return Buffer.concat(chunks, position);
}

/** Verify the path still names the exact open descriptor after the bounded read. */
async function assertPathStillBound(
  candidate: string,
  userRoot: string,
  descriptor: Stats,
): Promise<void> {
  const [entry, real] = await Promise.all([fs.lstat(candidate), fs.realpath(candidate)]);
  assertProfileStats(entry);
  if (!sameProfileFile(entry, descriptor) || path.dirname(real) !== userRoot) {
    throw new Error('Career profile path changed during read');
  }
}

/** Parse one already-open, identity-bound JSON profile. */
async function parseProfileHandle(
  handle: FileHandle,
  candidate: string,
  userRoot: string,
  entry: Stats,
): Promise<Record<string, unknown>> {
  const before = await handle.stat();
  assertProfileStats(before);
  if (!sameProfileFile(entry, before)) throw new Error('Career profile changed before open');
  const bytes = await readBoundedProfile(handle);
  const after = await handle.stat();
  if (!sameProfileFile(before, after) || bytes.length !== after.size) {
    throw new Error('Career profile changed during read');
  }
  await assertPathStillBound(candidate, userRoot, after);
  const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Career profile root must be an object');
  }
  return parsed as Record<string, unknown>;
}

/** Return a parsed optional JSON profile after direct-child and descriptor containment checks. */
async function readOptionalProfile(userDir: string, filename: string): Promise<Record<string, unknown>> {
  const candidate = path.resolve(userDir, filename);
  if (path.dirname(candidate) !== path.resolve(userDir) || path.basename(candidate) !== filename) {
    throw new Error('Career profile path is not a direct child');
  }
  let entry;
  try { entry = await fs.lstat(candidate); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  assertProfileStats(entry);
  const userRoot = await fs.realpath(userDir);
  if (path.dirname(await fs.realpath(candidate)) !== userRoot) {
    throw new Error('Career profile escapes its user store');
  }
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const handle = await fs.open(candidate, constants.O_RDONLY | noFollow);
  try { return await parseProfileHandle(handle, candidate, userRoot, entry); }
  finally { await handle.close(); }
}

/** Load both canonical sources without allowing either file to escape the caller's store. */
async function loadAutofillProfile(userSub: string): Promise<Record<string, string>> {
  const { userDir } = userPaths(userSub);
  const [careerDb, applyProfile] = await Promise.all([
    readOptionalProfile(userDir, 'career_db.json'),
    readOptionalProfile(userDir, 'apply_profile.json'),
  ]);
  return autofill.normalizeAutofillProfile(careerDb, applyProfile);
}

/** Generate the bookmarklet only in direct response to an authenticated user click. */
async function getAutofillBookmarklet(req: Request, res: Response): Promise<void> {
  setPrivateNoStore(res);
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  try {
    const profile = await loadAutofillProfile(userSub);
    if (!Object.keys(profile).length) {
      res.status(409).json({ error: 'Add contact fields to your Apply Profile first.' }); return;
    }
    const bookmarklet = autofill.createAutofillBookmarklet(profile);
    if (Buffer.byteLength(bookmarklet, 'utf8') > BOOKMARKLET_MAX_BYTES) {
      throw new Error('generated bookmarklet exceeds its output limit');
    }
    res.json({
      bookmarklet,
      populatedFields: Object.keys(profile),
      warning: 'This bookmark contains your application profile in its URL. Keep it private. It does not directly submit or call the network, but a supported page may react to normal field-change events.',
      offline: true,
      directSubmit: false,
      directNetwork: false,
      emitsFieldEvents: true,
      pageMayReact: true,
    });
  } catch (error) {
    logger.error({ err: error, userSub }, 'Career autofill bookmarklet generation failed');
    res.status(422).json({ error: 'Your Apply Profile could not be safely prepared for autofill.' });
  }
}

/**
 * @description Registers the authenticated per-user offline autofill bookmarklet endpoint.
 * @param router - Authenticated Career Hunter package router.
 * @returns Nothing.
 */
export function registerCareerAutofillRoutes(router: Router): void {
  router.get('/autofill/bookmarklet', (req, res) => { void getAutofillBookmarklet(req, res); });
}
