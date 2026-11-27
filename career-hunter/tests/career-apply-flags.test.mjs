/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-I (Roger, 2026-11-21: "we are going to have some flags like run in foreground and stop before submit. or approve submit automatically"): How Career fills in a form and the standing self-identification answers, through Career's real routes over HTTP on a made-up person's real store. The three settings start on Roger's defaults (like a person, in front, stop before Submit), save with Undo, and refuse an unknown choice and Behind with Like a person; the packet carries them as task.flags under its digest, and the approval screen says each in words, its last line saying Career presses Submit once when he chose it. Veteran and disability status save as Yes, No or blank (anything else refused, Undo puts them back) and reach the packet as selfid.veteran and selfid.disability (yes, no; no fact when blank), citizenship as eligibility.citizenship. The sync records Submitted by Career after your approval only with the employer's confirmation verified, Career's own Submit not seen as Not seen yet with its words, the job page's line when he used the mouse, and the kernel's note about his clipboard on the receipt. Red before lane APPLY-I: no flags in the answers, the packet or the review; veteran_status a refused standing answer; the sync refused submitted_by_career as a result that differs from the approval.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.76.6: gender, Hispanic or Latino and race are closed standing answers that reach the packet as the kernel's selfid.gender, selfid.hispanic and selfid.race words; a wrong choice is refused and a blank one is no fact.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.76.12: an approval that never started is replaced by a newer approval of other documents (stopped, with its reason); a started run still refuses another packet with run_conflict.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyHarness } from './helpers/career-apply-fixture.mjs';
import { playwright, ORIGIN, PHONE, DESKTOP } from './helpers/ux-page.mjs';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const png = (label) => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(label)]);
let h, browser;
before(async () => { h = await applyHarness(); browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); await h?.stop(); });

const read = (sub) => h.call('GET', '/saved-answers', null, sub).then((r) => r.body);
const save = async (sub, body) => h.call('POST', '/saved-answers', { revision: (await read(sub)).revision, ...body }, sub);

test('How Career fills in a form starts on the defaults, saves with Undo, and refuses what it cannot do', async () => {
  const dana = h.person('dana-flags');
  assert.deepEqual((await read(dana.sub)).flags, { input: 'person-like', window: 'foreground', submit: 'stop-before-submit' });
  assert.equal((await save(dana.sub, { flags: { window: 'background' } })).code, 400, 'behind needs Fast');
  assert.match((await save(dana.sub, { flags: { window: 'background' } })).body.error, /needs Career’s Chrome window in front/);
  assert.equal((await save(dana.sub, { flags: { input: 'robot' } })).code, 400, 'an unknown choice');
  assert.equal((await save(dana.sub, { flags: { allow: 'submit' } })).code, 400, 'an unknown setting');
  const fast = await save(dana.sub, { flags: { input: 'fast', window: 'background' } });
  assert.equal(fast.code, 200, JSON.stringify(fast.body));
  assert.deepEqual(fast.body.flags, { input: 'fast', window: 'background', submit: 'stop-before-submit' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dana.dir, 'apply_profile.json'), 'utf8')).apply_flags, fast.body.flags);
  assert.equal((await save(dana.sub, { flags: { input: 'person-like' } })).code, 400, 'like a person never behind');
  const undone = await save(dana.sub, { undo: fast.body.undo });
  assert.deepEqual(undone.body.flags, { input: 'person-like', window: 'foreground', submit: 'stop-before-submit' });
});

test('the packet carries the settings under its digest and the approval says each in words', async () => {
  const dana = h.person('dana-flags-packet');
  const first = (await h.call('GET', '/apply-review/7', null, dana.sub)).body;
  assert.deepEqual(first.flags, { input: 'person-like', window: 'foreground', submit: 'stop-before-submit' });
  assert.deepEqual(first.flagLines, ['Career types like a person: it only reads the page, and your computer’s own mouse and keyboard do every click, key and paste, at a person’s pace.',
    'Its Chrome window stays in front while it works; you can take over at any time.', 'Career stops before Submit. You press it.']);
  assert.equal(first.stop, 'Career stops at the employer’s Review page. You press Submit.');
  assert.equal((await save(dana.sub, { flags: { submit: 'submit-after-approval' } })).code, 200);
  const second = (await h.call('GET', '/apply-review/7', null, dana.sub)).body;
  assert.notEqual(second.packetDigest, first.packetDigest, 'a changed setting is another approval');
  assert.equal(second.flagLines[2], 'Career presses Submit once, after it checks the Review page and finds nothing wrong, and keeps the employer’s confirmation.');
  assert.equal(second.stop, 'Career checks the Review page and presses Submit once. You can stop it before then.');
  const stale = await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: first.packetDigest, approved: true }, dana.sub);
  assert.equal(stale.code, 428, 'the packet he reviewed before the change is not this one');
  const approved = await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: second.packetDigest, approved: true }, dana.sub);
  assert.equal(approved.code, 200, JSON.stringify(approved.body));
  const input = JSON.parse(fs.readFileSync(path.join(dana.dir, `apply-${approved.body.run.id}-1.json`), 'utf8'));
  assert.deepEqual(input.task.flags, { input: 'person-like', window: 'foreground', submit: 'submit-after-approval' });
  assert.equal((await save(dana.sub, { flags: { submit: 'stop-before-submit' } })).code, 200);
  const frozen = JSON.parse(fs.readFileSync(path.join(dana.dir, `apply-${approved.body.run.id}-1.json`), 'utf8'));
  assert.equal(frozen.task.flags.submit, 'submit-after-approval', 'a setting changed after approval does not reach that run');
});

test('an approval that never started is replaced by a newer approval of other documents; one that started still holds the job', async () => {
  const dana = h.person('dana-replaced');
  const review = async () => (await h.call('GET', '/apply-review/7', null, dana.sub)).body;
  const approve = async (digest) => h.call('POST', '/apply-runs', { postingId: 7, packetDigest: digest, approved: true }, dana.sub);
  const first = await approve((await review()).packetDigest);
  assert.equal(first.code, 200, JSON.stringify(first.body));
  assert.equal((await save(dana.sub, { flags: { window: 'background', input: 'fast' } })).code, 200, 'another packet');
  const second = await approve((await review()).packetDigest);
  assert.equal(second.code, 200, 'no run_conflict: the first approval never started: ' + JSON.stringify(second.body));
  assert.notEqual(second.body.run.id, first.body.run.id);
  const listed = (await h.call('GET', '/apply-runs', null, dana.sub)).body.runs;
  const old = listed.find((run) => run.id === first.body.run.id);
  assert.deepEqual([old.status, old.reason], ['stopped', 'Replaced by a newer approval before it started. Nothing was submitted.']);
  // Once it started, the job is held: another packet is refused until it is stopped.
  assert.equal((await h.call('POST', `/apply-runs/${second.body.run.id}/bind`, {}, dana.sub)).code, 200);
  assert.equal((await h.call('POST', `/apply-runs/${second.body.run.id}/start`, {}, dana.sub)).code, 200);
  assert.equal((await save(dana.sub, { flags: { window: 'foreground', input: 'person-like' } })).code, 200);
  const third = await approve((await review()).packetDigest);
  assert.deepEqual([third.code, third.body.code], [409, 'run_conflict'], JSON.stringify(third.body));
});

test('veteran and disability status are Yes, No or blank, undo, and reach the packet as yes or no; blank is no fact', async () => {
  const dana = h.person('dana-selfid');
  assert.equal((await save(dana.sub, { standing: { veteranStatus: 'Maybe' } })).code, 400, 'only Yes, No or blank');
  const saved = await save(dana.sub, { standing: { veteranStatus: 'No', disabilityStatus: 'No', citizenship: 'U.S. citizen' } });
  assert.equal(saved.code, 200, JSON.stringify(saved.body));
  assert.deepEqual([saved.body.standing.veteranStatus, saved.body.standing.disabilityStatus, saved.body.standing.citizenship], ['No', 'No', 'U.S. citizen']);
  const kept = JSON.parse(fs.readFileSync(path.join(dana.dir, 'apply_profile.json'), 'utf8'));
  assert.deepEqual([kept.veteran_status, kept.disability_status, kept.citizenship], ['No', 'No', 'U.S. citizen']);
  const facts = async () => Object.fromEntries((await h.call('GET', '/apply-review/7', null, dana.sub)).body.facts.map((f) => [f.slot, f.value]));
  const withThem = await facts();
  assert.deepEqual([withThem['selfid.veteran'], withThem['selfid.disability'], withThem['eligibility.citizenship']], ['no', 'no', 'U.S. citizen']);
  const blank = await save(dana.sub, { standing: { disabilityStatus: '' } });
  const without = await facts();
  assert.equal(without['selfid.veteran'], 'no');
  assert.equal('selfid.disability' in without, false, 'a blank answer is declined on the form');
  const undone = await save(dana.sub, { undo: blank.body.undo });
  assert.equal(undone.body.standing.disabilityStatus, 'No', 'Undo puts it back');
});

test('gender, Hispanic or Latino and race are closed choices, reach the packet in the kernel\'s words, and blank is no fact', async () => {
  const roger = h.person('roger-selfid');
  for (const wrong of [{ gender: 'male' }, { race: 'Purple' }, { hispanicLatino: 'Maybe' }]) assert.equal((await save(roger.sub, { standing: wrong })).code, 400, JSON.stringify(wrong));
  const mine = { gender: 'Male', hispanicLatino: 'No', race: 'White', veteranStatus: 'No', disabilityStatus: 'No' };
  const saved = await save(roger.sub, { standing: mine });
  assert.equal(saved.code, 200, JSON.stringify(saved.body));
  for (const [key, value] of Object.entries(mine)) assert.equal(saved.body.standing[key], value, key);
  const kept = JSON.parse(fs.readFileSync(path.join(roger.dir, 'apply_profile.json'), 'utf8'));
  assert.deepEqual([kept.gender, kept.hispanic_latino, kept.race], ['Male', 'No', 'White']);
  const facts = async () => Object.fromEntries((await h.call('GET', '/apply-review/7', null, roger.sub)).body.facts.map((f) => [f.slot, f.value]));
  const sent = await facts();
  assert.deepEqual(['selfid.gender', 'selfid.hispanic', 'selfid.race', 'selfid.veteran', 'selfid.disability'].map((slot) => sent[slot]), ['male', 'no', 'white', 'no', 'no']);
  assert.equal((await save(roger.sub, { standing: { race: 'Two or more races' } })).code, 200);
  assert.equal((await facts())['selfid.race'], 'two-or-more');
  await save(roger.sub, { standing: { gender: '', race: '' } });
  const declined = await facts();
  assert.equal('selfid.gender' in declined || 'selfid.race' in declined, false, 'a blank answer is declined on the form');
  assert.equal(declined['selfid.hispanic'], 'no');
});

/** The Saved answers page as Career serves it, every Career call going to the real routes as `sub`. */
async function page(sub, size) {
  const context = await browser.newContext({ ...size, locale: 'en-US', timezoneId: 'UTC' });
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname.startsWith('/api/career-hunter/') && !url.pathname.startsWith('/api/career-hunter/static/')) {
      const answer = await fetch(h.origin + url.pathname + url.search, { method: req.method(), headers: { 'content-type': 'application/json', 'x-test-person': sub }, body: req.postData() || undefined });
      return route.fulfill({ status: answer.status, contentType: answer.headers.get('content-type') || 'application/json', body: Buffer.from(await answer.arrayBuffer()) });
    }
    return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
  });
  const tab = await context.newPage();
  await tab.goto(`${ORIGIN}/api/career-hunter/saved-answers-ui`, { waitUntil: 'load' });
  await tab.locator('#flags:not([hidden])').waitFor();
  return { tab, context };
}

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: Saved answers shows How Career fills in a form on its defaults, says why, and saves a choice`, async () => {
    const sub = 'dana-flags-page-' + label;
    h.person(sub);
    const { tab, context } = await page(sub, size);
    try {
      assert.match(await tab.locator('#flagsWhy').innerText(), /Like a person is the default\. It is slower, and it changes nothing inside the employer’s page/);
      const checked = (name) => tab.locator(`input[name="${name}"]:checked`).getAttribute('value');
      assert.deepEqual([await checked('flagInput'), await checked('flagWindow'), await checked('flagSubmit')], ['person-like', 'foreground', 'stop-before-submit']);
      assert.equal(await tab.locator('input[name="flagWindow"][value="background"]').isDisabled(), true, 'Behind only with Fast');
      assert.match(await tab.locator('label[for="veteranStatus"]').innerText(), /Blank means Career declines the veteran question on the form/);
      await tab.locator('input[name="flagInput"][value="fast"]').check();
      await tab.locator('#flagsSaved', { hasText: 'Saved.' }).waitFor();
      await tab.locator('input[name="flagWindow"][value="background"]:not([disabled])').check();
      await tab.locator('#flagsUndo:not([hidden])').waitFor();
      assert.deepEqual((await read(sub)).flags, { input: 'fast', window: 'background', submit: 'stop-before-submit' });
      const width = await tab.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(width, 0, 'no sideways scroll');
    } finally { await context.close(); }
  });
}

// ---- the sync -----------------------------------------------------------------------------------------------------

async function started(name, flags) {
  const person = h.person(name);
  if (flags) await save(person.sub, { flags });
  const { body } = await h.call('GET', '/apply-review/7', null, person.sub);
  const run = (await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: body.packetDigest, approved: true }, person.sub)).body.run;
  await h.call('POST', `/apply-runs/${run.id}/bind`, {}, person.sub);
  await h.call('POST', `/apply-runs/${run.id}/start`, {}, person.sub);
  const workId = 'b2000000-0000-0000-0000-00000000000' + h.port.started.length;
  const input = JSON.parse(fs.readFileSync(path.join(person.dir, `apply-${run.id}-1.json`), 'utf8'));
  const sync = () => h.call('POST', `/apply-runs/${run.id}/sync`, {}, person.sub);
  return { person, run, workId, input, sync };
}
function end(s, outcome, data) {
  h.port.rows = [{ id: s.workId, state: 'completed', executor: 'orbit-apply-v1' }];
  h.port.accepted.set(s.workId, { version: 2, intentId: s.run.id, attempt: 1, requestDigest: s.input.requestDigest, outcome, data });
}
function picture(s, name, bytes) { h.port.artifacts.set(s.workId + '/' + name, { name, sha256: sha(bytes), byteLength: bytes.length, base64: bytes.toString('base64') }); return { artifact: name, sha256: sha(bytes) }; }

test('Career’s own Submit is recorded only with the employer’s confirmation, and not seen says Career pressed it', async () => {
  const s = await started('dana-career-submit', { submit: 'submit-after-approval' });
  end(s, 'submitted_by_career', { reason: 'Submitted by Career after your approval; the employer’s confirmation was seen.', pictures: [], notes: [] });
  assert.equal((await s.sync()).code, 409, 'no confirmation: nothing recorded');
  const confirmation = picture(s, 'confirmation.png', png('thank you'));
  end(s, 'submitted_by_career', { reason: 'Submitted by Career after your approval; the employer’s confirmation was seen.', pictures: [],
    confirmation: { ...confirmation, text: 'thank you for applying' },
    notes: ['Career pasted a value into the form and could not put your clipboard back as it was; copy what you had again.'] });
  const synced = await s.sync();
  assert.equal(synced.code, 200, JSON.stringify(synced.body));
  assert.deepEqual([synced.body.run.status, synced.body.run.submittedBy], ['submitted', 'career']);
  const job = s.person.signal();
  assert.deepEqual([job.status, job.application_source], ['applied', 'verified-submission']);
  assert.equal(sha(fs.readFileSync(job.confirmation_path)), confirmation.sha256);
  const receipt = JSON.parse(fs.readFileSync(path.join(s.person.folder, 'apply-receipt.json'), 'utf8'));
  assert.deepEqual(receipt.attempts[0].notes, ['Career pasted a value into the form and could not put your clipboard back as it was; copy what you had again.']);
  const t = await started('dana-career-not-seen', { submit: 'submit-after-approval' });
  end(t, 'submit_not_seen', { reason: 'Career pressed Submit once after your approval; the employer’s confirmation was not seen. Check the Chrome window Career opened.', pictures: [] });
  const notSeen = await t.sync();
  assert.deepEqual([notSeen.body.run.status, notSeen.body.run.pressedByCareer], ['not_seen', true]);
  assert.equal(t.person.signal().status === 'applied', false, 'nothing is recorded applied without the confirmation');
});

test('the job page says when he used the mouse, and what the run said when ready', async () => {
  const s = await started('dana-window');
  h.port.rows = [{ id: s.workId, state: 'waiting_for_you', executor: 'orbit-apply-v1',
    apply: { state: 'waiting_for_you', reason: { kind: 'window', text: 'Paused because you used the mouse. It goes on by itself when you stop, or press Stop.' }, pages: [] } }];
  const waiting = (await s.sync()).body.run;
  assert.equal(waiting.live.line, 'Paused because you used the mouse. It goes on by itself when you stop, or press Stop.');
  h.port.rows = [{ id: s.workId, state: 'waiting_for_you', executor: 'orbit-apply-v1',
    apply: { state: 'ready', reason: null, pages: [], ready: 'Career did not press Submit because the page shows errors. Ready: check it and press Submit.' } }];
  const ready = (await s.sync()).body.run;
  assert.equal(ready.status, 'ready');
  assert.equal(ready.live.ready, 'Career did not press Submit because the page shows errors. Ready: check it and press Submit.');
  h.port.rows = [{ id: s.workId, state: 'apply_running', executor: 'orbit-apply-v1', apply: { state: 'confirming', reason: null, pages: [] } }];
  assert.equal((await s.sync()).body.run.live.line, 'Career pressed Submit; waiting for the employer’s confirmation');
});
