/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the package's single mounted factory. Serves
 *                     |                             | the bundled surface and its scripts from this package's tools/
 *                     |                             | (ctx.appPackageDir), publishes `/capabilities` (the rig and
 *                     |                             | behaviour contracts, the controller protocol, the templates,
 *                     |                             | the servo catalog summary and the `prop` kind vocabulary),
 *                     |                             | `/catalog/servos` and `/templates`, and composes the rig
 *                     |                             | router under the `/api/animatronics` mount. The manifest's
 *                     |                             | `auth: oidc` wraps the whole mount; every handler still
 *                     |                             | re-derives the caller.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { describeRigContract } from './engine/rig-contract';
import { describeBehaviourContract } from './engine/scenario';
import { describeProtocol } from './engine/protocol';
import { loadServoCatalog, servoMap } from './engine/catalog';
import { buildTemplates } from './engine/templates';
import { PROP_CONFIRM_EXEMPT, PROP_KIND, PROP_VOCABULARY, PROP_VOCABULARY_OWNER } from './engine/kind';
import { createRigRoutes } from './rig-routes';

const logger = createChildLogger({ module: 'animatronics-routes' });
const SURFACE_SCRIPTS = ['animatronics.js', 'animatronics-view.js', 'animatronics-serial.js'] as const;
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

/** @description Resolve the authenticated caller's sub (oidc session, or the mounter's service-rail sub). */
export function callerSub(req: Request): string | null {
  const r = req as unknown as { oidc?: { user?: { sub?: string; oid?: string } }; oshalCallerSub?: string };
  return r.oidc?.user?.sub || r.oidc?.user?.oid || r.oshalCallerSub || null;
}

function packageFile(appPackageDir: string | undefined, ...rel: string[]): string {
  const candidates = [appPackageDir ? path.join(appPackageDir, ...rel) : '', LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, ...rel) : '', path.resolve(__dirname, '..', ...rel)].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || candidates[candidates.length - 1];
}

function serveFile(filePath: string, contentType: 'html' | 'application/javascript'): RequestHandler {
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

/**
 * @description The compiled protocol module (routes/engine/protocol.js — no imports, CommonJS) wrapped for
 * the browser as `window.AnimatronicsProtocol`, so the page encodes E-STOP and parses replies with the
 * very same code the server used to write the frames. One source, two runtimes, no copy.
 */
const serveProtocolModule: RequestHandler = (_req: Request, res: Response): void => {
  try {
    const source = fs.readFileSync(path.join(__dirname, 'engine', 'protocol.js'), 'utf8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.type('application/javascript').send(`(function () {\nvar exports = {}; var module = { exports: exports };\n${source}\nwindow.AnimatronicsProtocol = module.exports;\n})();\n`);
  } catch (error) {
    logger.error({ err: error }, 'Compiled protocol module is not readable');
    res.status(404).json({ error: 'surface_file_not_found' });
  }
};

/**
 * @description Build the `/api/animatronics` router.
 * @param ctx - The per-package AppContext (ADR-085 D10) — `pool` and `appPackageDir` are read.
 * @returns The composed router.
 */
export function createAnimatronicsRoutes(ctx: AppContext): Router {
  const appPackageDir = ctx.appPackageDir;
  const router = Router();
  const surface = packageFile(appPackageDir, 'tools', 'animatronics.html');
  logger.info({ surface, appPackageDir }, 'Resolved the animatronics surface');
  router.get('/app', serveFile(surface, 'html'));
  const assets = Router();
  for (const file of SURFACE_SCRIPTS) assets.get(`/${file}`, serveFile(packageFile(appPackageDir, 'tools', file), 'application/javascript'));
  assets.get('/protocol.js', serveProtocolModule);
  router.use('/assets', assets);

  const catalog = loadServoCatalog(packageFile(appPackageDir, 'catalog', 'servos.json'));
  const rows = servoMap(catalog.servos);
  const templates = buildTemplates(rows);
  logger.info({ servos: catalog.servos.length, controllers: catalog.controllers.length, templates: templates.length }, 'Loaded the servo catalog and the rig templates');

  router.get('/capabilities', (_req: Request, res: Response) => {
    res.json({
      app: 'animatronics',
      contract: describeRigContract(),
      behaviour: describeBehaviourContract(),
      protocol: describeProtocol(),
      kind: { kind: PROP_KIND, owner: PROP_VOCABULARY_OWNER, ...PROP_VOCABULARY, confirmExempt: [...PROP_CONFIRM_EXEMPT] },
      catalog: { servos: catalog.servos.length, controllers: catalog.controllers.length, path: '/api/animatronics/catalog/servos' },
      templates: templates.map((t) => ({ id: t.id, title: t.title, description: t.description, channels: t.rig.channels.length, poses: Object.keys(t.poses), scenarios: Object.keys(t.scenarios) })),
      rail: 'draft → rehearse → arm (confirm) → play / look-at / jog → disarm (e-stop)',
    });
  });
  router.get('/catalog/servos', (req: Request, res: Response) => {
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    if (kind && kind !== 'hobby' && kind !== 'bus') { res.status(400).json({ error: 'invalid_input', field: 'kind', message: 'kind must be hobby or bus' }); return; }
    res.json({ servos: kind ? catalog.servos.filter((s) => s.kind === kind) : catalog.servos, controllers: catalog.controllers });
  });
  router.get('/templates', (_req: Request, res: Response) => { res.json({ templates }); });

  router.use(createRigRoutes({ pool: ctx.pool, callerSub, catalog: rows, templates }));
  return router;
}
