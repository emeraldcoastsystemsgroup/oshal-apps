/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — package-local surface serving (the
 *                     |                             | scan-to-print idiom): surfaces resolve from THIS package's
 *                     |                             | tools/ directory via ctx.appPackageDir (ADR-085 D10), with a
 *                     |                             | load-time env fallback for frameworks predating it and a
 *                     |                             | routes/-relative fallback for tests run straight off disk.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Request, RequestHandler, Response } from 'express';
import { createChildLogger } from '@/shared/logger';

const logger = createChildLogger({ module: 'embodied-surface-files' });

/** @description Load-time-only fallback for frameworks predating `ctx.appPackageDir`, read ONCE on purpose. */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

/**
 * @description Resolve one bundled surface file inside this package's `tools/` directory. Every
 * candidate is built from constants plus the package directory the framework handed us —
 * `fileName` is never request-derived.
 * @param appPackageDir - This package's directory, from the per-package AppContext.
 * @param fileName - Bare filename inside `tools/`.
 * @returns The first candidate that exists, or the last one so `sendFile` produces the 404.
 */
export function surfaceFile(appPackageDir: string | undefined, fileName: string): string {
  const candidates = [
    appPackageDir ? path.join(appPackageDir, 'tools', fileName) : '',
    LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools', fileName) : '',
    path.resolve(__dirname, '../tools', fileName),
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[candidates.length - 1];
}

/**
 * @description Serve a bundled surface file from an ABSOLUTE path fixed at mount time. Bytes are
 * read per request so an in-place edit during development is visible without a restart.
 * @param filePath - Absolute path resolved once by {@link surfaceFile}.
 * @param contentType - `html` or `application/javascript`.
 * @returns An Express handler that sends the file, or 404 when it is not on disk.
 */
export function serveSurfaceFile(filePath: string, contentType: 'html' | 'application/javascript'): RequestHandler {
  return (_req: Request, res: Response): void => {
    try {
      const source = fs.readFileSync(filePath, 'utf8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.type(contentType).send(source);
    } catch (error) {
      logger.error({ err: error, filePath }, 'Bundled surface file is not readable');
      res.status(404).json({ error: 'surface_file_not_found' });
    }
  };
}
