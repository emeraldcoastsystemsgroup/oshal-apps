#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the compiled Vids surface remains usable and injection-safe in a real mobile Chromium viewport.
 */

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SURFACES = Object.freeze({
  generated: ['vids', 'routes', 'vids-routes.js'],
  source: ['vids', 'src-routes', 'vids-routes.ts'],
});

/** @description Extract the literal self-contained surface without executing the route module. */
export function extractVidsSurface(source, label = 'Vids route') {
  const marker = 'const SURFACE_HTML = `';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`${label}: SURFACE_HTML declaration is missing`);
  const bodyStart = start + marker.length;
  const end = source.indexOf('`;', bodyStart);
  if (end < 0) throw new Error(`${label}: SURFACE_HTML terminator is missing`);
  const html = source.slice(bodyStart, end);
  if (!html.startsWith('<!doctype html>') || !html.includes('</html>')) {
    throw new Error(`${label}: SURFACE_HTML is not a complete HTML document`);
  }
  if (html.includes('${')) throw new Error(`${label}: SURFACE_HTML must remain a static literal`);
  return html;
}

/** @description Parse explicit repository roots and select source only for local pre-build diagnosis. */
export function parseMobileProofOptions(argv) {
  const values = { surface: 'generated' };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--store', '--framework', '--surface'].includes(flag) || !value) {
      throw new Error('Usage: run-vids-mobile-browser.mjs --store <store> --framework <framework> [--surface generated|source]');
    }
    values[flag.slice(2)] = value;
  }
  if (!values.store || !values.framework || !Object.hasOwn(SURFACES, values.surface)) {
    throw new Error('Store, framework, and a generated|source surface are required');
  }
  return values;
}

/** @description Resolve a reviewed file below the store root without accepting arbitrary paths. */
function surfacePath(storeRoot, surface) {
  const store = resolve(storeRoot);
  const full = resolve(store, ...SURFACES[surface]);
  const rel = relative(store, full);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || !existsSync(full)) {
    throw new Error(`Reviewed Vids ${surface} surface is missing below the store root`);
  }
  return full;
}

/** @description Start a loopback-only fixture that serves the real surface and hostile API data. */
async function startFixture(html) {
  const assetRequests = new Set();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/api/vids/app') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
      return;
    }
    if (url.pathname === '/api/vids/jobs' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        workers: [{ status: 'online', name: '<img id="worker-pwn" src=x onerror="window.pwned=1">' }],
        jobs: [{
          status: '"><img id="status-pwn" src=x onerror="window.pwned=1">',
          idea: '<img id="idea-pwn" src=x onerror="window.pwned=1"> mobile-proof-averylongunbrokenvalue',
          orientation: '<svg id="orientation-pwn" onload="window.pwned=1">',
          client_id: '<img id="client-pwn" src=x onerror="window.pwned=1">',
          created_at: '2026-08-05T12:00:00.000Z',
        }],
      }));
      return;
    }
    if (url.pathname.startsWith('/shared/ui/')) {
      assetRequests.add(url.pathname);
      response.writeHead(200, { 'content-type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' });
      response.end('');
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mobile fixture did not bind a TCP port');
  return {
    assetRequests,
    url: `http://127.0.0.1:${address.port}/api/vids/app`,
    close: () => new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept())),
  };
}

/** @description Exercise layout, shared theming, and hostile row rendering in mobile Chromium. */
export async function runVidsMobileBrowserProof({ store, framework, surface = 'generated' }) {
  const routePath = surfacePath(store, surface);
  const html = extractVidsSurface(readFileSync(routePath, 'utf8'), routePath);
  const frameworkRoot = resolve(framework);
  const requireFromFramework = createRequire(resolve(frameworkRoot, 'package.json'));
  let chromium;
  try {
    ({ chromium } = requireFromFramework('playwright'));
  } catch (error) {
    throw new Error(`Locked framework Playwright is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const fixture = await startFixture(html);
  let browser;
  const browserErrors = [];
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.goto(fixture.url, { waitUntil: 'networkidle' });
    await page.locator('#rows tr').waitFor();
    const proof = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('#rows tr:first-child td')];
      const headers = [...document.querySelectorAll('thead th')];
      const idea = document.querySelector('#rows .idea');
      const worker = document.getElementById('wtxt');
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        hiddenHeaderDisplays: [headers[2], headers[3]].map((node) => getComputedStyle(node).display),
        hiddenCellDisplays: [cells[2], cells[3]].map((node) => getComputedStyle(node).display),
        ideaText: idea?.textContent ?? '',
        workerText: worker?.textContent ?? '',
        hostileNodes: document.querySelectorAll('[id$="-pwn"]').length,
        scriptMarker: Boolean(window.pwned),
      };
    });
    if (proof.documentWidth > proof.viewportWidth || proof.bodyWidth > proof.viewportWidth) {
      throw new Error(`Vids mobile surface overflows: viewport=${proof.viewportWidth}, document=${proof.documentWidth}, body=${proof.bodyWidth}`);
    }
    if (![...proof.hiddenHeaderDisplays, ...proof.hiddenCellDisplays].every((value) => value === 'none')) {
      throw new Error(`Vids mobile columns are visible: ${JSON.stringify(proof)}`);
    }
    if (!proof.ideaText.includes('<img id="idea-pwn"') || !proof.workerText.includes('<img id="worker-pwn"')) {
      throw new Error('Vids hostile fixture text was not rendered for inspection');
    }
    if (proof.hostileNodes !== 0 || proof.scriptMarker || browserErrors.length) {
      throw new Error(`Vids browser injection proof failed: nodes=${proof.hostileNodes}, marker=${proof.scriptMarker}, errors=${JSON.stringify(browserErrors)}`);
    }
    for (const asset of ['/shared/ui/css/surface-themes.css', '/shared/ui/js/surface-theme.js']) {
      if (!fixture.assetRequests.has(asset)) throw new Error(`Vids shared theme asset was not requested: ${asset}`);
    }
    console.log(`Vids mobile Chromium proof passed (${surface}, ${proof.viewportWidth}px viewport)`);
  } finally {
    if (browser) await browser.close();
    await fixture.close();
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    await runVidsMobileBrowserProof(parseMobileProofOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
