/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Render owned package assets over isolated member APIs and verify persistence, role views, drafts and responsive keyboard operation.
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
const root = resolve(__dirname, '..', packageName);
const coreRequire = createRequire(join(framework, 'package.json'));
const { chromium, expect } = { ...coreRequire('playwright'), ...coreRequire('@playwright/test') };
const yaml = coreRequire('js-yaml');
const manifest = yaml.load(readFileSync(join(root, 'oshal-app.yaml'), 'utf8'));
const previousCwd = process.cwd();
// The existing source fixture resolves static assets once when its module loads.
process.chdir(framework);
const { startExperienceBrowserFixture, installFrontPageHosts } = require(join(framework, 'tests/fixtures/experience-browser.ts'));
process.chdir(previousCwd);
let browser: any, context: any, page: any, fixture: any;
let errors: string[];
const preset = { 'home-experience':'family','business-experience':'company','classroom-experience':'classroom' }[packageName];
const layout = preset || packageName.replace('-experience','');
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
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
  const assets = Object.fromEntries(['index.html','config.js','homebase.css','styles.css','full-swarm.css',manifest.experience.skin+'.css'].map(file => [file,join(root,'ui',file)]));
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
afterEach(async () => { await context?.close(); await fixture?.close(); });
async function open() { await page.goto(fixture.origin+manifest.experience.entry); await page.waitForSelector(preset?'.home-shell':layout==='orbit'?'.full-orbit':'#message-input'); await page.waitForLoadState('networkidle'); }

test('owned entry renders without errors at desktop and phone widths, with keyboard controls', async () => {
  await open();
  assert.equal(await page.locator('body').getAttribute('data-layout'), layout);
  assert.deepEqual(errors, []);
  assert.ok(await page.locator('h1').first().innerText());
  const screenshots = join(framework,'temp','experience-package-previews'); mkdirSync(screenshots,{recursive:true});
  await page.screenshot({path:join(screenshots,packageName+'-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth + 1), 'Phone layout must not scroll horizontally');
  if (packageName === 'home-experience') {
    const geometry = await page.locator('.admin-link').first().evaluate((button: HTMLElement) => ({width:button.getBoundingClientRect().width,textWidth:button.children[1].getBoundingClientRect().width,grid:getComputedStyle(button).gridTemplateColumns,children:button.children.length}));
    assert.ok(geometry.textWidth >= 100, 'Household action label must remain readable: '+JSON.stringify(geometry));
  }
  await page.screenshot({path:join(screenshots,packageName+'-phone.png'),fullPage:true});
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(()=>document.activeElement !== document.body), 'Keyboard reaches an interactive control');
  assert.deepEqual(errors, []);
});

if (packageName === 'home-experience') {
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
