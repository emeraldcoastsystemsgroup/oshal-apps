/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add reusable byte snapshots, atomic writes, and complete rollback for route-to-engine transactions.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Add promise-based transaction primitives so bounded uploads and packet edits do not block the controller event loop.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Remove the synchronous compatibility surface after migrating the final Resume Studio caller.
 */
/**
 * Small filesystem transaction primitives for Career route hand-offs.
 *
 * A route may need to persist an upload or edited packet before the engine child can read it.
 * These helpers preserve the exact prior bytes and use same-directory atomic replacement, so a
 * rejected spawn or failed renderer can restore the caller's durable state without a torn file.
 *
 * @module career-file-transaction
 */
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/** @description Exact pre-transaction bytes and existence state for one filesystem path. */
export interface FileSnapshot {
  filePath: string;
  existed: boolean;
  bytes?: Buffer;
}

/** Capture one path without a time-of-check/time-of-use gap around file existence. */
async function snapshotFile(filePath: string): Promise<FileSnapshot> {
  try {
    return { filePath, existed: true, bytes: await fs.readFile(filePath) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { filePath, existed: false };
    throw error;
  }
}

/**
 * @description Capture exact prior bytes concurrently before an asynchronous route transaction.
 * @param filePaths paths whose state must be restorable
 * @returns snapshots in the same order as the input paths
 */
export function snapshotFilesAsync(filePaths: string[]): Promise<FileSnapshot[]> {
  return Promise.all(filePaths.map(snapshotFile));
}

/**
 * @description Atomically replace a file without blocking the controller event loop.
 * @param filePath destination path
 * @param value bytes or text to persist
 * @returns a promise that settles after replacement or temporary-file cleanup
 */
export async function writeFileAtomicAsync(filePath: string, value: Buffer | string): Promise<void> {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, value);
    await fs.rename(temporary, filePath);
  } catch (error) {
    try { await fs.rm(temporary, { force: true }); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'atomic write cleanup failed'); }
    throw error;
  }
}

/**
 * @description Restore asynchronous snapshots in reverse order and attempt every rollback step.
 * @param snapshots exact states captured before the transaction
 * @returns a promise that rejects after the full rollback if any path failed
 */
export async function restoreFilesAsync(snapshots: FileSnapshot[]): Promise<void> {
  let firstError: unknown;
  for (const snapshot of [...snapshots].reverse()) {
    try {
      if (snapshot.existed) await writeFileAtomicAsync(snapshot.filePath, snapshot.bytes as Buffer);
      else await fs.rm(snapshot.filePath, { force: true });
    } catch (error) {
      firstError ||= error;
    }
  }
  if (firstError) throw firstError;
}
