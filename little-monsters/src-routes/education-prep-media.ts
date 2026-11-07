/**
 * Study Lab and curriculum lesson media: the video, poster and captions of each lesson.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | Answer lesson videos by lasting-file reference. A package reply is buffered, capped at 8 MiB and has no byte ranges, and every package file is copied into every person's sandbox and every dependent's, so real lesson videos cannot live in the package. One copy of each video sits in the package's lasting directory, put there by scripts/lesson-studio/install-videos.py, and the kernel streams it with byte ranges.
 * 2   | maintainer@emeraldcoastsystemsgroup.com | Load optional curriculum-manifest.json for the 168-topic video curriculum and serve manifest-authorized curriculum posters and captions from lasting storage when absent from tools/prep-media.
 * -----------------------------------------------------------------------------
 *
 * @module education-prep-media
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RequestHandler, Response } from 'express';
import { createChildLogger } from '@/shared/logger';

const logger = createChildLogger({ module: 'education-prep-media' });

/** Only the files a lesson ships: a plain name, never a path. */
const MEDIA_NAME = /^[a-z0-9-]+\.(mp4|jpg|vtt)$/;

type LastingReply = Response & {
  lastingFile?: (relative: string, options?: { filename?: string; inline?: boolean }) => Response;
};

/**
 * @description Where a filmed lesson's video is kept, by the digest the manifest records for it, so a
 * package only ever serves the video it was delivered with.
 * @param id The lesson id.
 * @param sha256 The video's SHA-256 from the manifest.
 * @returns The path relative to the package's lasting directory.
 */
export function keptVideoPath(id: string, sha256: string): string {
  return `prep-media/${id}-${sha256.slice(0, 16)}.mp4`;
}

/** The videos this package was delivered with: lesson id to its kept path. */
function readKeptVideos(mediaRoot: string): Map<string, string> {
  const manifest = JSON.parse(fs.readFileSync(path.join(mediaRoot, 'manifest.json'), 'utf8')) as {
    lessons: Record<string, { sha256: string }>;
  };
  const entries = new Map<string, string>(
    Object.entries(manifest.lessons).map(([id, entry]) => [id, keptVideoPath(id, entry.sha256)]),
  );
  const curriculumPath = path.join(mediaRoot, 'curriculum-manifest.json');
  if (fs.existsSync(curriculumPath)) {
    const curriculum = JSON.parse(fs.readFileSync(curriculumPath, 'utf8')) as {
      lessons?: Record<string, { sha256: string }>;
    };
    for (const [id, entry] of Object.entries(curriculum.lessons || {})) {
      entries.set(id, keptVideoPath(id, entry.sha256));
    }
  }
  return entries;
}

function notFound(res: Response): void {
  res.status(404).type('text/plain; charset=utf-8').send('Not found');
}

/** Send a file directly: posters, captions, and videos on a host with no lasting-file reply. */
function sendDirect(res: Response, file: string, name: string): void {
  res.sendFile(file, (err?: Error) => {
    if (!err) return;
    if (res.headersSent || res.writableEnded) {
      logger.warn({ err, name }, 'Aborted while serving lesson media');
      return;
    }
    logger.error({ err, name }, 'Could not serve lesson media');
    notFound(res);
  });
}

/**
 * @description GET /prep-media/:file. A video goes out by reference to its kept copy; a poster or caption
 * file comes from the package or, for manifest-listed curriculum lessons, from lasting storage.
 * @param mediaRoot Absolute path of the package's tools/prep-media folder.
 * @param env Process environment; OSHAL_PACKAGE_DATA_DIR names the lasting directory.
 * @returns The Express handler.
 */
export function createPrepMediaHandler(mediaRoot: string, env: NodeJS.ProcessEnv = process.env): RequestHandler {
  let kept: Map<string, string> | null = null;
  return async (req, res) => {
    const name = String(req.params.file || '');
    if (!MEDIA_NAME.test(name)) return notFound(res);
    if (!name.endsWith('.mp4')) {
      const packaged = path.join(mediaRoot, name);
      if ((await fs.promises.stat(packaged).catch(() => null))?.isFile()) {
        return sendDirect(res, packaged, name);
      }
      kept = kept || readKeptVideos(mediaRoot);
      const baseId = path.basename(name, path.extname(name));
      const dataDir = env.OSHAL_PACKAGE_DATA_DIR;
      if (kept.has(baseId) && dataDir) {
        const fallback = path.join(dataDir, 'prep-media', name);
        if ((await fs.promises.stat(fallback).catch(() => null))?.isFile()) {
          return sendDirect(res, fallback, name);
        }
      }
      return notFound(res);
    }
    kept = kept || readKeptVideos(mediaRoot);
    const relative = kept.get(path.basename(name, '.mp4'));
    if (!relative) return notFound(res);
    const dataDir = env.OSHAL_PACKAGE_DATA_DIR;
    const file = dataDir ? path.join(dataDir, relative) : null;
    if (!file || !(await fs.promises.stat(file).catch(() => null))?.isFile()) {
      logger.error({ name, relative }, 'Lesson video is not installed; run scripts/lesson-studio/install-videos.py');
      return notFound(res);
    }
    res.setHeader('content-type', 'video/mp4');
    const reply = res as LastingReply;
    if (typeof reply.lastingFile === 'function') {
      reply.lastingFile(relative, { filename: name, inline: true });
      return;
    }
    sendDirect(res, file, name);
  };
}
