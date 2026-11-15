/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | home 1.9.1 (Lane TV1; Roger, 2026-11-13, asked that Jarvis open an application such as Netflix on his Roku and Samsung TVs and know where it is): on a Roku or a Samsung TV, launch_app, list_apps and active_app are planned as the closed lan-control command with a checked application id (or a name the TV listed), a Roku title as a bounded content id that is never a web address, and bridge 1.20.0; a title on a Samsung TV, an unknown application, an ambiguous name and an Android TV are refused in words and plan nothing. The applications a TV listed are kept on that TV for that person, also across a new scan. A recorded answer says only what the TV reported in front, and an older bridge's bad_action carries the update hint. The tool, the application's description and the persona say what each kind of TV can do and that a Roku or Samsung screen is never seen, with no new routing word.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'home-lan-direct-'));
process.env.OSHAL_HOME_DATA_DIR = DATA;
const lan = require('../routes/home-lan-devices.js');
const yaml = require(path.join(ROOT, '..', 'scripts', 'toolchain', 'node_modules', 'js-yaml'));
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));

const PC = { id: '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f', name: 'Den PC' };
const MAC_SAMSUNG = '02:00:5e:10:20:30';
const MAC_ROKU = '02:00:5e:40:50:60';
const TIZEN_APP = '3201907018807';
const COMMAND = /^python3 -I "\$HOME\/\.local\/share\/oshal-phone-bridge\/oshal_phone_bridge\.py" lan-control --b64 [A-Za-z0-9+/]+=*$/;
const decode = (command) => JSON.parse(Buffer.from(command.split(' ').pop(), 'base64').toString('utf8'));
const FOUND = [
  { address: '10.20.30.40', kind: 'samsung-tizen', name: 'Den TV', model: 'QN00TEST', os: 'Tizen', power: 'on', mac: MAC_SAMSUNG, controllable: true, samsung: { tokenSaved: true } },
  { address: '10.20.30.41', kind: 'roku', name: 'Guest room stick', room: 'Guest room', power: 'on', mac: MAC_ROKU, controllable: true },
  { address: '10.20.30.42', kind: 'android-tv', name: 'Shed TV', mac: '', controllable: true, adb: { state: 'device', appVersionCode: 709 } },
  { address: '10.20.30.43', kind: 'cast', name: 'Hall screen', controllable: false },
];
const scanLine = JSON.stringify({ ok: true, verb: 'lan-discover', found: FOUND, woke: [], subnets: ['10.20.30.0/24'] });
const seed = (sub) => lan.recordAnswer(sub, { op: 'discover', computer: PC, reply: scanLine });
const tvOf = (sub, name) => lan.readLan(sub).tvs.find((tv) => tv.name === name);
const plan = (sub, body) => lan.planControl(sub, body);
const ROKU = { kind: 'roku', address: '10.20.30.41' };
const SAMSUNG = { kind: 'samsung-tizen', address: '10.20.30.40' };
/** One bridge line for a press, as the person's computer prints it. */
const line = (tv, action, extra) => JSON.stringify({ ok: true, verb: 'lan-control', ...tv, action, sent: true, tookMs: 12, ...extra });
const record = (sub, name, action, reply) => lan.recordAnswer(sub, { op: 'control', device: tvOf(sub, name).id, action, reply });
const ROKU_APPS = [{ id: '12', name: 'Netflix' }, { id: '2285', name: 'Hulu' }, { id: '837', name: 'YouTube' }, { id: '195316', name: 'YouTube TV' }];

test('an application is planned by its checked id on a Roku and a Samsung TV, a Roku title by its content id, with bridge 1.20.0', () => {
  seed('person-a');
  const netflix = plan('person-a', { device: 'guest room roku', action: 'launch_app', app: '12' });
  assert.equal(netflix.status, 200, netflix.body.message);
  assert.deepEqual([netflix.body.planned, netflix.body.executed, netflix.body.verb, netflix.body.actionWords, netflix.body.bridgeVersion],
    [true, false, 'lan-control', 'Open an application', '1.20.0']);
  assert.match(netflix.body.command, COMMAND);
  assert.deepEqual(decode(netflix.body.command), { ...ROKU, action: 'launch_app', mac: MAC_ROKU, app: '12' });
  assert.deepEqual(netflix.body.computer, PC, 'the plan names the computer that found the TV');
  const title = plan('person-a', { device: 'Guest room stick', action: 'launch_app', app: 12, contentId: '80057281', mediaType: 'MOVIE' });
  assert.deepEqual(decode(title.body.command), { ...ROKU, action: 'launch_app', mac: MAC_ROKU, app: '12', contentId: '80057281', mediaType: 'movie' });
  assert.deepEqual(decode(plan('person-a', { device: 'Guest room stick', action: 'launch_app', app: '837', contentId: 'aqz-KE_bpKQ' }).body.command),
    { ...ROKU, action: 'launch_app', mac: MAC_ROKU, app: '837', contentId: 'aqz-KE_bpKQ' });
  assert.deepEqual(decode(plan('person-a', { device: 'the samsung', action: 'launch_app', app: TIZEN_APP }).body.command),
    { ...SAMSUNG, action: 'launch_app', mac: MAC_SAMSUNG, app: TIZEN_APP });
  assert.equal(decode(plan('person-a', { device: 'Den TV', action: 'launch_app', app: 'org.tizen.browser' }).body.command).app, 'org.tizen.browser');
  assert.deepEqual(decode(plan('person-a', { device: 'Guest room stick', action: 'list_apps', app: 'ignored' }).body.command), { ...ROKU, action: 'list_apps', mac: MAC_ROKU });
  assert.deepEqual(decode(plan('person-a', { device: 'Guest room stick', action: 'active_app' }).body.command), { ...ROKU, action: 'active_app', mac: MAC_ROKU });
  assert.deepEqual(decode(plan('person-a', { device: 'Den TV', action: 'active_app', app: TIZEN_APP }).body.command), { ...SAMSUNG, action: 'active_app', mac: MAC_SAMSUNG, app: TIZEN_APP });
  assert.match(plan('person-a', { device: 'Den TV', action: 'list_apps' }).body.next, /^Planned, not done yet\./);
});

test('what is outside the closed shapes plans nothing and is said in words', () => {
  seed('person-b');
  const refused = (body) => { const answer = plan('person-b', body); assert.equal(answer.body.command, undefined, JSON.stringify(body)); return answer; };
  let answer = refused({ device: 'Guest room stick', action: 'launch_app' });
  assert.deepEqual([answer.status, answer.body.error], [400, 'app_required']);
  assert.match(answer.body.message, /list_apps/);
  for (const app of ['dev', 'tvinput.hdmi1', '12/../keypress/Home', '12?contentId=1', 'Netflix', '12345678901']) {
    answer = refused({ device: 'Guest room stick', action: 'launch_app', app });
    assert.deepEqual([answer.status, answer.body.error], [400, 'app_unknown'], app);
    assert.match(answer.body.message, /No application list is saved for Guest room stick yet\. Read its applications first \(action list_apps\)/);
  }
  for (const app of ['../x', 'a/b', 'x y', `a.${'b'.repeat(80)}`, 'org.tizen.browser?x=1']) {
    assert.equal(refused({ device: 'Den TV', action: 'launch_app', app }).body.error, 'app_unknown', app);
  }
  for (const contentId of ['https://evil.test/watch', 'a b', 'a&mediaType=x', 'a/b', 'x'.repeat(256)]) {
    answer = refused({ device: 'Guest room stick', action: 'launch_app', app: '12', contentId });
    assert.deepEqual([answer.status, answer.body.error], [400, 'bad_content'], contentId);
    assert.match(answer.body.message, /never a web address/);
  }
  assert.equal(refused({ device: 'Guest room stick', action: 'launch_app', app: '12', contentId: '1', mediaType: 'trailer' }).body.error, 'bad_media_type');
  assert.equal(refused({ device: 'Guest room stick', action: 'launch_app', app: '12', mediaType: 'movie' }).body.error, 'bad_content');
  answer = refused({ device: 'Den TV', action: 'launch_app', app: TIZEN_APP, contentId: '80057281' });
  assert.deepEqual([answer.status, answer.body.error], [400, 'title_not_on_samsung']);
  assert.match(answer.body.message, /cannot be opened directly on Den TV, a Samsung TV/);
  answer = refused({ device: 'Den TV', action: 'active_app' });
  assert.deepEqual([answer.status, answer.body.error], [400, 'app_required']);
  assert.match(answer.body.message, /answers about one application at a time/);
  for (const action of lan.FRONT_ACTIONS) {
    answer = refused({ device: 'Shed TV', action, app: '12' });
    assert.deepEqual([answer.status, answer.body.error], [400, 'not_for_this_tv'], action);
    assert.match(answer.body.message, /Shed TV is an Android or Fire TV: its applications are listed and opened through Phone & Device Control/);
    assert.equal(refused({ device: 'Hall screen', action, app: '12' }).body.error, 'not_controllable');
  }
});

test('the applications a TV listed are kept on that TV for that person, and an application is then planned by its name', () => {
  seed('person-c');
  const listed = record('person-c', 'Guest room stick', 'list_apps', `noise\n${line(ROKU, 'list_apps', { apps: [...ROKU_APPS,
    { id: '12/../x', name: 'Not an id' }, { id: '99', name: '' }, 'text'], total: 4, otherCount: 1 })}\n`);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.said, 'Guest room stick has 4 applications: Netflix (12), Hulu (2285), YouTube (837), YouTube TV (195316).');
  assert.deepEqual(tvOf('person-c', 'Guest room stick').apps, ROKU_APPS, 'only an id in its closed shape with a name is kept');
  assert.deepEqual(listed.body.device.apps, ROKU_APPS, 'the recorded answer carries the list for Jarvis');
  assert.equal(tvOf('someone-else', 'Guest room stick'), undefined, 'another person has none of it');
  const app = (name) => plan('person-c', { device: 'Guest room stick', action: 'launch_app', app: name });
  assert.equal(decode(app('netflix').body.command).app, '12');
  assert.equal(decode(app('Hul').body.command).app, '2285', 'part of a name, when one application fits');
  assert.equal(decode(app('YouTube').body.command).app, '837', 'the whole name wins over a longer one that holds it');
  const which = app('tube');
  assert.deepEqual([which.status, which.body.error, which.body.candidates], [409, 'which_app', ['YouTube (837)', 'YouTube TV (195316)']]);
  const unknown = app('Plex');
  assert.deepEqual([unknown.status, unknown.body.error], [400, 'app_unknown']);
  assert.match(unknown.body.message, /Guest room stick listed no application called "Plex"/);
  const many = Array.from({ length: 130 }, (_, index) => ({ id: String(1000 + index), name: `App ${index}` }));
  const big = record('person-c', 'Guest room stick', 'list_apps', line(ROKU, 'list_apps', { apps: many, total: 130, otherCount: 0 }));
  assert.equal(tvOf('person-c', 'Guest room stick').apps.length, 100, 'at most a hundred are kept');
  assert.match(big.body.said, /^Guest room stick has 100 applications: App 0 \(1000\), .*App 39 \(1039\), and more\.$/);
  record('person-c', 'Den TV', 'list_apps', line(SAMSUNG, 'list_apps', { apps: [{ id: TIZEN_APP, name: 'Netflix' }, { id: 'org.tizen.browser', name: 'Internet' }], total: 2, otherCount: 0 }));
  assert.equal(decode(plan('person-c', { device: 'Den TV', action: 'active_app', app: 'internet' }).body.command).app, 'org.tizen.browser');
  seed('person-c');
  assert.equal(tvOf('person-c', 'Den TV').apps.length, 2, 'a new scan keeps the applications a TV listed');
  const none = record('person-c', 'Den TV', 'list_apps', '{"ok":false,"error":"samsung_no_app_list","message":"This TV did not list its applications; not every Samsung TV does. An application still opens by its id."}');
  assert.deepEqual([none.body.ok, none.body.said], [false, 'This TV did not list its applications; not every Samsung TV does. An application still opens by its id.']);
  assert.equal(tvOf('person-c', 'Den TV').apps.length, 2, 'a refused read leaves the saved list as it was');
});

test('a recorded answer says only what the TV itself reported in front', () => {
  seed('person-d');
  const netflix = { id: '12', name: 'Netflix' };
  const inFront = { id: '12', name: 'Netflix', home: false, screensaver: null };
  const home = { id: null, name: 'Roku', home: true, screensaver: null };
  const roku = (action, extra) => record('person-d', 'Guest room stick', action, line(ROKU, action, extra));
  assert.equal(roku('launch_app', { app: netflix, front: inFront, inFront: true }).body.said, 'Netflix is in front on Guest room stick.');
  assert.deepEqual({ ...tvOf('person-d', 'Guest room stick').front, at: 'x' },
    { id: '12', name: 'Netflix', inFront: true, running: true, screensaver: null, player: null, at: 'x' });
  assert.equal(roku('launch_app', { app: netflix, front: inFront, inFront: true, contentId: '80057281', mediaType: 'movie' }).body.said,
    'Netflix is in front on Guest room stick. The title was asked for by its id; a Roku does not say which title is showing.');
  assert.equal(roku('launch_app', { app: netflix, front: home, inFront: false }).body.said,
    'Open an application was sent to Guest room stick, but Netflix was not in front when the Roku was read: its home screen was.');
  assert.equal(tvOf('person-d', 'Guest room stick').front.name, 'Home screen', 'what the Roku said is in front is what is kept');
  assert.equal(roku('launch_app', { app: netflix, front: { id: '2285', name: 'Hulu', home: false, screensaver: null }, inFront: false }).body.said,
    'Open an application was sent to Guest room stick, but Netflix was not in front when the Roku was read: Hulu was.');
  assert.equal(roku('launch_app', { app: netflix, front: null, inFront: null }).body.said,
    'Open an application was sent to Guest room stick; the Roku did not say what is in front.');
  assert.equal(roku('active_app', { front: { ...inFront, screensaver: 'Roku Digital Clock' }, player: { state: 'pause', app: netflix, positionMs: 3183, durationMs: 59158 } }).body.said,
    'On Guest room stick, Netflix is in front, its player paused, with the screensaver Roku Digital Clock showing.');
  assert.equal(tvOf('person-d', 'Guest room stick').front.player, 'pause');
  assert.equal(roku('active_app', { front: home, player: { state: 'close', app: null } }).body.said, 'On Guest room stick, the home screen is in front.');
  const tizen = { id: TIZEN_APP, name: 'Netflix' };
  const samsung = (action, extra) => record('person-d', 'Den TV', action, line(SAMSUNG, action, extra));
  assert.equal(samsung('launch_app', { app: tizen, running: true, visible: true, inFront: true, via: 'rest' }).body.said, 'Netflix is running and in front on Den TV.');
  assert.equal(samsung('launch_app', { app: tizen, running: true, visible: false, inFront: false, via: 'remote-channel' }).body.said, 'Netflix is running on Den TV but is not in front.');
  assert.equal(samsung('launch_app', { app: { id: TIZEN_APP, name: TIZEN_APP }, running: null, visible: null, inFront: null, via: 'remote-channel' }).body.said,
    `Open an application was sent to Den TV; the TV did not say whether ${TIZEN_APP} is running.`);
  assert.equal(samsung('active_app', { app: tizen, running: false, visible: false, inFront: false }).body.said, 'On Den TV, Netflix is not running.');
  assert.deepEqual({ ...tvOf('person-d', 'Den TV').front, at: 'x' }, { id: TIZEN_APP, name: 'Netflix', inFront: false, running: false, screensaver: null, player: null, at: 'x' });
  assert.equal(samsung('active_app', { app: tizen, running: true, visible: true, inFront: true }).body.said, 'On Den TV, Netflix is running and in front.');
  for (const said of [roku('launch_app', { app: netflix, front: inFront, inFront: true }).body.said, samsung('active_app', { app: tizen, running: true, visible: true }).body.said]) {
    assert.doesNotMatch(said, /screen shows|showing a|playing [A-Z]|opened the title|done on/, 'nothing past the application in front is claimed');
  }
});

test('a refusal is said in the TV\'s words, an older bridge is told how to update, and a wrong answer is refused', () => {
  seed('person-e');
  const missing = record('person-e', 'Guest room stick', 'launch_app', '{"ok":false,"error":"app_not_installed","message":"This Roku has no application with id 99999. list_apps reads the ids it has."}');
  assert.deepEqual([missing.body.ok, missing.body.said, missing.body.hint], [false, 'This Roku has no application with id 99999. list_apps reads the ids it has.', undefined]);
  assert.equal(tvOf('person-e', 'Guest room stick').front, undefined, 'a refused launch records nothing in front');
  const old = record('person-e', 'Guest room stick', 'active_app', '{"ok":false,"error":"bad_action","message":"action is one of wake, off."}');
  assert.equal(old.body.ok, false);
  assert.match(old.body.hint, /older than 1\.20\.0\. Open Smart Home, TVs and streaming sticks, and press Scan for TVs once/);
  const other = record('person-e', 'Guest room stick', 'launch_app', line(SAMSUNG, 'launch_app', { app: { id: '12', name: 'Netflix' }, inFront: true }));
  assert.deepEqual([other.status, other.body.error], [400, 'wrong_reply'], 'an answer from another TV is refused');
  const press = record('person-e', 'Guest room stick', 'launch_app', line(ROKU, 'active_app', { front: null }));
  assert.deepEqual([press.status, press.body.error], [400, 'wrong_reply'], 'an answer for another press is refused');
});

test('a Samsung TV counts as paired only after its remote channel was used, not after a REST launch or read', () => {
  lan.recordAnswer('person-f', { op: 'discover', computer: PC, reply: JSON.stringify({ ok: true, verb: 'lan-discover', found: [{ ...FOUND[0], samsung: { tokenSaved: false } }] }) });
  const paired = () => tvOf('person-f', 'Den TV').samsung.paired;
  const tizen = { id: TIZEN_APP, name: 'Netflix' };
  assert.equal(paired(), false);
  record('person-f', 'Den TV', 'active_app', line(SAMSUNG, 'active_app', { app: tizen, running: true, visible: true, inFront: true }));
  record('person-f', 'Den TV', 'launch_app', line(SAMSUNG, 'launch_app', { app: tizen, running: true, visible: true, inFront: true, via: 'rest' }));
  assert.equal(paired(), false, 'the REST port needs no pairing, so its answers prove none');
  record('person-f', 'Den TV', 'launch_app', line(SAMSUNG, 'launch_app', { app: tizen, running: true, visible: true, inFront: true, via: 'remote-channel' }));
  assert.equal(paired(), true);
});

test('the tool, the description and the persona say what each kind of TV can do, and that a Roku or Samsung screen is never seen', () => {
  const m = yaml.load(fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8'));
  const tools = Object.fromEntries(m.tools.map((t) => [t.name, t]));
  const control = tools['home-lan-control'];
  for (const action of lan.FRONT_ACTIONS) assert.ok(control.inputSchema.properties.action.enum.includes(action), action);
  assert.deepEqual(control.inputSchema.properties.mediaType.enum, [...lan.MEDIA_TYPES]);
  assert.deepEqual([control.inputSchema.properties.app.maxLength, control.inputSchema.properties.contentId.maxLength], [120, 255]);
  assert.deepEqual(control.computerPlan, { program: 'phone-bridge', verbs: ['lan-control'] }, 'the same closed verb; no new plan');
  const told = `${control.description} ${control.usageInstructions}`.split(/\s+/).join(' ');
  const persona = yaml.load(fs.readFileSync(path.join(ROOT, 'personas', 'home-bot.yaml'), 'utf8'));
  const taught = persona.perspective.split(/\s+/).join(' ');
  for (const [where, text] of [['tool', told], ['persona', taught]]) {
    assert.match(text, /launch_app/, where);
    assert.match(text, /list_apps/, where);
    assert.match(text, /active_app/, where);
    assert.match(text, /A Roku and a Samsung TV are buttons only/, where);
    assert.match(text, /no screenshot and no on-screen text/, where);
    assert.match(text, /Android or Fire TV that runs Orbit/, where);
    assert.match(text, /not through Smart Home/, where);
  }
  assert.match(taught, /never offer a screenshot or to read the screen of a Roku or a Samsung TV/);
  assert.match(taught, /say where a press landed only as far as active_app shows/);
  assert.match(told, /a Samsung TV says whether the one application named is running and in front/);
  assert.match(tools['home-lan-devices'].description, /the applications it listed and what it last reported in front/);
  const described = String(m.description).split(/\s+/).join(' ');
  assert.match(described, /On a Roku or a Samsung TV it also opens an application, lists the applications and says which one is in front/);
  assert.match(described, /cannot see a Roku's or a Samsung TV's screen/);
  for (const words of [m.bots[0].routingKeywords, persona.routingKeywords]) {
    assert.ok(!words.some((word) => /netflix|launch|application|in front|app\b/i.test(word)), 'no routing word was added for this');
  }
  assert.equal(m.bots[0].routingKeywords.length, 62, 'the routing words are the 62 of 1.9.0');
  assert.deepEqual(m.egress.map((e) => e.host), ['nominatim.openstreetmap.org', 'api.weather.gov', 'api.smartthings.com'], 'no new egress');
});
