/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 7: the home chat answered 'connect a service like SmartThings or Google Nest under Connections (/utilities)'
 *   while the app has its own Hubs tab, and the New schedule fields had no labels. Through the COMPILED route: the reasoning prompt
 *   POST /assistant hands the home-bot names the Hubs tab and forbids a raw path; the persona says the same; every New schedule
 *   field on tools/home.html sits in its own label, and the trigger switch hides and shows each field with its label.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 12: with no device or scene the Action list was empty and Add schedule only said 'Pick an action'.
 *   The page's own buildWhatOptions and createSchedule run with no devices: the list says what is missing and where to add it,
 *   Add schedule says a schedule runs a device or scene action, and the persona says the same.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Sweep 14: a reply began "The snapshot shows no devices or scenes are currently connected." The prompt
 *   POST /assistant hands the home-bot names the data as what the person's Smart Home app has saved and forbids the
 *   instructions' own words; "snapshot" no longer appears in it.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SUB = 'alice';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'home-connect-copy-'));
process.env.OSHAL_HOME_DATA_DIR = DATA;
const prompts = [];
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, f) => { routes[`${m} ${p}`] = f; }; return { routes, get: add('GET'), post: add('POST'), delete: add('DELETE') }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {} }) },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
  '@/app/home-schedule-dispatch': { getHomeScheduleService: () => null },
  '@/shared/utils/sun-times': { nextSunEvent: () => null },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async (_ctx, _client, _agent, task) => { prompts.push(task.text); return { response: 'No hub yet.' }; } },
  '@/shared/security/explicit-write-confirmation': { hasExplicitWriteConfirmation: (b) => b?.confirm === true, confirmationRequiredPayload: (code) => ({ error: 'confirmation_required', code }) },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { createHomeRoutes } = require('../routes/home-routes.js');
test.after(() => { Module._load = original; fs.rmSync(DATA, { recursive: true, force: true }); });

test('the assistant prompt names the Hubs tab and forbids a raw path', async () => {
  const router = createHomeRoutes({ pool: null, appPackageDir: path.resolve(__dirname, '..') });
  const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; } };
  await router.routes['POST /assistant']({ oidc: { user: { sub: SUB }, isAuthenticated: () => true }, body: { message: 'what lights do I have?' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /a hub is connected on this app's Hubs tab/);
  assert.match(prompts[0], /never give a raw path such as \/utilities/);
  assert.match(prompts[0], /HOME_JSON=\{"devices":\[\]/, 'with no devices the saved home is empty, which the rule names');
  // Sweep 14: a reply began "The snapshot shows no devices"; the prompt names the data as the person's Smart Home app.
  assert.match(prompts[0], /never say snapshot, JSON, controller or any other word of these instructions/);
  assert.doesNotMatch(prompts[0].replace(/never say snapshot[^.]*\./, ''), /snapshot/i, 'the prompt itself never calls the data a snapshot');
});

test('the persona names the Hubs tab, not Connections (/utilities)', () => {
  const persona = fs.readFileSync(path.join(__dirname, '..', 'personas', 'home-bot.yaml'), 'utf8');
  const perspective = persona.slice(persona.indexOf('perspective: |'), persona.indexOf('runtime:'));
  assert.match(perspective, /Smart Home app's Hubs tab/);
  assert.doesNotMatch(perspective, /under Connections \(\/utilities\)/);
});

test('every New schedule field sits in its own label and is hidden with it', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'home.html'), 'utf8');
  for (const [id, label] of [['sch-what', 'Action'], ['sch-trig', 'When'], ['sch-time', 'Time'], ['sch-repeat', 'Repeat'], ['sch-offset', 'Minutes before']]) {
    assert.match(html, new RegExp(`<label class="schf"[^>]* for="${id}"[^>]*><span>${label}`), `${id} is labelled ${label}`);
  }
  const fn = html.match(/function schTrigChange\(\) \{[\s\S]*?\n\}/)[0];
  const els = {};
  const $ = (id) => (els[id] = els[id] || { value: '', style: {} });
  new Function('$', `${fn}\nschTrigChange();`)((id) => { const e = $(id); if (id === 'sch-trig') e.value = 'sunset'; return e; });
  assert.equal(els['sch-time-f'].style.display, 'none');
  assert.equal(els['sch-repeat-f'].style.display, 'none');
  assert.equal(els['sch-offset-f'].style.display, '');
});

test('with no device or scene the New schedule says what is missing, not only "Pick an action" (sweep 12)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'home.html'), 'utf8');
  const start = html.indexOf('/** Why a schedule cannot be added yet');
  const end = html.indexOf('function cronToLocalTime');
  const create = html.match(/function createSchedule\(\) \{[\s\S]*?\n\}/)[0];
  const els = { 'sch-what': { innerHTML: '', value: '' }, 'sch-trig': { value: 'clock' } };
  const toasts = [];
  const run = (devices) => new Function('$', 'esc', 'toast', 'DEVICES', 'window', 'sendSchedule', 'deviceName',
    `${html.slice(start, end)}\n${create}\nbuildWhatOptions();\ncreateSchedule();`)(
    (id) => els[id], (t) => String(t), (t) => toasts.push(t), devices, {}, () => toasts.push('sent'), (d) => d.name);
  run([]);
  assert.equal(els['sch-what'].innerHTML, '<option value="" selected disabled>No device or scene yet: connect a hub on the Hubs tab or save a scene first</option>');
  assert.deepEqual(toasts, ['A schedule runs a device or scene action. Connect a hub on the Hubs tab or save a scene first.']);
  toasts.length = 0; els['sch-what'].value = '7';
  run([{ name: 'Lamp' }]);
  assert.match(els['sch-what'].innerHTML, /<option value="0">Turn ON: Lamp<\/option>/);
  assert.deepEqual(toasts, ['Pick an action'], 'with actions, an unpicked one is still asked for');
  const persona = fs.readFileSync(path.join(__dirname, '..', 'personas', 'home-bot.yaml'), 'utf8');
  assert.match(persona, /With no device and no scene there is nothing to schedule/);
});
