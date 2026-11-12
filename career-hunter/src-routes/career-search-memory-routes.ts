/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.56.0, T6 (Roger: Career search remembers criteria on the account, across devices). Find jobs kept the last search and the named searches only in one browser, so another browser or device started empty. The account now holds them: a small file in the person's own Career folder, beside the search scope, changed one operation at a time under the same rules the browser applies (tools/career-search-memory.js). Guard: tests/career-search-memory-routes.test.mjs.
 */

/**
 * Find jobs' remembered searches, kept on the account.
 * @module career-search-memory-routes
 */
import fs from 'fs';
import path from 'path';
import type { Request, Response, Router } from 'express';
import { createChildLogger } from '@/shared/logger';
import { callerSub, findUserPaths, userPaths } from './career-user-store';
import { writeFileAtomicAsync } from './career-file-transaction';

// The browser's own rules, so the account and every browser clean and bound a search the same way.
const searchMemory = require('../tools/career-search-memory');

const logger = createChildLogger({ module: 'career-search-memory-routes' });
export const SEARCH_MEMORY_FILE = 'job-search-memory.json';
/** Twenty named searches of every criterion at its longest stay well under this. */
const MAX_BYTES = 256 * 1024;
const OPERATIONS = new Set(['remember', 'save', 'remove', 'clearLast', 'adopt']);

/** The person's file as the browser module's storage: reads the file, holds a write until it is saved. */
function fileStorage(userDir: string | null) {
  const file = userDir ? path.join(userDir, SEARCH_MEMORY_FILE) : null;
  let pending: string | null = null;
  return {
    file,
    getItem(): string | null {
      if (pending !== null) return pending;
      if (!file) return null;
      try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) return null;
        return fs.readFileSync(file, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    setItem(_key: string, value: string): void {
      if (value.length > MAX_BYTES) throw new Error('too large');
      pending = value;
    },
    pending: () => pending,
  };
}

/** What a caller sees: the last search, the named ones, and whether the account holds a copy at all. */
function answer(memory: any, stored: boolean) {
  const state = memory.state();
  return { last: state.last, saved: state.saved, stored };
}

/** Hand the account a browser's searches from before 1.56.0, oldest named search first so the order is kept. */
function adopt(memory: any, state: unknown): void {
  const given = searchMemory.clean(state);
  for (const row of [...given.saved].reverse()) memory.save(row.name, row.criteria);
  if (given.last) memory.remember(given.last);
}

/** Apply one operation to the account's copy; adopt applies only while the account holds none. */
function apply(memory: any, body: any, stored: boolean): boolean {
  if (body.op === 'adopt') { if (stored) return false; adopt(memory, body.state); return true; }
  if (body.op === 'remember') memory.remember(body.criteria);
  else if (body.op === 'save') memory.save(body.name, body.criteria);
  else if (body.op === 'remove') memory.remove(String(body.id || ''));
  else memory.clearLast();
  return true;
}

async function getMemory(req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req), started = Date.now();
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  try {
    const storage = fileStorage(findUserPaths(userSub)?.userDir || null);
    const memory = searchMemory.create(storage, 'account');
    const stored = storage.getItem() !== null;
    logger.info({ userSub, stored, ms: Date.now() - started }, 'career search memory read');
    res.json(answer(memory, stored));
  } catch (err) {
    logger.error({ err, userSub }, 'career search memory read failed');
    res.status(500).json({ error: 'read failed' });
  }
}

async function postMemory(req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req), started = Date.now(), body = req.body || {};
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (!OPERATIONS.has(body.op)) { res.status(400).json({ error: 'unknown_operation', message: 'Unknown search memory operation.' }); return; }
  try {
    const { userDir } = userPaths(userSub);
    const storage = fileStorage(userDir);
    const memory = searchMemory.create(storage, 'account');
    const stored = storage.getItem() !== null;
    let changed: boolean;
    try { changed = apply(memory, body, stored); }
    catch (error) { res.status(400).json({ error: 'refused', message: (error as Error).message }); return; }
    const value = storage.pending();
    if (changed && value !== null) {
      await fs.promises.mkdir(userDir, { recursive: true, mode: 0o700 });
      await writeFileAtomicAsync(storage.file as string, value);
      await fs.promises.chmod(storage.file as string, 0o600);
    }
    logger.info({ userSub, op: body.op, changed, ms: Date.now() - started }, 'career search memory changed');
    res.json(answer(memory, stored || (changed && value !== null)));
  } catch (err) {
    logger.error({ err, userSub, op: body.op }, 'career search memory change failed');
    res.status(500).json({ error: 'write failed' });
  }
}

/**
 * @description Registers Find jobs' remembered searches on the account: GET answers the copy the account holds,
 * POST applies one operation (remember, save, remove, clearLast, or adopt a browser's searches when it holds none).
 * @param router - Authenticated Career Hunter router.
 * @returns Nothing.
 */
export function registerCareerSearchMemoryRoutes(router: Router): void {
  router.get('/search-memory', getMemory);
  router.post('/search-memory', postMemory);
}
