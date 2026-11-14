/**
 * CHANGE LOG
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Show approved press bounds and per-step evidence in actual approval, outcome and status screens.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Exercise non-question stop recovery from the actual application page.
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Applying by hand is the main route and the connected computer is the option (judge's report 2026-11-11, change 8). The shipped tools/career-application.html in Chromium over fixture answers, at 1440x900 and at 412x915 with touch. With the documents ready, step 3 is Send: Open the employer's form (the one filled button, the posting's own address in a new tab), Download résumé and cover letter (both files start, and a link to each stays) and I applied, in that order. I applied records the application through the job's own status route, or through the route Mark applied manually called when the job has one of Career's application records; the page then says the move in one line and reads Sent with "You marked this as applied yourself. Career has no confirmation that it was sent." With no computer connected there is no send-from-my-computer button and no connect-first dead end: the page says what is needed, and How to set up your computer explains it. With one connected, Send it for me from my computer follows the three and opens the exact-packet approval. A guest visit is not offered Connect a computer. A job with no posting address says so and offers no link that goes nowhere. After a send from the computer did not go through, Apply yourself instead opens the same three buttons.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 2: an employer address is a link only when it parses as http: or https:. With javascript:alert(1), data:text/html,x and a script address broken by a tab, the page has no Open the employer's form, no Employer posting link and no Check employer application history link, reads as it does for a job with no address, and holds no link to any other scheme; with a web address all three links carry it. Seen failing on the code as it was: Open the employer's form was a link to javascript:alert(1).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 4: I applied reads the job again before it writes. On a page that stood open while the job moved to Applied, Interviewing, Offer or Closed, the press writes nothing on either route, says "This job is already in Interviewing." (the stage's own name) and shows the application. Seen failing on the code as it was: the press wrote the applied route and the job went from Interviewing back to Applied.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 5: after I applied the application page's line leads with Applied (it led with Sent, which Career could not know). It reads Sent only when the person's computer reported it, Career holds the confirmation page, or the submission record says submitted; a job the person marked and one with no record of how it was sent read Applied. The sentences under the word are unchanged.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Use the same main résumé name in actual Tailor/no-résumé flows and Other experience, preserving source links and view-only behavior.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 7: after I applied, a computer attempt that did not go through is closed through the submission queue's own cancel route, so the activity page stops showing it as waiting on the person. (An attempt that needs answers or whose outcome is not known shows its own screen and offers no I applied.)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const BOT = 'cb000000-0000-0000-0000-000000000004';
/** One language and one clock: Pacific time, so a stored UTC evening is still the day before there. */
const at = (size) => ({ ...size, locale: 'en-US', timezoneId: 'America/Los_Angeles' });
const ready = () => ({ id: 7, title: 'Office Manager', company: 'Example Co', location: 'Austin, TX', status: 'generated', favorite: true, has_resume: true, has_cover: true,
  url: 'https://jobs.example.com/apply/7', generated_at: '2026-11-10T12:00:00.000Z', board: {}, application: { needsGeneration: false, draft: { revision: 1, guidance: '', experienceIds: [] } } });

/**
 * @description Fixture answers for one application.
 * @param {{job: object, records?: object[], computer?: boolean|null, guest?: boolean, writes: object[]}} state - The job, Career's
 *   application records, whether a computer is connected (null: the read fails), whether this is a guest visit, and where writes go.
 * @returns {(req: {method: string, url: URL, body: any}) => object|null} The handler openScreen takes.
 */
function application(state) {
  const applied = () => Object.assign(state.job, { status: 'applied', application_source: 'manual-mark', applied_at: '2026-11-11 02:00:00' });
  return ({ method, url, body }) => {
    const p = url.pathname;
    if (p === '/api/career-hunter/jobs/7' && method === 'GET') return { json: { job: state.job } };
    if (p === '/api/career-hunter/jobs/7/status' && method === 'POST') { state.writes.push({ path: p, body }); if (body.status === 'applied') applied(); return { json: { ok: true, status: body.status } }; }
    if (p === '/api/career-hunter/applications/7/applied' && method === 'POST') { state.writes.push({ path: p, body }); applied(); return { json: { ok: true } }; }
    if (p === '/api/career-hunter/applications') return { json: { applications: state.records || [] } };
    const resolved = p.match(/^\/api\/career-hunter\/submission-queue\/([\w-]+)\/resolve$/);
    if (resolved && method === 'POST') { state.writes.push({path:p,body}); state.job.application.intent.status='resolved_'+body.outcome; if(body.outcome==='sent')applied(); return {json:{ok:true,item:state.job.application.intent}}; }
    const cancel = p.match(/^\/api\/career-hunter\/submission-queue\/([\w-]+)\/cancel$/);
    if (cancel && method === 'POST') { state.writes.push({ path: p, body }); const held = state.job.application?.intent; if (held && held.id === cancel[1]) held.status = 'cancelled'; return { json: { ok: true, item: { id: cancel[1], status: 'cancelled' } } }; }
    if (p === '/api/career-hunter/experience-bank') return { json: { version: 1, revision: 'r1', entries: [] } };
    if (p === '/api/career-hunter/resume/state') return { json: { hasResume: state.hasResume !== false } };
    if (p === '/api/career-hunter/resume') return { text: url.searchParams.get('as') === 'html' ? '<p>document</p>' : `%PDF ${url.searchParams.get('kind')}` };
    if (p === '/api/career-hunter/submission-review/7') return { json: { maxPresses:4, postingId: 7, title: 'Office Manager', company: 'Example Co', url: state.job.url, packetDigest: 'a'.repeat(64), profile: { fullName: 'Ada Lovelace' }, documents: [{ kind: 'resume', sha256: 'b'.repeat(64) }, { kind: 'cover', sha256: 'c'.repeat(64) }] } };
    if (p === '/api/apply-operator/workers') return state.computer === null ? { status: 503, json: { error: 'unavailable' } } : { json: { workers: state.computer ? [{ clientId: 'n1', available: true, boundBots: [BOT] }] : [], available: Boolean(state.computer) } };
    if (p === '/api/guest/session') return { json: { guest: Boolean(state.guest), active: Boolean(state.guest) } };
    if (p === '/api/auth/user') return { json: { authenticated: true, sub: 'ada' } };
    if (p === '/api/v1/agent/schedules') return { json: { schedules: [] } };
    return { json: {} };
  };
}
const open = (state, size) => openScreen(browser, 'career-application.html', application(state), at(size), '?view=queue&application=7');
const press = (size, target) => (size === PHONE ? target.tap() : target.click());
/** Open step 3 from the documents step, the way a person arrives at it. */
async function toSend(page, size) {
  await page.getByRole('heading', { name: 'Review the documents for this job' }).waitFor();
  assert.deepEqual(await page.locator('.steps li').allTextContents(), ['1 · Tailor', '2 · Review documents', '3 · Send']);
  await press(size, page.getByRole('button', { name: 'Continue to send', exact: true }));
  await page.getByRole('heading', { name: 'Send your application' }).waitFor();
  await page.locator('#sendComputer:not(:has([role="status"]))').waitFor();
}
const filled = (page) => page.locator('main :is(.btn.primary, .ck-primary):visible').allInnerTexts();

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: with the documents ready, Send is three buttons in order, one of them filled, and no computer is needed`, async () => {
    const state = { job: ready(), computer: false, writes: [] };
    const { page, context } = await open(state, size);
    try {
      await toSend(page, size);
      assert.deepEqual(await page.locator('.send-ways > *').evaluateAll((nodes) => nodes.map((n) => [n.tagName, n.textContent])),
        [['A', 'Open the employer’s form'], ['BUTTON', 'Download résumé and cover letter'], ['BUTTON', 'I applied']]);
      assert.deepEqual(await filled(page), ['Open the employer’s form'], 'one filled button on the page');
      const form = page.getByRole('link', { name: 'Open the employer’s form' });
      assert.deepEqual([await form.getAttribute('href'), await form.getAttribute('target'), await form.getAttribute('rel')], ['https://jobs.example.com/apply/7', '_blank', 'noopener'], 'the posting\'s own address, in a new tab');
      assert.equal(await page.getByRole('button', { name: /Send it for me from my computer|Connect submission browser|Approve/ }).count(), 0, 'no button that needs a computer');
      assert.equal(await page.locator('#computerNeeded').innerText(), 'No computer is connected, so Career cannot send this for you yet. You can apply yourself with the buttons above.');
      const tops = await page.locator('.send-ways > *').evaluateAll((nodes) => nodes.map((n) => { const r = n.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), Math.round(r.width)]; }));
      for (const [, height] of tops) assert.ok(height >= 44, 'each is a 44px target');
      if (size === PHONE) {
        assert.ok(tops[0][0] < tops[1][0] && tops[1][0] < tops[2][0], 'stacked for a thumb, in order');
        for (const [, , width] of tops) assert.ok(width >= 360, 'each is as wide as the screen allows');
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'nothing is wider than the screen');
      assert.equal(await page.locator('.journey-nav').isVisible(), false, 'under Career\'s bar the old four-link row is not drawn');
      const how = page.locator('.computer-how > summary');
      assert.equal(await how.innerText(), 'How to set up your computer');
      await press(size, how);
      await page.getByText('Career fills in the employer’s form in a browser window of its own on that computer, and only for an application you approve.').waitFor();
      assert.equal(await page.locator('.computer-how li').count(), 3);
      assert.equal(await page.locator('.computer-how').getByRole('button', { name: 'Connect a computer', exact: true }).isVisible(), true);
      assert.deepEqual(state.writes, [], 'looking at the ways to send writes nothing');
    } finally { await context.close(); }
  });

  test(`${label}: I applied records it as the person's own word, says the move, and the page reads Applied with the truth`, async () => {
    const state = { job: ready(), computer: false, writes: [] };
    const { page, context } = await open(state, size);
    try {
      await toSend(page, size);
      await press(size, page.getByRole('button', { name: 'I applied', exact: true }));
      await page.getByRole('heading', { name: 'Application status' }).waitFor();
      assert.deepEqual(state.writes, [{ path: '/api/career-hunter/jobs/7/status', body: { status: 'applied' } }], 'one write, on the job\'s own route');
      assert.match(await page.locator('#message').innerText(), /^Applied to Example Co, [A-Z][a-z]+ \d{1,2}\.$/);
      assert.equal(await page.locator('#message').isVisible(), true, 'the line is on screen');
      const sent = (await page.locator('#sentLine').innerText()).replace(/\s+/g, ' ');
      assert.match(sent, /^Applied · November 10 You marked this as applied yourself\. Career has no confirmation that it was sent\./, '02:00 UTC on the 11th is the evening of the 10th in Pacific time: the stored time is read as UTC, not as local time');
      assert.equal(new URL(page.url()).searchParams.get('view'), 'status', 'the address is on the Applications side now');
      assert.equal(await page.getByRole('button', { name: 'I applied' }).count(), 0);
      await press(size, page.getByText('Pressed I applied by mistake?'));
      assert.equal(await page.getByRole('button', { name: 'Return to preparation', exact: true }).isVisible(), true, 'and it can be taken back');
    } finally { await context.close(); }
  });
}

test('a job that came from Career\'s picks is recorded through the route Mark applied manually called, and only that one', async () => {
  const state = { job: ready(), computer: false, records: [{ posting_id: 7, status: 'approval_required', ticket_id: 't-7' }, { posting_id: 8, status: 'approval_required' }], writes: [] };
  const { page, context } = await open(state, DESKTOP);
  try {
    await toSend(page, DESKTOP);
    await page.getByRole('button', { name: 'I applied', exact: true }).click();
    await page.getByRole('heading', { name: 'Application status' }).waitFor();
    assert.deepEqual(state.writes, [{ path: '/api/career-hunter/applications/7/applied', body: {} }], 'the record and its ticket are closed by their own route');
  } finally { await context.close(); }
  const closed = { job: ready(), computer: false, records: [{ posting_id: 7, status: 'denied' }], writes: [] };
  const again = await open(closed, DESKTOP);
  try {
    await toSend(again.page, DESKTOP);
    await again.page.getByRole('button', { name: 'I applied', exact: true }).click();
    await again.page.getByRole('heading', { name: 'Application status' }).waitFor();
    assert.deepEqual(closed.writes, [{ path: '/api/career-hunter/jobs/7/status', body: { status: 'applied' } }], 'a record that was already closed is left alone');
  } finally { await again.context.close(); }
});

test('Download résumé and cover letter starts both files and leaves a link to each', async () => {
  const state = { job: ready(), computer: false, writes: [] };
  const { page, context } = await open(state, DESKTOP);
  try {
    await toSend(page, DESKTOP);
    const started = [];
    page.on('download', (download) => started.push(new URL(download.url()).searchParams.get('kind')));
    await page.getByRole('button', { name: 'Download résumé and cover letter', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('#downloadLinks a').length === 2);
    for (let waited = 0; started.length < 2 && waited < 100; waited++) await page.waitForTimeout(50);
    assert.deepEqual(started.sort(), ['cover', 'resume'], 'two downloads from one press');
    assert.deepEqual(await page.locator('#downloadLinks a').evaluateAll((links) => links.map((a) => [a.textContent, a.getAttribute('href'), a.hasAttribute('download')])),
      [['Résumé (PDF)', '/api/career-hunter/resume?id=7&kind=resume', true], ['Cover letter (PDF)', '/api/career-hunter/resume?id=7&kind=cover', true]]);
  } finally { await context.close(); }
  const one = { job: { ...ready(), has_cover: false }, computer: false, writes: [] };
  const single = await open(one, PHONE);
  try {
    await toSend(single.page, PHONE);
    assert.deepEqual(await single.page.locator('.send-ways > *').allTextContents(), ['Open the employer’s form', 'Download résumé', 'I applied'], 'the button names only what there is to download');
  } finally { await single.context.close(); }
});

for (const [label, size] of [['computer', DESKTOP], ['phone', PHONE]]) {
  test(`${label}: with a computer connected, Send it for me from my computer follows the three and opens the exact approval`, async () => {
    const state = { job: ready(), computer: true, writes: [] };
    const { page, context, calls } = await open(state, size);
    try {
      await toSend(page, size);
      assert.deepEqual(await page.locator('.send-ways > *').allTextContents(), ['Open the employer’s form', 'Download résumé and cover letter', 'I applied'], 'the three by-hand buttons stay first');
      assert.deepEqual(await filled(page), ['Open the employer’s form'], 'still one filled button');
      const computer = page.locator('#sendComputer').getByRole('button', { name: 'Send it for me from my computer', exact: true });
      assert.ok((await computer.boundingBox()).y > (await page.getByRole('button', { name: 'I applied', exact: true }).boundingBox()).y, 'it comes after them');
      assert.equal(await page.locator('#sendComputer .computer-how > summary').innerText(), 'How to set up your computer');
      await press(size, computer);
      await page.getByRole('heading', { name: 'Approve this application' }).waitFor();
      await page.getByRole('button', { name: 'Approve & submit', exact: true }).waitFor();
      assert.ok(!calls.some((c) => c.method === 'POST' && c.path.startsWith('/api/career-hunter/submission-queue')), 'opening the approval approves nothing');
      await press(size, page.getByRole('button', { name: '← Other ways to send', exact: true }));
      await page.getByRole('button', { name: 'I applied', exact: true }).waitFor();
    } finally { await context.close(); }
  });
}

test('when the computer cannot be checked, or the visit is a guest\'s, the page says so and offers no button that would be refused', async () => {
  const unread = { job: ready(), computer: null, writes: [] };
  const first = await open(unread, PHONE);
  try {
    await toSend(first.page, PHONE);
    assert.equal(await first.page.locator('#computerNeeded').innerText(), 'Career could not check for a connected computer just now. You can apply yourself with the buttons above.');
    assert.equal(await first.page.getByRole('button', { name: 'Send it for me from my computer' }).count(), 0);
    assert.equal(await first.page.getByRole('button', { name: 'I applied', exact: true }).isEnabled(), true);
  } finally { await first.context.close(); }
  const guest = { job: ready(), computer: false, guest: true, writes: [] };
  const second = await open(guest, DESKTOP);
  try {
    await toSend(second.page, DESKTOP);
    await second.page.locator('.computer-how > summary').click();
    await second.page.getByText('A guest visit cannot connect a computer.').waitFor();
    assert.equal(await second.page.getByRole('button', { name: 'Connect a computer' }).count(), 0);
  } finally { await second.context.close(); }
});

test('after a send from the computer did not go through, applying yourself is one press away and no button is left that its route would refuse', async () => {
  const intent = { id: 'ab000000-0000-0000-0000-000000000001', postingId: 7, status: 'failed', reason: 'The employer changed its form.', authorizationExpiresAt: '2026-11-12T00:00:00.000Z' };
  const state = { job: { ...ready(), application: { ...ready().application, intent } }, computer: false, writes: [] };
  const { page, context } = await open(state, PHONE);
  try {
    await page.getByRole('heading', { name: 'Submission needs attention' }).waitFor();
    assert.equal(await page.locator('#applicationState').innerText(), 'Did not go through', 'the header reads in the words Applications uses');
    await page.getByRole('button', { name: 'Apply yourself instead', exact: true }).tap();
    await page.getByRole('heading', { name: 'Send your application' }).waitFor();
    await page.getByRole('button', { name: 'I applied', exact: true }).tap();
    await page.getByRole('heading', { name: 'Application status' }).waitFor();
    assert.deepEqual(state.writes, [{ path: '/api/career-hunter/jobs/7/status', body: { status: 'applied' } },
      { path: '/api/career-hunter/submission-queue/ab000000-0000-0000-0000-000000000001/cancel', body: {} }],
      'the attempt that did not go through is closed, so the activity page stops showing it as one that needs the person');
    assert.match(await page.locator('#sentLine').innerText(), /You marked this as applied yourself/);
    assert.equal(await page.getByText('Pressed I applied by mistake?').count(), 0, 'the correction route refuses a job with a submission record, so it is not offered');
  } finally { await context.close(); }
});

test('a job with no posting address says so, offers no link that goes nowhere, and can still be applied to', async () => {
  const state = { job: { ...ready(), url: '' }, computer: false, writes: [] };
  const { page, context } = await open(state, PHONE);
  try {
    await toSend(page, PHONE);
    assert.match(await page.locator('.send-lead').innerText(), /^Career has no address for this employer’s form\./);
    assert.deepEqual(await page.locator('.send-ways > *').allTextContents(), ['Download résumé and cover letter', 'I applied']);
    assert.deepEqual(await filled(page), ['Download résumé and cover letter'], 'the next thing to do is the filled one');
  } finally { await context.close(); }
});

/** Every link on the page that a browser would not treat as a web address: none may exist. */
const otherSchemes = (page) => page.locator('a[href]').evaluateAll((links) => links.filter((a) => !['http:', 'https:'].includes(a.protocol)).map((a) => a.getAttribute('href')));
const UNKNOWN = { id: 'ab000000-0000-0000-0000-000000000002', postingId: 7, status: 'unknown', authorizationExpiresAt: '2026-11-12T00:00:00.000Z' };

for (const address of ['javascript:alert(1)', 'data:text/html,x', 'java\tscript:alert(1)']) {
  test(`an employer address that is not a web address (${JSON.stringify(address)}) is never a link, and the page reads as it does for a job with none`, async () => {
    const state = { job: { ...ready(), url: address }, computer: false, writes: [] };
    const { page, context } = await open(state, DESKTOP);
    try {
      await page.getByRole('heading', { name: 'Review the documents for this job' }).waitFor();
      assert.equal(await page.locator('a:has-text("Employer posting")').count(), 0, 'no posting link under the job description');
      await toSend(page, DESKTOP);
      assert.equal(await page.locator('#employerForm').count(), 0, 'no Open the employer\'s form');
      assert.match(await page.locator('.send-lead').innerText(), /^Career has no address for this employer’s form\./);
      assert.deepEqual(await page.locator('.send-ways > *').allTextContents(), ['Download résumé and cover letter', 'I applied']);
      assert.deepEqual(await filled(page), ['Download résumé and cover letter'], 'the next thing to do is the filled one');
      assert.deepEqual(await otherSchemes(page), [], 'nothing on the page links to a script or to data');
    } finally { await context.close(); }
    const held = { job: { ...ready(), url: address, application: { ...ready().application, intent: UNKNOWN } }, computer: false, writes: [] };
    const second = await open(held, PHONE);
    try {
      await second.page.getByRole('heading', { name: 'Check the submission outcome' }).waitFor();
      assert.equal(await second.page.locator('a:has-text("Check employer application history")').count(), 0);
      assert.equal(await second.page.getByRole('button', { name: 'Check for retained confirmation', exact: true }).isVisible(), true, 'the rest of that page is there');
      assert.deepEqual(await otherSchemes(second.page), []);
    } finally { await second.context.close(); }
  });
}

test('a web address, http or https, is the employer link in all three places', async () => {
  for (const address of ['http://jobs.example.com/apply/7', 'https://jobs.example.com/apply/7?source=career&ref=a%20b']) {
    const state = { job: { ...ready(), url: address }, computer: false, writes: [] };
    const { page, context } = await open(state, DESKTOP);
    try {
      await page.getByRole('heading', { name: 'Review the documents for this job' }).waitFor();
      assert.equal(await page.locator('a:has-text("Employer posting")').getAttribute('href'), address);
      await toSend(page, DESKTOP);
      assert.equal(await page.locator('#employerForm').getAttribute('href'), address);
      assert.deepEqual(await filled(page), ['Open the employer’s form']);
    } finally { await context.close(); }
    const held = { job: { ...ready(), url: address, application: { ...ready().application, intent: UNKNOWN } }, computer: false, writes: [] };
    const second = await open(held, DESKTOP);
    try {
      await second.page.getByRole('heading', { name: 'Check the submission outcome' }).waitFor();
      assert.equal(await second.page.locator('a:has-text("Check employer application history")').getAttribute('href'), address);
    } finally { await second.context.close(); }
  }
});

for (const [status, stage, size] of [['applied', 'Applied', DESKTOP], ['interview', 'Interviewing', PHONE], ['offer', 'Offer', DESKTOP], ['rejected', 'Closed', PHONE]]) {
  test(`I applied on a page that stood open while the job moved to ${stage} writes nothing, says where the job is, and shows its application`, async () => {
    const state = { job: ready(), computer: false, records: [{ posting_id: 7, status: 'approval_required', ticket_id: 't-7' }], writes: [] };
    const { page, context } = await open(state, size);
    try {
      await toSend(page, size);
      // Another tab, or a reply Career read, moved the job on after this page drew its buttons.
      Object.assign(state.job, { status, application_source: 'manual-mark', applied_at: '2026-11-09 18:00:00' });
      await press(size, page.getByRole('button', { name: 'I applied', exact: true }));
      await page.getByRole('heading', { name: 'Application status' }).waitFor();
      assert.deepEqual(state.writes, [], 'nothing is written, on either route: the job is not moved back to Applied');
      assert.equal(state.job.status, status);
      assert.equal(await page.locator('#message').innerText(), `This job is already in ${stage}.`);
      assert.equal(await page.locator('#message').isVisible(), true, 'the line is on screen');
      assert.equal(new URL(page.url()).searchParams.get('view'), 'status', 'the address is on the Applications side');
      assert.equal(await page.getByRole('button', { name: 'I applied' }).count(), 0);
    } finally { await context.close(); }
  });
}

test('an application page reads Sent only for what a computer reported or a confirmation Career holds, and Applied for the rest', async () => {
  const applied = (extra) => ({ ...ready(), status: 'applied', applied_at: '2026-11-11 02:00:00', ...extra });
  const sent = { id: 'ab000000-0000-0000-0000-000000000003', postingId: 7, status: 'submitted' };
  for (const [name, job, first, second] of [
    ['its computer reported it', applied({ application_source: 'worker-reported' }), 'Sent · November 10', 'Your computer reported it sent. The employer has not confirmed receipt.'],
    ['Career holds the confirmation page', applied({ application_source: 'verified-submission', confirmation_path: '/private/c.png' }), 'Sent · November 10', 'Career kept a copy of the confirmation page. That does not mean the employer has accepted it.'],
    ['its submission record says submitted', applied({ application: { ...ready().application, intent: sent } }), 'Sent · November 10', 'Career kept the employer’s confirmation.'],
    ['the person marked it', applied({ application_source: 'manual-mark' }), 'Applied · November 10', 'You marked this as applied yourself. Career has no confirmation that it was sent.'],
    ['nothing records how it was sent', applied({ applied_at: null }), 'Applied', 'Career has no record of how this was sent.'],
  ]) {
    const { page, context } = await open({ job, computer: false, writes: [] }, DESKTOP);
    try {
      await page.getByRole('heading', { name: 'Application status' }).waitFor();
      assert.deepEqual([await page.locator('#sentLine b').innerText(), await page.locator('#sentLine p').first().innerText()], [first, second], name);
    } finally { await context.close(); }
  }
});

test('a link to ?step=review opens the ways to send, not an approval that needs a computer', async () => {
  const state = { job: ready(), computer: false, writes: [] };
  const { page, context } = await openScreen(browser, 'career-application.html', application(state), at(DESKTOP), '?view=queue&application=7&step=review');
  try {
    await page.getByRole('button', { name: 'I applied', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Approve this application' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Connect submission browser' }).count(), 0);
  } finally { await context.close(); }
});

test('the line a press on another page left is read once on the application page it opened', async () => {
  const state = { job: ready(), computer: false, writes: [] };
  const opened = await open(state, DESKTOP);
  try {
    await opened.page.getByRole('heading', { name: 'Review the documents for this job' }).waitFor();
    assert.equal((await opened.page.locator('#message').innerText()).trim(), '', 'nothing is said when nothing moved');
    await opened.page.evaluate(() => window.CareerJobActions.announce('Getting ready: Office Manager at Example Co.'));
    await opened.page.reload();
    await opened.page.getByText('Getting ready: Office Manager at Example Co.').waitFor();
    await opened.page.reload();
    await opened.page.getByRole('heading', { name: 'Review the documents for this job' }).waitFor();
    assert.equal((await opened.page.locator('#message').innerText()).trim(), '', 'and only once');
  } finally { await opened.context.close(); }
});

for(const [label,size] of [['computer',DESKTOP],['phone',PHONE]])for(const hasResume of [true,false])test('G14: '+label+' application '+(hasResume?'Tailor':'empty state')+' uses main résumé and keeps its stored identity',async()=>{
  const state={job:{...ready(),has_resume:false,has_cover:false,application:{needsGeneration:true,draft:{revision:1,guidance:'',experienceIds:[]}}},hasResume,writes:[]};
  const {page,context,calls}=await open(state,size);
  try{
    await page.locator('#application[aria-busy="false"]').waitFor();
    const text=await page.locator('main').innerText();assert.match(text,/your main résumé/);assert.doesNotMatch(text,/core résumé/i);
    if(!hasResume)assert.match(text,/The selected job stays in My jobs\./);
    const link=page.getByRole('link',{name:hasResume?'Open main résumé':'Add main résumé',exact:true});assert.equal(await link.count(),1);
    assert.equal(await link.getAttribute('href'),'/api/career-hunter/resume-studio?id=master');
    assert.equal(calls.some(c=>['POST','PATCH','DELETE'].includes(c.method)),false);
  }finally{await context.close();}
});
test('G14: Other experience uses the same main résumé wording in its actual intro and menu',async()=>{
  const {page,context,calls}=await openScreen(browser,'career-experience-bank.html',application({job:ready(),writes:[]}),PHONE);
  try{
    await page.waitForFunction(()=>document.querySelector('#notice').textContent==='');
    assert.match(await page.locator('.intro').innerText(),/outside your main résumé/);
    await page.getByRole('button',{name:'More',exact:true}).click();
    assert.equal(await page.getByRole('menuitem',{name:'Main résumé & résumé bank',exact:true}).isVisible(),true);
    assert.equal(calls.some(c=>['POST','PATCH','DELETE'].includes(c.method)),false);
  }finally{await context.close();}
});

test('a stop without employer questions shows the reason and offers review or manual application', async () => {
  const state = { job: ready(), computer: true, writes: [] };
  state.job.application.intent = { id: 'ab000000-0000-0000-0000-000000000001', status: 'needs_you', questions: [], reason: 'The form sends applicant data to another site. Review its destination first.' };
  const { page, context } = await open(state, DESKTOP);
  try {
    await page.locator('#application h2').waitFor();
    assert.match(await page.locator('#application').innerText(), /The form sends applicant data to another site/);
    assert.equal(await page.getByRole('button', { name: 'Save answers & review application' }).count(), 0);
    await page.getByRole('button', { name: 'Review application again', exact: true }).click();
    await page.getByRole('heading', { name: 'Approve this application' }).waitFor();
    assert.equal(state.writes.length, 0, 'reviewing is not an approval');
    await page.reload();
    await page.getByRole('button', { name: 'Apply yourself instead' }).click();
    await page.getByRole('heading', { name: 'Send your application' }).waitFor();
    await page.getByRole('button', { name: 'I applied', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('sentLine'));
    assert.equal(state.job.application_source, 'manual-mark');
  } finally { await context.close(); }
});

for (const outcome of ['sent','not_sent']) test(`an unknown outcome shows the kept picture and records ${outcome} without sending`, async () => {
  const state = { job: ready(), computer: true, writes: [] };
  state.job.application.intent = { id: 'ab000000-0000-0000-0000-000000000002', status: 'unknown', reason: 'The final outcome is uncertain.', outcomeFile: 'fixture-outcome.png' };
  const { page, context } = await open(state, DESKTOP);
  try {
    await page.getByRole('heading', { name: 'Check the submission outcome' }).waitFor();
    assert.equal(await page.getByRole('img', {name:'Last browser picture from this attempt'}).count(),1);
    assert.equal(await page.getByRole('button', { name: 'Approve & submit', exact: true }).count(),0);
    await page.getByRole('button', { name: outcome==='sent'?'It was sent':'It was not sent', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-action="resolve-sent"]'));
    assert.deepEqual(state.writes,[{path:'/api/career-hunter/submission-queue/ab000000-0000-0000-0000-000000000002/resolve',body:{outcome}}]);
    if(outcome==='sent')assert.equal(state.job.application_source,'manual-mark');
    else assert.equal(await page.getByRole('button', {name:'Approve & submit',exact:true}).count(),0,'fresh review is required');
  } finally { await context.close(); }
});

test('approval names four buttons and the approved employer site before any write',async()=>{
  const state={job:ready(),computer:true,writes:[]},f=await open(state,DESKTOP);
  try{
    await toSend(f.page,DESKTOP);await f.page.getByRole('button',{name:'Send it for me from my computer'}).click();
    await f.page.getByRole('heading',{name:'Approve this application'}).waitFor();
    assert.match(await f.page.locator('#application').innerText(),/This form can have more than one step; Career will press up to 4 buttons on jobs.example.com\./);
    assert.match(await f.page.locator('#application').innerText(),/never the same step twice/);assert.deepEqual(state.writes,[]);
  }finally{await f.context.close();}
});
for(const status of ['unknown','submitted'])test(`job ${status} page shows every press with its picture or missing-picture words`,async()=>{
  const state={job:ready(),computer:true,writes:[]};if(status==='submitted')state.job.status='applied';
  state.job.application.intent={id:'press-proof',status,pressesAllowed:4,presses:[
    {step:1,kind:'open',label:'Apply',origin:'https://jobs.example.com',allowedAt:1794549600000,result:'advanced'},
    {step:2,kind:'continue',label:'Continue',origin:'https://jobs.example.com',allowedAt:1794549601000}],pressPictures:[{step:1,file:'kept.png'}]};
  const f=await open(state,DESKTOP);
  try{
    await f.page.locator('#application h2').first().waitFor();
    const text=await f.page.locator('#application').innerText();assert.match(text,/Step 1 of up to 4/);assert.match(text,/Career pressed “Apply” on jobs.example.com/);
    assert.match(text,/The application form opened/);assert.match(text,/did not report back/);assert.match(text,/No picture was kept for this step/);
    assert.equal(await f.page.locator('img[src$="/press-proof/press-picture/1"]').count(),1);assert.deepEqual(state.writes,[]);
  }finally{await f.context.close();}
});
