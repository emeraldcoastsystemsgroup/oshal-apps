/**
 * Venture Plan - the console tells a person what an analyst run did, from the moment Run is pressed.
 *
 * Live on the phone (412x915), pressing "Run the analysts" left the banner empty and the button enabled for ~32 s
 * (on the native kernel the POST answers only when the run has closed), then a toast said "Run finished" although
 * the BOM analyst had failed and market/ops had been deferred: watchRun showed run.error only for status 'failed'
 * and renderRunBanner cleared itself for any closed run, so the "Press Run the analysts again" note never reached
 * the person. This suite runs the page's own run-status block (between its markers in tools/venture.html) against
 * stub elements and a stub API and asserts what the person sees at each step.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Running banner and disabled button before the POST answers; a closed run's failed, skipped and deferred phases shown with their reasons (and again on reopening), a clean run still says finished, a refused start clears the banner.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A deferred Documents phase reads as its own sentence, never "Documents not run yet": live the banner said "Documents not run yet: documents were rendered from the computed numbers" while all 17 documents opened.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Demo sweep 1: a run whose only open item is the Documents phase's by-design deferral says "The run finished." (not "not every phase did"), and a Regenerate prose run that ends with a document open opens that document again after the reload instead of leaving "Pick a document".
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'venture.html'), 'utf8');
const BEGIN = '/* ═══ run status (tests/venture-run-ui.test.js runs this block)';
const END = '/* ═══ end run status';
const block = html.slice(html.indexOf(BEGIN), html.indexOf(END));
const escSource = html.match(/function esc\(s\) \{[\s\S]*?\n {2}\}/)[0];

/** The live run's shape (2026-10-11): BOM cut off, market and ops deferred, the model computed. */
const LIVE_RUN = {
  id: 'run-1', status: 'done', phase: null,
  error: "bom: BOM analyst reply was cut off before its JSON closed (it reached the model's output limit): no JSON object in the reply | not run yet: market, ops, narrate",
  phases: [
    { name: 'bom', status: 'failed', error: "BOM analyst reply was cut off before its JSON closed (it reached the model's output limit): no JSON object in the reply" },
    { name: 'market', status: 'skipped', error: 'deferred: not started in this request — on this installation a request runs for at most 60 seconds, which fits one analyst. Press Run the analysts again to continue with market.' },
    { name: 'ops', status: 'skipped', error: 'deferred: not started in this request — on this installation a request runs for at most 60 seconds, which fits one analyst. Press Run the analysts again to continue with ops.' },
    { name: 'compute', status: 'done', error: null },
    { name: 'narrate', status: 'skipped', error: 'deferred: documents are narrated one at a time on this installation: open a document and press Regenerate.' },
  ],
};

/** The run-status block wired to stub elements, a stub API whose answers the test releases, and a manual timer. */
function page() {
  const els = { researchBtn: { disabled: false }, runBanner: { innerHTML: '' } };
  const world = { posts: [], toasts: [], failures: [], selected: [], loaded: [], timer: null, answers: [] };
  const S = { ventureId: 'v1', run: null, runTimer: null, busy: false };
  const api = (method, url, body) => new Promise((resolve, reject) => {
    if (method === 'POST') world.posts.push({ url, body });
    world.answers.push({ method, url, resolve, reject });
  });
  const fns = new Function('S', '$', 'api', 'toast', 'fail', 'selectVenture', 'setInterval', 'clearInterval', 'loadDoc',
    `${escSource}\n${block}\nreturn { startRun, watchRun, showLatestRun, renderRunBanner, runOutcome };`)(
    S, (id) => els[id], api, (msg, kind) => world.toasts.push([msg, kind]),
    (e, where) => world.failures.push([where, e.message]), (id) => world.selected.push(id),
    (fn) => { world.timer = fn; return 1; }, () => { world.timer = null; }, (key) => world.loaded.push(key));
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  /** Answer the oldest pending request. */
  async function reply(value, refused) {
    const next = world.answers.shift();
    assert.ok(next, 'a request is pending');
    if (refused) next.reject(refused); else next.resolve(value);
    await settle(); await settle();
    return next;
  }
  return { els, world, S, fns, reply, settle };
}

const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

test('pressing Run shows the running banner and disables the button before the POST answers', async () => {
  const p = page();
  p.fns.startRun('full');
  assert.deepEqual(p.world.posts, [{ url: '/ventures/v1/runs', body: { kind: 'full' } }]);
  assert.match(text(p.els.runBanner.innerHTML), /Analysts running… starting/);
  assert.equal(p.els.researchBtn.disabled, true, 'a second press cannot start a second run');
  p.fns.startRun('full');
  assert.equal(p.world.posts.length, 1, 'pressing again while the first is running sends nothing');
});

test('a closed run with a failed and deferred phases names each reason and the run-again note, not "Run finished"', async () => {
  const p = page();
  p.fns.startRun('full');
  await p.reply({ runId: 'run-1', phases: ['bom', 'market', 'ops', 'compute', 'narrate'] });
  assert.equal(p.els.researchBtn.disabled, true, 'still watching the run');
  p.world.timer();
  const poll = await p.reply({ run: LIVE_RUN });
  assert.equal(poll.url, '/runs/run-1');
  const shown = text(p.els.runBanner.innerHTML);
  assert.match(shown, /The run finished, but not every phase did\./);
  assert.match(shown, /Bill of materials failed: BOM analyst reply was cut off before its JSON closed \(it reached the model's output limit\)/);
  assert.match(shown, /Market not run yet: not started in this request .* Press Run the analysts again to continue with market\./);
  assert.match(shown, /Operations not run yet: .*continue with ops\./);
  assert.match(shown, /Documents are narrated one at a time on this installation: open a document and press Regenerate\./);
  assert.doesNotMatch(shown, /Documents not run yet/);
  assert.match(p.els.runBanner.innerHTML, /class="banner bad"/);
  assert.ok(!p.world.toasts.some(([m]) => /^Run finished/.test(m)), 'no plain "Run finished" toast');
  assert.deepEqual(p.world.toasts.at(-1), ['The run finished, but not every phase did. The reasons are listed under Run the analysts.', 'bad']);
  assert.equal(p.els.researchBtn.disabled, false);
  assert.deepEqual(p.world.selected, ['v1'], 'the model is reloaded');
  assert.equal(p.world.timer, null, 'polling stops');
});

test('reopening the venture shows what its latest closed run left undone', () => {
  const p = page();
  p.fns.showLatestRun(LIVE_RUN);
  assert.match(text(p.els.runBanner.innerHTML), /Bill of materials failed: .*Market not run yet/);
  p.fns.showLatestRun({ ...LIVE_RUN, status: 'running', phase: 'bom' });
  assert.match(text(p.els.runBanner.innerHTML), /Analysts running… phase: bom/, 'a running run is watched instead');
});

test('an abandoned run closed on read says it was interrupted and which phases did not run', () => {
  const p = page();
  p.fns.showLatestRun({ id: 'r', status: 'failed', phase: null,
    error: 'interrupted: the request that ran it ended before it recorded a result (the page was closed, the connection dropped or the 60-second limit passed). Press Run the analysts again to continue.',
    phases: [{ name: 'bom', status: 'failed', error: 'interrupted before it recorded a result' }, { name: 'market', status: 'failed', error: 'not run' }] });
  const shown = text(p.els.runBanner.innerHTML);
  assert.match(shown, /The run failed\. interrupted: .*Press Run the analysts again to continue\./);
  assert.match(shown, /Bill of materials failed: interrupted before it recorded a result/);
  assert.match(shown, /Market did not run\./);
});

test('a run that finished every phase still says finished and leaves no banner', async () => {
  const p = page();
  p.fns.startRun('full');
  await p.reply({ runId: 'run-2' });
  p.world.timer();
  await p.reply({ run: { id: 'run-2', status: 'done', error: null, phases: [{ name: 'bom', status: 'done' }, { name: 'compute', status: 'done' }] } });
  assert.equal(p.els.runBanner.innerHTML, '');
  assert.deepEqual(p.world.toasts.at(-1), ['Run finished. Reloading the model.', 'ok']);
});

test('a refused start clears the banner, re-enables the button and names the refusal', async () => {
  const p = page();
  p.fns.startRun('full');
  await p.reply(null, Object.assign(new Error('analyst budget exhausted'), { status: 402 }));
  assert.equal(p.els.runBanner.innerHTML, '');
  assert.equal(p.els.researchBtn.disabled, false);
  assert.deepEqual(p.world.failures, [['Run', 'analyst budget exhausted']]);
});

test('a native run that stored its documents says they were rendered, not that Documents did not run', () => {
  const p = page();
  const run = { ...LIVE_RUN, phases: LIVE_RUN.phases.map((x) => (x.name === 'narrate'
    ? { ...x, error: 'deferred: documents were rendered from the computed numbers; open one and press Regenerate prose to add its written sections.' } : x)) };
  const shown = p.fns.runOutcome(run).lines.map((l) => l.text).join(' | ');
  assert.match(shown, /Documents were rendered from the computed numbers; open one and press Regenerate prose/);
  assert.doesNotMatch(shown, /Documents not run yet/);
  assert.match(shown, /Market not run yet: not started in this request/, 'an analyst that did not run still says so');
});

/** A whole run: every analyst done, the Documents phase deferred by design (its written sections wait). */
const WHOLE_RUN = { id: 'run-3', status: 'done', error: null, phases: [
  { name: 'bom', status: 'done' }, { name: 'market', status: 'done' }, { name: 'ops', status: 'done' }, { name: 'compute', status: 'done' },
  { name: 'narrate', status: 'skipped', error: 'deferred: documents were rendered from the computed numbers; open one and press Regenerate prose to add its written sections.' }] };

test('a run whose only open item is the deferred Documents phase says it finished', async () => {
  const p = page();
  p.fns.startRun('full');
  await p.reply({ runId: 'run-3' });
  p.world.timer();
  await p.reply({ run: WHOLE_RUN });
  const shown = text(p.els.runBanner.innerHTML);
  assert.match(shown, /The run finished\./);
  assert.doesNotMatch(shown, /not every phase did/);
  assert.match(shown, /Documents were rendered from the computed numbers/);
  assert.match(p.els.runBanner.innerHTML, /class="banner info"/);
  assert.deepEqual(p.world.toasts.at(-1), ['Run finished. Reloading the model.', 'ok']);
});

test('Regenerate prose opens the same document again once the venture reloads', async () => {
  const p = page();
  p.S.doc = { docKey: 'executive-summary' };
  p.fns.startRun('narrate', 'executive-summary');
  assert.deepEqual(p.world.posts, [{ url: '/ventures/v1/documents/executive-summary/regenerate', body: {} }]);
  await p.reply({ runId: 'run-4' });
  p.world.timer();
  await p.reply({ run: { ...WHOLE_RUN, id: 'run-4' } });
  await p.settle();
  assert.deepEqual(p.world.selected, ['v1']);
  assert.deepEqual(p.world.loaded, ['executive-summary'], 'the regenerated document is on screen, not "Pick a document"');
});
