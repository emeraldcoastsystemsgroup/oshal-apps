/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.6.0 (Roger, 2026-11-10: "a tree list on the left, tables on the right ... we should be able to rename connections ... on the add a device screen there are buttons that the text doesnt fit"). The real page in Chromium over the stand-in server, at desktop and phone size: computers with their phones and TVs under them, rows that start at the left, a details pane beside the tree (under the row on a phone) with a Connection table, a rename that calls the save route, and no button in Add a device that cuts its words.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.10.0 (T27; Roger, 2026-11-10: "we should be able to rename connections"): a computer's Rename saves through the kernel's PATCH /api/computers/{id}, shows the new name in the tree, says a refused name in the kernel's words, and has no More options.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Device overview guides a real selection with searchable names, separate connection/control status, progressive details and a contextual action without sending device commands while browsing.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Native Orbit setup and exact signed-in device links remain separate from optional Linux bridge candidates at phone and desktop sizes.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(resolve(here, '../../scripts/toolchain/noop.js'))('playwright');
const port = 4900 + Math.floor(Math.random() * 90);
let server, browser;
before(async () => {
  server = spawn(process.execPath, [join(here, 'support', 'standin-server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.kill(); });

async function open(viewport, setup) {
  const page = await browser.newPage({ viewport });
  page.errors = []; page.on('pageerror', (error) => page.errors.push(String(error.message)));
  page.saves = []; page.on('request', (request) => { if (request.method() === 'POST' && /\/api\/phone-control\/devices\/[^/]+$/.test(new URL(request.url()).pathname)) page.saves.push(request.postDataJSON()); });
  await setup?.(page);
  for (let i = 0; i < 40; i += 1) { try { await page.goto(`http://127.0.0.1:${port}/api/phone-control/ui`, { waitUntil: 'networkidle' }); break; } catch { await new Promise((done) => setTimeout(done, 250)); } }
  await page.locator('#computerRail .pc-rail-item').first().waitFor();
  return page;
}
const names = (list) => list.locator(':scope > li > .pc-row-line .pc-rail-name').evaluateAll((els) => els.map((el) => el.firstChild.textContent));

for (const viewport of [{ width: 1280, height: 900 }, { width: 412, height: 915 }]) {
  test(`${viewport.width} px: searchable overview separates browsing, connection help and opening a device`, { timeout: 60000 }, async () => {
    const page = await open(viewport), commands = [];
    page.on('request', (request) => { if (/\/api\/computers\/[^/]+\/run$/.test(new URL(request.url()).pathname)) commands.push(request); });
    try {
      const search = page.getByRole('searchbox', { name: 'Find a device or program' });
      assert.equal(await search.isVisible(), true);
      await search.fill('old-laptop');
      assert.deepEqual(await names(page.locator('#computerRail')), ['old-laptop']);
      if (viewport.width < 900) await page.getByRole('button', { name: 'Details of old-laptop' }).click();
      const details = page.locator('.pc-details');
      assert.equal(await details.locator('.pc-details-name').innerText(), 'old-laptop');
      assert.match(await details.innerText(), /Not connected/);
      assert.equal(await details.getByRole('button', { name: 'Connection help', exact: true }).isVisible(), true);
      assert.equal(await details.locator('.pc-advanced').getAttribute('open'), null);
      await details.getByText('Connection details', { exact: true }).click();
      assert.equal(await details.getByRole('table').first().isVisible(), true);
      await search.fill('Living Room TV');
      if (viewport.width < 900) await page.getByRole('button', { name: 'Details of Living Room TV' }).click();
      assert.equal(await page.locator('.pc-details-name').innerText(), 'Living Room TV', 'a matching child is selected ahead of its contextual parent');
      assert.equal(commands.length, 0, 'finding and inspecting a device sends no commands');
      await search.fill('no-such-fixture-device');
      assert.match(await page.locator('#deviceSearchStatus').innerText(), /No matching devices/);
      await page.getByRole('button', { name: 'Clear device search' }).click();
      assert.equal(await page.locator('#computerRail > li').count(), 3);
      await page.getByRole('button', { name: 'Details of spark-f255' }).click();
      const ready = page.locator('.pc-details');
      assert.match(await ready.locator('.pc-device-state').innerText(), /Connected/);
      assert.match(await ready.locator('.pc-device-state').innerText(), /Control on/);
      assert.equal(await page.locator('#devicesView .ks-btn-primary:visible').count(), 1);
      const small = await page.locator('#devicesView :is(button,input,summary):visible').evaluateAll((els) => els.filter(el => el.getBoundingClientRect().height < 44 || el.getBoundingClientRect().width < 44).map(el => el.outerHTML));
      assert.deepEqual(small, [], 'every overview control has a 44 px target');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
      await ready.getByRole('button', { name: 'Open device', exact: true }).click();
      await page.locator('#sessionView').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#stageTitle').innerText(), 'spark-f255');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });
}

test('device details use only reported identity and permissions, find bound programs, and keep control options usable on a phone', { timeout: 60000 }, async () => {
  const longName = 'A shared computer with an unusually long but valid fixture device name';
  const page = await open({ width: 412, height: 915 }, async (view) => {
    await view.route('**/api/computers', async (route) => {
      const reply = await route.fetch(), body = await reply.json();
      body.computers = body.computers.map(c => c.id === 'spark-f255' ? { ...c, name: longName, this_device: true, bound: ['chrome'] } : c);
      await route.fulfill({ response: reply, json: body });
    });
  });
  try {
    const search = page.getByRole('searchbox', { name: 'Find a device or program' });
    await search.fill('Chrome');
    assert.equal(await page.locator('[data-program="chrome"]').innerText(), 'Chrome\nProgram bound on this computer');
    await page.getByRole('button', { name: `Details of ${longName}` }).click();
    assert.match(await page.locator('.pc-details .pc-device-state').innerText(), /This device/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    await search.fill('Living Room TV');
    await page.getByRole('button', { name: 'Details of Living Room TV' }).click();
    const details = page.locator('.pc-details');
    assert.match(await details.locator('.pc-device-state').innerText(), /Connected\nControl off/);
    await details.getByRole('button', { name: 'Control options', exact: true }).click();
    assert.equal(await page.getByRole('menuitem', { name: 'Allow control: Off' }).isVisible(), true);
    assert.equal(page.saves.length, 0, 'opening options does not change permission');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#rowMenu').isVisible(), false);
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 412, height: 915 }]) {
  test(`${viewport.width} px: computers with their phones and TVs under them; details in tables; rows start at the left`, { timeout: 60000 }, async () => {
    const page = await open(viewport);
    try {
      assert.equal(await page.locator('#pageLede').innerText(), '9 phones and TVs · 3 computers.');
      assert.deepEqual(await names(page.locator('#computerRail')), ['my-computer', 'spark-f255', 'old-laptop'], 'connected computers first');
      const spark = page.locator('#computerRail > li', { hasText: 'spark-f255' });
      assert.deepEqual(await names(spark.locator('.pc-children')), ['Fire TV', 'Pixel 9', 'Living Room TV'], 'what connects through the Spark is under it');
      assert.equal(await page.locator('#phoneRailTitle').innerText(), 'NOT ATTACHED TO A COMPUTER ON THIS LIST');
      assert.deepEqual(await names(page.locator('#phoneRail')), ['Office Amazon TV', 'Galaxy S25', 'Kitchen tablet']);
      const leftGaps = await page.locator('.pc-rail-item').evaluateAll((rows) => rows.map((row) => Math.round(row.querySelector('.pc-rail-name').getBoundingClientRect().left - row.getBoundingClientRect().left)));
      assert.ok(leftGaps.every((gap) => gap <= 60), `every name starts at the left of its row: ${leftGaps}`);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(over, 0, 'no sideways scroll');
      const inside = await page.locator('.pc-rail .pc-row-details').evaluateAll((buttons) => { const card = document.querySelector('.pc-rail').getBoundingClientRect(); return buttons.every((b) => b.getBoundingClientRect().right <= card.right + 0.5); });
      assert.equal(inside, true, 'every Details button is inside the card');

      const toggle = spark.locator(':scope > .pc-row-line .pc-tree-toggle');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await toggle.click();
      assert.equal(await page.locator('#computerRail > li', { hasText: 'spark-f255' }).locator('.pc-children').count(), 0, '− hides what is under it');
      await page.locator('#computerRail > li', { hasText: 'spark-f255' }).locator(':scope > .pc-row-line .pc-tree-toggle').click();

      const fireTv = (await page.locator('li[data-entry]', { hasText: 'Fire TV' }).last().getAttribute('data-entry')).split(':')[1];
      await page.locator('li[data-entry]', { hasText: 'Fire TV' }).last().getByRole('button', { name: 'Details of Fire TV' }).click();
      const details = page.locator('.pc-details');
      assert.equal(await details.locator('.pc-details-name').innerText(), 'Fire TV');
      await details.getByText('Connection details', { exact: true }).click();
      const rows = Object.fromEntries(await details.locator('.pc-detail-table tr').evaluateAll((trs) => trs.map((tr) => [tr.querySelector('th').textContent, tr.querySelector('td').textContent])));
      assert.deepEqual(Object.keys(rows), ['How it connects', 'Through', 'State', 'Control', 'Address']);
      assert.equal(rows['Through'], 'spark-f255');
      assert.ok(Object.values(rows).every((value) => value.trim().length > 0), JSON.stringify(rows));
      const tree = await page.locator('.pc-rail').boundingBox(), panel = await details.boundingBox();
      if (viewport.width >= 900) {
        assert.ok(panel.x >= tree.x + tree.width - 1, 'the details stand beside the tree');
        assert.ok(tree.width + (await page.locator('#deviceDetails').boundingBox()).width >= viewport.width * 0.9, 'together they fill the page');
      } else {
        const row = await page.locator('li[data-entry]', { hasText: 'Fire TV' }).last().locator(':scope > .pc-row-line').boundingBox();
        assert.ok(panel.y >= row.y + row.height - 1 && panel.x >= tree.x, 'the details open under their row');
        assert.equal(await page.locator('#deviceDetails').isVisible(), false);
      }

      await details.getByRole('button', { name: 'Rename' }).click();
      await details.getByLabel('New name').fill('Office Amazon TV 2');
      await details.getByRole('button', { name: 'Save' }).click();
      await page.waitForFunction(() => window.performance.getEntriesByType('resource').length > 0);
      await assert.doesNotReject(async () => { for (let i = 0; i < 40 && !page.saves.length; i += 1) await page.waitForTimeout(50); });
      assert.deepEqual(page.saves, [{ name: 'Office Amazon TV 2' }], 'Rename saves the new name through the device route');
      await page.locator('li[data-entry]', { hasText: 'Office Amazon TV 2' }).first().waitFor();
      // The stand-in keeps what it is told, as the real route does: put the name back for the next run.
      await page.request.post(`http://127.0.0.1:${port}/api/phone-control/devices/${fireTv}`, { data: { name: 'Fire TV' } });

      const computer = page.locator('#computerRail > li', { hasText: 'spark-f255' });
      await computer.locator(':scope > .pc-row-line').getByRole('button', { name: 'Details of spark-f255' }).click();
      const sparkDetails = page.locator('.pc-details');
      await sparkDetails.getByText('Connection details', { exact: true }).click();
      const headings = await page.locator('.pc-details .pc-detail-heading').allInnerTexts();
      assert.deepEqual(headings.map((text) => text.toUpperCase()), ['CONNECTION', 'WHAT IT CAN DO'], 'a computer also lists what it can do');
      // 1.10.0: a computer is renamed with the kernel's own given name, the one the Devices page shows.
      const renames = [];
      page.on('request', (request) => { if (request.method() === 'PATCH' && /\/api\/computers\/[^/]+$/.test(new URL(request.url()).pathname)) renames.push(request.postDataJSON()); });
      assert.equal(await sparkDetails.getByRole('button', { name: 'More options' }).count(), 0, 'More options stays on saved phones and TVs');
      // The first save is answered with the kernel's refusal (computers_rename's words); the page must say it, not rename.
      let refuseOnce = true;
      await page.route(/\/api\/computers\/[^/]+$/, (route) => {
        if (route.request().method() !== 'PATCH' || !refuseOnce) return route.fallback();
        refuseOnce = false;
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ refused: 'invalid_request', detail: 'a device name is one line of at most 80 characters' }) });
      });
      await sparkDetails.getByRole('button', { name: 'Rename' }).click();
      await sparkDetails.getByLabel('New name').fill('Office Spark');
      await sparkDetails.getByRole('button', { name: 'Save' }).click();
      await page.locator('.pc-details .pc-rename-status', { hasText: 'Not renamed: a device name is one line of at most 80 characters' }).waitFor();
      assert.deepEqual(await names(page.locator('#computerRail')), ['my-computer', 'spark-f255', 'old-laptop'], 'a refused name renames nothing');
      await sparkDetails.getByRole('button', { name: 'Save' }).click();
      await page.locator('#computerRail .pc-rail-name', { hasText: 'Office Spark' }).first().waitFor();
      assert.deepEqual(renames.slice(-1), [{ name: 'Office Spark' }], 'the kernel route is asked with the new name');
      await page.request.fetch(`http://127.0.0.1:${port}/api/computers/${(await page.locator('#computerRail > li', { hasText: 'Office Spark' }).getAttribute('data-entry')).split(':')[1]}`, { method: 'PATCH', data: { name: 'spark-f255' } });
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });
}

test('Add a device: every button shows all of its words at phone and desktop size', { timeout: 60000 }, async () => {
  for (const viewport of [{ width: 412, height: 915 }, { width: 1280, height: 900 }]) {
    const page = await open(viewport);
    try {
      await page.getByRole('button', { name: 'Add a device' }).click();
      await page.locator('#connectSheet').waitFor({ state: 'visible' });
      await page.waitForTimeout(500);
      const cut = await page.locator('#connectSheet button:visible').evaluateAll((buttons) => buttons.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim()));
      assert.deepEqual(cut, [], `no button cuts its words at ${viewport.width} px`);
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  }
});

async function setupPage(viewport, list) {
  const commands = [];
  const page = await open(viewport, async (view) => {
    view.on('request', (request) => { if (request.method() !== 'GET') commands.push(request.url()); });
    await view.route('**/api/phone-control/computers/reports', (route) => route.fulfill({ json: { reports: [] } }));
    if (list) await view.route('**/api/computers', (route) => route.fulfill({ json: { computers: list } }));
  });
  await page.getByRole('button', { name: 'Add a device', exact: true }).click();
  return { page, commands };
}
for (const width of [1280, 412]) {
  test(`${width} px: native Orbit setup preserves direct devices and exact node links without bridge commands`, async () => {
    const { page, commands } = await setupPage({ width, height: 915 });
    try {
      assert.equal(await page.locator('#nativeOrbitSetup').isVisible(), true);
      assert.match(await page.locator('#nativeOrbitSetup').innerText(), /sign in.*control/i);
      const rows = page.locator('#nativeDevicesList > li');
      assert.equal(await rows.count(), 6);
      const android = rows.filter({ hasText: 'Office Amazon TV' });
      assert.match(await android.innerText(), /Connected.*Control on/s);
      assert.equal(await android.getByRole('link', { name: 'View device', exact: true }).getAttribute('href'), '/cockpit/tools/devices.html?device=device%3Aoffice-amazon-tv');
      const desktop = rows.filter({ hasText: 'my-computer' });
      assert.equal(await desktop.getByRole('link', { name: 'View device', exact: true }).getAttribute('href'), '/cockpit/tools/devices.html?device=device%3Amy-computer');
      assert.deepEqual(commands, [], 'browsing setup does not execute a command or change permissions');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
      const small = await page.locator('#nativeOrbitSetup :is(a,button):visible').evaluateAll(els => els.filter(el => el.getBoundingClientRect().height < 44 || el.getBoundingClientRect().width < 44).map(el => el.outerHTML));
      assert.deepEqual(small, []);
    } finally { await page.close(); }
  });
  test(`${width} px: only Linux devices are offered as bridge hosts, with a working current downloads route`, async () => {
    const { page, commands } = await setupPage({ width, height: 915 });
    try {
      const names = await page.locator('#computersBody tr').evaluateAll(rows => rows.map(row => row.cells[0].textContent));
      assert.deepEqual(names, ['spark-f255', 'old-laptop']);
      assert.match(await page.locator('#computersHeading').innerText(), /Linux/);
      assert.equal(await page.locator('#downloadNode').getAttribute('href'), '/cockpit/tools/downloads.html');
      assert.equal(await page.locator('#downloadNode').innerText(), 'Install or update Orbit');
      assert.deepEqual(commands, []);
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });
}
test('native-only devices keep a direct path while the optional Linux bridge stays empty', async () => {
  const list = [{ id: 'phone-exact', name: 'Shared name', platform: 'android', connected: true, can_control: false, tools: ['screen.read'] },
    { id: 'desktop-exact', name: 'Shared name', platform: 'windows', connected: true, can_control: true, tools: ['desktop.control'] },
    { id: 'unknown-exact', name: 'Unreported native device' }];
  const { page, commands } = await setupPage({ width: 412, height: 915 }, list);
  try {
    assert.equal(await page.locator('#computersBody button').count(), 0);
    assert.equal(await page.locator('#computersEmpty').isVisible(), true);
    assert.match(await page.locator('#computersEmpty').innerText(), /Linux.*optional|optional.*Linux/is);
    const links = await page.locator('#nativeDevicesList a').evaluateAll(els => els.map(el => el.getAttribute('href')));
    assert.deepEqual(links, ['/cockpit/tools/devices.html?device=device%3Aphone-exact', '/cockpit/tools/devices.html?device=device%3Adesktop-exact', '/cockpit/tools/devices.html?device=device%3Aunknown-exact']);
    assert.match(await page.locator('#nativeDevicesList').innerText(), /Control off/);
    assert.match(await page.locator('#nativeDevicesList > li').filter({ hasText: 'Unreported native device' }).innerText(), /Connection not reported.*Control not reported/s);
    assert.deepEqual(commands, []);
  } finally { await page.close(); }
});
test('a selected bridge stops offering setup when the fresh same-ID device no longer reports Linux', { timeout: 15000 }, async () => {
  let platform = 'linux';
  const page = await open({ width: 412, height: 915 }, async view => {
    await view.route('**/api/phone-control/computers/reports', route => route.fulfill({ json: { reports: [] } }));
    await view.route('**/api/computers', route => route.fulfill({ json: { computers: [{ id: 'spark-f255', name: 'Bridge fixture', platform, connected: true, can_control: true, tools: ['shell.exec','desktop.control'] }] } }));
    await view.route('**/api/computers/spark-f255', route => { platform = 'android'; return route.fulfill({ json: { id: 'spark-f255', name: 'Bridge fixture' } }); });
  });
  try {
    await page.getByRole('button', { name: 'Add a device', exact: true }).click();
    await page.locator('#computersBody button').click();
    assert.equal(await page.locator('#setupCard').isVisible(), true);
    await page.locator('#connectCloseBtn').click();
    await page.getByRole('button', { name: 'Details of Bridge fixture', exact: true }).click();
    await page.locator('.pc-details').getByText('Connection details', { exact: true }).click();
    await page.locator('.pc-details').getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByRole('textbox', { name: 'New name', exact: true }).fill('Renamed bridge fixture');
    await page.locator('.pc-details').getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('#computerRail > li').length === 0);
    await page.getByRole('button', { name: 'Add a device', exact: true }).click();
    assert.equal(await page.locator('#computersBody button').count(), 0);
    assert.equal(await page.locator('#setupCard').isHidden(), true);
    assert.equal(await page.locator('#nativeDevicesList a').first().getAttribute('href'), '/cockpit/tools/devices.html?device=device%3Aspark-f255');
  } finally { await page.close(); }
});
