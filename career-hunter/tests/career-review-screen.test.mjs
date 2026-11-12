/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Review of 1.55.0, item 9: the first tile is Career's picks and counts the picks My jobs will show (two records wait, one job has since been applied to: 1); with every pick moved on there is no tile.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The scores tile opens New matches.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (Career Review, grade D). The real tools/review.html in Chromium with the platform's handoff and connected-actions modules stubbed at their real paths: when mountConnectedActions renders no action, "Your next brief" is not shown (the dead form the audit found); with one action it is. An account with nothing recorded gets one empty state whose primary Find jobs asks the shell for Search Jobs, with no zero tiles and no "Open the app to begin". With data only tiles holding a value appear (one score window), each opening its Job Board stage, and the system paragraph sits in Help.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openScreen, playwright, PHONE, DESKTOP } from './helpers/ux-page.mjs';

let browser;
before(async () => { browser = await playwright().chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const PARAGRAPH = 'Separates pending application approvals, recently updated personal scores, tracked application records and recorded interviews. No application submission or public post is triggered.';
const metric = (id, label, value) => ({ id, label, value });
const zero = { metrics: [metric('approval-review', 'Career\'s picks', '0'), metric('scored-24h', 'Scores updated / 24h', '0'), metric('scored-5d', 'Scores updated / 5d', '0'), metric('tracked-applications', 'Tracked applications', '0'), metric('interviews-5d', 'Recorded interviews / 5d', '0')],
  items: [{ text: 'No saved work yet. Open the app to begin.' }, { text: PARAGRAPH }] };
const some = { metrics: [metric('approval-review', 'Career\'s picks', '2'), metric('scored-24h', 'Scores updated / 24h', '14'), metric('scored-5d', 'Scores updated / 5d', '40'), metric('tracked-applications', 'Tracked applications', '0'), metric('interviews-5d', 'Recorded interviews / 5d', '1')],
  items: [{ text: 'Platform Engineer', detail: 'Example Co / scored 2026-11-05T10:00:00Z', actions: [{ integration: 'prepare-document', context: { title: 'Platform Engineer', notes: 'x' } }] }, { text: PARAGRAPH }] };

/** Career's application records and each job's status, as /applications and /jobs/:id answer them. Two picks wait; one job has since been applied to. */
const picksLeft = { records: [{ posting_id: 1, status: 'approval_required' }, { posting_id: 2, status: 'approval_required' }], status: { 2: 'applied' } };
/** The platform modules review.html imports, at their real paths; `actions` is how many buttons the mount renders. */
function platform(summary, actions) {
  return ({ url }) => {
    if (url.pathname === '/cockpit/js/app-handoff.js') return { text: 'export function receiveHandoff(){}' };
    if (url.pathname === '/cockpit/js/app-workflows.js') return { text: `export async function mountConnectedActions({element}){for(let i=0;i<${actions};i++){const b=document.createElement('button');b.textContent='Open in Office';element.append(b);}}` };
    if (url.pathname === '/api/career-hunter/home-summary') return { json: summary };
    if (url.pathname === '/api/career-hunter/applications') return { json: { applications: picksLeft.records } };
    const one = url.pathname.match(/^\/api\/career-hunter\/jobs\/(\d+)$/);
    if (one) return { json: { job: { id: Number(one[1]), title: 'Job ' + one[1], status: picksLeft.status[one[1]] ?? 'new' } } };
    return null;
  };
}

for (const [name, size] of [['phone', PHONE], ['desktop', DESKTOP]]) {
  test(`${name}: an empty account is one empty state whose Find jobs opens Search Jobs`, async () => {
    const { page, context } = await openScreen(browser, 'review.html', platform(zero, 0), size);
    try {
      await page.getByRole('heading', { name: 'No career activity yet' }).waitFor();
      assert.equal(await page.locator('#briefPanel').isVisible(), false, 'no dead brief form');
      assert.equal(await page.locator('.metric').count(), 0, 'no zero tiles');
      assert.doesNotMatch(await page.locator('main').innerText(), /Open the app to begin/);
      assert.deepEqual(await page.locator('.ck-primary:visible').allInnerTexts(), ['Find jobs']);
      assert.equal(await page.locator('h1').count(), 0, 'the shell names the screen');
      assert.equal(await page.getByRole('link', { name: 'Find jobs' }).getAttribute('data-career-tool'), 'career-search');
    } finally { await context.close(); }
  });
}

test('with data: only valued tiles, one score window, each a link to its stage; the paragraph is in Help', async () => {
  const { page, context } = await openScreen(browser, 'review.html', platform(some, 0), DESKTOP);
  try {
    await page.locator('a.metric').first().waitFor();
    const tiles = await page.locator('.metric').evaluateAll((els) => els.map((el) => [el.textContent, el.getAttribute('href')]));
    assert.deepEqual(tiles, [
      ['1Career\'s picks', '/api/career-hunter/board-native?view=approve'],
      ['14Scores updated today', '/api/career-hunter/board-native?view=matches'],
      ['1Recorded interviews / 5d', '/api/career-hunter/board-native?view=interviewing'],
    ]);
    assert.equal(await page.getByText(PARAGRAPH).isVisible(), false, 'the system paragraph waits in Help');
    await page.locator('details.help > summary').click();
    assert.equal(await page.getByText(PARAGRAPH).isVisible(), true);
    assert.equal(await page.locator('#briefPanel').isVisible(), false);
    assert.equal(await page.getByRole('button', { name: 'Use this evidence' }).count(), 0, 'no evidence button feeding a hidden form');
  } finally { await context.close(); }
});

test('with a connected action the brief is offered', async () => {
  const { page, context } = await openScreen(browser, 'review.html', platform(some, 1), DESKTOP);
  try {
    await page.locator('a.metric').first().waitFor();
    await page.locator('#briefPanel').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Open in Office' }).isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'Use this evidence' }).count(), 1);
  } finally { await context.close(); }
});

test('Career\'s picks counts the picks My jobs will show, and the tile goes when none are left', async () => {
  const summary = { ...some, metrics: some.metrics.map((m) => (m.id === 'approval-review' ? { ...m, value: '2' } : m)) };
  picksLeft.status = { 1: 'applied', 2: 'interview' };
  try {
    const { page, context } = await openScreen(browser, 'review.html', platform(summary, 0), DESKTOP);
    try {
      await page.locator('a.metric').first().waitFor();
      const labels = await page.locator('.metric span').allTextContents();
      assert.equal(labels.includes('Career\'s picks'), false, `both picks moved on, so no tile says there are any: ${JSON.stringify(labels)}`);
    } finally { await context.close(); }
  } finally { picksLeft.status = { 2: 'applied' }; }
});
