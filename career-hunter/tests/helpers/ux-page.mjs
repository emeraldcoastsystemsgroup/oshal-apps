/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06: open a real Career screen in Chromium over a synthetic same-origin fixture (no Career store, no network). Package assets come from tools/, the platform's shared theme files answer empty, and every API call goes to the test's own handler, so each screen test drives the screen's own code at phone and desktop sizes.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const tools = resolve(here, '..', '..', 'tools');
export const ORIGIN = 'http://career.fixture.test';

/** Playwright from the store toolchain (the gate's own), or the toolchain the gate names. */
export function playwright() {
  const roots = [process.env.STORE_CI_TOOLCHAIN, resolve(here, '../../../scripts/toolchain/node_modules')].filter(Boolean);
  for (const root of roots) {
    if (existsSync(join(root, 'playwright'))) return createRequire(join(root, 'noop.js'))('playwright');
  }
  throw new Error(`BLOCKED: playwright not found (npm ci --prefix scripts/toolchain). Tried ${roots.join(', ')}`);
}

/** The phone and desktop sizes the audit checks. */
export const PHONE = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true };
export const DESKTOP = { viewport: { width: 1440, height: 900 } };

/**
 * @description Open one Career screen with the test's API handler behind it.
 * @param {object} browser - A launched Chromium.
 * @param {string} file - The tools/ HTML file.
 * @param {(req: {method: string, url: URL, body: any}) => ({status?: number, json?: any, text?: string}|null)} api - API answers.
 * @param {object} [size] - PHONE or DESKTOP.
 * @param {string} [query] - The frame's query string.
 * @returns {Promise<{page: object, context: object, calls: Array<{method:string, path:string, body:any}>}>}
 */
export async function openScreen(browser, file, api, size = DESKTOP, query = '') {
  const context = await browser.newContext(size);
  const calls = [];
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === '/screen') return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(tools, file)) });
    const asset = url.pathname.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
    if (asset && existsSync(join(tools, asset[1]))) {
      const type = asset[1].endsWith('.css') ? 'text/css' : 'application/javascript';
      return route.fulfill({ status: 200, contentType: type, body: readFileSync(join(tools, asset[1])) });
    }
    if (url.pathname.startsWith('/shared/') || url.pathname.startsWith('/cockpit/') || url.pathname.startsWith('/ui/')) {
      const own = api({ method: req.method(), url, body: null });
      return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript', body: own?.text ?? '' });
    }
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = req.postData(); }
    calls.push({ method: req.method(), path: url.pathname + url.search, body });
    const out = api({ method: req.method(), url, body }) || { status: 404, json: { error: 'not in fixture' } };
    return route.fulfill({ status: out.status || 200, contentType: out.text != null ? 'text/plain' : 'application/json',
      body: out.text != null ? out.text : JSON.stringify(out.json ?? {}) });
  });
  const page = await context.newPage();
  page.on('dialog', (dialog) => { calls.push({ method: 'DIALOG', path: dialog.type(), body: dialog.message() }); dialog.dismiss(); });
  await page.goto(`${ORIGIN}/screen${query}`, { waitUntil: 'load' });
  return { page, context, calls };
}
