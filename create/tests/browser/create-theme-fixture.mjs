/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve both actual Create surfaces and the real shared theme manager with isolated synthetic read-only responses.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Allow bounded synthetic catalog/access responses and capture real iframe navigation messages for workspace layout proof.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Serve the catalog-compatible theme namespace while retaining read-only fixture behavior.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const coreRoot = resolve(process.env.OSHAL_CORE_ROOT || resolve(packageRoot, '../../oshal'));
const requireCore = createRequire(resolve(coreRoot, 'package.json'));
const express = requireCore('express');
export const { chromium } = requireCore('playwright');
export const themes = ['midnight', 'daylight', 'ocean', 'sakura', 'forest', 'gray', 'black', 'light-blue', 'aurora', 'graphite', 'amber', 'workspace'];

/** Real shared theme code controls an otherwise inert parent; the application document is never replaced. */
function parentHtml(screen) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <link rel="stylesheet" href="/shared/ui/css/surface-themes.css">
    <style>body{margin:0;background:var(--bg-primary);color:var(--text-primary)}iframe{width:100%;height:94vh;border:0}</style>
    </head><body><button id="workspace">Workspace</button><button id="midnight">Midnight</button>
    <label><input type="checkbox" id="settingsApplicationColors">Application colors</label>
    <iframe title="Create surface"></iframe><script type="module">
    import {ThemeManager,setApplicationColors} from '/cockpit/js/theme-manager.js';
    window.navigationMessages=[];window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===document.querySelector('iframe').contentWindow&&event.data?.type==='app-navigate')window.navigationMessages.push(event.data);});
    window.createTheme=new ThemeManager();createTheme.setApplicationTheme('create','/api/create/theme/create.css');
    for(const id of ['workspace','midnight'])document.getElementById(id).onclick=()=>createTheme.apply(id);
    document.getElementById('settingsApplicationColors').onchange=e=>setApplicationColors(e.target.checked);
    document.querySelector('iframe').src='/api/create/${screen}';document.documentElement.dataset.ready='true';
    </script></body></html>`;
}

/** Only these synthetic records are available; no route proxies to installed accounts or providers. */
function readBody(path) {
  if (path === '/api/authorization/me') return { status: 'enforced', tier: 'manager', denied: false };
  if (path === '/api/ui/profile') return { profile: { name: 'create', ribbon: { items: [] } } };
  if (path === '/api/presentations/sections/starters') return { kinds: [{ id: 'docx', groups: [{ id: 'work', label: 'Work' }] }],
    starters: [{ id: 'synthetic-resume', kind: 'docx', group: 'work', name: 'Synthetic resume', desc: 'Synthetic local preview', theme: 'plain', sections: ['Experience'] }] };
  if (path.endsWith('/home-summary')) return { items: [{ text: 'Synthetic local project', detail: 'Read-only fixture record', actions: [{ tool: 'create-office' }] }],
    metrics: [{ label: 'Synthetic projects', value: '1' }] };
  return {};
}

/** Serve unchanged application HTML plus current shared assets; reject every business mutation. */
export async function startFixture(options = {}) {
  const app = express(), requests = [];
  app.use((req, res, next) => {
    requests.push({ method: req.method, path: req.path, query: req.query });
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).json({ error: 'synthetic_read_only_fixture' });
    next();
  });
  for (const screen of ['home', 'new']) app.get(`/api/create/${screen}`, (_req, res) => res.sendFile(resolve(packageRoot, `tools/create-${screen}.html`)));
  app.get('/api/create/theme/create.css', (_req, res) => res.sendFile(resolve(packageRoot, 'ui/create.css')));
  app.get('/fixture/:screen', (req, res) => ['home', 'new'].includes(req.params.screen) ? res.type('html').send(parentHtml(req.params.screen)) : res.sendStatus(404));
  app.use('/shared/ui/css', express.static(resolve(coreRoot, 'src/shared/ui/css')));
  app.use('/shared/ui/js', express.static(resolve(coreRoot, 'src/shared/ui/js')));
  app.use('/cockpit', express.static(resolve(coreRoot, 'src/pages/cockpit')));
  app.get('/shared/ui-debug.js', (_req, res) => res.sendFile(resolve(coreRoot, 'src/pages/shared/ui-debug.js')));
  app.use('/api', (req, res) => {
    const response = options.respond?.(req.originalUrl.split('?')[0], req.query);
    if (Number.isInteger(response?.status)) return res.status(response.status).json(response.body);
    return res.json(response ?? readBody(req.originalUrl.split('?')[0]));
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(done => server.once('listening', done));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests,
    close: async () => { server.closeAllConnections(); await new Promise((done, reject) => server.close(error => error ? reject(error) : done())); } };
}
