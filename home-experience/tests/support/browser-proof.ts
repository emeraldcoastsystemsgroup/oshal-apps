/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Render owned package assets over isolated member APIs and verify persistence, role views, drafts and responsive keyboard operation.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Exercise owned ticket attention through the actual shared renderer, safe links, source states, retry drafts and other-page/frame compatibility with verified owned browser cleanup.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Verify absent and invalid time metadata without trailing separators and preserve prior evidence with unique post-polish capture names.
 */
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

const packageName = process.env.OSHAL_EXPERIENCE_PROOF_PACKAGE!;
assert.match(packageName, /^(home|business|classroom|studio|jarvis|orbit|commons)-experience$/);
assert.ok(process.env.OSHAL_FRAMEWORK, 'Explicit core source checkout is required');
const framework = resolve(process.env.OSHAL_FRAMEWORK!);
const captureTag = 'post-polish-' + Date.now() + '-' + process.pid;
const root = resolve(__dirname, '../..');
const coreRequire = createRequire(join(framework, 'package.json'));
const { expect } = coreRequire('@playwright/test');
const yaml = coreRequire('js-yaml');
const manifest = yaml.load(readFileSync(join(root, 'oshal-app.yaml'), 'utf8'));
const previousCwd = process.cwd();
// The existing source fixture resolves static assets once when its module loads.
process.chdir(framework);
const { startExperienceBrowserFixture, installFrontPageHosts } = require(join(framework, 'tests/fixtures/experience-browser.ts'));
const { launchIsolatedBrowser, BROWSER_HOOK_TIMEOUT_MS } = require(join(framework, 'tests/fixtures/isolated-browser.ts'));
process.chdir(previousCwd);
let ownedBrowser: any, browser: any, context: any, page: any, fixture: any;
let errors: string[];
const preset = { 'home-experience':'family','business-experience':'company','classroom-experience':'classroom' }[packageName];
const layout = preset || packageName.replace('-experience','');
before(async () => { ownedBrowser = await launchIsolatedBrowser(); browser = ownedBrowser.browser; }, { timeout: BROWSER_HOOK_TIMEOUT_MS });
after(async () => {
  if (ownedBrowser) { const receipt = await ownedBrowser.close(); assert.equal(receipt.exitVerified, true); console.log('Home source browser cleanup:', JSON.stringify(receipt)); }
}, { timeout: BROWSER_HOOK_TIMEOUT_MS });
beforeEach(async () => {
  fixture = await startExperienceBrowserFixture();
  installFrontPageHosts(fixture.state);
  fixture.state.experiences = [{ app: packageName, label: manifest.displayName, skin: manifest.experience.skin, shell:'page', entry:manifest.experience.entry }];
  const ribbons = fixture.state.assembly.ribbons;
  for (const ref of manifest.experience.surfaces) {
    if (!ribbons[ref.app]) ribbons[ref.app] = [];
    if (!ribbons[ref.app].some((item: any) => item.id === 'tool-'+ref.surface)) ribbons[ref.app].push({id:'tool-'+ref.surface,label:'Synthetic '+ref.surface,icon:'codicon codicon-home',section:'top',toolUi:{iframeUrl:'/fixture/surface/'+ref.surface}});
  }
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion:'reduce' });
  const assets = Object.fromEntries(['index.html','config.js','home-attention.js','homebase.css','styles.css','full-swarm.css',manifest.experience.skin+'.css'].map(file => [file,join(root,'ui',file)]));
  await context.route('**/*', async (route: any) => {
    const url = new URL(route.request().url());
    if (url.origin !== fixture.origin) return route.abort();
    const filename = url.pathname === manifest.experience.entry ? 'index.html'
      : url.pathname.startsWith('/api/'+packageName+'/assets/') ? url.pathname.split('/').pop()
      : url.pathname === '/api/swarm/apps/'+packageName+'/theme.css' ? manifest.experience.skin+'.css' : null;
    if (filename && assets[filename]) return route.fulfill({status:200,contentType:filename.endsWith('.js')?'application/javascript':filename.endsWith('.css')?'text/css':'text/html',body:readFileSync(assets[filename],'utf8')});
    return route.continue();
  });
  await context.addInitScript(() => { Object.defineProperty(window,'speechSynthesis',{value:{speak(){},cancel(){},getVoices(){return[];}},configurable:true}); });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  errors=[]; page.on('pageerror',(error: Error)=>errors.push(error.message));
});
afterEach(async () => { try { await context?.close(); } finally { await fixture?.close(); } }, { timeout: BROWSER_HOOK_TIMEOUT_MS });
async function open() { await page.goto(fixture.origin+manifest.experience.entry); await page.waitForSelector(preset?'.home-shell':layout==='orbit'?'.full-orbit':'#message-input'); await page.waitForLoadState('networkidle'); }

test('owned entry renders without errors at desktop and phone widths, with keyboard controls', async () => {
  await open();
  assert.equal(await page.locator('body').getAttribute('data-layout'), layout);
  assert.deepEqual(errors, []);
  assert.ok(await page.locator('h1').first().innerText());
  const screenshots = join(framework,'temp','experience-package-previews'); mkdirSync(screenshots,{recursive:true});
  await page.screenshot({path:join(screenshots,packageName+'-'+captureTag+'-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth + 1), 'Phone layout must not scroll horizontally');
  if (packageName === 'home-experience') {
    const geometry = await page.locator('.admin-link').first().evaluate((button: HTMLElement) => ({width:button.getBoundingClientRect().width,textWidth:button.children[1].getBoundingClientRect().width,grid:getComputedStyle(button).gridTemplateColumns,children:button.children.length}));
    assert.ok(geometry.textWidth >= 100, 'Household action label must remain readable: '+JSON.stringify(geometry));
  }
  await page.screenshot({path:join(screenshots,packageName+'-'+captureTag+'-phone.png'),fullPage:true});
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(()=>document.activeElement !== document.body), 'Keyboard reaches an interactive control');
  assert.deepEqual(errors, []);
});

if (packageName === 'home-experience') {
  const attentionPanel = () => page.locator('[data-module="home-attention"]');
  const attentionTicket = (id: string, status = 'approval_required', updatedAt: string | null = '2026-10-03T12:00:00.000Z', title = 'Synthetic review') => ({
    ticketId: id, title, status, ticketType: 'ledger-review', updatedAt, description: 'Synthetic attention fixture.',
  });
  const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002';

  test('real attention precedes schedule, recent work and apps with deterministic escaped owner links', async () => {
    const C = '00000000-0000-4000-8000-000000000003', D = '00000000-0000-4000-8000-000000000004';
    const unsafeTitle = '<img src=x onerror="window.unexpectedAttention=true">';
    fixture.state.tickets = [attentionTicket(B), attentionTicket(A, 'customer_action', undefined, unsafeTitle),
      attentionTicket(C, 'review', 'not-a-date'), attentionTicket(D, 'dead_letter', null),
      attentionTicket('moving', 'in_process', '2026-10-04T12:00:00.000Z'), attentionTicket('done', 'complete')];
    await open();
    // The shared Applications section owns a heading, not a data-module marker.
    assert.deepEqual(await page.locator('[data-module="home-attention"] h2, .main-column > [data-module="calendar"] h2, .main-column > [data-module="projects"] h2, .main-column > section > .section-heading > h2').evaluateAll((elements: Element[]) => elements.map(element => element.textContent)), ['Top Items Today', "Today's Schedule", 'Recent work', 'Applications']);
    assert.deepEqual(await attentionPanel().locator('a').evaluateAll((links: HTMLAnchorElement[]) => links.map(link => link.getAttribute('href'))), [A, B, C, D].map(id => '/cockpit/?ticket='+id));
    assert.equal(await attentionPanel().locator('li strong').first().innerText(), unsafeTitle);
    const metadata = await attentionPanel().locator('li small').allTextContents();
    assert.match(metadata[0], /^Synthetic ledger · Needs you · .+/);
    assert.match(metadata[1], /^Synthetic ledger · Approval required · .+/);
    assert.deepEqual(metadata.slice(2), ['Synthetic ledger · Review', 'Synthetic ledger · Blocked']);
    assert.ok(metadata.every((value: string) => !/·\s*$/.test(value)), 'No row ends with a metadata separator');
    assert.equal(await attentionPanel().locator('img').count(), 0);
    assert.match(await attentionPanel().innerText(), /4 tickets/);
    assert.doesNotMatch(await attentionPanel().innerText(), /Synthetic failed task|Working|Ready/);
    const captures = join(framework, 'temp', 'experience-package-previews'); mkdirSync(captures, { recursive: true });
    await attentionPanel().screenshot({ path: join(captures, 'home-attention-'+captureTag+'-desktop.png') });
    await attentionPanel().locator('a').first().focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')), '/cockpit/?ticket='+B);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const geometry = await attentionPanel().locator('a').first().boundingBox();
    assert.ok(geometry && geometry.width > 80 && geometry.height >= 40, 'Ticket action remains readable on a phone');
    await attentionPanel().screenshot({ path: join(captures, 'home-attention-'+captureTag+'-phone.png') });
    assert.deepEqual(errors, []);
  });

  test('six most recently changed attention tickets are bounded and the total remains truthful', async () => {
    fixture.state.tickets = Array.from({ length: 7 }, (_, i) => attentionTicket('00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'), 'review', `2026-10-0${i+1}T12:00:00.000Z`, 'Synthetic review '+(i+1)));
    await open();
    assert.equal(await attentionPanel().locator('li').count(), 6);
    assert.equal(await attentionPanel().locator('li strong').first().innerText(), 'Synthetic review 7');
    assert.match(await attentionPanel().innerText(), /7 tickets/);
    assert.match(await attentionPanel().innerText(), /six most recently changed tickets/);
    assert.deepEqual(errors, []);
  });

  test('a successful readable empty ticket feed is the only genuine empty state', async () => {
    fixture.state.tickets = []; await open();
    assert.equal(await attentionPanel().getAttribute('data-ticket-source-state'), 'ready');
    assert.match(await attentionPanel().innerText(), /0 tickets/);
    assert.match(await attentionPanel().innerText(), /No tickets need your attention right now/);
    assert.equal(await attentionPanel().locator('li').count(), 0);
  });

  for (const status of [503, 403]) test(`ticket HTTP${status} is unavailable even while a companion task loads`, async () => {
    fixture.state.status.tickets = status;
    fixture.state.tasks.push({ ...fixture.state.tasks[0], id: 'loaded-task', title: 'Loaded companion task', status: 'running' });
    await open();
    assert.equal(await attentionPanel().getAttribute('data-ticket-source-state'), 'unavailable');
    assert.doesNotMatch(await attentionPanel().innerText(), /0 tickets|No tickets need your attention/);
    assert.equal(await attentionPanel().locator('li').count(), 0);
    assert.equal(await attentionPanel().getByRole('button', { name: 'Retry work sources', exact: true }).count(), 1);
    assert.match(await page.locator('[data-module="projects"]').innerText(), /Loaded companion task/);
    assert.equal(await page.locator('.home-main > .work-source-status').getAttribute('data-work-source-state'), 'partial');
    assert.deepEqual(errors, []);
  });

  test('unreadable HTTP200 ticket data is unavailable rather than a false empty', async () => {
    await context.route(/\/api\/tickets(?:\?.*)?$/, (route: any) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tickets: {} }) }));
    await open();
    assert.equal(await attentionPanel().getAttribute('data-ticket-source-state'), 'unavailable');
    assert.doesNotMatch(await attentionPanel().innerText(), /0 tickets|No tickets need your attention/);
    assert.equal(await attentionPanel().locator('li').count(), 0);
    assert.deepEqual(errors, []);
  });

  test('readable tickets remain ready when the task companion fails', async () => {
    fixture.state.tickets = [attentionTicket(A)]; fixture.state.status.tasks = 503;
    await open();
    assert.equal(await attentionPanel().getAttribute('data-ticket-source-state'), 'ready');
    assert.match(await attentionPanel().innerText(), /1 ticket/);
    assert.equal(await attentionPanel().locator('a').getAttribute('href'), '/cockpit/?ticket='+A);
    assert.equal(await page.locator('.home-main > .work-source-status').getAttribute('data-work-source-state'), 'partial');
    assert.deepEqual(errors, []);
  });

  test('one missing ticket identity refuses the whole feed without inventing rows or zero', async () => {
    fixture.state.tickets = [attentionTicket(A), { ...attentionTicket(B), ticketId: undefined }];
    await open();
    assert.equal(await attentionPanel().getAttribute('data-ticket-source-state'), 'unavailable');
    assert.equal(await attentionPanel().locator('li').count(), 0);
    assert.doesNotMatch(await attentionPanel().innerText(), /0 tickets|No tickets need your attention|ticket=undefined/);
    assert.deepEqual(errors, []);
  });

  test('altered unsafe owning links qualify partial data while preserving the valid linked ticket', async () => {
    fixture.state.tickets = [attentionTicket(A), attentionTicket(B)]; await open();
    assert.equal(await attentionPanel().getAttribute('data-ticket-source-state'), 'ready');
    assert.equal(await attentionPanel().locator('li').count(), 2);
    const ticketReads = fixture.state.calls.filter((call: string) => call === 'GET /api/tickets').length;
    // Exercise the shipped component's link boundary against an explicitly synthetic
    // altered normalized snapshot. The real feed stays valid; no other origin is read.
    for (const href of ['https://outside.fixture.invalid/ticket', '//outside.fixture.invalid/ticket', '/cockpit/?ticket=foreign']) {
      await page.evaluate(({ id, href }: { id: string; href: string }) => { const row = (window as any).OSHAL_LIVE.snapshot.work.find((item: any) => item.ref === id); row.href = href; }, { id: B, href });
      await page.locator('.room-tabs').getByRole('button', { name: 'Tasks', exact: true }).click();
      await page.locator('.room-tabs').getByRole('button', { name: 'Room', exact: true }).click();
      assert.equal(await attentionPanel().getAttribute('data-ticket-source-state'), 'partial');
      assert.equal(await attentionPanel().locator('li').count(), 1);
      assert.equal(await attentionPanel().locator('a').getAttribute('href'), '/cockpit/?ticket='+A);
      assert.match(await attentionPanel().innerText(), /Some ticket links are unavailable/);
      assert.match(await attentionPanel().innerText(), /1 ticket loaded/);
      assert.doesNotMatch(await attentionPanel().innerText(), /0 tickets|No tickets need your attention/);
    }
    // No usable linked row means unavailable, and cannot turn into an all-clear.
    await page.evaluate(({ id }: { id: string }) => { const row = (window as any).OSHAL_LIVE.snapshot.work.find((item: any) => item.ref === id); row.href = '/cockpit/?ticket=foreign'; }, { id: A });
    await page.locator('.room-tabs').getByRole('button', { name: 'Tasks', exact: true }).click();
    await page.locator('.room-tabs').getByRole('button', { name: 'Room', exact: true }).click();
    assert.equal(await attentionPanel().getAttribute('data-ticket-source-state'), 'unavailable');
    assert.equal(await attentionPanel().locator('a').count(), 0);
    assert.doesNotMatch(await attentionPanel().innerText(), /0 tickets|No tickets need your attention/);
    assert.equal(fixture.state.calls.filter((call: string) => call === 'GET /api/tickets').length, ticketReads);
    assert.deepEqual(errors, []);
  });

  for (const status of [undefined, 'future_ticket_state']) test(`a ${status === undefined ? 'missing' : 'unknown'} ticket state cannot become a false all-clear`, async () => {
    fixture.state.tickets = [{ ...attentionTicket(A), status }];
    fixture.state.tasks.push({ ...fixture.state.tasks[0], id: 'loaded-task', title: 'Loaded companion task', status: 'running' });
    await open();
    assert.equal(await attentionPanel().getAttribute('data-ticket-source-state'), 'unavailable');
    assert.match(await attentionPanel().innerText(), /Some ticket states are unavailable/);
    assert.doesNotMatch(await attentionPanel().innerText(), /0 tickets|No tickets need your attention/);
    assert.equal(await attentionPanel().locator('li').count(), 0);
    assert.match(await page.locator('[data-module="projects"]').innerText(), /Loaded companion task/);
    assert.equal(await page.locator('.home-main > .work-source-status').count(), 0, 'The JSON feed is readable; its ticket status still cannot be classified');
    assert.deepEqual(errors, []);
  });

  test('known attention tickets remain linked when a sibling status is missing or unknown', async () => {
    fixture.state.tickets = [attentionTicket(A), { ...attentionTicket(B), status: undefined }, attentionTicket('unknown-state', 'future_ticket_state')];
    await open();
    assert.equal(await attentionPanel().getAttribute('data-ticket-source-state'), 'partial');
    assert.equal(await attentionPanel().locator('li').count(), 1);
    assert.equal(await attentionPanel().locator('a').getAttribute('href'), '/cockpit/?ticket='+A);
    assert.match(await attentionPanel().innerText(), /1 ticket loaded/);
    assert.match(await attentionPanel().innerText(), /Some ticket states are unavailable/);
    assert.doesNotMatch(await attentionPanel().innerText(), /0 tickets|No tickets need your attention/);
    assert.deepEqual(errors, []);
  });

  test('slow work fills the same owned panel through normal shared repaint', async () => {
    fixture.state.tickets = [attentionTicket(A)];
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    await context.route(/\/api\/tickets(?:\?.*)?$/, async (route: any) => { await held; await route.continue(); });
    try {
      await page.goto(fixture.origin+manifest.experience.entry, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-ticket-source-state="loading"]');
      assert.doesNotMatch(await attentionPanel().innerText(), /0 tickets|No tickets need your attention/);
    } finally { release(); }
    await expect(attentionPanel()).toHaveAttribute('data-ticket-source-state', 'ready');
    assert.equal(await attentionPanel().count(), 1);
    assert.equal(await attentionPanel().locator('a').getAttribute('href'), '/cockpit/?ticket='+A);
    await page.waitForLoadState('networkidle');
    assert.equal(await attentionPanel().count(), 1);
    assert.deepEqual(errors, []);
  });

  test('ticket retry preserves an unsent shell draft, focus and selection without extra requests', async () => {
    fixture.state.status.tickets = 503; await open();
    await page.locator('#composer-input').fill('Unsent question before retry');
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    await context.route('**/api/jarvis/tasks', async (route: any) => { await held; await route.continue(); });
    fixture.state.tickets = [attentionTicket(A)]; fixture.state.status.tickets = 200;
    const initialTicketReads = fixture.state.calls.filter((call: string) => call === 'GET /api/tickets').length;
    try {
      await attentionPanel().getByRole('button', { name: 'Retry work sources', exact: true }).click();
      await page.waitForSelector('[data-ticket-source-state="loading"]');
      assert.equal(await page.locator('#composer-input').inputValue(), 'Unsent question before retry');
      await page.locator('#composer-input').fill('Edited while work is loading');
      await page.locator('#composer-input').evaluate((element: HTMLInputElement) => { element.focus(); element.setSelectionRange(5, 12); });
    } finally { release(); }
    await expect(attentionPanel()).toHaveAttribute('data-ticket-source-state', 'ready');
    assert.equal(await page.locator('#composer-input').inputValue(), 'Edited while work is loading');
    assert.deepEqual(await page.locator('#composer-input').evaluate((element: HTMLInputElement) => ({ focused: document.activeElement === element, start: element.selectionStart, end: element.selectionEnd })), { focused: true, start: 5, end: 12 });
    assert.equal(fixture.state.calls.filter((call: string) => call === 'GET /api/tickets').length, initialTicketReads + 1);
    assert.equal(fixture.state.asks.length, 0);
    assert.deepEqual(errors, []);
  });

  test('saved column choices survive; attention is absent on other pages and returns once', async () => {
    fixture.state.tickets = [attentionTicket(A)]; await open();
    await page.evaluate(() => { (window as any).OSHAL_LIVE.prefs.set('homebase:family', { lead: 'work', hide: ['room', 'calendar'] }); });
    await page.reload(); await page.waitForLoadState('networkidle');
    assert.equal(await attentionPanel().count(), 1);
    assert.equal(await page.locator('.main-column > [data-module]').first().getAttribute('data-module'), 'projects');
    assert.equal(await page.locator('[data-module="room"], [data-module="calendar"]').count(), 0);
    for (const label of ['Tasks', 'Files']) {
      await page.locator('.room-tabs').getByRole('button', { name: label, exact: true }).click();
      assert.equal(await attentionPanel().count(), 0);
    }
    await page.locator('.room-tabs').getByRole('button', { name: 'Room', exact: true }).click();
    assert.equal(await attentionPanel().count(), 1);
    assert.equal(await page.locator('.main-column > [data-module]').first().getAttribute('data-module'), 'projects');
    assert.deepEqual(errors, []);
  });

  test('a late work answer does not replace an open member frame or render the attention panel there', async () => {
    fixture.state.tickets = [attentionTicket(A)];
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    await context.route('**/api/jarvis/tasks', async (route: any) => { await held; await route.continue(); });
    try {
      await page.goto(fixture.origin+manifest.experience.entry, { waitUntil: 'domcontentloaded' });
      await page.locator('.home-sidebar [data-tool="tool-shop-lists"]').click();
      const frame = await page.locator('#tool-frame').elementHandle();
      await expect(page.locator('#tool-frame')).toHaveAttribute('src', /audience=family/);
      assert.equal(await attentionPanel().count(), 0);
      release(); await page.waitForLoadState('networkidle');
      assert.equal(await frame.evaluate((element: Element) => element.isConnected), true);
      assert.equal(await attentionPanel().count(), 0);
      assert.deepEqual(errors, []);
    } finally { release(); }
  });

  test('shopping add and completion persist across reload; explicit hosted screen keeps its audience', async () => {
    await open(); await page.waitForSelector('[data-shopping-item="i1"]');
    await page.fill('#shopping-input','Synthetic eggs'); await page.press('#shopping-input','Enter');
    await page.waitForFunction(()=>document.body.innerText.includes('Synthetic eggs'));
    await page.locator('[data-shopping-item="i1"]').click();
    await page.waitForSelector('.got-it'); assert.deepEqual(fixture.state.purchasing.removed,['i1']);
    await page.reload(); await page.waitForSelector('#shopping-input');
    assert.equal(await page.locator('[data-shopping-item="i1"]').count(),0);
    assert.match(await page.locator('[data-module="shopping"]').innerText(),/Synthetic eggs/);
    await page.locator('.home-sidebar [data-tool="tool-shop-lists"]').click();
    await expect(page.locator('#tool-frame')).toHaveAttribute('src',/audience=family/);
    assert.deepEqual(errors, []);
  });
  test('unavailable optional school profile causes no Education read or profile provisioning', async () => {
    fixture.state.status['lm-home-summary']=403;
    await open();
    assert.ok(!fixture.state.calls.some((call:string)=>/^GET \/api\/education\//.test(call)));
    assert.ok(!fixture.state.calls.some((call:string)=>call.includes('/api/ui/profile?name=little-monsters')));
    assert.deepEqual(errors, []);
  });
} else if (packageName === 'classroom-experience') {
  test('teacher roster follows existing Education role, and learner sees own classwork instead', async () => {
    await open(); await page.waitForSelector('[data-module="teacher-roster"]');
    assert.match(await page.locator('[data-module="teacher-roster"]').innerText(),/Learner One/);
    fixture.state.education.me={...fixture.state.education.me,role:'student'};
    // Profile visibility remains the member's decision; the learner fixture admits no teaching surface.
    fixture.state.assembly.ribbons['little-monsters']=fixture.state.assembly.ribbons['little-monsters'].filter((item:any)=>!['tool-lm-teacher','tool-lm-voice-settings'].includes(item.id));
    await page.reload(); await page.waitForSelector('[data-module="learning"]');
    assert.equal(await page.locator('[data-module="teacher-roster"]').count(),0);
    assert.equal(await page.locator('.home-sidebar [data-tool="tool-lm-teacher"]').count(),0);
    assert.deepEqual(errors, []);
  });
} else if (packageName === 'business-experience') {
  test('business leads with existing member summaries and opens the named company screen', async () => {
    await open();
    assert.match(await page.locator('.main-column').innerText(),/Recent documents/);
    await page.locator('.home-sidebar [data-tool="tool-presentations-studio"]').click();
    await expect(page.locator('#tool-frame')).toHaveAttribute('src',/audience=company/);
    assert.deepEqual(errors, []);
  });
} else {
  test('conversation draft survives reload without submitting; an explicit submit uses existing transport', async () => {
    await open(); if (layout === 'orbit') await page.getByRole('button',{name:'Ask Jarvis',exact:true}).click();
    const input = layout === 'orbit' ? '#ask-input' : '#message-input';
    await page.fill(input,'Synthetic saved draft');
    await page.reload(); await page.waitForSelector(layout==='orbit'?'.full-orbit':'#message-input');
    if (layout === 'orbit') await page.getByRole('button',{name:'Ask Jarvis',exact:true}).click();
    await expect(page.locator(input)).toHaveValue('Synthetic saved draft');
    assert.equal(fixture.state.asks.length,0);
    await page.press(input,'Enter');
    await page.waitForFunction(()=>document.body.innerText.includes('Synthetic answer'));
    assert.equal(fixture.state.asks.length,1);
    assert.equal(fixture.state.asks[0].message,'Synthetic saved draft');
    assert.deepEqual(errors, []);
  });
}
