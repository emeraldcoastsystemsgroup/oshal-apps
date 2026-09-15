/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve actual Career screens and shared theme assets over isolated HTTP with synthetic read-only data.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Allow bounded synthetic job responses and record existing parent navigation messages for board/search behavior proofs.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const coreRoot = resolve(process.env.OSHAL_CORE_ROOT || resolve(packageRoot, '../../oshal'));
const requireCore = createRequire(resolve(coreRoot, 'package.json'));
const express = requireCore('express');
export const { chromium } = requireCore('playwright');
export const screens = {
  review: 'review.html', 'board-native': 'career-board.html', 'search-ui': 'career-search.html',
  mobile: 'career-mobile.html', submissions: 'career-submissions.html',
  'recruiters-ui': 'career-recruiters.html', 'insights-ui': 'career-insights.html',
  'strengthen-ui': 'career-strengthen.html', 'resume-studio': 'career-resume-studio.html',
  'profile-studio': 'career-profile-studio.html', approvals: 'career-approvals.html',
  'companies-admin': 'career-companies.html', settings: 'career-settings.html',
};

/** Return fixed synthetic records; never proxy to a running installation or a provider. */
function readBody(path) {
  if (path.endsWith('/jobs') || path.endsWith('/browse')) return { jobs: [{ id: 42, title: 'Platform Engineer',
    company: 'Example Company', location: 'Remote', remote: true, fit_score: 84,
    pay_min: 120000, pay_max: 160000, has_resume: true, status: 'generated' }], total: 1 };
  if (path.endsWith('/home-plan')) return { apps: [] };
  if (path.endsWith('/home-summary')) return { metrics: [{ label: 'Sample records', value: '1' }], items: [] };
  if (path.endsWith('/resume/state')) return { hasResume: true, scored: 1 };
  if (path.endsWith('/resume/doc')) return { resume: { name: 'Sample Candidate', headline: 'Example specialist', summary: 'Synthetic resume preview.' } };
  if (path.endsWith('/plan')) return { plan: { state: 'draft', headline: 'Sample headline', about: 'Synthetic draft', skills: [] } };
  if (path.endsWith('/analytics')) return { headline: { inlane: 3 }, funnel: { sourced: 3 }, top_companies: [] };
  if (path.endsWith('/companies-admin/list')) return { companies: [], admin: false };
  if (path.endsWith('/queue')) return { jobs: [], workers: [], queued: [], running: [], failed: [], completed: [] };
  return { jobs: [], applications: [], recruiters: [], byStatus: [], workers: [], portraits: [],
    themes: [], stories: [], learned: [], targets: [], hits: [], total: 0, changes: [], settings: {} };
}

/** The parent uses the real ThemeManager; changing colors never navigates or replaces its iframe. */
function parentHtml(screen) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <link rel="stylesheet" href="/shared/ui/css/surface-themes.css">
    <style>body{margin:0;background:var(--bg-primary)}iframe{width:100%;height:90vh;border:0}</style>
    </head><body><button id="workspace">Workspace</button><button id="midnight">Midnight</button>
    <button id="daylight">Daylight</button><label><input type="checkbox" id="settingsApplicationColors">Application colors</label>
    <iframe title="Career screen" src="/api/career-hunter/${screen}"></iframe>
    <script type="module">
    import {ThemeManager,setApplicationColors} from '/cockpit/js/theme-manager.js';
    const theme = new ThemeManager(); theme.setApplicationTheme('daylight'); window.careerTheme = theme;
    window.careerNavigation = [];
    window.addEventListener('message', event => {
      if(event.origin === location.origin && event.source === document.querySelector('iframe').contentWindow
        && event.data?.type === 'app-navigate') window.careerNavigation.push(event.data);
    });
    for(const id of ['workspace','midnight','daylight'])document.getElementById(id).onclick=()=>theme.apply(id);
    document.getElementById('settingsApplicationColors').onchange=e=>setApplicationColors(e.target.checked);
    document.documentElement.dataset.ready='true';
    </script></body></html>`;
}

/** Serve only package assets and real core UI code, recording and refusing every mutation. */
export async function startFixture(options = {}) {
  const app = express(), requests = [];
  app.use((req, res, next) => {
    requests.push({ method: req.method, path: req.path, query: { ...req.query } });
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'fixture_read_only' });
    next();
  });
  for (const [route, file] of Object.entries(screens)) app.get(`/api/career-hunter/${route}`, (_req, res) => res.sendFile(resolve(packageRoot, 'tools', file)));
  app.get('/fixture/:screen', (req, res) => screens[req.params.screen] ? res.type('html').send(parentHtml(req.params.screen)) : res.sendStatus(404));
  app.use('/api/career-hunter/static', express.static(resolve(packageRoot, 'tools')));
  app.use('/shared/ui/css', express.static(resolve(coreRoot, 'src/shared/ui/css')));
  app.use('/shared/ui/js', express.static(resolve(coreRoot, 'src/shared/ui/js')));
  app.use('/cockpit', express.static(resolve(coreRoot, 'src/pages/cockpit')));
  app.get('/shared/ui-debug.js', (_req, res) => res.sendFile(resolve(coreRoot, 'src/pages/shared/ui-debug.js')));
  app.get('/api/artifacts/send-to.js', (_req, res) => res.type('js').send('/* Fixture: artifact interactions are outside this palette proof. */'));
  app.use('/api', (req, res) => {
    const response = options.respond?.(req);
    if (response) return res.status(response.status ?? 200).json(response.body);
    return res.json(readBody(req.originalUrl.split('?')[0]));
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(done => server.once('listening', done));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests,
    close: async () => { server.closeAllConnections(); await new Promise((done, reject) => server.close(error => error ? reject(error) : done())); } };
}
