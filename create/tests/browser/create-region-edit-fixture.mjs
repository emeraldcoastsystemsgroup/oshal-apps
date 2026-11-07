/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve the real editor through the real compiled Create routes (static and project, including region editing) over a disposable PostgreSQL, with the explicitly named fixture image provider and the shared theme assets from the core checkout. Nothing reaches an installed database, account or real provider.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: serve the platform's shared editor (OSHAL_PLATFORM_ROOT, as create-editor-fixture does) ahead of the core checkout, because the layer fields now live only in the shared Format inspector.
 */
import { resolve } from 'node:path';
import { express, requireCore, coreRoot, packageRoot, startApi, loadCompiled } from '../project-api.fixture.mjs';
import { fixtureProvider } from '../region-edit.fixture.mjs';

export const { chromium } = requireCore('playwright');
const { createCreateRoutes } = loadCompiled('create-routes.js');

const platformRoot = resolve(process.env.OSHAL_PLATFORM_ROOT || resolve(packageRoot, '../../oshal-kernel/platform'));

/** Shared theme, bridge and picker assets: the platform's shared editor first, then the core checkout's. */
function sharedAssets(app) {
  app.use('/api/create', createCreateRoutes({ appPackageDir: packageRoot }));
  app.use('/shared/ui/css', express.static(resolve(platformRoot, 'src/shared/ui/css')));
  app.use('/shared/ui/js', express.static(resolve(platformRoot, 'src/shared/ui/js')));
  app.use('/shared/ui/css', express.static(resolve(coreRoot, 'src/shared/ui/css')));
  app.use('/shared/ui/js', express.static(resolve(coreRoot, 'src/shared/ui/js')));
  app.get('/api/artifacts/picker.js', (_req, res) => res.sendFile(resolve(coreRoot, 'src/pages/cockpit/js/components/artifact-picker.js')));
  app.get('/api/artifacts/picker.css', (_req, res) => res.sendFile(resolve(coreRoot, 'src/pages/cockpit/js/components/artifact-picker.css')));
}

/** @description Start the real routes on a disposable database with the named fixture provider.
 * @param {object} t node:test context for cleanup. @param {object} db Disposable PostgreSQL from startPostgres.
 * @param {{provider?:object,denied?:string[],dailyCap?:number}} options Provider mode, denied permissions and daily ceiling.
 * @returns {Promise<object>} HTTP caller, origin, permission state and the fixture provider. */
export async function startRegionEditor(t, db, options = {}) {
  const provider = fixtureProvider(options.provider);
  const api = await startApi(t, db.pool, { denied: options.denied, extend: sharedAssets,
    regionEdits: { dependencies: provider.dependencies, settings: { dailyCap: options.dailyCap ?? 20, concurrency: 1, timeoutMs: 10000 } } });
  return { ...api, provider };
}
