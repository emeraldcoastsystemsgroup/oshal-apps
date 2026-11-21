/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.19.0: the Fire TV guide tool declares devicePath, the way the kernel's path planner (device.path, kernel ADR-219) may offer through a phone's Fire TV app. The declaration is held to the closed lists the kernel accepts (crates/api/src/device_paths.rs `template`, crates/nodes/src/paths.rs), to the guide's own package and steps, and to what the guide says it cannot see. It goes red when a field or value leaves those lists, when a second tool declares a path, or when the declaration and the guide disagree.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.20.4: Play a Show on a TV declares devicePath with how: computer-plan (kernel ADR-219 decision 11, kernel commit 2816eff1), so two tools declare a path. `refusal` is the kernel's `template` again, now for both shapes and in its own words: the closed field list of each shape, a computer-plan declaration refused on a tool with no computerPlan, target and slots as input field names, and every list (the jobs now include the phone jobs). The play tool's declaration is also held to the tool itself (target and each slot's field are real input fields, and every required field is filled) and to what its plan does on a scripted Fire TV (the bridge's own play_title: it wakes first, opens the application, presses keys, types nothing, reads what is playing, and is refused on a TV without Prime Video's Fire TV package).
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = (() => {
  for (const candidate of [path.resolve(__dirname, '../../scripts/toolchain/node_modules/js-yaml'), 'js-yaml']) {
    try { return require(candidate); } catch { /* use the installed test toolchain */ }
  }
  throw new Error('js-yaml is required: run npm ci --prefix scripts/toolchain');
})();

const root = path.resolve(__dirname, '..');
const manifest = yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'));
const GUIDE = 'phone-control-fire-tv-guide';
const PLAY = 'phone-control-play-show';

// The kernel's closed lists, as crates/nodes/src/inventory.rs (Kind) and crates/nodes/src/paths.rs name them.
const KINDS = ['thing', 'device', 'computer', 'phone', 'android-phone', 'iphone', 'tablet', 'tv', 'fire-tv', 'android-tv', 'roku', 'samsung-tv', 'printer', 'camera', 'speaker', 'watch'];
const JOBS = ['tv.wake', 'tv.resume', 'tv.open-app', 'tv.play-title', 'tv.open-link', 'tv.keys', 'tv.observe', 'phone.screenshot', 'phone.open-app', 'phone.tap', 'phone.type'];
const CONTROLS = ['open-app', 'open-link', 'keys', 'pointer', 'text', 'media', 'wake'];
const OBSERVES = ['screen-text', 'foreground-app', 'media-session', 'power-state'];
// What each shape may hold (crates/api/src/device_paths.rs COMPANION_FIELDS and PLAN_FIELDS).
const COMPANION_FIELDS = ['how', 'on', 'app', 'reaches', 'jobs', 'controls', 'observes', 'wakes'];
const PLAN_FIELDS = ['how', 'target', 'slots', 'reaches', 'jobs', 'controls', 'observes', 'wakes'];
// What changes from one request for a job to the next (crates/nodes/src/path_steps.rs `Job::slots`).
const JOB_SLOTS = { 'tv.play-title': ['title'], 'tv.open-app': ['app'], 'phone.open-app': ['app'], 'tv.open-link': ['link'], 'phone.type': ['text'] };
const MAX_DECLARED = 8;
const NO_PLAN = 'its devicePath how is computer-plan, and the tool declares no computerPlan';
const NOT_A_FIELD = (key) => `its devicePath ${key} names one of the tool's input fields`;

/** Why one declared list is refused, or null (the kernel's `declared`). */
function listRefusal(declared, key, allowed, needed) {
  const value = declared[key];
  if (value === undefined) return needed ? `its devicePath needs ${key}` : null;
  if (!Array.isArray(value) || value.length > MAX_DECLARED || (needed && value.length === 0)) return `its devicePath ${key} is a list of 1 to ${MAX_DECLARED} values`;
  const off = value.find((entry) => typeof entry !== 'string' || !allowed.includes(entry));
  return off === undefined ? null : `its devicePath ${key} names ${JSON.stringify(off)}`;
}

/** Whether a value is the name of an input field as the kernel takes one (`input_field`): 1 to 40 letters, digits or _. */
function fieldName(value) {
  return typeof value === 'string' && value.length <= 40 && /^[A-Za-z0-9_]+$/.test(value);
}

/** Why the slots of a computer-plan declaration are refused, or null (the kernel's `slot_fields`). */
function slotsRefusal(declared) {
  if (declared.slots === undefined) return null;
  const slots = declared.slots;
  if (!slots || typeof slots !== 'object' || Array.isArray(slots) || Object.keys(slots).length > MAX_DECLARED) {
    return 'its devicePath slots is an object of a job\'s slots and the tool\'s input fields';
  }
  for (const slot of Object.keys(slots).sort()) {
    if (!declared.jobs.some((job) => (JOB_SLOTS[job] || []).includes(slot))) return `its devicePath slots names ${slot}, which none of its jobs has`;
    if (!fieldName(slots[slot])) return NOT_A_FIELD('slots');
  }
  return null;
}

/** Why the application of a companion declaration is refused, or null (the kernel's `companion_app`). */
function appRefusal(declared) {
  const app = typeof declared.app === 'string' ? declared.app : '';
  const words = app.split('.');
  const named = app.length <= 128 && words.length >= 2 && words.every((word) => /^[A-Za-z0-9_]+$/.test(word));
  return named ? null : 'its devicePath app is an application\'s package name';
}

/**
 * @description Why the kernel would refuse this declaration, or null: the checks of its `template`
 *   (crates/api/src/device_paths.rs), in its order and its words.
 * @param {unknown} declared The tool's devicePath. @param {boolean} runsPlan Whether the tool declares computerPlan.
 * @returns {string|null} The kernel's words, or null for a declaration it takes.
 */
function refusal(declared, runsPlan) {
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return 'its devicePath is not an object';
  if (!['companion-app', 'computer-plan'].includes(declared.how)) return 'its devicePath how is companion-app or computer-plan';
  const companion = declared.how === 'companion-app';
  const odd = Object.keys(declared).sort().find((key) => !(companion ? COMPANION_FIELDS : PLAN_FIELDS).includes(key));
  if (odd) return `its devicePath does not take ${odd}`;
  if (!companion && !runsPlan) return NO_PLAN;
  const checks = [() => listRefusal(declared, 'jobs', JOBS, true)];
  if (companion) checks.push(() => appRefusal(declared), () => listRefusal(declared, 'on', KINDS, true));
  else checks.push(() => (fieldName(declared.target) ? null : NOT_A_FIELD('target')), () => slotsRefusal(declared));
  checks.push(() => listRefusal(declared, 'reaches', KINDS, true), () => listRefusal(declared, 'controls', CONTROLS, false),
    () => listRefusal(declared, 'observes', OBSERVES, false));
  for (const check of checks) {
    const why = check();
    if (why) return why;
  }
  return null;
}

/** The guide's own answer, from the route module itself. */
function guide() {
  let answered = null;
  const router = { get(_route, handler) { handler({ query: {}, body: {} }, { json(body) { answered = body; return body; }, status() { return this; } }); } };
  require('../routes/phone-control-remote-guides.js').mountRemoteGuides(router);
  return answered;
}

// What the bridge's own play_title sends to a scripted Fire TV (tests/python/test_oshal_phone_play.py FakeFireTv), in
// order, with its answer; then the same on a TV that has no Prime Video Fire TV package. No adb, network or device.
const PLAY_RUN = `
import json, sys
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
import test_oshal_phone_play as suite
suite.play.time.sleep = lambda _seconds: None

def run(installed):
    tv, sent = suite.FakeFireTv(installed=installed), []
    def shell(command):
        sent.append(command)
        return tv(command)
    ctx = suite.context()
    try:
        return {'sent': sent, 'answer': suite.play.play_title(ctx, 'prime', 'The Rings of Power', shell)}
    except ctx.Refusal as refused:
        return {'sent': sent, 'refused': refused.code}

print(json.dumps({'fire': run(True), 'other': run(False)}))
`;

/** What the play plan does on the scripted Fire TV and on a TV without the application: the commands sent and the answer. */
function playRuns() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-path-home-'));
  const done = spawnSync('python3', ['-I', '-B', '-c', PLAY_RUN, path.join(__dirname, 'python')], {
    encoding: 'utf8', timeout: 120000,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: home, OSHAL_PHONE_BRIDGE_STATE: path.join(home, 'state') }
  });
  fs.rmSync(home, { recursive: true, force: true });
  assert.equal(done.error, undefined, `python3 could not run: ${done.error?.message}`);
  assert.equal(done.status, 0, `${done.stdout || ''}${done.stderr || ''}`.slice(-3000));
  return JSON.parse(done.stdout.trim().split('\n').pop());
}

test('exactly two tools declare a device path: the read-only Fire TV guide and Play a Show on a TV', () => {
  const declaring = manifest.tools.filter((tool) => tool.devicePath !== undefined);
  assert.deepEqual(declaring.map((tool) => tool.name), [GUIDE, PLAY]);
  for (const tool of declaring) assert.equal(refusal(tool.devicePath, tool.computerPlan !== undefined), null, `${tool.name} declares a path the kernel takes`);
  const tool = declaring[0];
  assert.equal(tool.executor.apiEndpoint, 'GET /api/phone-control/remote-apps/fire-tv/guide');
  assert.deepEqual(tool.inputSchema, { type: 'object', properties: {}, additionalProperties: false }, 'the guide still takes no input');
  assert.equal(tool.requiresApproval, false);
});

test('every field and value of the guide\'s declaration is on the lists the kernel accepts', () => {
  const declared = manifest.tools.find((tool) => tool.name === GUIDE).devicePath;
  assert.equal(refusal(declared, false), null);
  assert.deepEqual(Object.keys(declared).sort(), [...COMPANION_FIELDS].sort(), 'every field is stated, none is left to a default');
  assert.equal(declared.wakes, true);
  for (const [field, value, words] of [
    ['address', '10.0.0.2', 'its devicePath does not take address'], ['target', 'id', 'its devicePath does not take target'],
    ['how', 'adb', 'its devicePath how is companion-app or computer-plan'], ['jobs', ['tv.cast'], 'its devicePath jobs names "tv.cast"'],
    ['on', ['toaster'], 'its devicePath on names "toaster"'], ['app', 'remote', 'its devicePath app is an application\'s package name'],
    ['reaches', [], 'its devicePath reaches is a list of 1 to 8 values']
  ]) {
    assert.equal(refusal({ ...declared, [field]: value }, false), words, `a declaration with ${field} changed is refused`);
  }
});

test('the declaration and the guide agree: the same application, waking and resuming, and no read of the TV', () => {
  const declared = manifest.tools.find((tool) => tool.name === GUIDE).devicePath;
  const answer = guide();
  assert.equal(declared.app, answer.package, 'the application the planner pins input to is the one the guide names');
  assert.deepEqual(declared.jobs, ['tv.wake', 'tv.resume'], 'only what the guide\'s steps describe');
  assert.match(answer.steps.join(' '), /wake\/resume/);
  assert.deepEqual(declared.controls, ['keys']);
  assert.deepEqual(declared.observes, [], 'the phone\'s page is not the TV screen');
  assert.match(answer.verification.join(' '), /the phone's own page is not the TV screen/);
  assert.deepEqual(declared.on, ['android-phone', 'tablet']);
  assert.deepEqual(declared.reaches, ['fire-tv']);
  assert.ok(answer.required_native_tools.includes('desktop.control.pinned'), 'every input is pinned to that application');
});

test('the play tool declares a computer-plan way the kernel takes, and a tool with no computerPlan is refused', () => {
  const tool = manifest.tools.find((entry) => entry.name === PLAY);
  const declared = tool.devicePath;
  assert.deepEqual(tool.computerPlan, { program: 'phone-bridge', verbs: ['lan-control'], revalidate: true }, 'the tool\'s plan is one a computer runs');
  assert.equal(refusal(declared, true), null);
  assert.equal(refusal(declared, false), NO_PLAN, 'the same declaration on a tool that declares no computerPlan is no way');
  assert.deepEqual(Object.keys(declared).sort(), [...PLAN_FIELDS].sort(), 'every field is stated, none is left to a default');
  assert.equal(declared.how, 'computer-plan');
  for (const [field, value, words] of [
    ['on', ['android-phone'], 'its devicePath does not take on'], ['app', 'com.example.remote', 'its devicePath does not take app'],
    ['address', '192.0.2.7', 'its devicePath does not take address'], ['how', 'adb', 'its devicePath how is companion-app or computer-plan'],
    ['target', 'the id', NOT_A_FIELD('target')], ['target', null, NOT_A_FIELD('target')], ['target', undefined, NOT_A_FIELD('target')],
    ['slots', { password: 'title' }, 'its devicePath slots names password, which none of its jobs has'],
    ['slots', { title: 'a field' }, NOT_A_FIELD('slots')], ['slots', ['title'], 'its devicePath slots is an object of a job\'s slots and the tool\'s input fields'],
    ['jobs', ['tv.cast'], 'its devicePath jobs names "tv.cast"'], ['jobs', [], 'its devicePath jobs is a list of 1 to 8 values'],
    ['jobs', undefined, 'its devicePath needs jobs'], ['reaches', undefined, 'its devicePath needs reaches'],
    ['reaches', ['toaster'], 'its devicePath reaches names "toaster"'], ['controls', ['cast'], 'its devicePath controls names "cast"'],
    ['observes', ['camera'], 'its devicePath observes names "camera"']
  ]) {
    const changed = { ...declared, [field]: value };
    if (value === undefined) delete changed[field];
    assert.equal(refusal(changed, true), words, `a declaration with ${field} set to ${JSON.stringify(value)} is refused`);
  }
  const plain = { ...declared };
  delete plain.slots;
  assert.equal(refusal(plain, true), null, 'a job with no slot declares none');
});

test('the play tool\'s target and slots are its own input fields, and they fill every field the tool requires', () => {
  const tool = manifest.tools.find((entry) => entry.name === PLAY);
  const declared = tool.devicePath;
  const fields = tool.inputSchema.properties;
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(declared.target, 'id');
  assert.deepEqual(fields[declared.target], { type: 'string', minLength: 2, maxLength: 64 }, 'the saved TV, by its id or the name it was saved under');
  assert.ok(tool.inputSchema.required.includes(declared.target));
  assert.equal(tool.executor.apiEndpoint, `POST /api/phone-control/devices/{input.${declared.target}}/play`, 'the target field is the device the route plays on');
  assert.deepEqual(declared.jobs, ['tv.play-title'], 'the one job the tool does');
  assert.deepEqual(declared.slots, { title: 'title' });
  for (const [slot, field] of Object.entries(declared.slots)) {
    assert.ok(JOB_SLOTS['tv.play-title'].includes(slot), `${slot} is a slot of the job`);
    assert.equal(fields[field]?.type, 'string', `${field} is an input field of the tool`);
  }
  const filled = [declared.target, ...Object.values(declared.slots)];
  assert.deepEqual(tool.inputSchema.required.filter((field) => !filled.includes(field)), [], 'the planner\'s words give every field the tool requires');
  assert.ok(fields.title.maxLength <= 80, 'a title the planner hands over (at most 80 characters) fits the field');
});

test('the declaration and the play plan agree: it wakes first, opens the application, presses keys, types nothing and reads what is playing', () => {
  const declared = manifest.tools.find((tool) => tool.name === PLAY).devicePath;
  const { fire, other } = playRuns();
  const sent = (start) => fire.sent.filter((command) => command.startsWith(start));
  assert.equal(fire.sent[0], 'input keyevent KEYCODE_WAKEUP', 'the plan wakes the TV before anything else');
  assert.equal(declared.wakes, true, 'so the way says it can wake the TV');
  assert.equal(sent('am start').length, 1, 'it opens the application once');
  assert.match(sent('am start')[0], / com\.amazon\.firebat$/, 'Prime Video\'s Fire TV package');
  assert.deepEqual(sent('input keyevent').slice(1), ['input keyevent 20', 'input keyevent 66', 'input keyevent 66'], 'then the remote\'s keys: onto the show, its page, Resume');
  assert.deepEqual(declared.controls, ['open-app', 'keys'], 'what the plan does on the TV, and nothing it does not');
  assert.deepEqual(fire.sent.filter((command) => /^input (text|tap|swipe)/.test(command)), [], 'it types nothing and points at nothing');
  assert.ok(sent('dumpsys media_session').length >= 1, 'it reads the TV\'s media sessions');
  assert.equal(fire.answer.playing, true);
  assert.equal(fire.answer.nowPlaying.package, 'com.amazon.firebat', 'its answer is what the TV says is playing');
  assert.deepEqual(declared.observes, ['media-session']);
  assert.equal(other.refused, 'not_installed', 'a TV without Prime Video\'s Fire TV package is refused in words');
  assert.deepEqual(other.sent.filter((command) => command.startsWith('am start')), [], 'and nothing is opened on it');
  assert.deepEqual(declared.reaches, ['fire-tv'], 'so the way is declared for a Fire TV only');
});
