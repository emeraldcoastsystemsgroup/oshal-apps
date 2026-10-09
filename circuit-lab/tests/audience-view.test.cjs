/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The classroom view as behaviour: the head block runs against a stub kit and the fixture's reads (three reads only, four starters in order, circuits badged by state, the engine note without its install command or raw error), a starter tap makes one copy with run:false and opens it (a second tap while pending ignored, a failed tap named and retryable, never navigating), and the named states; the lab's main script runs against DOM stubs to prove that under a view it reads nothing and binds no assistant-rail listener, while the full lab still does; the page attaches the rail only for the full lab.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The company view for the Business shells, beside the classroom one: the boot declares both audiences; the company model runs against a stub kit and the fixture's reads (GET /designs and GET /capabilities only, nothing written; four stats, the ledger rows with each last run, runs kept, parts and wires, warnings of the last solve only, the failed-run list); each failure_reason is named by its code with only the solver's refusal quoted and never the engine address or install command; the named states (none saved, 401, 403, unreadable, malformed, unreachable, simulator note present, absent or unreadable, the row cap); rows open that circuit in the full lab; and the lab's main script starts nothing under the company view either.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const APP = 'circuit-lab';
const PAGE = 'tools/circuit-lab.html';
const AUDIENCES = ["classroom", "company", "family"];
const ALLOWED_PREFIXES = ["/api/circuit-lab"];
const GATE_FILE = 'tools/circuit-lab.js';

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
const start = html.indexOf('<script src="/shared/ui/js/app-view.js"></script>');
const block = (() => { const s = html.indexOf('<script>', start); const e = html.indexOf('</script>', s); return html.slice(s + 8, e); })();

test('the shared kit is loaded right after the theme bootstrap, stylesheet first', () => {
  const bootstrap = html.indexOf('<script src="/shared/ui/js/surface-theme.js"></script>');
  assert.ok(bootstrap >= 0, 'theme bootstrap present');
  const css = html.indexOf('<link rel="stylesheet" href="/shared/ui/css/app-view.css" />');
  assert.ok(css > bootstrap && start > css, 'app-view.css then app-view.js follow the bootstrap');
  assert.equal(html.split('/shared/ui/js/app-view.js').length - 1, 1, 'the kit is included once');
});

test('the page boots the kit with its own application name and exactly the audiences it provides', () => {
  const boot = block.match(/A\.boot\(\{([\s\S]*?)\}\);/);
  assert.ok(boot, 'A.boot({...}) present');
  assert.match(boot[1], new RegExp("app: '" + APP + "'"));
  const declared = boot[1].match(/audiences: \{([^}]*)\}/);
  assert.ok(declared, 'audiences map present');
  const names = declared[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean).sort();
  assert.deepEqual(names, [...AUDIENCES].sort());
  assert.match(boot[1], /escapeLabel: '[^']+'/, 'the escape names the full application');
});

test('the full page start is gated on the kit decision and survives a missing kit', () => {
  const gated = GATE_FILE === PAGE ? html : fs.readFileSync(path.join(ROOT, GATE_FILE), 'utf8');
  assert.match(gated, /if \(!window\.AppView \|\| !AppView\.active\(\)\)/);
});

test('the head block parses and reads only this package\x27s own routes', () => {
  assert.doesNotThrow(() => new Function(block));
  const reads = [...block.matchAll(/fetch\(\s*'([^']+)'/g)].map(m => m[1]).concat([...block.matchAll(/fetch\(\s*(BASE|API)\s*\+/g)].map(() => ALLOWED_PREFIXES[0]));
  assert.ok(reads.length >= 1, 'the block reads through fetch');
  for (const r of reads) assert.ok(ALLOWED_PREFIXES.some(p => r === p || r.startsWith(p + '/')), 'read stays on an allowed prefix: ' + r);
  assert.doesNotMatch(block, /innerHTML\s*=/, 'the block builds no HTML from data');
});

const LAB = '/api/circuit-lab';
const APP_URL = LAB + '/app';
const fixtureReads = () => require('./audience-view.fixture.cjs')({ iso: (h) => new Date(Date.now() + h * 36e5).toISOString() }).reads;

/**
 * @description Run the head block against a stub kit, window and fetch and return the classroom view's harness:
 * build() resolves the model the kit would paint, and every read, write and navigation is recorded, so the view is
 * asserted as behaviour. A read answers from `reads` (a number is an HTTP status to fail with); a POST answers from
 * `post`, a function of the body returning [status, json].
 * @param {Record<string, object|number>} reads Route path -> JSON body or failing status.
 * @param {(body: object) => [number, object]} [post] The answer to POST /designs.
 * @returns {{build: () => Promise<object>, fetched: string[], posted: object[], assigned: string[], refreshed: number[]}}
 */
function classroomView(reads, post) {
  let config = null;
  const fetched = [], posted = [], assigned = [], refreshed = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => (v ? 'WHEN' : '—') };
  const win = { AppView: kit, location: { pathname: APP_URL, assign: (u) => assigned.push(u) } };
  const answer = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
  const fetchStub = (url, opt) => {
    if (opt && opt.method === 'POST') { const body = JSON.parse(opt.body); posted.push({ url, body }); const [s, j] = post ? post(body) : [201, { design: { design_id: 'synthetic-new' } }]; return answer(s, j); }
    fetched.push(url);
    const body = reads[url], status = typeof body === 'number' ? body : body ? 200 : 404;
    return answer(status, status === 200 ? body : { error: 'synthetic_' + status });
  };
  new Function('window', 'fetch', block)(win, fetchStub);
  assert.ok(config && typeof config.audiences.classroom === 'function', 'the block boots the classroom audience');
  const ctx = { audience: 'classroom', refresh() { refreshed.push(Date.now()); } };
  return { build: () => config.audiences.classroom(ctx), fetched, posted, assigned, refreshed };
}

const section = (model, id) => model.sections.find((s) => s && s.id === id);
const settle = () => new Promise((r) => setImmediate(r));

test('the classroom view reads its three routes, offers four starters in order and lists the circuits by state', async () => {
  const view = classroomView(fixtureReads());
  const model = await view.build();
  assert.deepEqual(view.fetched.sort(), [LAB + '/capabilities', LAB + '/designs', LAB + '/examples'], 'only the three reads, nothing written on open');
  assert.deepEqual(view.posted, []);
  assert.deepEqual(section(model, 'starters').items.map((t) => t.title), ['Light an LED', 'Spin a motor', 'Blink with code', 'Fill a capacitor'], 'the motor-driver and crank-slider examples are not offered');
  const items = section(model, 'circuits').items;
  assert.deepEqual(items.map((i) => [i.title, i.text, i.badge, i.tone || null]), [['Synthetic LED circuit', '4 parts', 'Ran OK', 'ok'], ['Synthetic motor build', '5 parts', 'Needs a fix', 'warn'], ['Synthetic blink test', '1 part', 'Not run yet', null]]);
  items[1].onClick();
  model.actions[0].onClick(); model.actions[1].onClick();
  assert.deepEqual(view.assigned, [APP_URL + '?design=00000000-0000-4000-8000-000000000002', APP_URL + '?design=00000000-0000-4000-8000-000000000001', APP_URL]);
  assert.equal(model.actions[0].label, 'Keep building “Synthetic LED circuit”');
  assert.deepEqual(model.stats.map((s) => [s.id, s.value]), [['circuits', 3], ['ran', 1], ['failed', 1], ['draft', 1]]);
  assert.equal(model.lede, '3 circuits · last changed WHEN');
  assert.match(section(model, 'circuits').note, /The simulator did not answer the last time a circuit ran/);
  assert.doesNotMatch(JSON.stringify(model), /synthetic-install-hint|refused the connection/, 'the engine\x27s install command and raw error never reach the view');
});

test('a starter tap makes one copy without solving and opens it; a failed tap says so and can be tried again', async () => {
  const ok = classroomView(fixtureReads(), () => [201, { design: { design_id: 'synthetic-copy' } }]);
  const tiles = section(await ok.build(), 'starters').items;
  tiles[3].onClick(); tiles[0].onClick();
  await settle(); await settle();
  assert.deepEqual(ok.posted, [{ url: LAB + '/designs', body: { example: 'rc-charge', run: false } }], 'one POST: a second tap while the first is pending is ignored');
  assert.deepEqual(ok.assigned, [APP_URL + '?design=synthetic-copy']);
  let status = 500;
  const bad = classroomView(fixtureReads(), () => [status, { error: 'create_failed' }]);
  section(await bad.build(), 'starters').items[0].onClick();
  await settle(); await settle();
  assert.equal(bad.refreshed.length, 1, 'the view repaints');
  assert.equal(section(await bad.build(), 'starters').note, 'That starter could not be made just now. Try again, or open the lab.');
  assert.equal(section(await bad.build(), 'starters').note, 'Each starter opens in the lab as your own copy. Press Run there to watch it work.', 'the notice is shown once');
  status = 401;
  section(await bad.build(), 'starters').items[0].onClick();
  await settle(); await settle();
  assert.equal(bad.posted.length, 2, 'a failed tap can be tried again');
  assert.equal(section(await bad.build(), 'starters').note, 'You are signed out. Sign in again to make a circuit.');
  assert.deepEqual(bad.assigned, [], 'a failed tap never navigates');
});

test('the classroom view names its states: no circuits, no light starter, no examples, engine fine, unreadable', async () => {
  const reads = fixtureReads();
  const empty = classroomView({ ...reads, [LAB + '/designs']: { designs: [] } });
  const e = await empty.build();
  assert.deepEqual([e.title, e.lede], ['Build it. Light it up.', 'Pick a starter, then press Run in the lab to watch it work.']);
  assert.deepEqual([section(e, 'circuits').items, section(e, 'circuits').empty], [[], 'No circuits yet — pick a starter above.']);
  e.actions[0].onClick(); await settle(); await settle();
  assert.deepEqual(empty.posted.map((p) => p.body), [{ example: 'led-switch', run: false }], 'the empty hero starts the light');
  const noLight = classroomView({ ...reads, [LAB + '/designs']: { designs: [] }, [LAB + '/examples']: { examples: [{ id: 'rc-charge' }] } });
  const n = await noLight.build();
  assert.deepEqual(n.actions.map((a) => a.label), ['Open the lab']);
  n.actions[0].onClick(); assert.deepEqual(noLight.assigned, [APP_URL]);
  const noExamples = await classroomView({ ...reads, [LAB + '/examples']: 500 }).build();
  assert.equal(section(noExamples, 'starters'), undefined, 'without the examples the starters are left out');
  assert.equal(section(noExamples, 'circuits').items.length, 3, 'the list still paints');
  const fine = reads[LAB + '/capabilities'];
  const engineFine = await classroomView({ ...reads, [LAB + '/capabilities']: { ...fine, engine: { ...fine.engine, lastError: null } } }).build();
  assert.equal(section(engineFine, 'circuits').note, null, 'no simulator note unless its last request failed');
  assert.equal(section(await classroomView({ ...reads, [LAB + '/capabilities']: 503 }).build(), 'circuits').note, null);
  await assert.rejects(classroomView({ ...reads, [LAB + '/designs']: 401 }).build(), /You are signed out\. Sign in again to see your circuits\./);
  await assert.rejects(classroomView({ ...reads, [LAB + '/designs']: 500 }).build(), /Your circuits could not be read just now\./);
});

/**
 * @description Run the head block against a stub kit, window and fetch and return the company view's harness: build()
 * resolves the model the kit would paint (or rejects with the failure the kit would name), and every read, write and
 * navigation is recorded, so the ledger is asserted as behaviour.
 * @param {Record<string, object|number|false>} reads Route path -> JSON body, a failing HTTP status, or false for a fetch that never reaches the server.
 * @returns {{build: () => Promise<object>, fetched: string[], writes: string[], assigned: string[]}}
 */
function companyView(reads) {
  let config = null;
  const fetched = [], writes = [], assigned = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => (v ? 'WHEN' : '—') };
  const win = { AppView: kit, location: { pathname: APP_URL, assign: (u) => assigned.push(u) } };
  const fetchStub = (url, opt) => {
    if (opt && opt.method && opt.method !== 'GET') { writes.push(opt.method + ' ' + url); return Promise.reject(new Error('synthetic: no writes')); }
    fetched.push(url);
    const body = reads[url];
    if (body === false) return Promise.reject(new TypeError('Failed to fetch'));
    const status = typeof body === 'number' ? body : body ? 200 : 404;
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(status === 200 ? body : { error: 'synthetic_' + status }) });
  };
  new Function('window', 'fetch', block)(win, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { build: () => config.audiences.company({ audience: 'company', refresh() {} }), fetched, writes, assigned };
}

const cellText = (c) => (c && typeof c === 'object' ? c.text : c);
const designId = (n) => APP_URL + '?design=00000000-0000-4000-8000-00000000000' + n;

test('the company view reads only /designs and /capabilities and lays the saved circuits out as a ledger', async () => {
  const view = companyView(fixtureReads());
  const model = await view.build();
  assert.deepEqual(view.fetched.sort(), [LAB + '/capabilities', LAB + '/designs'], 'two reads on open: no examples, runs, waveforms or driver catalog');
  assert.deepEqual(view.writes, [], 'nothing written, nothing solved');
  assert.deepEqual([model.kicker, model.title], ['Engineering · Circuit Lab', '1 circuit failed its last run']);
  assert.match(model.lede, /^Newest: Synthetic LED circuit, changed WHEN\. Circuits saved by this account/);
  assert.deepEqual(model.stats.map((s) => [s.id, s.value, s.tone || null]), [['circuits', 3, null], ['runs', 3, null], ['solved', 1, 'ok'], ['failed', 1, 'warn']]);
  assert.equal(model.stats[0].hint, '1 not run yet');
  const ledger = section(model, 'saved');
  assert.deepEqual(ledger.columns.map((c) => (typeof c === 'string' ? c : c.label)), ['Circuit', 'Last run', 'Runs', 'Parts · wires', 'Warnings', 'Changed']);
  assert.deepEqual(ledger.rows.map((r) => r.cells.map(cellText)), [
    ['Synthetic LED circuit', 'Solved', '3', '4 parts · 3 wires', '1', 'WHEN'],
    ['Synthetic motor build', 'Failed', '0', '5 parts · 4 wires', '—', 'WHEN'],
    ['Synthetic blink test', 'Not run yet', '0', '1 part · 0 wires', '—', 'WHEN']]);
  assert.deepEqual(ledger.rows.map((r) => r.cells[1].tone || null), ['ok', 'warn', null]);
  assert.match(ledger.note, /^Newest first\. .* The last request to the simulator failed/);
  const attention = section(model, 'attention').items;
  assert.deepEqual(attention.map((i) => [i.title, i.text, i.badge]), [['Synthetic motor build', 'The solver refused the circuit: Synthetic wire W2 joins an electrical pin to a shaft pin', 'Failed']]);
  ledger.rows[2].onClick(); attention[0].onClick(); model.actions[0].onClick();
  assert.deepEqual(view.assigned, [designId(3), designId(2), designId(1)], 'a row, a failed circuit and the hero open that circuit in the full lab');
  assert.equal(model.actions.length, 1);
  assert.doesNotMatch(JSON.stringify(model), /synthetic-install-hint|refused the connection|synthetic:0/, 'the engine\x27s install command, address and raw error never reach the view');
});

test('the company view names each failure by its code and quotes only the solver refusal', async () => {
  const reads = fixtureReads(), base = reads[LAB + '/designs'].designs[1];
  const failed = (reason, n) => ({ ...base, design_id: '00000000-0000-4000-8000-00000000001' + n, failure_reason: reason });
  const reasons = [
    'capability_unavailable: engine container is not running at synthetic:0 (ECONNREFUSED) — install or rebuild it: docker exec synthetic-api sh /synthetic/install-engine.sh',
    'engine_timeout: engine did not answer within 115 s; the worker was killed', 'engine_busy: engine queue is full (8 waiting)',
    'engine_error: engine container closed the connection', null, 'not the route format', 'refused: ' + 'x'.repeat(400)];
  const model = await companyView({ ...reads, [LAB + '/designs']: { designs: reasons.map(failed) } }).build();
  assert.equal(model.title, '7 circuits failed their last run');
  const list = section(model, 'attention');
  const tail = '. Open it in the lab to read the reason.';
  assert.deepEqual(list.items.map((i) => i.text), ['The simulator was not available' + tail, 'The simulator did not answer in time' + tail, 'The simulator was busy' + tail,
    'The simulator reported an error' + tail, 'The last run did not solve' + tail, 'The last run did not solve' + tail], 'the newest six');
  assert.equal(list.note, 'The newest 6 of 7.');
  assert.doesNotMatch(JSON.stringify(model), /docker exec|synthetic:0|ECONNREFUSED/, 'no engine address or install command');
  const long = await companyView({ ...reads, [LAB + '/designs']: { designs: [failed(reasons[6], 0)] } }).build();
  const text = section(long, 'attention').items[0].text, lead = 'The solver refused the circuit: ';
  assert.ok(text.startsWith(lead) && text.endsWith('…') && text.length === lead.length + 200, 'a long refusal is clipped to 200 characters');
});

test('the company view names its states: none saved, signed out, refused, unreadable, unreachable, simulator note, row cap', async () => {
  const reads = fixtureReads(), rows = reads[LAB + '/designs'].designs;
  const empty = companyView({ ...reads, [LAB + '/designs']: { designs: [] } });
  const e = await empty.build();
  assert.deepEqual([e.title, section(e, 'saved').rows, section(e, 'attention')], ['No circuits saved yet', [], undefined]);
  assert.match(e.lede, /appear here with their last run/);
  assert.deepEqual(e.stats.map((s) => s.value), [0, 0, 0, 0]);
  assert.match(section(e, 'saved').note, /^The last request to the simulator failed/, 'no ledger note without rows, the simulator note stays');
  e.actions[0].onClick(); assert.deepEqual(empty.assigned, [APP_URL], 'the empty hero opens the lab');
  const out = await companyView({ ...reads, [LAB + '/designs']: 401 }).build();
  assert.deepEqual([out.title, out.stats, out.sections], ['Sign in to see saved circuits', undefined, undefined]);
  assert.equal((await companyView({ ...reads, [LAB + '/designs']: 403 }).build()).title, 'This account cannot open Circuit Lab');
  await assert.rejects(companyView({ ...reads, [LAB + '/designs']: 500 }).build(), /Circuit Lab could not read the saved circuits \(HTTP 500\)\./);
  await assert.rejects(companyView({ ...reads, [LAB + '/designs']: { rows: [] } }).build(), /Circuit Lab sent an answer this view could not read\./);
  await assert.rejects(companyView({ ...reads, [LAB + '/designs']: false }).build(), /Circuit Lab could not be reached just now\./);
  const caps = reads[LAB + '/capabilities'];
  const fine = section(await companyView({ ...reads, [LAB + '/capabilities']: { ...caps, engine: { ...caps.engine, lastError: null } } }).build(), 'saved');
  assert.doesNotMatch(fine.note, /simulator/i, 'no simulator sentence unless its last request failed');
  for (const unread of [503, false]) assert.match(section(await companyView({ ...reads, [LAB + '/capabilities']: unread }).build(), 'saved').note, /The simulator status could not be read\.$/);
  const stale = await companyView({ ...reads, [LAB + '/designs']: { designs: [{ ...rows[1], report: rows[0].report }, { ...rows[0], report: { ...rows[0].report, warnings: [] } }] } }).build();
  assert.deepEqual(section(stale, 'saved').rows.map((r) => cellText(r.cells[4])), ['—', '0'], 'a failed run leaves the old report in place: its warnings are not counted');
  const solved = Array.from({ length: 9 }, (_, i) => ({ ...rows[0], design_id: '00000000-0000-4000-8000-00000000002' + i, title: 'Synthetic ' + i }));
  const many = await companyView({ ...reads, [LAB + '/designs']: { designs: solved } }).build();
  assert.equal(many.title, '9 circuits, every last run solved');
  assert.equal(section(many, 'saved').rows.length, 8);
  assert.match(section(many, 'saved').note, /^The newest 8 of 9 circuits\. /);
  assert.deepEqual(section(many, 'attention').items, []);
  assert.equal((await companyView({ ...reads, [LAB + '/designs']: { designs: [rows[2], { ...rows[2], design_id: 'synthetic-draft' }] } }).build()).title, '2 circuits, 2 not run yet');
});

/**
 * @description Load the lab's main script against DOM stubs and record what it starts: reads, window listeners and
 * document listeners. The fetch never settles, so only the first read of the boot is seen.
 * @param {{active: () => string|null}|undefined} AppView The kit stub, or undefined for a core without the kit.
 * @returns {{fetched: string[], windowEvents: string[], documentEvents: string[]}}
 */
function runLab(AppView) {
  const fetched = [], windowEvents = [], documentEvents = [];
  const el = { addEventListener() {}, checked: false, value: '' };
  const window = { AppView, addEventListener: (t) => windowEvents.push(t), CircuitLabCanvas: { init() {} }, CircuitLabPlot: {}, CircuitLabBoard: { init() {} } };
  const document = { getElementById: () => el, addEventListener: (t) => documentEvents.push(t) };
  const context = { window, document, AppView, location: { search: '' }, URLSearchParams, setTimeout, clearTimeout, fetch: (u) => { fetched.push(u); return new Promise(() => {}); } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, GATE_FILE), 'utf8'), context);
  return { fetched, windowEvents, documentEvents };
}

test('under an audience view the lab starts nothing: no boot reads, no assistant-rail listeners', () => {
  for (const audience of AUDIENCES) {
    const view = runLab({ active: () => audience });
    assert.deepEqual(view.fetched, [], audience + ': no capabilities, driver catalog or designs read');
    assert.ok(!view.windowEvents.includes('bridge-ready'), audience + ': no context publish on bridge-ready');
    assert.ok(!view.documentEvents.includes('surface-bridge:custom'), audience + ': no circuit_action handler');
  }
  for (const lab of [runLab({ active: () => null }), runLab(undefined)]) {
    assert.deepEqual(lab.fetched, [LAB + '/capabilities'], 'the full lab boots from its capabilities');
    assert.ok(lab.windowEvents.includes('bridge-ready') && lab.documentEvents.includes('surface-bridge:custom'), 'the full lab keeps its rail');
  }
  const module = /<script type="module">([\s\S]*?)<\/script>/.exec(html)[1];
  const gateAt = module.indexOf('if (!window.AppView || !AppView.active()) {');
  assert.ok(gateAt >= 0 && gateAt < module.indexOf('.attach()') && gateAt < module.indexOf("new Event('bridge-ready')"), 'the page attaches the rail only for the full lab');
});
