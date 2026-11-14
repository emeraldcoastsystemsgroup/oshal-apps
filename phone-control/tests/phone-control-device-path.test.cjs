/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.19.0: the Fire TV guide tool declares devicePath, the way the kernel's path planner (device.path, kernel ADR-219) may offer through a phone's Fire TV app. The declaration is held to the closed lists the kernel accepts (crates/api/src/device_paths.rs `template`, crates/nodes/src/paths.rs), to the guide's own package and steps, and to what the guide says it cannot see. It goes red when a field or value leaves those lists, when a second tool declares a path, or when the declaration and the guide disagree.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

// The kernel's closed lists, as crates/nodes/src/inventory.rs (Kind) and crates/nodes/src/paths.rs name them.
const KINDS = ['thing', 'device', 'computer', 'phone', 'android-phone', 'iphone', 'tablet', 'tv', 'fire-tv', 'android-tv', 'roku', 'samsung-tv', 'printer', 'camera', 'speaker', 'watch'];
const JOBS = ['tv.wake', 'tv.resume', 'tv.open-app', 'tv.play-title', 'tv.open-link', 'tv.keys', 'tv.observe'];
const CONTROLS = ['open-app', 'open-link', 'keys', 'pointer', 'text', 'media', 'wake'];
const OBSERVES = ['screen-text', 'foreground-app', 'media-session', 'power-state'];
const FIELDS = ['how', 'on', 'app', 'reaches', 'jobs', 'controls', 'observes', 'wakes'];

/** Why the kernel would refuse this declaration, or null: the same checks its `template` makes. */
function refusal(declared) {
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return 'not an object';
  const odd = Object.keys(declared).find((key) => !FIELDS.includes(key));
  if (odd) return `does not take ${odd}`;
  if (declared.how !== 'companion-app') return 'how is companion-app';
  const words = typeof declared.app === 'string' ? declared.app.split('.') : [];
  if (words.length < 2 || declared.app.length > 128 || !words.every((word) => /^[A-Za-z0-9_]+$/.test(word))) return 'app is a package name';
  const lists = [['on', KINDS, true], ['reaches', KINDS, true], ['jobs', JOBS, true], ['controls', CONTROLS, false], ['observes', OBSERVES, false]];
  for (const [key, allowed, needed] of lists) {
    const value = declared[key];
    if (value === undefined && !needed) continue;
    if (!Array.isArray(value) || value.length > 8 || (needed && value.length === 0)) return `${key} is a list of 1 to 8 values`;
    const off = value.find((entry) => !allowed.includes(entry));
    if (off !== undefined) return `${key} names ${off}`;
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

test('exactly one tool declares a device path, and it is the read-only Fire TV guide', () => {
  const declaring = manifest.tools.filter((tool) => tool.devicePath !== undefined);
  assert.deepEqual(declaring.map((tool) => tool.name), [GUIDE]);
  const tool = declaring[0];
  assert.equal(tool.executor.apiEndpoint, 'GET /api/phone-control/remote-apps/fire-tv/guide');
  assert.deepEqual(tool.inputSchema, { type: 'object', properties: {}, additionalProperties: false }, 'the guide still takes no input');
  assert.equal(tool.requiresApproval, false);
});

test('every field and value of the declaration is on the lists the kernel accepts', () => {
  const declared = manifest.tools.find((tool) => tool.name === GUIDE).devicePath;
  assert.equal(refusal(declared), null);
  assert.deepEqual(Object.keys(declared).sort(), [...FIELDS].sort(), 'every field is stated, none is left to a default');
  assert.equal(declared.wakes, true);
  for (const [field, value, words] of [
    ['address', '10.0.0.2', 'does not take address'], ['how', 'adb', 'how is companion-app'], ['jobs', ['tv.cast'], 'jobs names tv.cast'],
    ['on', ['toaster'], 'on names toaster'], ['app', 'remote', 'app is a package name'], ['reaches', [], 'reaches is a list of 1 to 8 values']
  ]) {
    assert.equal(refusal({ ...declared, [field]: value }), words, `a declaration with ${field} changed is refused`);
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
