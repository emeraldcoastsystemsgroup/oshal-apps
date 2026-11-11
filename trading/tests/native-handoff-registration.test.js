/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.54.1: the Trades page registers its document session with its application named, and its start-up runs to the end. 1.54.0 registered with prepare and refresh only; the kernel helper (oshal-kernel platform/src/shared/ui/js/document-handoff.js, registerDocumentSession) throws without an application, and everything after the call never ran: the research hand-off receiver, the Go button under "Continue your research" and the connected actions. The earlier test replaced the helper with a stand-in that accepted anything, so it passed. This one runs the page's real script against the kernel's real helper when OSHAL_KERNEL_ROOT names a kernel checkout, and otherwise against a stand-in that carries the helper's own refusal, word for word.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const source = fs.readFileSync(path.join(__dirname, '../tools/ui/connected-actions.js'), 'utf8');
const KERNEL_HELPER = process.env.OSHAL_KERNEL_ROOT ? path.join(process.env.OSHAL_KERNEL_ROOT, 'platform/src/shared/ui/js/document-handoff.js') : '';

/** The helper's own rule, for a run with no kernel checkout at hand: the same condition and the same words. */
function standIn(seen) {
  return { registerDocumentSession({ app, prepare, refresh }) {
    if (!app || typeof prepare !== 'function' || typeof refresh !== 'function') throw new Error('A document handoff needs an application, save and refresh.');
    seen.session = { app, prepare, refresh };
    return () => {};
  } };
}

/** Run the page's start-up with the given helper and report what it did. */
async function startUp(text, helper) {
  const did = { received: 0, mounted: 0, rendered: 0 };
  const go = { onclick: null };
  const body = text
    .replace(/^import\s+[^\n]+\n/gm, '')
    .replace(/await import\('\/shared\/ui\/js\/document-handoff\.js'\)\.catch\(\(\)\s*=>\s*null\)/, 'HELPER');
  assert.match(body, /HELPER/, 'the page loads the kernel helper from /shared/ui/js/document-handoff.js');
  const sandbox = {
    HELPER: helper, VIEW: 'accounts', SUB: '', BOOK: 'paper', MODE: 'paper', ACCOUNTS: [{ id: '1' }], CURRENT: '', RS_SYM: '', RS_REPORT: null,
    bookLabel: (ref) => `Book ${ref}`, render: async () => { did.rendered += 1; },
    receiveHandoff: () => { did.received += 1; }, mountConnectedActions: async () => { did.mounted += 1; },
    document: { getElementById: (id) => (id === 'researchDraftGo' ? go : { hidden: true, value: '', focus() {}, textContent: '' }), querySelector: () => ({ querySelectorAll: () => [] }) },
  };
  vm.createContext(sandbox);
  await vm.runInContext(body, sandbox);
  return { ...did, go: typeof go.onclick === 'function' };
}

test('the Trades page registers with its application named, and its start-up runs to the end', async (t) => {
  const seen = {};
  let helper = standIn(seen);
  if (KERNEL_HELPER) {
    assert.ok(fs.existsSync(KERNEL_HELPER), `OSHAL_KERNEL_ROOT is set but ${KERNEL_HELPER} is not there`);
    // The kernel's helper is a browser module: it registers on `window`.
    globalThis.window = { document: {} };
    t.after(() => { delete globalThis.window; });
    const real = await import(pathToFileURL(KERNEL_HELPER).href);
    helper = { registerDocumentSession: (options) => { const release = real.registerDocumentSession(options); seen.session = globalThis.window.__oshalDocumentSession; return release; } };
    t.diagnostic('ran against the kernel helper itself');
  } else t.diagnostic('ran against the stand-in carrying the kernel helper\'s refusal (set OSHAL_KERNEL_ROOT to use the helper itself)');

  const did = await startUp(source, helper);
  assert.equal(seen.session.app, 'intelligent-trades');
  assert.deepEqual([typeof seen.session.prepare, typeof seen.session.refresh], ['function', 'function']);
  assert.deepEqual(did, { received: 1, mounted: 1, rendered: 0, go: true }, 'the hand-off receiver, the Go button and the connected actions all started');
  const state = await seen.session.prepare();
  assert.deepEqual([state.app, state.surface, state.fields.view, state.fields.connectedAccountCount], ['intelligent-trades', 'intelligent-trades-home', 'accounts', '1']);
  await seen.session.refresh();
});

test('a registration without the application stops the start-up, which is what 1.54.0 did', async () => {
  const without = source.replace("    app: 'intelligent-trades',\n    async prepare() {", '    async prepare() {');
  assert.notEqual(without, source, 'the registration names its application');
  await assert.rejects(startUp(without, standIn({})), /A document handoff needs an application, save and refresh\./);
});
