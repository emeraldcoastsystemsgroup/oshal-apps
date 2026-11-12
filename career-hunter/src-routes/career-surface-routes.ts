/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Extract native surfaces, static assets, and the caller-scoped classic board from the composition root.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Retire the unbounded persistent classic-board process and redirect legacy links to the native board.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Admit only the named public community-source directory JSON beside existing static assets.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Serve the native board at the admitted package root as well as its existing named surface.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Serve Career's home page (GET /home, career-home.html): the first screen of Career as its own application, and the page that hosts another application's screen under Career's bar.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | T63: the retired /board and /board/* addresses answer a hand-off page to the native board (src-routes/hand-off-page.ts) instead of a 308. On the native kernel a package cannot redirect: the response has no `redirect` and no Location header is relayed, so these answered HTTP 500 on the test slot (2026-11-11).
 */

/**
 * Career Hunter surface routes.
 *
 * Native HTML surfaces are package assets. Historical classic-board paths redirect to the native
 * board so a request can no longer create an unbounded persistent Node/Python process pair.
 * @module career-surface-routes
 */
import { type Request, type RequestHandler, type Response, type Router } from 'express';
import path from 'path';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { handOffPage } from './hand-off-page';

const logger = createChildLogger({ module: 'career-surface-routes' });
const TOOL_DIR = path.resolve(__dirname, '..', 'tools');

/**
 * @description Create a no-cache handler for one package-owned Career surface.
 * @param fileName basename of the HTML asset under the package tools directory
 * @returns Express handler that serves the asset without stale browser caching
 */
export function createCareerToolFileHandler(fileName: string): RequestHandler {
  return (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(TOOL_DIR, fileName), (err: unknown) => {
      if (err) {
        logger.error({ err, fileName }, 'career surface serve failed');
        res.status(404).send('Not found');
      }
    });
  };
}

/** Serve one allowlisted static asset and log package/path drift. */
function serveStatic(req: Request, res: Response): void {
  const file = path.basename(String(req.params.file));
  if (file !== 'career-local-sources.json' && !/\.(css|js|png|svg)$/.test(file)) { res.status(404).end(); return; }
  res.sendFile(path.join(TOOL_DIR, file), (err: unknown) => {
    if (err) {
      logger.error({ err, file }, 'career static asset serve failed');
      res.status(404).end();
    }
  });
}

/**
 * Send retired classic-board URLs on to the bounded native surface with a hand-off page. A kernel relays a package's
 * status, body and content type and no other header, so the 308 these answered never reached the browser (HTTP 500).
 */
function redirectClassicBoard(_req: Request, res: Response): void {
  res.status(200).type('html').send(handOffPage('/api/career-hunter/board-native', 'Open My jobs'));
}

/**
 * @description Register package-owned HTML and static surfaces before feature data routes.
 * @param router authenticated Career Hunter router
 * @returns nothing
 */
export function registerCareerSurfaceRoutes(router: Router): void {
  const board:RequestHandler=(req,res,next)=>createCareerToolFileHandler(/^[1-9]\d{0,14}$/.test(String(req.query?.application||''))?'career-application.html':'career-job-lists.html')(req,res,next);
  router.get('/', board);
  router.get('', board);
  router.get('/board-native', board);
  // Search Jobs — the corpus, not the caller's scored matches. Deliberately a separate
  // screen from the board: it works with no résumé indexed, and has no fit/pipeline concept.
  router.get('/search-ui',(req,res,next)=>createCareerToolFileHandler(req.query.view==='matches'?'career-job-lists.html':'career-search.html')(req,res,next));
  router.get('/recruiters-ui', createCareerToolFileHandler('career-recruiters.html'));
  router.get('/strengthen-ui', createCareerToolFileHandler('career-strengthen.html'));
  router.get('/insights-ui', createCareerToolFileHandler('career-insights.html'));
  router.get('/approvals', createCareerToolFileHandler('career-approvals.html'));
  router.get('/settings', createCareerToolFileHandler('career-settings.html'));
  router.get('/home', createCareerToolFileHandler('career-home.html'));
  router.get('/resume-studio', createCareerToolFileHandler('career-resume-studio.html'));
  router.get('/mobile', createCareerToolFileHandler('career-mobile.html'));
  router.get('/submissions', createCareerToolFileHandler('career-submissions.html'));
  router.get('/static/:file', serveStatic);
}

/**
 * @description Keep historical classic-board URLs working without starting persistent children.
 * @param router authenticated Career Hunter router
 * @param _ctx retained context parameter for registrar compatibility
 * @returns nothing
 */
export function registerCareerClassicBoardRoutes(router: Router, _ctx: AppContext): void {
  router.get('/board', redirectClassicBoard);
  router.get('/board/*boardPath', redirectClassicBoard);
}
