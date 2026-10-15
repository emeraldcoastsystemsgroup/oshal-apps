/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | "AI draft" fills the studio's Title and Outline. The compiled POST /pptx route, given only a topic, answers
 *   with the title and the outline its deck-builder bot drafted (title + content per slide) beside the saved file; an outline the
 *   person wrote is not echoed back. The surface's fillDrafted() (executed out of the shipped page) writes that outline into the
 *   empty Title and Outline fields in the studio's own block format, and never overwrites a title the person typed. Before, both
 *   fields stayed empty after a draft, so the studio had nothing to edit and every connected action answered "select the work".
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: a deck-builder outline cut off at the 2048-token default failed the draft with "Unterminated string
 *   in JSON at position 4444". The compiled route asks the bot for 8192 output tokens; an outline cut off after at least half the
 *   requested slides keeps its complete slides and says so in `note`; one cut off earlier, or a reply with no outline, answers 502
 *   with plain words and a code, never a parser message, and saves nothing.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DRAFT = [{ title: 'Why now', content: 'Costs fell\nDemand rose' }, { title: 'Next steps', content: 'Pilot in Q3' }];
const saves = [];
const botRequests = [];
let botReply = `Here it is: ${JSON.stringify(DRAFT)}`;
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; }; return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }; }, raw: () => (_q, _s, next) => next && next() },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  '@/features/presentation-generation': {
    PresentationEngine: class {}, renderPptx: async () => Buffer.from('PK'), renderDocx: async () => Buffer.from('PK'), renderXlsx: async () => Buffer.from('PK'),
    themeCatalog: () => [], layoutCatalog: () => [], isThemeId: () => false, DEFAULT_THEME_ID: 'executive', importOffice: async () => ({}),
    brandTheme: () => { throw new Error('no brand in these cases'); },
  },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
  '@/app/routes/storage-target': {
    resolveStorageTarget: async () => ({}), listFolder: async () => ({ files: [] }), deleteStoredFile: async () => ({}),
    saveContent: async (_ctx, sub, kind, name) => { saves.push({ sub, kind, name }); return { provider: 'local', location: `decks/${name}`, downloadUrl: '/dl/x' }; },
  },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async (_ctx, _client, _agent, request) => { botRequests.push(request); return { response: botReply }; } },
  '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
  '@/app/routes/slack-client': { uploadSlackFile: async () => ({}) },
  '@/app/routes/email-routes': { sendGmail: async () => ({}), sendOutlookMail: async () => ({}) },
  '@/shared/security/explicit-write-confirmation': { hasExplicitWriteConfirmation: () => false, confirmationRequiredPayload: () => ({}) },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { createBotPresentationRoutes } = require('../routes/bot-presentation-routes.js');
test.after(() => { Module._load = original; });

async function post(body) {
  const ctx = { pool: { query: async () => ({ rows: [], rowCount: 0 }) }, appPackageDir: path.resolve(__dirname, '..') };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; }, send(b) { this.body = b; }, setHeader() {} };
  await createBotPresentationRoutes(ctx).routes['POST /pptx']({ oidc: { user: { sub: 'alice' } }, query: {}, params: {}, body }, res);
  return res;
}

test('a topic draft answers with the title and the outline it drafted', async () => {
  const res = await post({ title: 'Solar for schools', topic: 'Solar for schools', slideCount: 2 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.title, 'Solar for schools');
  assert.deepEqual(res.body.outline, DRAFT);
  assert.equal(saves.at(-1).name, 'Solar for schools.pptx');
});

test('the draft asks the deck-builder for an outline budget larger than the 2048-token default', async () => {
  await post({ title: 'Budget', topic: 'Budget', slideCount: 2 });
  assert.equal(botRequests.at(-1).max_output_tokens, 8192);
});

test('an outline cut off after most slides keeps its complete slides and says so', async () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ title: `Slide ${i + 1}`, content: `Point ${i + 1}\nMore` }));
  const whole = JSON.stringify(six);
  botReply = whole.slice(0, whole.lastIndexOf('{"title":"Slide 6"') + 30);
  try {
    const res = await post({ title: 'sweep12 cut', topic: 'sweep12 cut', slideCount: 6 });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.slides, 5);
    assert.deepEqual(res.body.outline.map((o) => o.title), ['Slide 1', 'Slide 2', 'Slide 3', 'Slide 4', 'Slide 5']);
    assert.equal(res.body.note, 'The outline came back cut off, so this file has the 5 complete slides.');
  } finally { botReply = `Here it is: ${JSON.stringify(DRAFT)}`; }
});

test('an outline cut off early, or no outline at all, answers 502 in plain words and saves nothing', async () => {
  const before = saves.length;
  const cases = [
    ['[{"title":"Only one","content":"Unterminated', 'outline_cut_off', "The deck builder's outline came back cut off, so no deck was made. Try again, or ask for fewer slides."],
    ['[{"title":"A","content":"x"},{"title":"B","con', 'outline_cut_off', "The deck builder's outline came back cut off, so no deck was made. Try again, or ask for fewer slides."],
    ['I cannot help with that.', 'outline_missing', 'The deck builder did not return a slide outline, so no deck was made. Try again.'],
  ];
  try {
    for (const [reply, code, words] of cases) {
      botReply = reply;
      const res = await post({ title: 'sweep12 fail', topic: 'sweep12 fail', slideCount: 6 });
      assert.equal(res.statusCode, 502);
      assert.deepEqual(res.body, { error: words, code });
      assert.doesNotMatch(res.body.error, /JSON|position|Unterminated/);
    }
  } finally { botReply = `Here it is: ${JSON.stringify(DRAFT)}`; }
  assert.equal(saves.length, before, 'a failed draft saves no file');
});

test('an outline the person wrote is not echoed back as a draft', async () => {
  const res = await post({ title: 'Mine', sections: [{ title: 'A', content: 'b' }] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.outline, undefined);
});

/** fillDrafted() cut out of the shipped page and run against two input doubles. */
function surfaceFill(initial) {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'presentations.html'), 'utf8');
  const start = html.indexOf('function fillDrafted(j){');
  assert.ok(start >= 0, 'the surface defines fillDrafted');
  let depth = 0, end = -1;
  for (let i = html.indexOf('{', start); i < html.length; i += 1) {
    if (html[i] === '{') depth += 1; else if (html[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const fields = {};
  for (const id of ['title', 'outline']) fields[id] = { value: initial[id] || '', events: 0, dispatchEvent() { this.events += 1; } };
  const sandbox = { $: (id) => fields[id], Event: class { constructor(type) { this.type = type; } } };
  vm.runInNewContext(`${html.slice(start, end)}; this.fillDrafted = fillDrafted;`, sandbox);
  return { fill: sandbox.fillDrafted, fields };
}

test('the surface writes a drafted outline into empty Title and Outline, in its block format', () => {
  const { fill, fields } = surfaceFill({});
  fill({ ok: true, title: 'Solar for schools', outline: DRAFT });
  assert.equal(fields.title.value, 'Solar for schools');
  assert.equal(fields.outline.value, 'Why now\nCosts fell\nDemand rose\n\nNext steps\nPilot in Q3');
  assert.equal(fields.outline.events, 1, 'listeners (the connected actions, the bridge) hear the change');
});

test('the surface never overwrites a title the person typed, and ignores answers with no outline', () => {
  const { fill, fields } = surfaceFill({ title: 'My own title' });
  fill({ ok: true, title: 'Drafted', outline: DRAFT });
  assert.equal(fields.title.value, 'My own title');
  const second = surfaceFill({});
  second.fill({ ok: true });
  assert.equal(second.fields.outline.value, '');
});

test('the AI draft result path calls fillDrafted before it reports the saved file', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'presentations.html'), 'utf8');
  const gen = html.slice(html.indexOf('async function generate(body, label, fmt){'));
  assert.ok(/fillDrafted\(j\);\s*const note = [^\n]+\n\s*res\('✓ Your '/.test(gen.slice(0, 2700)), 'generate() fills the drafted outline on success, before the saved-file line');
});
