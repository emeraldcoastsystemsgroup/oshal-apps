/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Lane APPLY-REPLAY (Roger, 2026-11-21: "can remember and play back quickly in case of timeout"): in Chromium at 1440x900 and 412x915 over Career's real routes on a made-up person's store, a run whose attempt paused (the employer's site timed out) offers Go on — fill in again from where it was, with one plain line saying Career remembers what it entered; Go on starts the next attempt; when that attempt played values back from the kernel's memory (`from: replay:1`), its receipt says how many values came from what Career remembered and names each one's source as remembered from start 1. Red on store main 6ffd5378 (the button read Go on, no line, no count).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { playwright, tools, ORIGIN, PHONE, DESKTOP } from './helpers/ux-page.mjs';
import { applyHarness, WORKDAY } from './helpers/career-apply-fixture.mjs';

let browser, h;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); h = await applyHarness(); });
after(async () => { await browser?.close(); await h?.stop(); });

const input = (person, run, n) => JSON.parse(fs.readFileSync(path.join(person.dir, `apply-${run.id}-${n}.json`), 'utf8'));

/** The kernel's record of attempt `n`: it paused, with these changes. */
async function paused(person, run, n, changes) {
  const workId = 'b2000000-0000-0000-0000-00000000000' + h.port.started.length;
  h.port.rows = [{ id: workId, state: 'completed', executor: 'orbit-apply-v1' }];
  h.port.accepted.set(workId, { version: 2, intentId: run.id, attempt: n, requestDigest: input(person, run, n).requestDigest, outcome: 'paused',
    data: { reason: 'Paused: Career waited 30 minutes for you to sign in. Nothing was submitted. Press Go on to start again.', changes } });
  const synced = await h.call('POST', `/apply-runs/${run.id}/sync`, {}, person.sub);
  assert.equal(synced.body.run.status, 'paused', JSON.stringify(synced.body));
}

/** A run whose first attempt timed out at Application Questions and whose second played back what the first entered. */
async function replayed(sub) {
  const person = h.person(sub), { body } = await h.call('GET', '/apply-review/7', null, sub);
  const run = (await h.call('POST', '/apply-runs', { postingId: 7, packetDigest: body.packetDigest, approved: true }, sub)).body.run;
  await h.call('POST', `/apply-runs/${run.id}/bind`, {}, sub); await h.call('POST', `/apply-runs/${run.id}/start`, {}, sub);
  await paused(person, run, 1, [{ page: 'Application Questions', label: 'Will you require sponsorship?', group: '', before: '', after: 'No', from: 'card:question:' + 'a'.repeat(64) }]);
  const again = await h.call('POST', `/apply-runs/${run.id}/go-on`, {}, sub);
  assert.equal(again.code, 200, JSON.stringify(again.body));
  await paused(person, run, 2, [
    { page: 'Application Questions', label: 'Will you require sponsorship?', group: '', before: '', after: 'No', from: 'replay:1' },
    { page: 'Application Questions', label: 'Country', group: '', before: '', after: 'United States of America', from: 'replay:1' },
    { page: 'Additional Questions', label: 'City', group: '', before: '', after: 'Springfield', from: 'fact:address.city' }]);
  return { person, run };
}

async function open(sub, size) {
  const context = await browser.newContext({ ...size, locale: 'en-US', timezoneId: 'UTC' });
  await context.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.origin !== ORIGIN) return route.abort();
    if (p === '/screen') return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(tools, 'career-application.html')) });
    const asset = p.match(/^\/api\/career-hunter\/static\/([\w.-]+)$/);
    if (asset) return route.fulfill({ status: 200, contentType: asset[1].endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(path.join(tools, asset[1])) });
    if (/^\/api\/career-hunter\/(apply-review|apply-runs|saved-answers)/.test(p)) {
      const answer = await fetch(h.origin + p + url.search, { method: req.method(), headers: { 'content-type': 'application/json', 'x-test-person': sub }, body: req.postData() || undefined });
      return route.fulfill({ status: answer.status, contentType: answer.headers.get('content-type') || 'application/json', body: Buffer.from(await answer.arrayBuffer()) });
    }
    if (/^\/(shared|cockpit|ui)\//.test(p)) return route.fulfill({ status: 200, contentType: p.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' });
    if (p === '/api/career-hunter/jobs/7') return json({ job: { id: 7, title: 'Office Manager', company: 'Example Freight Co', status: 'generated', has_resume: true, has_cover: true, url: WORKDAY, board: {}, application: { needsGeneration: false, draft: { revision: 1, guidance: '', experienceIds: [] } } } });
    if (p === '/api/career-hunter/experience-bank') return json({ version: 1, revision: 'r1', entries: [] });
    if (p === '/api/career-hunter/resume/state') return json({ hasResume: true });
    if (p === '/api/career-hunter/applications') return json({ applications: [] });
    if (p === '/api/career-hunter/submission-queue') return json({ items: [] });
    if (p === '/api/career-hunter/jobs') return json({ jobs: [] });
    if (p === '/api/apply-operator/workers') return json({ workers: [], available: false });
    if (p === '/api/apply/cards') return json({ cards: [], kept: [] });
    return json({});
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/screen?view=queue&application=7&step=review`, { waitUntil: 'load' });
  return { page, context };
}

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: a paused run offers Go on — fill in again from where it was, says entries are remembered, and its receipt counts them`, async () => {
    const sub = 'dana-replay-' + label, { run } = await replayed(sub), started = h.port.started.length;
    const { page, context } = await open(sub, size);
    try {
      await page.getByRole('heading', { name: 'Paused' }).waitFor();
      assert.equal(await page.locator('#assistRemembered').innerText(), 'Career remembers what it already entered and your answers, so it fills in again from where it was without asking you again.');
      const goOn = page.getByRole('button', { name: 'Go on — fill in again from where it was', exact: true });
      assert.equal(await goOn.isVisible(), true);
      assert.equal(await page.getByRole('button', { name: 'Go on', exact: true }).count(), 0, 'one Go on, in the words that say what it does');
      const receipt = page.locator('#applyReceipt');
      await receipt.waitFor();
      const latest = (await receipt.locator('details[open]').innerText()).replace(/\s+/g, ' ');
      assert.match(latest, /2 values came from what Career remembered from an earlier start\./);
      assert.match(latest, /Will you require sponsorship\?: “No” · remembered from start 1/);
      assert.match(latest, /Country: “United States of America” · remembered from start 1/);
      assert.match(latest, /City: “Springfield” · your record: address city/);
      const first = (await receipt.locator('details').first().innerText()).replace(/\s+/g, ' ');
      assert.doesNotMatch(first, /came from what Career remembered/, 'an attempt that played nothing back says nothing of it');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
      await (size === PHONE ? goOn.tap() : goOn.click());
      for (let i = 0; i < 50 && h.port.started.length === started; i++) await page.waitForTimeout(100);
      assert.equal(h.port.started.length, started + 1, 'Go on started the next attempt');
      assert.equal(JSON.parse(Buffer.from(h.port.started.at(-1).input.files[0].bytes).toString()).attempt, 3);
      assert.equal(run.id.length > 0, true);
    } finally { await context.close(); }
  });
}
