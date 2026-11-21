/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.72.0: the approval screen names the Word file it uploads as the résumé for upload forms (the parse résumé): Résumé for upload forms (Word) · version …, and Career uploads the résumé for upload forms (Word). Red before: Résumé (Word) and the Word résumé.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.71.0 (lane APPLY-G): for an employer's own site the approval screen says Career's careful rules and that it stops before any button that sends the application; for a company page embedding Greenhouse it says where the form really opens; at 1440x900 and 412x915, nothing wider than the screen.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0: the approval screen says each Attestations switch in words (one on, one off).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0: the approval screen lists his phone, phone type, address, city, state, state abbreviation, postal code and country, read from profile.application_contact, profile.phone and his Saved answers.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.70.0 (Fill it in on my Chrome): the shipped tools/career-application.html in Chromium at 1440x900 and 412x915. Every call the assisted application makes (GET /apply-review, POST /apply-runs, /bind, /start, /sync, /kept, GET /saved-answers) goes to Career's real routes over HTTP on a made-up person's real store; the job read and the kernel's own routes (the Job Apply computers, the question cards, the ticket cancel) are stood in. Red on store main 75fa525e (no such button). Fill it in on my Chrome is offered, first and the one filled button, only when the person's Job Apply computer reports browser-apply; the three ways to send by hand and Send it for me from my computer stay. Its approval screen shows the exact files with versions, the facts, the jobs on this résumé (a year alone says Career asks for the months) and the stop at Review; Approve and start approves, binds and starts the exact packet. The page then follows the run (Waiting for your computer, Waiting for you to sign in, a question card answered in place with Keep, which Career saves into Saved answers, Ready for you to submit) and Stop goes through the kernel's ticket cancel and puts the ways to send back. Nothing is wider than a phone.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { playwright, tools, ORIGIN, PHONE, DESKTOP } from './helpers/ux-page.mjs';
import { applyHarness, WORKDAY } from './helpers/career-apply-fixture.mjs';

const require = createRequire(import.meta.url), answers = require('../lib/career-apply-answers');
const API = '/api/career-hunter', CARD = 'apply-' + 'e'.repeat(32), QUESTION = 'Will you now or in the future require sponsorship?';
let browser, h;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); h = await applyHarness(); });
after(async () => { await browser?.close(); await h?.stop(); });

const job = () => ({ id: 7, title: 'Office Manager', company: 'Example Freight Co', status: 'generated', favorite: true, has_resume: true, has_cover: true,
  url: WORKDAY, generated_at: '2026-11-20T12:00:00.000Z', board: {}, application: { needsGeneration: false, draft: { revision: 1, guidance: '', experienceIds: [] } } });
const orbit = (features) => ({ workers: [{ id: 'orbit-1', clientId: 'orbit-1', kind: 'orbit', hostname: 'Dana’s laptop', available: true, tools: ['browser.control'], features }],
  selectedDeviceId: 'orbit-1', selectedDeviceName: 'Dana’s laptop', selectionConfigured: true, available: true });

/**
 * @description Open the job page for one made-up person. Career's assisted-application routes are the real ones; the
 * kernel's are `kernel`. @returns {Promise<{page:object,context:object,kernel:object}>}
 */
async function open(sub, size, features) {
  const kernel = { cards: [], kept: [], answered: [], cancelled: [], writes: [] }, context = await browser.newContext({ ...size, locale: 'en-US', timezoneId: 'UTC' });
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.origin !== ORIGIN) return route.abort();
    if (p === '/screen') return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(tools, 'career-application.html')) });
    const asset = p.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
    if (asset && existsSync(join(tools, asset[1]))) return route.fulfill({ status: 200, contentType: asset[1].endsWith('.css') ? 'text/css' : 'application/javascript', body: readFileSync(join(tools, asset[1])) });
    if (/^\/api\/career-hunter\/(apply-review|apply-runs|saved-answers)/.test(p)) {
      const answer = await fetch(h.origin + p + url.search, { method: req.method(), headers: { 'content-type': 'application/json', 'x-test-person': sub }, body: req.postData() || undefined });
      return route.fulfill({ status: answer.status, contentType: answer.headers.get('content-type') || 'application/json', body: Buffer.from(await answer.arrayBuffer()) });
    }
    if (/^\/(shared|cockpit|ui)\//.test(p)) return route.fulfill({ status: 200, contentType: p.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
    if (p === `${API}/jobs/7`) return json({ job: job() });
    if (p === `${API}/experience-bank`) return json({ version: 1, revision: 'r1', entries: [] });
    if (p === `${API}/resume/state`) return json({ hasResume: true });
    if (p === `${API}/resume`) return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>document</p>' });
    if (p === '/api/apply-operator/workers') return json(orbit(features));
    if (p === '/api/guest/session') return json({ guest: false });
    if (p === '/api/auth/user') return json({ authenticated: true, sub });
    if (p === '/api/apply/cards') return json({ cards: kernel.cards, kept: kernel.kept });
    if (p === `/api/apply/cards/${CARD}/answer`) { kernel.answered.push({ header: req.headers()['x-oshal-apply-card'], body: JSON.parse(req.postData()) }); return json({ status: 200, result: { said: 'Answered. Career types it in on Dana’s laptop and keeps it for next time.' }, keep: true }); }
    if (p === '/confirmations') return json({ confirmation: 'confirm-1' });
    const cancel = p.match(/^\/tickets\/([\w-]+)\/cancel$/);
    if (cancel) { kernel.cancelled.push({ ticket: cancel[1], confirm: req.headers()['x-oshal-confirm'] }); return json({ ok: true }); }
    return json({});
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/screen?view=queue&application=7&step=review`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Send your application' }).waitFor();
  await page.locator('#sendComputer:not(:has([role="status"]))').waitFor();
  return { page, context, kernel };
}
const press = (size, target) => (size === PHONE ? target.tap() : target.click());
const filled = (page) => page.locator('main :is(.btn.primary, .ck-primary):visible').allInnerTexts();
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** The offer on Send, then its approval screen, as the person reads them. */
async function offeredAndReviewed(page, size) {
  await page.getByRole('button', { name: 'Fill it in on my Chrome' }).waitFor();
  assert.deepEqual(await filled(page), ['Fill it in on my Chrome'], 'the one filled button');
  assert.equal(await page.locator('#sendAssist p').first().innerText(), 'Career opens the employer’s form in your Chrome, uploads this job’s résumé, fixes what the site read wrong, and stops at Review. You press Submit.');
  assert.deepEqual(await page.locator('.send-ways > *').allInnerTexts(), ['Open the employer’s form', 'Download résumé and cover letter', 'I applied'], 'the ways to send by hand stay');
  assert.equal(await page.getByRole('button', { name: 'Send it for me from my computer' }).isVisible(), true, 'and the other computer option stays');
  assert.ok((await page.locator('#sendAssist').boundingBox()).y < (await page.locator('.send-ways').boundingBox()).y, 'it is the first way to send');
  await press(size, page.getByRole('button', { name: 'Fill it in on my Chrome' }));
  await page.getByRole('heading', { name: 'Approve Career filling in this form' }).waitFor();
  await page.locator('#assistStop').waitFor();
  const text = await page.locator('main').innerText();
  assert.match(text, /Résumé for upload forms \(Word\) · version [0-9a-f]{10}/);
  assert.match(text, /Cover letter \(PDF\) · version [0-9a-f]{10}/);
  assert.match(text, /Career uploads the résumé for upload forms \(Word\)\./);
  assert.match(text, /Administrative Assistant · Northwind Traders · 2012 to 2015 · Career asks you for the months/);
  assert.match(text, /Office Manager · Example Freight Co · Apr 2019 to Present/);
  assert.equal(await page.locator('#assistStop b').innerText(), 'Career stops at the employer’s Review page. You press Submit.');
  assert.deepEqual(await page.locator('#assistAttest li').allInnerTexts(), ['Career ticks the employer’s terms box for you, in your name.',
    'You sign the self-identification form yourself. Career hands it back to you there.'], 'the approval says each switch in words');
  const facts = await page.locator('#assistFacts dt').evaluateAll((terms) => terms.map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
  for (const pair of [['Phone', '555-0100'], ['Phone type', 'Mobile'], ['Address', '1 Example Way'], ['City', 'Springfield'], ['State', 'Illinois'],
    ['State abbreviation', 'IL'], ['Postal code', '62701'], ['Country', 'United States']]) assert.ok(facts.some(([dt, dd]) => dt === pair[0] && dd === pair[1]), 'the approval lists ' + pair.join(': '));
  assert.ok(await fits(page), 'nothing is wider than the screen');
}

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: without browser-apply on the Job Apply computer there is no Fill it in on my Chrome, and Send is as it was`, async () => {
    const { page, context } = await open('dana-send-none-' + label, size, ['holds-person-mark']);
    try {
      assert.equal(await page.getByRole('button', { name: 'Fill it in on my Chrome' }).count(), 0);
      assert.deepEqual(await filled(page), ['Open the employer’s form']);
      assert.equal(await page.getByRole('button', { name: 'Send it for me from my computer' }).isVisible(), true);
    } finally { await context.close(); }
  });

  test(`${label}: Fill it in on my Chrome leads Send, shows the exact packet, starts it, follows it, answers a card and stops`, async () => {
    const sub = 'dana-send-' + label, dana = h.person(sub);
    await h.call('POST', '/saved-answers', { revision: (await h.call('GET', '/saved-answers', null, sub)).body.revision, standing: { phoneType: 'Mobile' } }, sub);
    await h.call('POST', '/saved-answers', { revision: (await h.call('GET', '/saved-answers', null, sub)).body.revision, attest: { terms: true } }, sub);
    const { page, context, kernel } = await open(sub, size, ['holds-person-mark', 'browser-apply']);
    try {
      await offeredAndReviewed(page, size);
      await press(size, page.getByRole('button', { name: 'Approve and start' }));
      await page.locator('#assistState').waitFor();
      assert.equal(await page.locator('#assistState').innerText(), 'Opening the form');
      assert.equal(h.port.created.at(-1).ticketType, 'career-apply');
      assert.equal(h.port.started.at(-1).input.executor, 'orbit-apply-v1');
      const workId = 'b2000000-0000-0000-0000-00000000000' + h.port.started.length;
      h.port.rows = [{ id: workId, state: 'running', executor: 'orbit-apply-v1', apply: { attempt: 1, state: 'waiting_for_you', reason: { kind: 'sign-in', text: 'Sign in to this employer’s site in the Chrome window Career opened, or create your account there. Career goes on when you are in.' } } }];
      await page.getByRole('heading', { name: 'Waiting for you to sign in' }).waitFor({ timeout: 15000 });
      assert.match(await page.locator('#assistLine').innerText(), /^Sign in to this employer’s site/);
      const run = (await h.call('GET', '/apply-runs?postingId=7', null, sub)).body.runs[0];
      kernel.cards = [{ id: CARD, run: run.id, cardText: 'Career on Dana’s laptop asks: ' + QUESTION, ask: { question: QUESTION, questionId: answers.questionId(QUESTION, 'listbox'), options: ['Yes', 'No'], slot: null, keep: 'Keep this answer for next time', onPage: 'I’ll answer it on the page' } }];
      h.port.rows = [{ ...h.port.rows[0], apply: { attempt: 1, state: 'waiting_for_you', reason: { kind: 'question', text: 'Answer the question on the card.' } } }];
      await page.getByText('Career on Dana’s laptop asks: ' + QUESTION).waitFor({ timeout: 15000 });
      assert.equal(await page.locator('#assistState').innerText(), 'Needs your answer');
      await press(size, page.getByLabel('No', { exact: true }));
      await press(size, page.getByLabel('Keep this answer for next time'));
      await press(size, page.getByRole('button', { name: 'Answer', exact: true }));
      await page.getByText('Answered. Career types it in on Dana’s laptop and keeps it for next time.').waitFor();
      assert.deepEqual(kernel.answered, [{ header: '1', body: { option: 1, keep: true } }]);
      kernel.cards = [];
      kernel.kept = [{ id: CARD, run: run.id, questionId: answers.questionId(QUESTION, 'listbox'), question: QUESTION, value: 'No', option: 1, slot: null, answeredAt: '2026-11-21T10:05:00Z' }];
      h.port.rows = [{ ...h.port.rows[0], apply: { attempt: 1, state: 'ready' } }];
      await page.getByRole('heading', { name: 'Ready for you to submit' }).waitFor({ timeout: 15000 });
      assert.equal(await page.locator('#assistLine').innerText(), 'Ready: check it and press Submit in the Chrome window.');
      const saved = (await h.call('GET', '/saved-answers', null, sub)).body.answers;
      assert.deepEqual(saved.map((a) => [a.text, a.value]), [[QUESTION, 'No']], 'what he kept is in his Saved answers');
      assert.ok(await fits(page), 'nothing is wider than the screen');
      h.port.rows = [{ ...h.port.rows[0], state: 'cancelled' }];
      await press(size, page.getByRole('button', { name: 'Stop', exact: true }));
      await page.locator('#assistStopped').waitFor();
      assert.deepEqual(kernel.cancelled, [{ ticket: run.nativeTicketId, confirm: 'confirm-1' }], 'Stop is the kernel’s own confirmed ticket cancel');
      assert.equal(await page.locator('#assistStopped').innerText(), 'You stopped it. Nothing was submitted.');
      assert.equal(await page.getByRole('button', { name: 'Fill it in on my Chrome' }).isVisible(), true, 'and the ways to send are back');
      assert.equal(dana.signal().status, 'generated', 'nothing was recorded as applied');
    } finally { await context.close(); }
  });
}

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: an employer's own site and an embedded engine say on the approval screen how they are filled and where Career stops`, async () => {
    const cases = [
      [`dana-send-generic-${label}`, { url: 'https://jobs.example.com/apply/7' }, ['Career has no rules for this site, so it types your record only into fields whose words say exactly what they are, asks you everything else, and moves pages only with Next or Continue.'],
        'Career stops before any button that sends the application. You press it.', 'This employer’s own site · jobs.example.com'],
      [`dana-send-embed-${label}`, { url: 'https://careers.example-freight.com/jobs/office-manager?gh_jid=4567', company: { atsType: 'greenhouse', atsToken: 'examplefreight' }, atsJobId: '4567' },
        ['careers.example-freight.com shows the Greenhouse form; Career opens that form at boards.greenhouse.io.'], 'Career stops at the employer’s Review page. You press Submit.', 'Greenhouse · boards.greenhouse.io']];
    for (const [sub, options, lines, stop, site] of cases) {
      h.person(sub, options);
      const { page, context } = await open(sub, size, ['holds-person-mark', 'browser-apply']);
      try {
        await press(size, page.getByRole('button', { name: 'Fill it in on my Chrome' }));
        await page.getByRole('heading', { name: 'Approve Career filling in this form' }).waitFor();
        assert.deepEqual(await page.locator('[data-assist-mode]').allInnerTexts(), lines, sub);
        assert.equal(await page.locator('#assistStop b').innerText(), stop, sub);
        assert.ok((await page.locator('dl.facts').first().innerText()).includes(site), `${sub}: the site and the address it opens`);
        assert.ok(await fits(page), `${sub}: nothing is wider than the screen`);
      } finally { await context.close(); }
    }
  });
}
