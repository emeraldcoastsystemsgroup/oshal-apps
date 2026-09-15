/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial — serve the Create home surface and the package skin from the installed package dir
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | GET /new — the purpose-first New screen
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Serve the image editor and an exact bundled module allowlist; persistence remains a separate factory.
 * 4   | maintainer@emeraldcoastsystemsgroup.com     | Serve the editable template catalog and picker through the same fixed module allowlist.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Serve the bounded read-only editor context adapter through the existing exact module allowlist.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Serve the Brand Kit page at /brand and its shared brand modules through the same exact allowlist.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Router, type Request, type Response } from 'express';

/** The slice of the framework AppContext this package reads: only where it was installed. */
interface CreateRouteContext {
  appPackageDir?: string;
}

/**
 * @description Resolve the installed package root ONCE, when the factory runs. `ctx.appPackageDir` is
 * the framework's contract; the env var is the load-time fallback for older frameworks and is never
 * read per request (after load it names whichever package the loader mounted LAST).
 * @param ctx - Framework context handed to the factory.
 * @returns Absolute package root.
 */
function packageRoot(ctx: CreateRouteContext): string {
  if (ctx.appPackageDir) return path.resolve(ctx.appPackageDir);
  if (process.env.OSHAL_APP_PACKAGE_DIR) return path.resolve(process.env.OSHAL_APP_PACKAGE_DIR);
  return path.resolve(__dirname, '..');
}

/**
 * @description Send one bundled file with the exact content type the surface expects, refusing to
 * serve anything the package does not ship (a missing file is a 404, never a stack trace).
 * @param res - Express response.
 * @param file - Absolute path inside the package.
 * @param type - Content type to send.
 * @returns void
 */
function sendBundled(res: Response, file: string, type: string): void {
  if (!fs.existsSync(file)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.type(type);
  res.sendFile(file);
}

/**
 * @description The Create package's own routes: its home surface and the skin the cockpit wears while
 * the app is focused, plus the layered image editor. This factory serves bundled bytes; project
 * persistence and its permission checks live in the separate Create project route factory.
 * @param ctx - Framework context (only `appPackageDir` is read).
 * @returns Express router mounted at /api/create.
 */
export function createCreateRoutes(ctx: CreateRouteContext): Router {
  const root = packageRoot(ctx);
  const home = path.join(root, 'tools', 'create-home.html');
  const fresh = path.join(root, 'tools', 'create-new.html');
  const skin = path.join(root, 'ui', 'create.css');
  const router = Router();

  router.get('/home', (_req: Request, res: Response) => sendBundled(res, home, 'text/html; charset=utf-8'));
  router.get('/new', (_req: Request, res: Response) => sendBundled(res, fresh, 'text/html; charset=utf-8'));
  router.get('/theme/create.css', (_req: Request, res: Response) => sendBundled(res, skin, 'text/css; charset=utf-8'));
  router.get('/editor', (_req: Request, res: Response) => sendBundled(res, path.join(root, 'tools', 'create-editor.html'), 'text/html; charset=utf-8'));
  router.get('/brand', (_req: Request, res: Response) => sendBundled(res, path.join(root, 'tools', 'create-brand.html'), 'text/html; charset=utf-8'));
  const modules = ['editor.mjs', 'editor-state.mjs', 'editor-view.mjs', 'editor-projects.mjs',
    'editor-files.mjs', 'editor-interactions.mjs', 'model.mjs', 'model-validation.mjs',
    'history.mjs', 'renderer.mjs', 'image-assets.mjs', 'hit-test.mjs', 'editor.css',
    'templates.mjs', 'editor-templates.mjs', 'editor-context.mjs', 'brand-kit.mjs', 'brand-page.mjs', 'brand-editor.mjs', 'brand.css'];
  for (const file of modules) {
    const type = file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
    router.get('/editor/' + file, (_req: Request, res: Response) => sendBundled(res, path.join(root, 'tools', 'editor', file), type));
  }

  return router;
}
