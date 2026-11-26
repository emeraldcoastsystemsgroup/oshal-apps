/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 0.7.2 (NAV-02): headless Chromium browser test verifying Switchboard phone (412x915) single-row horizontal scrollable navigation strips (distinctTopRows === 1, >=44px touch targets, single-line labels, scrollWidth <= 412, active item reveal) and desktop (1440x900) cleanliness across Today, Inbox, Calendar, Compose, Streams, and Workspaces.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const STORE_ROOT = path.resolve(PKG_ROOT, '..');
const TOOLS_DIR = path.join(PKG_ROOT, 'tools');

const TOOLCHAIN_DIR = [
  process.env.STORE_CI_TOOLCHAIN,
  process.env.STORE_CI_TOOLCHAIN && path.join(process.env.STORE_CI_TOOLCHAIN, 'node_modules'),
  path.join(STORE_ROOT, 'scripts', 'toolchain', 'node_modules'),
].filter(Boolean).find((dir) => fs.existsSync(path.join(dir, 'playwright', 'package.json')));

if (!TOOLCHAIN_DIR) {
  throw new Error('playwright requires scripts/toolchain/node_modules or STORE_CI_TOOLCHAIN');
}
const { chromium } = createRequire(import.meta.url)(path.join(TOOLCHAIN_DIR, 'playwright'));

const SHARED_UI = [
  process.env.OSHAL_PLATFORM_ROOT && path.join(process.env.OSHAL_PLATFORM_ROOT, 'src', 'shared', 'ui'),
  path.resolve(STORE_ROOT, '..', 'oshal-kernel', 'platform', 'src', 'shared', 'ui'),
].filter(Boolean).find((dir) => fs.existsSync(dir)) || '';

const SURFACE_MAP = {
  '/api/switchboard/today': 'switchboard-today.html',
  '/api/switchboard/inbox': 'switchboard-inbox.html',
  '/api/switchboard/calendar': 'switchboard-calendar.html',
  '/api/switchboard/compose': 'switchboard-compose.html',
  '/api/switchboard/streams': 'switchboard-streams.html',
  '/api/switchboard/organize': 'switchboard-workspaces.html',
};

const FIXTURES = {
  workspaces: [
    { workspaceId: 'w1', name: 'Emerald Coast', color: 'emerald', accounts: ['c1', 'c2'] },
    { workspaceId: 'w2', name: 'Client Desk', color: 'indigo', accounts: ['c1'] },
    { workspaceId: 'w3', name: 'Personal Presence', color: 'brass', accounts: ['c2'] },
    { workspaceId: 'w4', name: 'Open Source', color: 'teal', accounts: [] },
    { workspaceId: 'w5', name: 'Advisory Board', color: 'coral', accounts: [] },
  ],
  accounts: [
    { connectionId: 'c1', provider: 'google', label: 'alex@emerald.co' },
    { connectionId: 'c2', provider: 'outlook', label: 'alex@client.io' },
    { connectionId: 'c3', provider: 'slack', label: '#eng-ops' },
    { connectionId: 'c4', provider: 'twitter', label: '@alex' },
  ],
  targets: [
    { platform: 'x', label: 'X', limit: 280, publishable: true, connected: true, inWorkspace: true },
    { platform: 'linkedin', label: 'LinkedIn', limit: 3000, publishable: false, connected: true, inWorkspace: true },
    { platform: 'facebook', label: 'Facebook', limit: 63206, publishable: false, connected: true, inWorkspace: true },
    { platform: 'instagram', label: 'Instagram', limit: 2200, publishable: false, connected: true, inWorkspace: true },
    { platform: 'threads', label: 'Threads', limit: 500, publishable: false, connected: true, inWorkspace: true },
  ],
};

function fixturePayload(pathname) {
  const now = new Date().toISOString();
  if (pathname === '/api/switchboard/workspaces') return { workspaces: FIXTURES.workspaces };
  if (pathname === '/api/switchboard/accounts') return { accounts: FIXTURES.accounts };
  if (pathname === '/api/switchboard/feed') {
    return {
      connected: true, firstName: 'Alex', counts: { needsReply: 1, meetings: 1, handled: 2 },
      items: [{ group: 'now', source: 'gmail', kind: 'mail', person: 'Dana', subject: 'Update', snippet: 'Ready', ts: now, hot: true }],
    };
  }
  if (pathname === '/api/switchboard/inbox/items') {
    return {
      connected: true,
      counts: { byChannel: { gmail: 2, outlook: 1, slack: 3, social: 2 }, needsReply: 1 },
      items: [{ id: 'm1', source: 'gmail', kind: 'mail', person: 'Dana', subject: 'Update', snippet: 'Ready', ts: now }],
    };
  }
  if (pathname === '/api/switchboard/threads/items') {
    return {
      connected: true,
      threads: [{ key: 'addr:dana@acme.com', person: 'Dana', address: 'dana@acme.com', channels: ['gmail'], count: 1, lastTs: now, items: [{ id: 'm1', source: 'gmail', kind: 'mail', subject: 'Update', snippet: 'Ready', ts: now }] }],
    };
  }
  if (pathname === '/api/switchboard/compose/targets') return { workspaceScoped: false, targets: FIXTURES.targets };
  if (pathname === '/api/switchboard/streams/posts') {
    return { posts: [], counts: { all: 0, draft: 0, in_review: 0, approved: 0, scheduled: 0, published: 0, rejected: 0, failed: 0, archived: 0 } };
  }
  if (pathname === '/api/switchboard/calendar/posts') return { posts: [] };
  return {};
}

function serveSharedUi(res, pathname) {
  if (!SHARED_UI) { res.writeHead(204); res.end(); return; }
  const rel = pathname.slice('/shared/ui/'.length);
  const full = path.resolve(SHARED_UI, rel);
  if (!full.startsWith(SHARED_UI) || !fs.existsSync(full)) { res.writeHead(204); res.end(); return; }
  const type = full.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8';
  res.writeHead(200, { 'content-type': type });
  res.end(fs.readFileSync(full));
}

function createFixtureServer() {
  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');
    if (pathname === '/framed-today') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body style="margin:0"><iframe id="f" src="/api/switchboard/today" style="width:412px;height:915px;border:0"></iframe></body></html>');
      return;
    }
    if (pathname.startsWith('/shared/ui/')) { serveSharedUi(res, pathname); return; }
    if (SURFACE_MAP[pathname]) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(TOOLS_DIR, SURFACE_MAP[pathname])));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(fixturePayload(pathname)));
  });
}

async function measureNavStrips(target, selectors) {
  return target.evaluate((sels) => {
    const strips = [];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden || rect.width === 0 || rect.height === 0) continue;
        const items = [...el.querySelectorAll(':scope > a, :scope > button, :scope > .wspill, :scope > .plat, :scope > .nav')].filter((c) => {
          const r = c.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        const rows = [];
        for (const item of items) {
          const top = Math.round(item.getBoundingClientRect().top);
          if (!rows.some((r) => Math.abs(r - top) <= 2)) rows.push(top);
        }
        const itemMetrics = items.map((c) => {
          const r = c.getBoundingClientRect();
          const ccs = getComputedStyle(c);
          const lh = parseFloat(ccs.lineHeight) || 18;
          return {
            text: (c.textContent || '').trim(),
            height: Math.round(r.height),
            whiteSpace: ccs.whiteSpace,
            wrappedLines: r.height > Math.max(58, lh * 2.6),
            active: c.classList.contains('on') || c.getAttribute('aria-current') === 'page',
            left: Math.round(r.left),
            right: Math.round(r.right),
          };
        });
        strips.push({
          selector: sel,
          id: el.id || '',
          itemCount: items.length,
          distinctTopRows: rows.length,
          overflowX: cs.overflowX,
          flexWrap: cs.flexWrap,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          stripLeft: Math.round(rect.left),
          stripRight: Math.round(rect.right),
          items: itemMetrics,
        });
      }
    }
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      strips,
    };
  }, selectors);
}

function assertSingleRowStrip(strip, label, expectScrollable) {
  assert.ok(strip.itemCount > 0, `${label}: strip has visible items`);
  assert.equal(strip.distinctTopRows, 1, `${label}: expected 1 row, got ${strip.distinctTopRows}`);
  assert.equal(strip.flexWrap, 'nowrap', `${label}: expected flex-wrap nowrap`);
  for (const item of strip.items) {
    assert.ok(item.height >= 44, `${label} item "${item.text}" height ${item.height} < 44`);
    assert.equal(item.wrappedLines, false, `${label} item "${item.text}" wrapped onto multiple lines (h=${item.height})`);
  }
  const active = strip.items.find((i) => i.active);
  if (active) {
    assert.ok(active.left >= strip.stripLeft - 2 && active.right <= strip.stripRight + 2,
      `${label}: active item "${active.text}" [${active.left}, ${active.right}] outside strip [${strip.stripLeft}, ${strip.stripRight}]`);
  }
  if (expectScrollable) {
    assert.ok(['auto', 'scroll'].includes(strip.overflowX), `${label}: expected overflow-x auto/scroll, got ${strip.overflowX}`);
    assert.ok(strip.scrollWidth > strip.clientWidth, `${label}: expected horizontal scrollWidth (${strip.scrollWidth}) > clientWidth (${strip.clientWidth})`);
  }
}

test('Switchboard phone (412x915) nav strips stay single-row with 44px targets and zero page overflow', { timeout: 60000 }, async (t) => {
  const server = createFixtureServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  t.after(() => ctx.close());

  const checks = [
    { name: 'Today', route: '/api/switchboard/today', strips: ['#sbTopnav', '#wsbar'], scrollable: ['#sbTopnav', '#wsbar'] },
    { name: 'Inbox (Messages)', route: '/api/switchboard/inbox', strips: ['#channels', '#workspaces', '#groupBar'], scrollable: ['#channels', '#workspaces'] },
    { name: 'Inbox (By person)', route: '/api/switchboard/inbox?group=person', strips: ['#workspaces', '#groupBar'], scrollable: ['#workspaces'] },
    { name: 'Calendar', route: '/api/switchboard/calendar', strips: ['.controls', '.nav'], scrollable: ['.controls'] },
    { name: 'Compose', route: '/api/switchboard/compose', strips: ['#plats'], scrollable: ['#plats'] },
    { name: 'Streams', route: '/api/switchboard/streams', strips: ['#snav'], scrollable: ['#snav'] },
    { name: 'Workspaces', route: '/api/switchboard/organize', strips: [], scrollable: [] },
  ];

  for (const spec of checks) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base + spec.route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(200);
    const report = await measureNavStrips(page, spec.strips);
    assert.equal(errors.length, 0, `${spec.name}: pageErrors ${errors.join('; ')}`);
    assert.ok(report.docScrollWidth <= 412, `${spec.name}: scrollWidth ${report.docScrollWidth} > 412`);
    assert.equal(report.strips.length, spec.strips.length, `${spec.name}: expected ${spec.strips.length} visible strips, got ${report.strips.length}`);
    for (const strip of report.strips) {
      assertSingleRowStrip(strip, `${spec.name} ${strip.selector}`, spec.scrollable.includes(strip.selector));
    }
    await page.close();
  }
});

test('Switchboard Today hides #sbTopnav when framed while keeping #wsbar single-row, and desktop 1440x900 renders cleanly', { timeout: 60000 }, async (t) => {
  const server = createFixtureServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  const phoneCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  t.after(() => phoneCtx.close());
  const framedPage = await phoneCtx.newPage();
  await framedPage.goto(base + '/framed-today', { waitUntil: 'networkidle' });
  await framedPage.waitForTimeout(250);
  const frame = framedPage.frame({ url: /\/api\/switchboard\/today/ });
  assert.ok(frame, 'framed Today iframe loaded');
  const framedReport = await measureNavStrips(frame, ['#sbTopnav', '#wsbar']);
  assert.ok(framedReport.docScrollWidth <= 412, `framed Today scrollWidth ${framedReport.docScrollWidth} > 412`);
  assert.equal(framedReport.strips.length, 1, 'framed Today hides #sbTopnav and shows #wsbar');
  assert.equal(framedReport.strips[0].id, 'wsbar');
  assertSingleRowStrip(framedReport.strips[0], 'framed Today #wsbar', true);

  const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  t.after(() => deskCtx.close());
  for (const route of Object.keys(SURFACE_MAP)) {
    const page = await deskCtx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(150);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.equal(errors.length, 0, `desktop ${route}: pageErrors ${errors.join('; ')}`);
    assert.ok(sw <= 1440, `desktop ${route}: scrollWidth ${sw} > 1440`);
    await page.close();
  }
});
