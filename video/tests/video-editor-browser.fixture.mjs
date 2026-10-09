/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Open the REAL editor screen served by the real compiled Video routes over a disposable PostgreSQL, with the core's real shared theme code, in real Chromium. Every request that leaves the loopback origin is refused and recorded; the named fixture prober and encoder stand in for ffprobe and FFmpeg (real FFmpeg is proved in video-edit-export.test.mjs).
 */
import { resolve } from 'node:path';
import { express, requireCore, coreRoot, startApi, fixtureEncoder } from './video-editor.fixture.mjs';

export const { chromium } = requireCore('playwright');
export const PALETTES = ['midnight', 'daylight', 'ocean', 'sakura', 'forest', 'gray', 'black', 'light-blue', 'aurora', 'graphite', 'amber', 'workspace'];

/** @description Add the core's shared theme stylesheet, bootstrap and palette files; nothing else from core is served. */
function sharedAssets(app) {
  app.use('/shared/ui/css', express.static(resolve(coreRoot, 'src/shared/ui/css')));
  app.use('/shared/ui/js', express.static(resolve(coreRoot, 'src/shared/ui/js')));
  app.use('/cockpit/css/themes', express.static(resolve(coreRoot, 'src/pages/cockpit/css/themes')));
}

/**
 * @description Start the editor on loopback and open it in a fresh browser context.
 * @param {object} t Test context. @param {object} browser Chromium. @param {object} database Postgres fixture. @param {object} options denied, viewport, theme.
 * @returns {Promise<object>} page, api, encoder, errors, external and requests.
 */
export async function openEditor(t, browser, database, options = {}) {
  const encoder = fixtureEncoder();
  const api = await startApi(t, database.pool, { denied: options.denied, exports: encoder, extend: sharedAssets });
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1440, height: 1000 } });
  const errors = [], external = [], requests = [];
  t.after(async () => { await context.close(); });
  await context.addInitScript(theme => { try { if (!localStorage.getItem('cockpit-theme')) localStorage.setItem('cockpit-theme', theme); } catch { /* storage off */ } }, options.theme ?? 'workspace');
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== api.origin) { external.push(url.href); return route.abort(); }
    requests.push(`${route.request().method()} ${url.pathname}`); return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${api.origin}/api/video/editor${options.query ?? ''}`, { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-editor-ready="true"]').waitFor();
  return { page, context, api, encoder, errors, external, requests };
}
