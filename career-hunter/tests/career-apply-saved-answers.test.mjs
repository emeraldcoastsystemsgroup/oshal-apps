/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The smart build (design apply-smart-design-2026-11-26, 2.0): What Career does by itself on an employer's site, five switches that start on, each saying in plain words what Career does and what it never sees or keeps, each saved at once with Undo; Create an account greys and says why while Sign in is off, and the route refuses it on without Sign in; under them, always, a check is his. In Chromium at 1440x900 and 412x915, nothing wider than the screen and every switch a 44px target.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (the owner's answer to design question 1, "its configuration"): the Attestations group's two switches, Tick the employer's terms box for me and Sign the self-identification form with my name and today's date, start off, say what each does in his name, save with the revision the page read and Undo puts the earlier answers back; Undo is refused once the answers changed after that save.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (Saved answers, design APPLY-ORBIT 5.4): the page and its routes for a made-up person. Red on store main 75fa525e (no page and no route). Settings links to it; the page is served by GET /saved-answers-ui; in Chromium at 1440x900 and 412x915 over the real routes and store, the standing answers save into apply_profile.json under the keys normalizeAutofillProfile reads, so the next packet carries them as facts; an answer kept on a card is listed with where it came from and Remove takes it out; a save from a window that read an older revision is refused in words and changes nothing; no person and a wrong shape are refused; one person never sees another's answers.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Remember each employer site and Look at the page before moving on are not available yet: each starts off, cannot be switched, says "Not available yet, so it stays off.", and the route refuses switching one on; the other three start on. Red before: all five started on.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { playwright, ORIGIN, PHONE, DESKTOP } from './helpers/ux-page.mjs';
import { applyHarness } from './helpers/career-apply-fixture.mjs';

const require = createRequire(import.meta.url);
const answers = require('../lib/career-apply-answers'), autofill = require('../lib/autofill-bookmarklet'), packet = require('../lib/career-apply-packet');
const QUESTION = 'Are you at least 18 years old?';
let browser, h;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); h = await applyHarness(); });
after(async () => { await browser?.close(); await h?.stop(); });

/** The page as Career serves it, every Career call going to the real routes as `sub`. */
async function open(sub, size) {
  const context = await browser.newContext({ ...size, locale: 'en-US', timezoneId: 'UTC' });
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname.startsWith('/api/career-hunter/static/')) return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(path.join(import.meta.dirname, '../tools', path.basename(url.pathname))) });
    if (url.pathname.startsWith('/api/career-hunter/')) {
      const answer = await fetch(h.origin + url.pathname + url.search, { method: req.method(), headers: { 'content-type': 'application/json', 'x-test-person': sub }, body: req.postData() || undefined });
      return route.fulfill({ status: answer.status, contentType: answer.headers.get('content-type') || 'application/json', body: Buffer.from(await answer.arrayBuffer()) });
    }
    return route.fulfill({ status: 200, contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/json', body: url.pathname.endsWith('.css') || url.pathname.endsWith('.js') ? '' : '{}' });
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/api/career-hunter/saved-answers-ui`, { waitUntil: 'load' });
  await page.locator('#standing:not([hidden])').waitFor();
  return { page, context };
}
const press = (size, target) => (size === PHONE ? target.tap() : target.click());

test('Settings links to Saved answers, and the routes refuse no person and a wrong shape', async () => {
  const settings = fs.readFileSync(new URL('../tools/career-settings.html', import.meta.url), 'utf8');
  assert.match(settings, /<a href="\/api\/career-hunter\/saved-answers-ui" data-career-tool="career-settings" id="savedAnswersLink">Saved answers<small>/);
  assert.equal((await h.call('GET', '/saved-answers', null, null)).code, 401);
  h.person('dana-answers-shape');
  const read = (await h.call('GET', '/saved-answers', null, 'dana-answers-shape')).body;
  assert.equal((await h.call('POST', '/saved-answers', { revision: read.revision, standing: { heard: 'LinkedIn' }, remove: 'question:' + 'a'.repeat(64) }, 'dana-answers-shape')).code, 400);
  assert.equal((await h.call('POST', '/saved-answers', { revision: read.revision, standing: { salary: '1' } }, 'dana-answers-shape')).code, 400);
  assert.equal((await h.call('POST', '/saved-answers', { revision: read.revision, remove: 'question:' + 'a'.repeat(64) }, 'dana-answers-shape')).code, 404);
});

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: the standing answers save where the packet reads them, a kept answer is listed and removed, and a stale window is refused`, async () => {
    const sub = 'dana-answers-' + label, dana = h.person(sub);
    answers.keep(dana.dir, [{ id: 'apply-' + 'f'.repeat(32), questionId: answers.questionId(QUESTION, 'radio'), question: QUESTION, value: 'Yes', answeredAt: '2026-11-21T09:00:00Z' }]);
    fs.writeFileSync(path.join(dana.dir, 'apply_profile.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(dana.dir, 'apply_profile.json'), 'utf8')), notes: 'kept as it was' }));
    const other = h.person('other-answers-' + label);
    const { page, context } = await open(sub, size);
    try {
      assert.equal(await page.locator('h1').innerText(), 'Saved answers');
      assert.equal(await page.locator('#kept .question').innerText(), QUESTION);
      assert.match(await page.locator('#kept .from').innerText(), /^Kept from an application card · /);
      await page.locator('#workAuthorization').selectOption('Yes');
      await page.locator('#sponsorship').selectOption('No');
      await page.locator('#heard').fill('LinkedIn');
      await page.locator('#phoneType').selectOption('Mobile');
      await press(size, page.getByRole('button', { name: 'Save answers' }));
      await page.locator('#saved', { hasText: 'Saved.' }).waitFor();
      const file = JSON.parse(fs.readFileSync(path.join(dana.dir, 'apply_profile.json'), 'utf8'));
      assert.deepEqual([file.work_authorization, file.requires_sponsorship, file.how_heard, file.phone_type, file.notes], ['Yes', 'No', 'LinkedIn', 'Mobile', 'kept as it was']);
      const profile = autofill.normalizeAutofillProfile(JSON.parse(fs.readFileSync(path.join(dana.dir, 'career_db.json'), 'utf8')), file);
      assert.deepEqual([profile.workAuthorization, profile.sponsorship], ['Yes', 'No'], 'normalizeAutofillProfile reads them');
      const facts = packet.facts(profile, answers.standingFacts(answers.read(dana.dir)));
      assert.deepEqual([facts['eligibility.authorized'], facts['eligibility.sponsorship'], facts['source.heard'], facts['phone.type']], ['Yes', 'No', 'LinkedIn', 'Mobile'], 'and the next packet carries them');
      assert.equal((await h.call('GET', '/saved-answers', null, other.sub)).body.answers.length, 0, 'another person sees none of these');
      const elsewhere = (await h.call('GET', '/saved-answers', null, sub)).body;
      await h.call('POST', '/saved-answers', { revision: elsewhere.revision, standing: { heard: 'A friend' } }, sub);
      await page.locator('#heard').fill('Company site');
      await press(size, page.getByRole('button', { name: 'Save answers' }));
      await page.locator('#status', { hasText: 'Your saved answers changed in another window. Read them again.' }).waitFor();
      assert.equal(JSON.parse(fs.readFileSync(path.join(dana.dir, 'apply_profile.json'), 'utf8')).how_heard, 'A friend', 'the stale save changed nothing');
      await page.reload(); await page.locator('#standing:not([hidden])').waitFor();
      assert.equal(await page.locator('#heard').inputValue(), 'A friend');
      await press(size, page.getByRole('button', { name: 'Remove the answer to ' + QUESTION }));
      await page.locator('#status', { hasText: 'Removed.' }).waitFor();
      assert.equal(answers.read(dana.dir).answers.length, 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
      for (const target of await page.locator('button:visible, select:visible, input:visible').all()) assert.ok((await target.boundingBox()).height >= 44, 'every control is a 44px target');
    } finally { await context.close(); }
  });
}

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: the Attestations switches start off, say what each does in his name, save, and Undo puts the earlier answers back`, async () => {
    const sub = 'dana-attest-' + label, dana = h.person(sub), { page, context } = await open(sub, size);
    /** His apply_profile.json; none before his first save, and none again after Undo puts that back. */
    const file = () => { try { return JSON.parse(fs.readFileSync(path.join(dana.dir, 'apply_profile.json'), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; } };
    try {
      await page.locator('#attest:not([hidden])').waitFor();
      assert.equal(await page.locator('#attestTitle').innerText(), 'Attestations');
      const terms = page.getByRole('switch', { name: /Tick the employer’s terms box for me/ }), sign = page.getByRole('switch', { name: /Sign the self-identification form with my name and today’s date/ });
      assert.deepEqual([await terms.isChecked(), await sign.isChecked()], [false, false], 'both start off');
      assert.match(await page.locator('#attest').innerText(), /Career ticks the box that says you agree to the employer’s terms, in your name\./);
      assert.match(await page.locator('#attest').innerText(), /Career types your name and today’s date as your signature on the employer’s self-identification form, in your name\./);
      await press(size, terms);
      await page.locator('#attestSaved', { hasText: 'Saved.' }).waitFor();
      assert.deepEqual(file().attest, { terms: true, self_id_signature: false });
      await press(size, page.locator('#attest').getByRole('button', { name: 'Undo' }));
      await page.locator('#attestSaved', { hasText: 'Put back as it was.' }).waitFor();
      assert.equal(await terms.isChecked(), false);
      assert.equal(file().attest?.terms === true, false, 'Undo put the earlier answers back');
      await press(size, sign);
      await page.locator('#attestSaved', { hasText: 'Saved.' }).waitFor();
      const saved = (await h.call('GET', '/saved-answers', null, sub)).body;
      assert.deepEqual(saved.attest, { terms: false, selfIdSignature: true });
      await h.call('POST', '/saved-answers', { revision: saved.revision, standing: { heard: 'A friend' } }, sub);
      const stale = await h.call('POST', '/saved-answers', { revision: saved.revision, undo: saved.undo }, sub);
      assert.equal(stale.code, 409, 'Undo is refused once the answers changed after that save');
      assert.equal(file().attest.self_id_signature, true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
    } finally { await context.close(); }
  });
}

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: what Career does by itself says what each does, the three the kernel acts on start on and save at once with Undo, the two not available yet stay off, and a check is always his`, async () => {
    const sub = 'dana-help-' + label, dana = h.person(sub), { page, context } = await open(sub, size);
    const kept = () => { try { return JSON.parse(fs.readFileSync(path.join(dana.dir, 'apply_profile.json'), 'utf8')).apply_help; } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } };
    try {
      await page.locator('#help:not([hidden])').waitFor();
      assert.equal(await page.locator('#helpTitle').innerText(), 'What Career does by itself on an employer’s site');
      const names = [/^Remember each employer site/, /^Look at the page before moving on/, /^Sign in with the login Chrome saved/, /^Create an account with Chrome’s suggested password/, /^Read a verification code from my mail/];
      const [memory, screen, signIn, account, codes] = names.map((name) => page.locator('#help').getByRole('switch', { name }));
      assert.deepEqual(await Promise.all([memory, screen, signIn, account, codes].map((box) => box.isChecked())), [false, false, true, true, true], 'the three the kernel acts on start on');
      assert.deepEqual(await Promise.all([memory, screen, signIn, account, codes].map((box) => box.isDisabled())), [true, true, false, false, false], 'the two not available yet cannot be switched');
      assert.deepEqual(await page.locator('#help small.soon').allInnerTexts(), ['Not available yet, so it stays off.', 'Not available yet, so it stays off.']);
      for (const box of [memory, screen]) assert.equal(await box.evaluate((input) => input.closest('label').querySelector('small.soon') !== null), true, 'each of the two says so under its own name');
      const said = await page.locator('#help').innerText();
      for (const words of [/It keeps no value of yours\. Every value is read again from the application you approve\./, /this installation’s own picture model checks them/,
        /Chrome fills your saved login and Career presses Sign in\. Career never sees, types or keeps a password\./, /Career accepts the strong password Chrome suggests, and Chrome saves it\. Career never sees it\./,
        /Career reads that one message in your mailbox \(only mail that arrived after the code was asked for, from the employer’s or the job site’s address\) and types the code\. It reads nothing else\./]) assert.match(said, words);
      assert.equal(await page.locator('#helpAlways').innerText(), 'A “verify you are human” check is always yours. Career never solves or skips one.');
      // One switch saves at once, and Undo puts the earlier answers back.
      await press(size, codes);
      await page.locator('#helpSaved', { hasText: 'Saved.' }).waitFor();
      assert.equal(kept().mailCodes, false);
      assert.equal((await h.call('GET', '/saved-answers', null, sub)).body.help.mailCodes, false);
      await press(size, page.locator('#help').getByRole('button', { name: 'Undo' }));
      await page.locator('#helpSaved', { hasText: 'Put back as it was.' }).waitFor();
      assert.equal(await codes.isChecked(), true);
      assert.notEqual(kept()?.mailCodes, false, 'Undo put the earlier answers back');
      // Sign in off: Create an account goes off with it, greys, and says why. The route refuses it on without Sign in.
      await press(size, signIn);
      await page.locator('#helpSaved', { hasText: 'Saved.' }).waitFor();
      assert.deepEqual([await signIn.isChecked(), await account.isChecked(), await account.isDisabled()], [false, false, true]);
      assert.equal(await page.locator('#helpCreateWhy').innerText(), 'Needs “Sign in with the login Chrome saved” switched on: Career signs in with the account it made.');
      assert.deepEqual([kept().signIn, kept().createAccount], [false, false]);
      const now = (await h.call('GET', '/saved-answers', null, sub)).body;
      const refused = await h.call('POST', '/saved-answers', { revision: now.revision, help: { createAccount: true } }, sub);
      assert.equal(refused.code, 400);
      assert.match(refused.body.error, /Creating an account needs “Sign in with the login Chrome saved” switched on/);
      assert.equal((await h.call('POST', '/saved-answers', { revision: now.revision, help: { submit: true } }, sub)).code, 400, 'only the five');
      assert.equal((await h.call('POST', '/saved-answers', { revision: now.revision, help: { mailCodes: 'off' } }, sub)).code, 400, 'on or off');
      const soon = await h.call('POST', '/saved-answers', { revision: now.revision, help: { siteMemory: true } }, sub);
      assert.deepEqual([soon.code, soon.body.error], [400, '“Remember each employer site” is not available yet, so it stays off.']);
      await press(size, signIn);
      await page.locator('#helpCreateAccount:not([disabled])').waitFor();
      assert.deepEqual([await signIn.isChecked(), await account.isChecked(), await page.locator('#helpCreateWhy').isHidden()], [true, false, true], 'Sign in back on: an account may be switched on again');
      // A window that read the answers before another window changed them saves nothing.
      const elsewhere = (await h.call('GET', '/saved-answers', null, sub)).body;
      await h.call('POST', '/saved-answers', { revision: elsewhere.revision, help: { mailCodes: false } }, sub);
      await press(size, signIn);
      await page.locator('#helpSaved', { hasText: 'Your saved answers changed in another window. Read them again.' }).waitFor();
      assert.deepEqual([kept().signIn, kept().mailCodes], [true, false], 'the stale switch changed nothing');
      assert.deepEqual(Object.keys(kept()).sort(), ['createAccount', 'mailCodes', 'signIn'], 'a switch not available yet is never kept');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
      for (const target of await page.locator('#help input:visible, #help button:visible').all()) assert.ok((await target.boundingBox()).height >= 44, 'every control is a 44px target');
    } finally { await context.close(); }
  });
}
