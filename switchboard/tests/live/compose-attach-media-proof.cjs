/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.7.0 live proof of publishing with an attached image, on a loopback kernel (blue, :38798) as a throwaway test person granted the editor tier over switchboard, in a real Chromium at 412x915 (touch) and 1440x900. Before: the kernel's installed Compose route (0.6.7) answers POST /api/switchboard/compose/publish with a mediaRef as the person (it refuses before any send; the person has no X connection) and its served page has no Attach control. After (nothing delivered; the change lives only in this browser context): the Composer page is served from this checkout, the person's X connection and image provider are doubled in the browser (/compose/targets answers X connected, /compose/image answers a real PNG made here), and POST /compose/publish is answered by this checkout's COMPILED 0.7.0 route handler run in this process against a local fake of X's v2 API, so the request the page sent is the one the route uploads. The person writes a post, turns on Same text everywhere, generates an image, presses Attach to posts, sees the Attached image bar and "Posts with the attached image" on the X card, presses Publish and Confirm ("Post now with the image?") and reads "Published to X with the image"; the fake X records initialize/append/finalize/tweet with media_ids. A second run has X refuse the upload (403) and the card reads "Reconnect X in Connections … Nothing was posted"; Remove clears the image and the next publish sends none. The admin bearer is read from the env file, sent only to loopback and never printed; the person's session is a cookie on the kernel origin only. Clean-up: sign out everywhere (kernel and production copy), the tier set to deny, the person deactivated. Receipt and screenshots go to --out.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..', '..');
const STORE = path.resolve(PKG, '..');
const h = require(path.join(STORE, 'scripts', 'live-proof-person.cjs'));

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const BASE = h.loopback(args.base || 'http://127.0.0.1:38798');
const PRODUCTION = args.production ? h.loopback(args.production) : '';
const OUT = args.out;
if (!OUT || !args.env) throw new Error('usage: --env=<oshald.env of --base> --out=<dir> [--base=] [--production=]');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const receipt = { base: BASE, startedAt: new Date().toISOString(), before: {}, runs: [], cleanup: [], problems: [] };

/** @description The installer's bearer; never printed. @returns {string} Token. */
function adminToken() {
  const line = fs.readFileSync(args.env, 'utf8').match(/^OSHAL_ADMIN_TOKEN=(.*)$/m);
  if (!line) throw new Error('no OSHAL_ADMIN_TOKEN in the env file');
  return line[1].trim().replace(/^['"]|['"]$/g, '');
}

/** @description A confirmed admin write (POST /confirmations, then the call with x-oshal-confirm). @param {string} admin Bearer. @param {string} method Verb. @param {string} route Path. @param {object} body JSON. @returns {Promise<number>} Status. */
async function confirmed(admin, method, route, body) {
  const token = (await h.call(BASE, admin, 'POST', '/confirmations', {})).json.confirmation;
  const answer = await fetch(BASE + route, { method, headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json', 'x-oshal-confirm': token }, body: JSON.stringify(body) });
  return answer.status;
}

/** @description This checkout's compiled 0.7.0 POST /compose/publish handler with the framework modules stubbed. @returns {Function} Handler. */
function compiledPublish() {
  const handlers = new Map();
  const router = { get() { return router; }, post(p, ...fns) { handlers.set(p, fns[fns.length - 1]); return router; }, use() { return router; } };
  const stubs = {
    express: { Router: () => router },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: '' }) },
    '@/features/video-generation': { resolveStoryboardImageProvider: async () => ({}), recordStoryboardImageCost: async () => {} },
    '@/shared/security/explicit-write-confirmation': { hasExplicitWriteConfirmation: (b) => Boolean(b && b.confirm === true), confirmationRequiredPayload: () => ({ error: 'confirmation_required' }) },
  };
  const original = Module._load;
  Module._load = function (request, ...rest) { return Object.hasOwn(stubs, request) ? stubs[request] : original.call(this, request, ...rest); };
  try { require(path.join(PKG, 'routes', 'switchboard-compose-routes.js')).createComposeRoutes({ appPackageDir: PKG, pool: { query: async () => ({ rows: [] }) } }); } finally { Module._load = original; }
  return handlers.get('/publish');
}
const publishHandler = compiledPublish();

/** @description Answer one browser publish with the compiled route over a fake X. @param {object} body Request body. @param {number} refuse X's status for the upload (0 = accept). @returns {Promise<{status:number, body:object, xCalls:string[]}>} Answer. */
async function routePublish(body, refuse) {
  const xCalls = [];
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const saved = globalThis.fetch;
  process.env.OSHAL_EGRESS = 'kernel';
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    xCalls.push(`${init.method || 'GET'} ${u.host}${u.pathname}${init.headers && Object.keys(init.headers).some((k) => k.toLowerCase() === 'authorization') ? ' (CARRIED A CREDENTIAL)' : ''}`);
    if (u.pathname.endsWith('/initialize')) return refuse ? json({ title: 'Forbidden', status: refuse }, refuse) : json({ data: { id: '1880000000000000001' } });
    if (u.pathname.endsWith('/append')) return json({ data: { expires_at: 1 } });
    if (u.pathname.endsWith('/finalize')) return json({ data: { id: '1880000000000000001' } });
    if (u.pathname === '/2/tweets') { xCalls.push(`  tweet body media: ${JSON.stringify(JSON.parse(init.body).media || null)}`); return json({ data: { id: '1990000000000000002', text: 'x' } }, 201); }
    return json({}, 404);
  };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; } };
  try { await publishHandler({ oidc: { user: { sub: 'proof-person' } }, body }, res); } finally { globalThis.fetch = saved; delete process.env.OSHAL_EGRESS; }
  return { status: res.statusCode, body: res.body, xCalls };
}

/** @description A real PNG (a noisy gradient, about 1 MB) made by this browser. @param {object} browser Chromium. @returns {Promise<string>} Data URL. */
async function makeImage(browser) {
  const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
  await page.setContent('<canvas id=c width=720 height=720></canvas><script>const c=document.getElementById("c").getContext("2d");const g=c.createLinearGradient(0,0,720,720);g.addColorStop(0,"#1d4ed8");g.addColorStop(1,"#10b981");c.fillStyle=g;c.fillRect(0,0,720,720);const d=c.getImageData(0,0,720,720);for(let i=0;i<d.data.length;i+=4){const n=(Math.random()*60)|0;d.data[i]+=n;d.data[i+1]+=n;}c.putImageData(d,0,0);c.fillStyle="#fff";c.font="bold 64px sans-serif";c.fillText("Switchboard",150,380);</script>');
  const png = await page.locator('#c').screenshot();
  await page.close();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** @description The person's Compose page with this checkout's Composer and the doubled connection/image/publish. @returns {Promise<object>} One run's record. */
async function after(browser, person, width, image, refuse) {
  const context = await h.personContext(browser, BASE, person, width);
  await h.substitute(context, BASE, [{ route: '/api/switchboard/compose', file: path.join(PKG, 'tools', 'switchboard-compose.html') }, { route: '/api/switchboard/compose/', file: path.join(PKG, 'tools', 'switchboard-compose.html') }]);
  const sent = [];
  await context.route((url) => url.origin === BASE && url.pathname === '/api/switchboard/compose/targets', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ workspaceScoped: false, targets: [{ platform: 'x', label: 'X', limit: 280, publishable: true, connected: true, inWorkspace: true },
      { platform: 'linkedin', label: 'LinkedIn', limit: 3000, publishable: false, connected: true, inWorkspace: true }] }) }));
  await context.route((url) => url.origin === BASE && url.pathname === '/api/switchboard/compose/image', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ image, model: 'proof-fixture', provider: 'proof' }) }));
  await context.route((url) => url.origin === BASE && url.pathname === '/api/switchboard/compose/publish', async (route) => {
    const body = route.request().postDataJSON();
    const answered = await routePublish(body, refuse);
    sent.push({ platform: body.platform, confirm: body.confirm, mediaRefIsTheImage: body.mediaRef === image, mediaRefBytes: body.mediaRef ? Buffer.from(body.mediaRef.split(',')[1] || '', 'base64').length : 0,
      routeStatus: answered.status, routeAnswer: answered.body, xCalls: answered.xCalls });
    await route.fulfill({ status: answered.status, contentType: 'application/json', body: JSON.stringify(answered.body) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error.message || error)));
  await page.goto(`${BASE}/api/switchboard/compose`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#plats [data-p], #plats button, #plats .chip').length > 0, null, { timeout: 30000 }).catch(() => {});
  await page.fill('#src', 'Switchboard now posts your image with the text: one compose, one confirm.');
  await page.click('#sameTextSwitch');
  await page.click('#genBtn');
  await page.click('#imgToggle');
  await page.fill('#imgPrompt', 'A clean gradient card that says Switchboard');
  await page.click('#imgBtn');
  await page.waitForSelector('#imgPreview.show', { timeout: 15000 });
  await page.click('#imgAttach');
  await page.waitForSelector('#attachBar:not([hidden])');
  const xCard = page.locator('#variantsWrap .vcard[data-platform="x"]');
  const label = `${width}-${refuse ? 'x-refuses' : 'x-accepts'}`;
  const attached = await page.evaluate(() => ({ bar: !document.getElementById('attachBar').hidden, thumb: document.getElementById('attachThumb').naturalWidth > 0,
    xNote: document.querySelector('#variantsWrap .vcard[data-platform="x"] .medianote')?.textContent || '', scrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1 }));
  await xCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, `${label}-1-attached.png`) });
  await xCard.locator('.pubbtn').click();
  const ask = await xCard.locator('.confirmwrap .warnpub').textContent();
  await xCard.locator('.doconfirm').click();
  await xCard.locator('.res.show').waitFor({ timeout: 15000 });
  const result = (await xCard.locator('.res').textContent()).trim();
  await page.screenshot({ path: path.join(OUT, `${label}-2-published.png`) });
  let removed = null;
  if (!refuse) {
    await page.click('#attachRemove');
    await xCard.locator('.pubbtn').click();
    await xCard.locator('.doconfirm').click();
    await page.waitForFunction((n) => true, sent.length);
    await sleep(800);
    removed = { barHidden: await page.evaluate(() => document.getElementById('attachBar').hidden), lastSentHadMedia: sent.at(-1)?.mediaRefBytes > 0 };
    await page.screenshot({ path: path.join(OUT, `${label}-3-removed.png`) });
  }
  await context.close();
  return { width, refuse, attached, ask, result, removed, sent, pageErrors: errors };
}

/** @description What blue's installed 0.6.7 does today, as the person. @returns {Promise<object>} The before record. */
async function before(browser, person) {
  const live = await h.call(BASE, person.session, 'POST', '/api/switchboard/compose/publish', { platform: 'x', text: 'proof', mediaRef: 'data:image/png;base64,iVBORw0KGgo=', confirm: true });
  const context = await h.personContext(browser, BASE, person, 'phone');
  const page = await context.newPage();
  await page.goto(`${BASE}/api/switchboard/compose`, { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  const page067 = await page.evaluate(() => ({ attachControl: Boolean(document.getElementById('imgAttach')), downloadOnly: Boolean(document.getElementById('imgDl')) }));
  await page.screenshot({ path: path.join(OUT, 'before-0.6.7-phone.png') });
  await context.close();
  return { publishWithMedia: { status: live.status, error: live.json?.error, message: live.json?.message }, page: page067 };
}

/** @description Judge the runs. @returns {string[]} Problems. */
function judge() {
  const problems = [];
  if (receipt.before.publishWithMedia.status !== 501) problems.push(`before: expected 501 from 0.6.7, got ${receipt.before.publishWithMedia.status}`);
  for (const run of receipt.runs) {
    const tag = `${run.width} ${run.refuse ? 'refuse' : 'accept'}`;
    if (!run.attached.bar || !run.attached.thumb) problems.push(`${tag}: no Attached image bar with its thumbnail`);
    if (!/Posts with the attached image/.test(run.attached.xNote)) problems.push(`${tag}: X card says "${run.attached.xNote}"`);
    if (run.attached.scrollsSideways) problems.push(`${tag}: page scrolls sideways`);
    if (run.ask !== 'Post now with the image?') problems.push(`${tag}: confirm asks "${run.ask}"`);
    const first = run.sent[0];
    if (!first || !first.mediaRefIsTheImage) problems.push(`${tag}: publish did not carry the attached image`);
    if (!run.refuse && !/Published to X with the image/.test(run.result)) problems.push(`${tag}: result "${run.result}"`);
    if (!run.refuse && !first.xCalls.some((line) => /media_ids/.test(line))) problems.push(`${tag}: the post named no media id`);
    if (first && first.xCalls.some((line) => /CARRIED A CREDENTIAL/.test(line))) problems.push(`${tag}: a request carried a credential`);
    if (run.refuse && !/Reconnect X in Connections/.test(run.result)) problems.push(`${tag}: refusal read "${run.result}"`);
    if (run.refuse && first.xCalls.some((line) => /2\/tweets/.test(line))) problems.push(`${tag}: posted after a refused upload`);
    if (run.removed && (!run.removed.barHidden || run.removed.lastSentHadMedia)) problems.push(`${tag}: Remove left the image on the next publish`);
    if (run.pageErrors.length) problems.push(`${tag}: page errors ${run.pageErrors.join(' | ')}`);
  }
  return problems;
}

(async () => {
  const admin = adminToken();
  let person;
  let browser;
  try {
    person = await h.makePerson({ base: BASE, env: args.env, apps: [], label: 'switchboard-media-proof' });
    receipt.grant = await confirmed(admin, 'PUT', `/grants/${person.id}/switchboard`, { tier: 'editor' });
    browser = await h.chromium.launch();
    receipt.before = await before(browser, person);
    const image = await makeImage(browser);
    receipt.imageBytes = Buffer.from(image.split(',')[1], 'base64').length;
    for (const width of ['phone', 'desktop']) for (const refuse of [0, 403]) receipt.runs.push(await after(browser, person, width, image, refuse));
    receipt.problems = judge();
  } catch (error) {
    receipt.problems.push(`run stopped: ${String(error.message || error).slice(0, 300)}`);
  } finally {
    if (browser) await browser.close();
    if (person) {
      receipt.cleanup.push(...await h.cleanUp(BASE, person, PRODUCTION).catch((error) => [String(error.message)]));
      receipt.cleanup.push(`tier deny: ${await confirmed(admin, 'PUT', `/grants/${person.id}/switchboard`, { tier: 'deny' }).catch(() => 'failed')}`);
      receipt.cleanup.push(`deactivate: ${await confirmed(admin, 'POST', `/people/${person.id}/deactivate`, {}).catch(() => 'failed')}`);
    }
    receipt.finishedAt = new Date().toISOString();
    for (const run of receipt.runs) for (const s of run.sent) delete s.routeAnswer?.mediaRef;
    fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ before: receipt.before, runs: receipt.runs.map((r) => ({ width: r.width, refuse: r.refuse, ask: r.ask, result: r.result, removed: r.removed, xCalls: r.sent[0]?.xCalls })), cleanup: receipt.cleanup, problems: receipt.problems }, null, 1));
    process.exitCode = receipt.problems.length ? 1 : 0;
  }
})();
