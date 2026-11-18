/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Browser proof for the Job Apply connected-device setting screen at 412x915 (touch) and 1440x900 (desktop): zero devices shows "None connected" with step-by-step Open Swarm Orbit setup guidance, and two connected devices let the person pick either device with real pointer taps/clicks and save via PUT /api/apply-operator/workers, with 44px targets and zero horizontal overflow.
 */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'tools', 'review.html'), 'utf8');
const ORIGIN = 'http://job-apply.fixture.test';
const PHONE = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

function loadPlaywright() {
  const candidates = [process.env.STORE_CI_TOOLCHAIN, path.join(ROOT, '..', 'scripts', 'toolchain', 'node_modules')].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'playwright'))) return createRequire(path.join(dir, 'noop.js'))('playwright');
  }
  throw new Error('Playwright is required from scripts/toolchain/node_modules');
}

async function openSettingPage(browser, size, apiState) {
  const context = await browser.newContext(size);
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === '/api/job-apply/settings') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: HTML });
    }
    if (url.pathname.startsWith('/shared/') || url.pathname.startsWith('/ui/')) {
      const ctype = url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript';
      return route.fulfill({ status: 200, contentType: ctype, body: '' });
    }
    if (url.pathname === '/api/apply-operator/workers') {
      if (req.method() === 'PUT') {
        const parsed = JSON.parse(req.postData() || '{}');
        apiState.puts.push(parsed);
        apiState.selectedDeviceId = parsed.deviceId || null;
      }
      const chosen = apiState.workers.find((w) => w.id === apiState.selectedDeviceId) || null;
      const configured = Boolean(apiState.selectedDeviceId);
      const body = {
        workers: apiState.workers,
        selectedDeviceId: configured ? apiState.selectedDeviceId : null,
        selectedDeviceName: chosen ? chosen.hostname : null,
        selectionConfigured: configured,
        defaultClientId: chosen && chosen.available ? chosen.id : null,
        available: Boolean(chosen && chosen.available),
      };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/api/job-apply/settings`, { waitUntil: 'load' });
  return { page, context };
}

let browser;
before(async () => { browser = await loadPlaywright().chromium.launch({ headless: true }); });
after(async () => { if (browser) await browser.close(); });

const press = (size, locator) => (size === PHONE ? locator.tap() : locator.click());

for (const [label, size] of [['phone-412', PHONE], ['desktop-1440', DESKTOP]]) {
  test(`${label}: zero connected devices shows None connected with setup instructions and 44px controls`, async () => {
    const apiState = { workers: [], selectedDeviceId: null, puts: [] };
    const { page, context } = await openSettingPage(browser, size, apiState);
    try {
      await page.getByRole('heading', { name: 'None connected', exact: true }).waitFor();
      assert.equal(await page.locator('#notes').count(), 0);
      assert.equal(await page.locator('table').count(), 0, 'no job-ticket list is shown');
      const connect = page.getByRole('link', { name: 'Connect a device', exact: true });
      const career = page.getByRole('link', { name: 'Open in Career', exact: true });
      assert.equal(await connect.getAttribute('href'), '/cockpit/tools/devices.html');
      assert.equal(await career.isVisible(), true);
      for (const loc of [connect, career, page.getByRole('button', { name: 'Check again', exact: true })]) {
        const box = await loc.boundingBox();
        assert.ok(box && box.height >= 44, `target >= 44px: ${JSON.stringify(box)}`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    } finally {
      await context.close();
    }
  });

  test(`${label}: two connected devices let the person pick one and switch to the other`, async () => {
    const apiState = {
      workers: [
        { id: 'node-alpha', clientId: 'node-alpha', kind: 'orbit', hostname: 'alpha-desk', platform: 'linux', connected: true, canControl: true, available: true },
        { id: 'node-beta', clientId: 'node-beta', kind: 'orbit', hostname: 'beta-laptop', platform: 'macos', connected: true, canControl: true, available: true },
      ],
      selectedDeviceId: null,
      puts: [],
    };
    const { page, context } = await openSettingPage(browser, size, apiState);
    try {
      await page.locator('.device-card').nth(1).waitFor();
      await press(size, page.locator('.device-card').filter({ hasText: 'beta-laptop' }));
      await press(size, page.getByRole('button', { name: 'Save device', exact: true }));
      await page.waitForFunction(() => document.querySelector('#deviceStatus')?.textContent?.includes('beta-laptop'));
      assert.deepEqual(apiState.puts, [{ deviceId: 'node-beta' }]);
      assert.match(await page.locator('#deviceStatus').innerText(), /Career and Jarvis will apply to jobs using beta-laptop\./);

      await press(size, page.locator('.device-card').filter({ hasText: 'alpha-desk' }));
      await press(size, page.getByRole('button', { name: 'Save device', exact: true }));
      await page.waitForFunction(() => document.querySelector('#deviceStatus')?.textContent?.includes('alpha-desk'));
      assert.deepEqual(apiState.puts, [{ deviceId: 'node-beta' }, { deviceId: 'node-alpha' }]);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    } finally {
      await context.close();
    }
  });
}
