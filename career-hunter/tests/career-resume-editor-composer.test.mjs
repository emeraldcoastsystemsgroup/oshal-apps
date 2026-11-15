/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.65.1 (Roger, from his phone, 2026-11-14: "in edit and then concierge the screen is putting the text box at the top above the thread"). The shipped tools/career-resume-studio.html with the shipped page frame, in Chromium over a made-up person's fixture at the page's real address, at 412x915 and at 1440x900. The résumé editor's conversation reads as every chat does: the text box and Send are under the thread's newest message, never above the thread; on a phone the sheet begins under Career's bars with its heading in sight, Close the editor is in that heading and not between the thread and the text box, and nothing is behind Career's bottom bar; after Send, when the reply arrives, when a reply arrived while the sheet was closed, and when the window gets shorter (a keyboard that resizes it) the newest message is in view and the text box is still above the bottom bar, while a person who scrolled up to read is left there; on a desktop the thread scrolls inside the editor's column, so the text box stays at its foot and the page itself does not scroll.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const ADDRESS = '/api/career-hunter/resume-studio';
/** The pages a made-up job seeker is admitted to, as the kernel's profile answer lists them. */
const ribbon = [['home', 'Home', 'home'], ['search', 'Find jobs', 'search-ui'], ['board', 'My jobs', 'board-native'], ['resume-studio', 'My résumé', 'resume-studio'],
  ['work-history', 'Work history', 'work-history'], ['experience-library', 'Other experience', 'experience-library'], ['strengthen', 'Improve my résumé', 'strengthen-ui']]
  .map(([id, label, view]) => ({ id: 'tool-career-' + id, label, section: 'top', toolUi: { iframeUrl: '/api/career-hunter/' + view, visibilityToolName: 'career-' + id } }));
/** A made-up tailored résumé: a job's own résumé always opens in the page's own preview and editor. */
const tailored = { resume: { headline: 'Warehouse supervisor', summary: 'Made-up summary for a made-up person.',
  experience: [{ title: 'Shift lead', org: 'Example Freight Co', span: '2020-2024', bullets: ['Led a made-up team of six', 'Kept the made-up dock on time'] }] },
  cover: {}, meta: { title: 'Warehouse Supervisor', company: 'Sample Logistics', name: 'Olive Testperson' } };
const reply = (n) => `Made-up reply ${n}. ` + 'I put the shift-lead work first and left the other lines in their order. '.repeat(3) + `End of reply ${n}.`;

function career({ method, url }) {
  const path = url.pathname;
  if (path === '/api/ui/profile') return { json: { profile: { ribbon: { items: ribbon } } } };
  if (path === '/api/auth/user') return { json: { displayName: 'Olive' } };
  if (path === '/api/career-hunter/jobs/stats') return { json: { saved: 1 } };
  if (path === '/api/career-hunter/jobs') return { json: { jobs: [{ id: 7, title: 'Warehouse Supervisor', company: 'Sample Logistics', has_resume: true }] } };
  if (path === '/api/career-hunter/resume/doc') return { json: tailored };
  if (path === '/api/career-hunter/resume/state') return { json: { hasResume: true, indexing: false, ingest: { state: 'none' } } };
  if (path === '/api/career-hunter/resume/guide' && method === 'POST') return { json: { reply: 'unused: each case answers this route itself', actions: [] } };
  return null;
}

/** Open the page at its real address with the frame drawn, and answer the editor's route only when the case says so. */
async function open(size) {
  const { page, context } = await openScreen(browser, 'career-resume-studio.html', career, size, '?id=7', ADDRESS);
  const errors = [], held = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/api/career-hunter/resume/guide', (route) => { held.push(route); });
  await page.locator('.sheet h1').waitFor();
  await page.locator('.cf-topbar[data-cf-ready]').waitFor();
  let turn = 0;
  /** Type a request and press Send; the person's own message is then the thread's newest. */
  const say = async () => {
    turn += 1;
    const text = `Made-up request ${turn}: put my shift-lead work first`;
    await page.locator('#msg').fill(text);
    await page.locator('#send').click();
    await page.locator('#log .msg.you', { hasText: text }).waitFor({ state: 'attached' });
    return turn;
  };
  /** Let the held reply through; it is then the thread's newest. */
  const answer = async (n, state = 'visible') => {
    assert.equal(held.length, 1, 'one request is waiting for its reply');
    await held.shift().fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: reply(n), actions: [] }) });
    await page.locator('#log .msg.bot', { hasText: `End of reply ${n}.` }).waitFor({ state });
  };
  return { page, context, errors, say, answer };
}

/** Let the page finish a change of window height (two frames), as it has long before a person can touch it again. */
const settled = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

/** Where everything is, in window pixels, and what a tap at the middle of each control reaches. */
function measure(page) {
  return page.evaluate(() => {
    const box = (selector) => {
      const node = document.querySelector(selector);
      if (!node || getComputedStyle(node).display === 'none' || !node.getClientRects().length) return null;
      const r = node.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
    };
    const reached = (selector) => {
      const node = document.querySelector(selector), r = node.getBoundingClientRect();
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return Boolean(hit && node.contains(hit));
    };
    const log = document.querySelector('#log'), messages = [...log.querySelectorAll('.msg')], last = messages[messages.length - 1].getBoundingClientRect();
    return { window: { width: innerWidth, height: innerHeight }, pageScrolled: Math.round(document.scrollingElement.scrollTop), pageHeight: document.scrollingElement.scrollHeight,
      bars: box('.cf-subnav') || box('.cf-topbar'), nav: box('.cf-bottombar'), sheet: box('.chat'), heading: box('.chat header'), close: box('#aiClose'), bar: box('#aiBar'),
      thread: box('#log'), composer: box('.composer'), text: box('#msg'), send: box('#send'),
      newest: { top: Math.round(last.top), bottom: Math.round(last.bottom), words: messages[messages.length - 1].textContent.slice(0, 40) },
      threadScrolls: log.scrollHeight > log.clientHeight + 1, threadRoom: log.clientHeight - parseFloat(getComputedStyle(log).paddingTop) - parseFloat(getComputedStyle(log).paddingBottom), sendReached: reached('#send'), textReached: reached('#msg'),
      closeReached: document.querySelector('#aiClose') && box('#aiClose') ? reached('#aiClose') : null };
  });
}

/** The conversation's order, top to bottom: the thread, its newest message in view, then the text box and Send. */
function conversationReads(m, when) {
  const seen = `${when}: ${JSON.stringify(m)}`;
  assert.ok(m.composer.top >= m.thread.bottom - 1, `the text box is under the thread, ${seen}`);
  assert.ok(m.composer.top >= m.newest.bottom - 1, `the text box is under the newest message, ${seen}`);
  assert.ok(m.newest.bottom <= m.thread.bottom + 1 && m.newest.bottom > m.thread.top, `the end of the newest message is in view in the thread, ${seen}`);
  if (m.newest.bottom - m.newest.top <= m.threadRoom) assert.ok(m.newest.top >= m.thread.top - 1, `a newest message that fits the thread's box is in view whole, ${seen}`);
  assert.ok(m.text.top >= m.composer.top && m.send.top >= m.composer.top && m.send.bottom <= m.composer.bottom, `Send sits beside the text box, ${seen}`);
  assert.ok(m.composer.bottom <= m.window.height, `the text box is inside the window, ${seen}`);
  assert.equal(m.sendReached && m.textReached, true, `nothing covers the text box or Send, ${seen}`);
  assert.equal(m.pageScrolled, 0, `the thread scrolls, not the page, ${seen}`);
}

/** A phone: the sheet between Career's bars, Close the editor in its heading, nothing behind the bottom bar. */
function phoneSheetReads(m, when) {
  const seen = `${when}: ${JSON.stringify(m)}`;
  conversationReads(m, when);
  assert.ok(m.nav, `Career's bottom bar is drawn, ${seen}`);
  assert.ok(m.sheet.top >= m.bars.bottom - 1, `the sheet begins under Career's bars, so its heading is in sight, ${seen}`);
  assert.ok(m.close, `Close the editor is shown, ${seen}`);
  assert.ok(m.close.top >= m.heading.top && m.close.bottom <= m.heading.bottom && m.close.bottom <= m.thread.top + 1, `Close the editor is in the heading, above the thread, ${seen}`);
  assert.equal(m.closeReached, true, `nothing covers Close the editor, ${seen}`);
  assert.equal(m.bar, null, `the Edit with AI bar is away while the sheet is open, so nothing sits between the text box and the bottom bar, ${seen}`);
  for (const part of ['sheet', 'thread', 'composer', 'text', 'send', 'close']) assert.ok(m[part].bottom <= m.nav.top + 1, `${part} is not behind Career's bottom bar, ${seen}`);
  assert.ok(m.nav.top - m.composer.bottom <= 2, `the text box rests on Career's bottom bar, ${seen}`);
  for (const part of ['sheet', 'composer', 'send', 'close']) assert.ok(m[part].left >= 0 && m[part].right <= m.window.width, `${part} is inside the window's width, ${seen}`);
}

test('phone: the editor\'s text box is under the thread, Close the editor is in the heading, and each new message is in view', async () => {
  const { page, context, errors, say, answer } = await open(PHONE);
  try {
    assert.deepEqual(await page.locator('.cf-subnav a').allInnerTexts(), ['My résumé', 'Work history', 'Other experience', 'Improve it']);
    assert.deepEqual(await page.locator('.cf-bottombar span').allInnerTexts(), ['Home', 'Find jobs', 'My jobs', 'Applications', 'More']);
    const opener = page.getByRole('button', { name: 'Edit with AI' });
    assert.equal(await page.locator('.chat').isVisible(), false, 'the editor is a sheet, closed until asked for');
    const closed = await measure(page);
    assert.ok(closed.bar && closed.bar.bottom <= closed.nav.top + 1, `Edit with AI rests on Career's bottom bar: ${JSON.stringify(closed)}`);
    await opener.tap();
    await page.locator('#send').waitFor();
    assert.equal(await page.locator('#msg').getAttribute('placeholder'), 'e.g. put my team-lead work first; shorten the second bullet');
    phoneSheetReads(await measure(page), 'when the sheet opens');
    for (let n = 1; n <= 3; n++) {
      assert.equal(await say(), n);
      phoneSheetReads(await measure(page), `after Send ${n}`);
      assert.match((await measure(page)).newest.words, new RegExp(`^Made-up request ${n}:`), 'the person\'s own message is the newest');
      await answer(n);
      const after = await measure(page);
      phoneSheetReads(after, `after reply ${n}`);
      assert.match(after.newest.words, new RegExp(`^Made-up reply ${n}\\.`), 'the reply is the newest');
    }
    assert.equal((await measure(page)).threadScrolls, true, 'the thread is longer than its box, so the newest message was scrolled to');
    // A person reading earlier messages is brought to the newest by the next one.
    await page.locator('#log').evaluate((log) => { log.scrollTop = 0; });
    await say(); await answer(4);
    phoneSheetReads(await measure(page), 'after a reply that came while reading earlier messages');
    // Close the editor returns to the résumé; Edit with AI opens the sheet again.
    await page.getByRole('button', { name: 'Close the editor' }).tap();
    assert.equal(await page.locator('.chat').isVisible(), false);
    assert.equal(await opener.isVisible(), true);
    assert.equal(await opener.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.sheet h1').isVisible(), true, 'the résumé is in sight again');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('phone: a reply that came while the sheet was closed is in view when it opens, and a shorter window keeps the text box and the newest message', async () => {
  const { page, context, errors, say, answer } = await open(PHONE);
  try {
    await page.getByRole('button', { name: 'Edit with AI' }).tap();
    await page.locator('#send').waitFor();
    for (let n = 1; n <= 2; n++) { await say(); await answer(n); }
    await say();
    // The person scrolls up to read, closes the sheet, and the reply comes while it is closed.
    await page.locator('#log').evaluate((log) => new Promise((done) => { log.addEventListener('scroll', () => done(), { once: true }); log.scrollTop = 0; }));
    await settled(page);
    await page.getByRole('button', { name: 'Close the editor' }).tap();
    await answer(3, 'attached');
    await page.getByRole('button', { name: 'Edit with AI' }).tap();
    await page.locator('#send').waitFor();
    const reopened = await measure(page);
    phoneSheetReads(reopened, 'opened again after a reply came while it was closed');
    assert.match(reopened.newest.words, /^Made-up reply 3\./);
    // An on-screen keyboard that resizes the window: no height is fixed, so the sheet follows it.
    await page.setViewportSize({ width: 412, height: 520 });
    await page.waitForFunction(() => { const log = document.querySelector('#log'), last = [...log.querySelectorAll('.msg')].pop(); return innerHeight === 520 && last.getBoundingClientRect().bottom <= log.getBoundingClientRect().bottom + 1; });
    const shorter = await measure(page);
    phoneSheetReads(shorter, 'in a window 520 px tall');
    assert.match(shorter.newest.words, /^Made-up reply 3\./);
    await page.setViewportSize({ width: 412, height: 915 });
    await page.waitForFunction(() => innerHeight === 915);
    await settled(page);
    phoneSheetReads(await measure(page), 'back at 915 px tall');
    // A person who has scrolled up to read is left where they are when the window changes height.
    await page.locator('#log').evaluate((log) => new Promise((done) => { log.addEventListener('scroll', () => done(), { once: true }); log.scrollTop = 0; }));
    await page.setViewportSize({ width: 412, height: 520 });
    await page.waitForFunction(() => innerHeight === 520);
    await settled(page);
    assert.equal(await page.locator('#log').evaluate((log) => log.scrollTop), 0, 'the thread stays where the person was reading');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('desktop: the text box is at the foot of the editor\'s column, under a thread that scrolls there', async () => {
  const { page, context, errors, say, answer } = await open(DESKTOP);
  try {
    assert.equal(await page.locator('.chat').isVisible(), true);
    assert.equal((await page.locator('.chat header').innerText()).replace(/\s+/g, ' ').trim(), 'Résumé editor · tell it what to change');
    for (const [what, selector] of [['Close the editor', '#aiClose'], ['the Edit with AI bar', '#aiBar']]) assert.equal(await page.locator(selector).isVisible(), false, `${what} is a phone's control`);
    conversationReads(await measure(page), 'when the page opens');
    for (let n = 1; n <= 4; n++) {
      await say();
      conversationReads(await measure(page), `after Send ${n}`);
      await answer(n);
      const after = await measure(page);
      conversationReads(after, `after reply ${n}`);
      assert.match(after.newest.words, new RegExp(`^Made-up reply ${n}\\.`));
    }
    const full = await measure(page);
    assert.equal(full.threadScrolls, true, 'the thread is longer than its box');
    assert.ok(full.pageHeight <= full.window.height + 1, `the page is no taller than the window: ${JSON.stringify(full)}`);
    assert.ok(full.heading.top >= full.bars.bottom - 1 && full.heading.bottom <= full.thread.top + 1, `the editor's heading stays over its thread: ${JSON.stringify(full)}`);
    assert.ok(full.window.height - full.composer.bottom <= 1, `the text box is at the foot of the column: ${JSON.stringify(full)}`);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
