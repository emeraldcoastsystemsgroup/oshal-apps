/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.2.8 (Roger, 2026-11-15, Android phone, SmartThings, Reconnect: "Could not start
 *   the connection: Failed to set the 'href' property on 'Location': The current window does not have permission to navigate
 *   the target frame to 'https://oshal.agenticfederal.us/api/connect/smar…"). Identity Hub in Chromium at 412x915 and
 *   1280x900, framed exactly as the shell frames a package page (the cockpit's PACKAGE_SURFACE_SANDBOX) and opened on its
 *   own, over a loopback fixture: a made-up provider on a second origin, the kernel's start (302 to the provider, or for a
 *   refused navigation 303 to Connections with the reason), its callback (303 to the saved return) and a stand-in for the
 *   kernel's connect window that announces the outcome as crates/api/src/connections.js does. Drives Reconnect to the end:
 *   in a browser with windows; in a web view without windows, where window.open spends the click's activation and hands
 *   back the top window (content/browser RenderFrameHostImpl::CreateNewWindow kReuse, as the Android app's WebView does);
 *   with pop-ups blocked; and a refused start. Made-up provider and person only; nothing leaves 127.0.0.1.
 *
 * Set OSHAL_KERNEL_PLATFORM to the kernel's platform folder to also check the sandbox string against the shell's own.
 * Set IDENTITY_CONNECT_SHOTS to a folder to keep screenshots (evidence only; never asserted).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PACKAGE = path.resolve(__dirname, '..');
const STORE = path.resolve(PACKAGE, '..');
const { chromium } = require(path.join(STORE, 'scripts/toolchain/node_modules/playwright'));

/** The allow-list the cockpit gives a package surface (platform/src/pages/cockpit/js/cockpit-view-controller.js). */
const SHELL_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-top-navigation-by-user-activation';
const PHONE = { width: 412, height: 915 };
const DESKTOP = { width: 1280, height: 900 };
const REFUSAL = 'This installation has no public web address yet, so SmartThings cannot be connected here.';

/**
 * A web view without windows, in the identity frame only: window.open navigates the TOP window to the address it was
 * given and returns it, after the browser has spent the click's activation (opening a real window spends it the same way).
 */
const WEB_VIEW_WITHOUT_WINDOWS = `if (location.pathname.startsWith('/api/identity/')) {
  const realOpen = window.open;
  window.open = function (url, target, features) {
    const top = window.top;
    if (url) top.location.href = new URL(url, location.href).href;
    const spent = realOpen.call(window, 'about:blank', '_blank'); if (spent) spent.close();
    return /noopener/i.test(String(features || '')) ? null : top;
  };
}`;
/** Pop-ups blocked: window.open answers nothing, in the identity frame only. */
const NO_WINDOWS = `if (location.pathname.startsWith('/api/identity/')) window.open = function () { return null; };`;

function listen(handler) {
  return new Promise((resolve) => { const server = http.createServer(handler); server.listen(0, '127.0.0.1', () => resolve(server)); });
}

/** The kernel's safe_return rule (crates/api/src/connectors_api.rs). */
function safeReturn(p) {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\') && p.length <= 512 && !/[\u0000-\u001f\\]/.test(p) ? p : null;
}

/** The installation and the made-up provider, both on loopback. */
async function fixture() {
  const state = { connected: false, refuse: false, states: new Map(), starts: [] };
  const provider = await listen((req, res) => {
    const u = new URL(req.url, 'http://provider');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Made-up provider</title><h1 id="consent">Made-up Home sign-in</h1>
      <a id="allow" href="${state.base}/api/connect/${encodeURIComponent(u.searchParams.get('provider'))}/callback?code=made-up&amp;state=${encodeURIComponent(u.searchParams.get('state'))}">Allow</a>`);
  });
  const providerBase = `http://127.0.0.1:${provider.address().port}`;
  const site = await listen((req, res) => {
    const u = new URL(req.url, 'http://site');
    const html = (body) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(body); };
    if (u.pathname === '/cockpit/') {
      return html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shell</title>
        <style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style>
        <iframe loading="eager" src="/api/identity/" allow="microphone; fullscreen" sandbox="${SHELL_SANDBOX}"></iframe>`);
    }
    if (u.pathname === '/api/identity/') return html(fs.readFileSync(path.join(PACKAGE, 'tools/identity.html'), 'utf8'));
    if (u.pathname === '/api/connect/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ providers: [{ id: 'smartthings', label: 'SmartThings', auth: 'oauth', category: 'iot', configured: true,
        connected: state.connected, status: state.connected ? 'connected' : 'expired', connections: [] }] }));
    }
    const start = /^\/api\/connect\/([a-z-]+)\/start$/.exec(u.pathname);
    if (start) {
      state.starts.push({ id: start[1], mode: req.headers['sec-fetch-mode'], back: u.searchParams.get('return') });
      if (state.refuse) {
        if (req.headers['sec-fetch-mode'] !== 'navigate') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ detail: REFUSAL, refused: 'invalid_request' })); }
        res.writeHead(303, { location: `/utilities?connect_error=${start[1]}&reason=${encodeURIComponent(REFUSAL)}` });
        return res.end();
      }
      const id = String(state.states.size + 1);
      state.states.set(id, safeReturn(u.searchParams.get('return')));
      res.writeHead(302, { location: `${providerBase}/consent?provider=${start[1]}&state=${id}` });
      return res.end();
    }
    const callback = /^\/api\/connect\/([a-z-]+)\/callback$/.exec(u.pathname);
    if (callback) {
      state.connected = true;
      res.writeHead(303, { location: state.states.get(u.searchParams.get('state')) || `/utilities?connected=${callback[1]}` });
      return res.end();
    }
    if (u.pathname === '/utilities') {
      // The kernel's connect window (crates/api/src/connections.js connectOutcome, announceOutcome, finishConnectWindow).
      return html(`<!doctype html><title>Connections</title><p id="outcome"></p><script>
        const q = new URLSearchParams(location.search), failed = q.get('connect_error'), connected = q.get('connected');
        const text = failed ? 'SmartThings was not connected. ' + (q.get('reason') || '') : 'SmartThings is connected.';
        document.getElementById('outcome').textContent = text;
        const channel = new BroadcastChannel('oshal-connections');
        channel.postMessage({ type: 'connect-outcome', connector: failed || connected, ok: !failed, text });
        channel.close();
        if (q.get('window') === 'connect' && connected) setTimeout(() => window.close(), 1500);
      </script>`);
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{}');
  });
  state.base = `http://127.0.0.1:${site.address().port}`;
  state.providerBase = providerBase;
  state.close = () => { for (const server of [site, provider]) { server.close(); server.closeAllConnections(); } };
  return state;
}

/** Evidence pictures when IDENTITY_CONNECT_SHOTS names a folder. */
async function shot(page, name) {
  if (!process.env.IDENTITY_CONNECT_SHOTS) return;
  fs.mkdirSync(process.env.IDENTITY_CONNECT_SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.IDENTITY_CONNECT_SHOTS, `${name}.png`) });
}

/** Open Identity Hub framed by the shell or on its own; `init` is a script every frame runs first. */
async function openHub(browser, site, size, framed, init) {
  const context = await browser.newContext({ viewport: size });
  context.setDefaultTimeout(10000);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(site.base + (framed ? '/cockpit/' : '/api/identity/'));
  const hub = framed ? page.frameLocator('iframe') : page;
  await hub.locator('#accounts [data-start="smartthings"]').waitFor();
  return { context, page, hub, errors };
}

/** The window the made-up provider's sign-in is showing in, once it is there. */
async function consentPage(context) {
  for (let i = 0; i < 100; i++) {
    const found = context.pages().find((p) => p.url().startsWith('http://127.0.0.1') && p.url().includes('/consent?provider=smartthings'));
    if (found) return found;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the provider sign-in never opened; pages: ' + context.pages().map((p) => p.url()).join(', '));
}

let browser;
test.before(async () => {
  if (process.env.OSHAL_KERNEL_PLATFORM) {
    const shell = fs.readFileSync(path.join(process.env.OSHAL_KERNEL_PLATFORM, 'src/pages/cockpit/js/cockpit-view-controller.js'), 'utf8');
    assert.match(shell, new RegExp(`PACKAGE_SURFACE_SANDBOX = '${SHELL_SANDBOX}'`), 'the shell frames a package page with this sandbox');
  }
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { if (browser) await browser.close(); });

for (const [where, size] of [['phone', PHONE], ['desktop', DESKTOP]]) {
  for (const framed of [true, false]) {
    const name = `${where}-${framed ? 'framed' : 'own'}`;
    test(`${name}: Reconnect opens the sign-in in its own window, and the hub reads Connected when it finishes`, async () => {
      const site = await fixture();
      const { context, page, hub, errors } = await openHub(browser, site, size, framed);
      try {
        await hub.locator('#accounts [data-start="smartthings"]').click();
        const consent = await consentPage(context);
        assert.notEqual(consent, page, 'the hub stays where it was');
        await hub.getByText('Waiting for SmartThings. Finish signing in in the window that opened.').waitFor();
        assert.deepEqual(site.starts.map((s) => [s.mode, s.back]), [['navigate', '/utilities?connected=smartthings&window=connect']], 'one start, a navigation, nothing fetched first');
        await shot(page, `after-${name}-waiting`);
        await consent.locator('#allow').click();
        await hub.getByText('SmartThings is connected.').waitFor();
        await hub.locator('#accounts .pill.ok', { hasText: 'Connected' }).waitFor();
        await consent.waitForEvent('close', { timeout: 5000 });
        await shot(page, `after-${name}-connected`);
        assert.deepEqual(errors, []);
      } finally { await context.close(); site.close(); }
    });
  }
}

for (const [where, size] of [['phone', PHONE], ['desktop', DESKTOP]]) {
  test(`${where}-framed, a web view without windows: the same click takes the whole window to the sign-in`, async () => {
    const site = await fixture();
    const { context, page, hub, errors } = await openHub(browser, site, size, true, WEB_VIEW_WITHOUT_WINDOWS);
    try {
      await hub.locator('#accounts [data-start="smartthings"]').click();
      await page.waitForURL((url) => url.href.startsWith(site.providerBase + '/consent?provider=smartthings'));
      assert.deepEqual(site.starts.map((s) => s.mode), ['navigate']);
      await shot(page, `after-${where}-framed-webview`);
      assert.deepEqual(errors, []);
    } finally { await context.close(); site.close(); }
  });

  test(`${where}-framed, pop-ups blocked: the click takes the whole window to the sign-in and it comes back to the hub`, async () => {
    const site = await fixture();
    const { context, page, hub, errors } = await openHub(browser, site, size, true, NO_WINDOWS);
    try {
      await hub.locator('#accounts [data-start="smartthings"]').click();
      await page.waitForURL((url) => url.href.startsWith(site.providerBase + '/consent?provider=smartthings'));
      assert.deepEqual(site.starts.map((s) => s.back), ['/cockpit/'], 'it returns to the shell it left');
      await page.locator('#allow').click();
      await page.waitForURL(site.base + '/cockpit/');
      await page.frameLocator('iframe').locator('#accounts .pill.ok', { hasText: 'Connected' }).waitFor();
      await shot(page, `after-${where}-framed-blocked`);
      assert.deepEqual(errors, []);
    } finally { await context.close(); site.close(); }
  });
}

test('a refused start: the hub says the kernel\'s reason, and Reconnect can be pressed again', async () => {
  const site = await fixture();
  site.refuse = true;
  const { context, page, hub, errors } = await openHub(browser, site, PHONE, true);
  try {
    await hub.locator('#accounts [data-start="smartthings"]').click();
    await hub.getByText(`SmartThings was not connected. ${REFUSAL}`).waitFor();
    assert.equal(await hub.locator('#review .err').count(), 1, 'said as a refusal');
    await shot(page, 'after-phone-framed-refused');
    await hub.locator('#accounts [data-start="smartthings"]').click();
    for (let i = 0; i < 100 && site.starts.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(site.starts.length, 2, 'the second press starts again');
    await hub.getByText(`SmartThings was not connected. ${REFUSAL}`).waitFor();
    assert.deepEqual(errors, []);
  } finally { await context.close(); site.close(); }
});
