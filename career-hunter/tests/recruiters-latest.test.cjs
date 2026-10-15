/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: in a fresh conversation "Which recruiter did I just add, and what bucket is it in?" was
 *   answered "not visible in the current view" while the sweep10 Recruiting row sat at the end of a long list. The real Recruiters
 *   page (tools/career-recruiters.html) in Chromium at 412 x 915 over synthetic /recruiters answers: the All view names the latest
 *   added recruiter (highest id) with its bucket above the list, and the kernel's REAL screen snapshot
 *   (crates/api/src/shell_screen_state.js captureScreenState, the text the concierge receives) carries that line before the
 *   list even when the list is long; Add moves the line to the new row; a status tab, where "latest" would mislead, hides it.
 *   Seams: the synthetic same-origin fixture (no Career store, no network). Needs the kernel checkout (OSHAL_KERNEL_ROOT).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ORIGIN = 'http://career.fixture.test';
const PAGE = path.resolve(__dirname, '..', 'tools', 'career-recruiters.html');
const KERNEL = process.env.OSHAL_KERNEL_ROOT || path.join(os.homedir(), 'Documents', 'projects', 'oshal-kernel');
const SNAPSHOT = path.join(KERNEL, 'crates', 'api', 'src', 'shell_screen_state.js');

/** @description Playwright from the store toolchain. @returns {object} The module. */
function playwright() {
  const roots = [process.env.STORE_CI_TOOLCHAIN, path.resolve(__dirname, '../../scripts/toolchain/node_modules')].filter(Boolean);
  for (const root of roots) if (fs.existsSync(path.join(root, 'playwright'))) return require(path.join(root, 'playwright'));
  throw new Error(`BLOCKED: playwright not found (npm ci --prefix scripts/toolchain). Tried ${roots.join(', ')}`);
}

/** Eighteen tracked firms in a handful of buckets, then the one the person just added (the highest id). */
function firms() {
  const buckets = ['Cleared / GovTech', 'Defense primes', 'Staffing', 'Executive search'];
  const rows = Array.from({ length: 18 }, (_, i) => ({ id: i + 1, firm: `Firm ${String.fromCharCode(65 + i)} Talent`, bucket: buckets[i % 4],
    website: '', contact_name: `Contact ${i + 1}`, status: 'To contact', next_action: 'follow up next week' }));
  rows.push({ id: 19, firm: 'sweep10 Recruiting', bucket: 'sweep10 bucket', website: '', contact_name: '', status: 'To contact', next_action: '' });
  return rows;
}

/** @description Open the page with an in-memory recruiter list behind GET/POST /api/career-hunter/recruiters. */
async function openRecruiters(browser) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const list = firms();
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === '/api/career-hunter/recruiters-ui') return route.fulfill({ status: 200, contentType: 'text/html', path: PAGE });
    if (url.pathname === '/api/career-hunter/recruiters' && req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      list.push({ id: Math.max(...list.map((r) => r.id)) + 1, firm: body.firm, bucket: body.bucket || 'Other', status: 'To contact', contact_name: '', website: '', next_action: '' });
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (url.pathname === '/api/career-hunter/recruiters') {
      const status = url.searchParams.get('status');
      const shown = status ? list.filter((r) => r.status === status) : list;
      const byStatus = [...new Set(list.map((r) => r.status))].map((s) => ({ status: s, n: list.filter((r) => r.status === s).length }));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recruiters: shown, byStatus, empty: !list.length }) });
    }
    return route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/api/career-hunter/recruiters-ui`, { waitUntil: 'load' });
  await page.waitForSelector('.row');
  await page.addScriptTag({ content: fs.readFileSync(SNAPSHOT, 'utf8') });
  return { page, context };
}

const snapshot = (page) => page.evaluate(() => window.captureScreenState({ contentDocument: document }).text);

let browser;
test.before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

test('the All view names the latest added recruiter and its bucket, and the concierge\'s snapshot carries it before the list', async () => {
  assert.ok(fs.existsSync(SNAPSHOT), `the kernel checkout must be present (set OSHAL_KERNEL_ROOT); missing ${SNAPSHOT}`);
  const { page, context } = await openRecruiters(browser);
  try {
    assert.equal((await page.locator('#latest').innerText()).trim(), 'Latest added: sweep10 Recruiting · bucket sweep10 bucket · status To contact');
    const lines = (await snapshot(page)).split('\n');
    const at = lines.findIndex((line) => line.includes('Latest added: sweep10 Recruiting · bucket sweep10 bucket'));
    assert.ok(at >= 0, lines.join('\n'));
    assert.ok(at < lines.findIndex((line) => line.includes('Firm A Talent')), 'the line comes before the list, so a cut snapshot still carries it');
  } finally {
    await context.close();
  }
});

test('Add moves the line to the new recruiter; a status tab hides it', async () => {
  const { page, context } = await openRecruiters(browser);
  try {
    await page.fill('#firm', 'sweep12 Search Partners');
    await page.fill('#bucket', 'sweep12 bucket');
    await page.click('button:has-text("Add")');
    await page.waitForFunction(() => document.getElementById('latest').textContent.includes('sweep12 Search Partners'));
    assert.match(await page.locator('#latest').innerText(), /Latest added: sweep12 Search Partners · bucket sweep12 bucket/);
    await page.click('.tab:has-text("To contact")');
    await page.waitForFunction(() => document.getElementById('latest').hidden === true);
    assert.equal(await page.locator('#latest').isVisible(), false);
  } finally {
    await context.close();
  }
});
