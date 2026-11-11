/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The quick-flick check gives each touch its own time: on a loaded machine the touches arrived too slowly to be a flick, and the check failed once in a parallel run.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Both phone swipe decks under real touch input: the Job Board's New matches deck (below) and the Mobile page's deck that queues an application with a right swipe (at the end; before the fix a swipe that began on the card's body, four fifths of the card, was cancelled by the phone and did nothing). The Job Board's phone swipe deck under real touch input (Roger, 2026-11-10: "super wonky on my phone"). Chromium at 412x915 over the shipped page with fixture jobs, touches sent through the browser's own input pipeline: the card stays under the finger, a swipe acts from the title, the reason text and the pay line alike, right saves and left passes, a short drag settles back, a scroll never acts, a quick flick acts, a tap still opens the job, and the held card says Save or Pass. Before the fix the card trailed the finger by 91px at 220px and swipes from the title or the reason text did nothing.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE } from '../helpers/ux-page.mjs';

const jobs = Array.from({ length: 9 }, (_, i) => ({ id: 100 + i, title: 'Senior Program Manager ' + (i + 1), company: 'Acme ' + (i + 1), location: 'Austin, TX', remote: 0,
  ai_fit_score: 80 + i, ai_fit_rationale: 'Strong match on program leadership, cloud delivery and stakeholder management. '.repeat(4), salary_min: 120000, salary_max: 160000,
  salary_currency: 'USD', salary_period: 'year', status: 'new', posted_date: '2026-11-01', board: {} }));
let browser, page, context, calls, cdp;

before(async () => {
  browser = await playwright().chromium.launch();
  const api = ({ method, url }) => {
    if (method === 'POST') return { json: { ok: true } };
    if (url.pathname === '/api/career-hunter/jobs') return { json: { jobs, exclusions: [], exhausted: true } };
    if (/^\/api\/career-hunter\/jobs\/\d+$/.test(url.pathname)) return { json: jobs[0] };
    if (url.pathname === '/api/career-hunter/jobs/stats') return { json: { saved: 0, byStatus: [] } };
    if (url.pathname === '/api/career-hunter/applications') return { json: { applications: [] } };
    return null;
  };
  ({ page, context, calls } = await openScreen(browser, 'career-job-lists.html', api, PHONE, '?view=matches'));
  await page.waitForSelector('.match-card.lead');
  cdp = await context.newCDPSession(page);
});
after(async () => { await browser?.close(); });

const lead = () => page.locator('.match-card.lead h2').innerText();
const cardX = () => page.evaluate(() => Math.round(new DOMMatrix(getComputedStyle(document.querySelector('.match-card.lead')).transform).m41));
const posts = () => calls.filter((call) => call.method === 'POST').map((call) => call.path + ' ' + JSON.stringify(call.body));
const part = async (selector) => { const box = await page.locator('.match-card.lead ' + selector).boundingBox(); return [box.x + 50, box.y + box.height / 2]; };
/** One finger from `from` to `to`; returns what the card did half way and the POSTs the gesture caused. */
async function touch(from, to, { steps = 12, stepMs = 12, hold = false, stamped = false } = {}) {
  const before = posts().length, seen = {};
  // A flick is defined by time. `stamped` gives each touch its own time, 10 ms apart, so a busy machine that delivers
  // the touches slowly still delivers a flick.
  const began = Date.now() / 1000, at = (i) => (stamped ? { timestamp: began + i * 0.010 } : {});
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1] }], ...at(0) });
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + (to[0] - from[0]) * i / steps, y = from[1] + (to[1] - from[1]) * i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }], ...at(i) });
    if (!stamped) await page.waitForTimeout(stepMs);
    if (i === steps) { seen.finger = Math.round(x - from[0]); seen.card = await cardX(); seen.says = await page.locator('.match-card.lead').getAttribute('data-swipe'); }
  }
  if (hold) return seen;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], ...at(steps + 1) });
  seen.since = before;
  return seen;
}
const across = (from, dx, dy = 0) => [from[0] + dx, from[1] + dy];
/** Wait for an outcome, not for a length of time: a loaded machine is slow, never wrong. */
async function until(check, what, on = page) {
  const end = Date.now() + 15000;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) assert.fail('never happened: ' + what);
    await on.waitForTimeout(40);
  }
}
const saved = (id) => () => posts().some((post) => post.startsWith(`/api/career-hunter/jobs/${id}/status {"favorite":true}`));
const leadIs = (n) => async () => (await lead()) === 'Senior Program Manager ' + n;
const atRest = async () => (await cardX()) === 0 && (await page.locator('.match-card.lead.flung, .match-card.lead.dragging').count()) === 0;

test('the card stays under the finger and says what letting go will do', async () => {
  const from = await part('.meta'), held = await touch(from, across(from, 200), { hold: true });
  assert.ok(Math.abs(held.finger - held.card) <= 30, `finger ${held.finger}px, card ${held.card}px`);
  assert.equal(held.says, 'save');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.match-card.lead'), '::before').opacity), '1', 'Save shows on the held card');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await until(atRest, 'a touch the phone takes back settles the card');
  assert.equal(await lead(), 'Senior Program Manager 1', 'and never acts');
  assert.deepEqual(posts(), []);
});

test('a right swipe saves from the pay line, the title and the reason text alike', async () => {
  for (const [selector, id] of [['.meta', 100], ['h2', 101], ['.why', 102]]) {
    const from = await part(selector);
    await touch(from, across(from, 220));
    await until(saved(id), `a swipe from ${selector} saves job ${id}`);
    await until(leadIs(id - 98), 'the next card comes up');
  }
  await until(async () => /^Saved/.test(await page.locator('#actionState').innerText()), 'the page says it saved');
});

test('a left swipe passes, and a swipe that drifts down still counts', async () => {
  const from = across(await part('.meta'), 230), left = await touch(from, across(from, -220));
  await until(() => posts().includes('/api/career-hunter/jobs/103/status {"status":"dismissed"}'), 'a left swipe passes job 103');
  assert.equal(posts().slice(left.since).filter((post) => post.includes('favorite')).length, 0, 'and saves nothing');
  await until(leadIs(5), 'the next card comes up');
  const start = await part('.meta');
  await touch(start, across(start, 200, 70));
  await until(saved(104), 'a swipe that drifts down saves job 104');
  await until(leadIs(6), 'the next card comes up');
});

test('a short drag settles back, a scroll does nothing, and a tap opens the job', async () => {
  const from = await part('.meta'), short = await touch(from, across(from, 55));
  await until(atRest, 'a short drag settles back');
  const scroll = await touch(await part('.why'), across(await part('.why'), 25, -160));
  await until(atRest, 'the card is at rest after a scroll');
  const gets = calls.length, title = await part('h2');
  await page.touchscreen.tap(title[0], title[1]);
  await until(() => calls.slice(gets).some((call) => call.method === 'GET' && /\/api\/career-hunter\/jobs\/105$/.test(call.path)), 'the tap asks for the job');
  assert.deepEqual(posts().slice(short.since), [], 'neither the short drag, the scroll nor the tap saved or passed anything');
  assert.equal(scroll.since, short.since);
  assert.equal(await lead(), 'Senior Program Manager 6', 'and the card is still there');
});

test('a quick flick acts though it is short of the long-drag distance', async () => {
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('dialog[open]')?.close());
  const from = await part('.meta');
  await touch(from, across(from, 60), { steps: 3, stamped: true });
  await until(saved(105), 'a quick flick saves job 105');
});

/* ── The Mobile page's deck: right queues the application, left passes ───────────────────────────── */
const waiting = Array.from({ length: 6 }, (_, i) => ({ posting_id: 200 + i, company: 'Globex ' + (i + 1), title: 'Staff Engineer ' + (i + 1), status: 'approval_required' }));
const detail = (id) => ({ job: { id, title: 'Staff Engineer', company: 'Globex', location: 'Austin, TX', ai_fit_score: 88, ai_fit_rationale: 'Strong match on platform engineering and leadership. '.repeat(40) } });

test('the Mobile deck swipes from its body, still scrolls its body, and settles when the phone takes the touch back', async () => {
  const sent = [];
  const api = ({ method, url, body }) => {
    if (method === 'POST') { sent.push(url.pathname + ' ' + JSON.stringify(body || {})); return { json: { ok: true } }; }
    if (url.pathname === '/api/career-hunter/applications') return { json: { applications: waiting } };
    if (/^\/api\/career-hunter\/jobs\/\d+$/.test(url.pathname)) return { json: detail(Number(url.pathname.split('/').pop())) };
    return { json: {} };
  };
  const opened = await openScreen(browser, 'career-mobile.html', api, PHONE);
  try {
    const mobile = opened.page, wire = await opened.context.newCDPSession(mobile);
    await mobile.waitForSelector('#deck .jobcard');
    await mobile.waitForFunction(() => document.querySelector('#deck').lastElementChild.querySelector('.jc-body').scrollHeight > 600);
    const top = () => mobile.locator('#deck .jobcard').last();
    const name = () => top().locator('h2').innerText();
    const x = () => mobile.evaluate(() => Math.round(new DOMMatrix(getComputedStyle(document.querySelector('#deck').lastElementChild).transform).m41));
    const body = async () => { const box = await top().locator('.jc-body').boundingBox(); return [box.x + 80, box.y + box.height / 2]; };
    const drag = async (from, to, end = 'touchEnd') => {
      await wire.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1] }] });
      for (let i = 1; i <= 12; i++) { await wire.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from[0] + (to[0] - from[0]) * i / 12, y: from[1] + (to[1] - from[1]) * i / 12 }] }); await mobile.waitForTimeout(12); }
      const held = await x();
      await wire.send('Input.dispatchTouchEvent', { type: end, touchPoints: [] });
      return held;
    };
    let from = await body();
    const held = await drag(from, [from[0] + 220, from[1]]);
    assert.ok(held >= 190, `the card follows a swipe that begins on its body (finger 220px, card ${held}px)`);
    const is = (n) => async () => (await name()) === 'Staff Engineer ' + n;
    const resting = async () => (await x()) === 0 && !(await top().evaluate((card) => card.classList.contains('dragging')));
    await until(() => sent.some((post) => post.startsWith('/api/career-hunter/applications/200/approve')), 'a right swipe queues application 200', mobile);
    await until(is(2), 'the next card comes up', mobile);
    from = await body();
    await drag([from[0] + 220, from[1]], from);
    await until(() => sent.some((post) => post.startsWith('/api/career-hunter/applications/201/deny')), 'a left swipe passes application 201', mobile);
    await until(is(3), 'the next card comes up', mobile);
    const before = sent.length;
    from = await body();
    await drag(from, [from[0] + 15, from[1] - 200]);
    await until(async () => (await top().locator('.jc-body').evaluate((el) => el.scrollTop)) > 50, 'the body scrolls up and down', mobile);
    from = await body();
    await drag(from, [from[0] + 220, from[1]], 'touchCancel');
    await until(resting, 'a cancelled touch settles the card', mobile);
    assert.equal(await name(), 'Staff Engineer 3', 'neither the scroll nor the cancelled touch acted');
    assert.equal(sent.length, before);
  } finally { await opened.context.close(); }
});
