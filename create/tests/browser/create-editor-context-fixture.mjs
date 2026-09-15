/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Observe actual editor context through the shared production bridge and contract over a disposable project fixture.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { startEditorFixture } from './create-editor-fixture.mjs';

export const coreRoot = resolve(process.env.OSHAL_CORE_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../../../oshal'));
const requireCore = createRequire(resolve(coreRoot, 'package.json'));
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let contract;

/** Bundle the unchanged core contract in memory; no alternative schema or authority implementation. */
function contractModule() {
  contract ??= requireCore('esbuild').buildSync({ entryPoints: [resolve(coreRoot, 'src/features/surface-bridge/index.ts')],
    bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent', tsconfig: resolve(coreRoot, 'tsconfig.json') }).outputFiles[0].text;
  return contract;
}

const parentObserver = `<script type="module">
import * as contract from '/context-contract.js';
import {createSurfaceBridgeRelay} from '/cockpit/js/surface-bridge-relay.js';
window.contextMessages=[];window.contextRaw=[];window.contextResults=[];window.contextOps=__MANIFEST_OPS__;
const relay=createSurfaceBridgeRelay({contract,getApp:()=> 'create',getAllowedOps:()=>window.contextOps,
getSurfaceWindow:()=>document.getElementById('editorFrame')?.contentWindow,
getAssistantWindows:()=>[{postMessage:message=>window.contextMessages.push(message)}],
postToShell:()=>{},origin:location.origin});
window.addEventListener('message',event=>{
  if(event.data?.channel!=='oshal-surface-bridge')return;
  window.contextRaw.push(event.data);window.contextResults.push(relay.handleMessage(event));
});
window.requestContext=()=>document.getElementById('editorFrame').contentWindow.postMessage({
channel:'oshal-surface-bridge',v:1,app:'create',op:'custom',name:'request_context',data:{}},location.origin);
window.contextFixtureReady=true;
</script>`;

/** Reuse shipped editor HTML/API fixture and only add its explicit observing parent. */
export async function contextFixture(browser, options = {}, onCreate = () => {}) {
  const declaredOps = contextManifest().surface?.ops ?? [];
  const fixture = await startEditorFixture(options);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const close = async () => { await context.close(); await fixture.close(); }; onCreate(close);
  const external = [], errors = [];
  await context.addInitScript(() => { window.__SURFACE_BRIDGE_RELAY_NO_AUTOBOOT = true; localStorage.setItem('cockpit-theme', 'workspace'); });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== fixture.origin) { external.push(url.href); return route.abort(); }
    if (url.pathname === '/context-contract.js') return route.fulfill({ contentType: 'text/javascript', body: contractModule() });
    if (url.pathname === '/fixture') {
      const response = await route.fetch();
      const observer = parentObserver.replace('__MANIFEST_OPS__', JSON.stringify(declaredOps));
      return route.fulfill({ response, body: (await response.text()).replace('</body>', observer + '</body>') });
    }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(4000); page.on('pageerror', error => errors.push(error.message));
  const record = options.seed ? fixture.seed(options.seed) : null;
  await page.goto(fixture.origin + '/fixture' + (record ? '?project=' + record.id : ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.contextFixtureReady === true);
  const surface = page.frameLocator('#editorFrame');
  await surface.locator('#saveStatus').filter({ hasNotText: /Checking|Loading/ }).waitFor();
  if (await surface.locator('#autosave').isEnabled()) await surface.locator('#autosave').uncheck();
  return { page, surface, fixture, record, external, errors, close };
}

/** Own only the Chromium process created for this suite, using the core bounded cleanup contract. */
export async function ownedBrowser() {
  const { tsImport } = requireCore('tsx/esm/api');
  const { launchIsolatedBrowser } = await tsImport(pathToFileURL(resolve(coreRoot, 'tests/fixtures/isolated-browser.ts')).href, import.meta.url);
  return launchIsolatedBrowser({ headless: true });
}

/** Read the actual shipped declaration; absence remains a real fail-closed relay input. */
export function contextManifest() {
  return requireCore('js-yaml').load(readFileSync(resolve(packageRoot, 'oshal-app.yaml'), 'utf8'));
}

/** Verify the actual compiled static factory, independent of the editor API double's static mount. */
export async function servedContextModule() {
  const express = requireCore('express');
  const filename = resolve(packageRoot, 'routes/create-routes.js'), exports = {};
  // Execute unchanged published factory bytes with real core dependencies, as the installed loader supplies them.
  runInNewContext(readFileSync(filename, 'utf8'), { exports, require: requireCore, __dirname: dirname(filename) }, { filename });
  const { createCreateRoutes } = exports;
  const app = express(); app.use('/api/create', createCreateRoutes({ appPackageDir: packageRoot }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(done => server.once('listening', done));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/create/editor/editor-context.mjs`);
    return { status: response.status, type: response.headers.get('content-type'), bytes: Buffer.from(await response.arrayBuffer()),
      expected: readFileSync(resolve(packageRoot, 'tools/editor/editor-context.mjs')) };
  } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
}
