/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | home 1.4.0: TVs and streaming sticks. A scan and a press are plans (planned, never executed) carrying the closed phone-control bridge command; the press plan is built per kind with the closed action list and refuses what a TV cannot do; a scan's answer registers private-address TVs for that person only, merged by hardware address; a TV's on/off state changes only when that TV's own answer says the press worked; an answer for another TV or press is refused; POST /control answers a network TV 409 instead of flipping its saved switch; the routes need a person; the manifest declares the four tools inside /api/home with TV routing words and no new egress; and the page's pure helpers choose the right buttons, computer and words.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | home 1.4.3: Jarvis presses TV buttons through computer.run_plan. home-lan-discover and home-lan-control must declare exactly computerPlan {program: phone-bridge, verbs: [lan-discover]} and {program: phone-bridge, verbs: [lan-control]} (no other tool plans), and every command the compiled scan and press plan routes answer must fit the kernel's grammar exactly, mirrored from oshal-kernel crates/oshald/src/computer_plans.rs (declared, PlanShape::fits, argument): the bridge prefix, the tool's own declared verb and --b64 with canonical base64 of one JSON object of at most 4 KiB. Negative controls prove the mirror refuses what the kernel refuses. Removing a declaration or drifting the command turns this red; a plan that does not fit is never kept, so Jarvis could press nothing. The descriptions, the plans' next step and the persona name computer.run_plan and the planId, and no longer computer.run.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | home 1.7.0 (T45 part 4): on an Android TV, now_playing, play, pause, next, previous and stop are planned with bridge 1.8.0, a Samsung TV and a Roku refuse them in words, the recorded answer says what is playing (behind another app or not) and the TV keeps it, also across a new scan; the card has the media row and the Now playing line only on an Android TV.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Exercise the generated overview asset handlers with exact contained paths and actual MIME/cache headers; retain every device-plan, ownership and result assertion.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'home-lan-'));
process.env.OSHAL_HOME_DATA_DIR = DATA;
const lan = require('../routes/home-lan-devices.js');
const yaml = require(path.join(ROOT, '..', 'scripts', 'toolchain', 'node_modules', 'js-yaml'));
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));

const PC = { id: '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f', name: 'Den PC' };
const MAC_SAMSUNG = '02:00:5e:10:20:30';
const decode = (command) => JSON.parse(Buffer.from(command.split(' ').pop(), 'base64').toString('utf8'));
const COMMAND = /^python3 -I "\$HOME\/\.local\/share\/oshal-phone-bridge\/oshal_phone_bridge\.py" (lan-discover|lan-control) --b64 [A-Za-z0-9+/]+=*$/;
const FOUND = [
  { address: '10.20.30.40', kind: 'samsung-tizen', name: 'Den TV', model: 'QN00TEST', os: 'Tizen', power: 'on', mac: MAC_SAMSUNG, controllable: true, samsung: { tokenSaved: false } },
  { address: '10.20.30.41', kind: 'roku', name: 'Guest room stick', room: 'Guest room', power: 'off', mac: '02:00:5e:40:50:60', controllable: true },
  { address: '10.20.30.42', kind: 'android-tv', name: 'Shed TV', mac: '', controllable: true, adb: { state: 'device', appVersionCode: 709 } },
  { address: '10.20.30.43', kind: 'cast', name: 'Hall screen', controllable: false },
  { address: '198.51.100.7', kind: 'roku', name: 'Not at home' },
  { address: '10.20.30.44', kind: 'toaster', name: 'Not a TV' },
];
const scanLine = (found) => JSON.stringify({ ok: true, verb: 'lan-discover', found, woke: [], subnets: ['10.20.30.0/24'] });

function seed(sub) {
  return lan.recordAnswer(sub, { op: 'discover', computer: PC, reply: `noise\n${scanLine(FOUND)}\n` });
}

test('a scan is planned, never done: the closed lan-discover command, waking saved TVs only when asked', () => {
  const plan = lan.planDiscover('person-a', { computer: { ...PC, name: 'Den PC"; rm -rf ~\n' } });
  assert.equal(plan.status, 200);
  assert.deepEqual([plan.body.ok, plan.body.planned, plan.body.executed, plan.body.status, plan.body.verb], [true, true, false, 'planned', 'lan-discover']);
  assert.match(plan.body.command, COMMAND);
  assert.deepEqual(decode(plan.body.command), {});
  assert.doesNotMatch(plan.body.command, /rm -rf|Den PC/, 'the computer name never reaches the command');
  assert.match(plan.body.next, /^Planned, not done yet\. When computer\.run_plan is offered, pass the planId this answer carries to computer\.run_plan/);
  seed('person-a');
  assert.deepEqual(decode(lan.planDiscover('person-a', {}).body.command), {}, 'no wake unless asked');
  const wake = lan.planDiscover('person-a', { wakeSaved: true });
  assert.deepEqual(decode(wake.body.command), { wake: [{ mac: MAC_SAMSUNG, address: '10.20.30.40' }, { mac: '02:00:5e:40:50:60', address: '10.20.30.41' }] });
  assert.equal(wake.body.wakes, 2);
});

test('a scan registers private-address TVs for that person only, merged by hardware address', () => {
  const recorded = seed('person-b');
  assert.equal(recorded.status, 200);
  assert.deepEqual([recorded.body.ok, recorded.body.found, recorded.body.added], [true, 4, 4]);
  const tvs = lan.readLan('person-b').tvs;
  assert.deepEqual(tvs.map((tv) => tv.name), ['Den TV', 'Guest room stick', 'Hall screen', 'Shed TV']);
  assert.ok(!tvs.some((tv) => tv.address === '198.51.100.7'), 'a public address is never saved');
  const shed = tvs.find((tv) => tv.name === 'Shed TV');
  assert.deepEqual(shed.adb, { state: 'device', appVersionCode: 709, appInstalled: true });
  assert.deepEqual(shed.computer, PC);
  assert.equal(tvs.find((tv) => tv.kind === 'cast').controllable, false);
  assert.deepEqual(recorded.body.phoneControl, [{ name: 'Shed TV', address: '10.20.30.42:5555', platform: 'android', form: 'tv', computerNodeId: PC.id }]);
  const moved = lan.recordAnswer('person-b', { op: 'discover', computer: PC, reply: { computer: 'Den PC', ok: true, result: { stdout: scanLine([{ ...FOUND[0], address: '10.20.30.50' }]) } } });
  assert.deepEqual([moved.body.added, moved.body.updated], [0, 1]);
  assert.equal(lan.readLan('person-b').tvs.find((tv) => tv.name === 'Den TV').address, '10.20.30.50', 'same TV at its new address');
  assert.deepEqual(lan.readLan('someone-else').tvs, [], 'another person sees none of them');
  assert.equal(fs.statSync(path.join(DATA, 'person-b', 'lan-tvs.json')).mode & 0o777, 0o600);
});

test('a refused or unreadable scan answer is said in words', () => {
  const old = lan.recordAnswer('person-c', { op: 'discover', computer: PC, reply: '{"ok":false,"error":"unknown_verb","message":"There is no \'lan-discover\' here."}' });
  assert.equal(old.status, 200);
  assert.deepEqual([old.body.ok, old.body.recorded, old.body.error], [false, true, 'unknown_verb']);
  assert.match(old.body.hint, /older than 1\.8\.0.*Scan for TVs/);
  assert.equal(lan.readLan('person-c').lastScan.ok, false);
  assert.equal(lan.recordAnswer('person-c', { op: 'discover', reply: 'not json' }).body.error, 'reply_unreadable');
  assert.equal(lan.recordAnswer('person-c', { op: 'discover', reply: { ok: true, verb: 'lan-control' } }).body.error, 'wrong_reply');
  assert.equal(lan.recordAnswer('person-c', { op: 'reboot', reply: '{}' }).body.error, 'bad_op');
});

test('a press is planned per kind with the closed action list, and refused in words when a TV cannot do it', () => {
  seed('person-d');
  const volume = lan.planControl('person-d', { device: 'the samsung', action: 'volume_up' });
  assert.equal(volume.status, 200);
  assert.deepEqual([volume.body.planned, volume.body.executed, volume.body.verb, volume.body.actionWords], [true, false, 'lan-control', 'Volume up']);
  assert.match(volume.body.command, COMMAND);
  assert.deepEqual(decode(volume.body.command), { kind: 'samsung-tizen', address: '10.20.30.40', action: 'volume_up', mac: MAC_SAMSUNG });
  assert.deepEqual(volume.body.computer, PC);
  assert.deepEqual(decode(lan.planControl('person-d', { device: 'guest room roku', action: 'select' }).body.command),
    { kind: 'roku', address: '10.20.30.41', action: 'select', mac: '02:00:5e:40:50:60' });
  assert.equal(decode(lan.planControl('person-d', { device: 'Shed TV', action: 'open_app' }).body.command).action, 'open_app');
  const refused = (body, host) => lan.planControl('person-d', body, host).body;
  assert.equal(refused({ device: 'Den TV', action: 'reboot' }).error, 'bad_action');
  assert.match(refused({ device: 'Guest room stick', action: 'launch_url' }).message, /cannot open a web page/);
  assert.equal(refused({ device: 'Guest room stick', action: 'pair' }).error, 'not_for_this_tv');
  assert.equal(refused({ device: 'Den TV', action: 'open_app' }).error, 'not_for_this_tv');
  assert.equal(refused({ device: 'Hall screen', action: 'home' }).error, 'not_controllable');
  assert.equal(refused({ device: 'Attic TV', action: 'home' }).error, 'tv_not_found');
  assert.deepEqual(refused({ device: 'tv', action: 'home' }).error, 'tv_not_found');
  assert.equal(refused({ device: 'Den TV', action: 'launch_url' }, '127.0.0.1:38798').error, 'url_required');
  assert.equal(refused({ device: 'Den TV', action: 'launch_url', url: 'http://home.test/' }).error, 'url_required');
  assert.equal(decode(lan.planControl('person-d', { device: 'Den TV', action: 'launch_url' }, 'home.test').body.command).url, 'https://home.test/');
});

test('a TV\'s power changes only when its own answer says the press worked', () => {
  seed('person-e');
  const den = () => lan.readLan('person-e').tvs.find((tv) => tv.name === 'Den TV');
  const answer = (action, extra) => JSON.stringify({ ok: true, verb: 'lan-control', kind: 'samsung-tizen', address: '10.20.30.40', action, sent: true, ...extra });
  let rec = lan.recordAnswer('person-e', { op: 'control', device: den().id, action: 'off', reply: answer('off', { power: 'off' }) });
  assert.deepEqual([rec.body.ok, den().power, den().lastResult.message], [true, 'off', 'Turn off: done on Den TV.']);
  rec = lan.recordAnswer('person-e', { op: 'control', device: den().id, action: 'wake', reply: '{"ok":false,"error":"samsung_allow_on_tv","message":"Press Allow on the TV, then Retry."}' });
  assert.deepEqual([rec.body.ok, den().power, den().lastResult.error, den().samsung.paired], [false, 'off', 'samsung_allow_on_tv', false]);
  rec = lan.recordAnswer('person-e', { op: 'control', device: den().id, action: 'wake', reply: answer('wake', { address: '10.20.30.41', power: 'on' }) });
  assert.deepEqual([rec.status, rec.body.error, den().power], [400, 'wrong_reply', 'off'], 'an answer for another TV is refused');
  rec = lan.recordAnswer('person-e', { op: 'control', device: den().id, action: 'wake', reply: answer('off', { power: 'off' }) });
  assert.deepEqual([rec.status, rec.body.error], [400, 'wrong_reply'], 'an answer for another press is refused');
  rec = lan.recordAnswer('person-e', { op: 'control', device: den().id, action: 'wake', reply: answer('wake', { power: 'on' }) });
  assert.deepEqual([rec.body.ok, den().power, den().samsung.paired], [true, 'on', true]);
  const shed = lan.readLan('person-e').tvs.find((tv) => tv.name === 'Shed TV');
  rec = lan.recordAnswer('person-e', { op: 'install', device: shed.id, reply: { ok: true, verb: 'adb-install-apk', serial: '10.20.30.42:5555', installed: true } });
  assert.deepEqual([rec.body.ok, rec.body.device.adb.appInstalled, rec.body.result.action], [true, true, 'install_app']);
});

test('1.7.0: on an Android TV, what is playing and the media keys are planned, recorded in words and kept on the TV; other kinds refuse them', () => {
  seed('person-m');
  const tvs = () => lan.readLan('person-m').tvs;
  const shed = () => tvs().find((tv) => tv.name === 'Shed TV');
  for (const action of ['now_playing', 'play', 'pause', 'next', 'previous', 'stop']) {
    const plan = lan.planControl('person-m', { device: 'Shed TV', action });
    assert.equal(plan.status, 200, action);
    assert.match(plan.body.command, COMMAND);
    assert.deepEqual(decode(plan.body.command), { kind: 'android-tv', address: '10.20.30.42', action });
    assert.equal(plan.body.bridgeVersion, '1.8.0', 'the media presses need bridge 1.8.0');
  }
  for (const name of ['Den TV', 'Guest room stick']) {
    const refused = lan.planControl('person-m', { device: name, action: 'pause' });
    assert.deepEqual([refused.status, refused.body.error], [400, 'not_for_this_tv'], name);
    assert.match(refused.body.message, new RegExp(`work on Android and Fire TVs\\. On ${name} use Play/Pause\\.`));
  }
  const answer = (action, now) => JSON.stringify({ ok: true, verb: 'lan-control', kind: 'android-tv', address: '10.20.30.42', action, sent: true, now, sessions: [] });
  const youtube = { app: 'YouTube', title: 'Big Buck Bunny 60fps 4K', state: 'paused', inFront: false, package: 'com.amazon.firetv.youtube' };
  let rec = lan.recordAnswer('person-m', { op: 'control', device: shed().id, action: 'pause', reply: `noise\n${answer('pause', youtube)}\n` });
  assert.equal(rec.body.said, 'Pause sent on Shed TV; YouTube: Big Buck Bunny 60fps 4K is now paused (behind another app).');
  assert.deepEqual({ ...shed().nowPlaying, at: 'x' }, { app: 'YouTube', title: 'Big Buck Bunny 60fps 4K', state: 'paused', inFront: false, at: 'x' }, 'kept short, with no package');
  rec = lan.recordAnswer('person-m', { op: 'control', device: shed().id, action: 'now_playing', reply: answer('now_playing', { ...youtube, state: 'playing', inFront: true }) });
  assert.equal(rec.body.said, 'On Shed TV, YouTube: Big Buck Bunny 60fps 4K is playing.');
  rec = lan.recordAnswer('person-m', { op: 'control', device: shed().id, action: 'now_playing', reply: answer('now_playing', null) });
  assert.deepEqual([rec.body.said, shed().nowPlaying], ['Nothing has played on Shed TV yet.', null]);
  rec = lan.recordAnswer('person-m', { op: 'control', device: shed().id, action: 'pause', reply: '{"ok":false,"error":"nothing_playing","message":"Nothing on this TV has played anything yet."}' });
  assert.deepEqual([rec.body.ok, rec.body.said], [false, 'Nothing on this TV has played anything yet.'], 'a refusal is said as the TV said it');
  lan.recordAnswer('person-m', { op: 'control', device: shed().id, action: 'pause', reply: answer('pause', youtube) });
  seed('person-m');
  assert.equal(shed().nowPlaying.app, 'YouTube', 'a new scan keeps what the TV last said was playing');
});

/** The compiled router with the framework modules it imports at load, like tests/kernel-egress.test.cjs. */
function homeRoutes() {
  const STUBS = {
    express: { Router: () => { const routes = {}; const add = (m) => (p, f) => { routes[`${m} ${p}`] = f; }; return { routes, get: add('GET'), post: add('POST'), delete: add('DELETE') }; } },
    '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {} }) },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/home-schedule-dispatch': { getHomeScheduleService: () => null },
    '@/shared/utils/sun-times': { nextSunEvent: () => null },
    '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => assert.fail('no model call expected') },
    '@/shared/security/explicit-write-confirmation': { hasExplicitWriteConfirmation: (b) => b?.confirm === true, confirmationRequiredPayload: (code) => ({ error: 'confirmation_required', code }) },
  };
  const original = Module._load;
  Module._load = function (request, ...rest) { return Object.prototype.hasOwnProperty.call(STUBS, request) ? STUBS[request] : original.call(this, request, ...rest); };
  try { return require('../routes/home-routes.js').createHomeRoutes({ pool: {}, appPackageDir: ROOT }).routes; } finally { Module._load = original; }
}
const req = (sub, body, headers = {}) => ({ oidc: sub ? { user: { sub }, isAuthenticated: () => true } : undefined, body, headers });
function res() { return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; } }; }

test('the extracted overview assets use exact contained routes with their actual MIME types', () => {
  const routes = homeRoutes();
  for (const [file, type] of [['home-overview.js', 'application/javascript; charset=utf-8'], ['home-overview.css', 'text/css; charset=utf-8']]) {
    const out = res(); out.sendFile = filename => { out.filename = filename; };
    routes[`GET /ui/${file}`]({ params: { file: '../../private' } }, out);
    assert.equal(out.filename, path.join(ROOT, 'tools', file));
    assert.ok(fs.statSync(out.filename).size > 0);
    assert.equal(out.headers['Content-Type'], type);
    assert.equal(out.headers['Cache-Control'], 'no-cache');
  }
  assert.equal(Object.keys(routes).some(route => route.startsWith('GET /ui/') && route.includes(':')), false);
});

test('the routes need a person, live under /lan, and /control answers a network TV in words without flipping it', async () => {
  const routes = homeRoutes();
  for (const key of ['GET /lan/devices', 'POST /lan/discover-plan', 'POST /lan/control-plan', 'POST /lan/record', 'GET /ui/home-tvs.js']) assert.ok(routes[key], key);
  let out = res();
  routes['GET /lan/devices'](req(null), out);
  assert.equal(out.statusCode, 401);
  out = res();
  routes['POST /lan/discover-plan'](req('person-f', {}), out);
  assert.deepEqual([out.statusCode, out.body.planned, out.headers['Cache-Control']], [200, true, 'no-store']);
  out = res();
  routes['POST /lan/record'](req('person-f', { op: 'discover', computer: PC, reply: scanLine(FOUND) }), out);
  assert.equal(out.body.found, 4);
  out = res();
  routes['POST /lan/control-plan'](req('person-f', { device: 'Den TV', action: 'launch_url' }, { host: 'home.test' }), out);
  assert.equal(decode(out.body.command).url, 'https://home.test/');
  const { registerLocalSwarmDevice, readLocalSwarmDevices } = require('../routes/home-local-swarm.js');
  registerLocalSwarmDevice('person-f', { name: 'Bedroom TV', category: 'TV', protocol: 'swarm-node', address: '10.20.30.60' });
  out = res();
  await routes['POST /control'](req('person-f', { device: 'bedroom-tv', cmd: 'off', confirm: true }), out);
  assert.deepEqual([out.statusCode, out.body.error], [409, 'tv_needs_computer']);
  assert.match(out.body.message, /TVs and streaming sticks/);
  assert.equal(readLocalSwarmDevices('person-f').find((d) => d.key === 'bedroom-tv').switch, 'on', 'the saved switch did not flip');
});

test('the manifest declares the four TV tools inside /api/home, TV routing words and no new egress', () => {
  const m = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const tools = Object.fromEntries(m.tools.map((t) => [t.name, t]));
  assert.equal(tools['home-lan-devices'].executor.apiEndpoint, 'GET /api/home/lan/devices');
  assert.equal(tools['home-lan-discover'].executor.apiEndpoint, 'POST /api/home/lan/discover-plan');
  assert.equal(tools['home-lan-control'].executor.apiEndpoint, 'POST /api/home/lan/control-plan');
  assert.equal(tools['home-lan-record'].executor.apiEndpoint, 'POST /api/home/lan/record');
  assert.deepEqual(tools['home-lan-control'].inputSchema.properties.action.enum, [...lan.LAN_ACTIONS]);
  for (const name of ['home-lan-discover', 'home-lan-control']) assert.match(tools[name].usageInstructions, /planned, never that it/);
  for (const tool of m.tools) assert.doesNotMatch(tool.executor.apiEndpoint, /\/api\/computers|\/api\/nodes/, `${tool.name} stays inside the package`);
  for (const word of ['tv', 'tvs', 'roku', 'scan my network', 'volume down', 'open oshal on']) assert.ok(m.bots[0].routingKeywords.includes(word), word);
  assert.match(m.description, /TVs and streaming sticks/);
  assert.deepEqual(m.egress.map((e) => e.host), ['nominatim.openstreetmap.org', 'api.weather.gov', 'api.smartthings.com']);
  const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'personas', 'home-bot.yaml'), 'utf8'));
  assert.match(persona.perspective, /A plan is not an action/);
  assert.ok(persona.routingKeywords.includes('scan my network'));
});

/**
 * The kernel's plan contract, mirrored from oshal-kernel crates/oshald/src/computer_plans.rs (09923dec): the closed
 * program list (PROGRAMS), what a tool may declare (declared) and the one command shape that fits it (PlanShape::fits,
 * argument). The kernel keeps a plan only when the tool's 200 answer has a command that fits; otherwise the model gets
 * planNotMade and computer.run_plan has nothing to run.
 */
const KERNEL_PROGRAMS = new Map([['phone-bridge', {
  prefix: 'python3 -I "$HOME/.local/share/oshal-phone-bridge/oshal_phone_bridge.py"', verbs: ['lan-discover', 'lan-control'],
}]]);
const MAX_ARGUMENT_BYTES = 4096;

function kernelDeclared(tool) {
  const plan = tool.computerPlan;
  if (plan === undefined) return null;
  assert.ok(plan && typeof plan === 'object' && !Array.isArray(plan) && Object.keys(plan).every((key) => key === 'program' || key === 'verbs'), 'computerPlan is {program, verbs}');
  const program = KERNEL_PROGRAMS.get(plan.program);
  assert.ok(program, `the kernel holds no program ${plan.program}`);
  assert.ok(Array.isArray(plan.verbs) && plan.verbs.length > 0, 'computerPlan declares no verbs');
  for (const verb of plan.verbs) assert.ok(program.verbs.includes(verb), `${plan.program} does not take ${verb}`);
  return { prefix: program.prefix, verbs: plan.verbs };
}

function kernelArgument(encoded) {
  const body = encoded.replace(/=+$/, '');
  const shaped = body.length > 0 && encoded.length - body.length <= 2 && encoded.length <= Math.ceil(MAX_ARGUMENT_BYTES / 3) * 4
    && /^[A-Za-z0-9+/]+$/.test(body);
  if (!shaped) return false;
  const bytes = Buffer.from(encoded, 'base64');
  // Padded standard base64 that decodes exactly (Rust's STANDARD engine): re-encoding gives the same text.
  if (bytes.toString('base64') !== encoded || bytes.length > MAX_ARGUMENT_BYTES) return false;
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  } catch {
    return false;
  }
}

/** The verb, when command is exactly `<prefix> <one declared verb> --b64 <base64 JSON object>`, else null. */
function kernelFits(shape, command) {
  if (typeof command !== 'string' || !command.startsWith(`${shape.prefix} `)) return null;
  const rest = command.slice(shape.prefix.length + 1);
  const at = rest.indexOf(' --b64 ');
  if (at < 0) return null;
  const verb = rest.slice(0, at);
  return shape.verbs.includes(verb) && kernelArgument(rest.slice(at + ' --b64 '.length)) ? verb : null;
}

/** What the kernel accepts as the computer a plan names: none, a name, or {id, name} as text. */
function kernelComputer(computer) {
  return computer === null || computer === undefined || typeof computer === 'string'
    || (typeof computer === 'object' && !Array.isArray(computer) && ['id', 'name'].every((key) => computer[key] == null || typeof computer[key] === 'string'));
}

test('the scan and press tools declare their computer plans exactly, and every plan they answer fits the kernel grammar', () => {
  const m = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const tools = Object.fromEntries(m.tools.map((t) => [t.name, t]));
  assert.deepEqual(tools['home-lan-discover'].computerPlan, { program: 'phone-bridge', verbs: ['lan-discover'] });
  assert.deepEqual(tools['home-lan-control'].computerPlan, { program: 'phone-bridge', verbs: ['lan-control'] });
  for (const tool of m.tools.filter((t) => !['home-lan-discover', 'home-lan-control'].includes(t.name))) {
    assert.equal(tool.computerPlan, undefined, `${tool.name} plans nothing for a computer`);
  }
  const scan = kernelDeclared(tools['home-lan-discover']);
  const press = kernelDeclared(tools['home-lan-control']);

  seed('person-g');
  const plannedOk = (plan) => {
    assert.equal(plan.status, 200);
    assert.ok(kernelComputer(plan.body.computer), JSON.stringify(plan.body.computer));
    return plan.body.command;
  };
  for (const body of [{}, { computer: PC }, { computer: 'Den PC' }, { wakeSaved: true }]) {
    const command = plannedOk(lan.planDiscover('person-g', body));
    assert.equal(kernelFits(scan, command), 'lan-discover', command);
    assert.equal(kernelFits(press, command), null, 'a scan never fits the press declaration');
  }
  let presses = 0;
  for (const device of ['Den TV', 'Guest room stick', 'Shed TV']) {
    for (const action of lan.LAN_ACTIONS) {
      const url = action === 'launch_url' ? `https://home.test/${'a'.repeat(230)}` : undefined;
      const plan = lan.planControl('person-g', { device, action, url }, 'home.test');
      if (plan.body.error === 'not_for_this_tv') continue;
      const command = plannedOk(plan);
      assert.equal(kernelFits(press, command), 'lan-control', `${device} ${action}`);
      assert.equal(kernelFits(scan, command), null, 'a press never fits the scan declaration');
      presses += 1;
    }
  }
  assert.equal(presses, 50, 'every press a saved TV takes: 15 on the Samsung, 13 on the Roku, 22 on the Android TV (16 and the six media presses of 1.7.0)');

  const good = plannedOk(lan.planControl('person-g', { device: 'Den TV', action: 'mute' }));
  const head = good.slice(0, good.indexOf(' --b64 '));
  const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
  for (const drifted of [`${good}; rm -rf ~`, `${good} > /tmp/out`, good.replace('python3 -I ', 'python3 '), good.replace(' lan-control ', ' lan-discover '),
    good.replace(' --b64 ', ' --json '), `${head} --b64 ${b64('{"a":1}').replace(/=+$/, '')}`, `${head} --b64 -${b64('{"a":1}').slice(1)}`,
    `${head} --b64 ${b64('[1]')}`, `${head} --b64 ${b64('"text"')}`, `${head} --b64 ${b64(JSON.stringify({ pad: 'x'.repeat(MAX_ARGUMENT_BYTES) }))}`]) {
    assert.equal(kernelFits(press, drifted), null, drifted.slice(0, 160));
  }
  for (const refused of [{ program: 'shell', verbs: ['lan-control'] }, { program: 'phone-bridge', verbs: [] }, { program: 'phone-bridge', verbs: ['adb-install-apk'] },
    { program: 'phone-bridge', verbs: ['lan-control'], command: 'x' }]) {
    assert.throws(() => kernelDeclared({ computerPlan: refused }), assert.AssertionError, JSON.stringify(refused));
  }

  for (const name of ['home-lan-discover', 'home-lan-control']) {
    for (const words of [/When computer\.run_plan is offered to you, the (scan|press) runs at once on the person's own computer/,
      /pass the planId from this tool's answer to computer\.run_plan, then record the computer's answer with home-lan-record/,
      /When computer\.run_plan is not offered or the answer has no planId, say the (scan|press) is planned/, /on the Smart Home screen/]) {
      assert.match(tools[name].description, words, name);
    }
    assert.doesNotMatch(`${tools[name].description} ${tools[name].usageInstructions}`, /computer\.run(?!_plan)|computer\.list/, `${name} names no tool home-bot lacks`);
  }
  const next = lan.planControl('person-g', { device: 'Den TV', action: 'mute' }).body.next;
  assert.match(next, /pass the planId this answer carries to computer\.run_plan: the press runs at once on the computer "Den PC"/);
  assert.ok(next.includes('home-lan-record with {"op":"control","device":"tv-02005e102030","action":"mute","computer":"Den PC"}'), next);
  assert.match(lan.planDiscover('person-g', {}).body.next, /say the scan is planned and that Scan for TVs under TVs and streaming sticks on the Smart Home screen runs it/);
  const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'personas', 'home-bot.yaml'), 'utf8'));
  assert.match(persona.perspective, /pass the planId from the plan's answer to\s+computer\.run_plan, which runs the scan or press at once on their own computer,\s+then record the computer's answer with home-lan-record/);
  assert.doesNotMatch(persona.perspective, /computer\.run(?!_plan)/, 'the persona no longer teaches computer.run');
});

test('the page section chooses the buttons, the computer and the words', async () => {
  const page = await import(path.join(ROOT, 'tools', 'home-tvs.js'));
  const actions = (tv) => Object.values(page.tvButtons(tv)).flat().map((b) => b.action);
  const roku = actions({ kind: 'roku', controllable: true });
  for (const missing of ['launch_url', 'open_app', 'pair', 'install_app']) assert.ok(!roku.includes(missing), `a Roku has no ${missing}`);
  assert.ok(roku.includes('volume_down') && roku.includes('select'));
  assert.ok(actions({ kind: 'samsung-tizen', controllable: true, samsung: { paired: false } }).includes('pair'));
  assert.ok(!actions({ kind: 'samsung-tizen', controllable: true, samsung: { paired: true } }).includes('pair'));
  assert.deepEqual(actions({ kind: 'android-tv', controllable: true, adb: { state: 'device', appInstalled: true } }).slice(-2), ['open_app', 'install_app']);
  const android = actions({ kind: 'android-tv', controllable: true, adb: { state: 'off' } });
  for (const media of ['previous', 'pause', 'play', 'next', 'now_playing']) {
    assert.ok(android.includes(media), `an Android TV has ${media}`);
    assert.ok(!roku.includes(media) && !actions({ kind: 'samsung-tizen', controllable: true }).includes(media), `only an Android TV has ${media}`);
  }
  assert.equal(page.nowPlayingLine({ app: 'YouTube', title: 'Big Buck Bunny', state: 'paused', inFront: false }), 'Now playing · YouTube: Big Buck Bunny · paused · behind another app');
  assert.equal(page.nowPlayingLine({ app: 'Netflix', title: null, state: 'playing', inFront: true }), 'Now playing · Netflix · playing');
  assert.equal(page.nowPlayingLine(null), '');
  assert.ok(!actions({ kind: 'android-tv', controllable: true, adb: { state: 'off' } }).includes('install_app'), 'install only on a TV this computer may use');
  assert.deepEqual(actions({ kind: 'cast', controllable: false }), []);
  const standing = (c) => ({ usable: c.connected && c.can_control });
  const support = (c) => ({ ok: c.platform === 'linux' });
  const computers = [{ id: 'a', platform: 'android', connected: true, can_control: true }, { id: 'w', platform: 'windows', connected: true, can_control: true },
    { id: 'o', platform: 'linux', connected: false }, { id: 'l', platform: 'linux', connected: true, can_control: true }];
  assert.equal(page.pickComputer(computers, standing, support).id, 'l');
  assert.equal(page.pickComputer([], standing, support), null);
  assert.deepEqual(page.resultWords({ ok: false, error: 'samsung_allow_on_tv', message: 'x' }), { text: 'Press Allow on the TV, then Retry.', retry: true });
  assert.deepEqual(page.resultWords({ ok: true, message: 'Mute: done on Den TV.' }), { text: 'Mute: done on Den TV.', retry: false });
});
