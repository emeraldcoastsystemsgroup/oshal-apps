/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Finance 1.8.5 Chromium browser proof for the Projects pane on tools/finance.html at desktop (1440x900) and phone (412x915): verifies zero page errors, zero horizontal overflow, creating a project, adding allocation lines, recording actuals across sources, budget vs actual and variance rendering, over-budget badge, and two-click in-page actual removal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const ROOT = path.resolve(PKG, '..');
const HTML_PATH = path.join(PKG, 'tools', 'finance.html');
const JS_PATH = path.join(PKG, 'tools', 'finance-projects.js');
const ORIGIN = 'http://finance-projects.fixture.test';

const model = require(path.join(PKG, 'routes', 'finance-projects-model.js'));

function loadPlaywright() {
  const roots = [
    process.env.STORE_CI_TOOLCHAIN && path.join(process.env.STORE_CI_TOOLCHAIN, 'node_modules'),
    process.env.STORE_CI_TOOLCHAIN,
    path.join(ROOT, 'scripts', 'toolchain', 'node_modules'),
    path.resolve(ROOT, '..', 'oshal-apps', 'scripts', 'toolchain', 'node_modules'),
  ].filter(Boolean);
  for (const root of roots) {
    const candidate = path.join(root, 'playwright');
    if (fs.existsSync(candidate)) return require(candidate);
  }
  throw new Error(`BLOCKED: playwright not found. Tried ${roots.join(', ')}`);
}

const { chromium } = loadPlaywright();

/** Stateful in-browser API double wired to the real summarizeFinanceProject math. */
function makeProjectsBackend() {
  const projects = new Map();
  const lines = new Map();
  const actuals = new Map();

  const summaryOf = (projectId) => {
    const project = projects.get(projectId);
    if (!project) return null;
    const pLines = [...lines.values()].filter((l) => l.projectId === projectId);
    const pActuals = [...actuals.values()].filter((a) => a.projectId === projectId);
    return model.summarizeFinanceProject(project, pLines, pActuals);
  };

  return {
    handle(method, pathname, body) {
      if (method === 'GET' && pathname === '/api/finance/projects') {
        const list = [...projects.values()].map((p) => {
          const s = summaryOf(p.projectId);
          return {
            ...p,
            budgetCents: s.totalBudgetCents,
            committedCents: s.totalCommittedCents,
            actualCents: s.totalActualCents,
            varianceCents: s.totalVarianceCents,
            overBudget: s.overBudget,
            lineCount: s.lineCount,
            actualCount: s.actualCount,
            bySource: s.bySource,
          };
        });
        return { status: 200, body: { projects: list } };
      }
      if (method === 'POST' && pathname === '/api/finance/projects') {
        const chk = model.normalizeProjectInput(body);
        if (!chk.ok) return { status: 400, body: { error: chk.error, message: chk.message } };
        const p = {
          projectId: randomUUID(), slug: chk.value.slug, name: chk.value.name, currency: chk.value.currency,
          status: chk.value.status, budgetCents: chk.value.budgetCents, externalRef: chk.value.externalRef,
          notes: chk.value.notes, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        projects.set(p.projectId, p);
        return { status: 201, body: summaryOf(p.projectId) };
      }
      const sumMatch = /^\/api\/finance\/projects\/([^/]+)\/summary$/.exec(pathname);
      if (method === 'GET' && sumMatch) {
        const s = summaryOf(sumMatch[1]);
        return s ? { status: 200, body: s } : { status: 404, body: { error: 'project_not_found' } };
      }
      const lineMatch = /^\/api\/finance\/projects\/([^/]+)\/lines$/.exec(pathname);
      if (method === 'POST' && lineMatch) {
        const chk = model.normalizeProjectLineInput(body);
        if (!chk.ok) return { status: 400, body: { error: chk.error, message: chk.message } };
        const line = {
          lineId: randomUUID(), projectId: lineMatch[1], ...chk.value,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        lines.set(line.lineId, line);
        return { status: 201, body: { line, summary: summaryOf(lineMatch[1]) } };
      }
      const actMatch = /^\/api\/finance\/projects\/([^/]+)\/actuals$/.exec(pathname);
      if (method === 'POST' && actMatch) {
        const chk = model.normalizeProjectActualInput(body);
        if (!chk.ok) return { status: 400, body: { error: chk.error, message: chk.message } };
        const actual = {
          actualId: randomUUID(), projectId: actMatch[1], ...chk.value,
          createdAt: new Date().toISOString(),
        };
        actuals.set(actual.actualId, actual);
        return { status: 201, body: { actual, summary: summaryOf(actMatch[1]) } };
      }
      const delActMatch = /^\/api\/finance\/projects\/([^/]+)\/actuals\/([^/]+)$/.exec(pathname);
      if (method === 'DELETE' && delActMatch) {
        actuals.delete(delActMatch[2]);
        return { status: 200, body: { ok: true, deletedActualId: delActMatch[2], summary: summaryOf(delActMatch[1]) } };
      }
      return { status: 404, body: { error: 'not_found' } };
    },
  };
}

let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

async function openProjectsSurface(viewport, backend) {
  const context = await browser.newContext({ viewport, locale: 'en-US', timezoneId: 'UTC' });
  const errors = [];
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort();
    const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (url.pathname === '/api/finance/' || url.pathname === '/api/finance') {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', path: HTML_PATH });
    }
    if (url.pathname === '/api/finance/p/static/finance-projects.js') {
      return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', path: JS_PATH });
    }
    if (url.pathname === '/api/finance/status') {
      return json({ configured: true, env: 'sandbox', connected: 0, hasData: false, items: [] });
    }
    if (url.pathname.startsWith('/api/finance/projects')) {
      const payload = req.postData() ? JSON.parse(req.postData()) : {};
      const res = backend.handle(req.method(), url.pathname, payload);
      return json(res.body, res.status);
    }
    if (url.pathname === '/cockpit/js/app-handoff.js') return route.fulfill({ contentType: 'application/javascript', body: 'export function receiveHandoff(){}' });
    if (url.pathname === '/cockpit/js/app-workflows.js') return route.fulfill({ contentType: 'application/javascript', body: 'export async function mountConnectedActions(){}' });
    if (url.pathname.endsWith('.css')) {
      return route.fulfill({
        contentType: 'text/css',
        body: ':root{--bg-primary:#101827;--bg-card:#162238;--bg-tertiary:#22314b;--border-color:#526073;--text-primary:#eef3ff;--text-muted:#bdc9da;--text-secondary:#c7d3e6;--accent-primary:#37d27f;--status-error:#ff8b8b}',
      });
    }
    if (url.pathname.endsWith('.js')) return route.fulfill({ contentType: 'application/javascript', body: '' });
    return json({ error: 'unexpected' }, 404);
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${ORIGIN}/api/finance/`, { waitUntil: 'networkidle' });
  return { context, page, errors };
}

test('desktop 1440x900: create project, allocate lines, record actuals, verify variance, and remove actual via in-page confirm', async () => {
  const backend = makeProjectsBackend();
  const { context, page, errors } = await openProjectsSurface({ width: 1440, height: 900 }, backend);
  try {
    await page.fill('#projectName', 'Q4 Marketing Launch');
    await page.fill('#projectBudget', '1000.00');
    await page.fill('#projectExternalRef', 'marketing:campaign:q4');
    await page.click('#projectSubmitBtn');
    await page.locator('#projectDetailTitle', { hasText: 'Q4 Marketing Launch' }).waitFor();

    // Add Email line ($400 budget, $50 committed) and Social line ($600 budget)
    await page.fill('#lineName', 'Email');
    await page.fill('#lineChannel', 'email');
    await page.fill('#lineBudget', '400.00');
    await page.fill('#lineCommitted', '50.00');
    await page.click('#lineSubmitBtn');
    await page.locator('#projectLinesBody tr', { hasText: 'Email' }).waitFor();

    await page.fill('#lineName', 'Social');
    await page.fill('#lineChannel', 'linkedin');
    await page.fill('#lineBudget', '600.00');
    await page.fill('#lineCommitted', '0.00');
    await page.click('#lineSubmitBtn');
    await page.locator('#projectLinesBody tr', { hasText: 'Social' }).waitFor();

    // Record manual actual ($125.00) and email actual ($75.00)
    await page.selectOption('#actualSource', 'manual');
    await page.fill('#actualAmount', '125.00');
    await page.fill('#actualDate', '2026-11-24');
    await page.fill('#actualNote', 'Creative assets');
    await page.click('#actualSubmitBtn');
    await page.locator('#projectActualsList li', { hasText: '$125.00' }).waitFor();

    await page.selectOption('#actualSource', 'email');
    await page.fill('#actualAmount', '75.00');
    await page.fill('#actualDate', '2026-11-25');
    await page.fill('#actualNote', 'Resend send');
    await page.click('#actualSubmitBtn');
    await page.locator('#projectActualsList li', { hasText: '$75.00' }).waitFor();

    const cardsText = await page.locator('#projectSummaryCards').innerText();
    assert.match(cardsText, /\$1,000\.00/);
    assert.match(cardsText, /\$50\.00/);
    assert.match(cardsText, /\$200\.00/);
    assert.match(cardsText, /\$800\.00/);

    // Remove the $75.00 actual via two-click in-page confirmation (zero window.confirm)
    const row75 = page.locator('#projectActualsList li', { hasText: '$75.00' });
    await row75.getByRole('button', { name: 'Remove' }).click();
    await row75.getByRole('button', { name: 'Confirm remove' }).click();
    await page.locator('#projectSummaryCards', { hasText: '$125.00' }).waitFor();
    assert.match(await page.locator('#projectSummaryCards').innerText(), /\$875\.00/);

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert.equal(metrics.scrollWidth, metrics.clientWidth, 'zero horizontal overflow on desktop 1440x900');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('phone 412x915: Projects pane renders cleanly with zero horizontal overflow and zero page errors', async () => {
  const backend = makeProjectsBackend();
  const created = backend.handle('POST', '/api/finance/projects', { name: 'Phone Budget', budgetCents: 50000 }).body;
  const pid = created.project.projectId;
  const line = backend.handle('POST', `/api/finance/projects/${pid}/lines`, { name: 'Ads', channel: 'ads', budgetCents: 50000, committedCents: 0 }).body.line;
  backend.handle('POST', `/api/finance/projects/${pid}/actuals`, { lineId: line.lineId, source: 'ads', amountCents: 60000, occurredOn: '2026-11-24', note: 'Overrun test' });

  const { context, page, errors } = await openProjectsSurface({ width: 412, height: 915 }, backend);
  try {
    await page.locator('#projectDetailTitle', { hasText: 'Phone Budget' }).waitFor();
    await page.locator('#projectOverBadge').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#projectOverBadge').textContent(), 'Over budget');

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert.equal(metrics.scrollWidth, metrics.clientWidth, `phone overflow: ${metrics.scrollWidth} > ${metrics.clientWidth}`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
