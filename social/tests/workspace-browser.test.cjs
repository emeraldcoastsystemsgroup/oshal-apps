/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (social--social-signals MERGE + HIDE, social--social-workspace FIX-LAYOUT): the Workspace in Chromium over a loopback fixture of its routes, no network, accounts or credentials. The Signals tile is off the social menu and every suite, its address leads to Workspace · Engage, and Organize with AI there is one action, disabled with "No signals yet" until there are signals; Engage leads with the scan switch and never says "ingest" or "cron"; a signal's note opens in the composer with Save, Copy and Publish. On a phone a bottom bar Feed · Engage · Saved · Compose keeps Compose one tap away and "tap to comment" opens it with the article attached; the X tab chooses the format before X is linked and only Publish waits ("Connect X to publish"); touch targets are at least 44x44; a saved draft opens from its ⋯ menu; the selected tab's ink reaches 4.5:1 on the Graphite accent. No post is ever published.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | UX audit batch-7 (social--social-composer MERGE): /api/social/composer opens Workspace's Compose (/api/social/workspace?view=compose) with Composer's refine chips (Punchier, Shorter, More technical, Add CTA, End with a question) and free Refine prompt; the social-composer tile moves below social-workspace with label Compose so business-experience keeps resolving it.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.7.0: Compose and Workspace are one application. The fixture answers /api/social/composer the way the route does (302 to /api/social/workspace with view=compose and every query parameter kept); the menu carries one Workspace tile and no Composer tile; a prepare-post link with title, notes and sourceUrl opens Compose prefilled.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.join(__dirname, '..');
const STORE = path.join(PKG, '..');
const TOOLCHAIN = process.env.STORE_CI_TOOLCHAIN || path.join(STORE, 'scripts', 'toolchain', 'node_modules');
const { chromium } = require(path.join(TOOLCHAIN, 'playwright'));

const CARD = { title: 'Agents in production', whyItMatters: 'Teams ship agent loops now.', source: 'Example News', date: '2026-11-05', url: 'https://news.example.test/agents' };
const SIGNAL = { action: 'Congratulate', person: 'Dana Lee', summary: 'Dana started a new job at Example Co', network: 'linkedin', type: 'new-job' };

/** The Workspace's routes with a request log; POST /api/social/post answers 500 so a publish would fail the run. */
function fixture() {
  const state = { scan: false, signals: [SIGNAL], drafts: [{ topic: 'Launch note', draft: 'We shipped the desk today.', created_at: '2026-11-05T10:00:00Z' }], requests: [] };
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const page = (res, file) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fs.readFileSync(path.join(PKG, 'tools', file))); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let raw = ''; for await (const chunk of req) raw += chunk;
    state.requests.push({ method: req.method, path: url.pathname, body: raw ? JSON.parse(raw) : null });
    const p = url.pathname;
    if (p === '/api/social/workspace') return page(res, 'social-workspace.html');
    if (p === '/api/social/composer') { const q = new URLSearchParams(url.search); if (!q.get('view')) q.set('view', 'compose'); res.writeHead(302, { location: '/api/social/workspace?' + q.toString() }); return res.end(); }
    if (p === '/api/social/signals/ui') return page(res, 'social-signals.html');
    if (p.startsWith('/shared/ui/')) { res.writeHead(200, { 'content-type': p.endsWith('.css') ? 'text/css' : 'text/javascript' }); return res.end(''); }
    if (p === '/api/social/profiles') return send(res, 200, { profiles: { linkedin: { name: 'Alice Rivers' } } });
    if (p === '/api/social/content/focus') return send(res, 200, { focus: 'agents' });
    if (p === '/api/social/content/topics') return send(res, 200, { cards: [CARD] });
    if (p === '/api/social/content/settings') { if (req.method === 'POST') state.scan = JSON.parse(raw).emailSocialScan === true; return send(res, 200, { emailSocialScan: state.scan }); }
    if (p === '/api/social/content/signals') return send(res, 200, state.scan ? { enabled: true, signals: state.signals, scanned: state.signals.length } : { enabled: false, signals: [] });
    if (p === '/api/social/content/note') return send(res, 200, { note: 'Congratulations on the new role, Dana!' });
    if (p === '/api/social/content/drafts') return send(res, 200, { drafts: state.drafts });
    if (p === '/api/social/signals/organize') return send(res, 200, { organized: 'LinkedIn: Dana Lee started a new job. Reply today.', count: 1 });
    if (p === '/api/social/post') return send(res, 500, { error: 'the test never publishes' });
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, origin: `http://127.0.0.1:${server.address().port}` })));
}

async function open(t, viewport, address = '/api/social/workspace', touch = false) {
  const fx = await fixture();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await new Promise((r) => fx.server.close(r)); });
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: fx.origin });
  const p = await context.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(fx.origin + address);
  return { p, fx, errors };
}

const published = (fx) => fx.state.requests.filter((r) => r.path === '/api/social/post');

test('the Signals and Composer tiles are off the social menu and every suite; Workspace is the one compose tile', () => {
  const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  assert.doesNotMatch(manifest, /toolName: social-signals/);
  assert.doesNotMatch(manifest, /toolName: social-composer/, 'no second Composer tile');
  const icons = [...manifest.matchAll(/toolName: social-workspace\n\s+label: ([^\n]+)\n\s+icon: ([^\n]+)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(icons, [['Workspace', 'codicon codicon-layout']], 'one Workspace tile with its own icon');
  for (const suite of ['workspace', 'marketing-suite', 'intelligent-career']) {
    const yaml = fs.readFileSync(path.join(STORE, suite, 'oshal-app.yaml'), 'utf8');
    assert.doesNotMatch(yaml, /(surface|fix): social-signals\b/, `${suite} no longer mounts or links the Signals tile`);
    assert.match(yaml, /readiness: signals,\s+fix: social-workspace \}/, `${suite}'s signals step opens the Workspace`);
  }
});

test("the Signals address leads to Workspace · Engage, which leads with the scan switch; Organize with AI waits for signals", async (t) => {
  const { p, fx, errors } = await open(t, { width: 1280, height: 860 }, '/api/social/signals/ui');
  await p.waitForURL(/\/api\/social\/workspace\?view=engage$/);
  const engage = p.locator('#engageView');
  await engage.waitFor();
  assert.equal(await p.locator('#tabEngage').getAttribute('class'), 'tab sel');
  const organize = p.getByRole('button', { name: /Organize with AI/ });
  assert.equal(await organize.isDisabled(), true);
  await p.locator('#organizeWhy').getByText('No signals yet').waitFor();
  const firstText = (await engage.innerText()).trim().split('\n')[0];
  assert.match(firstText, /Scan my email for social updates/, 'the switch leads');
  assert.doesNotMatch(await engage.innerText(), /ingest|cron/i);
  await p.getByLabel(/Scan my email for social updates/).check();
  await p.getByText('Dana started a new job at Example Co').waitFor();
  assert.equal(await organize.isDisabled(), false);
  await organize.click();
  await p.locator('#organized').getByText(/Dana Lee started a new job/).waitFor();
  await p.getByRole('button', { name: /Draft a note/ }).click();
  await p.waitForFunction(() => document.getElementById('text').value.includes('Congratulations'));
  for (const name of [/💾 Save/, /^Copy$/, /Publish to LinkedIn/]) assert.ok(await p.getByRole('button', { name }).isVisible(), `${name} beside the draft`);
  assert.equal(await p.locator('textarea').count(), 1, 'one composer, no second bare draft box');
  assert.deepEqual(published(fx), []);
  assert.deepEqual(errors, []);
});

test('phone: a bottom bar keeps Compose one tap away; tap to comment opens it with the article; X drafts before it is linked', async (t) => {
  const { p, fx, errors } = await open(t, { width: 412, height: 915 }, '/api/social/workspace', true);
  const bar = p.getByRole('navigation', { name: 'Workspace views' });
  assert.deepEqual((await bar.getByRole('button').allInnerTexts()).map((x) => x.replace(/\W+/g, ' ').trim()), ['Feed', 'Engage', 'Saved', 'Compose']);
  const box = await bar.boundingBox();
  assert.ok(box.y + box.height >= 914 && box.width >= 412, 'the bar sits along the bottom');
  await p.getByText('Agents in production').waitFor();
  assert.equal(await p.locator('#text').isVisible(), false, 'the composer is its own view on a phone');
  const sizes = await p.evaluate(() => ['.acct a', '.art .meta a', '.art .dismiss'].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, Math.round(r.width), Math.round(r.height)]; }));
  for (const [s, w, h] of sizes) assert.ok(w >= 44 && h >= 44, `${s} is ${w}x${h}`);
  await p.locator('.art').getByText('tap to comment').tap();
  await p.locator('#artctx').getByText('Agents in production').waitFor();
  assert.equal(await p.locator('#topic').isVisible(), true, 'Compose opened with the article attached');
  await p.getByRole('button', { name: /𝕏 X/ }).tap();
  assert.equal(await p.getByRole('button', { name: /𝕏 X/ }).getAttribute('aria-pressed'), 'true', 'the X tab is chosen though X is not linked');
  await p.locator('#text').fill('A short take.');
  assert.match(await p.locator('#count').innerText(), /\/ 280$/);
  assert.equal(await p.getByRole('button', { name: /Publish to X/ }).isDisabled(), true);
  await p.locator('#pubHelp').getByText('Connect X to publish').waitFor();
  await bar.getByRole('button', { name: /Engage/ }).tap();
  assert.equal(await p.locator('#engageView').isVisible(), true);
  await bar.getByRole('button', { name: /Compose/ }).tap();
  assert.equal(await p.inputValue('#text'), 'A short take.', 'one tap back to the same draft');
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no sideways scroll');
  assert.deepEqual(published(fx), []);
  assert.deepEqual(errors, []);
});

test("a saved draft opens from its ⋯ menu into Compose", async (t) => {
  const { p, errors } = await open(t, { width: 1280, height: 860 }, '/api/social/workspace?view=saved');
  await p.getByRole('button', { name: 'More for Launch note' }).click();
  const menu = p.locator('#rowMenu');
  assert.deepEqual(await menu.getByRole('menuitem').allInnerTexts(), ['Open', 'Copy']);
  await menu.getByRole('menuitem', { name: 'Open' }).click();
  assert.equal(await p.inputValue('#text'), 'We shipped the desk today.');
  assert.deepEqual(errors, []);
});

test('the selected tab and Draft labels reach 4.5:1 on the Graphite accent', async (t) => {
  const { p, errors } = await open(t, { width: 1280, height: 860 });
  await p.addStyleTag({ content: ':root{--accent-primary:#c0cad8;--text-on-accent:#111827;--bg-primary:#0f1115;--text-primary:#e5e7eb}' });
  const ratio = await p.evaluate(() => {
    const lum = (c) => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map((v) => { v = Number(v) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    return ['.tab.sel', '#draftBtn'].map((s) => { const cs = getComputedStyle(document.querySelector(s)); const a = lum(cs.color), b = lum(cs.backgroundColor); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); });
  });
  for (const r of ratio) assert.ok(r >= 4.5, `contrast ${r.toFixed(2)}`);
  assert.deepEqual(errors, []);
});

test("the Composer address opens Workspace's Compose on a phone with all refine chips and the free prompt", async (t) => {
  const { p, errors } = await open(t, { width: 412, height: 915 }, '/api/social/composer', true);
  await p.waitForURL(/\/api\/social\/workspace\?view=compose$/);
  assert.equal(await p.locator('#text').isVisible(), true);
  assert.equal(await p.locator('#wbar button[data-go="compose"]').getAttribute('aria-current'), 'page');
  await open(t, { width: 1280, height: 860 }, '/api/social/workspace?view=saved').then(async ({ p: desk, errors: deskErrs }) => {
    await desk.getByRole('button', { name: 'More for Launch note' }).click();
    await desk.locator('#rowMenu').getByRole('menuitem', { name: 'Open' }).click();
    const chipText = (await desk.locator('#chips .chip').allInnerTexts()).join(' | ');
    for (const label of ['Punchier', 'Shorter', 'More technical', 'Add CTA', 'End with a question']) {
      assert.match(chipText, new RegExp(label));
    }
    assert.equal(await desk.locator('#refineInput').isVisible(), true);
    assert.deepEqual(deskErrs, []);
  });
  assert.deepEqual(errors, []);
});

test('a prepare-post link to the old Composer address opens Workspace Compose prefilled with title, notes and source', async (t) => {
  const q = new URLSearchParams({ title: 'Launch day', notes: 'We shipped the desk.', sourceUrl: 'https://news.example.test/desk' });
  const { p, fx, errors } = await open(t, { width: 1440, height: 900 }, '/api/social/composer?' + q.toString());
  await p.waitForURL(/\/api\/social\/workspace\?title=Launch\+day&notes=We\+shipped\+the\+desk\.&sourceUrl=[^&]+&view=compose$/);
  await p.waitForFunction(() => document.getElementById('text').value.length > 0);
  assert.equal(await p.inputValue('#text'), 'Launch day\n\nWe shipped the desk.\n\nSource: https://news.example.test/desk');
  assert.equal(await p.locator('#text').isVisible(), true);
  assert.equal(await p.locator('#refineInput').isVisible(), true, 'the draft can be refined in place');
  assert.equal(await p.locator('textarea').count(), 1, 'one composer');
  assert.deepEqual(published(fx), []);
  assert.deepEqual(errors, []);
});
