/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve the actual Stories page and shared theme/handoff modules against isolated read-only records.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const coreRoot = resolve(process.env.OSHAL_CORE_ROOT || resolve(packageRoot, '../../oshal'));
const requireCore = createRequire(resolve(coreRoot, 'package.json'));
const express = requireCore('express');
/** @description Use the host's declared browser dependency. */
export const { chromium } = requireCore('playwright');
/** @description Exercise every currently supported portal palette. */
export const themes = ['midnight', 'daylight', 'ocean', 'sakura', 'forest', 'gray', 'black', 'light-blue', 'aurora', 'graphite', 'amber', 'workspace'];

/** A real theme manager and handoff binder surround the unchanged application document. */
function parentHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <link rel="stylesheet" href="/shared/ui/css/surface-themes.css">
    <style>body{margin:0;background:var(--bg-primary);color:var(--text-primary)}iframe{width:100%;height:92vh;border:0}</style>
    </head><body><button id="workspace">Workspace</button><button id="midnight">Midnight</button>
    <label><input type="checkbox" id="settingsApplicationColors">Application colors</label>
    <iframe title="Stories"></iframe><script type="module">
    import {ThemeManager,setApplicationColors} from '/cockpit/js/theme-manager.js';
    import {bindAppHandoffs} from '/cockpit/js/app-workflows.js';
    window.storiesTheme=new ThemeManager();storiesTheme.setApplicationTheme('create','/api/create/theme.css');
    for(const id of ['workspace','midnight'])document.getElementById(id).onclick=()=>storiesTheme.apply(id);
    document.getElementById('settingsApplicationColors').onchange=e=>setApplicationColors(e.target.checked);
    window.navigations=[];window.handoffRequests=[];const frame=document.querySelector('iframe');
    window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===frame.contentWindow&&event.data?.type==='oshal:request-app-context')handoffRequests.push(event.data);});
    bindAppHandoffs(frame,(id,options)=>navigations.push({id,options}));
    frame.src='/api/creative-studio/review';document.documentElement.dataset.ready='true';
    </script></body></html>`;
}

/** Only synthetic completed work and declared draft actions exist in this fixture. */
function responseFor(path) {
  if (path === '/api/swarm/apps/home-plan') return { apps: [{ integrationSources: [{ app: 'creative-studio',
    surfaces: [{ url: '/api/creative-studio/review' }], offers: [{ id: 'prepare-document', label: 'Prepare a document',
      sourceApp: 'creative-studio', targetApp: 'presentations', targetAction: 'prepare-brief', contextType: 'research-brief',
      version: 1, state: 'available', fields: ['title', 'notes', 'sourceUrl'], surface: 'office', surfaceUrl: '/api/office/app' }] }] }] };
  if (path === '/api/creative-studio/home-summary') return { metrics: [{ label: 'Recorded stories', value: '1' }],
    items: [{ text: 'Synthetic finished story', detail: 'Saved fixture evidence', actions: [{ context: {
      title: 'Synthetic story', notes: 'Review this recorded story.', sourceUrl: 'https://example.test/story' } }] }] };
  return null;
}

/**
 * @description Serve actual package HTML and shared assets without reaching installed accounts or providers.
 * @returns {Promise<object>} Ephemeral origin, request log and deterministic cleanup.
 */
export async function startFixture() {
  const app = express(), requests = [];
  app.use((req, res, next) => {
    requests.push({ method: req.method, path: req.path });
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).json({ error: 'read_only_fixture' });
    next();
  });
  app.get('/fixture', (_req, res) => res.type('html').send(parentHtml()));
  app.get('/api/creative-studio/review', (_req, res) => res.set('Cache-Control', 'no-store').sendFile(resolve(packageRoot, 'tools/review.html')));
  app.get('/api/create/theme.css', (_req, res) => res.sendFile(resolve(packageRoot, '../create/ui/create.css')));
  app.use('/shared/ui/css', express.static(resolve(coreRoot, 'src/shared/ui/css')));
  app.use('/shared/ui/js', express.static(resolve(coreRoot, 'src/shared/ui/js')));
  app.use('/cockpit', express.static(resolve(coreRoot, 'src/pages/cockpit')));
  app.get('/shared/ui-debug.js', (_req, res) => res.sendFile(resolve(coreRoot, 'src/pages/shared/ui-debug.js')));
  app.use((req, res) => {
    const body = responseFor(req.path);
    return body ? res.json(body) : res.status(404).json({ error: 'outside_fixture' });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((done, reject) => { server.once('listening', done); server.once('error', reject); });
  return { origin: `http://127.0.0.1:${server.address().port}`, requests,
    close: async () => { server.closeAllConnections(); await new Promise((done, reject) => server.close(error => error ? reject(error) : done())); } };
}
