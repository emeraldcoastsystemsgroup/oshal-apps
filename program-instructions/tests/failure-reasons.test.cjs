/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.1 (T76, the blue proof of 2026-11-13): the second run's refusal was recorded nowhere, and the first run's bot turn outlived the kernel's 60-second package call so nothing was reported at all. A failure report now carries one line saying why (the check's own words, the kernel's refusal of a publication, the bot rail's refusal) as `detail`, the kernel keeps it on the row; the writer gives up on its bot at its deadline (48 s) and reports `timeout` itself; and a kernel that does not take `detail` yet gets the same report without it. The kernel's rails are the package suite's stand-in; the deadline is shortened through the tick's options so no case waits 48 s.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const pack = require(path.join(root, 'lib/instruction-pack.js'));
const loadRoutes = () => import(pathToFileURL(path.join(root, 'routes/program-instructions.mjs')).href);

const CONTRACT = Object.freeze({
  tools: ['computer.app', 'computer.open'],
  actions: ['apps', 'snapshot', 'scroll', 'press', 'type', 'select', 'invoke', 'undo', 'restore'],
  min_bytes: 200,
  max_bytes: 8192
});
const LINUX_WRITER = Object.freeze({
  id: 'ab'.repeat(32), claim: 'cd'.repeat(16), platform: 'linux', program: 'libreoffice-writer', version: '24.2.7',
  version_kind: 'package', bridge: 'libreoffice', attempt: 2, expires_at: 1794560555986, contract: CONTRACT
});
/** What writer 0.1.0 published on blue for LibreOffice Writer 24.2.7: it lacks four of the measured words. */
const BLUE_PACK = fs.readFileSync(path.join(root, 'tests/fixtures/writer-24.2.7-linux-libreoffice-0.1.0.md'), 'utf8');
const HOLDING = `${BLUE_PACK}\n\nWith the add-on a snapshot's "part" is whole; without it, visible. Each answer carries verified.`;

/** The kernel's rails: each step answers what the case scripts (a function is called with the input), and is recorded. */
function standInKernel(script) {
  const calls = [];
  const answer = async (step, input) => {
    calls.push({ step, input });
    const scripted = script[step];
    const value = typeof scripted === 'function' ? await scripted(input, calls) : scripted;
    if (value instanceof Error) throw value;
    if (value === undefined) throw new Error(`refused: the stand-in kernel has no answer for ${step}`);
    return value;
  };
  return { calls, ctx: { intent: answer, executeBot: (agentId, request) => answer('bot', { agentId, request }) } };
}
const reports = (kernel) => kernel.calls.filter((call) => call.step === 'application_profiles.fail').map((call) => call.input);
const FAILED = { status: 200, body: { claimed: 1, published: 0, failed: 1 } };

test('a text the writer\'s own check refuses is reported with the check\'s words as its detail', async () => {
  const { runInstructionTick } = await loadRoutes();
  const kernel = standInKernel({
    'application_profiles.claim': { requests: [LINUX_WRITER] }, bot: { response: BLUE_PACK }, 'application_profiles.fail': { status: 'pending' }
  });
  assert.deepEqual(await runInstructionTick(kernel.ctx), FAILED);
  assert.deepEqual(reports(kernel), [{
    id: LINUX_WRITER.id, claim: LINUX_WRITER.claim, reason: 'invalid-output',
    detail: 'the text lacks what the measured facts require: add-on, "part", whole, verified'
  }]);
});

test('a publication the kernel refuses is reported with the kernel\'s words as its detail', async () => {
  const { runInstructionTick } = await loadRoutes();
  const words = 'refused: instruction text names an action the application bridge does not have';
  const kernel = standInKernel({
    'application_profiles.claim': { requests: [LINUX_WRITER] }, bot: { response: HOLDING },
    'application_profiles.publish': new Error(words), 'application_profiles.fail': { status: 'pending' }
  });
  assert.deepEqual(await runInstructionTick(kernel.ctx), FAILED);
  assert.deepEqual(reports(kernel), [{ id: LINUX_WRITER.id, claim: LINUX_WRITER.claim, reason: 'invalid-output', detail: words }]);
});

test('a bot turn the relays refuse is reported with their words, and one that outlives the deadline as a timeout', async () => {
  const { runInstructionTick, BOT_DEADLINE_MS } = await loadRoutes();
  assert.equal(BOT_DEADLINE_MS, 48000, 'the writer gives up 12 s before the kernel ends a package call at 60 s');
  const busy = 'store_unavailable: no model could answer: the relay is answering another turn';
  const refused = standInKernel({
    'application_profiles.claim': { requests: [LINUX_WRITER] }, bot: new Error(busy), 'application_profiles.fail': { status: 'pending' }
  });
  assert.deepEqual(await runInstructionTick(refused.ctx), FAILED);
  assert.deepEqual(reports(refused), [{ id: LINUX_WRITER.id, claim: LINUX_WRITER.claim, reason: 'model-refused', detail: busy }]);
  const silent = standInKernel({
    'application_profiles.claim': { requests: [LINUX_WRITER] }, bot: () => new Promise(() => {}), 'application_profiles.fail': { status: 'pending' }
  });
  const started = Date.now();
  assert.deepEqual(await runInstructionTick(silent.ctx, { botDeadlineMs: 40 }), FAILED);
  assert.ok(Date.now() - started < 5000, 'the tick did not wait for the bot');
  const [report] = reports(silent);
  assert.equal(report.reason, 'timeout');
  assert.equal(report.detail, 'the bot did not answer within the writer\'s 0.04 s deadline');
});

test('a kernel that does not take a detail gets the same report without it; any other refusal is still an error', async () => {
  const { runInstructionTick } = await loadRoutes();
  const older = standInKernel({
    'application_profiles.claim': { requests: [LINUX_WRITER] }, bot: { response: BLUE_PACK },
    'application_profiles.fail': (input) => (input.detail ? new Error('invalid: a failure is exactly id, claim and reason') : { status: 'pending' })
  });
  assert.deepEqual(await runInstructionTick(older.ctx), FAILED);
  const sent = reports(older);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], { id: LINUX_WRITER.id, claim: LINUX_WRITER.claim, reason: 'invalid-output' });
  const refused = standInKernel({
    'application_profiles.claim': { requests: [LINUX_WRITER] }, bot: { response: BLUE_PACK },
    'application_profiles.fail': new Error('refused: the claim is unknown, ended or already used')
  });
  assert.equal((await runInstructionTick(refused.ctx)).body.error, 'report_refused');
  assert.equal(reports(refused).length, 1, 'a refusal for another cause is not retried');
});

test('detailOf makes one line of at most 240 characters, or none', () => {
  assert.equal(pack.MAX_DETAIL_CHARS, 240);
  assert.equal(pack.detailOf('  the text\nlacks\t a word  '), 'the text lacks a word');
  assert.equal(pack.detailOf('x'.repeat(300)).length, 240);
  assert.equal([...pack.detailOf('é'.repeat(300))].length, 240, 'characters, as the kernel counts them');
  for (const nothing of ['', '   ', null, undefined, '\n\t']) assert.equal(pack.detailOf(nothing), null);
  assert.equal(pack.detailOf(new Error('refused: words')), 'refused: words');
});
