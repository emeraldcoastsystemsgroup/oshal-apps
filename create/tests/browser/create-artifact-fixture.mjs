/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Compose actual Create pages, shared dispatch/controller and owned editor fixture with isolated raster handles.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { startEditorFixture, syntheticImage } from './create-editor-fixture.mjs';
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const surfaceRoot = process.env.CREATE_ARTIFACT_SOURCE_ROOT ? resolve(process.env.CREATE_ARTIFACT_SOURCE_ROOT) : packageRoot;
export const coreRoot = resolve(process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR || resolve(packageRoot, '../../oshal'));
const requireCore = createRequire(resolve(coreRoot, 'package.json'));
requireCore('tsx/cjs');
const express = requireCore('express');
export const { launchIsolatedBrowser } = requireCore(resolve(coreRoot, 'tests/fixtures/isolated-browser.ts'));
export const REF = 'art_synthetic_image_1234';

/** The real controller forwards the shell handle and a bounded synthetic ribbon port consumes the actual Home message. */
function shell() {
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/shared/ui/css/surface-themes.css">
  <style>body{margin:0}#mainContent{height:96vh}button{padding:6px}</style></head><body><button id="home">Home</button><main id="mainContent"></main>
  <script type="module">import {CockpitViewController} from '/cockpit/js/cockpit-view-controller.js';
  import {ThemeManager} from '/cockpit/js/theme-manager.js';window.theme=new ThemeManager();theme.setApplicationTheme('create','/api/create/theme/create.css');
  window.navigationMessages=[];let query='';const views=['home','editor'].map(name=>({id:'tool-create-'+name,label:name,toolUi:{iframeUrl:'/api/create/'+name}}));
  const ribbon={views,consumeToolQuery:()=>{const value=query;query='';return value;}};
  const controller=new CockpitViewController({theme,getRibbon:()=>ribbon});
  function open(id){controller.renderToolView(document.getElementById('mainContent'),id);}
  window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==document.querySelector('iframe')?.contentWindow||event.data?.type!=='app-navigate'||event.data.tool!=='create-editor')return;
  window.navigationMessages.push(event.data);query=event.data.query||'';open('tool-create-editor');});
  document.getElementById('home').onclick=()=>open('tool-create-home');open('tool-create-home');</script></body></html>`;
}

/** Only a fixed loopback fixture receives proxy traffic; request bodies reach its real synthetic upload handler unchanged. */
function proxy(upstream) {
  return (req, res) => {
    const target = new URL(req.originalUrl, upstream);
    const forwarded = request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, reply => {
      res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
    });
    forwarded.on('error', () => { if (!res.headersSent) res.status(502).json({ error: 'synthetic_fixture_unavailable' }); else res.destroy(); });
    req.pipe(forwarded);
  };
}

/** Actual package metadata defines the destination; the synthetic catalog only admits this test caller. */
function destination() {
  const yaml = requireCore('js-yaml'), fs = requireCore('node:fs');
  const manifest = yaml.load(fs.readFileSync(resolve(packageRoot, 'oshal-app.yaml'), 'utf8'));
  const accept = manifest.artifacts?.accepts?.find(row => row.mode === 'open' && row.types.includes('image/png'));
  return accept ? { ...accept, app: manifest.name, appLabel: manifest.displayName } : null;
}

/** Add only metadata and byte routes; no provider, installed API, database or device is reachable. */
function routes(app, state, options) {
  app.get('/cockpit/', (_req, res) => res.type('html').send(shell()));
  app.get('/shared/ui-debug.js', (_req, res) => res.sendFile(resolve(coreRoot, 'src/pages/shared/ui-debug.js')));
  app.get('/api/create/home', (_req, res) => res.sendFile(resolve(surfaceRoot, 'tools/create-home.html')));
  app.get('/api/create/editor/editor-files.mjs', (_req, res) => res.sendFile(resolve(surfaceRoot, 'tools/editor/editor-files.mjs')));
  app.get('/api/authorization/me', (_req, res) => res.status(options.accessStatus || 200).json({ status: 'enforced', tier: options.denied ? 'deny' : 'manager', denied: Boolean(options.denied) }));
  app.get('/api/ui/profile', (_req, res) => res.json({ profile: { ribbon: { items: [] } } }));
  app.get(/\/home-summary$/, (_req, res) => res.json({ items: [], metrics: [] }));
  app.get('/api/artifacts/handles/:ref', (req, res) => res.status(req.params.ref === REF ? 200 : 404).json({ type: 'image/png', name: 'Synthetic generated image' }));
  app.get('/api/artifacts/handles/:ref/content', (req, res) => {
    state.reads++; if (req.params.ref !== REF) return res.sendStatus(404);
    if (state.refusal) return res.status(state.refusal).json({ error: 'synthetic_artifact_unavailable' });
    return res.type(state.type).send(state.image);
  });
  app.get('/api/artifacts/actions', (_req, res) => res.json({ actions: destination() ? [destination()] : [] }));
  app.get('/api/artifacts/send-to.js', (_req, res) => res.sendFile(resolve(coreRoot, 'src/pages/cockpit/js/components/send-to.js')));
  app.get('/source', (_req, res) => res.type('html').send(`<!doctype html><button id="send">Edit generated image</button><script src="/api/artifacts/send-to.js"></script>
    <script>document.getElementById('send').onclick=()=>window.oshalDispatchArtifact({ref:'${REF}',app:'create',id:'${destination()?.id || 'image-layer'}'}).catch(e=>document.body.dataset.error=e.message);</script>`));
}

/** Reuse the existing mutable Maps and normalization upload route; never substitute model or renderer modules. */
export async function startArtifactFixture(options = {}) {
  const editor = await startEditorFixture(options), app = express();
  const state = { reads: 0, image: await syntheticImage(), type: 'image/png', refusal: options.refusal || 0, requests: [] };
  app.use((req, res, next) => { state.requests.push({ method: req.method, path: req.path }); res.set('Cache-Control', 'no-store'); next(); });
  routes(app, state, options); app.use(proxy(editor.origin));
  const server = app.listen(0, '127.0.0.1'); await new Promise(done => server.once('listening', done));
  return { origin: `http://127.0.0.1:${server.address().port}`, state, editor, seed: editor.seed,
    close: async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); await editor.close(); } };
}
