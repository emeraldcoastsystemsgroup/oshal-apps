/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Judge's report 2026-11-11, change 5: Home's pipeline takes its names from career-stages.js, where Preparing now reads Getting ready; the expected card names follow.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.54.0: the bar is a job search in a job seeker's words, and Home is the day: three numbered steps with one filled button for a person with no résumé, and for a person with one the day's steps in order (a reply from the inbox against its job, new matches, a recruiter follow-up, the portrait, the next résumé improvement) with this week's counts.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Career as its own application, in Chromium over the shipped pages, frame and stylesheet: the top bar a person's profile gives, the section row, More, the phone's bottom bar, Career's skin; a stand-in cockpit that the frame gives its whole window while a Career page shows and that gets its own chrome back for another application's page; the cockpit asked to change screens; another application's screen shown under Career's bar; a page hosted by anything else left alone; the home page's greeting, pipeline, jobs, résumé state and search. Employer and profile text stays inert. No network beyond the fixture.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tools = resolve(here, '..', '..', 'tools');
const deps = createRequire(resolve(process.env.STORE_CI_TOOLCHAIN || resolve(here, '../../../scripts/toolchain'), 'package.json'));
const { chromium } = deps('playwright');
const ORIGIN = 'http://career.fixture.test';
const hostile = '<img src=x onerror="window.__injected=1">Hostile & Co';
const PAGES = { '/home': 'career-home.html', '/search-ui': 'career-search.html', '/board-native': 'career-job-lists.html', '/resume-studio': 'career-resume-studio.html',
  '/strengthen-ui': 'career-strengthen.html', '/profile-studio': 'career-profile-studio.html', '/settings': 'career-settings.html', '/insights-ui': 'career-insights.html',
  '/submissions': 'career-submissions.html', '/recruiters-ui': 'career-recruiters.html' };
const TYPES = { '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

const item = (id, label, group, section, href, toolName) => ({ id, label, group, section, toolUi: { iframeUrl: href, visibilityToolName: toolName } });
const profileFor = (name) => {
  const p = name === 'intelligent-career' ? 'career-hunter--' : '';
  const items = [
    item(`tool-${p}career-home`, 'Home', null, 'top', '/api/career-hunter/home', 'career-home'),
    item(`tool-${p}career-search`, 'Search Jobs', 'Job Search', 'top', '/api/career-hunter/search-ui', 'career-search'),
    item(`tool-${p}career-board`, 'Job Board', 'Job Search', 'top', '/api/career-hunter/board-native', 'career-board'),
    item(`tool-${p}career-insights`, hostile, 'Review', 'top', '/api/career-hunter/insights-ui', 'career-insights'),
    item(`tool-${p}career-strengthen`, 'Strengthen', 'Resume', 'top', '/api/career-hunter/strengthen-ui', 'career-strengthen'),
    item(`tool-${p}career-resume-studio`, 'Resume Studio', 'Resume', 'top', '/api/career-hunter/resume-studio', 'career-resume-studio'),
    item(`tool-${p}career-profile-studio`, 'Profile Studio', 'Presence', 'top', '/api/career-hunter/profile-studio', 'career-profile-studio'),
    item(name === 'intelligent-career' ? 'tool-portrait-studio--portrait-studio' : 'tool-career-portrait-studio', 'Portrait Studio', 'Presence', 'top', '/api/portrait-studio/app'),
    item(`tool-${p}career-recruiters`, 'Recruiters', 'Connections', 'top', '/api/career-hunter/recruiters-ui', 'career-recruiters'),
    item(`tool-${p}career-submission-activity`, 'Submission activity', 'Activity', 'top', '/api/career-hunter/submissions', 'career-submission-activity'),
    item(`tool-${p}career-settings`, 'Career Settings', name === 'intelligent-career' ? 'Configuration' : null, name === 'intelligent-career' ? 'top' : 'bottom', '/api/career-hunter/settings', 'career-settings'),
    'settings', item('tool-elsewhere', 'Elsewhere', null, 'top', '//elsewhere.example/x'),
  ];
  return { name, profile: { name, ribbon: { items } } };
};
const COCKPIT = `<!doctype html><html data-theme="midnight"><head><title>Cockpit</title><style>html,body{margin:0;height:100%}.header-bar{height:48px}#ribbonContainer{width:56px;float:left;height:200px}.status-bar{height:24px}.cockpit-body{padding:12px;height:calc(100vh - 72px)}.main-content{height:100%}</style></head>
<body><header class="header-bar">Cockpit header</header><div id="ribbonContainer">rail</div><main class="cockpit-body"><div class="main-content" id="main"></div></main><footer class="status-bar">status</footer>
<script>
const app=new URLSearchParams(location.search).get('app');window.__navigations=[];
function show(href,label){document.getElementById('main').innerHTML='<div class="tool-view-container" style="display:flex;flex-direction:column;height:100%;width:100%"><div class="tool-view-header">'+label+'</div><iframe src="'+href+'" style="flex:1;border:0;width:100%;height:100%"></iframe></div>';}
fetch('/api/ui/profile?name='+app).then(r=>r.json()).then(d=>{const items=d.profile.ribbon.items.filter(i=>i&&i.toolUi);window.__items=items;
 addEventListener('message',e=>{const m=e.data||{};if(e.origin!==location.origin||m.type!=='app-navigate'||!m.tool)return;const it=items.find(i=>i.id==='tool-'+m.tool);window.__navigations.push({tool:m.tool,query:m.query||''});
  if(!it)return;const u=new URL(location.href);u.searchParams.set('screen',m.tool);history.replaceState(null,'',u);show(it.toolUi.iframeUrl+(m.query?'?'+m.query:''),it.label);});
 const first=items.find(i=>i.id==='tool-'+(new URLSearchParams(location.search).get('screen')||''))||items[0];show(first.toolUi.iframeUrl,first.label);});
</script></body></html>`;

let browser;
const state = { group: true, resume: false, stats: { saved: 7, interviewing: 0, byStatus: [{ status: 'new', n: 7 }, { status: 'tracked', n: 2 }] } };

function answer(url) {
  const path = url.pathname;
  if (state.quiet) {
    if (path === '/api/career-hunter/jobs/updates') return { json: { status: 'connected', events: [] } };
    if (path === '/api/career-hunter/home-summary') return { json: { metrics: [] } };
    if (path === '/api/career-hunter/recruiters') return { json: { recruiters: [] } };
    if (path === '/api/portrait-studio/readiness') return { json: { portrait: { ready: true } } };
    if (path === '/api/career-hunter/readiness') return { json: { stories: { ready: true }, materials: { ready: true } } };
  }
  if (path === '/api/ui/profile') {
    const name = url.searchParams.get('name');
    return name === 'intelligent-career' && !state.group ? { status: 403, json: { refused: 'deny' } } : { json: profileFor(name) };
  }
  if (path === '/api/auth/user') return { json: { displayName: 'Ada Lovelace', user_sub: 'ada' } };
  if (path === '/api/career-hunter/jobs/stats') return { json: state.stats };
  if (path === '/api/career-hunter/applications') return { json: { applications: [] } };
  if (path === '/api/career-hunter/jobs') return { json: { jobs: [{ id: 1, title: hostile, company: 'Acme Robotics', location: 'Austin, TX', salary_min: 91000, salary_max: 158000, salary_currency: 'USD' },
    { id: 2, title: 'Program Manager', company: 'Globex', location: 'Remote', fit_score: 87, applied_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      emailUpdates: [{ kind: 'acknowledged', date: '2026-11-01T10:00:00Z' }, { kind: 'interview', date: '2026-11-08T10:00:00Z' }] }] } };
  if (path === '/api/career-hunter/resume/state') return { json: state.resume ? { hasResume: true, name: 'Ada Lovelace', roles: 6, scored: 412 } : { hasResume: false, roles: 0, scored: 0 } };
  if (path === '/api/career-hunter/jobs/updates') return { json: state.resume ? { status: 'connected', events: [{ kind: 'interview', subject: hostile, date: new Date(Date.now() - 86400000).toISOString(), postingId: 9 }] } : { status: 'not-checked', events: [] } };
  if (path === '/api/career-hunter/home-summary') return { json: { metrics: [{ id: 'scored-24h', value: state.resume ? '5' : '0' }] } };
  if (path === '/api/career-hunter/recruiters') return { json: { recruiters: [{ firm: 'North Search', followup_date: '2026-01-02' }, { firm: 'Someday Co', followup_date: null }] } };
  if (path === '/api/career-hunter/profile-studio/plan') return { json: { plan: null } };
  if (path === '/api/portrait-studio/readiness') return { json: { portrait: { ready: false, detail: 'No portrait yet.' } } };
  if (path === '/api/social/content/drafts') return { json: { drafts: [] } };
  if (path === '/api/career-hunter/readiness') return { json: { stories: { ready: false, detail: '2 of 6 roles have a story.' }, materials: { ready: true, detail: '3 added.' } } };
  return null;
}

async function open(path, size = { viewport: { width: 1440, height: 900 } }) {
  const context = await browser.newContext(size);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    const html = (body) => route.fulfill({ status: 200, contentType: 'text/html', body });
    if (url.pathname === '/cockpit/') return html(COCKPIT);
    if (url.pathname === '/other-host') return html('<!doctype html><html data-theme="midnight"><body><h1>Some other host</h1><iframe src="/api/career-hunter/search-ui" style="width:100%;height:600px"></iframe></body></html>');
    if (url.pathname === '/api/portrait-studio/app') return html('<!doctype html><title>Portrait Studio</title><h1 id="foreign">Portrait Studio page</h1>');
    const asset = url.pathname.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
    if (asset && existsSync(join(tools, asset[1]))) return route.fulfill({ status: 200, contentType: TYPES[asset[1].slice(asset[1].lastIndexOf('.'))] || 'text/plain', body: readFileSync(join(tools, asset[1])) });
    const page = PAGES[url.pathname.replace('/api/career-hunter', '')];
    if (url.pathname.startsWith('/api/career-hunter/') && page) return html(readFileSync(join(tools, page)));
    if (/^\/(shared|cockpit|ui)\//.test(url.pathname)) return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
    const out = answer(url) || { status: 404, json: { error: 'not in fixture' } };
    return route.fulfill({ status: out.status || 200, contentType: 'application/json', body: JSON.stringify(out.json) });
  });
  const page = await context.newPage();
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
  return { page, context };
}
/** The Career page the host is showing, once the host has attached and loaded it. */
async function career(page) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame() && candidate.url().includes('/api/career-hunter/'));
    if (frame) return frame;
    await page.waitForTimeout(50);
  }
  throw new Error('the host shows no Career page');
}
const ready = (target) => target.waitForSelector('.cf-topbar[data-cf-ready]');
const texts = (target, selector) => target.locator(selector).evaluateAll((nodes) => nodes.map((node) => node.textContent.trim() + (node.getAttribute('aria-current') ? '*' : '')));
const shown = (page, selector) => page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).display !== 'none', selector);

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test('as the top window a Career page wears Career\'s skin and draws the person\'s sections, the section row, More, their count and their name', async () => {
  const { page, context } = await open('/api/career-hunter/search-ui');
  try {
    await ready(page);
    assert.equal(await page.getAttribute('html', 'data-career-frame'), 'top');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim()), '#0f5f73');
    assert.deepEqual(await texts(page, '.cf-topbar nav a'), ['Home', 'Find jobs*', 'My jobs', 'Applications', 'Résumé', 'Profile & contacts']);
    assert.equal(await page.locator('.cf-subnav').isVisible(), false, 'a section of one page has no row under the bar');
    assert.equal((await page.textContent('.cf-chip')).trim(), '7 saved');
    assert.equal((await page.textContent('.cf-pill')).trim(), 'Ada');
    await page.click('.cf-more-desk > summary');
    assert.deepEqual(await texts(page, '.cf-more-desk .cf-menu a'), ['← All applications', 'Resume Studio', 'Strengthen', 'Profile Studio', 'Portrait Studio', 'Recruiters', hostile, 'Career Settings']);
    assert.equal(await page.evaluate(() => window.__injected), undefined, 'a label from the profile is text');
    assert.equal(await page.locator('.cf-menu a', { hasText: 'Elsewhere' }).count(), 0, 'a link off this origin is never offered');
    await page.keyboard.press('Escape');
    await page.click('.cf-topbar nav a:has-text("Résumé")');
    await page.waitForURL('**/api/career-hunter/resume-studio');
    await ready(page);
    assert.deepEqual(await texts(page, '.cf-subnav a'), ['Resume Studio*', 'Strengthen']);
    const bar = await page.locator('.cf-topbar').boundingBox();
    assert.ok(bar.y === 0 && bar.height === 60, 'the bar is the top 60px');
  } finally { await context.close(); }
});

test('the cockpit gives a Career page its whole window, changes screens when asked, and gets its chrome back for another application\'s page', async () => {
  const { page, context } = await open('/cockpit/?app=intelligent-career');
  try {
    await page.waitForFunction(() => window.__items);
    let frame = await career(page); await ready(frame);
    for (const selector of ['.header-bar', '#ribbonContainer', '.status-bar', '.tool-view-header']) assert.equal(await shown(page, selector), false, selector + ' is hidden under a Career page');
    const box = await page.locator('.tool-view-container > iframe').boundingBox();
    assert.deepEqual([box.x, box.y, box.width, box.height], [0, 0, 1440, 900], 'the page has the whole window');
    assert.equal(await page.title(), 'Intelligent Career');
    assert.equal(await page.evaluate(() => document.body.classList.contains('zen-mode')), false, 'nothing is left on the cockpit that outlives the page');
    await frame.click('.cf-topbar nav a:has-text("Résumé")');
    await page.waitForFunction(() => window.__navigations.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__navigations[0]), { tool: 'career-hunter--career-resume-studio', query: '' });
    assert.match(page.url(), /screen=career-hunter--career-resume-studio/);
    frame = await career(page); await ready(frame);
    assert.deepEqual(await texts(frame, '.cf-topbar nav a'), ['Home', 'Find jobs', 'My jobs', 'Applications', 'Résumé*', 'Profile & contacts']);
    assert.equal(await shown(page, '.header-bar'), false, 'still Career\'s window on the next screen');
    await page.evaluate(() => postMessage({ type: 'app-navigate', tool: 'portrait-studio--portrait-studio' }, location.origin));
    await page.waitForFunction(() => document.querySelector('.tool-view-container > iframe')?.getAttribute('src') === '/api/portrait-studio/app');
    for (const selector of ['.header-bar', '#ribbonContainer', '.status-bar', '.tool-view-header']) assert.equal(await shown(page, selector), true, selector + ' is back for another application\'s page');
  } finally { await context.close(); }
});

test('another application\'s screen opens under Career\'s bar, and only one the person\'s profile lists', async () => {
  const { page, context } = await open('/cockpit/?app=intelligent-career&screen=career-hunter--career-profile-studio');
  try {
    await page.waitForFunction(() => window.__items);
    let frame = await career(page); await ready(frame);
    await frame.click('.cf-subnav a:has-text("Portrait Studio")');
    await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some((f) => f.contentWindow.location.search === '?open=portrait-studio'));
    frame = await career(page); await ready(frame);
    await frame.waitForFunction(() => document.body.dataset.mode === 'host');
    assert.equal(await frame.getAttribute('#host', 'src'), '/api/portrait-studio/app');
    assert.deepEqual(await texts(frame, '.cf-subnav a'), ['Profile Studio', 'Portrait Studio*', 'Recruiters']);
    assert.equal(await shown(page, '.header-bar'), false, 'Career keeps the window while it hosts the screen');
    assert.equal(await page.evaluate(() => window.__navigations.length), 0, 'the cockpit is not asked to show a page with no bar');
  } finally { await context.close(); }
  const plain = await open('/api/career-hunter/home?open=settings');
  try {
    await plain.page.waitForURL(ORIGIN + '/api/career-hunter/home');
    const unknown = await open('/api/career-hunter/home?open=elsewhere');
    try { await unknown.page.waitForURL(ORIGIN + '/api/career-hunter/home'); } finally { await unknown.context.close(); }
  } finally { await plain.context.close(); }
});

test('a Career page hosted by anything else is left as it was', async () => {
  const { page, context } = await open('/other-host');
  try {
    const frame = await career(page);
    await frame.waitForLoadState('load');
    assert.equal(await frame.locator('.cf-topbar').count(), 0);
    assert.equal(await frame.getAttribute('html', 'data-career-frame'), null);
    assert.notEqual(await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim()), '#0f5f73');
    assert.equal(await page.locator('#career-frame-host-style').count(), 0);
  } finally { await context.close(); }
});

test('Career\'s own profile is used when the cockpit has Career open, or when the person cannot open the front door', async () => {
  const own = await open('/cockpit/?app=career-hunter');
  try {
    await own.page.waitForFunction(() => window.__items);
    const frame = await career(own.page); await ready(frame);
    await frame.click('.cf-topbar nav a:has-text("Find jobs")');
    await own.page.waitForFunction(() => window.__navigations.length === 1);
    assert.equal(await own.page.evaluate(() => window.__navigations[0].tool), 'career-search', 'the open application\'s own tool names');
  } finally { await own.context.close(); }
  state.group = false;
  try {
    const { page, context } = await open('/api/career-hunter/search-ui');
    try {
      await ready(page);
      await page.click('.cf-more-desk > summary');
      assert.ok((await texts(page, '.cf-more-desk .cf-menu a')).includes('Career Settings'));
      assert.deepEqual(await texts(page, '.cf-topbar nav a'), ['Home', 'Find jobs*', 'My jobs', 'Applications', 'Résumé', 'Profile & contacts']);
    } finally { await context.close(); }
  } finally { state.group = true; }
});

test('on a phone: one 56px top bar, a bottom bar of Home, Find jobs, My jobs, Applications and More, and nothing wider than the screen', async () => {
  const { page, context } = await open('/api/career-hunter/board-native', { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  try {
    await ready(page);
    assert.equal((await page.locator('.cf-topbar').boundingBox()).height, 56);
    assert.equal(await page.locator('.cf-topbar nav').isVisible(), false);
    assert.deepEqual(await texts(page, '.cf-bottombar > a, .cf-bottombar > details > summary'), ['Home', 'Find jobs', 'My jobs*', 'Applications', 'More']);
    for (const box of await page.locator('.cf-bottombar > a, .cf-bottombar > details > summary').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height))) assert.ok(box >= 44);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 412), 'no sideways scroll');
    await page.tap('.cf-bottom-more > summary');
    assert.deepEqual(await texts(page, '.cf-sheet a'), ['Resume Studio', 'Strengthen', 'Profile Studio', 'Portrait Studio', 'Recruiters', hostile, 'Career Settings', '← All applications']);
    const sheet = await page.locator('.cf-sheet').boundingBox();
    assert.ok(sheet.x >= 0 && sheet.x + sheet.width <= 412);
    assert.ok(parseFloat(await page.evaluate(() => getComputedStyle(document.body).paddingBottom)) >= 58, 'the page ends above the bar');
  } finally { await context.close(); }
});

test('a narrow desktop moves the last sections into More and clips no label', async () => {
  const { page, context } = await open('/api/career-hunter/search-ui', { viewport: { width: 900, height: 800 } });
  try {
    await ready(page);
    assert.ok(await page.evaluate(() => { const nav = document.querySelector('.cf-topbar nav'); return nav.scrollWidth <= nav.clientWidth + 1; }));
    const inBar = await texts(page, '.cf-topbar nav a'), spilled = await texts(page, '.cf-more-desk .cf-spill a');
    assert.equal(inBar.length + spilled.length, 6);
    assert.ok(spilled.length >= 1 && inBar[0] === 'Home');
  } finally { await context.close(); }
});

test('Home for a person with no résumé: what Career does, three numbered steps, one filled button, and a search the cockpit can carry', async () => {
  const { page, context } = await open('/cockpit/?app=intelligent-career');
  try {
    await page.waitForFunction(() => window.__items);
    const frame = await career(page); await ready(frame);
    await frame.waitForSelector('#todayPanel[aria-busy="false"]');
    assert.match(await frame.textContent('#greeting'), /^Good (morning|afternoon|evening), Ada\.$/);
    assert.equal(await frame.textContent('#todayTitle'), 'Start here');
    assert.equal(await frame.locator('#purpose').isVisible(), true);
    assert.deepEqual(await frame.locator('#today .step').evaluateAll((nodes) => nodes.map((n) => n.querySelector('.mark').textContent + ' ' + n.querySelector('strong').textContent + ' | ' + n.querySelector('a').textContent)),
      ['1 Add your résumé | Add your résumé', '2 Say what you want | Set it', '3 See your matches | Search jobs now']);
    assert.deepEqual(await frame.locator('main .primary').allTextContents(), ['Add your résumé'], 'one filled button on the page');
    assert.deepEqual(await frame.locator('.stage').evaluateAll((nodes) => nodes.map((n) => n.querySelector('span').textContent + ' ' + n.querySelector('b').textContent)),
      ['New matches →', 'Saved 7', 'To approve 0', 'Getting ready 0', 'Applied 2', 'Interviewing 0'], 'their saved jobs still show where they stand');
    await frame.waitForSelector('.job');
    assert.deepEqual(await frame.locator('.job h3').allTextContents(), [hostile, 'Program Manager']);
    assert.deepEqual(await frame.locator('.job .tag').allTextContents(), ['$91K–$158K', 'Interview reply'], 'the newest reply from the inbox shows on its job');
    assert.equal(await frame.locator('.job').first().getAttribute('data-query'), 'application=1', 'a job opens that job');
    assert.equal(await frame.evaluate(() => window.__injected), undefined, 'a job title is text');
    assert.equal(await frame.textContent('#resumeHead'), 'No résumé yet');
    assert.deepEqual(await frame.locator('#explore .tile strong').allTextContents(), ['Search Jobs', 'Job Board', hostile, 'Strengthen', 'Resume Studio', 'Profile Studio', 'Portrait Studio', 'Recruiters', 'Submission activity', 'Career Settings']);
    await frame.fill('#q', 'program manager (remote)');
    await frame.click('#find button');
    await page.waitForFunction(() => window.__navigations.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__navigations[0]), { tool: 'career-hunter--career-search', query: 'q=program%20manager%20%28remote%29' });
  } finally { await context.close(); }
});

test('Home for a person with a résumé is their day, in order, with one button each and the first one filled', async () => {
  state.resume = true;
  try {
    const { page, context } = await open('/api/career-hunter/home', { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    try {
      await ready(page);
      await page.waitForSelector('#todayPanel[aria-busy="false"]');
      assert.equal(await page.textContent('#todayTitle'), 'Today');
      assert.equal(await page.locator('#purpose').isVisible(), false);
      assert.deepEqual(await page.locator('#today .step').evaluateAll((nodes) => nodes.map((n) => n.dataset.step + ' | ' + n.querySelector('strong').textContent + ' | ' + n.querySelector('a').textContent)), [
        'replies | 1 reply from employers this week | Open the newest',
        'matches | 5 jobs were scored for you since yesterday | Review them',
        'recruiters | 1 recruiter follow-up is due | Open Recruiters',
        'portrait | Add a professional portrait | Open Portrait Studio',
        'stories | Tell the story of each role | Start',
      ]);
      assert.equal(await page.locator('#today .step').first().locator('li').textContent(), 'Interview reply: ' + hostile);
      assert.equal(await page.evaluate(() => window.__injected), undefined, 'the subject of an email is text');
      assert.deepEqual(await page.locator('main .primary').allTextContents(), ['Open the newest'], 'one filled button on the page');
      assert.equal((await page.textContent('#week')).replace(/\s+/g, ' ').trim(), 'This week:1 application sent1 reply1 interview reply');
      assert.equal(await page.textContent('#resumeLine'), '6 roles read · 412 jobs scored');
      for (const height of await page.locator('#today .step a').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height))) assert.ok(height >= 44);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 412), 'Home fits a phone');
      assert.equal(await page.locator('#today .step a').nth(3).getAttribute('href'), '/api/career-hunter/home?open=portrait-studio', 'another application opens under Career\'s bar');
      await page.tap('#today .step a >> nth=0');
      await page.waitForURL(ORIGIN + '/api/career-hunter/board-native?application=9');
    } finally { await context.close(); }
  } finally { state.resume = false; }
});

test('a quiet day says so, with one way on', async () => {
  state.resume = true; state.quiet = true;
  try {
    const { page, context } = await open('/api/career-hunter/home');
    try {
      await ready(page);
      await page.waitForSelector('#todayPanel[aria-busy="false"]');
      assert.equal(await page.locator('#today .step').count(), 0);
      assert.match(await page.textContent('#calm'), /Nothing needs you right now/);
      assert.equal(await page.locator('#calm a').textContent(), 'Search jobs');
    } finally { await context.close(); }
  } finally { state.resume = false; state.quiet = false; }
});
