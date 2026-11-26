/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 1.9.8 (NAV-02): headless Chromium browser guard verifying phone (412x915 and 360x800) single-row horizontal scrollable navigation and tab strips across intelligent-operations experience (standalone and embedded) and ui/index.html, with >=44px nowrap touch targets, <=60px primary nav height, active-item reveal, zero document horizontal overflow, and preserved 1440x900 desktop sidebar layout.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');

const PKG_ROOT = path.resolve(__dirname, '..');
const STORE_ROOT = path.resolve(PKG_ROOT, '..');

function loadPlaywright() {
  const roots = [
    process.env.STORE_CI_TOOLCHAIN && path.join(process.env.STORE_CI_TOOLCHAIN, 'node_modules'),
    process.env.STORE_CI_TOOLCHAIN,
    path.join(STORE_ROOT, 'scripts', 'toolchain', 'node_modules'),
  ].filter(Boolean);
  for (const dir of roots) {
    if (fs.existsSync(path.join(dir, 'playwright', 'package.json'))) {
      return createRequire(__filename)(path.join(dir, 'playwright'));
    }
  }
  throw new Error('playwright requires scripts/toolchain/node_modules or STORE_CI_TOOLCHAIN');
}

const { chromium } = loadPlaywright();

const SHARED_UI = [
  process.env.OSHAL_KERNEL_PLATFORM && path.join(process.env.OSHAL_KERNEL_PLATFORM, 'src', 'shared', 'ui'),
  process.env.OSHAL_PLATFORM_ROOT && path.join(process.env.OSHAL_PLATFORM_ROOT, 'src', 'shared', 'ui'),
  path.resolve(STORE_ROOT, '..', 'oshal-kernel', 'platform', 'src', 'shared', 'ui'),
].find((dir) => dir && fs.existsSync(dir)) || '';

function buildAssetMap() {
  const files = {
    '/api/intelligent-operations/app': path.join(PKG_ROOT, 'experience', 'index.html'),
    '/ui/index.html': path.join(PKG_ROOT, 'ui', 'index.html'),
  };
  for (const name of fs.readdirSync(path.join(PKG_ROOT, 'experience'))) {
    if (/\.(js|css)$/.test(name)) files['/api/intelligent-operations/assets/' + name] = path.join(PKG_ROOT, 'experience', name);
  }
  for (const name of fs.readdirSync(path.join(PKG_ROOT, 'ui'))) {
    if (/\.(js|css|html)$/.test(name)) {
      files['/ui/' + name] = path.join(PKG_ROOT, 'ui', name);
      files['/api/intelligent-operations/assets/' + name] = path.join(PKG_ROOT, 'ui', name);
    }
  }
  return files;
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  return 'application/json';
}

function fixtureJson(pathname) {
  const now = new Date().toISOString();
  if (pathname === '/api/intelligent-operations/records') {
    return { sources: [{ id: 'src-1', name: 'Primary alerts', source: 'urn:ops:lab', environment: 'prod', mapping: {} }], events: [], inventory: [] };
  }
  if (pathname === '/api/intelligent-operations/telemetry') return { streams: [], installations: [], watch: null, enrollments: [] };
  if (pathname === '/api/intelligent-operations/topology') return { assets: [], relationships: [], collections: [], asOf: now };
  if (pathname === '/api/tickets') {
    return {
      tickets: [
        { id: '11111111-1111-4111-8111-111111111111', kind: 'intelligent-operations', title: 'Disk pressure', status: 'awaiting_approval', updated_at: Date.now() },
        { id: '22222222-2222-4222-8222-222222222222', kind: 'intelligent-operations', title: 'Pod crashloop', status: 'running', updated_at: Date.now() },
        { id: '33333333-3333-4333-8333-333333333333', kind: 'intelligent-operations', title: 'CPU spike', status: 'done', updated_at: Date.now() },
      ],
    };
  }
  if (pathname === '/connectors') {
    return {
      connections: [{ connector: 'github', account: 'primary', status: 'connected', shared: false }],
      httpServices: [{ connector: 'github', configured: true }],
    };
  }
  if (pathname === '/confirmations') return { confirmation: 'fixture-ok' };
  if (pathname.startsWith('/connectors/github/actions/')) return githubActionPayload(pathname);
  return { items: [], baselines: [], delegations: [], schedules: [], desks: [] };
}

function githubActionPayload(pathname) {
  if (pathname.includes('list-repos')) return { data: [{ full_name: 'emerald/gitops-prod', default_branch: 'main', private: true, html_url: 'https://github.com/emerald/gitops-prod' }] };
  if (pathname.includes('branches')) return { data: [{ name: 'main', commit: { sha: 'abc1234567' }, protected: true }] };
  if (pathname.includes('pulls')) return { data: [] };
  if (pathname.includes('runs')) return { data: { workflow_runs: [] } };
  if (pathname.includes('get-branch')) return { data: { commit: { commit: { tree: { sha: 't1' } } } } };
  if (pathname.includes('get-tree')) return { data: { tree: [{ path: 'README.md', type: 'blob', sha: 'b1' }] } };
  if (pathname.includes('get-blob')) return { data: { encoding: 'utf-8', content: '# Fixture' } };
  return { data: [] };
}

function createFixtureServer() {
  const files = buildAssetMap();
  return http.createServer((req, res) => {
    const { pathname, searchParams } = new URL(req.url, 'http://127.0.0.1');
    if (pathname === '/framed') {
      const hash = (searchParams.get('hash') || 'systems').replace(/[^a-z0-9-]/gi, '');
      const width = Number(searchParams.get('w')) || 412;
      const height = Number(searchParams.get('h')) || 915;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body style="margin:0"><iframe id="app" src="/api/intelligent-operations/app#${hash}" style="width:${width}px;height:${height}px;border:0;display:block"></iframe></body></html>`);
      return;
    }
    if (pathname.startsWith('/shared/ui/')) {
      const rel = pathname.slice('/shared/ui/'.length);
      const full = SHARED_UI ? path.resolve(SHARED_UI, rel) : '';
      res.writeHead(200, { 'content-type': contentType(pathname) });
      res.end(full && full.startsWith(SHARED_UI) && fs.existsSync(full) ? fs.readFileSync(full) : '');
      return;
    }
    if (files[pathname]) {
      res.writeHead(200, { 'content-type': contentType(files[pathname]) });
      res.end(fs.readFileSync(files[pathname]));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(fixtureJson(pathname)));
  });
}

async function measureStrips(target, selectors) {
  return target.evaluate((sels) => {
    const strips = [];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden || rect.width === 0 || rect.height === 0) continue;
        const items = [...el.querySelectorAll(':scope > a, :scope > button')].filter((c) => {
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
            active: c.getAttribute('aria-current') === 'page' || c.getAttribute('aria-selected') === 'true' || c.getAttribute('aria-pressed') === 'true',
            left: Math.round(r.left),
            right: Math.round(r.right),
          };
        });
        strips.push({
          selector: sel,
          stripHeight: Math.round(rect.height),
          stripLeft: Math.round(rect.left),
          stripRight: Math.round(rect.right),
          overflowX: cs.overflowX,
          flexWrap: cs.flexWrap,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          itemCount: items.length,
          distinctTopRows: rows.length,
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

function assertSingleRowStrip(strip, label, opts = {}) {
  assert.ok(strip.itemCount > 0, `${label}: strip must contain visible items`);
  assert.equal(strip.distinctTopRows, 1, `${label}: expected 1 row, got ${strip.distinctTopRows}`);
  assert.equal(strip.flexWrap, 'nowrap', `${label}: expected flex-wrap nowrap, got ${strip.flexWrap}`);
  if (opts.maxStripHeight) {
    assert.ok(strip.stripHeight <= opts.maxStripHeight, `${label}: height ${strip.stripHeight}px > ${opts.maxStripHeight}px`);
  }
  if (opts.expectScrollable) {
    assert.ok(['auto', 'scroll'].includes(strip.overflowX), `${label}: expected overflow-x auto/scroll, got ${strip.overflowX}`);
    assert.ok(strip.scrollWidth > strip.clientWidth, `${label}: expected scrollWidth (${strip.scrollWidth}) > clientWidth (${strip.clientWidth})`);
  }
  for (const item of strip.items) {
    assert.ok(item.height >= 44, `${label} item "${item.text}" height ${item.height} < 44`);
    assert.equal(item.wrappedLines, false, `${label} item "${item.text}" wrapped onto 2+ lines (h=${item.height})`);
  }
  if (opts.checkActiveVisible) {
    const active = strip.items.find((i) => i.active);
    assert.ok(active, `${label}: expected an active item`);
    assert.ok(
      active.left >= strip.stripLeft - 2 && active.right <= strip.stripRight + 2,
      `${label}: active "${active.text}" [${active.left}, ${active.right}] outside strip [${strip.stripLeft}, ${strip.stripRight}]`,
    );
  }
}

async function openGitTabs(target) {
  await target.waitForFunction(() => !document.getElementById('git-load').disabled, null, { timeout: 10000 });
  await target.locator('#git-load').click();
  await target.waitForSelector('.git-repo', { timeout: 10000 });
  await target.locator('.git-repo').first().click();
  await target.waitForSelector('.git-tabs', { timeout: 10000 });
}

async function verifyCorePhoneTabs(page, base, vp) {
  await page.goto(`${base}/api/intelligent-operations/app#overview`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.ticket-filters', { timeout: 10000 });
  const ov = await measureStrips(page, ['nav[aria-label="Operations"]', '.topbar', '.ticket-filters']);
  assert.ok(ov.docScrollWidth <= vp.width, `${vp.width} overview overflow: ${ov.docScrollWidth}`);
  assertSingleRowStrip(ov.strips.find((s) => s.selector === 'nav[aria-label="Operations"]'), `${vp.width} primary nav`, { expectScrollable: true, maxStripHeight: 60, checkActiveVisible: true });
  assertSingleRowStrip(ov.strips.find((s) => s.selector === '.topbar'), `${vp.width} topbar`, { maxStripHeight: 50 });
  assertSingleRowStrip(ov.strips.find((s) => s.selector === '.ticket-filters'), `${vp.width} ticket-filters`, { expectScrollable: true });

  await page.goto(`${base}/api/intelligent-operations/app#systems`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  const sys = await measureStrips(page, ['nav[aria-label="Operations"]', '.seg-tabs']);
  assert.ok(sys.docScrollWidth <= vp.width, `${vp.width} systems overflow: ${sys.docScrollWidth}`);
  assertSingleRowStrip(sys.strips.find((s) => s.selector === 'nav[aria-label="Operations"]'), `${vp.width} systems nav`, { expectScrollable: true, maxStripHeight: 60, checkActiveVisible: true });
  assertSingleRowStrip(sys.strips.find((s) => s.selector === '.seg-tabs'), `${vp.width} systems seg-tabs`);

  await page.goto(`${base}/api/intelligent-operations/app#data`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.operator-tabs', { timeout: 10000 });
  await page.locator('#pipeline-tab-correlation').click();
  await page.waitForTimeout(100);
  const dataReport = await measureStrips(page, ['.operator-tabs']);
  assert.ok(dataReport.docScrollWidth <= vp.width, `${vp.width} data overflow: ${dataReport.docScrollWidth}`);
  assertSingleRowStrip(dataReport.strips[0], `${vp.width} operator-tabs`, { expectScrollable: true, checkActiveVisible: true });

  await page.locator('#pipeline-tab-rules').click();
  await page.locator('#open-replay').click();
  await page.waitForSelector('.replay-choices', { timeout: 5000 });
  const replayReport = await measureStrips(page, ['.replay-choices']);
  assertSingleRowStrip(replayReport.strips[0], `${vp.width} replay-choices`, { expectScrollable: true });
  await page.locator('#replay-sheet-done').click();
}

async function verifySecondaryPhoneTabs(page, base, vp) {
  await page.goto(`${base}/api/intelligent-operations/app#swarms`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  const swarmsReport = await measureStrips(page, ['.seg-tabs']);
  assert.ok(swarmsReport.docScrollWidth <= vp.width, `${vp.width} swarms overflow: ${swarmsReport.docScrollWidth}`);
  assertSingleRowStrip(swarmsReport.strips[0], `${vp.width} swarms seg-tabs`);

  await page.goto(`${base}/api/intelligent-operations/app#git`, { waitUntil: 'networkidle' });
  await openGitTabs(page);
  await page.locator('.git-tab[data-tab="link"]').click();
  await page.waitForTimeout(100);
  const gitReport = await measureStrips(page, ['.git-tabs']);
  assert.ok(gitReport.docScrollWidth <= vp.width, `${vp.width} git overflow: ${gitReport.docScrollWidth}`);
  assertSingleRowStrip(gitReport.strips[0], `${vp.width} git-tabs`, { expectScrollable: true, checkActiveVisible: true });

  await page.goto(`${base}/api/intelligent-operations/app#console`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  const consoleReport = await measureStrips(page, ['.console-chips']);
  assert.ok(consoleReport.docScrollWidth <= vp.width, `${vp.width} console overflow: ${consoleReport.docScrollWidth}`);
  assertSingleRowStrip(consoleReport.strips[0], `${vp.width} console-chips`, { expectScrollable: true });

  await page.goto(`${base}/api/intelligent-operations/app#help`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  const helpNav = await measureStrips(page, ['nav[aria-label="Operations"]']);
  assertSingleRowStrip(helpNav.strips[0], `${vp.width} help active reveal`, { expectScrollable: true, maxStripHeight: 60, checkActiveVisible: true });

  await page.goto(`${base}/ui/index.html#sources`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  const uiReport = await measureStrips(page, ['nav[aria-label="Operations"]']);
  assert.ok(uiReport.docScrollWidth <= vp.width, `${vp.width} ui overflow: ${uiReport.docScrollWidth}`);
  assertSingleRowStrip(uiReport.strips[0], `${vp.width} ui nav`, { maxStripHeight: 60, checkActiveVisible: true });
}

test('Intelligent Operations phone (412x915 and 360x800) nav and tab strips stay single-row with 44px targets and zero page overflow', { timeout: 90000 }, async (t) => {
  const server = createFixtureServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  for (const vp of [{ width: 412, height: 915 }, { width: 360, height: 800 }]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    try {
      await verifyCorePhoneTabs(page, base, vp);
      await verifySecondaryPhoneTabs(page, base, vp);
      assert.deepEqual(errors, [], `${vp.width}: unexpected page errors`);
    } finally {
      await ctx.close();
    }
  }
});

test('Intelligent Operations embedded phone (412x915) hides primary nav while keeping tab strips single-row, and desktop (1440x900) keeps sidebar layout', { timeout: 90000 }, async (t) => {
  const server = createFixtureServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());

  const phoneCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  t.after(() => phoneCtx.close());
  const framed = await phoneCtx.newPage();
  const phoneErrors = [];
  framed.on('pageerror', (e) => phoneErrors.push(String(e)));

  for (const [hash, stripSel, expectScrollable] of [['systems', '.seg-tabs', false], ['data', '.operator-tabs', true], ['swarms', '.seg-tabs', false], ['console', '.console-chips', true]]) {
    await framed.goto(`${base}/framed?hash=${hash}&w=412&h=915`, { waitUntil: 'networkidle' });
    await framed.waitForTimeout(200);
    const frame = framed.frame({ url: /\/api\/intelligent-operations\/app/ });
    assert.ok(frame, `embedded ${hash}: iframe loaded`);
    const report = await measureStrips(frame, ['nav[aria-label="Operations"]', stripSel]);
    assert.ok(report.docScrollWidth <= 412, `embedded ${hash}: scrollWidth ${report.docScrollWidth} > 412`);
    assert.equal(report.strips.some((s) => s.selector === 'nav[aria-label="Operations"]'), false, `embedded ${hash}: primary nav hidden`);
    assertSingleRowStrip(report.strips.find((s) => s.selector === stripSel), `embedded ${hash} ${stripSel}`, { expectScrollable });
  }
  assert.deepEqual(phoneErrors, [], 'embedded phone pageErrors');

  const deskCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  t.after(() => deskCtx.close());
  const desk = await deskCtx.newPage();
  const deskErrors = [];
  desk.on('pageerror', (e) => deskErrors.push(String(e)));
  for (const url of ['/api/intelligent-operations/app#overview', '/api/intelligent-operations/app#systems', '/api/intelligent-operations/app#data', '/api/intelligent-operations/app#git', '/ui/index.html']) {
    await desk.goto(base + url, { waitUntil: 'networkidle' });
    await desk.waitForTimeout(150);
    const metrics = await desk.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Operations"]');
      const items = nav ? [...nav.querySelectorAll('a')].filter((a) => a.getBoundingClientRect().height > 0) : [];
      const rows = new Set(items.map((a) => Math.round(a.getBoundingClientRect().top)));
      return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, navRows: rows.size };
    });
    assert.ok(metrics.sw <= 1440, `desktop ${url}: scrollWidth ${metrics.sw} > 1440`);
    assert.ok(metrics.navRows >= 3, `desktop ${url}: sidebar nav remains vertical (${metrics.navRows} rows)`);
  }
  assert.deepEqual(deskErrors, [], 'desktop pageErrors');
});
