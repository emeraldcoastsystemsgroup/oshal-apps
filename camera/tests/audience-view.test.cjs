/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The Camera Ops family view asserted as behaviour: the head block runs against a stub kit and a stub fetch, so the tests prove what it reads on open (only GET /fleet, /captures for each online camera, at most six, and /home-summary; never an offline camera, a control, chat, state, events or heartbeat call, a thumbnail or feed URL, the laptop camera or a write), that the stats, title and lede name the cameras (online, recording, offline, photos and videos, commands in 24 hours), that each camera reads as its state in plain words (ready, recording, busy, link closed, offline, no reading; simulated cameras named as practice cameras), that photos and videos read newest first with their length, file name and camera and no image, that the logged commands read as what was asked with Accepted or Refused, that nothing carries a link and the one action opens the cockpit, that a captures or command-log read failing on its own is named while the cameras still show, and that a 401, a 403, a 5xx, a failure with its own error and a non-JSON failure each read as what they are. The page's main script and its connected-actions script are run against stubs to prove that under the view nothing is wired, enumerated, fetched, imported or polled, while the full page still runs every start step.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'camera';
const PAGE = 'tools/camera-ops.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/camera"];
const GATE_FILE = 'tools/camera-ops.html';

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

/**
 * @description Run the head block against a stub kit and a stub fetch, so the family view is asserted as the model it
 * paints and the reads it makes. The stub relative-time formatter tags its input: W = AppView.when.
 * @param {Record<string, object>} answers URL -> JSON body; `{ http, body }` answers with that HTTP status instead.
 * @returns {{ family: Function, urls: string[], opened: string[] }} The builder, every request made and every A.open target.
 */
function loadFamily(answers) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', open: (href) => { opened.push(href); } };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url], status = a === undefined ? 404 : (a.http || 200), body = a === undefined ? {} : a.http ? a.body : a;
    return Promise.resolve({ ok: status < 400, status, json: () => (body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, urls, opened };
}

const F = '/api/camera/fleet', S = '/api/camera/home-summary';
/** @returns {string} The captures read the view makes for one camera. */
const CAP = (id) => '/api/camera/captures?cameraId=' + encodeURIComponent(id) + '&since=0';
const FEED = '192.0.2.10';
/** @returns {object} A CameraTelemetry snapshot as the engine reports it. */
const tele = (id, extra) => Object.assign({ cameraId: id, status: 'connected', connected: true, recording: false, mode: 'video', model: 'OSHAL SimCam', batteryPct: 97.5,
  recordElapsedS: 0, previewActive: false, settings: { resolution: '1080p' }, lastCaptureSeq: 0 }, extra || {});
/** @returns {object} A fleet row as GET /fleet lists it (CameraFleetSummary). */
const cam = (id, kind, online, extra) => Object.assign({ cameraId: id, kind, remote: kind !== 'sim', online, lastSeenMs: null, telemetry: tele(id), videoUrl: null }, extra || {});
const FLEET = [
  cam('sim-1', 'sim', true, { telemetry: tele('sim-1', { mode: 'photo' }) }),
  cam('synthetic-garage', 'gopro', false, { lastSeenMs: 1790000000000, telemetry: tele('synthetic-garage', { model: 'Synthetic HERO9 Black', batteryPct: 40 }) }),
  cam('synthetic-hero9', 'gopro', true, { lastSeenMs: 1790000005000, videoUrl: 'http://' + FEED + ':8080/live',
    telemetry: tele('synthetic-hero9', { status: 'recording', recording: true, recordElapsedS: 42, model: 'Synthetic HERO9 Black', batteryPct: 76.4 }) }),
];
const SIM_CAPS = [{ seq: 1, ts: 1790000001000, kind: 'photo', path: '100GOPRO/GOPR0001.JPG' }];
const HERO_CAPS = [
  { seq: 6, ts: 1790000003000, kind: 'photo', path: '100GOPRO/GOPR0006.JPG', sizeBytes: 4000000, thumbUrl: 'http://' + FEED + ':8080/thumb/GOPR0006.JPG' },
  { seq: 7, ts: 1790000004000, kind: 'video', path: '100GOPRO/GX010007.MP4', durationS: 75, cameraId: 'spoofed-by-node' },
];
/** @returns {object} One command item exactly as routes/home-summary.js builds it. */
const cmd = (id, op, outcome, at) => ({ text: 'Camera ' + id, detail: op + ' / ' + outcome + ' / ' + at, tone: outcome === 'rejected' ? 'warn' : 'neutral', fix: 'camera-ops',
  actions: [{ integration: 'prepare-document', context: { title: 'Camera ' + id, notes: op + ' / ' + outcome + ' / ' + at + '\nCommand log only.' } }] });
const ABOUT = { text: 'Your recorded camera commands, including rejected attempts. Simulation and hardware commands share this audit log; it cannot establish physical success.', tone: 'neutral', fix: 'camera-ops' };
const NOT_CHECKED = { text: 'Some saved sources cannot be checked.', tone: 'warn', fix: 'camera-ops' };
/** @returns {object[]} The route's three metrics; a failed count reads 'Unavailable', as the route writes it. */
const metrics = (day) => [{ id: 'commands-24h', label: 'Commands logged / 24h', value: day }, { id: 'commands-5d', label: 'Commands logged / 5d', value: '5' }, { id: 'rejected-5d', label: 'Rejected commands / 5d', value: '1' }];
/** @returns {object} A home summary as the route answers it. */
const summary = (items, partial, day) => ({ metrics: metrics(day || '3'), tiles: metrics(day || '3'), items: items.concat([ABOUT]), asOf: '2026-09-28T12:00:00.000Z', partial: !!partial });
const COMMANDS = [cmd('synthetic-hero9', 'record', 'ok', '2026-09-28T11:00:00.000Z'), cmd('sim-1', 'deleteAll', 'rejected', '2026-09-28T10:00:00.000Z'), cmd('sim-1', 'photo', 'ok', 'date unavailable')];
const OK = { [F]: { fleet: FLEET }, [S]: summary(COMMANDS), [CAP('sim-1')]: { captures: SIM_CAPS }, [CAP('synthetic-hero9')]: { captures: HERO_CAPS } };
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const build = (answers) => loadFamily(Object.assign({}, OK, answers)).family({});
const SIM_NOTE = 'A practice camera is simulated: it shows how Camera Ops works, and nothing it captures is real.';
const CAP_NOTE = 'What the cameras reported since Camera Ops last started. The files stay on the camera.';

test('on open the view reads only the fleet, the captures of each online camera and the home summary: never a command, a device feed or a write', async () => {
  const view = loadFamily(OK);
  await view.family({});
  assert.deepEqual(view.urls, ['GET ' + F, 'GET ' + S, 'GET ' + CAP('sim-1'), 'GET ' + CAP('synthetic-hero9')], 'the offline camera is not read');
  assert.doesNotMatch(block, /method:|\/control|\/chat|\/state|\/events|heartbeat|getUserMedia|enumerateDevices|thumbUrl|videoUrl|home-plan|<img|new Image/,
    'no control, concierge, state, event, heartbeat, laptop-camera, thumbnail, feed or connected-actions read is even named');
  const many = loadFamily(Object.assign({}, OK, { [F]: { fleet: Array.from({ length: 8 }, (_, i) => cam('sim-' + (i + 1), 'sim', true)) } }));
  await many.family({});
  assert.equal(many.urls.filter((u) => u.includes('/captures')).length, 6, 'at most six cameras are read');
});

test('the stats, title and lede name the cameras; each camera reads as its state in plain words', async () => {
  const view = loadFamily(OK), model = await view.family({});
  assert.deepEqual([model.kicker, model.title, model.lede], ['Our cameras', '1 camera recording', 'synthetic-hero9 has been recording for 0:42.']);
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.hint || null]), [
    ['online', 'Cameras online', 2, '1 camera offline'], ['recording', 'Recording now', 1, null], ['captures', 'Photos and videos', 3, 'Since Camera Ops started'], ['commands', 'Commands, last 24 h', '3', null],
  ]);
  const cameras = section(model, 'cameras');
  assert.deepEqual(cameras.items.map((i) => [i.icon, i.title, i.text, i.meta, i.badge, i.tone]), [
    ['🧪', 'sim-1', 'Practice camera (simulated) · Photo mode', 'battery 98%', 'Ready', 'ok'],
    ['🎥', 'synthetic-garage', 'Synthetic HERO9 Black · Video mode', 'last seen W(1790000000000)', 'Offline', 'warn'],
    ['🎥', 'synthetic-hero9', 'Synthetic HERO9 Black · Video mode', 'battery 76% · recording 0:42', 'Recording', 'info'],
  ]);
  assert.equal(cameras.note, SIM_NOTE);
  assert.deepEqual(model.actions.map((a) => a.label), ['Open Camera Ops']);
  model.actions[0].onClick();
  assert.deepEqual(view.opened, ['/cockpit/?app=camera'], 'the one action opens the cockpit through the kit');
});

test('photos and videos read newest first with length, file name and camera; commands read as what was asked, Accepted or Refused; nothing links out', async () => {
  const model = await build({});
  const captures = section(model, 'captures');
  assert.deepEqual(captures.items.map((i) => [i.icon, i.title, i.text, i.meta]), [
    ['🎞️', 'Video · 1:15', 'On synthetic-hero9 · 100GOPRO/GX010007.MP4', 'W(1790000004000)'],
    ['📷', 'Photo', 'On synthetic-hero9 · 100GOPRO/GOPR0006.JPG', 'W(1790000003000)'],
    ['📷', 'Photo', 'On sim-1 · 100GOPRO/GOPR0001.JPG', 'W(1790000001000)'],
  ]);
  assert.equal(captures.note, CAP_NOTE);
  const commands = section(model, 'commands');
  assert.deepEqual(commands.items.map((i) => [i.icon, i.title, i.text, i.meta, i.badge, i.tone]), [
    ['🎛️', 'Start recording', 'Camera synthetic-hero9', 'W(2026-09-28T11:00:00.000Z)', 'Accepted', null],
    ['🎛️', 'Erase all media', 'Camera sim-1', 'W(2026-09-28T10:00:00.000Z)', 'Refused', 'warn'],
    ['🎛️', 'Take a photo', 'Camera sim-1', 'W(date unavailable)', 'Accepted', null],
  ]);
  assert.equal(commands.note, 'Accepted means the camera took the command; it does not prove a photo or video was made.');
  assert.equal(model.sections.some((s) => s.items.some((i) => i.href || i.onClick || i.image)), false, 'no item links or shows an image');
  assert.equal(JSON.stringify(model).includes(FEED), false, 'no thumbnail or feed address is painted');
  const many = section(await build({ [CAP('sim-1')]: { captures: Array.from({ length: 20 }, (_, i) => ({ seq: i + 1, ts: 1790000000000 + i, kind: 'photo', path: 'P' + i })) } }), 'captures');
  assert.deepEqual([many.items.length, many.items[0].text], [12, 'On synthetic-hero9 · 100GOPRO/GX010007.MP4']);
});

test('each camera state and the household state read as what they are', async () => {
  const states = section(await build({ [F]: { fleet: [
    cam('a', 'gopro', true, { telemetry: tele('a', { status: 'busy', model: 'Synthetic HERO9' }) }), cam('b', 'gopro', true, { telemetry: tele('b', { status: 'disconnected', mode: 'timelapse', batteryPct: null, model: 'Synthetic HERO9' }) }),
    cam('c', 'gopro', true, { telemetry: null }), cam('d', 'gopro', false, { lastSeenMs: null }),
  ] } }), 'cameras');
  assert.deepEqual(states.items.map((i) => [i.text, i.meta, i.badge, i.tone]), [
    ['Synthetic HERO9 · Video mode', 'battery 98%', 'Busy', 'warn'], ['Synthetic HERO9 · Timelapse mode', null, 'Link closed', null],
    ['Camera', null, 'No reading', 'warn'], ['OSHAL SimCam · Video mode', 'not seen yet', 'Offline', 'warn'],
  ]);
  assert.equal(states.note, null, 'no practice-camera note without a simulated camera');
  const idle = await build({ [F]: { fleet: [FLEET[0]] } });
  assert.deepEqual([idle.title, idle.lede], ['1 camera online', 'Newest: a photo on sim-1, W(1790000001000).']);
  const quiet = await build({ [F]: { fleet: [FLEET[0]] }, [CAP('sim-1')]: { captures: [] } });
  assert.deepEqual([quiet.lede, section(quiet, 'captures').empty], ['Nothing has been captured since Camera Ops last started.', 'Nothing captured since Camera Ops last started.']);
  const away = loadFamily(Object.assign({}, OK, { [F]: { fleet: [FLEET[1]] } })), dark = await away.family({});
  assert.deepEqual([dark.title, dark.lede, dark.stats[0].value, dark.stats[0].hint, section(dark, 'captures').empty, section(dark, 'captures').note],
    ['No camera online right now', 'A camera shows as online again once its camera node reports in.', 0, '1 camera offline', 'No camera is online, so there are no photos or videos to show.', null]);
  assert.deepEqual(away.urls, ['GET ' + F, 'GET ' + S], 'no captures read without an online camera');
  const none = await build({ [F]: { fleet: [] } });
  assert.deepEqual([none.title, none.lede, section(none, 'cameras').items, section(none, 'cameras').empty],
    ['No cameras yet', 'Cameras show up here once Camera Ops can reach them. Open Camera Ops to connect one.', [], 'No cameras yet.']);
  const eight = Array.from({ length: 8 }, (_, i) => cam('sim-' + (i + 1), 'sim', true));
  const crowd = section(await build(Object.assign({ [F]: { fleet: eight } }, ...eight.map((c) => ({ [CAP(c.cameraId)]: { captures: [] } })))), 'captures');
  assert.equal(crowd.note, CAP_NOTE + ' Shown for the first 6 online cameras.');
});

test('a captures or command-log read failing on its own is named while the cameras still show', async () => {
  const model = await build({ [CAP('synthetic-hero9')]: { http: 500, body: { error: 'server error' } }, [S]: { http: 503, body: summary([NOT_CHECKED], true, 'Unavailable') } });
  assert.deepEqual(section(model, 'captures').items.map((i) => i.text), ['On sim-1 · 100GOPRO/GOPR0001.JPG']);
  assert.equal(section(model, 'captures').note, CAP_NOTE + ' Photos and videos from synthetic-hero9 could not be read just now.');
  assert.deepEqual(model.stats.slice(2).map((x) => [x.value, x.hint, x.tone || null]), [[1, 'Some could not be read', null], ['—', 'Could not check', 'warn']]);
  assert.deepEqual([section(model, 'commands').items, section(model, 'commands').empty, section(model, 'commands').note], [[], 'Recent commands could not be read just now.', null]);
  assert.equal(section(model, 'cameras').items.length, 3);
  const partial = await build({ [S]: summary([NOT_CHECKED], true, 'Unavailable') });
  assert.deepEqual([section(partial, 'commands').empty, partial.stats[3].value], ['Some saved commands could not be checked.', '—']);
  const some = await build({ [S]: summary(COMMANDS.slice(0, 1).concat([NOT_CHECKED]), true) });
  assert.equal(section(some, 'commands').note, 'Accepted means the camera took the command; it does not prove a photo or video was made. Some saved commands could not be checked.');
  const blind = await build({ [F]: { fleet: [FLEET[0]] }, [CAP('sim-1')]: { http: 409, body: { error: 'camera "sim-1" is offline' } } });
  assert.deepEqual([blind.lede, section(blind, 'captures').empty], ['Photos and videos could not be read just now.', 'Photos and videos could not be read just now.']);
});

test('a refusal and a failure each read as what they are', async () => {
  const signedOut = await build({ [F]: { http: 401, body: { error: 'Not authenticated' } }, [S]: { http: 401, body: { error: 'not_authenticated' } } });
  assert.deepEqual([signedOut.kicker, signedOut.title, signedOut.lede, signedOut.stats, signedOut.sections],
    ['Our cameras', 'Sign in to see the cameras', 'Camera Ops needs a signed-in session, and this session is not signed in.', undefined, undefined]);
  const denied = await build({ [F]: { http: 403, body: {} } });
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Camera Ops', 'The Camera Ops routes refused this account (HTTP 403).']);
  assert.equal((await build({ [S]: { http: 401, body: {} } })).title, 'Sign in to see the cameras', 'a refusal on the summary is a refusal');
  assert.equal((await build({ [CAP('sim-1')]: { http: 403, body: {} } })).title, 'This account cannot open Camera Ops', 'a refusal on a captures read is a refusal');
  await assert.rejects(build({ [F]: { http: 503, body: { error: 'database unavailable' } } }), /^Error: Camera Ops could not read the cameras \(HTTP 503\)\.$/);
  await assert.rejects(build({ [F]: { http: 500, body: undefined } }), /^Error: Camera Ops could not read the cameras \(HTTP 500\)\.$/, 'a non-JSON failure keeps its status');
  await assert.rejects(build({ [F]: { http: 404, body: { error: 'Synthetic route missing' } } }), /^Error: Synthetic route missing$/, 'a failure with its own error keeps it');
});

/**
 * @description An inline script of the page, found by a statement it carries.
 * @param {string} marker Text only that script contains.
 * @returns {string} The script's source.
 */
function inlineScript(marker) {
  const at = html.indexOf(marker), open = html.lastIndexOf('<script>', at);
  return html.slice(open + 8, html.indexOf('</script>', at));
}

/**
 * @description A stand-in for any DOM node: every property is itself, every call returns itself, every write is accepted
 * and it reads as an empty string, so the page's render code runs without a browser.
 * @returns {Function} The universal stub.
 */
function anyNode() {
  const proxy = new Proxy(function () {}, { get: (_t, key) => (key === Symbol.toPrimitive ? () => '' : key === 'then' ? undefined : proxy), set: () => true, apply: () => proxy });
  return proxy;
}

/** @returns {Promise<void>} Resolves after pending promise chains have settled. */
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

/**
 * @description Run the page's main script (controls, laptop camera, polling) against a stub DOM, a stub camera API, stub
 * timers and a stub fetch that answers an empty fleet.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {Promise<{ dom: number, reads: string[], media: string[], timers: number[] }>} DOM lookups, requests, camera-API calls and timer periods.
 */
async function runMain(activeView) {
  const calls = { dom: 0, reads: [], media: [], timers: [] }, node = anyNode();
  const document = { getElementById: () => { calls.dom++; return node; }, createElement: () => node, body: node };
  const navigator = { mediaDevices: {
    getUserMedia: () => { calls.media.push('getUserMedia'); return Promise.reject(new Error('denied')); },
    enumerateDevices: () => { calls.media.push('enumerateDevices'); return Promise.resolve([]); },
    addEventListener: (type) => { calls.media.push(type); },
  } };
  const fetchStub = (url, opt) => { calls.reads.push(((opt && opt.method) || 'GET') + ' ' + url); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ fleet: [] }) }); };
  const timer = (_fn, ms) => { calls.timers.push(ms); return 0; };
  new Function('window', 'AppView', 'document', 'navigator', 'fetch', 'setInterval', 'setTimeout', 'clearTimeout', inlineScript('async function boot()'))(
    { AppView: { active: () => activeView } }, { active: () => activeView }, document, navigator, fetchStub, timer, timer, () => {});
  await settle();
  return calls;
}

/**
 * @description Run the page's connected-actions script against a stub module loader, a stub DOM and a stub fetch.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {Promise<{ imported: string[], mounted: number, listeners: string[], reads: string[] }>} What it loaded, mounted, bound and fetched.
 */
async function runActions(activeView) {
  const calls = { imported: [], mounted: 0, listeners: [], reads: [] };
  const el = () => ({ open: false, value: '', textContent: '', selectedIndex: 0, addEventListener: (type) => { calls.listeners.push(type); }, replaceChildren() {}, dispatchEvent() {} });
  const src = inlineScript('mountConnectedActions').replace("await import('/cockpit/js/app-workflows.js')", "await importStub('/cockpit/js/app-workflows.js')");
  assert.ok(src.includes('importStub('), 'the connected-actions module is loaded where the test expects it');
  const importStub = (spec) => { calls.imported.push(spec); return Promise.resolve({ mountConnectedActions: () => { calls.mounted++; return Promise.resolve(); } }); };
  const fetchStub = (url) => { calls.reads.push(url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) }); };
  new Function('window', 'AppView', 'document', 'fetch', 'importStub', src)({ AppView: { active: () => activeView } }, { active: () => activeView }, { getElementById: el, createElement: el }, fetchStub, importStub);
  await settle();
  return calls;
}

test('under an audience view the main script wires, enumerates, fetches and polls nothing; the full page still runs every start step', async () => {
  assert.deepEqual(await runMain('family'), { dom: 0, reads: [], media: [], timers: [] });
  const full = await runMain(null);
  assert.ok(full.dom > 0, 'the full page wires its controls');
  assert.deepEqual([full.reads, full.media, full.timers], [['GET /api/camera/fleet'], ['enumerateDevices', 'devicechange'], [1500, 250]]);
});

test('under an audience view the connected-actions script loads, mounts and binds nothing; the full page still mounts the offer', async () => {
  assert.deepEqual(await runActions('family'), { imported: [], mounted: 0, listeners: [], reads: [] });
  assert.deepEqual(await runActions(null), { imported: ['/cockpit/js/app-workflows.js'], mounted: 1, listeners: ['change', 'toggle'], reads: [] });
});
