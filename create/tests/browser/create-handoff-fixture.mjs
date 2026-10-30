/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve the production editor and project routes with actual PostgreSQL/RLS and the kernel's shared document handoff, using only synthetic fixture actors and an owned disposable database.
 */
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { startApi, express, packageRoot, requireCore, loadCompiled } from '../project-api.fixture.mjs';
import { startPostgres } from '../project-postgres.fixture.mjs';

export const { chromium } = requireCore('playwright');
const platform = resolve(process.env.OSHAL_PLATFORM_ROOT || resolve(packageRoot, '../../oshal-kernel/platform'));
const { createCreateRoutes } = loadCompiled('create-routes.js');

/**
 * @description Own a disposable PostgreSQL role/database, including the same project revision and RLS checks as installed editing.
 * @param {Function} cleanup Register fixture cleanup.
 * @returns {Promise<object>} The role-qualified connection pool.
 */
export async function handoffDatabase(cleanup) {
  const db = await startPostgres(cleanup);
  await db.pool.query(await readFile(resolve(packageRoot, 'migrations/006-create-psd.sql'), 'utf8'));
  return db;
}

/**
 * @description Mount actual application assets and actual project HTTP operations for browser handoff tests.
 * @param {object} t Test lifecycle.
 * @param {object} pool Disposable application's original-owner RLS pool.
 * @returns {Promise<object>} Bound loopback server and real HTTP caller.
 */
export function handoffFixture(t, pool) {
  return startApi(t, pool, { extend: app => {
    app.use('/api/create', createCreateRoutes({ appPackageDir: packageRoot }));
    app.use('/shared/ui', express.static(resolve(platform, 'src/shared/ui')));
    app.get('/api/artifacts/picker.js', (_req, res) => res.type('application/javascript').send(''));
    app.get('/fixture', (_req, res) => res.type('html').send(`<!doctype html><html><body>
      <iframe id="editorFrame" style="width:1200px;height:850px;border:0"></iframe>
      <script>document.getElementById('editorFrame').src='/api/create/editor'+location.search;</script>
      </body></html>`));
  } });
}
