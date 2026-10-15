/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve the actual editor and owned PNG/PSD routes on a uniquely owned shared35689 database; no container provisioning.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startApi, requireCore, express, packageRoot } from './project-api.fixture.mjs';
const { Pool } = requireCore('pg');
export async function psdBrowserFixture(t) {
  const raw = process.env.OSHAL_SHARED_TEST_POSTGRES_URL ?? (await readFile('/tmp/oshal-motion-disposable-pg-url', 'utf8')).trim(), url = new URL(raw);
  if (url.hostname !== '127.0.0.1' || url.port !== '35689') throw new Error('PSD browser requires shared disposable127.0.0.1:35689');
  const token = randomUUID().replaceAll('-', ''), database = 'create_psd_browser_' + token, role = 'create_psd_browser_app_' + token;
  const admin = new Pool({ connectionString: raw, max: 2 }), cleanups = []; let pool;
  t.after(async () => { try { for (const cleanup of cleanups.reverse()) await cleanup(); await pool?.end(); }
    finally { await admin.query(`DROP DATABASE IF EXISTS "${database}"`); await admin.query(`DROP ROLE IF EXISTS "${role}"`); await admin.end(); } });
  const password = randomUUID(); await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`); await admin.query(`CREATE DATABASE "${database}" OWNER "${role}"`);
  const connection = new URL(raw); connection.pathname = '/' + database; connection.username = role; connection.password = password;
  pool = new Pool({ connectionString: connection.href, max: 3 });
  for (const file of ['001-create-projects.sql','002-create-brand-kits.sql','003-force-row-level-security.sql','004-owner-policy-standard-identity-arm.sql','005-create-region-edits.sql','006-create-psd.sql']) await pool.query(await readFile(resolve(packageRoot,'migrations',file),'utf8'));
  const api = await startApi({ after: cleanup => cleanups.push(cleanup) }, pool, { extend: app => {
    app.get('/api/create/editor', (_req, res) => res.sendFile(resolve(packageRoot,'tools/create-editor.html')));
    app.use('/api/create/editor', express.static(resolve(packageRoot,'tools/editor')));
    app.use('/api/create/theme', express.static(resolve(packageRoot,'ui')));
    app.get('/shared/ui/css/surface-themes.css', (_req, res) => res.type('text/css').send(''));
    app.get('/shared/ui/js/surface-theme.js', (_req, res) => res.type('application/javascript').send(''));
    app.get('/api/artifacts/picker.js', (_req, res) => res.type('application/javascript').send(''));
  } });
  return api;
}
