/**
 * Spaces (ADR-111) — the streaming size gate of the model import lane.
 *
 * @module import-upload-gate
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | A multer storage engine that streams an upload into the scan dir while counting bytes and refuses a .ply the moment it crosses the kernel-configured gate (resolvePlyImportLimits — OSHAL_SPACES_PLY_MAX_BYTES; no number lives here): the partial file is unlinked once its handle closes, the rest of the part is drained, and the route answers 413 naming the limit. multer's own limits.fileSize is one number for every file and the extension is only known when the part header arrives, which is why the gate is an engine and not a limit. Why: a 117 MB .ply reached the kernel converter on the api's event loop and collapsed the Docker VM (2026-09-14). Guarded by tests/ply-import-off-loop.core.test.js.
 */

import type { Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import type { StorageEngine } from 'multer';
import { createChildLogger } from '@/shared/logger';
import { formatByteLimit } from '@/features/spatial-mapping';

const logger = createChildLogger({ module: 'spaces-import-upload-gate' });

/**
 * @description Raised by the engine when a part crosses the gate for its extension. Carries what
 * the 413 body needs: the extension, the limit, and how many bytes had arrived when it was refused
 * (which is how a test proves the refusal happened while streaming, not after the whole file).
 */
export class ImportTooLargeError extends Error {
  constructor(readonly ext: string, readonly limitBytes: number, readonly receivedBytes: number) {
    super(`a ${ext} import may be at most ${formatByteLimit(limitBytes)} (${limitBytes} bytes)`);
    this.name = 'ImportTooLargeError';
  }
}

/** How the engine places a file and which gate applies to it. */
export interface GatedDiskStorageOptions {
  /** Directory the file streams into; async so the caller can create it. */
  destination(req: Request, file: Express.Multer.File): Promise<string>;
  /** Filename inside the destination. */
  filename(file: Express.Multer.File): string;
  /** Byte gate for this file, or undefined when only multer's general limit applies. */
  limitFor(file: Express.Multer.File): number | undefined;
}

/**
 * @description The JSON body of the 413: the limit named as a label, as bytes, and in a sentence a
 * human can act on, plus the byte count at refusal.
 * @param err - The refusal
 * @returns The response body
 */
export function importTooLargeBody(err: ImportTooLargeError): Record<string, unknown> {
  return {
    error: 'model_too_large',
    format: err.ext,
    maxBytes: err.limitBytes,
    maxLabel: formatByteLimit(err.limitBytes),
    receivedBytes: err.receivedBytes,
    message: `${err.message}; reduce the capture or export a .splat`,
  };
}

/** Stream one part to disk under its gate; settle multer's callback exactly once. */
function streamWithGate(
  req: Request,
  file: Express.Multer.File,
  opts: GatedDiskStorageOptions,
  cb: (error?: unknown, info?: Partial<Express.Multer.File>) => void,
): void {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const limit = opts.limitFor(file);
  let settled = false;
  const settle = (err: unknown, info?: Partial<Express.Multer.File>): void => {
    if (settled) return;
    settled = true;
    cb(err, info);
  };
  opts.destination(req, file).then((dir) => {
    const finalPath = path.join(dir, opts.filename(file));
    const out = fs.createWriteStream(finalPath);
    let received = 0;
    const refuse = (): void => {
      file.stream.unpipe(out);
      out.once('close', () => {
        fs.promises.unlink(finalPath).catch((e) => logger.warn({ e, finalPath }, 'partial import unlink failed'));
      });
      out.destroy();
      file.stream.resume();
      logger.warn({ ext, limitBytes: limit, receivedBytes: received }, 'model import refused while streaming: over the gate');
      settle(new ImportTooLargeError(ext, limit as number, received));
    };
    file.stream.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (limit !== undefined && received > limit && !settled) refuse();
    });
    out.on('error', (err) => {
      logger.error({ err, finalPath }, 'import write failed');
      settle(err);
    });
    out.on('finish', () => settle(null, { destination: dir, filename: path.basename(finalPath), path: finalPath, size: out.bytesWritten }));
    file.stream.pipe(out);
  }).catch((err) => {
    logger.error({ err }, 'import destination could not be prepared');
    settle(err);
  });
}

/**
 * @description A disk storage engine with a per-file byte gate. Everything multer's diskStorage
 * does (stream to `destination/filename`, report `path` and `size`) plus: when `limitFor` names a
 * gate for the file, the write stops at the first chunk past it and multer receives an
 * ImportTooLargeError — the remainder of the part is never written or parsed.
 * @param opts - Placement and gate callbacks
 * @returns The multer storage engine
 */
export function createGatedDiskStorage(opts: GatedDiskStorageOptions): StorageEngine {
  return {
    _handleFile(req, file, cb) {
      streamWithGate(req, file, opts, cb);
    },
    _removeFile(_req, file, cb) {
      fs.unlink(file.path, (err) => cb(err ?? null));
    },
  };
}
