/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 0.1.2: production's first three runs for LibreOffice Writer 24.2.7 on Linux (2026-11-13 10:43 to 10:45 UTC, writer 0.1.1, the claude-account rail, 11.0 to 12.2 s a run) were all invalid-output. Attempts 1 and 2: "the text names the declared verb "<id>", and the libreoffice bridge does not list it for this program" (the text quoted the request's own placeholder). Attempt 3: "the text lacks what the measured facts require: "part"". The texts were not kept, so the fixtures here are texts of the same shape that give those exact words under 0.1.1's check. 0.1.2: a placeholder that is not a verb-name shape is not a verb; the request names the required words outright as a "use each of these words" list, quotation marks included; and when the package's own check refuses an answer, the bot is asked once more in the same run with the refusal's words, only when the first turn used at most a third of the writer's deadline (production's turns took about 11 s of 48 s; blue's Gemini turns about 60 s, so blue is never asked twice).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.1.3: the windows-uia bridge now has an entry (Word's and Excel's verbs, none for any other window), so a verb in a classic Notepad text is refused because that bridge does not list it for the program, no longer because the bridge has no entry.
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
/** Production's claimed row, in the kernel's claim answer shape (id and claim are fixture values). */
const PRODUCTION_WRITER = Object.freeze({
  id: 'ab'.repeat(32), claim: 'cd'.repeat(16), platform: 'linux', program: 'libreoffice-writer', version: '24.2.7',
  version_kind: 'package', bridge: 'libreoffice', attempt: 1, expires_at: 1794566882505, contract: CONTRACT
});
const ATTEMPT_1_AND_2 = 'the text names the declared verb "<id>", and the libreoffice bridge does not list it for this program';
const ATTEMPT_3 = 'the text lacks what the measured facts require: "part"';

/** The words every Writer text must hold, in one fixture paragraph. */
const WORDS = 'With the add-on a snapshot\'s "part" is whole; without it, visible. insert-paragraph and format-text each answer '
  + 'verified, through "action": "invoke".';
const BASE = fs.readFileSync(path.join(root, 'tests/fixtures/writer-24.2.7-linux-libreoffice-0.1.0.md'), 'utf8');
/** Attempts 1 and 2: the request's form copied with its placeholder; every required word is there. */
const PLACEHOLDER = `${BASE}\n\n${WORDS}\nName a verb in the form "declared": "<id>", as the bridge lists it.`;
/** Attempt 3: every word but "part" in quotation marks (the model wrote it in backticks). */
const NO_QUOTED_PART = `${BASE}\n\n${WORDS.replace('"part"', '`part`')}`;

test('attempts 1 and 2: a placeholder is not a verb name, and a real verb-shaped name the bridge does not list is still refused', () => {
  const check = (body) => pack.checkBody(body, CONTRACT, 'libreoffice', 'libreoffice-writer');
  assert.equal(check(PLACEHOLDER), null, `0.1.1 refused this with: ${ATTEMPT_1_AND_2}`);
  for (const placeholder of ['<id>', '<verb id>', '{id}', '...', '', 'x'.repeat(65)]) {
    assert.equal(check(`${BASE}\n\n${WORDS}\n{"declared": "${placeholder}"}`), null, placeholder);
  }
  assert.equal(check(`${BASE}\n\n{"action": "invoke", "declared": "set-cells"}`),
    'the text names the declared verb "set-cells", and the libreoffice bridge does not list it for this program');
  const notepad = `# Notepad 11 on Windows (fixture)\n\n${'Plain words. '.repeat(20)}\n{"declared": "save-document"}`;
  assert.equal(pack.checkBody(notepad, CONTRACT, 'windows-uia', 'notepad'),
    'the text names the declared verb "save-document", and the windows-uia bridge does not list it for this program');
  assert.equal(pack.acceptanceProblem(PLACEHOLDER, PRODUCTION_WRITER), null, 'the fixture holds every required word');
});

test('attempt 3: the check is unchanged, and the request names every required word outright, quotation marks included', () => {
  assert.equal(pack.acceptanceProblem(NO_QUOTED_PART, PRODUCTION_WRITER), ATTEMPT_3);
  const text = pack.requestText(PRODUCTION_WRITER);
  const words = pack.factsFor(PRODUCTION_WRITER).contains;
  assert.deepEqual(words, ['add-on', '"part"', 'whole', 'visible', 'insert-paragraph', 'format-text', 'verified', '"action": "invoke"']);
  const header = '- Use each of these words in the text, character for character; where a word is shown in quotation marks, '
    + 'write the quotation marks too:';
  const listed = text.split(`${header}\n`)[1];
  assert.ok(listed, `the request has the list: ${text}`);
  const lines = listed.split('\n').slice(0, words.length);
  assert.deepEqual(lines, words.map((word) => `  - ${word}`), 'every required word, one a line, in order');
  assert.ok(Buffer.byteLength(text, 'utf8') < pack.MAX_REQUEST_BYTES);
});

/** The kernel's rails with a clock: each bot turn takes `turnMs` of the fake clock, then answers the next scripted text. */
function rails(answers, turnMs, extra = {}) {
  const calls = [];
  let clock = 1_000_000;
  const replies = [...answers];
  const ctx = {
    intent: async (name, input) => {
      calls.push({ step: name, input });
      if (name === 'application_profiles.claim') return { requests: [PRODUCTION_WRITER] };
      if (name in extra) return extra[name];
      return { status: name === 'application_profiles.publish' ? 'published' : 'pending' };
    },
    executeBot: async (agentId, request) => {
      calls.push({ step: 'bot', input: { agentId, request } });
      clock += turnMs;
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return { response: reply };
    }
  };
  return { calls, ctx, now: () => clock };
}
const steps = (run) => run.calls.map((call) => call.step);

test('a refused first answer is asked about once more with the refusal\'s words when the first turn was quick', async () => {
  const { runInstructionTick } = await loadRoutes();
  const good = `${BASE}\n\n${WORDS}`;
  const run = rails([NO_QUOTED_PART, good], 11000);
  assert.deepEqual(await runInstructionTick(run.ctx, { now: run.now }), { status: 200, body: { claimed: 1, published: 1, failed: 0 } });
  assert.deepEqual(steps(run), ['application_profiles.claim', 'bot', 'bot', 'application_profiles.publish']);
  const second = run.calls[2].input.request.text;
  assert.ok(second.startsWith(pack.requestText(PRODUCTION_WRITER)), 'the same request, then the refusal');
  assert.ok(second.endsWith(`Your previous answer was not used: ${ATTEMPT_3}. Write the whole document again and fix that.`), second.slice(-300));
  assert.equal(run.calls[3].input.body, good);
});

test('the second answer refused too is reported with its own words, and nobody is asked a third time', async () => {
  const { runInstructionTick } = await loadRoutes();
  const run = rails([PLACEHOLDER.replace('<id>', 'set-cells'), NO_QUOTED_PART], 11000);
  assert.deepEqual(await runInstructionTick(run.ctx, { now: run.now }), { status: 200, body: { claimed: 1, published: 0, failed: 1 } });
  assert.deepEqual(steps(run), ['application_profiles.claim', 'bot', 'bot', 'application_profiles.fail']);
  assert.equal(run.calls[3].input.detail, ATTEMPT_3);
});

test('a slow first turn, a bot rail refusal and a refused publication are never asked about again', async () => {
  const { runInstructionTick } = await loadRoutes();
  const slow = rails([NO_QUOTED_PART, `${BASE}\n\n${WORDS}`], 17000);
  assert.deepEqual((await runInstructionTick(slow.ctx, { now: slow.now })).body, { claimed: 1, published: 0, failed: 1 });
  assert.deepEqual(steps(slow), ['application_profiles.claim', 'bot', 'application_profiles.fail'], 'over a third of 48 s: one turn');
  assert.equal(slow.calls[2].input.detail, ATTEMPT_3);
  const refused = rails([new Error('refused: requested bot is not declared by this application')], 1000);
  await runInstructionTick(refused.ctx, { now: refused.now });
  assert.deepEqual(steps(refused), ['application_profiles.claim', 'bot', 'application_profiles.fail']);
  const kernel = rails([`${BASE}\n\n${WORDS}`], 1000, { 'application_profiles.publish': new Error('refused: instruction text holds an address') });
  const intent = kernel.ctx.intent;
  kernel.ctx.intent = async (name, input) => {
    const answer = await intent(name, input);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  await runInstructionTick(kernel.ctx, { now: kernel.now });
  assert.deepEqual(steps(kernel), ['application_profiles.claim', 'bot', 'application_profiles.publish', 'application_profiles.fail']);
  const retried = pack.retryText(pack.requestText(PRODUCTION_WRITER), 'x'.repeat(500));
  assert.ok(Buffer.byteLength(retried, 'utf8') < pack.MAX_REQUEST_BYTES, 'the second request fits the request bound');
  assert.ok(retried.endsWith(`Your previous answer was not used: ${'x'.repeat(240)}. Write the whole document again and fix that.`));
});
