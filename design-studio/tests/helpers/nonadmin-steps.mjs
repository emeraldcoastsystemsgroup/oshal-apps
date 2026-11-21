/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.4.14 (BACKLOG B12): the `check` of the non-administrator proof. At each size it signs the test person in on the kernel's own sign-in page, opens Design Studio in the cockpit and runs four steps through Design Studio's own screens: New product (the walkthrough and Create), a part the design partner builds from the rail (one message; the open page runs the partner's order with the person's session), Simulate (the other parts of a lift ordered through the same order route and built by the page, the mechanism on the Mechanism screen, Build the plant, Run the baselines) and Make the print set. Each step ends passed, not-run (with the reason: an engine that is not running here, or a partner that answered without building) or failed; any 401 or 403 from the five applications is a failure whatever the step says. It never presses Send to printer and stops every write to the print service.
 */
import fs from 'node:fs';
import path from 'node:path';
import { http, message, playwright, say, until, wait } from './nonadmin-proof.mjs';

const COCKPIT = '/cockpit/?app=design-studio';
const STUDIO = /\/api\/design-studio\/app/;
const RAIL = /\/api\/jarvis\/\?concierge=design-studio/;
const SIZES = [{ width: 1440, height: 900, touch: false }, { width: 412, height: 915, touch: true }];
/** Writes the steps make, by path; anything else that is not a read is stopped and listed. The print service is never written to. */
const WRITES = [/^\/sessions$/, /^\/api\/design-studio\//, /^\/api\/cad-studio\//, /^\/api\/circuit-lab\//, /^\/api\/embodied\/physics\/plant\//, /^\/api\/swarm\/bots\/[^/]+\/ask$/, /^\/api\/jarvis\//, /^\/api\/cockpit\/recents$/, /^\/api\/ui\//, /^\/api\/surface\//];
const OWN = /^\/api\/(design-studio|cad-studio|circuit-lab|embodied|scan-to-print)\//;
/** A made-up lift: the brief Design Studio's own lift example states, and its three parts as CAD Studio programs. */
const BRIEF = { what: 'a lifting machine: a motor-driven carriage on a column raises a load from a flat base',
  requirements: ['lifts 2 kg to 300 mm in 5 s', 'one motor drives the carriage up a column', 'stands on a flat base plate'] };
const PARTS = [
  { part: 'base-plate', name: 'Base plate', base: { kind: 'box', sizeX: 200, sizeY: 200, sizeZ: 10 }, features: [{ id: 'foot-pp', type: 'hole', params: { diameter: 5, axis: 'z', x: 85, y: 85 }, label: 'a foot screw' }] },
  { part: 'column', name: 'Column', base: { kind: 'box', sizeX: 40, sizeY: 40, sizeZ: 400 }, features: [{ id: 'cap-pin', type: 'hole', params: { diameter: 6, axis: 'y', x: 0, z: 390 }, label: 'the end-stop pin' }] },
  { part: 'carriage', name: 'Carriage', base: { kind: 'box', sizeX: 80, sizeY: 60, sizeZ: 40 }, features: [{ id: 'bore', type: 'box-cut', params: { size: [42, 42, 42], center: [0, 0, 20] }, label: 'rides the column' }, { id: 'set-screw', type: 'hole', params: { diameter: 5, axis: 'x', y: 25, z: 20 }, label: 'the rack clamp' }] },
];
/** The message to the design partner. It carries the part's program as CAD Studio's contract writes it, so the turn proves the partner's order and the person's access, not the model's skill at writing a program. */
const ASK = (name) => `In my product "${name}", build one part in CAD Studio and bind it to the Design phase: the Carriage, a box 80 by 60 by 40 mm with a square bore that rides the column and one clamp hole. File one cad-create order with exactly this input: {"name":"Carriage","base":${JSON.stringify(PARTS[2].base)},"features":${JSON.stringify(PARTS[2].features)}}. Then tell me the mass the kernel reports.`;
/** The lifecycle states of an engine nobody has asked yet that is not stopped (the kernel's engine.status words). */
const WAITING = ['pinned', 'ready', 'running', 'preparing', 'not-prepared'];
const MOTOR = 'sts3215-12v';

const passed = (detail) => ({ status: 'passed', ...detail });
const notRun = (why, detail = {}) => ({ status: 'not-run', why, ...detail });
const failed = (why, detail = {}) => ({ status: 'failed', why, ...detail });

/** @description Stop every request of this context that is not a read or one of the steps' own writes; note each answer of the five applications that refuses. */
async function guard(context, origin, row) {
  await context.route((url) => new URL(url).origin === origin, (route) => {
    const request = route.request(), where = new URL(request.url()).pathname, method = request.method();
    if (method === 'GET' || method === 'HEAD') return route.continue();
    if (!/^\/api\/scan-to-print\//.test(where) && WRITES.some((allowed) => allowed.test(where))) return route.continue();
    let from = '';
    try { from = new URL(request.frame().url()).pathname; } catch { from = ''; } // a request with no frame left is listed without one
    row.stopped.push(`${method} ${where} (from ${from})`);
    return route.abort();
  });
  context.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin !== origin || !OWN.test(url.pathname)) return;
    if (response.status() === 401 || response.status() === 403) row.refusals.push(`${response.status()} ${response.request().method()} ${url.pathname}`);
    if (/^\/api\/design-studio\/orders\/[^/]+\/finish$/.test(url.pathname)) response.json().then((body) => row.orders.push(orderLine(body.order)), () => row.orders.push(null));
  });
}

/** @description What the receipt keeps of one finished order: its action, how it ended, the engine's status and its reason in the engine's words. */
function orderLine(order) {
  const result = (order && order.result) || {};
  const engine = result.engine || {};
  const why = result.refused || engine.message || engine.error || (engine.build && engine.build.reason) || (result.build && (result.build.reason || result.build.error)) || '';
  return { action: order.action, status: order.status, http: result.status || null, why: String(typeof why === 'string' ? why : JSON.stringify(why)).slice(0, 240) };
}

/** @description Sign in on the kernel's own sign-in page as the person, landing on Design Studio in the cockpit; answers Design Studio's frame. */
async function signInAndOpen(page, origin, person) {
  await page.goto(`${origin}/login?next=${encodeURIComponent(COCKPIT)}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#loginTokenBox > summary').click();
  await page.locator('#loginTokenValue').fill(person.token);
  await page.locator('#loginToken button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname.startsWith('/cockpit'), { timeout: 90000 });
  return studio(page, 'products');
}

/** @description Design Studio's frame once the named screen has finished its reads. */
function studio(page, screen) {
  return until(async () => {
    const frame = page.frames().find((one) => STUDIO.test(one.url()));
    return frame && (await frame.locator(`#studio[data-ready="1"][data-screen="${screen}"]`).count()) && frame;
  }, 120000, `Design Studio's ${screen} screen`);
}

/** @description Have the open page read its product again (the page's own reload op, the one the design partner drives it with), and wait for that read. */
async function reread(page, frame) {
  const before = Number(await frame.locator('#studio').getAttribute('data-reads'));
  await frame.evaluate(() => document.dispatchEvent(new CustomEvent('surface-bridge:custom', { detail: { name: 'design_action', data: { op: 'reload' } } })));
  await until(async () => Number(await frame.locator('#studio').getAttribute('data-reads')) > before && (await frame.locator('#studio[data-ready="1"]').count()), 120000, 'the product page reading again');
  return studio(page, 'product');
}

/** @description What the open screen shows that the receipt keeps: its posters and whether anything is wider than the screen. */
function shown(frame) {
  return frame.evaluate(() => ({
    title: document.getElementById('title').textContent.trim(),
    posters: [...document.querySelectorAll('#screen-product .poster')].map((poster) => ({ phase: poster.id.replace(/^poster-/, ''), engine: poster.dataset.engine, stage: poster.dataset.stage,
      line: (poster.querySelector('.stage') || { textContent: '' }).textContent.trim().slice(0, 240), button: (poster.querySelector('.act button, .act a') || { textContent: '' }).textContent.trim() })),
    liveness: (document.getElementById('engine-liveness') || { textContent: '' }).textContent.trim().slice(0, 300),
    sideways: document.scrollingElement.scrollWidth > window.innerWidth + 1,
  }));
}

/** @description Whether each engine a step needs is running here, read as the person, in the engine's own words. An engine nobody has asked yet is taken as running; its first request decides. */
async function engines(origin, token) {
  const cad = (await http(origin, token, 'GET', '/api/cad-studio/capabilities', { accepted: null })).body || {};
  const emb = (await http(origin, token, 'GET', '/api/embodied/physics/status', { accepted: null })).body || {};
  const state = (info) => {
    if (!info) return { running: false, reason: 'no answer' };
    const life = info.lifecycle && info.lifecycle.state;
    if (info.connected === false && info.contacted === false && !info.lastError && WAITING.includes(life)) return { running: true, asked: false, reason: '' };
    if (info.connected === false || info.ready === false) return { running: false, reason: String(info.reason || info.lastError || info.error || (life === 'none' ? 'this installation has no engine for it' : 'the engine container is stopped or unreachable')).slice(0, 200) };
    return { running: true, asked: true, reason: '' };
  };
  return { 'cad-studio': state(cad.engine), embodied: state(emb.engine) };
}

/** @description Whether an order ended because the engine could not be reached (not because of what was ordered). */
const unreachable = (order) => order.http === 503 || /could not reach the engine|no engine is configured|capability_unavailable/i.test(order.why || '');

/** @description Step 1, New product: the walkthrough writes the brief, the chain is proposed, Create opens the product. */
async function newProduct(page, frame, name) {
  await frame.locator('#new-product').click();
  await frame.locator('#screen-new:not([hidden]) #new-name').waitFor({ timeout: 60000 });
  await frame.locator('#new-name').fill(name);
  await frame.locator('#new-what').fill(BRIEF.what);
  await frame.locator('#new-requirements').fill(BRIEF.requirements.join('\n'));
  await frame.locator('#proposal li[data-kind="simulate"]').waitFor({ timeout: 60000 });
  const proposed = await frame.locator('#proposal li[data-kind]').evaluateAll((items) => items.map((item) => `${item.dataset.kind}:${item.querySelector('.engine').textContent}`));
  await frame.locator('#create').click();
  frame = await studio(page, 'product');
  const id = decodeURIComponent((await frame.evaluate(() => location.hash)).replace(/^#\/product\//, ''));
  const view = await shown(frame);
  const engine = (phase) => (view.posters.find((poster) => poster.phase === phase) || {}).engine;
  if (!/^[0-9a-f-]{36}$/.test(id)) return { frame, id: null, step: failed('Create did not open a product', { proposed }) };
  if (engine('design') !== 'cad-studio' || engine('simulate') !== 'embodied' || !engine('fabricate')) return { frame, id, step: failed('the proposed chain is not design on CAD Studio, simulate on embodied and fabricate', { proposed }) };
  return { frame, id, step: passed({ product: id, proposed, posters: view.posters.length, sideways: view.sideways }) };
}

/** @description The person's CAD Studio parts that belong to the product, by the part each was built as. */
async function builtParts(origin, token, id) {
  const models = ((await http(origin, token, 'GET', '/api/cad-studio/models')).body || {}).models || [];
  return models.filter((model) => model.source && model.source.designStudio && model.source.designStudio.project === id)
    .map((model) => ({ part: model.source.designStudio.part, modelId: model.model_id, state: model.state, massG: model.report ? model.report.massG : null }));
}

/** @description Open the design partner's rail (the cockpit's Concierge button) and send one message; answers the rail's frame. */
async function askPartner(page, text) {
  if (await page.locator('#chatPanel.collapsed').count()) await page.locator('#jarvisOrbFab').click();
  await page.locator('#chatPanel:not(.collapsed)').waitFor({ timeout: 60000 });
  const frame = await until(() => page.frames().find((one) => RAIL.test(one.url())), 60000, 'the design partner\'s rail');
  await frame.locator('#typein').fill(text);
  await frame.locator('#typer button[type="submit"]').click();
  return frame;
}

/** @description Close the rail (it covers a phone-wide screen), so the product page is in front again. */
async function closeRail(page, rail) {
  if (await page.locator('#chatPanel.collapsed').count()) return;
  await rail.locator('button.jc-panel-close').click();
  await page.locator('#chatPanel.collapsed').waitFor({ timeout: 30000 });
}

/** @description The partner's newest answer once it has stopped changing, or '' when none came in time. */
async function partnerAnswer(rail, ms) {
  let last = '', same = 0;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const text = await rail.locator('#convo .msg.bot .bx').last().innerText().catch(() => '');
    if (text && !/^Thinking/.test(text.trim()) && text === last) { same += 1; if (same >= 3) return text.trim(); } else same = 0;
    last = text;
    await wait(2000);
  }
  return last && !/^Thinking/.test(last.trim()) ? last.trim() : '';
}

/** @description Step 2, a partner-built part: one message on the rail; the partner files an order and the open page builds the part with the person's session. */
async function partnerPart({ page, origin, person, id, name, row, running }) {
  const before = row.orders.length;
  const rail = await askPartner(page, ASK(name));
  const answer = await partnerAnswer(rail, 420000);
  await closeRail(page, rail);
  const mine = row.orders.slice(before).filter(Boolean);
  const made = (await builtParts(origin, person.token, id)).filter((part) => part.state === 'built');
  const detail = { orders: mine, answer: answer.slice(0, 400), built: made };
  const creates = mine.filter((order) => order.action === 'cad-create');
  if (made.length) return passed(detail);
  if (!answer && !mine.length) return failed('the design partner did not answer within 7 minutes', detail);
  if (/no tier|not granted|not authori[sz]ed|access required/i.test(answer) && !mine.length) return failed('the design partner\'s turn was refused', detail);
  if (!creates.length) return notRun('the design partner answered without ordering the part (the model\'s choice; nothing was refused)', detail);
  if (creates.some(unreachable) || !running['cad-studio'].running) return notRun(`the design partner ordered the part and CAD Studio's engine is not running here: ${creates.find(unreachable) ? creates.find(unreachable).why : running['cad-studio'].reason}`, detail);
  if (creates.some((order) => order.http === 401 || order.http === 403)) return failed('the design partner ordered the part and CAD Studio refused the person', detail);
  return notRun(`the design partner ordered the part ${creates.length} time${creates.length === 1 ? '' : 's'} and CAD Studio refused the program the model wrote, not the person: ${creates[0].why}`, detail);
}

/** @description File one part through the order route the partner's tool calls; the open page claims it and builds it with the person's session. */
function orderPart(frame, id, part) {
  return frame.evaluate(async ({ project, input }) => {
    const answer = await fetch(`/api/design-studio/projects/${encodeURIComponent(project)}/orders`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cad-create', input, waitMs: 40000 }) });
    const body = await answer.json().catch(() => null);
    const order = body && body.order ? body.order : {};
    const result = order.result || {};
    const engine = result.engine || {};
    return { http: answer.status, status: order.status || null, engineHttp: result.status || null, why: String(result.refused || engine.message || engine.error || (engine.build && engine.build.reason) || '').slice(0, 240) };
  }, { project: id, input: { name: part.name, base: part.base, features: part.features } });
}

/** @description Fill the Mechanism screen for the lift (ground, a fixed column, the carriage's driven slide, the payload) and save it. */
async function defineMechanism(page, frame) {
  await frame.locator('#act2-design').click();
  frame = await studio(page, 'mechanism');
  await frame.locator('#mech-base').selectOption('base-plate');
  const joint = async (n, fields) => {
    await frame.locator('#mech-add-joint').click();
    for (const [field, value] of Object.entries(fields)) {
      const control = frame.locator(`#j${n}-${field}`);
      if (/^(parent|child|type|motor)$/.test(field)) await control.selectOption(value); else await control.fill(String(value));
    }
  };
  await joint(0, { id: 'column-mount', parent: 'base-plate', child: 'column', type: 'fixed', 'axis-x': 0, 'axis-y': 0, 'axis-z': 1, 'origin-z': 10 });
  const rows = await frame.locator('#j0-motor option:not([disabled])').evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
  if (!rows.length) return { frame, motor: null };
  const motor = rows.includes(MOTOR) ? MOTOR : rows[0];
  await joint(1, { id: 'carriage-slide', parent: 'column', child: 'carriage', type: 'slide', 'axis-x': 0, 'axis-y': 0, 'axis-z': 1, lo: 0, hi: 0.35, motor, ratio: 40 });
  await frame.locator('#mech-payload-mass').fill('2');
  await frame.locator('#mech-payload-part').selectOption('carriage');
  await frame.locator('#mech-save').click();
  const saved = await until(async () => (await frame.locator('#studio[data-ready="1"][data-screen="product"]').count()) || (await frame.locator('.toast.error').count() ? 'refused' : null), 120000, 'the mechanism being saved');
  if (saved === 'refused') return { frame, motor, refused: ((await frame.locator('.toast.error').last().textContent().catch(() => '')) || 'the page refused it').slice(0, 300) };
  return { frame: await studio(page, 'product'), motor };
}

/** @description Press a poster's button by its words and wait for the poster to reach one of the stages; answers the stage and what the page said. */
async function press(page, frame, phase, label, stages, ms) {
  const button = frame.locator(`#act-${phase}`);
  const words = (await button.textContent().catch(() => '') || '').trim();
  if (words !== label || await button.isDisabled()) return { pressed: false, button: words, stage: (await shown(frame)).posters.find((poster) => poster.phase === phase) };
  await button.click();
  const reached = await until(async () => {
    const stage = await frame.locator(`#poster-${phase}`).getAttribute('data-stage').catch(() => null);
    return stages.includes(stage) && stage;
  }, ms, `the ${phase} poster after ${label}`).catch((error) => ({ error: message(error) }));
  const said = await frame.locator('.toast').last().textContent().catch(() => '');
  return { pressed: true, stage: typeof reached === 'string' ? reached : null, error: reached && reached.error, said: (said || '').slice(0, 300) };
}

/** @description Step 3, Simulate: the lift's remaining parts built through the page, the mechanism defined, Build the plant, Run the baselines. */
async function simulate({ page, origin, person, id, row, running }) {
  let frame = await studio(page, 'product');
  if (!running['cad-studio'].running) return { frame, step: notRun(`a plant is built from CAD Studio's parts and CAD Studio's engine is not running here: ${running['cad-studio'].reason}`) };
  const have = new Set((await builtParts(origin, person.token, id)).filter((part) => part.state === 'built').map((part) => part.part));
  const ordered = [];
  for (const part of PARTS.filter((one) => !have.has(one.part))) ordered.push({ part: part.part, ...(await orderPart(frame, id, part)) });
  const parts = (await builtParts(origin, person.token, id)).filter((part) => part.state === 'built');
  if (PARTS.some((one) => !parts.some((part) => part.part === one.part))) {
    const down = ordered.find((one) => one.engineHttp === 503 || /could not reach the engine|no engine is configured/i.test(one.why));
    return { frame, step: down ? notRun(`a plant is built from CAD Studio's parts and CAD Studio's engine is not running here: ${down.why}`, { ordered }) : failed('the lift\'s three parts are not all built in CAD Studio', { ordered, parts }) };
  }
  frame = await reread(page, frame);
  const bound = await until(async () => (await frame.locator('#design-figure').textContent().catch(() => '')) === `${PARTS.length}/${PARTS.length}`, 90000, 'the Design poster reading three of three parts built').catch((error) => message(error));
  if (bound !== true) return { frame, step: failed('the three parts are built and the Design poster does not show them bound', { ordered, parts, poster: (await shown(frame)).posters.find((one) => one.phase === 'design'), bound }) };
  const mechanism = await defineMechanism(page, frame);
  frame = mechanism.frame;
  if (mechanism.refused) return { frame, step: failed(`the mechanism was not saved: ${mechanism.refused}`, { ordered }) };
  if (!mechanism.motor) return { frame, step: notRun('embodied published no motor row a joint can be driven by', { ordered }) };
  if (!running.embodied.running) return { frame, step: notRun(`the mechanism is saved and embodied's engine is not running here: ${running.embodied.reason}`, { ordered, motor: mechanism.motor }) };
  const built = await press(page, frame, 'simulate', 'Build the plant', ['built', 'baseline', 'trained', 'certified'], 180000);
  if (!built.stage) return { frame, step: failed('Build the plant did not build a plant', { ordered, motor: mechanism.motor, built }) };
  const baseline = await press(page, frame, 'simulate', 'Run the baselines', ['baseline', 'trained', 'certified'], 300000);
  const poster = (await shown(frame)).posters.find((one) => one.phase === 'simulate');
  const detail = { ordered, motor: mechanism.motor, built: built.said, baseline: baseline.said, stage: poster.stage, line: poster.line, notPressed: 'Train the policy and Certify (a training run is minutes to hours)' };
  return { frame, step: baseline.stage ? passed(detail) : failed('Run the baselines did not reach a baseline', { ...detail, baselineRun: baseline }) };
}

/** @description Step 4, Make the print set: every bound part exported through CAD Studio and checked watertight by this package. */
async function printSet(page, frame) {
  frame = await studio(page, 'product');
  const button = frame.locator('#act-fabricate');
  const words = (await button.textContent().catch(() => '') || '').trim();
  if (words !== 'Make the print set' || await button.isDisabled()) {
    const poster = (await shown(frame)).posters.find((one) => one.phase === 'fabricate');
    return poster && poster.stage === 'unbound' ? notRun('no part is bound to the Design phase, so there is nothing to print (the Simulate step says why no part was built)', { poster }) : failed('the Fabricate poster does not offer Make the print set', { poster });
  }
  await button.click();
  await frame.locator('#make-dialog[open] #make-close:not([disabled])').waitFor({ timeout: 300000 });
  const made = await frame.evaluate(() => ({ sha: document.getElementById('make-result').dataset.sha, result: document.getElementById('make-result').textContent.trim().slice(0, 400),
    parts: [...document.querySelectorAll('#make-steps li')].map((item) => ({ part: item.dataset.part, state: item.dataset.state })) }));
  await frame.locator('#make-close').click();
  const stage = await until(async () => { const now = await frame.locator('#poster-fabricate').getAttribute('data-stage'); return now === 'fabricated' && now; }, 120000, 'the Fabricate poster reading fabricated').catch((error) => message(error));
  if (!made.sha || !made.parts.length || made.parts.some((part) => part.state !== 'exported')) return failed('the print set is not every part exported watertight', { ...made, stage });
  return stage === 'fabricated' ? passed({ ...made, stage }) : failed('the set was made and the Fabricate poster does not read fabricated', { ...made, stage });
}

/** @description The four steps of one size on a signed-in page, each with its screenshot. */
async function steps({ page, frame, origin, person, size, out, row }) {
  const label = `${size.width}x${size.height}`;
  const shot = (name) => page.screenshot({ path: path.join(out, `nonadmin-${label}-${name}.png`) });
  const name = `b12 lift ${size.width} ${person.subject.slice(-6)}`;
  const running = row.engines = await engines(origin, person.token);
  await shot('1-products');
  const made = await newProduct(page, frame, name);
  row.steps.newProduct = made.step; frame = made.frame;
  await shot('2-new-product');
  if (!made.id) return;
  row.steps.partnerPart = await partnerPart({ page, origin, person, id: made.id, name, row, running });
  await shot('3-partner-part');
  const sim = await simulate({ page, origin, person, id: made.id, row, running });
  row.steps.simulate = sim.step;
  await shot('4-simulate');
  row.steps.printSet = await printSet(page, sim.frame);
  await shot('5-print-set');
  const view = await shown(await studio(page, 'product'));
  row.sideways = view.sideways; row.posters = view.posters;
  if (view.sideways) row.failures.push('the product page is wider than the screen');
}

/** @description One size: sign in, run the steps, sign out. */
async function checkSize(browser, origin, person, size, out, receipt) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.touch, hasTouch: size.touch, deviceScaleFactor: size.touch ? 2.625 : 1 });
  const row = { size: `${size.width}x${size.height}`, steps: {}, failures: [], refusals: [], stopped: [], orders: [], errors: [] };
  receipt.sizes.push(row);
  try {
    await guard(context, origin, row);
    const page = await context.newPage();
    page.on('pageerror', (error) => row.errors.push(message(error).slice(0, 160)));
    const frame = await signInAndOpen(page, origin, person);
    await steps({ page, frame, origin, person, size, out, row });
    const own = row.stopped.filter((line) => /\(from \/api\/design-studio\//.test(line));
    if (own.length) row.failures.push(`Design Studio tried a write the check does not permit: ${own.join('; ')}`);
  } catch (error) { row.failures.push(message(error)); }
  finally {
    if (row.refusals.length) row.failures.push(`an application refused the person: ${[...new Set(row.refusals)].join('; ')}`);
    for (const [step, result] of Object.entries(row.steps)) { if (result.status === 'failed') row.failures.push(`${step}: ${result.why}`); }
    row.orders = row.orders.filter(Boolean);
    const cookies = await context.cookies(origin).catch((error) => { say('sessions unread', { message: message(error) }); return []; });
    for (const cookie of cookies.filter((one) => /session/i.test(one.name))) await http(origin, cookie.value, 'DELETE', '/sessions', { accepted: [200, 204, 401] }).catch((error) => say('sign-out failed', { message: message(error) }));
    await context.close();
  }
}

/**
 * @description `check`: the four steps at both sizes as the test person, with screenshots and a JSON receipt.
 * @param {string} origin The loopback kernel. @param {string} file The person file `person` wrote. @param {string} out The folder for screenshots and the receipt.
 * @returns {Promise<number>} 0 every step passed at both sizes; 2 nothing refused or broken and a step was not run; 1 otherwise.
 */
export async function check(origin, file, out) {
  const person = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.mkdirSync(out, { recursive: true });
  const served = await http(origin, person.token, 'GET', '/api/design-studio/capabilities', { accepted: null });
  const receipt = { origin, at: new Date().toISOString(), subject: person.subject, administrator: person.administrator, assignment: person.assignment, designStudio: served.status, sizes: [], failures: [] };
  if (served.status !== 200) receipt.failures.push(`Design Studio answered the person ${served.status}`);
  const browser = await playwright().chromium.launch({ headless: true });
  try { if (!receipt.failures.length) for (const size of SIZES) await checkSize(browser, origin, person, size, out, receipt); }
  finally { await browser.close(); }
  const names = ['newProduct', 'partnerPart', 'simulate', 'printSet'];
  for (const row of receipt.sizes) for (const name of names) if (!row.steps[name] && !row.failures.length) row.failures.push(`${name} did not run`);
  fs.writeFileSync(path.join(out, 'design-studio-nonadmin-live.json'), JSON.stringify(receipt, null, 2));
  say('check', receipt);
  if (receipt.failures.length || receipt.sizes.some((row) => row.failures.length)) return 1;
  return receipt.sizes.some((row) => names.some((name) => row.steps[name].status !== 'passed')) ? 2 : 0;
}
