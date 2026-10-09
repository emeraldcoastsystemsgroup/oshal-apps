/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The editor's shared HTTP guards, moved out of video-editor-routes.ts so the export routes (CREATE-EDIT-05c) use exactly the same admission: personal scope only, named-permission admission before any body or storage, a re-check before commit, stable error codes with every failure logged, one entry/exit log line per request, and single-range file delivery.
 */
import { json, type Request, type RequestHandler, type Response } from 'express';
import { createReadStream } from 'node:fs';
import { createChildLogger } from '@/shared/logger';
import { EditorError, EDITOR_LIMITS, type EditorContext, type EditorOwner } from './video-editor-types';
import type { VideoEditorStore } from './video-editor-store';
import { requireEditorAccess, type EditorAction } from './video-authorization';
import type { TimelineValidator } from './video-editor-validation';
import type { MediaProber } from './video-editor-media';
import type { ExportRunner } from './video-edit-export-jobs';
import type { VideoExportStore } from './video-editor-export-store';

const logger = createChildLogger({ module: 'video-editor-routes' });

/** @description Everything an editor route needs. */
export interface RouteEnvironment { ctx: EditorContext; store: VideoEditorStore; validator: Promise<TimelineValidator>; dataRoot: string;
  prober: MediaProber; exports: ExportRunner; exportStore: VideoExportStore }
type EditorWork = (req: Request, res: Response, owner: EditorOwner) => Promise<void>;
/** @description JSON bodies bounded to the 256 KiB document plus its envelope. */
export const bodyParser = json({ limit: EDITOR_LIMITS.documentBytes + 4096, strict: true });

/** Personal projects never accept a caller-selected shared tenant or owner scope. */
function personalOnly(req: Request): void {
  if (Object.keys(req.query).some(key => /tenant|owner|issuer|subject|workspace/i.test(key))
    || req.header('x-oshal-tenant-id') || req.header('x-tenant-id')) throw new EditorError(400, 'video_edit_personal_scope_only');
}

/**
 * @description Answer a stable code; log every server failure with the error itself, and every refusal by code.
 * @param res - Response. @param error - What was thrown. @returns void
 */
export function sendError(res: Response, error: unknown): void {
  const typed = error instanceof EditorError ? error : null;
  if (!typed || typed.status >= 500) logger.error({ err: error }, 'video editor request failed');
  else logger.info({ code: typed.code, status: typed.status }, 'video editor request refused');
  if (res.headersSent) { res.destroy(); return; }
  res.status(typed?.status ?? 503).json({ error: typed?.code ?? 'video_edit_service_unavailable' });
}

/**
 * @description Authorize before reading any body or touching storage.
 * @param env - Route environment. @param action - Required editor action. @returns Middleware.
 */
export function admit(env: RouteEnvironment, action: EditorAction): RequestHandler {
  return (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    Promise.resolve().then(() => {
      if (typeof env.ctx.pool?.connect !== 'function') throw new EditorError(503, 'video_edit_store_unavailable');
      personalOnly(req);
    }).then(() => requireEditorAccess(env.ctx, action)).then(() => next()).catch(error => sendError(res, error));
  };
}

/**
 * @description Run route work as the re-verified owner; any throw becomes a stable error response.
 * @param env - Environment. @param action - Action. @param work - Handler body. @returns Handler.
 */
export function handler(env: RouteEnvironment, action: EditorAction, work: EditorWork): RequestHandler {
  return (req, res) => { requireEditorAccess(env.ctx, action).then(owner => work(req, res, owner)).catch(error => sendError(res, error)); };
}

/**
 * @description The re-check a write runs before commit (and a job runs while it works).
 * @param env - Environment. @param action - Action. @param owner - The owner the work began as. @returns The check.
 */
export function confirm(env: RouteEnvironment, action: EditorAction, owner: EditorOwner): () => Promise<void> {
  return async () => { await requireEditorAccess(env.ctx, action, owner); };
}

/** @description One entry/exit line per editor request: method, matched route, status and duration; never bodies or identities. */
export const requestLog: RequestHandler = (req, res, next) => {
  const started = Date.now();
  res.on('finish', () => logger.info({ method: req.method, route: `${req.baseUrl}${req.route?.path ?? ''}`, status: res.statusCode,
    durationMs: Date.now() - started }, 'video editor request'));
  next();
};

/**
 * @description Serve one verified owned file, honoring a single byte range so the browser can seek.
 * @param req - Request. @param res - Response. @param file - Path. @param meta - Size and content type. @returns void
 */
export function sendFile(req: Request, res: Response, file: string, meta: { bytes: number; type: string }): void {
  const size = meta.bytes, range = req.header('range');
  let start = 0, end = size - 1;
  res.set({ 'Content-Type': meta.type, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' });
  if (range !== undefined) {
    const match = /^bytes=(\d{0,15})-(\d{0,15})$/.exec(range);
    if (match && (match[1] || match[2])) {
      if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
      else { start = Math.max(0, size - Number(match[2])); }
    }
    if (!match || (!match[1] && !match[2]) || start > end || start >= size) { res.status(416).set('Content-Range', `bytes */${size}`).end(); return; }
    res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  res.set('Content-Length', String(end - start + 1));
  const stream = createReadStream(file, { start, end });
  stream.on('error', error => sendError(res, error));
  stream.pipe(res);
}
