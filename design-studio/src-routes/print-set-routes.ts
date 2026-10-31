/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | ADR-203 D7, lane @ds-fab: the print-set routes under a product.
 *                     |                             | GET /print-set lists the set (the finished manifest with its
 *                     |                             | sha256, or the set in progress), POST /print-set begins one from
 *                     |                             | the design's rows, PUT /print-set/parts/{partId} keeps one
 *                     |                             | exported STL (multipart `stl` + `meta`: the CAD Studio source
 *                     |                             | and the kernel's report) or records why the part is unprintable
 *                     |                             | (JSON {reason}), POST /print-set/finish writes the sheet, the
 *                     |                             | BOM and the manifest, POST /print-set/sent keeps a printer
 *                     |                             | hand-off as the print service answered it, and
 *                     |                             | GET /print-set/{file} serves one file of the finished set - the
 *                     |                             | name is looked up in the manifest this package wrote, so a
 *                     |                             | request never names a path on disk. Every route is owner
 *                     |                             | scoped through the project load. This package reaches no engine:
 *                     |                             | the page exports each part through CAD Studio with the person's
 *                     |                             | own session (the native kernel gives a package route no sibling
 *                     |                             | package and no engine of another package) and posts the bytes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { ModelError } from './phase-model';
import { CAPS, SET_FILES, partId, validatePartMeta, validateReason, validateSent, validateSetInput } from './print-set-model';
import { addPart, beginSet, finishSet, listing, markUnprintable, readManifest, recordSent, servedFiles, setDir } from './print-set-store';
import type { ProjectRow } from './project-store';

const logger = createChildLogger({ module: 'design-studio-print-set' });
type Pool = AppContext['pool'];
/** @description What the print-set routes need from the mount: the owner-scoped project load and the data root. */
export interface PrintSetDeps { pool: Pool; dataRoot: string; withProject: (pool: Pool, req: Request, res: Response) => Promise<{ sub: string; project: ProjectRow } | null> }
type Upload = Request & { file?: Express.Multer.File };
const TYPES: Readonly<Record<string, string>> = Object.freeze({ '.stl': 'model/stl', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8' });

/** Answer a ModelError with its status; anything else is this package's 500. */
function refuse(res: Response, error: unknown, what: string): void {
  if (error instanceof ModelError) { res.status(error.status).json({ error: error.code, field: error.field, message: error.message }); return; }
  logger.error({ err: error }, `${what} failed`);
  res.status(500).json({ error: `${what.replace(/\s+/g, '_')}_failed` });
}

/** The listing of a product's set, 404 when nothing was begun. */
function registerListing(router: Router, deps: PrintSetDeps): void {
  router.get('/projects/:id/print-set', async (req, res) => {
    const c = await deps.withProject(deps.pool, req, res); if (!c) return;
    try {
      const out = listing(setDir(deps.dataRoot, c.sub, c.project.id));
      res.setHeader('Cache-Control', 'no-store');
      if (!out) { res.status(404).json({ error: 'no_print_set', message: 'no print set has been made for this product yet' }); return; }
      res.json(out);
    } catch (error) { refuse(res, error, 'list print set'); }
  });
}

/** Begin a set from the design's rows: the directory is wiped. */
function registerBegin(router: Router, deps: PrintSetDeps): void {
  router.post('/projects/:id/print-set', async (req, res) => {
    const c = await deps.withProject(deps.pool, req, res); if (!c) return;
    try {
      const input = validateSetInput(req.body);
      const dir = setDir(deps.dataRoot, c.sub, c.project.id);
      beginSet(dir, { id: c.project.id, name: c.project.name }, input);
      logger.info({ sub: c.sub, projectId: c.project.id, parts: input.parts.length, engine: input.engine }, 'Print set begun');
      res.status(201).json(listing(dir));
    } catch (error) { refuse(res, error, 'begin print set'); }
  });
}

/** The multipart or JSON form of one part's arrival. */
function partBody(req: Upload): { stl: Buffer | null; meta: unknown; reason: unknown } {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (req.file) {
    let meta: unknown = body.meta;
    if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { throw new ModelError('meta must be JSON', 'bad_print_set', 'meta'); } }
    return { stl: req.file.buffer, meta, reason: null };
  }
  return { stl: null, meta: null, reason: body.reason };
}

/** One part: an exported STL with its source and report, or the reason it is unprintable. */
function registerPart(router: Router, deps: PrintSetDeps): void {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CAPS.stlBytes, files: 1, fields: 4 } });
  const uploadErrors: RequestHandler[] = [upload.single('stl'), ((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof multer.MulterError) { res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'stl_too_large' : 'upload_rejected', message: error.code === 'LIMIT_FILE_SIZE' ? `one STL is at most ${CAPS.stlBytes} bytes in a set` : error.message, maxBytes: CAPS.stlBytes }); return; }
    next(error);
  }) as unknown as RequestHandler];
  router.put('/projects/:id/print-set/parts/:partId', ...uploadErrors, async (req: Upload, res) => {
    const c = await deps.withProject(deps.pool, req, res); if (!c) return;
    try {
      const id = partId(req.params.partId, 'partId');
      const dir = setDir(deps.dataRoot, c.sub, c.project.id);
      const { stl, meta, reason } = partBody(req);
      const part = stl ? (() => { const m = validatePartMeta(meta); return addPart(dir, id, stl, m.source, m.report); })() : markUnprintable(dir, id, validateReason(reason));
      logger.info({ sub: c.sub, projectId: c.project.id, partId: id, status: part.status }, 'Print set part recorded');
      res.json({ partId: id, part });
    } catch (error) { refuse(res, error, 'record print set part'); }
  });
}

/** Finish the set, and keep a printer hand-off beside it. */
function registerFinishAndSent(router: Router, deps: PrintSetDeps): void {
  router.post('/projects/:id/print-set/finish', async (req, res) => {
    const c = await deps.withProject(deps.pool, req, res); if (!c) return;
    try {
      const dir = setDir(deps.dataRoot, c.sub, c.project.id);
      const { manifestSha256 } = finishSet(dir);
      logger.info({ sub: c.sub, projectId: c.project.id, manifestSha256 }, 'Print set finished');
      res.json(listing(dir));
    } catch (error) { refuse(res, error, 'finish print set'); }
  });
  router.post('/projects/:id/print-set/sent', async (req, res) => {
    const c = await deps.withProject(deps.pool, req, res); if (!c) return;
    try {
      const dir = setDir(deps.dataRoot, c.sub, c.project.id);
      const done = readManifest(dir);
      if (!done) throw new ModelError('no finished print set to send from', 'no_print_set', 'print-set', 409);
      const sent = recordSent(dir, validateSent(req.body, servedFiles(done.manifest)));
      res.status(201).json({ sent });
    } catch (error) { refuse(res, error, 'record print set hand-off'); }
  });
}

/** One file of the finished set, by a name the manifest lists; the page downloads an STL as <product>-<part>.stl. */
function registerFile(router: Router, deps: PrintSetDeps): void {
  router.get('/projects/:id/print-set/:file', async (req, res) => {
    const c = await deps.withProject(deps.pool, req, res); if (!c) return;
    try {
      const dir = setDir(deps.dataRoot, c.sub, c.project.id);
      const done = readManifest(dir);
      const name = String(req.params.file);
      if (!done || !servedFiles(done.manifest).has(name)) { res.status(404).json({ error: 'file_not_in_print_set', file: name }); return; }
      const file = path.join(dir, name);
      if (!fs.existsSync(file)) { res.status(404).json({ error: 'file_not_in_print_set', file: name }); return; }
      res.setHeader('Cache-Control', 'private, no-store');
      res.type(TYPES[path.extname(name)] || 'application/octet-stream');
      const slug = c.project.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'product';
      if (name.endsWith('.stl') || req.query.download !== undefined) res.setHeader('Content-Disposition', `attachment; filename="${name.endsWith('.stl') ? `${slug}-${name}` : name}"`);
      const lasting = (res as unknown as { lastingFile?: (relative: string) => void }).lastingFile;
      const relative = path.relative(process.env.OSHAL_PACKAGE_DATA_DIR || '', file);
      if (typeof lasting === 'function' && process.env.OSHAL_PACKAGE_DATA_DIR && !relative.startsWith('..') && !path.isAbsolute(relative)) { lasting.call(res, relative.split(path.sep).join('/')); return; }
      res.sendFile(file);
    } catch (error) { refuse(res, error, 'read print set file'); }
  });
}

/**
 * @description Mount the print-set routes on the package router.
 * @param router - The /api/design-studio router.
 * @param deps - The pool, the data root and the owner-scoped project load.
 */
export function registerPrintSet(router: Router, deps: PrintSetDeps): void {
  logger.info({ dataRoot: deps.dataRoot, files: SET_FILES }, 'Print-set routes mounted');
  registerListing(router, deps);
  registerBegin(router, deps);
  registerPart(router, deps);
  registerFinishAndSent(router, deps);
  registerFile(router, deps);
}
