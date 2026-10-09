/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Real Home and Venture surfaces with fixture data/auth, no provider calls or business mutations.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Serve platform display preferences at the canonical cockpit endpoint used by the shipped client.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Prove selected-source and full catalog parity with a stable Home assistant before the actual editable Venture handoff.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const store = path.resolve(__dirname, '..');
const core = path.resolve(process.env.OSHAL_CORE_DIR || path.join(store, '../oshal'));
const express = require(path.join(core, 'node_modules/express'));
const { chromium } = require(path.join(core, 'node_modules/playwright'));
const app = express();
let writes = 0;
app.use((req, res, next) => { if (req.method !== 'GET') { writes++; return res.status(405).end(); } next(); });
app.use('/cockpit', express.static(path.join(core, 'src/pages/cockpit')));
app.use('/shared', express.static(path.join(core, 'src/pages/shared')));
app.get('/receiver', (_req, res) => res.sendFile(path.join(store, 'venture-plan/tools/venture.html')));
app.get('/api/venture/ventures', (_req, res) => res.json({ ventures: [] }));
const offer = { id: 'explore-venture', label: 'Explore as a venture', sourceApp: 'world', targetApp: 'venture-plan', targetAction: 'research-idea', contextType: 'research-brief', version: 1, state: 'available', surface: 'venture-home', surfaceUrl: '/receiver', fields: ['title', 'notes', 'sourceUrl'] };
app.get('/api/swarm/apps/home-plan', (_req, res) => res.json({ apps: [{ name: 'world', displayName: 'World Intelligence', suite: 'ai-knowledge', kind: 'app', members: ['world'], firstSurface: 'world-dashboard', todos: [], summary: [{ app: 'world', path: '/summary', metricsPointer: '/metrics', itemsPointer: '/items', surfaces: ['world-dashboard'], integrations: [offer] }] }] }));
app.get('/api/cockpit/home/preferences', (_req, res) => res.json({ preferences: { version: 1 }, revision: 0 }));
app.get('/summary', (_req, res) => res.json({ metrics: [{ id: 'fetched', label: 'Fetched / 24h', value: '887260' }], items: [{ text: 'A recorded research finding', detail: 'Saved source evidence, not a generated recommendation.', integration: 'explore-venture', context: { title: 'Research finding', notes: 'Evidence for review', sourceUrl: 'https://news.example/story' } }, { text: 'A second topic', detail: 'Separate saved evidence with no connected action.' }] }));
app.get('/', (_req, res) => res.send(`<!doctype html><html><head><link rel="stylesheet" href="/cockpit/css/apps-home.css"><style>:root{--bg-card:#191a2b;--bg-tertiary:#26283b;--border-color:#34364b;--text-primary:#eee;--text-secondary:#b0b3c4;--text-muted:#9195aa;--accent-primary:#9e8afa}body{margin:0;background:#11121d;color:#eee;font-family:system-ui}#root{height:100vh}iframe{width:100%;height:100vh;border:0}</style></head><body><main id="root"></main><script type="module">import {CockpitViewController} from '/cockpit/js/cockpit-view-controller.js';const root=document.querySelector('#root');let controller;const ribbon={views:[],setActive:id=>controller.renderToolView(root,id)};controller=new CockpitViewController({getRibbon:()=>ribbon});await controller.renderAppsHomeView(root);</script></body></html>`));
app.use((_req, res) => res.json({ tasks: [] }));
(async () => {
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.goto(base);
    await page.locator('[data-home-area="ai-knowledge"]').click();
    await page.locator('select[data-choice="detail"]').selectOption('world');
    const card=page.locator('.apps-home-detail .apps-home-card[data-card="world"]');
    await card.getByRole('button', { name: 'Explore as a venture' }).waitFor();
    assert.equal(await page.locator('.apps-home-detail .apps-home-card').count(),1);
    const findings=await card.locator('.apps-home-items li > span').allTextContents();
    assert.equal(findings.length,2);assert.match(findings[0].trim(),/^A recorded research finding/);assert.match(findings[1].trim(),/^A second topic/);
    assert.equal(await page.locator('#appsHomeJarvisFrame').count(),1);assert.equal(writes,0);
    const assistant=await page.locator('#appsHomeJarvisFrame').elementHandle();
    await page.getByRole('button',{name:'All applications',exact:true}).click();
    assert.deepEqual(await page.locator('#appsHomeDirectory li strong').allTextContents(),['World Intelligence']);
    assert.deepEqual(await page.locator('#appsHomeDirectory [data-open]').evaluateAll(rows=>rows.map(row=>row.dataset.open)),['world-dashboard']);
    await page.getByRole('button',{name:'Done',exact:true}).click();
    assert.equal(await assistant.evaluate(el=>el===document.getElementById('appsHomeJarvisFrame')),true);
    assert.equal(await card.evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('.apps-home-summary').getBoundingClientRect();return r.left>=p.left&&r.right<=p.right+1&&el.scrollWidth<=el.clientWidth;}),true);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await card.evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().right<=innerWidth),true);
    assert.equal(await assistant.evaluate(el=>el===document.getElementById('appsHomeJarvisFrame')),true);
    await page.getByRole('button', { name: 'Explore as a venture' }).click();
    assert.equal(await page.locator('#appsHomeJarvisFrame').count(),0);
    const frame = page.frameLocator('iframe');
    await frame.locator('#n_name').waitFor();
    await frame.locator('#n_idea').filter({ visible: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('#n_name')?.value === 'Research finding');
    assert.match(await frame.locator('#n_idea').inputValue(), /Evidence for review/);
    assert.match(await frame.locator('#n_idea').inputValue(), /https:\/\/news\.example\/story/);
    assert.equal(writes, 0);
    console.log('PASS: actual Home button opens the actual Venture draft with context; mobile has no overflow; zero writes.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
